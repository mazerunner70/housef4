import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import {
  accountSk,
  clusterSk,
  clusterTxnGsi1Pk,
  clusterTxnGsi1Sk,
  fileSk,
  fileTxnGsi2Pk,
  fileTxnGsi2Sk,
  ACCOUNT_PREFIX,
  FILE_PREFIX,
  METRICS_SK,
  PROFILE_SK,
  txnSk,
  userPk,
} from './keys';
import { getDocumentClient, requireTableName } from './dynamoClient';
import { collectUserPartitionItems } from './userPartition';
import {
  computeDashboardMetrics,
  metricsSnapshotLooksAllZero,
  parseStoredDashboardMetrics,
  StoredDashboardMetricsParseError,
  type DashboardMetricsStored,
} from './dashboardMetrics';
import { dbLog } from './structuredLog';
import {
  BACKUP_SCHEMA_VERSION_V1,
  type AccountRecord,
  type BackupSnapshotV1,
  type ExistingTransactionPatch,
  type ImportIngestResult,
  type ImportTransactionInput,
  type MetricsSnapshot,
  type PendingClusterRecord,
  type TransactionFileInput,
  type TransactionFileRecord,
  type TransactionFileSource,
  type TransactionFileFormat,
  type TransactionFileTiming,
  type TransactionRecord,
  type TransactionStatus,
} from './types';

/** String field from Dynamo/JSON: avoids `[object Object]` from `String(unknown)`. */
function wireString(v: unknown, fallback: string = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  if (typeof v === 'symbol') return v.toString();
  return fallback;
}

function applyFormatFromRow(
  o: Record<string, unknown>,
  out: TransactionFileFormat,
) {
  if (o.source_format != null) {
    out.source_format = wireString(o.source_format);
  }
  if (o.currency != null) {
    out.currency = wireString(o.currency);
  }
}

function metricsItemFallbackReason(
  rawMetrics: unknown,
  isMetricsEntity: boolean,
): 'metrics_item_missing' | 'metrics_item_not_object' | 'wrong_entity_type' | 'stored_payload_invalid' {
  if (rawMetrics == null) return 'metrics_item_missing';
  if (typeof rawMetrics !== 'object') return 'metrics_item_not_object';
  if (!isMetricsEntity) return 'wrong_entity_type';
  return 'stored_payload_invalid';
}

const GSI1 = 'GSI1';
const GSI2 = 'GSI2';

/** Keys not included in portable backup rows (`data_model.md` §8.3). */
const DYNAMO_INDEX_KEYS = new Set([
  'PK',
  'SK',
  'GSI1PK',
  'GSI1SK',
  'GSI2PK',
  'GSI2SK',
]);

function stripDynamoIndexKeys(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (DYNAMO_INDEX_KEYS.has(k)) continue;
    if (k.startsWith('GSI')) continue;
    out[k] = v;
  }
  return out;
}

function transactionRecordToBackupWire(rec: TransactionRecord): Record<string, unknown> {
  const row: Record<string, unknown> = {
    entity_type: 'TRANSACTION',
    user_id: rec.user_id,
    id: rec.id,
    date: rec.date,
    raw_merchant: rec.raw_merchant,
    amount: rec.amount,
    category: rec.category,
    status: rec.status,
    is_recurring: rec.is_recurring,
    transaction_file_id: rec.transaction_file_id,
  };
  if (rec.cleaned_merchant !== undefined) {
    row.cleaned_merchant = rec.cleaned_merchant;
  }
  if (rec.cluster_id !== undefined) {
    row.cluster_id = rec.cluster_id;
  }
  if (rec.merchant_embedding !== undefined && rec.merchant_embedding.length > 0) {
    row.merchant_embedding = rec.merchant_embedding;
  }
  if (rec.suggested_category !== undefined) {
    row.suggested_category = rec.suggested_category;
  }
  if (rec.category_confidence !== undefined) {
    row.category_confidence = rec.category_confidence;
  }
  if (rec.match_type !== undefined) {
    row.match_type = rec.match_type;
  }
  return row;
}

interface BackupExportAccum {
  accounts: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  clusters: Record<string, unknown>[];
  transaction_files: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
}

function transactionFileBackupCompletedAt(row: Record<string, unknown>): number {
  const t = row.timing;
  if (typeof t !== 'object' || t === null) {
    return 0;
  }
  const c = (t as TransactionFileTiming).completed_at;
  if (typeof c === 'number') {
    return c;
  }
  return Number(c ?? 0);
}

function sortBackupAccountsInPlace(accounts: Record<string, unknown>[]): void {
  accounts.sort((a, b) =>
    wireString(a.name, '').localeCompare(wireString(b.name, ''), undefined, {
      sensitivity: 'base',
    }),
  );
}

function sortBackupTransactionsInPlace(transactions: Record<string, unknown>[]): void {
  transactions.sort((a, b) => {
    const byDate = Number(b.date ?? 0) - Number(a.date ?? 0);
    if (byDate === 0) {
      return wireString(a.id, '').localeCompare(wireString(b.id, ''));
    }
    return byDate;
  });
}

function sortBackupClustersInPlace(clusters: Record<string, unknown>[]): void {
  clusters.sort((a, b) =>
    wireString(a.cluster_id, '').localeCompare(wireString(b.cluster_id, '')),
  );
}

function sortBackupTransactionFilesInPlace(
  transaction_files: Record<string, unknown>[],
): void {
  transaction_files.sort(
    (a, b) => transactionFileBackupCompletedAt(b) - transactionFileBackupCompletedAt(a),
  );
}

function appendPartitionItemToBackupExport(
  item: Record<string, unknown>,
  userId: string,
  acc: BackupExportAccum,
): void {
  const et = item.entity_type;
  if (typeof et !== 'string') {
    dbLog('warn', 'backup.export.skipped_unknown_entity', {
      entity_type: null,
      userIdLen: userId.length,
    });
    return;
  }

  switch (et) {
    case 'ACCOUNT': {
      if (wireString(item.id, '') !== '') {
        acc.accounts.push(stripDynamoIndexKeys(item));
      }
      break;
    }
    case 'TRANSACTION': {
      const rec = transactionItemToRecord(item, userId);
      if (rec) {
        acc.transactions.push(transactionRecordToBackupWire(rec));
      }
      break;
    }
    case 'CLUSTER': {
      if (wireString(item.cluster_id, '') !== '') {
        acc.clusters.push(stripDynamoIndexKeys(item));
      }
      break;
    }
    case 'TRANSACTION_FILE': {
      if (wireString(item.id, '') === '') break;
      const fallbackName = wireString(item.name, 'import');
      const source = parseSourceFromItem(item, fallbackName);
      const result = parseTransactionFileResult(
        item.result,
        item.ingest,
        item.row_count,
      );
      const accountId = wireString(item.account_id, '');
      const rec: TransactionFileRecord = {
        user_id: wireString(item.user_id, userId),
        id: wireString(item.id, ''),
        account_id: accountId.length > 0 ? accountId : '',
        source,
        format: parseFormatFromItem(item),
        timing: parseTimingFromItem(item),
        result,
      };
      acc.transaction_files.push({
        entity_type: 'TRANSACTION_FILE',
        user_id: rec.user_id,
        id: rec.id,
        account_id: rec.account_id,
        source: rec.source,
        format: rec.format,
        timing: rec.timing,
        result: rec.result,
      });
      break;
    }
    case 'PROFILE':
      acc.profile = stripDynamoIndexKeys(item);
      break;
    case 'METRICS':
      acc.metrics = stripDynamoIndexKeys(item);
      break;
    default:
      dbLog('warn', 'backup.export.skipped_unknown_entity', {
        entity_type: et,
        userIdLen: userId.length,
      });
  }
}

export interface FinanceRepository {
  listTransactions(userId: string): Promise<TransactionRecord[]>;
  listTransactionsByFileId(
    userId: string,
    transactionFileId: string,
  ): Promise<TransactionRecord[]>;
  getMetrics(userId: string): Promise<MetricsSnapshot>;
  /** Recompute transaction-derived dashboard fields and persist on the `METRICS` item. */
  refreshStoredDashboardMetrics(userId: string): Promise<void>;
  listPendingClusters(userId: string): Promise<PendingClusterRecord[]>;
  patchExistingTransactionsAfterImport(
    userId: string,
    patches: ExistingTransactionPatch[],
  ): Promise<void>;
  ingestImportBatch(
    userId: string,
    rows: ImportTransactionInput[],
    transactionFileId: string,
    fileCurrency?: string,
  ): Promise<ImportIngestResult>;
  getDefaultCurrencyCode(userId: string): Promise<string>;
  /** Remove CLUSTER# aggregate items whose ids are no longer referenced (import splits/merges). */
  retireClusterAggregates(userId: string, clusterIds: string[]): Promise<void>;
  recordTransactionFile(
    userId: string,
    input: TransactionFileInput,
  ): Promise<void>;
  listTransactionFiles(userId: string): Promise<TransactionFileRecord[]>;
  listAccounts(userId: string): Promise<AccountRecord[]>;
  getAccount(
    userId: string,
    accountId: string,
  ): Promise<AccountRecord | null>;
  createAccount(userId: string, name: string): Promise<AccountRecord>;
  applyTagRule(
    userId: string,
    clusterId: string,
    assignedCategory: string,
  ): Promise<number>;
  /** Primary partition snapshot for `GET /api/backup/export`; omits `RESTORE_LOCK`. */
  exportBackupSnapshot(userId: string): Promise<BackupSnapshotV1>;
}

interface ClusterItem {
  cluster_id: string;
  sample_merchants: string[];
  total_transactions: number;
  total_amount: number;
  suggested_category: string | null;
  assigned_category: string | null;
  pending_review: boolean;
  /** ISO 4217 from the latest import that set this aggregate, when known. */
  currency?: string;
}

function bestSuggestedFromRows(rows: ImportTransactionInput[]): string | null {
  let best: string | null = null;
  let bestC = -1;
  for (const r of rows) {
    if (r.suggested_category == null || r.suggested_category === '') continue;
    const c = r.category_confidence ?? 0;
    if (c > bestC) {
      bestC = c;
      best = r.suggested_category;
    }
  }
  return best;
}

function uniqSampleMerchants(merchants: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of merchants) {
    const t = m.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** `result` or legacy `ingest` + `row_count`. */
function parseTransactionFileResult(
  raw: unknown,
  legacyIngest: unknown,
  rowCountFallback: unknown,
): ImportIngestResult {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      rowCount: Number(o.rowCount ?? rowCountFallback ?? 0),
      knownMerchants: Number(o.knownMerchants ?? 0),
      unknownMerchants: Number(o.unknownMerchants ?? 0),
      existingTransactionsUpdated: Number(o.existingTransactionsUpdated ?? 0),
      newClustersTouched: Number(o.newClustersTouched ?? 0),
    };
  }
  if (legacyIngest && typeof legacyIngest === 'object' && !Array.isArray(legacyIngest)) {
    const o = legacyIngest as Record<string, unknown>;
    return {
      rowCount: Number(o.rowCount ?? rowCountFallback ?? 0),
      knownMerchants: Number(o.knownMerchants ?? 0),
      unknownMerchants: Number(o.unknownMerchants ?? 0),
      existingTransactionsUpdated: Number(o.existingTransactionsUpdated ?? 0),
      newClustersTouched: Number(o.newClustersTouched ?? 0),
    };
  }
  const n = Number(rowCountFallback ?? 0);
  return {
    rowCount: n,
    knownMerchants: 0,
    unknownMerchants: 0,
    existingTransactionsUpdated: 0,
    newClustersTouched: 0,
  };
}

function sourceFromNestedRow(
  o: Record<string, unknown>,
  fallbackName: string,
): TransactionFileSource {
  return {
    name: wireString(o.name, fallbackName),
    size_bytes: Number(o.size_bytes ?? 0),
    content_type:
      o.content_type != null && o.content_type !== ''
        ? wireString(o.content_type)
        : undefined,
  };
}

function parseSourceFromItem(
  item: Record<string, unknown>,
  fallbackName: string,
): TransactionFileSource {
  const s = item.source;
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    return sourceFromNestedRow(s as Record<string, unknown>, fallbackName);
  }
  const fi = item.file_import;
  if (fi && typeof fi === 'object' && !Array.isArray(fi)) {
    return sourceFromNestedRow(fi as Record<string, unknown>, fallbackName);
  }
  return { name: fallbackName, size_bytes: 0 };
}

function parseFormatFromItem(item: Record<string, unknown>): TransactionFileFormat {
  const out: TransactionFileFormat = {};
  const f = item.format;
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    applyFormatFromRow(f as Record<string, unknown>, out);
  }
  const fi = item.file_import;
  if (fi && typeof fi === 'object' && !Array.isArray(fi)) {
    const o = fi as Record<string, unknown>;
    if (o.source_format != null) {
      out.source_format = wireString(o.source_format);
    }
  }
  if (item.source_format != null && out.source_format === undefined) {
    out.source_format = wireString(item.source_format);
  }
  if (Object.keys(out).length) return out;
  return {};
}

function parseTimingFromItem(item: Record<string, unknown>): TransactionFileTiming {
  const t = item.timing;
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    const o = t as Record<string, unknown>;
    return {
      started_at: Number(o.started_at ?? 0),
      completed_at: Number(o.completed_at ?? 0),
    };
  }
  const completed = Number(item.imported_at ?? item.completed_at ?? 0);
  return { started_at: completed, completed_at: completed };
}

type PutBatch = Record<
  string,
  { PutRequest: { Item: Record<string, unknown> } }[]
>;

async function batchWriteAll(
  client: ReturnType<typeof getDocumentClient>,
  table: string,
  items: Record<string, unknown>[],
): Promise<void> {
  const chunkSize = 25;
  const maxAttempts = 8;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    let requestItems: PutBatch = {
      [table]: chunk.map((Item) => ({ PutRequest: { Item } })),
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await client.send(
        new BatchWriteCommand({ RequestItems: requestItems }),
      );
      const unprocessed = res.UnprocessedItems?.[table];
      if (!unprocessed?.length) break;
      requestItems = { [table]: unprocessed } as PutBatch;
      if (attempt === maxAttempts - 1) {
        throw new Error(
          `DynamoDB BatchWrite: ${unprocessed.length} item(s) still unprocessed after ${maxAttempts} attempts (table ${table})`,
        );
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * 50));
    }
  }
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

function transactionOptionalFields(
  item: Record<string, unknown>,
  rec: TransactionRecord,
) {
  if (item.cluster_id != null) {
    const c = wireString(item.cluster_id, '');
    if (c) rec.cluster_id = c;
  }
  if (item.cleaned_merchant !== undefined && item.cleaned_merchant !== null) {
    rec.cleaned_merchant = wireString(item.cleaned_merchant, '');
  }
  copyMerchantEmbeddingIfPresent(item, rec);
  if (item.suggested_category !== undefined) {
    rec.suggested_category =
      item.suggested_category === null
        ? null
        : wireString(item.suggested_category, '');
  }
  if (item.category_confidence !== undefined && item.category_confidence !== null) {
    rec.category_confidence = Number(item.category_confidence);
  }
  if (item.match_type !== undefined && item.match_type !== null) {
    rec.match_type = wireString(item.match_type, '');
  }
}

function transactionItemToRecord(
  item: Record<string, unknown>,
  userId: string,
): TransactionRecord | null {
  if (item.entity_type !== 'TRANSACTION') return null;
  const transaction_file_id = wireString(item.transaction_file_id, '');
  if (!transaction_file_id) {
    throw new Error(
      `TRANSACTION item ${wireString(item.id, '')} is missing transaction_file_id`,
    );
  }
  const rec: TransactionRecord = {
    user_id: wireString(item.user_id, userId),
    id: wireString(item.id, ''),
    date: Number(item.date),
    raw_merchant: wireString(item.raw_merchant, ''),
    amount: Number(item.amount),
    category: wireString(item.category, ''),
    status: item.status as TransactionStatus,
    is_recurring: Boolean(item.is_recurring),
    transaction_file_id,
  };
  transactionOptionalFields(item, rec);
  return rec;
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
  return item;
}

export class DynamoFinanceRepository implements FinanceRepository {
  constructor(
    private readonly doc = getDocumentClient(),
    private readonly tableName = requireTableName(),
  ) {}

  async listTransactions(userId: string): Promise<TransactionRecord[]> {
    const pk = userPk(userId);
    const out: TransactionRecord[] = [];
    let startKey: Record<string, unknown> | undefined;

    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :txn)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':txn': 'TXN#',
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) {
        const row = item as Record<string, unknown>;
        const rec = transactionItemToRecord(row, userId);
        if (rec) out.push(rec);
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    out.sort((a, b) => b.date - a.date);
    return out;
  }

  async listTransactionsByFileId(
    userId: string,
    transactionFileId: string,
  ): Promise<TransactionRecord[]> {
    const pk = fileTxnGsi2Pk(userId, transactionFileId);
    const out: TransactionRecord[] = [];
    let startKey: Record<string, unknown> | undefined;

    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: GSI2,
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) {
        const row = item as Record<string, unknown>;
        const rec = transactionItemToRecord(row, userId);
        if (rec) out.push(rec);
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    out.sort((a, b) => b.date - a.date);
    return out;
  }

  private async buildMetricsSnapshotFromStored(
    userId: string,
    rawMetrics: unknown,
    stored: DashboardMetricsStored,
    net_worth: number,
  ): Promise<MetricsSnapshot> {
    const rawDynamo = rawMetrics as Record<string, unknown>;
    let s = stored;
    if (!('transaction_count' in rawDynamo)) {
      const txns = await this.listTransactions(userId);
      const withCount: DashboardMetricsStored = {
        ...s,
        transaction_count: txns.length,
      };
      await this.putDashboardMetricsItem(userId, withCount, txns.length);
      s = withCount;
    }

    if (metricsSnapshotLooksAllZero(s)) {
      const txns = await this.listTransactions(userId);
      if (txns.length > 0) {
        const live = computeDashboardMetrics(txns, Date.now());
        if (!metricsSnapshotLooksAllZero(live)) {
          dbLog('info', 'metrics.snapshot.healed_stale_zero', {
            userIdLen: userId.length,
          });
          await this.putDashboardMetricsItem(userId, live, txns.length);
        }
        return { ...live, net_worth };
      }
    }

    const raw = rawMetrics as Record<string, unknown>;
    dbLog('info', 'metrics.snapshot.read', {
      source: 'METRICS_ITEM',
      userIdLen: userId.length,
      metricsUpdatedAt: raw.metrics_updated_at ?? null,
      monthly_cashflow: s.monthly_cashflow,
      cashflowHistory: s.cashflow_history.map((h) => ({
        label: h.label,
        net: h.income - h.expenses,
      })),
      spendingTop5: s.spending_by_category.slice(0, 5),
      net_worth,
    });
    return { ...s, net_worth };
  }

  private async fetchExistingClustersForIngest(
    pk: string,
    clusterIds: string[],
  ): Promise<Map<string, ClusterItem>> {
    const existing = new Map<string, ClusterItem>();
    for (const cid of clusterIds) {
      const got = await this.doc.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: clusterSk(cid) },
        }),
      );
      if (got.Item?.entity_type !== 'CLUSTER') {
        continue;
      }
      const d = got.Item;
      const cur = d.currency;
      existing.set(cid, {
        cluster_id: String(d.cluster_id),
        sample_merchants: (d.sample_merchants as string[]) ?? [],
        total_transactions: Number(d.total_transactions ?? 0),
        total_amount: Number(d.total_amount ?? 0),
        suggested_category:
          d.suggested_category === undefined
            ? null
            : (d.suggested_category as string | null),
        assigned_category:
          d.assigned_category === undefined
            ? null
            : (d.assigned_category as string | null),
        pending_review: Boolean(d.pending_review),
        ...(cur != null && cur !== '' ? { currency: String(cur) } : {}),
      });
    }
    return existing;
  }

  private buildClusterItemsForIngest(
    pk: string,
    byCluster: Map<
      string,
      { rows: ImportTransactionInput[]; merchants: string[] }
    >,
    existing: Map<string, ClusterItem>,
    fileCurrency?: string,
  ): Record<string, unknown>[] {
    const clusterItems: Record<string, unknown>[] = [];
    for (const [clusterId, g] of byCluster) {
      const prev = existing.get(clusterId);
      let total_transactions = g.rows.length;
      let total_amount = 0;
      for (const x of g.rows) total_amount += Math.abs(x.amount);
      if (prev) {
        total_transactions += prev.total_transactions;
        total_amount += prev.total_amount;
      }
      const mergedMerchants = uniqSampleMerchants(
        [...(prev?.sample_merchants ?? []), ...g.merchants],
        8,
      );
      const pending_review =
        g.rows.some((x) => x.status === 'PENDING_REVIEW') ||
        (prev?.pending_review ?? false);

      const batchSuggestion = bestSuggestedFromRows(g.rows);
      const suggested_category =
        batchSuggestion ?? prev?.suggested_category ?? null;

      const normalized = fileCurrency?.trim().toUpperCase();
      const fromFile =
        normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
      const clusterCurrency = fromFile ?? prev?.currency;

      const clusterItem: Record<string, unknown> = {
        PK: pk,
        SK: clusterSk(clusterId),
        entity_type: 'CLUSTER',
        cluster_id: clusterId,
        sample_merchants: mergedMerchants.slice(0, 3),
        total_transactions,
        total_amount,
        suggested_category,
        assigned_category: prev?.assigned_category ?? null,
        pending_review,
      };
      if (clusterCurrency) {
        clusterItem.currency = clusterCurrency;
      }
      clusterItems.push(clusterItem);
    }
    return clusterItems;
  }

  async getMetrics(userId: string): Promise<MetricsSnapshot> {
    const pk = userPk(userId);
    const [profile, metricsRow] = await Promise.all([
      this.doc.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: PROFILE_SK },
        }),
      ),
      this.doc.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: METRICS_SK },
        }),
      ),
    ]);

    const net_worth =
      profile.Item?.entity_type === 'PROFILE'
        ? Number(profile.Item.net_worth ?? 0)
        : 0;

    const rawMetrics = metricsRow.Item;
    const isMetricsEntity = Boolean(
      rawMetrics &&
        typeof rawMetrics === 'object' &&
        (rawMetrics as { entity_type?: string }).entity_type === 'METRICS',
    );
    let stored: DashboardMetricsStored | null = null;
    if (isMetricsEntity) {
      try {
        stored = parseStoredDashboardMetrics(rawMetrics);
      } catch (e) {
        if (e instanceof StoredDashboardMetricsParseError) {
          dbLog('error', 'metrics.snapshot.stored_parse_failed', {
            userIdLen: userId.length,
            path: e.path,
            message: e.message,
          });
        } else {
          throw e;
        }
      }
    }
    if (stored) {
      return this.buildMetricsSnapshotFromStored(
        userId,
        rawMetrics,
        stored,
        net_worth,
      );
    }

    const fallbackReason = metricsItemFallbackReason(
      rawMetrics,
      isMetricsEntity,
    );
    dbLog('warn', 'metrics.snapshot.fallback_compute', {
      userIdLen: userId.length,
      reason: fallbackReason,
      sawEntityType:
        rawMetrics && typeof rawMetrics === 'object'
          ? (rawMetrics as Record<string, unknown>).entity_type ?? null
          : null,
    });

    const txns = await this.listTransactions(userId);
    const computed = computeDashboardMetrics(txns, Date.now());
    return {
      ...computed,
      net_worth,
    };
  }

  async refreshStoredDashboardMetrics(userId: string): Promise<void> {
    const txns = await this.listTransactions(userId);
    const body = computeDashboardMetrics(txns, Date.now());
    await this.putDashboardMetricsItem(userId, body, txns.length);
  }

  private async putDashboardMetricsItem(
    userId: string,
    body: DashboardMetricsStored,
    txnCount: number,
  ): Promise<void> {
    const validated = parseStoredDashboardMetrics(body);
    const pk = userPk(userId);
    const updatedAt = Date.now();
    const item: Record<string, unknown> = {
      PK: pk,
      SK: METRICS_SK,
      entity_type: 'METRICS',
      user_id: userId,
      metrics_updated_at: updatedAt,
      transaction_count: validated.transaction_count,
      monthly_cashflow: validated.monthly_cashflow,
      spending_by_category: validated.spending_by_category,
      cashflow_history: validated.cashflow_history,
      cashflow_period_label: validated.cashflow_period_label,
    };
    if (validated.net_worth_change_pct !== undefined) {
      item.net_worth_change_pct = validated.net_worth_change_pct;
    }
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );

    dbLog('info', 'metrics.snapshot.persisted', {
      userIdLen: userId.length,
      txnCount,
      metrics_updated_at: updatedAt,
      monthly_cashflow: validated.monthly_cashflow,
    });
  }

  async getDefaultCurrencyCode(userId: string): Promise<string> {
    const profile = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: userPk(userId), SK: PROFILE_SK },
      }),
    );
    if (profile.Item?.entity_type !== 'PROFILE') return 'USD';
    const c = profile.Item.default_currency;
    if (c != null && c !== '' && typeof c === 'string') return c.toUpperCase();
    return 'USD';
  }

  async listPendingClusters(userId: string): Promise<PendingClusterRecord[]> {
    const pk = userPk(userId);
    const out: PendingClusterRecord[] = [];
    let startKey: Record<string, unknown> | undefined;

    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :cl)',
          FilterExpression: 'pending_review = :pr',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':cl': 'CLUSTER#',
            ':pr': true,
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) {
        if (item.entity_type !== 'CLUSTER') continue;
        const rec: PendingClusterRecord = {
          cluster_id: String(item.cluster_id),
          sample_merchants: (item.sample_merchants as string[]) ?? [],
          total_transactions: Number(item.total_transactions ?? 0),
          total_amount: Number(item.total_amount ?? 0),
          suggested_category:
            item.suggested_category === undefined
              ? null
              : (item.suggested_category as string | null),
        };
        if (item.currency != null && item.currency !== '') {
          rec.currency = String(item.currency);
        }
        out.push(rec);
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    return out;
  }

  async patchExistingTransactionsAfterImport(
    userId: string,
    patches: ExistingTransactionPatch[],
  ): Promise<void> {
    if (patches.length === 0) return;
    const pk = userPk(userId);
    for (const p of patches) {
      const gsi1pk = clusterTxnGsi1Pk(userId, p.cluster_id);
      const gsi1sk = clusterTxnGsi1Sk(p.id);
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: txnSk(p.id) },
          UpdateExpression:
            'SET cluster_id = :cid, category = :cat, #st = :st, cleaned_merchant = :cm, ' +
            'GSI1PK = :gpk, GSI1SK = :gsk, merchant_embedding = :me, ' +
            'suggested_category = :sg, category_confidence = :cc, #mt = :mt',
          ExpressionAttributeNames: {
            '#st': 'status',
            '#mt': 'match_type',
          },
          ExpressionAttributeValues: {
            ':cid': p.cluster_id,
            ':cat': p.category,
            ':st': p.status,
            ':cm': p.cleaned_merchant,
            ':gpk': gsi1pk,
            ':gsk': gsi1sk,
            ':me': p.merchant_embedding,
            ':sg': p.suggested_category,
            ':cc': p.category_confidence,
            ':mt': p.match_type,
          },
        }),
      );
    }
  }

  async ingestImportBatch(
    userId: string,
    rows: ImportTransactionInput[],
    transactionFileId: string,
    fileCurrency?: string,
  ): Promise<ImportIngestResult> {
    if (rows.length === 0) {
      return {
        rowCount: 0,
        knownMerchants: 0,
        unknownMerchants: 0,
        existingTransactionsUpdated: 0,
        newClustersTouched: 0,
      };
    }

    for (const r of rows) {
      if (r.user_id !== userId) {
        throw new Error(
          `Import row user_id "${r.user_id}" does not match batch userId "${userId}"`,
        );
      }
    }

    const pk = userPk(userId);
    let knownMerchants = 0;
    let unknownMerchants = 0;

    const txnItems: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (r.known_merchant) knownMerchants += 1;
      else unknownMerchants += 1;
      txnItems.push(
        importTransactionToDynamoItem(r, pk, userId, transactionFileId),
      );
    }

    const byCluster = new Map<
      string,
      { rows: ImportTransactionInput[]; merchants: string[] }
    >();
    for (const r of rows) {
      let g = byCluster.get(r.cluster_id);
      if (!g) {
        g = { rows: [], merchants: [] };
        byCluster.set(r.cluster_id, g);
      }
      g.rows.push(r);
      g.merchants.push(r.raw_merchant);
    }

    const existing = await this.fetchExistingClustersForIngest(
      pk,
      [...byCluster.keys()],
    );
    const clusterItems = this.buildClusterItemsForIngest(
      pk,
      byCluster,
      existing,
      fileCurrency,
    );

    await batchWriteAll(this.doc, this.tableName, [...txnItems, ...clusterItems]);

    await this.ensureProfile(userId);

    return {
      rowCount: rows.length,
      knownMerchants,
      unknownMerchants,
      existingTransactionsUpdated: 0,
      newClustersTouched: new Set(rows.map((r) => r.cluster_id)).size,
    };
  }

  async retireClusterAggregates(
    userId: string,
    clusterIds: string[],
  ): Promise<void> {
    if (clusterIds.length === 0) return;
    const pk = userPk(userId);
    for (const clusterId of clusterIds) {
      if (!clusterId) continue;
      await this.doc.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: clusterSk(clusterId) },
        }),
      );
    }
  }

  async recordTransactionFile(
    userId: string,
    input: TransactionFileInput,
  ): Promise<void> {
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
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );
  }

  async listTransactionFiles(userId: string): Promise<TransactionFileRecord[]> {
    const pk = userPk(userId);
    const out: TransactionFileRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :fp)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':fp': FILE_PREFIX,
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) {
        if (item.entity_type !== 'TRANSACTION_FILE') continue;
        const row = item as Record<string, unknown>;
        const fallbackName = wireString(row.name, 'import');
        const source = parseSourceFromItem(row, fallbackName);
        const result = parseTransactionFileResult(
          row.result,
          row.ingest,
          row.row_count,
        );
        const accountId = wireString(row.account_id, '');
        const rec: TransactionFileRecord = {
          user_id: wireString(row.user_id, userId),
          id: wireString(row.id, ''),
          account_id: accountId.length > 0 ? accountId : '',
          source,
          format: parseFormatFromItem(row),
          timing: parseTimingFromItem(row),
          result,
        };
        out.push(rec);
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    out.sort((a, b) => b.timing.completed_at - a.timing.completed_at);
    return out;
  }

  async listAccounts(userId: string): Promise<AccountRecord[]> {
    const pk = userPk(userId);
    const out: AccountRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :ap)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':ap': ACCOUNT_PREFIX,
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) {
        if (item.entity_type !== 'ACCOUNT') continue;
        const row = item as Record<string, unknown>;
        out.push({
          user_id: wireString(row.user_id, userId),
          id: wireString(row.id, ''),
          name: wireString(row.name, ''),
          created_at: Number(row.created_at ?? 0),
        });
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }

  async getAccount(
    userId: string,
    accountId: string,
  ): Promise<AccountRecord | null> {
    const pk = userPk(userId);
    const got = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: accountSk(accountId) },
      }),
    );
    if (got.Item?.entity_type !== 'ACCOUNT') return null;
    const row = got.Item as Record<string, unknown>;
    return {
      user_id: wireString(row.user_id, userId),
      id: wireString(row.id, ''),
      name: wireString(row.name, ''),
      created_at: Number(row.created_at ?? 0),
    };
  }

  async createAccount(userId: string, name: string): Promise<AccountRecord> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Account name is required');
    }
    const id = randomUUID();
    const created_at = Date.now();
    const rec: AccountRecord = {
      user_id: userId,
      id,
      name: trimmed,
      created_at,
    };
    const pk = userPk(userId);
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: pk,
          SK: accountSk(id),
          entity_type: 'ACCOUNT',
          user_id: userId,
          id,
          name: trimmed,
          created_at,
        },
      }),
    );
    return rec;
  }

  private async ensureProfile(userId: string): Promise<void> {
    const pk = userPk(userId);
    const got = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: PROFILE_SK },
      }),
    );
    if (got.Item?.entity_type === 'PROFILE') return;

    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: pk,
          SK: PROFILE_SK,
          entity_type: 'PROFILE',
          net_worth: 0,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    ).catch(() => {
      /* concurrent create */
    });
  }

  async applyTagRule(
    userId: string,
    clusterId: string,
    assignedCategory: string,
  ): Promise<number> {
    const pk = userPk(userId);
    const gsi1pk = clusterTxnGsi1Pk(userId, clusterId);
    const keys: { PK: string; SK: string }[] = [];
    let startKey: Record<string, unknown> | undefined;

    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: GSI1,
          KeyConditionExpression: 'GSI1PK = :gpk',
          ExpressionAttributeValues: { ':gpk': gsi1pk },
          ExclusiveStartKey: startKey,
          ProjectionExpression: 'PK, SK',
        }),
      );
      for (const item of res.Items ?? []) {
        keys.push({ PK: String(item.PK), SK: String(item.SK) });
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    let updated = 0;
    for (const key of keys) {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: 'SET #cat = :cat, #st = :st',
          ExpressionAttributeNames: {
            '#cat': 'category',
            '#st': 'status',
          },
          ExpressionAttributeValues: {
            ':cat': assignedCategory,
            ':st': 'CLASSIFIED',
          },
        }),
      );
      updated += 1;
    }

    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: clusterSk(clusterId) },
        UpdateExpression:
          'SET assigned_category = :ac, pending_review = :pr, suggested_category = :sg',
        ExpressionAttributeValues: {
          ':ac': assignedCategory,
          ':pr': false,
          ':sg': assignedCategory,
        },
      }),
    ).catch(async () => {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: pk,
            SK: clusterSk(clusterId),
            entity_type: 'CLUSTER',
            cluster_id: clusterId,
            sample_merchants: [],
            total_transactions: updated,
            total_amount: 0,
            suggested_category: assignedCategory,
            assigned_category: assignedCategory,
            pending_review: false,
          },
        }),
      );
    });

    await this.refreshStoredDashboardMetrics(userId);

    return updated;
  }

  async exportBackupSnapshot(userId: string): Promise<BackupSnapshotV1> {
    const exported_at = Date.now();
    const items = await collectUserPartitionItems({
      docClient: this.doc,
      dataset: 'primary',
      userId,
      excludeRestoreLock: true,
    });

    const acc: BackupExportAccum = {
      accounts: [],
      transactions: [],
      clusters: [],
      transaction_files: [],
      profile: null,
      metrics: null,
    };

    for (const item of items) {
      appendPartitionItemToBackupExport(item, userId, acc);
    }

    sortBackupAccountsInPlace(acc.accounts);
    sortBackupTransactionsInPlace(acc.transactions);
    sortBackupClustersInPlace(acc.clusters);
    sortBackupTransactionFilesInPlace(acc.transaction_files);

    dbLog('info', 'backup.export.built', {
      userIdLen: userId.length,
      txnCount: acc.transactions.length,
      clusterCount: acc.clusters.length,
      fileCount: acc.transaction_files.length,
      accountCount: acc.accounts.length,
      hasProfile: acc.profile !== null,
      hasMetrics: acc.metrics !== null,
    });

    return {
      backup_schema_version: BACKUP_SCHEMA_VERSION_V1,
      exported_at,
      app_user_id: userId,
      accounts: acc.accounts,
      profile: acc.profile,
      metrics: acc.metrics,
      transactions: acc.transactions,
      clusters: acc.clusters,
      transaction_files: acc.transaction_files,
    };
  }
}
