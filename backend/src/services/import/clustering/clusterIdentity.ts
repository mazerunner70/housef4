import { randomUUID } from 'node:crypto';

const MINT_ATTEMPTS = 16;

/** §6.6: opaque `CL_<uuid>` scoped unique within one resolve pass. */
function mintClusterId(usedMint: Set<string>): string {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const id = `CL_${randomUUID().replaceAll('-', '')}`;
    if (!usedMint.has(id)) {
      usedMint.add(id);
      return id;
    }
  }
  throw new Error('mintClusterId: exhausted uniqueness attempts');
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

/** §6.1: distinct sorted predecessor ids from existing members (planning-only). */
export function priorClusterIdsForGroup(
  groupIndices: number[],
  kindAtIndex: ('existing' | 'new')[],
  previousClusterIdAtIndex: (string | undefined)[],
): readonly string[] {
  return [...buildPreviousIdSet(
    groupIndices,
    kindAtIndex,
    previousClusterIdAtIndex,
  )].sort((a, b) => a.localeCompare(b));
}

/**
 * §6.3: for each old cluster id C, if existing rows with C land in 2+ physical label buckets → C is part of a split.
 * Planning/diagnostic only under §6.0 remint — does not affect id assignment.
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
    const label = labelPerIndex[i];
    if (label === undefined) continue;
    let set = cToLabels.get(cid);
    if (!set) {
      set = new Set();
      cToLabels.set(cid, set);
    }
    set.add(label);
  }
  const split = new Set<string>();
  for (const [C, set] of cToLabels) {
    if (set.size > 1) split.add(C);
  }
  return split;
}

export type ClusterGroupResolution = Readonly<{
  cluster_id: string;
  /** §6.0–§6.1 planning-only; distinct sorted predecessor ids from existing members. */
  prior_cluster_ids: readonly string[];
}>;

/**
 * Resolves transactional `cluster_id` for each physical (embedding) group per
 * `import_transaction_files.md` §6.0: always mint a fresh id; never carry prior ids.
 */
export function resolveClusterIdByPhysicalGroup(
  byLabel: Map<number, number[]>,
  kindAtIndex: ('existing' | 'new')[],
  previousClusterIdAtIndex: (string | undefined)[],
): Map<number, ClusterGroupResolution> {
  const labelKeys = [...byLabel.keys()].sort((a, b) => a - b);
  const out = new Map<number, ClusterGroupResolution>();
  const usedMint = new Set<string>();

  for (const L of labelKeys) {
    const indices = byLabel.get(L);
    if (!indices) {
      throw new Error(`resolveClusterIdByPhysicalGroup: missing label ${L}`);
    }
    out.set(L, {
      cluster_id: mintClusterId(usedMint),
      prior_cluster_ids: priorClusterIdsForGroup(
        indices,
        kindAtIndex,
        previousClusterIdAtIndex,
      ),
    });
  }

  return out;
}
