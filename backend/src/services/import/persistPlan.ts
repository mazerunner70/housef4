/**
 * §4.2 stage 9–10 — planning output shape and fixed-order Dynamo writes.
 *
 * Write order is mandatory (`import_transaction_files.md` §8.1, §8.6.2):
 * `patchExistingTransactionsAfterImport` → `ingestImportBatch` → `retireClusterAggregates`.
 */

import type {
  ExistingTransactionPatch,
  FinanceRepository,
  ImportIngestResult,
  ImportPersistPlan,
  ImportTransactionInput,
} from '@housef4/db';

/** In-memory outcome of import planning (stages 7–9) before any stage-10 writes. */
export type PersistPlan = Readonly<{
  toInsert: ImportTransactionInput[];
  existingPatches: ExistingTransactionPatch[];
  /** CLUSTER# rows to remove after write-back; see `import_transaction_files.md` §8.4. */
  retiredClusterIds: string[];
  summary: Readonly<{
    importRowCount: number;
    knownMerchants: number;
    unknownMerchants: number;
    newClustersTouched: number;
  }>;
}>;

/** Subset passed to `FinanceRepository.persistImportPlanViaStaging` (§8.7). */
export function toImportPersistPlan(plan: PersistPlan): ImportPersistPlan {
  return {
    toInsert: plan.toInsert,
    existingPatches: plan.existingPatches,
    retiredClusterIds: plan.retiredClusterIds,
  };
}

export type PersistImportPlanParams = Readonly<{
  userId: string;
  repo: FinanceRepository;
  plan: PersistPlan;
  importFileId: string;
  fileCurrency?: string;
}>;

/**
 * §4.2 stage 10 (legacy / in-place path, §8.6): apply planning output to the primary table.
 *
 * Does **not** record `TRANSACTION_FILE` or refresh metrics — orchestration runs stages 11–12.
 */
export async function persistImportPlan(
  params: PersistImportPlanParams,
): Promise<ImportIngestResult> {
  const { userId, repo, plan, importFileId, fileCurrency } = params;

  await repo.patchExistingTransactionsAfterImport(userId, plan.existingPatches);
  const result = await repo.ingestImportBatch(
    userId,
    plan.toInsert,
    importFileId,
    fileCurrency,
  );
  await repo.retireClusterAggregates(userId, plan.retiredClusterIds);

  return result;
}
