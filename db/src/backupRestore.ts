import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  parseStoredDashboardMetrics,
  StoredDashboardMetricsParseError,
} from './dashboardMetrics';
import { requireRestoreStagingTableName, requireTableName } from './dynamoClient';
import { dbLog } from './structuredLog';
import {
  accountSk,
  clusterSk,
  clusterTxnGsi1Pk,
  clusterTxnGsi1Sk,
  fileSk,
  fileTxnGsi2Pk,
  fileTxnGsi2Sk,
  METRICS_SK,
  PROFILE_SK,
  txnSk,
  userPk,
} from './keys';
import {
  BACKUP_SCHEMA_VERSION_V1,
  type BackupRestoreCounts,
  type BackupSnapshotV1,
  type TransactionRecord,
  type TransactionStatus,
} from './types';
import {
  acquireRestoreLock,
  deleteUserPartition,
  queryUserPartitionPages,
  releaseRestoreLock,
} from './userPartition';

/** Client errors mapped to HTTP 400 / 403 before or after lock acquire (with lock released when safe). */
export class BackupRestoreClientError extends Error {
  constructor(
    readonly statusCode: 400 | 403,
    message: string,
    readonly body: Record<string, unknown> = { error: message },
  ) {
    super(message);
    this.name = 'BackupRestoreClientError';
  }
}

function wireString(v: unknown, fallback: string = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  if (typeof v === 'symbol') return v.toString();
  return fallback;
}

function stripReservedWireKeys(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'PK' || k === 'SK') continue;
    if (k.startsWith('GSI')) continue;
    if (k === '_meta') continue;
    out[k] = v;
  }
  return out;
}

function copyMerchantEmbeddingIfPresent(
  item: Record<string, unknown>,
  rec: TransactionRecord,
) {
  if (item.merchant_embedding === undefined || item.merchant_embedding === null) {
    return;
  }
  const me = item.merchant_embedding as unknown[];
  if (Array.isArray(me)) {
    rec.merchant_embedding = me.map(Number);
  }
}

function transactionWireToRecord(
  row: Record<string, unknown>,
  userId: string,
): TransactionRecord {
  if (wireString(row.entity_type, '') !== 'TRANSACTION') {
    throw new BackupRestoreClientError(400, 'Invalid backup: transaction missing entity_type');
  }
  const transaction_file_id = wireString(row.transaction_file_id, '');
  if (!transaction_file_id) {
    throw new BackupRestoreClientError(
      400,
      'Invalid backup: transaction is missing transaction_file_id',
    );
  }
  const cluster_id = wireString(row.cluster_id, '');
  if (!cluster_id) {
    throw new BackupRestoreClientError(
      400,
      'Invalid backup: every transaction must include cluster_id',
    );
  }
  const status = row.status as TransactionStatus;
  if (status !== 'CLASSIFIED' && status !== 'PENDING_REVIEW') {
    throw new BackupRestoreClientError(400, 'Invalid backup: bad transaction status');
  }
  const id = wireString(row.id, '');
  if (!id) {
    throw new BackupRestoreClientError(400, 'Invalid backup: transaction missing id');
  }
  const date = Number(row.date);
  const amount = Number(row.amount);
  if (!Number.isFinite(date) || !Number.isFinite(amount)) {
    throw new BackupRestoreClientError(400, 'Invalid backup: transaction date/amount');
  }
  const rec: TransactionRecord = {
    user_id: wireString(row.user_id, userId),
    id,
    date,
    raw_merchant: wireString(row.raw_merchant, ''),
    amount,
    category: wireString(row.category, ''),
    status,
    is_recurring: Boolean(row.is_recurring),
    transaction_file_id,
    cluster_id,
  };
  if (row.cleaned_merchant !== undefined && row.cleaned_merchant !== null) {
    rec.cleaned_merchant = wireString(row.cleaned_merchant, '');
  }
  copyMerchantEmbeddingIfPresent(row, rec);
  if (row.suggested_category !== undefined) {
    rec.suggested_category =
      row.suggested_category === null ? null : wireString(row.suggested_category, '');
  }
  if (row.category_confidence !== undefined && row.category_confidence !== null) {
    rec.category_confidence = Number(row.category_confidence);
  }
  if (row.match_type !== undefined && row.match_type !== null) {
    rec.match_type = wireString(row.match_type, '');
  }
  return rec;
}

function transactionRecordToDynamoItem(
  rec: TransactionRecord,
  pk: string,
): Record<string, unknown> {
  const clusterId = rec.cluster_id ?? '';
  const gsi1pk = clusterTxnGsi1Pk(rec.user_id, clusterId);
  const gsi1sk = clusterTxnGsi1Sk(rec.id);
  const item: Record<string, unknown> = {
    PK: pk,
    SK: txnSk(rec.id),
    GSI1PK: gsi1pk,
    GSI1SK: gsi1sk,
    entity_type: 'TRANSACTION',
    user_id: rec.user_id,
    id: rec.id,
    date: rec.date,
    raw_merchant: rec.raw_merchant,
    cleaned_merchant: rec.cleaned_merchant,
    amount: rec.amount,
    cluster_id: rec.cluster_id,
    category: rec.category,
    status: rec.status,
    is_recurring: rec.is_recurring,
    transaction_file_id: rec.transaction_file_id,
    GSI2PK: fileTxnGsi2Pk(rec.user_id, rec.transaction_file_id),
    GSI2SK: fileTxnGsi2Sk(rec.id),
  };
  if (rec.merchant_embedding?.length) {
    item.merchant_embedding = rec.merchant_embedding;
  }
  if (rec.suggested_category !== undefined) {
    item.suggested_category = rec.suggested_category;
  }
  if (rec.category_confidence !== undefined) {
    item.category_confidence = rec.category_confidence;
  }
  if (rec.match_type !== undefined) {
    item.match_type = rec.match_type;
  }
  return item;
}

type PutBatch = Record<
  string,
  { PutRequest: { Item: Record<string, unknown> } }[]
>;

async function flushBatchWritePut(
  doc: DynamoDBDocumentClient,
  table: string,
  chunk: Record<string, unknown>[],
): Promise<void> {
  const maxAttempts = 8;
  let requestItems: PutBatch = {
    [table]: chunk.map((Item) => ({ PutRequest: { Item } })),
  };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await doc.send(
      new BatchWriteCommand({ RequestItems: requestItems }),
    );
    const unprocessed = res.UnprocessedItems?.[table];
    if (!unprocessed?.length) return;
    requestItems = { [table]: unprocessed } as PutBatch;
    if (attempt === maxAttempts - 1) {
      throw new Error(
        `DynamoDB BatchWrite: ${unprocessed.length} item(s) still unprocessed after ${maxAttempts} attempts (table ${table})`,
      );
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 50));
  }
}

async function batchWriteItemsParallel(
  doc: DynamoDBDocumentClient,
  table: string,
  items: Record<string, unknown>[],
  maxConcurrent: number,
): Promise<void> {
  const chunkSize = 25;
  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  if (!chunks.length) return;
  const workers = Math.min(maxConcurrent, chunks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      await flushBatchWritePut(doc, table, chunks[i]!);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * Validate backup JSON for restore (no Dynamo writes). Call **before** acquiring `RESTORE_LOCK`.
 */
export function validateBackupSnapshotForRestore(
  userId: string,
  raw: unknown,
): BackupSnapshotV1 {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupRestoreClientError(400, 'Invalid backup: root must be an object');
  }
  const root = raw as Record<string, unknown>;
  const ver = root.backup_schema_version;
  if (ver !== BACKUP_SCHEMA_VERSION_V1) {
    throw new BackupRestoreClientError(
      400,
      `Invalid backup: unsupported backup_schema_version (expected ${BACKUP_SCHEMA_VERSION_V1})`,
    );
  }
  const app_user_id = wireString(root.app_user_id, '');
  if (!app_user_id) {
    throw new BackupRestoreClientError(400, 'Invalid backup: missing app_user_id');
  }
  if (app_user_id !== userId) {
    throw new BackupRestoreClientError(
      403,
      'Backup app_user_id does not match authenticated user',
    );
  }
  const exported_at = Number(root.exported_at);
  if (!Number.isFinite(exported_at)) {
    throw new BackupRestoreClientError(400, 'Invalid backup: exported_at');
  }

  for (const key of [
    'accounts',
    'transactions',
    'clusters',
    'transaction_files',
  ] as const) {
    const a = root[key];
    if (!Array.isArray(a)) {
      throw new BackupRestoreClientError(400, `Invalid backup: ${key} must be an array`);
    }
  }

  if (root.profile !== null && (typeof root.profile !== 'object' || Array.isArray(root.profile))) {
    throw new BackupRestoreClientError(400, 'Invalid backup: profile must be object or null');
  }
  if (root.metrics !== null && (typeof root.metrics !== 'object' || Array.isArray(root.metrics))) {
    throw new BackupRestoreClientError(400, 'Invalid backup: metrics must be object or null');
  }

  const snapshot: BackupSnapshotV1 = {
    backup_schema_version: BACKUP_SCHEMA_VERSION_V1,
    exported_at,
    app_user_id,
    accounts: root.accounts as Record<string, unknown>[],
    profile: root.profile as Record<string, unknown> | null,
    metrics: root.metrics as Record<string, unknown> | null,
    transactions: root.transactions as Record<string, unknown>[],
    clusters: root.clusters as Record<string, unknown>[],
    transaction_files: root.transaction_files as Record<string, unknown>[],
  };

  const accountIds = new Set<string>();
  for (const row of snapshot.accounts) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: account row shape');
    }
    if (wireString(row.entity_type, '') !== 'ACCOUNT') {
      throw new BackupRestoreClientError(400, 'Invalid backup: account entity_type');
    }
    const id = wireString(row.id, '');
    if (!id) throw new BackupRestoreClientError(400, 'Invalid backup: account id');
    if (accountIds.has(id)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: duplicate account id');
    }
    accountIds.add(id);
    const created = Number(row.created_at);
    if (!Number.isFinite(created)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: account created_at');
    }
  }

  const clusterIds = new Set<string>();
  for (const row of snapshot.clusters) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: cluster row shape');
    }
    if (wireString(row.entity_type, '') !== 'CLUSTER') {
      throw new BackupRestoreClientError(400, 'Invalid backup: cluster entity_type');
    }
    const cid = wireString(row.cluster_id, '');
    if (!cid) throw new BackupRestoreClientError(400, 'Invalid backup: cluster_id');
    if (clusterIds.has(cid)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: duplicate cluster_id');
    }
    clusterIds.add(cid);
  }

  const fileIds = new Set<string>();
  for (const row of snapshot.transaction_files) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: transaction_file row shape');
    }
    if (wireString(row.entity_type, '') !== 'TRANSACTION_FILE') {
      throw new BackupRestoreClientError(400, 'Invalid backup: transaction_file entity_type');
    }
    const fid = wireString(row.id, '');
    if (!fid) throw new BackupRestoreClientError(400, 'Invalid backup: transaction_file id');
    if (fileIds.has(fid)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: duplicate transaction_file id');
    }
    fileIds.add(fid);
    const aid = wireString(row.account_id, '');
    if (!aid || !accountIds.has(aid)) {
      throw new BackupRestoreClientError(
        400,
        'Invalid backup: transaction_file references unknown account_id',
      );
    }
  }

  for (const row of snapshot.transactions) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new BackupRestoreClientError(400, 'Invalid backup: transaction row shape');
    }
    const rec = transactionWireToRecord(row, userId);
    const fid = rec.transaction_file_id;
    if (!fileIds.has(fid)) {
      throw new BackupRestoreClientError(
        400,
        'Invalid backup: transaction references unknown transaction_file_id',
      );
    }
    const cid = rec.cluster_id ?? '';
    if (!clusterIds.has(cid)) {
      throw new BackupRestoreClientError(
        400,
        'Invalid backup: transaction references unknown cluster_id',
      );
    }
  }

  if (snapshot.profile !== null) {
    if (wireString(snapshot.profile.entity_type, '') !== 'PROFILE') {
      throw new BackupRestoreClientError(400, 'Invalid backup: profile entity_type');
    }
  }

  if (snapshot.metrics !== null) {
    if (wireString(snapshot.metrics.entity_type, '') !== 'METRICS') {
      throw new BackupRestoreClientError(400, 'Invalid backup: metrics entity_type');
    }
    try {
      parseStoredDashboardMetrics(snapshot.metrics);
    } catch (e) {
      if (e instanceof StoredDashboardMetricsParseError) {
        throw new BackupRestoreClientError(400, `Invalid backup: metrics ${e.message}`);
      }
      throw e;
    }
  }

  return snapshot;
}

function materializeBackupItems(
  userId: string,
  snapshot: BackupSnapshotV1,
): Record<string, unknown>[] {
  const pk = userPk(userId);
  const items: Record<string, unknown>[] = [];
  const seenSk = new Set<string>();

  function addItem(it: Record<string, unknown>) {
    const sk = it.SK;
    const pkVal = it.PK;
    if (typeof sk !== 'string' || typeof pkVal !== 'string') {
      throw new Error('materialize: missing PK/SK');
    }
    const key = `${pkVal}|${sk}`;
    if (seenSk.has(key)) {
      throw new Error(`materialize: duplicate key ${key}`);
    }
    seenSk.add(key);
    items.push(it);
  }

  for (const row of snapshot.accounts) {
    const r = stripReservedWireKeys(row as Record<string, unknown>);
    const id = wireString(r.id, '');
    addItem({
      ...r,
      PK: pk,
      SK: accountSk(id),
      entity_type: 'ACCOUNT',
      user_id: userId,
      id,
      name: wireString(r.name, ''),
      created_at: Number(r.created_at ?? 0),
    });
  }

  for (const row of snapshot.clusters) {
    const r = stripReservedWireKeys(row as Record<string, unknown>);
    const cluster_id = wireString(r.cluster_id, '');
    const base: Record<string, unknown> = {
      ...r,
      PK: pk,
      SK: clusterSk(cluster_id),
      entity_type: 'CLUSTER',
      cluster_id,
    };
    addItem(base);
  }

  for (const row of snapshot.transaction_files) {
    const r = stripReservedWireKeys(row as Record<string, unknown>);
    const id = wireString(r.id, '');
    addItem({
      ...r,
      PK: pk,
      SK: fileSk(id),
      entity_type: 'TRANSACTION_FILE',
      user_id: userId,
      id,
      account_id: wireString(r.account_id, ''),
      source: r.source,
      format: r.format ?? {},
      timing: r.timing,
      result: r.result,
    });
  }

  for (const row of snapshot.transactions) {
    const rec = transactionWireToRecord(row as Record<string, unknown>, userId);
    addItem(transactionRecordToDynamoItem(rec, pk));
  }

  if (snapshot.profile !== null) {
    const r = stripReservedWireKeys(snapshot.profile);
    addItem({
      ...r,
      PK: pk,
      SK: PROFILE_SK,
      entity_type: 'PROFILE',
    });
  }

  if (snapshot.metrics !== null) {
    const r = stripReservedWireKeys(snapshot.metrics);
    addItem({
      ...r,
      PK: pk,
      SK: METRICS_SK,
      entity_type: 'METRICS',
      user_id: userId,
    });
  }

  return items;
}

function countByEntityType(
  items: Record<string, unknown>[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const et = wireString(it.entity_type, '');
    m.set(et, (m.get(et) ?? 0) + 1);
  }
  return m;
}

function validateMaterializedStaging(
  items: Record<string, unknown>[],
  snapshot: BackupSnapshotV1,
): void {
  const counts = countByEntityType(items);
  const expect = (et: string, n: number) => {
    if ((counts.get(et) ?? 0) !== n) {
      throw new Error(
        `restore staging verify: expected ${n} ${et}, got ${counts.get(et) ?? 0}`,
      );
    }
  };
  expect('ACCOUNT', snapshot.accounts.length);
  expect('TRANSACTION', snapshot.transactions.length);
  expect('CLUSTER', snapshot.clusters.length);
  expect('TRANSACTION_FILE', snapshot.transaction_files.length);
  expect('PROFILE', snapshot.profile === null ? 0 : 1);
  expect('METRICS', snapshot.metrics === null ? 0 : 1);

  const sampleTxn = items.find((i) => i.entity_type === 'TRANSACTION');
  if (sampleTxn) {
    for (const k of ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK']) {
      if (typeof sampleTxn[k] !== 'string' || !(sampleTxn[k] as string).length) {
        throw new Error(`restore staging verify: transaction missing ${k}`);
      }
    }
  }
}

export interface RunRestoreBackupWorkflowOptions {
  doc: DynamoDBDocumentClient;
  primaryTable: string;
  userId: string;
  snapshot: BackupSnapshotV1;
  refreshMetrics: () => Promise<void>;
}

/**
 * Full staging workflow (`data_model.md` §8.2). Caller must pass an already-validated snapshot.
 */
export async function runRestoreBackupWorkflow(
  opts: RunRestoreBackupWorkflowOptions,
): Promise<BackupRestoreCounts> {
  const { doc, primaryTable, userId, snapshot, refreshMetrics } = opts;
  const stagingTable = requireRestoreStagingTableName();
  requireTableName();

  const items = materializeBackupItems(userId, snapshot);
  validateMaterializedStaging(items, snapshot);

  const started = Date.now();
  await acquireRestoreLock(doc, userId, {
    restore_started_at: started,
    backup_schema_version: snapshot.backup_schema_version,
  });

  let primaryDeleteStarted = false;
  try {
    await deleteUserPartition({
      docClient: doc,
      dataset: 'restore_staging',
      userId,
    });
    await batchWriteItemsParallel(doc, stagingTable, items, 8);
    const stagingRows = await (async () => {
      const acc: Record<string, unknown>[] = [];
      for await (const page of queryUserPartitionPages({
        docClient: doc,
        dataset: 'restore_staging',
        userId,
        excludeRestoreLock: false,
      })) {
        acc.push(...page);
      }
      return acc;
    })();
    validateMaterializedStaging(stagingRows, snapshot);

    primaryDeleteStarted = true;
    await deleteUserPartition({
      docClient: doc,
      dataset: 'primary',
      userId,
    });
    await batchWriteItemsParallel(doc, primaryTable, stagingRows, 8);

    await deleteUserPartition({
      docClient: doc,
      dataset: 'restore_staging',
      userId,
    });

    await refreshMetrics();
    await releaseRestoreLock(doc, userId);
  } catch (e) {
    dbLog('error', 'backup.restore.failed', {
      userIdLen: userId.length,
      primaryDeleteStarted,
      err: e instanceof Error ? e.message : String(e),
    });
    if (!primaryDeleteStarted) {
      try {
        await deleteUserPartition({
          docClient: doc,
          dataset: 'restore_staging',
          userId,
        });
      } catch {
        /* best effort */
      }
      try {
        await releaseRestoreLock(doc, userId);
      } catch {
        /* best effort */
      }
    }
    throw e;
  }

  return {
    accounts: snapshot.accounts.length,
    transactions: snapshot.transactions.length,
    clusters: snapshot.clusters.length,
    transaction_files: snapshot.transaction_files.length,
    profile: snapshot.profile !== null,
    metrics: snapshot.metrics !== null,
  };
}