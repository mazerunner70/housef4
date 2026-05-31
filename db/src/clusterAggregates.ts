import { abs, add, money, parseCurrency, type Money } from '@housef4/money';

import { readCanonicalAmountFromRow } from './storedAmount';

import { clusterSk } from './keys';
import type { ImportPersistPlan, TransactionStatus } from './types';

export type ClusterAggregateMember = Readonly<{
  raw_merchant: string;
  canonicalAmount: Money;
  category: string;
  status: TransactionStatus;
  suggested_category?: string | null;
  category_confidence?: number;
}>;

/** Distinct live cluster ids assigned by import planning (inserts + patches). */
export function liveClusterIdsFromImportPlan(plan: ImportPersistPlan): string[] {
  const ids = new Set<string>();
  for (const row of plan.toInsert) {
    if (row.cluster_id) ids.add(row.cluster_id);
  }
  for (const patch of plan.existingPatches) {
    if (patch.cluster_id) ids.add(patch.cluster_id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
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

function bestSuggestedFromMembers(
  members: readonly ClusterAggregateMember[],
): string | null {
  let best: string | null = null;
  let bestC = -1;
  for (const m of members) {
    if (m.suggested_category == null || m.suggested_category === '') continue;
    const c = m.category_confidence ?? 0;
    if (c > bestC) {
      bestC = c;
      best = m.suggested_category;
    }
  }
  return best;
}

function dynamoString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeFileCurrency(fileCurrency?: string): string | undefined {
  if (!fileCurrency?.trim()) return undefined;
  return parseCurrency(fileCurrency).id;
}

/**
 * Authoritative post-run category: user/rule `assigned_category` on CLUSTER when set,
 * else unanimous `category` among CLASSIFIED members (`import_transaction_files.md` §7).
 */
export function authoritativeAssignedCategory(
  members: readonly ClusterAggregateMember[],
  userAssignedCategory: string | null | undefined,
): string | null {
  const stored = userAssignedCategory?.trim();
  if (stored) return stored;
  const classified = members.filter((m) => m.status === 'CLASSIFIED');
  if (classified.length === 0) return null;
  const first = classified[0].category.trim();
  if (!first) return null;
  for (const m of classified) {
    if (m.category.trim() !== first) return null;
  }
  return first;
}

/**
 * §7 review-queue predicate: diff vs `previous_category_id` when present; else any
 * member still `PENDING_REVIEW`.
 */
export function computeClusterPendingReview(
  assignedCategory: string | null,
  previousCategoryId: string | null | undefined,
  members: readonly ClusterAggregateMember[],
): boolean {
  const prev = previousCategoryId?.trim();
  if (prev) {
    return assignedCategory !== prev;
  }
  return members.some((m) => m.status === 'PENDING_REVIEW');
}

export type BuildClusterAggregateOptions = Readonly<{
  fileCurrency?: string;
  assignedCategory?: string | null;
  /** Preserved when not overridden by `fileCurrency`. */
  currency?: string;
  /** §7 unanimous prior category among existing members before this corpus pass. */
  previousCategoryId?: string | null;
}>;

/** Full rebuild of one `CLUSTER#…` item from all member transactions (§8.3). */
export function buildClusterAggregateItem(
  pk: string,
  clusterId: string,
  members: readonly ClusterAggregateMember[],
  opts: BuildClusterAggregateOptions = {},
): Record<string, unknown> {
  let totalAmount = money(0);
  const merchants: string[] = [];
  const fromFile = normalizeFileCurrency(opts.fileCurrency);
  const clusterCurrency = fromFile ?? opts.currency;
  if (!clusterCurrency?.trim()) {
    throw new Error('buildClusterAggregateItem: currency is required for amount aggregation');
  }

  for (const m of members) {
    totalAmount = add(
      totalAmount,
      abs(m.canonicalAmount, clusterCurrency),
      clusterCurrency,
    );
    merchants.push(m.raw_merchant);
  }

  const previousCategoryId = opts.previousCategoryId ?? null;
  const assigned_category = authoritativeAssignedCategory(members, opts.assignedCategory);
  const pending_review = computeClusterPendingReview(
    assigned_category,
    previousCategoryId,
    members,
  );

  const item: Record<string, unknown> = {
    PK: pk,
    SK: clusterSk(clusterId),
    entity_type: 'CLUSTER',
    cluster_id: clusterId,
    sample_merchants: uniqSampleMerchants(merchants, 3),
    total_transactions: members.length,
    total_amount_minor: totalAmount.units,
    suggested_category: bestSuggestedFromMembers(members),
    assigned_category,
    previous_category_id: previousCategoryId,
    pending_review,
  };
  if (clusterCurrency) {
    item.currency = clusterCurrency;
  }
  return item;
}

export function clusterMembersFromTransactionItems(
  items: Iterable<Record<string, unknown>>,
  clusterId: string,
): ClusterAggregateMember[] {
  const out: ClusterAggregateMember[] = [];
  for (const item of items) {
    if (item.entity_type !== 'TRANSACTION') continue;
    if (dynamoString(item.cluster_id) !== clusterId) continue;
    out.push({
      raw_merchant: dynamoString(item.raw_merchant),
      canonicalAmount: readCanonicalAmountFromRow(item),
      category: dynamoString(item.category),
      status: dynamoString(item.status, 'PENDING_REVIEW') as TransactionStatus,
      suggested_category:
        item.suggested_category === undefined
          ? undefined
          : (item.suggested_category as string | null),
      category_confidence:
        item.category_confidence === undefined
          ? undefined
          : Number(item.category_confidence),
    });
  }
  return out;
}
