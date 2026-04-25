import { cosineDistance } from './dbscanCosine';
import { stableClusterIdFromCleaned } from './stableClusterId';

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

/** DBSCAN + splitNoise: each group gets a distinct label value (negative for old noise, positive for DBSCAN). */
export function buildPreviousIdSet(
  groupIndices: number[],
  kindAtIndex: ('existing' | 'new')[],
  previousClusterIdAtIndex: (string | undefined)[],
): Set<string> {
  const s = new Set<string>();
  for (const i of groupIndices) {
    if (kindAtIndex[i] !== 'existing') continue;
    const c = previousClusterIdAtIndex[i];
    if (c) s.add(c);
  }
  return s;
}

/**
 * §8.1: for each old cluster id C, if existing rows with C land in 2+ physical label buckets → C is part of a split.
 */
export function findSplitClusterIds(
  labelPerIndex: number[],
  kindAtIndex: ('existing' | 'new')[],
  previousClusterIdAtIndex: (string | undefined)[],
): Set<string> {
  const cToLabels = new Map<string, Set<number>>();
  for (let i = 0; i < kindAtIndex.length; i++) {
    if (kindAtIndex[i] !== 'existing') continue;
    const cid = previousClusterIdAtIndex[i];
    if (!cid) continue;
    const L = labelPerIndex[i]!;
    let set = cToLabels.get(cid);
    if (!set) {
      set = new Set();
      cToLabels.set(cid, set);
    }
    set.add(L);
  }
  const split = new Set<string>();
  for (const [C, set] of cToLabels) {
    if (set.size > 1) split.add(C);
  }
  return split;
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

/**
 * Resolves a stable logical `cluster_id` for each physical (embedding) group per
 * `import_transaction_files.md` §5 / §8.
 */
export function resolveClusterIdByPhysicalGroup(
  byLabel: Map<number, number[]>,
  kindAtIndex: ('existing' | 'new')[],
  previousClusterIdAtIndex: (string | undefined)[],
  splitClusterIds: Set<string>,
  cleanedTexts: string[],
  embeddings: Float32Array[],
): Map<number, { cluster_id: string; conserve: boolean }> {
  const labelKeys = [...byLabel.keys()].sort((a, b) => a - b);
  const out = new Map<number, { cluster_id: string; conserve: boolean }>();
  const usedMint = new Set<string>();
  let mintSeq = 0;

  const mint = (L: number, indices: number[]): string => {
    for (;;) {
      const base = stableIdForGroup(indices, cleanedTexts, embeddings);
      const h = stableClusterIdFromCleaned(
        `${base}::L${L}::M${mintSeq++}`,
      );
      if (!usedMint.has(h)) {
        usedMint.add(h);
        return h;
      }
    }
  };

  for (const L of labelKeys) {
    const indices = byLabel.get(L)!;
    const previous = buildPreviousIdSet(
      indices,
      kindAtIndex,
      previousClusterIdAtIndex,
    );

    if (previous.size > 1) {
      out.set(L, { cluster_id: mint(L, indices), conserve: false });
      continue;
    }
    if (previous.size === 1) {
      const C = [...previous][0]!;
      if (splitClusterIds.has(C)) {
        out.set(L, { cluster_id: mint(L, indices), conserve: false });
      } else {
        out.set(L, { cluster_id: C, conserve: true });
      }
      continue;
    }
    // New-only: always mint a fresh id
    out.set(L, { cluster_id: mint(L, indices), conserve: false });
  }

  return out;
}
