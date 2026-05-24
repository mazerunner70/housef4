import type { FinanceRepository } from '@housef4/db';
import { ImportLockConflictError } from '@housef4/db';

import { importLockConflictHttpError } from './importLockHttp';
import { persistImportPlan, toImportPersistPlan, type PersistPlan } from './persistPlan';

type TransactionFileInput = Parameters<
  FinanceRepository['recordTransactionFile']
>[1];

type PersistImportPhaseParams = Readonly<{
  userId: string;
  repo: FinanceRepository;
  plan: PersistPlan;
  importFileId: string;
  importStartedAt: number;
  importCurrency?: string;
  transactionFileInput: TransactionFileInput;
}>;

async function mapImportLockConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ImportLockConflictError) {
      throw importLockConflictHttpError(e);
    }
    throw e;
  }
}

/** Acquire `IMPORT_LOCK` before primary writes and corpus reads (orchestration §8.5a). */
export async function acquireImportLockForOrchestration(
  repo: FinanceRepository,
  userId: string,
  input: { import_file_id: string; import_started_at: number },
): Promise<void> {
  await mapImportLockConflict(() => repo.acquireImportLock(userId, input));
}

export async function releaseImportLockBestEffort(
  repo: FinanceRepository,
  userId: string,
): Promise<void> {
  try {
    await repo.releaseImportLock(userId);
  } catch {
    /* best effort — lock may remain until ops / optional abort */
  }
}

/** §8.7 — staging promote path (`IMPORT_LOCK` already held by orchestration). */
export async function persistImportViaStaging(
  params: PersistImportPhaseParams,
): Promise<void> {
  const {
    userId,
    repo,
    plan,
    importFileId,
    importStartedAt,
    importCurrency,
    transactionFileInput,
  } = params;

  await repo.persistImportPlanViaStaging(userId, {
    importFileId,
    importStartedAt,
    plan: toImportPersistPlan(plan),
    transactionFile: transactionFileInput,
    fileCurrency: importCurrency,
    importLockAlreadyHeld: true,
  });
}

/** §8.6 — in-place persist (`IMPORT_LOCK` already held by orchestration). */
export async function persistImportInPlace(
  params: PersistImportPhaseParams,
): Promise<void> {
  const {
    userId,
    repo,
    plan,
    importFileId,
    importCurrency,
    transactionFileInput,
  } = params;

  try {
    const result = await persistImportPlan({
      userId,
      repo,
      plan,
      importFileId,
      fileCurrency: importCurrency,
    });

    await repo.recordTransactionFile(userId, {
      ...transactionFileInput,
      result: {
        ...result,
        existingTransactionsUpdated: plan.existingPatches.length,
        newClustersTouched: plan.summary.newClustersTouched,
      },
    });

    await repo.refreshStoredDashboardMetrics(userId);
  } catch (e) {
    await releaseImportLockBestEffort(repo, userId);
    throw e;
  }
  await repo.releaseImportLock(userId);
}
