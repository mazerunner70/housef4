import { groupBy } from '../utils/lodashImport';
import { dbscanCosine } from './dbscanCosine';
import {
  DEFAULT_MERCHANT_STRING_MATCH,
  mergeLabelsByCleanedMerchant,
  type MerchantStringMatchConfig,
} from './merchantStringMatch';

export const DBSCAN_EPS = 0.3;
export const DBSCAN_MIN_SAMPLES = 3;

export type ResolvePhysicalGroupLabelsOpts = Readonly<{
  physicalGroupLabels?: readonly number[];
  cleanedTexts?: readonly string[];
  merchantStringMatch?: MerchantStringMatchConfig;
}>;

/** DBSCAN uses -1 for all noise points; split into singleton groups for stable ids and per-row categorization. */
export function splitNoiseLabels(labels: number[]): number[] {
  let noiseSeq = -1000000;
  return labels.map((L) => (L === -1 ? noiseSeq-- : L));
}

export function resolvePhysicalGroupLabels(
  sourceCount: number,
  embeddings: Float32Array[],
  opts: ResolvePhysicalGroupLabelsOpts = {},
): number[] {
  const stringMatch = opts.merchantStringMatch ?? DEFAULT_MERCHANT_STRING_MATCH;
  let labels: number[];

  if (opts.physicalGroupLabels === undefined) {
    const rawLabels =
      sourceCount <= 1
        ? new Array(sourceCount).fill(-1)
        : dbscanCosine(embeddings, DBSCAN_EPS, DBSCAN_MIN_SAMPLES);
    labels = splitNoiseLabels(rawLabels);
  } else {
    if (opts.physicalGroupLabels.length !== sourceCount) {
      throw new Error(
        'resolvePhysicalGroupLabels: physicalGroupLabels length must match clusterable sources',
      );
    }
    // Same noise-splitting as the DBSCAN path so tests can pass raw `-1` labels.
    labels = splitNoiseLabels([...opts.physicalGroupLabels]);
  }

  if (stringMatch.mode === 'off' || opts.cleanedTexts === undefined) {
    return labels;
  }
  if (opts.cleanedTexts.length !== sourceCount) {
    throw new Error(
      'resolvePhysicalGroupLabels: cleanedTexts length must match clusterable sources',
    );
  }
  return mergeLabelsByCleanedMerchant(labels, opts.cleanedTexts, stringMatch);
}

/** Group source indices by physical (DBSCAN) label using lodash `groupBy`. */
export function groupIndicesByLabel(labels: readonly number[]): Map<number, number[]> {
  const indices = labels.map((_, i) => i);
  const grouped = groupBy(indices, (i) => labels[i]);
  const out = new Map<number, number[]>();
  for (const [key, value] of Object.entries(grouped)) {
    out.set(Number(key), value);
  }
  return out;
}
