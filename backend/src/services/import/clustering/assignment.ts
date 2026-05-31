import type { ImportTransactionInput, TransferPairingAssignment } from '@housef4/db';

import {
  countBy,
  filter,
  map,
  maxBy,
  sortBy,
  toPairs,
} from '../utils/lodashImport';
import {
  loadCategoryVectors,
  mlMatchForEmbedding,
  ruleMatchForText,
  type CategorySuggestion,
} from './categoryClassifier';
import type { SourceRow } from './clusterPass';
import { cleanMerchantForClustering } from './merchantNormalize';
import { parsedRowAmounts } from '../parse/parsedRowAmounts';
import { hashEmbedding, meanNormalized } from './merchantsEmbedder';

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

/**
 * §7 — unanimous prior transactional `category` among **existing** members only.
 * Returns `null` when no existing members, categories disagree, or any category is empty.
 */
export function unanimousPriorCategoryForGroup(
  indices: number[],
  sources: SourceRow[],
): string | null {
  let consensus: string | null = null;
  let sawExisting = false;
  for (const i of indices) {
    const s = sources[i];
    if (s.kind !== 'existing') continue;
    sawExisting = true;
    const c = s.record.category.trim();
    if (!c) return null;
    if (consensus === null) {
      consensus = c;
    } else if (consensus !== c) {
      return null;
    }
  }
  return sawExisting ? consensus : null;
}

/**
 * Pick the **plurality** category among existing `CLASSIFIED` rows in the physical group
 * (§7). If a user (or data drift) left conflicting categories on the same group, the
 * majority wins; ties break lexicographically for stability.
 */
export function inheritedCategoryForGroup(
  indices: number[],
  sources: SourceRow[],
): string | null {
  const classifiedExisting = filter(
    map(indices, (i) => sources[i]),
    (s): s is Extract<SourceRow, { kind: 'existing' }> =>
      s.kind === 'existing' && s.record.status === 'CLASSIFIED',
  );
  if (classifiedExisting.length === 0) return null;

  const pairs = toPairs(countBy(classifiedExisting, (s) => s.record.category));
  const topCount = maxBy(pairs, ([, count]) => count)?.[1];
  if (topCount === undefined) return null;

  const tied = filter(pairs, ([, count]) => count === topCount);
  const [winner] = sortBy(tied, ([category]) => category);
  return winner?.[0] ?? null;
}

export function categorizeGroup(
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

export function buildClusterSuggestionsAndHints(
  byLabel: Map<number, number[]>,
  sources: SourceRow[],
  cleanedTexts: string[],
  embeddings: Float32Array[],
  labelResolution: Map<number, { cluster_id: string }>,
  usesModel: boolean,
): {
  clusterSuggestions: Map<string, CategorySuggestion>;
  clusterHints: Record<string, { previousCategoryId: string | null }>;
} {
  const categoryVectors = loadCategoryVectors(usesModel);
  const clusterSuggestions = new Map<string, CategorySuggestion>();
  const clusterHints: Record<string, { previousCategoryId: string | null }> = {};

  for (const [L, indices] of byLabel) {
    const meta = labelResolution.get(L);
    if (!meta) {
      throw new Error(`buildClusterSuggestionsAndHints: missing label resolution for ${L}`);
    }
    clusterSuggestions.set(
      meta.cluster_id,
      categorizeGroup(indices, cleanedTexts, embeddings, categoryVectors),
    );
    clusterHints[meta.cluster_id] = {
      previousCategoryId: unanimousPriorCategoryForGroup(indices, sources),
    };
  }

  return { clusterSuggestions, clusterHints };
}

export function buildSourceAssignments(
  sources: SourceRow[],
  labels: number[],
  byLabel: Map<number, number[]>,
  labelResolution: Map<number, { cluster_id: string }>,
  clusterSuggestions: Map<string, CategorySuggestion>,
  embeddings: Float32Array[],
): Assignment[] {
  return map(sources, (_, i) => {
    const L = labels[i];
    const indices = byLabel.get(L);
    if (!indices) {
      throw new Error(`buildSourceAssignments: missing label ${L}`);
    }
    const meta = labelResolution.get(L);
    if (!meta) {
      throw new Error(`buildSourceAssignments: missing label resolution for ${L}`);
    }
    const { cluster_id } = meta;
    const inherited = inheritedCategoryForGroup(indices, sources);
    const suggestion = clusterSuggestions.get(cluster_id);
    if (!suggestion) {
      throw new Error(`buildSourceAssignments: missing suggestion for cluster ${cluster_id}`);
    }

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
}

export function buildNewImportInputs(
  userId: string,
  sources: SourceRow[],
  assignments: Assignment[],
  parsedLength: number,
  importCurrency: string,
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
    const amounts = parsedRowAmounts(row, importCurrency);
    out.push({
      user_id: userId,
      id: s.id,
      date: row.date,
      raw_merchant: row.raw_merchant,
      cleaned_merchant: cleanMerchantForClustering(row.raw_merchant),
      canonicalAmount: amounts.canonicalAmount,
      fileAmount: amounts.fileAmount,
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
