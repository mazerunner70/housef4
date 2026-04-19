import { randomUUID } from 'node:crypto';

import type { ImportTransactionInput, TransactionRecord } from '@housef4/db';

import {
  loadCategoryVectors,
  mlMatchForEmbedding,
  ruleMatchForText,
  type CategorySuggestion,
} from './categoryClassifier';
import type { ParsedImportRow } from './canonical';
import { dbscanCosine, cosineDistance } from './dbscanCosine';
import { cleanMerchantForClustering } from './merchantNormalize';
import type { MerchantEmbedder } from './merchantsEmbedder';
import { meanNormalized } from './merchantsEmbedder';
import { stableClusterIdFromCleaned } from './stableClusterId';

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

function medoidIndex(indices: number[], embeddings: Float32Array[]): number {
  let best = indices[0]!;
  let bestSum = Infinity;
  for (const i of indices) {
    let s = 0;
    for (const j of indices) {
      s += cosineDistance(embeddings[i]!, embeddings[j]!);
    }
    if (s < bestSum) {
      bestSum = s;
      best = i;
    }
  }
  return best;
}

/** DBSCAN uses -1 for all noise points; split into singleton groups for stable ids and rules. */
function splitNoiseLabels(labels: number[]): number[] {
  let noiseSeq = -1000000;
  return labels.map((L) => (L === -1 ? noiseSeq-- : L));
}

function stableIdForGroup(
  indices: number[],
  cleanedTexts: string[],
  embeddings: Float32Array[],
): string {
  if (indices.length === 1) {
    return stableClusterIdFromCleaned(cleanedTexts[indices[0]!]!);
  }
  const med = medoidIndex(indices, embeddings);
  return stableClusterIdFromCleaned(cleanedTexts[med]!);
}

function inheritedCategoryForGroup(
  indices: number[],
  sources: SourceRow[],
): string | null {
  for (const i of indices) {
    const s = sources[i]!;
    if (s.kind === 'existing' && s.record.status === 'CLASSIFIED') {
      return s.record.category;
    }
  }
  return null;
}

function categorizeGroup(
  indices: number[],
  cleanedTexts: string[],
  embeddings: Float32Array[],
  categoryVectors: Float32Array[],
): CategorySuggestion {
  if (indices.length === 1) {
    const i = indices[0]!;
    const text = cleanedTexts[i]!;
    const rule = ruleMatchForText(text);
    if (rule) return rule;
    return mlMatchForEmbedding(embeddings[i]!, categoryVectors);
  }

  for (const i of indices) {
    const rule = ruleMatchForText(cleanedTexts[i]!);
    if (rule) return rule;
  }

  const groupEmb = indices.map((i) => embeddings[i]!);
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

export async function runClusterAndCategoryPipeline(
  existing: TransactionRecord[],
  parsed: ParsedImportRow[],
  embedder: MerchantEmbedder,
): Promise<ClusterPipelineResult> {
  const categoryVectors = loadCategoryVectors(embedder.usesModel);

  const existingSorted = [...existing].sort(
    (a, b) => a.date - b.date || a.id.localeCompare(b.id),
  );

  const sources: SourceRow[] = [
    ...existingSorted.map((record) => ({ kind: 'existing' as const, record })),
    ...parsed.map((row) => ({
      kind: 'new' as const,
      row,
      id: `txn_${randomUUID().replace(/-/g, '')}`,
    })),
  ];

  const cleanedTexts = sources.map((s) =>
    s.kind === 'existing'
      ? s.record.cleaned_merchant ?? cleanMerchantForClustering(s.record.raw_merchant)
      : cleanMerchantForClustering(s.row.raw_merchant),
  );

  const embeddings: Float32Array[] = await Promise.all(
    cleanedTexts.map((t) => embedder.embed(t)),
  );

  const rawLabels =
    sources.length <= 1
      ? new Array(sources.length).fill(-1)
      : dbscanCosine(embeddings, DBSCAN_EPS, DBSCAN_MIN_SAMPLES);

  const labels = splitNoiseLabels(rawLabels);

  const byLabel = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const L = labels[i]!;
    let g = byLabel.get(L);
    if (!g) {
      g = [];
      byLabel.set(L, g);
    }
    g.push(i);
  }

  const indexToClusterId = new Map<number, string>();
  const clusterSuggestions = new Map<string, CategorySuggestion>();
  for (const [, indices] of byLabel) {
    const cid = stableIdForGroup(indices, cleanedTexts, embeddings);
    for (const i of indices) indexToClusterId.set(i, cid);
    clusterSuggestions.set(
      cid,
      categorizeGroup(indices, cleanedTexts, embeddings, categoryVectors),
    );
  }

  const assignments: Assignment[] = sources.map((_, i) => {
    const L = labels[i]!;
    const indices = byLabel.get(L)!;
    const inherited = inheritedCategoryForGroup(indices, sources);
    const cluster_id = indexToClusterId.get(i)!;
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
        embedding: embeddings[i]!,
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
        embedding: embeddings[i]!,
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
      embedding: embeddings[i]!,
    };
  });

  return { sources, assignments, clusterSuggestions, existingSorted };
}

export function buildNewImportInputs(
  userId: string,
  sources: SourceRow[],
  assignments: Assignment[],
  parsedLength: number,
): ImportTransactionInput[] {
  const nExisting = sources.length - parsedLength;
  const out: ImportTransactionInput[] = [];
  for (let i = nExisting; i < sources.length; i++) {
    const s = sources[i]!;
    if (s.kind !== 'new') continue;
    const a = assignments[i]!;
    const row = s.row;
    out.push({
      user_id: userId,
      id: s.id,
      date: row.date,
      raw_merchant: row.raw_merchant,
      cleaned_merchant: cleanMerchantForClustering(row.raw_merchant),
      amount: row.amount,
      cluster_id: a.cluster_id,
      category: a.category,
      status: a.status,
      is_recurring: false,
      known_merchant: a.known_merchant,
      suggested_category: a.suggested_category,
      category_confidence: a.category_confidence,
      match_type: a.match_type,
      merchant_embedding: Array.from(a.embedding),
    });
  }
  return out;
}
