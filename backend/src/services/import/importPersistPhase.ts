import type { FinanceRepository } from '@housef4/db';
import { ImportLockConflictError } from '@housef4/db';

import {
  attachImportBlobAndRecordFile,
  attachImportBlobViaPatch,
} from './importBlobPersist';
import { getImportBlobStore } from './importBlobStore';
import { importLockConflictHttpError } from './importLockHttp';
import type { ImportStageTracer } from './importStageTracing';
import { persistImportPlan, toImportPersistPlan, type PersistPlan } from './persistPlan';
import type { ExtractedImportUpload } from './ingress/multipartFile';

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
  extracted: ExtractedImportUpload;
  contentSha256: string;
  accountId: string;
  tracer?: ImportStageTracer;
}>;

function importBlobPutContext(params: PersistImportPhaseParams) {
  return {
    userId: params.userId,
    store: getImportBlobStore(),
    extracted: params.extracted,
    contentSha256: params.contentSha256,
    importFileId: params.importFileId,
    accountId: params.accountId,
  };
}

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

  const afterPromote = async () => {
    const patchBlob = () =>
      attachImportBlobViaPatch({
        repo,
        ...importBlobPutContext(params),
      });
    if (tracer) {
      await tracer.run('11', patchBlob);
    } else {
      await patchBlob();
    }
  };

  const runStaging = () =>
    repo.persistImportPlanViaStaging(userId, {
      importFileId,
      importStartedAt,
      plan: toImportPersistPlan(plan),
      transactionFile: transactionFileInput,
      fileCurrency: importCurrency,
      importLockAlreadyHeld: true,
      afterPromote,
    });

  if (tracer) {
    await tracer.run('10', runStaging);
  } else {
    await runStaging();
  }
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
      attachImportBlobAndRecordFile({
        repo,
        ...importBlobPutContext(params),
        transactionFileInput: {
          ...transactionFileInput,
          result: {
            ...result,
            existingTransactionsUpdated: plan.existingPatches.length,
            newClustersTouched: plan.summary.newClustersTouched,
          },
        },
      }),
    ) ??
      attachImportBlobAndRecordFile({
        repo,
        ...importBlobPutContext(params),
        transactionFileInput: {
          ...transactionFileInput,
          result: {
            ...result,
            existingTransactionsUpdated: plan.existingPatches.length,
            newClustersTouched: plan.summary.newClustersTouched,
          },
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
