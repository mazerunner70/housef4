import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { requireRestoreStagingTableName, requireTableName } from './dynamoClient';
import { RESTORE_LOCK_SK, userPk } from './keys';
import type { RestoreLockRecord } from './types';

export class RestoreLockConflictError extends Error {
  readonly code = 'RESTORE_LOCK_CONFLICT' as const;

  constructor(readonly userId: string) {
    super(`restore lock already exists for user ${userId}`);
    this.name = 'RestoreLockConflictError';
  }
}

const PK = 'PK';
const SK = 'SK';

/** Which DynamoDB backing store to use; name is resolved from environment. */
export type UserPartitionDataset = 'primary' | 'restore_staging';

export function resolveUserPartitionDataset(
  dataset: UserPartitionDataset,
): string {
  return dataset === 'primary'
    ? requireTableName()
    : requireRestoreStagingTableName();
}

type DeleteBatchReq = Record<
  string,
  { DeleteRequest: { Key: Record<string, unknown> } }[]
>;

async function batchDeleteKeys(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: { PK: string; SK: string }[],
): Promise<void> {
  if (!keys.length) return;
  const chunkSize = 25;
  const maxAttempts = 8;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    let requestItems: DeleteBatchReq = {
      [tableName]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await client.send(
        new BatchWriteCommand({ RequestItems: requestItems }),
      );
      const unprocessed = res.UnprocessedItems?.[tableName];
      if (!unprocessed?.length) break;
      requestItems = { [tableName]: unprocessed as DeleteBatchReq[string] };
      if (attempt === maxAttempts - 1) {
        throw new Error(
          `DynamoDB BatchWrite delete: ${unprocessed.length} key(s) still unprocessed after ${maxAttempts} attempts (table ${tableName})`,
        );
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * 50));
    }
  }
}

export interface QueryUserPartitionPagesOptions {
  docClient: DynamoDBDocumentClient;
  /** Selects `DYNAMODB_TABLE_NAME` or `DYNAMODB_RESTORE_STAGING_TABLE_NAME`. */
  dataset: UserPartitionDataset;
  userId: string;
  /**
   * When true, omit the `RESTORE_LOCK` row from yielded pages (e.g. backup export).
   * @default false
   */
  excludeRestoreLock?: boolean;
  /** DynamoDB `Limit` per `Query` (page size hint, not total cap). */
  pageLimit?: number;
}

/** Paginated `Query` over `PK = USER#<userId>` (base table); yields one array per DynamoDB page. */
export async function* queryUserPartitionPages(
  opts: QueryUserPartitionPagesOptions,
): AsyncGenerator<Record<string, unknown>[], void, void> {
  const pk = userPk(opts.userId);
  const excludeLock = opts.excludeRestoreLock ?? false;
  const pageLimit = opts.pageLimit ?? 1000;
  const tableName = resolveUserPartitionDataset(opts.dataset);
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await opts.docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': PK },
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey,
        Limit: pageLimit,
      }),
    );
    ExclusiveStartKey = res.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
    const items = (res.Items ?? []) as Record<string, unknown>[];
    const page = excludeLock
      ? items.filter((it) => it[SK] !== RESTORE_LOCK_SK)
      : items;
    yield page;
  } while (ExclusiveStartKey);
}

export interface CollectUserPartitionItemsOptions
  extends QueryUserPartitionPagesOptions {}

/** Convenience: accumulate all pages into one array (export / bulk read). */
export async function collectUserPartitionItems(
  opts: CollectUserPartitionItemsOptions,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const page of queryUserPartitionPages(opts)) {
    out.push(...page);
  }
  return out;
}

export interface DeleteUserPartitionOptions {
  docClient: DynamoDBDocumentClient;
  dataset: UserPartitionDataset;
  userId: string;
  /**
   * When true, skip `SK = RESTORE_LOCK_SK` deletes (primary partition wipe mid-restore).
   * @default true — matches `data_model.md` 8.2a preservation during destructive primary steps.
   */
  excludeRestoreLock?: boolean;
  pageLimit?: number;
}

/**
 * Deletes every item under `PK = USER#<userId>` using paginated `Query` + `BatchWriteItem`
 * deletes. Safe for staging full-partition clears and primary wipes (with exclude lock).
 */
export async function deleteUserPartition(opts: DeleteUserPartitionOptions): Promise<void> {
  const excludeLock = opts.excludeRestoreLock ?? true;
  const pk = userPk(opts.userId);
  const pageLimit = opts.pageLimit ?? 1000;
  const tableName = resolveUserPartitionDataset(opts.dataset);
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await opts.docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': PK, '#sk': SK },
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey,
        Limit: pageLimit,
        ProjectionExpression: '#pk, #sk',
      }),
    );
    ExclusiveStartKey = res.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
    const items = (res.Items ?? []) as Record<string, unknown>[];
    const keys: { PK: string; SK: string }[] = [];
    for (const it of items) {
      const skVal = it[SK];
      if (typeof skVal !== 'string' || !skVal) continue;
      if (excludeLock && skVal === RESTORE_LOCK_SK) continue;
      keys.push({ PK: pk, SK: skVal });
    }
    await batchDeleteKeys(opts.docClient, tableName, keys);
  } while (ExclusiveStartKey);
}

export interface AcquireRestoreLockInput {
  /** Epoch ms UTC. */
  restore_started_at: number;
  backup_schema_version?: number;
}

/** `PutItem` on **primary** with `attribute_not_exists(SK)` — second acquire throws {@link RestoreLockConflictError}. */
export async function acquireRestoreLock(
  docClient: DynamoDBDocumentClient,
  userId: string,
  body: AcquireRestoreLockInput,
): Promise<void> {
  const pk = userPk(userId);
  const tableName = requireTableName();
  const item: Record<string, unknown> = {
    [PK]: pk,
    [SK]: RESTORE_LOCK_SK,
    entity_type: 'RESTORE_LOCK',
    user_id: userId,
    restore_started_at: body.restore_started_at,
  };
  if (body.backup_schema_version != null) {
    item.backup_schema_version = body.backup_schema_version;
  }
  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#sk)',
        ExpressionAttributeNames: { '#sk': SK },
      }),
    );
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      throw new RestoreLockConflictError(userId);
    }
    throw e;
  }
}

function parseOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Idempotent `DeleteItem` on **`RESTORE_LOCK`** on **primary** (`requireTableName()`). */
export async function releaseRestoreLock(
  docClient: DynamoDBDocumentClient,
  userId: string,
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: requireTableName(),
      Key: { [PK]: userPk(userId), [SK]: RESTORE_LOCK_SK },
    }),
  );
}

/** Reads the lock row on **primary** if present (e.g. `restore_in_progress`). */
export async function getRestoreLock(
  docClient: DynamoDBDocumentClient,
  userId: string,
): Promise<RestoreLockRecord | null> {
  const res = await docClient.send(
    new GetCommand({
      TableName: requireTableName(),
      Key: { [PK]: userPk(userId), [SK]: RESTORE_LOCK_SK },
    }),
  );
  const item = res.Item as Record<string, unknown> | undefined;
  if (item?.entity_type !== 'RESTORE_LOCK') return null;
  const persistedUserId = item.user_id;
  return {
    entity_type: 'RESTORE_LOCK',
    user_id: typeof persistedUserId === 'string' ? persistedUserId : userId,
    restore_started_at: Number(item.restore_started_at ?? 0),
    backup_schema_version: parseOptionalFiniteNumber(
      item.backup_schema_version,
    ),
  };
}
