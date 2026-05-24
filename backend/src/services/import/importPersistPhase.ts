import type { FinanceRepository } from '@housef4/db';
import { ImportLockConflictError } from '@housef4/db';

import { importLockConflictHttpError } from './importLockHttp';
import type { ImportStageTracer } from './importStageTracing';
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
  tracer?: ImportStageTracer;
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
    tracer,
  } = params;

  if (tracer) {
    await tracer.run('10', () =>
      repo.persistImportPlanViaStaging(userId, {
        importFileId,
        importStartedAt,
        plan: toImportPersistPlan(plan),
        transactionFile: transactionFileInput,
        fileCurrency: importCurrency,
        importLockAlreadyHeld: true,
      }),
    );
    return;
  }

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
    tracer,
  } = params;

  try {
    const result = await (tracer?.run('10', () =>
      persistImportPlan({
        userId,
        repo,
        plan,
        importFileId,
        fileCurrency: importCurrency,
      }),
    ) ??
      persistImportPlan({
        userId,
        repo,
        plan,
        importFileId,
        fileCurrency: importCurrency,
      }));

    await (tracer?.run('11', () =>
      repo.recordTransactionFile(userId, {
        ...transactionFileInput,
        result: {
          ...result,
          existingTransactionsUpdated: plan.existingPatches.length,
          newClustersTouched: plan.summary.newClustersTouched,
        },
      }),
    ) ??
      repo.recordTransactionFile(userId, {
        ...transactionFileInput,
        result: {
          ...result,
          existingTransactionsUpdated: plan.existingPatches.length,
          newClustersTouched: plan.summary.newClustersTouched,
        },
      }));

    await (tracer?.run('12', () => repo.refreshStoredDashboardMetrics(userId)) ??
      repo.refreshStoredDashboardMetrics(userId));
  } catch (e) {
    await releaseImportLockBestEffort(repo, userId);
    throw e;
  }
  await repo.releaseImportLock(userId);
}
