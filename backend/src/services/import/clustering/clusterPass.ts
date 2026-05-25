import type { TransactionRecord } from '@housef4/db';

import type { ParsedImportRow } from '../parse/canonical';
import { map } from '../utils/lodashImport';
import {
  buildClusterSuggestionsAndHints,
  buildSourceAssignments,
  type Assignment,
} from './assignment';
import {
  resolveClusterIdByPhysicalGroup,
  type ClusterGroupResolution,
} from './clusterIdentity';
import { cleanMerchantForClustering } from './merchantNormalize';
import type { MerchantEmbedder } from './merchantsEmbedder';
import {
  groupIndicesByLabel,
  resolvePhysicalGroupLabels,
} from './labelGroups';
import type { MerchantStringMatchConfig } from './merchantStringMatch';
import type { CategorySuggestion } from './categoryClassifier';

export type SourceRow =
  | { kind: 'existing'; record: TransactionRecord }
  | { kind: 'new'; row: ParsedImportRow; id: string };

export type ClusterPassResult = Readonly<{
  assignments: Assignment[];
  clusterSuggestions: Map<string, CategorySuggestion>;
  clusterHints: Record<string, { previousCategoryId: string | null }>;
  /** Per clusterable source — DBSCAN label after noise split (replay / debug). */
  physicalGroupLabels: number[];
  /** Cleaned merchant text fed to the embedder (replay / debug). */
  cleanedTexts: string[];
  /** Minted cluster id + predecessor ids per physical group label (replay / debug). */
  labelResolution: Map<number, ClusterGroupResolution>;
}>;

/**
 * Cluster and categorize clusterable sources: clean → embed → label groups →
 * mint cluster ids → categorize → per-row assignments.
 */
export async function runClusterPass(
  sources: SourceRow[],
  embedder: MerchantEmbedder,
  opts: Readonly<{
    physicalGroupLabels?: readonly number[];
    merchantStringMatch?: MerchantStringMatchConfig;
  }> = {},
): Promise<ClusterPassResult> {
  const cleanedTexts = map(sources, (s) =>
    s.kind === 'existing'
      ? s.record.cleaned_merchant ?? cleanMerchantForClustering(s.record.raw_merchant)
      : cleanMerchantForClustering(s.row.raw_merchant),
  );

  const embeddings = await Promise.all(cleanedTexts.map((t) => embedder.embed(t)));

  const labels = resolvePhysicalGroupLabels(sources.length, embeddings, {
    physicalGroupLabels: opts.physicalGroupLabels,
    cleanedTexts,
    merchantStringMatch: opts.merchantStringMatch,
  });
  const byLabel = groupIndicesByLabel(labels);

  const kindAtIndex = map(sources, (s) =>
    s.kind === 'existing' ? ('existing' as const) : ('new' as const),
  );
  const previousClusterIdAtIndex = map(sources, (s) =>
    s.kind === 'existing' ? s.record.cluster_id : undefined,
  );

  const labelResolution = resolveClusterIdByPhysicalGroup(
    byLabel,
    kindAtIndex,
    previousClusterIdAtIndex,
  );

  const { clusterSuggestions, clusterHints } = buildClusterSuggestionsAndHints(
    byLabel,
    sources,
    cleanedTexts,
    embeddings,
    labelResolution,
    embedder.usesModel,
  );

  const assignments = buildSourceAssignments(
    sources,
    labels,
    byLabel,
    labelResolution,
    clusterSuggestions,
    embeddings,
  );

  return {
    assignments,
    clusterSuggestions,
    clusterHints,
    physicalGroupLabels: labels,
    cleanedTexts,
    labelResolution,
  };
}
