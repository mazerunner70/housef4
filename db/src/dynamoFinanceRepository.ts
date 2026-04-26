import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  clusterSk,
  clusterTxnGsi1Pk,
  clusterTxnGsi1Sk,
  fileSk,
  FILE_PREFIX,
  PROFILE_SK,
  txnSk,
  userPk,
} from './keys';
import { getDocumentClient, requireTableName } from './dynamoClient';
import type {
  ExistingTransactionPatch,
  ImportIngestResult,
  ImportTransactionInput,
  MetricsSnapshot,
  PendingClusterRecord,
  TransactionFileInput,
  TransactionFileRecord,
  TransactionFileSource,
  TransactionFileFormat,
  TransactionFileTiming,
  TransactionRecord,
  TransactionStatus,
} from './types';

const GSI1 = 'GSI1';

export interface FinanceRepository {
  listTransactions(userId: string): Promise<TransactionRecord[]>;
  getMetrics(userId: string): Promise<MetricsSnapshot>;
  listPendingClusters(userId: string): Promise<PendingClusterRecord[]>;
  patchExistingTransactionsAfterImport(
    userId: string,
    patches: ExistingTransactionPatch[],
  ): Promise<void>;
  ingestImportBatch(
    userId: string,
    rows: ImportTransactionInput[],
  ): Promise<ImportIngestResult>;
  /** Remove CLUSTER# aggregate items whose ids are no longer referenced (import splits/merges). */
  retireClusterAggregates(userId: string, clusterIds: string[]): Promise<void>;
  recordTransactionFile(
    userId: string,
    input: TransactionFileInput,
  ): Promise<void>;
  listTransactionFiles(userId: string): Promise<TransactionFileRecord[]>;
  applyTagRule(
    userId: string,
    clusterId: string,
    assignedCategory: string,
  ): Promise<number>;
}

interface ClusterItem {
  cluster_id: string;
  sample_merchants: string[];
  total_transactions: number;
  total_amount: number;
  suggested_category: string | null;
  assigned_category: string | null;
  pending_review: boolean;
}

function monthBoundsUtcMs(at: number): { start: number; end: number } {
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
  const end = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return { start, end };
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

function parseSourceFromItem(
  item: Record<string, unknown>,
  fallbackName: string,
): TransactionFileSource {
  const s = item.source;
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const o = s as Record<string, unknown>;
    return {
      name: String(o.name ?? fallbackName),
      size_bytes: Number(o.size_bytes ?? 0),
      content_type:
        o.content_type !== undefined && o.content_type !== null
          ? String(o.content_type)
          : undefined,
    };
  }
  const fi = item.file_import;
  if (fi && typeof fi === 'object' && !Array.isArray(fi)) {
    const o = fi as Record<string, unknown>;
    return {
      name: String(o.name ?? fallbackName),
      size_bytes: Number(o.size_bytes ?? 0),
      content_type:
        o.content_type !== undefined && o.content_type !== null
          ? String(o.content_type)
          : undefined,
    };
  }
  return { name: fallbackName, size_bytes: 0 };
}

function parseFormatFromItem(item: Record<string, unknown>): TransactionFileFormat {
  const f = item.format;
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const o = f as Record<string, unknown>;
    if (o.source_format !== undefined && o.source_format !== null) {
      return { source_format: String(o.source_format) };
    }
  }
  const fi = item.file_import;
  if (fi && typeof fi === 'object' && !Array.isArray(fi)) {
    const o = fi as Record<string, unknown>;
    if (o.source_format !== undefined && o.source_format !== null) {
      return { source_format: String(o.source_format) };
    }
  }
  if (item.source_format != null) {
    return { source_format: String(item.source_format) };
  }
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
        if (item.entity_type !== 'TRANSACTION') continue;
        const rec: TransactionRecord = {
          user_id: String(item.user_id ?? userId),
          id: String(item.id),
          date: Number(item.date),
          raw_merchant: String(item.raw_merchant),
          amount: Number(item.amount),
          category: String(item.category),
          status: item.status as TransactionStatus,
          is_recurring: Boolean(item.is_recurring),
        };
        if (item.cluster_id != null && item.cluster_id !== '') {
          rec.cluster_id = String(item.cluster_id);
        }
        if (item.cleaned_merchant !== undefined && item.cleaned_merchant !== null) {
          rec.cleaned_merchant = String(item.cleaned_merchant);
        }
        if (item.merchant_embedding !== undefined && item.merchant_embedding !== null) {
          const me = item.merchant_embedding as unknown[];
          if (Array.isArray(me)) {
            rec.merchant_embedding = me.map((x) => Number(x));
          }
        }
        if (item.suggested_category !== undefined) {
          rec.suggested_category =
            item.suggested_category === null
              ? null
              : String(item.suggested_category);
        }
        if (item.category_confidence !== undefined && item.category_confidence !== null) {
          rec.category_confidence = Number(item.category_confidence);
        }
        if (item.match_type !== undefined && item.match_type !== null) {
          rec.match_type = String(item.match_type);
        }
        out.push(rec);
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    out.sort((a, b) => b.date - a.date);
    return out;
  }

  async getMetrics(userId: string): Promise<MetricsSnapshot> {
    const txns = await this.listTransactions(userId);
    const now = Date.now();
    const { start, end } = monthBoundsUtcMs(now);

    let income = 0;
    let expenses = 0;
    const categoryTotals = new Map<string, number>();

    for (const t of txns) {
      if (t.date < start || t.date > end) continue;
      if (t.amount > 0) income += t.amount;
      else expenses += -t.amount;
      if (t.amount < 0) {
        const cat = t.category || 'Uncategorized';
        categoryTotals.set(
          cat,
          (categoryTotals.get(cat) ?? 0) + -t.amount,
        );
      }
    }

    const spending_by_category = [...categoryTotals.entries()].map(
      ([category, amount]) => ({ category, amount }),
    );
    spending_by_category.sort((a, b) => b.amount - a.amount);

    const profile = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: userPk(userId), SK: PROFILE_SK },
      }),
    );
    const net_worth =
      profile.Item?.entity_type === 'PROFILE'
        ? Number(profile.Item.net_worth ?? 0)
        : 0;

    const net = income - expenses;
    return {
      monthly_cashflow: { income, expenses, net },
      net_worth,
      spending_by_category,
    };
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
        out.push({
          cluster_id: String(item.cluster_id),
          sample_merchants: (item.sample_merchants as string[]) ?? [],
          total_transactions: Number(item.total_transactions ?? 0),
          total_amount: Number(item.total_amount ?? 0),
          suggested_category:
            item.suggested_category === undefined
              ? null
              : (item.suggested_category as string | null),
        });
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
      txnItems.push(item);
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

    const clusterIds = [...byCluster.keys()];
    const existing = new Map<string, ClusterItem>();
    for (const cid of clusterIds) {
      const got = await this.doc.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: clusterSk(cid) },
        }),
      );
      if (got.Item?.entity_type === 'CLUSTER') {
        existing.set(cid, {
          cluster_id: String(got.Item.cluster_id),
          sample_merchants: (got.Item.sample_merchants as string[]) ?? [],
          total_transactions: Number(got.Item.total_transactions ?? 0),
          total_amount: Number(got.Item.total_amount ?? 0),
          suggested_category:
            got.Item.suggested_category === undefined
              ? null
              : (got.Item.suggested_category as string | null),
          assigned_category:
            got.Item.assigned_category === undefined
              ? null
              : (got.Item.assigned_category as string | null),
          pending_review: Boolean(got.Item.pending_review),
        });
      }
    }

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

      clusterItems.push({
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
      });
    }

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
        const fallbackName = String(row.name ?? 'import');
        const source = parseSourceFromItem(row, fallbackName);
        const result = parseTransactionFileResult(
          row.result,
          row.ingest,
          row.row_count,
        );
        const rec: TransactionFileRecord = {
          user_id: String(row.user_id ?? userId),
          id: String(row.id),
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

    return updated;
  }
}
