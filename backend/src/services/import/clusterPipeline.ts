import type {
  ImportTransactionInput,
  TransactionRecord,
  TransferPairingAssignment,
} from '@housef4/db';

import {
  loadCategoryVectors,
  mlMatchForEmbedding,
  ruleMatchForText,
  type CategorySuggestion,
} from './categoryClassifier';
import type { ParsedImportRow } from './canonical';
import { dbscanCosine } from './dbscanCosine';
import { cleanMerchantForClustering } from './merchantNormalize';
import {
  hashEmbedding,
  meanNormalized,
  type MerchantEmbedder,
} from './merchantsEmbedder';
import { resolveClusterIdByPhysicalGroup } from './clusterIdentity';

export const DBSCAN_EPS = 0.3;
export const DBSCAN_MIN_SAMPLES = 3;

type SourceRow =
  | { kind: 'existing'; record: TransactionRecord }
  | { kind: 'new'; row: ParsedImportRow; id: string };

export type Assignment = {
  cluster_id: string;
  category: string;
  status: 'CLASSIFIED' | 'PENDING_REVIEW';
  suggested_category: string | null;
  category_confidence: number;
  match_type: CategorySuggestion['match_type'] | 'INHERITED';
  known_merchant: boolean;
  embedding: Float32Array;
};

const INTERNAL_TRANSFER_EMBEDDING = hashEmbedding('internal_transfer');

/** Shared cluster bucket for internal transfers excluded from merchant clustering. */
export const INTERNAL_TRANSFER_CLUSTER_ID = 'internal_transfer';

/** Stable assignment for paired transfer legs (`transfer_matching.md` §7). */
export function internalTransferAssignment(): Assignment {
  return {
    cluster_id: INTERNAL_TRANSFER_CLUSTER_ID,
    category: 'Uncategorized',
    status: 'CLASSIFIED',
    suggested_category: null,
    category_confidence: 1,
    match_type: 'RULE',
    known_merchant: true,
    embedding: INTERNAL_TRANSFER_EMBEDDING,
  };
}

/** DBSCAN uses -1 for all noise points; split into singleton groups for stable ids and per-row categorization. */
export function splitNoiseLabels(labels: number[]): number[] {
  let noiseSeq = -1000000;
  return labels.map((L) => (L === -1 ? noiseSeq-- : L));
}

function resolvePhysicalGroupLabels(
  sources: SourceRow[],
  embeddings: Float32Array[],
  physicalGroupLabels?: readonly number[],
): number[] {
  if (physicalGroupLabels === undefined) {
    const rawLabels =
      sources.length <= 1
        ? new Array(sources.length).fill(-1)
        : dbscanCosine(embeddings, DBSCAN_EPS, DBSCAN_MIN_SAMPLES);
    return splitNoiseLabels(rawLabels);
  }
  if (physicalGroupLabels.length !== sources.length) {
    throw new Error(
      'runClusterPipelineCore: physicalGroupLabels length must match clusterable sources',
    );
  }
  // Same noise-splitting as the DBSCAN path so tests can pass raw `-1` labels.
  return splitNoiseLabels([...physicalGroupLabels]);
}

/**
 * Pick the **plurality** category among existing `CLASSIFIED` rows in the physical group
 * (§7). If a user (or data drift) left conflicting categories on the same group, the
 * majority wins; ties break lexicographically for stability.
 */
function inheritedCategoryForGroup(
  indices: number[],
  sources: SourceRow[],
): string | null {
  const counts = new Map<string, number>();
  for (const i of indices) {
    const s = sources[i];
    if (s.kind === 'existing' && s.record.status === 'CLASSIFIED') {
      const c = s.record.category;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return sorted[0][0];
}

function categorizeGroup(
  indices: number[],
  cleanedTexts: string[],
  embeddings: Float32Array[],
  categoryVectors: Float32Array[],
): CategorySuggestion {
  if (indices.length === 1) {
    const i = indices[0];
    const text = cleanedTexts[i];
    const rule = ruleMatchForText(text);
    if (rule) return rule;
    return mlMatchForEmbedding(embeddings[i], categoryVectors);
  }

  for (const i of indices) {
    const rule = ruleMatchForText(cleanedTexts[i]);
    if (rule) return rule;
  }

  const groupEmb = indices.map((i) => embeddings[i]);
  const centroid = meanNormalized(groupEmb);
  return mlMatchForEmbedding(centroid, categoryVectors);
}

export type ClusterPipelineResult = {
  sources: SourceRow[];
  assignments: Assignment[];
  clusterSuggestions: Map<string, CategorySuggestion>;
  /** Same ordering as the first `existing.length` entries in `sources` / `assignments`. */
  existingSorted: TransactionRecord[];
};

export type ClusterPipelineOpts = Readonly<{
  newTransactionIds: readonly string[];
  pairedTxnIds?: ReadonlySet<string>;
  /**
   * Test-only: skip DBSCAN and use these labels for clusterable sources
   * (existing clusterable rows first, then new clusterable rows in parse order).
   * DBSCAN noise (`-1`) is always split into singleton groups via `splitNoiseLabels`.
   */
  physicalGroupLabels?: readonly number[];
}>;

async function runClusterPipelineCore(
  sources: SourceRow[],
  embedder: MerchantEmbedder,
  physicalGroupLabels?: readonly number[],
): Promise<{
  assignments: Assignment[];
  clusterSuggestions: Map<string, CategorySuggestion>;
}> {
  const categoryVectors = loadCategoryVectors(embedder.usesModel);

  const cleanedTexts = sources.map((s) =>
    s.kind === 'existing'
      ? s.record.cleaned_merchant ?? cleanMerchantForClustering(s.record.raw_merchant)
      : cleanMerchantForClustering(s.row.raw_merchant),
  );

  const embeddings: Float32Array[] = await Promise.all(
    cleanedTexts.map((t) => embedder.embed(t)),
  );

  let labels: number[];
  labels = resolvePhysicalGroupLabels(sources, embeddings, physicalGroupLabels);

  const byLabel = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const L = labels[i];
    let g = byLabel.get(L);
    if (!g) {
      g = [];
      byLabel.set(L, g);
    }
    g.push(i);
  }

  const kindAtIndex: ('existing' | 'new')[] = sources.map((s) =>
    s.kind === 'existing' ? 'existing' : 'new',
  );
  const previousClusterIdAtIndex: (string | undefined)[] = sources.map(
    (s) => (s.kind === 'existing' ? s.record.cluster_id : undefined),
  );

  const labelResolution = resolveClusterIdByPhysicalGroup(
    byLabel,
    kindAtIndex,
    previousClusterIdAtIndex,
  );

  const clusterSuggestions = new Map<string, CategorySuggestion>();
  for (const L of labelResolution.keys()) {
    const meta = labelResolution.get(L)!;
    const indices = byLabel.get(L)!;
    clusterSuggestions.set(
      meta.cluster_id,
      categorizeGroup(indices, cleanedTexts, embeddings, categoryVectors),
    );
  }

  const assignments: Assignment[] = sources.map((_, i) => {
    const L = labels[i];
    const indices = byLabel.get(L)!;
    const { cluster_id } = labelResolution.get(L)!;
    const inherited = inheritedCategoryForGroup(indices, sources);
    const suggestion = clusterSuggestions.get(cluster_id)!;

    if (inherited) {
      return {
        cluster_id,
        category: inherited,
        status: 'CLASSIFIED',
        suggested_category: null,
        category_confidence: 1,
        match_type: 'INHERITED',
        known_merchant: true,
        embedding: embeddings[i],
      };
    }

    if (suggestion.match_type === 'RULE') {
      return {
        cluster_id,
        category: suggestion.category,
        status: 'CLASSIFIED',
        suggested_category: suggestion.category,
        category_confidence: suggestion.confidence,
        match_type: 'RULE',
        known_merchant: true,
        embedding: embeddings[i],
      };
    }

    const pendingSuggestion = suggestion.category;
    return {
      cluster_id,
      category: 'Uncategorized',
      status: 'PENDING_REVIEW',
      suggested_category: pendingSuggestion,
      category_confidence: suggestion.confidence,
      match_type: 'ML',
      known_merchant: false,
      embedding: embeddings[i],
    };
  });

  return { assignments, clusterSuggestions };
}

function partitionParsedForClustering(
  parsed: ParsedImportRow[],
  newTransactionIds: readonly string[],
  pairedTxnIds: ReadonlySet<string>,
): { parsedClusterable: ParsedImportRow[]; newIdsClusterable: string[] } {
  const parsedClusterable: ParsedImportRow[] = [];
  const newIdsClusterable: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const nid = newTransactionIds[i];
    const row = parsed[i];
    if (nid === undefined || row === undefined) continue;
    if (pairedTxnIds.has(nid)) continue;
    parsedClusterable.push(row);
    newIdsClusterable.push(nid);
  }
  return { parsedClusterable, newIdsClusterable };
}

function sourcesClusterableFromPartition(
  existingSortedClusterable: TransactionRecord[],
  parsedClusterable: ParsedImportRow[],
  newIdsClusterable: string[],
): SourceRow[] {
  const tail: SourceRow[] = parsedClusterable.map((row, i) => {
    const id = newIdsClusterable[i];
    if (id === undefined) {
      throw new Error('sourcesClusterableFromPartition: missing id for clusterable row');
    }
    return { kind: 'new' as const, row, id };
  });
  return [
    ...existingSortedClusterable.map((record) => ({ kind: 'existing' as const, record })),
    ...tail,
  ];
}

function mergeClusterAssignmentsForPairingSkips(
  existingSorted: TransactionRecord[],
  parsed: ParsedImportRow[],
  newTransactionIds: readonly string[],
  pairedTxnIds: ReadonlySet<string>,
  innerAssignments: Assignment[],
): Assignment[] {
  const internalAssign = internalTransferAssignment();
  const out: Assignment[] = [];
  let idx = 0;
  const takeInner = (): Assignment => {
    const next = innerAssignments[idx];
    if (next === undefined) {
      throw new Error(
        'mergeClusterAssignmentsForPairingSkips: inner assignment index overflow',
      );
    }
    idx += 1;
    return next;
  };
  for (const rec of existingSorted) {
    out.push(pairedTxnIds.has(rec.id) ? internalAssign : takeInner());
  }
  for (let i = 0; i < parsed.length; i++) {
    const id = newTransactionIds[i];
    if (id === undefined) {
      throw new Error('mergeClusterAssignmentsForPairingSkips: missing new id');
    }
    out.push(pairedTxnIds.has(id) ? internalAssign : takeInner());
  }
  if (idx !== innerAssignments.length) {
    throw new Error(
      'mergeClusterAssignmentsForPairingSkips: inner assignment count mismatch',
    );
  }
  return out;
}

export async function runClusterAndCategoryPipeline(
  existing: TransactionRecord[],
  parsed: ParsedImportRow[],
  embedder: MerchantEmbedder,
  opts: ClusterPipelineOpts,
): Promise<ClusterPipelineResult> {
  if (opts.newTransactionIds.length !== parsed.length) {
    throw new Error(
      'runClusterAndCategoryPipeline: newTransactionIds length must match parsed rows',
    );
  }

  const pairedTxnIds = opts.pairedTxnIds ?? new Set<string>();

  const existingSorted = [...existing].sort(
    (a, b) => a.date - b.date || a.id.localeCompare(b.id),
  );

  const sourcesFull: SourceRow[] = [
    ...existingSorted.map((record) => ({ kind: 'existing' as const, record })),
    ...parsed.map((row, i) => {
      const id = opts.newTransactionIds[i];
      if (id === undefined) {
        throw new Error('runClusterAndCategoryPipeline: missing new transaction id');
      }
      return { kind: 'new' as const, row, id };
    }),
  ];

  const existingSortedClusterable = existingSorted.filter(
    (r) => !pairedTxnIds.has(r.id),
  );
  const { parsedClusterable, newIdsClusterable } = partitionParsedForClustering(
    parsed,
    opts.newTransactionIds,
    pairedTxnIds,
  );

  const sourcesClusterable = sourcesClusterableFromPartition(
    existingSortedClusterable,
    parsedClusterable,
    newIdsClusterable,
  );

  let clusterSuggestions: Map<string, CategorySuggestion>;
  let assignmentsFull: Assignment[];

  if (sourcesClusterable.length === 0) {
    clusterSuggestions = new Map();
    const internalAssign = internalTransferAssignment();
    assignmentsFull = sourcesFull.map(() => internalAssign);
  } else {
    const inner = await runClusterPipelineCore(
      sourcesClusterable,
      embedder,
      opts.physicalGroupLabels,
    );
    clusterSuggestions = inner.clusterSuggestions;
    assignmentsFull = mergeClusterAssignmentsForPairingSkips(
      existingSorted,
      parsed,
      opts.newTransactionIds,
      pairedTxnIds,
      inner.assignments,
    );
  }

  return {
    sources: sourcesFull,
    assignments: assignmentsFull,
    clusterSuggestions,
    existingSorted,
  };
}

/** §7.4: cluster ids present before import on some transaction but in none after. */
export function computeRetiredClusterIds(
  existing: TransactionRecord[],
  assignments: Assignment[],
): string[] {
  const before = new Set<string>();
  for (const t of existing) {
    if (t.cluster_id) before.add(t.cluster_id);
  }
  const after = new Set(assignments.map((a) => a.cluster_id));
  return [...before].filter((c) => !after.has(c));
}

export function buildNewImportInputs(
  userId: string,
  sources: SourceRow[],
  assignments: Assignment[],
  parsedLength: number,
  pairingByLegId?: Readonly<Record<string, TransferPairingAssignment>>,
): ImportTransactionInput[] {
  const nExisting = sources.length - parsedLength;
  const out: ImportTransactionInput[] = [];
  for (let i = nExisting; i < sources.length; i++) {
    const s = sources[i];
    if (s.kind !== 'new') continue;
    const a = assignments[i];
    const row = s.row;
    const pairing = pairingByLegId?.[s.id];
    out.push({
      user_id: userId,
      id: s.id,
      date: row.date,
      raw_merchant: row.raw_merchant,
      cleaned_merchant: cleanMerchantForClustering(row.raw_merchant),
      file_amount: row.file_amount,
      amount: row.canonical_amount,
      cluster_id: a.cluster_id,
      category: a.category,
      status: a.status,
      is_recurring: false,
      known_merchant: a.known_merchant,
      suggested_category: a.suggested_category,
      category_confidence: a.category_confidence,
      match_type: a.match_type,
      merchant_embedding: Array.from(a.embedding),
      ...(pairing && {
        pairing_id: pairing.pairing_id,
        pairing_source: pairing.pairing_source,
        pairing_confidence: pairing.pairing_confidence,
      }),
    });
  }
  return out;
}
