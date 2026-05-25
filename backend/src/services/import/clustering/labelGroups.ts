import { groupBy } from '../utils/lodashImport';
import { dbscanCosine } from './dbscanCosine';

export const DBSCAN_EPS = 0.3;
export const DBSCAN_MIN_SAMPLES = 3;

/** DBSCAN uses -1 for all noise points; split into singleton groups for stable ids and per-row categorization. */
export function splitNoiseLabels(labels: number[]): number[] {
  let noiseSeq = -1000000;
  return labels.map((L) => (L === -1 ? noiseSeq-- : L));
}

export function resolvePhysicalGroupLabels(
  sourceCount: number,
  embeddings: Float32Array[],
  physicalGroupLabels?: readonly number[],
): number[] {
  if (physicalGroupLabels === undefined) {
    const rawLabels =
      sourceCount <= 1
        ? new Array(sourceCount).fill(-1)
        : dbscanCosine(embeddings, DBSCAN_EPS, DBSCAN_MIN_SAMPLES);
    return splitNoiseLabels(rawLabels);
  }
  if (physicalGroupLabels.length !== sourceCount) {
    throw new Error(
      'resolvePhysicalGroupLabels: physicalGroupLabels length must match clusterable sources',
    );
  }
  // Same noise-splitting as the DBSCAN path so tests can pass raw `-1` labels.
  return splitNoiseLabels([...physicalGroupLabels]);
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
