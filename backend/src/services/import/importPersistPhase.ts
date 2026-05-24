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

/** §8.7 — staging promote path (lock acquired inside repository workflow). */
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

  await mapImportLockConflict(() =>
    repo.persistImportPlanViaStaging(userId, {
      importFileId,
      importStartedAt,
      plan: toImportPersistPlan(plan),
      transactionFile: transactionFileInput,
      fileCurrency: importCurrency,
    }),
  );
}

/** §8.6 — in-place persist under `IMPORT_LOCK` (§8.5a). */
export async function persistImportInPlace(
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

  await mapImportLockConflict(() =>
    repo.acquireImportLock(userId, {
      import_file_id: importFileId,
      import_started_at: importStartedAt,
    }),
  );

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
    try {
      await repo.releaseImportLock(userId);
    } catch {
      /* best effort — lock may remain until ops / optional abort */
    }
    throw e;
  }
  await repo.releaseImportLock(userId);
}
