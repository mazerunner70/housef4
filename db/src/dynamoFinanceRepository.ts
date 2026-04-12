import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  clusterSk,
  clusterTxnGsi1Pk,
  clusterTxnGsi1Sk,
  PROFILE_SK,
  txnSk,
  userPk,
} from './keys';
import { getDocumentClient, requireTableName } from './dynamoClient';
import type {
  ImportIngestResult,
  ImportTransactionInput,
  MetricsSnapshot,
  PendingClusterRecord,
  TransactionRecord,
  TransactionStatus,
} from './types';

const GSI1 = 'GSI1';

export interface FinanceRepository {
  listTransactions(userId: string): Promise<TransactionRecord[]>;
  getMetrics(userId: string): Promise<MetricsSnapshot>;
  listPendingClusters(userId: string): Promise<PendingClusterRecord[]>;
  ingestImportBatch(
    userId: string,
    rows: ImportTransactionInput[],
  ): Promise<ImportIngestResult>;
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
          cluster_id: String(item.cluster_id),
          category: String(item.category),
          status: item.status as TransactionStatus,
          is_recurring: Boolean(item.is_recurring),
        };
        if (item.cleaned_merchant !== undefined && item.cleaned_merchant !== null) {
          rec.cleaned_merchant = String(item.cleaned_merchant);
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

  async ingestImportBatch(
    userId: string,
    rows: ImportTransactionInput[],
  ): Promise<ImportIngestResult> {
    if (rows.length === 0) {
      return { rowCount: 0, knownMerchants: 0, unknownMerchants: 0 };
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
      txnItems.push({
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
      });
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

      const suggested_category =
        prev?.suggested_category ?? null;

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
    };
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
