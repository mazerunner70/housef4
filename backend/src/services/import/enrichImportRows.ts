import type {
  ExistingTransactionPatch,
  FinanceRepository,
  ImportTransactionInput,
  TransactionRecord,
} from '@housef4/db';

import type { ParsedImportRow } from './canonical';
import {
  buildNewImportInputs,
  runClusterAndCategoryPipeline,
  type Assignment,
} from './clusterPipeline';
import { createMerchantEmbedder } from './merchantsEmbedder';
import { cleanMerchantForClustering } from './merchantNormalize';

function embeddingsNearEqual(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-4) return false;
  }
  return true;
}

function buildExistingPatches(
  existingSorted: TransactionRecord[],
  assignments: Assignment[],
): ExistingTransactionPatch[] {
  const patches: ExistingTransactionPatch[] = [];
  for (let i = 0; i < existingSorted.length; i++) {
    const old = existingSorted[i]!;
    const a = assignments[i]!;
    const cleaned =
      old.cleaned_merchant ?? cleanMerchantForClustering(old.raw_merchant);
    const emb = Array.from(a.embedding);
    if (
      old.cluster_id === a.cluster_id &&
      old.category === a.category &&
      old.status === a.status &&
      embeddingsNearEqual(old.merchant_embedding, emb)
    ) {
      continue;
    }
    patches.push({
      id: old.id,
      cluster_id: a.cluster_id,
      category: a.category,
      status: a.status,
      cleaned_merchant: cleaned,
      merchant_embedding: emb,
      suggested_category: a.suggested_category,
      category_confidence: a.category_confidence,
      match_type: a.match_type,
    });
  }
  return patches;
}

export type EnrichImportResult = {
  toInsert: ImportTransactionInput[];
  existingPatches: ExistingTransactionPatch[];
  summary: {
    importRowCount: number;
    knownMerchants: number;
    unknownMerchants: number;
    newClustersTouched: number;
  };
};

export async function enrichImportRows(
  userId: string,
  parsed: ParsedImportRow[],
  repo: FinanceRepository,
): Promise<EnrichImportResult> {
  if (parsed.length === 0) {
    return {
      toInsert: [],
      existingPatches: [],
      summary: {
        importRowCount: 0,
        knownMerchants: 0,
        unknownMerchants: 0,
        newClustersTouched: 0,
      },
    };
  }

  const existing = await repo.listTransactions(userId);
  const embedder = await createMerchantEmbedder();
  const { sources, assignments, existingSorted } =
    await runClusterAndCategoryPipeline(existing, parsed, embedder);

  const existingPatches = buildExistingPatches(existingSorted, assignments);

  const toInsert = buildNewImportInputs(
    userId,
    sources,
    assignments,
    parsed.length,
  );

  let knownMerchants = 0;
  let unknownMerchants = 0;
  for (const r of toInsert) {
    if (r.known_merchant) knownMerchants += 1;
    else unknownMerchants += 1;
  }

  const newClustersTouched = new Set(toInsert.map((r) => r.cluster_id)).size;

  return {
    toInsert,
    existingPatches,
    summary: {
      importRowCount: parsed.length,
      knownMerchants,
      unknownMerchants,
      newClustersTouched,
    },
  };
}
