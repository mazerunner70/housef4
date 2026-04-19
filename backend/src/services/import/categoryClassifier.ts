import categoryEmbeddingsJson from './categoryEmbeddings.json';

import { cosineDistance } from './dbscanCosine';
import { hashEmbedding } from './merchantsEmbedder';
import {
  CATEGORY_LABELS_V2,
  CATEGORY_MAP_V2,
  REGEX_RULES_V2,
} from './taxonomyV2';

export type MatchType = 'RULE' | 'ML' | 'INHERITED';

export type CategorySuggestion = {
  category: string;
  confidence: number;
  match_type: MatchType;
};

const json = categoryEmbeddingsJson as {
  model: string;
  labels: string[];
  vectors: number[][];
};

function categoryDescriptionsInLabelOrder(): string[] {
  return json.labels.map((label) => CATEGORY_MAP_V2[label] ?? '');
}

/** MiniLM-aligned vectors from committed JSON (same model as ml-training export). */
export function loadCategoryVectorsMiniLm(): Float32Array[] {
  return json.vectors.map((row) => new Float32Array(row));
}

/** When merchant embeddings use the hash fallback, embed taxonomy text the same way. */
export function loadCategoryVectorsHash(): Float32Array[] {
  return categoryDescriptionsInLabelOrder().map((d) => hashEmbedding(d));
}

export function loadCategoryVectors(usesMiniLmMerchants: boolean): Float32Array[] {
  return usesMiniLmMerchants
    ? loadCategoryVectorsMiniLm()
    : loadCategoryVectorsHash();
}

export function ruleMatchForText(cleanedUpper: string): CategorySuggestion | null {
  for (const [re, category] of REGEX_RULES_V2) {
    if (re.test(cleanedUpper)) {
      return { category, confidence: 1, match_type: 'RULE' };
    }
  }
  return null;
}

export function mlMatchForEmbedding(
  embedding: Float32Array,
  categoryVectors: Float32Array[],
): CategorySuggestion {
  let bestI = 0;
  let bestSim = -1;
  for (let i = 0; i < categoryVectors.length; i++) {
    const sim = 1 - cosineDistance(embedding, categoryVectors[i]!);
    if (sim > bestSim) {
      bestSim = sim;
      bestI = i;
    }
  }
  const label = json.labels[bestI] ?? CATEGORY_LABELS_V2[bestI]!;
  return {
    category: label,
    confidence: Math.round(bestSim * 100) / 100,
    match_type: 'ML',
  };
}
