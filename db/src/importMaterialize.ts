import {
  buildClusterAggregateItem,
  clusterMembersFromTransactionItems,
  liveClusterIdsFromImportPlan,
} from './clusterAggregates';
import {
  clusterSk,
  clusterTxnGsi1Pk,
  clusterTxnGsi1Sk,
  fileSk,
  fileTxnGsi2Pk,
  fileTxnGsi2Sk,
  IMPORT_LOCK_SK,
  PROFILE_SK,
  RESTORE_LOCK_SK,
  txnSk,
  userPk,
} from './keys';
import type {
  ExistingTransactionPatch,
  ImportPersistPlan,
  ImportTransactionInput,
  TransactionFileInput,
} from './types';

function wireString(v: unknown, fallback: string = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  if (typeof v === 'symbol') return v.toString();
  return fallback;
}

function importTransactionToDynamoItem(
  r: ImportTransactionInput,
  pk: string,
  userId: string,
  transactionFileId: string,
): Record<string, unknown> {
  const gsi1pk = clusterTxnGsi1Pk(r.user_id, r.cluster_id);
  const gsi1sk = clusterTxnGsi1Sk(r.id);
  const item: Record<string, unknown> = {
    PK: pk,
    SK: txnSk(r.id),
    GSI1PK: gsi1pk,
    GSI1SK: gsi1sk,
    entity_type: 'TRANSACTION',
    user_id: r.user_id,
    id: r.id,
    date: r.date,
    raw_merchant: r.raw_merchant,
    cleaned_merchant: r.cleaned_merchant,
    amount: r.amount,
    file_amount: r.file_amount,
    cluster_id: r.cluster_id,
    category: r.category,
    status: r.status,
    is_recurring: r.is_recurring,
    transaction_file_id: transactionFileId,
    GSI2PK: fileTxnGsi2Pk(userId, transactionFileId),
    GSI2SK: fileTxnGsi2Sk(r.id),
  };
  if (r.merchant_embedding?.length) {
    item.merchant_embedding = r.merchant_embedding;
  }
  if (r.suggested_category !== undefined) {
    item.suggested_category = r.suggested_category;
  }
  if (r.category_confidence !== undefined) {
    item.category_confidence = r.category_confidence;
  }
  if (r.match_type !== undefined) {
    item.match_type = r.match_type;
  }
  if (r.pairing_id !== undefined) {
    item.pairing_id = r.pairing_id;
    if (r.pairing_source !== undefined) item.pairing_source = r.pairing_source;
    if (r.pairing_confidence !== undefined) item.pairing_confidence = r.pairing_confidence;
  }
  return item;
}

function clusterItemFromDynamo(item: Record<string, unknown>): {
  assigned_category: string | null;
  currency?: string;
} {
  const cur = item.currency;
  return {
    assigned_category:
      item.assigned_category === undefined
        ? null
        : (item.assigned_category as string | null),
    ...(cur != null && cur !== '' ? { currency: String(cur) } : {}),
  };
}

function applyPatchToTransactionItem(
  item: Record<string, unknown>,
  patch: ExistingTransactionPatch,
  userId: string,
): Record<string, unknown> {
  const gsi1pk = clusterTxnGsi1Pk(userId, patch.cluster_id);
  const gsi1sk = clusterTxnGsi1Sk(patch.id);
  const next: Record<string, unknown> = {
    ...item,
    cluster_id: patch.cluster_id,
    category: patch.category,
    status: patch.status,
    cleaned_merchant: patch.cleaned_merchant,
    GSI1PK: gsi1pk,
    GSI1SK: gsi1sk,
    merchant_embedding: patch.merchant_embedding,
    suggested_category: patch.suggested_category,
    category_confidence: patch.category_confidence,
    match_type: patch.match_type,
  };
  if (patch.pairing_id !== undefined) {
    next.pairing_id = patch.pairing_id;
    if (patch.pairing_source !== undefined) next.pairing_source = patch.pairing_source;
    if (patch.pairing_confidence !== undefined) {
      next.pairing_confidence = patch.pairing_confidence;
    }
  }
  return next;
}

function transactionFileToDynamoItem(
  userId: string,
  input: TransactionFileInput,
): Record<string, unknown> {
  const pk = userPk(userId);
  const item: Record<string, unknown> = {
    PK: pk,
    SK: fileSk(input.id),
    entity_type: 'TRANSACTION_FILE',
    user_id: userId,
    id: input.id,
    account_id: input.account_id,
    source: input.source,
    format: input.format,
    timing: input.timing,
    result: input.result,
  };
  const h = input.content_sha256?.trim();
  if (h) {
    item.content_sha256 = h;
  }
  return item;
}

export interface MaterializeImportPlanInput {
  userId: string;
  importFileId: string;
  plan: ImportPersistPlan;
  transactionFile: TransactionFileInput;
  /** Current primary partition items (system locks excluded). */
  primaryPartitionItems: Record<string, unknown>[];
  fileCurrency?: string;
}

/**
 * Pure projection of post-import Dynamo items for staging (`import_transaction_files.md` §8.7.2 step 3).
 * Matches in-place persist order: patch existing → ingest new → rebuild clusters → retire clusters → file row.
 */
export function materializeImportPlanToItems(
  input: MaterializeImportPlanInput,
): Record<string, unknown>[] {
  const { userId, importFileId, plan, transactionFile, primaryPartitionItems, fileCurrency } =
    input;
  const pk = userPk(userId);
  const patchById = new Map(plan.existingPatches.map((p) => [p.id, p] as const));
  const retired = new Set(plan.retiredClusterIds.filter(Boolean));

  const bySk = new Map<string, Record<string, unknown>>();
  for (const item of primaryPartitionItems) {
    const sk = item.SK;
    if (typeof sk !== 'string' || !sk) continue;
    if (sk === RESTORE_LOCK_SK || sk === IMPORT_LOCK_SK) continue;
    if (item.entity_type === 'CLUSTER') {
      const cid = wireString(item.cluster_id, '');
      if (cid && retired.has(cid)) continue;
    }
    bySk.set(sk, { ...item });
  }

  for (const [sk, item] of bySk) {
    if (item.entity_type !== 'TRANSACTION') continue;
    const id = wireString(item.id, '');
    const patch = patchById.get(id);
    if (patch) {
      bySk.set(sk, applyPatchToTransactionItem(item, patch, userId));
    }
  }

  for (const row of plan.toInsert) {
    bySk.set(
      txnSk(row.id),
      importTransactionToDynamoItem(row, pk, userId, importFileId),
    );
  }

  const existingClusters = new Map<string, ReturnType<typeof clusterItemFromDynamo>>();
  for (const item of bySk.values()) {
    if (item.entity_type !== 'CLUSTER') continue;
    const cid = wireString(item.cluster_id, '');
    if (cid) existingClusters.set(cid, clusterItemFromDynamo(item));
  }

  const allItems = [...bySk.values()];
  for (const clusterId of liveClusterIdsFromImportPlan(plan)) {
    const prev = existingClusters.get(clusterId);
    const hint = plan.clusterHints?.[clusterId];
    bySk.set(
      clusterSk(clusterId),
      buildClusterAggregateItem(
        pk,
        clusterId,
        clusterMembersFromTransactionItems(allItems, clusterId),
        {
          fileCurrency,
          assignedCategory: prev?.assigned_category ?? null,
          currency: prev?.currency,
          previousCategoryId: hint?.previousCategoryId ?? null,
        },
      ),
    );
  }

  bySk.set(fileSk(importFileId), transactionFileToDynamoItem(userId, transactionFile));

  if (!bySk.has(PROFILE_SK) && plan.toInsert.length > 0) {
    bySk.set(PROFILE_SK, {
      PK: pk,
      SK: PROFILE_SK,
      entity_type: 'PROFILE',
      net_worth: 0,
    });
  }

  return [...bySk.values()];
}

export function countImportMaterializedEntities(
  items: Record<string, unknown>[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const et = wireString(it.entity_type, '');
    m.set(et, (m.get(et) ?? 0) + 1);
  }
  return m;
}

export interface ImportStagingExpectCounts {
  transactionCount: number;
  clusterCount: number;
  transactionFileCount: number;
  accountCount: number;
  hasProfile: boolean;
  hasMetrics: boolean;
}

export function validateMaterializedImportStaging(
  materialized: Record<string, unknown>[],
  primaryPartitionItems: Record<string, unknown>[],
  plan: ImportPersistPlan,
): void {
  const countEntity = (items: Record<string, unknown>[], et: string) =>
    items.filter((i) => i.entity_type === et).length;

  const primaryAccounts = countEntity(primaryPartitionItems, 'ACCOUNT');
  if (countEntity(materialized, 'ACCOUNT') !== primaryAccounts) {
    throw new Error(
      `import staging verify: expected ${primaryAccounts} ACCOUNT, got ${countEntity(materialized, 'ACCOUNT')}`,
    );
  }

  const primaryTxns = countEntity(primaryPartitionItems, 'TRANSACTION');
  const expectTxns = primaryTxns + plan.toInsert.length;
  if (countEntity(materialized, 'TRANSACTION') !== expectTxns) {
    throw new Error(
      `import staging verify: expected ${expectTxns} TRANSACTION, got ${countEntity(materialized, 'TRANSACTION')}`,
    );
  }

  const primaryFiles = countEntity(primaryPartitionItems, 'TRANSACTION_FILE');
  const expectFiles = primaryFiles + 1;
  if (countEntity(materialized, 'TRANSACTION_FILE') !== expectFiles) {
    throw new Error(
      `import staging verify: expected ${expectFiles} TRANSACTION_FILE, got ${countEntity(materialized, 'TRANSACTION_FILE')}`,
    );
  }

  const primaryProfile = countEntity(primaryPartitionItems, 'PROFILE');
  const expectProfile =
    primaryProfile > 0 || plan.toInsert.length > 0 ? 1 : 0;
  if (countEntity(materialized, 'PROFILE') !== expectProfile) {
    throw new Error(
      `import staging verify: expected ${expectProfile} PROFILE, got ${countEntity(materialized, 'PROFILE')}`,
    );
  }

  const primaryMetrics = countEntity(primaryPartitionItems, 'METRICS');
  if (countEntity(materialized, 'METRICS') !== primaryMetrics) {
    throw new Error(
      `import staging verify: expected ${primaryMetrics} METRICS, got ${countEntity(materialized, 'METRICS')}`,
    );
  }

  const sampleTxn = materialized.find((i) => i.entity_type === 'TRANSACTION');
  if (sampleTxn) {
    for (const k of ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK']) {
      const v = sampleTxn[k];
      if (typeof v !== 'string' || v.length === 0) {
        throw new Error(`import staging verify: transaction missing ${k}`);
      }
    }
  }
}
