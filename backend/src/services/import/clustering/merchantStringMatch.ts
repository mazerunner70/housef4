export type MerchantStringMatchMode = 'off' | 'exact' | 'levenshtein';

export type MerchantStringMatchConfig = Readonly<{
  mode: MerchantStringMatchMode;
  /** Max edit distance when `mode` is `levenshtein` (ignored for `exact`). */
  maxDistance: number;
}>;

export const DEFAULT_MERCHANT_STRING_MATCH: MerchantStringMatchConfig = {
  mode: 'exact',
  maxDistance: 2,
};

/** Env: `HOUSEF4_MERCHANT_STRING_MATCH` = `off` | `exact` | `levenshtein` (default `exact`). */
export function loadMerchantStringMatchConfig(): MerchantStringMatchConfig {
  const raw = process.env.HOUSEF4_MERCHANT_STRING_MATCH?.trim().toLowerCase();
  let mode: MerchantStringMatchMode = 'exact';
  if (raw === 'off' || raw === 'levenshtein') {
    mode = raw;
  }

  const parsed = Number.parseInt(
    process.env.HOUSEF4_MERCHANT_STRING_MATCH_MAX_DISTANCE ?? '2',
    10,
  );
  const maxDistance = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;

  return { mode, maxDistance };
}

/** Levenshtein edit distance (classic DP, O(mn)). */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

export function merchantsMatch(
  a: string,
  b: string,
  config: MerchantStringMatchConfig,
): boolean {
  if (config.mode === 'off') return false;
  if (a === b) return true;
  if (config.mode === 'exact') return false;
  return levenshteinDistance(a, b) <= config.maxDistance;
}

/**
 * Union physical group labels when `cleaned_merchant` strings match under `config`.
 * Runs after DBSCAN + noise split so identical cleaned names share one group.
 */
export function mergeLabelsByCleanedMerchant(
  labels: readonly number[],
  cleanedTexts: readonly string[],
  config: MerchantStringMatchConfig,
): number[] {
  if (config.mode === 'off' || labels.length === 0) {
    return [...labels];
  }
  if (labels.length !== cleanedTexts.length) {
    throw new Error(
      'mergeLabelsByCleanedMerchant: labels and cleanedTexts length mismatch',
    );
  }

  const n = labels.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    let curr = i;
    while (parent[curr] !== curr) {
      const next = parent[curr]!;
      parent[curr] = root;
      curr = next;
    }
    return root;
  };

  const union = (i: number, j: number): void => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < n; i++) {
    const ai = cleanedTexts[i] ?? '';
    for (let j = i + 1; j < n; j++) {
      if (merchantsMatch(ai, cleanedTexts[j] ?? '', config)) {
        union(i, j);
      }
    }
  }

  const rootToCanonical = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const label = labels[i]!;
    const prev = rootToCanonical.get(root);
    if (prev === undefined || label < prev) {
      rootToCanonical.set(root, label);
    }
  }

  return labels.map((_, i) => rootToCanonical.get(find(i))!);
}
