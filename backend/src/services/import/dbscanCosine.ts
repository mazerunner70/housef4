/**
 * DBSCAN with cosine distance d = 1 - cos(u,v) on L2-normalized vectors
 * (matches sklearn `metric='cosine'` with eps / min_samples semantics).
 */

export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]!;
  const sim = Math.min(1, Math.max(-1, dot));
  return 1 - sim;
}

const UNDEFINED = -2;
const NOISE = -1;

function regionQuery(dist: number[][], p: number, eps: number): number[] {
  const n = dist.length;
  const out: number[] = [];
  for (let q = 0; q < n; q++) {
    if (dist[p]![q]! <= eps) out.push(q);
  }
  return out;
}

/**
 * @param embeddings — L2-normalized rows
 * @param eps — sklearn cosine DBSCAN epsilon (distance upper bound)
 * @param minSamples — minPts
 * @returns label per row: -1 noise, else 0..k-1
 */
export function dbscanCosine(
  embeddings: Float32Array[],
  eps: number,
  minSamples: number,
): number[] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [NOISE];

  const dist: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = cosineDistance(embeddings[i]!, embeddings[j]!);
      dist[i]![j] = d;
      dist[j]![i] = d;
    }
  }

  const labels = new Array<number>(n).fill(UNDEFINED);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNDEFINED) continue;
    const neighbors = regionQuery(dist, i, eps);
    if (neighbors.length < minSamples) {
      labels[i] = NOISE;
      continue;
    }
    labels[i] = clusterId;
    const seed = neighbors.filter((j) => j !== i);
    let s = 0;
    while (s < seed.length) {
      const q = seed[s]!;
      s += 1;
      if (labels[q] === NOISE) labels[q] = clusterId;
      if (labels[q] !== UNDEFINED) continue;
      labels[q] = clusterId;
      const qNeighbors = regionQuery(dist, q, eps);
      if (qNeighbors.length >= minSamples) {
        for (const o of qNeighbors) {
          if (!seed.includes(o)) seed.push(o);
        }
      }
    }
    clusterId += 1;
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] === UNDEFINED) labels[i] = NOISE;
  }

  return labels;
}
