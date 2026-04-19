import { createHash } from 'node:crypto';

import { cosineDistance } from './dbscanCosine';

export type MerchantEmbedder = {
  embed(text: string): Promise<Float32Array>;
  readonly usesModel: boolean;
};

function l2Normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

/** Deterministic pseudo-embedding for tests / environments without the model. */
export function hashEmbedding(text: string, dim = 384): Float32Array {
  const v = new Float32Array(dim);
  let h = createHash('sha256').update(text).digest();
  for (let off = 0; off < dim; off++) {
    const i = off % 32;
    if (i === 0 && off > 0) {
      h = createHash('sha256').update(h).update(String(off)).digest();
    }
    v[off] = (h[i]! / 255) * 2 - 1;
  }
  return l2Normalize(v);
}

let xenovaExtractor: ((text: string) => Promise<{ data: Float32Array }>) | null =
  null;
let xenovaLoadFailed = false;

async function getXenovaExtractor(): Promise<
  ((text: string) => Promise<{ data: Float32Array }>) | null
> {
  if (xenovaLoadFailed) return null;
  if (xenovaExtractor) return xenovaExtractor;
  if (process.env.HOUSEF4_IMPORT_EMBEDDINGS === 'hash') {
    xenovaLoadFailed = true;
    return null;
  }
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    const pipe = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    );
    xenovaExtractor = async (text: string) => {
      const out = await pipe(text, { pooling: 'mean', normalize: true });
      return { data: out.data as Float32Array };
    };
    return xenovaExtractor;
  } catch {
    xenovaLoadFailed = true;
    return null;
  }
}

export async function createMerchantEmbedder(): Promise<MerchantEmbedder> {
  const ext = await getXenovaExtractor();
  if (ext) {
    return {
      usesModel: true,
      embed: async (text: string) => {
        const { data } = await ext(text);
        return new Float32Array(data);
      },
    };
  }
  return {
    usesModel: false,
    embed: async (text: string) => hashEmbedding(text),
  };
}

/** Mean of normalized vectors, then L2-normalize (cluster centroid for cosine). */
export function meanNormalized(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(384);
  const dim = embeddings[0]!.length;
  const acc = new Float32Array(dim);
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) acc[i] += e[i]!;
  }
  for (let i = 0; i < dim; i++) acc[i] /= embeddings.length;
  let s = 0;
  for (let i = 0; i < dim; i++) s += acc[i]! * acc[i]!;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = acc[i]! / n;
  return out;
}

export function bestCategoryByCentroid(
  centroid: Float32Array,
  categoryVectors: Float32Array[],
): { index: number; confidence: number } {
  let bestI = 0;
  let bestSim = -1;
  for (let i = 0; i < categoryVectors.length; i++) {
    const sim = 1 - cosineDistance(centroid, categoryVectors[i]!);
    if (sim > bestSim) {
      bestSim = sim;
      bestI = i;
    }
  }
  return { index: bestI, confidence: Math.round(bestSim * 100) / 100 };
}
