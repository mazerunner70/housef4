/**
 * Import pipeline orchestration (HTTP import path).
 *
 * **Stage order is authoritative** relative to numbered stages in
 * `docs/03_detailed_design/import_transaction_files.md` §4.2. Step implementations
 * live in `importOrchestrationSteps.ts`.
 */

import type { FinanceRepository } from '@housef4/db';

import { getLog } from '../../requestLogContext';
import { mintImportFileId } from './allocateBatchIds';
import {
  acquireImportLockForOrchestration,
  releaseImportLockBestEffort,
} from './importPersistPhase';
import {
  applyAmountNegationPolicy,
  assertNoDuplicateBlobImport,
  buildImportOrchestrationResponse,
  buildTransactionFileInput,
  parseAccountSelector,
  parseImportUpload,
  persistImportResult,
  resolveAccountAfterLock,
  runImportPlanningStages,
  validateAccountSelector,
  validateExistingAccountBeforeLock,
} from './importOrchestrationSteps';
import type { ImportStageTracer } from './importStageTracing';
import { createImportStageTracer } from './importStageTracing';
import type { ExtractedImportUpload } from './multipartFile';

export type RunImportOrchestrationParams = Readonly<{
  userId: string;
  repo: FinanceRepository;
  /** Output of §4.2 stage 1 (`extractImportMultipart`). */
  extracted: ExtractedImportUpload;
  /** When omitted (e.g. unit tests), stage **1** is not traced. */
  tracer?: ImportStageTracer;
}>;

/**
 * Executes §4.2 stages **2–12**: resolve account → … → persist → file row → metrics.
 *
 * Ingress (multipart extraction, §4.2 stage **1**) remains in the HTTP handler
 * so size-limit and empty-body failures map cleanly to HTTP status payloads.
 */
export async function executeImportOrchestration(
  params: RunImportOrchestrationParams,
): Promise<Record<string, unknown>> {
  const { userId, repo, extracted } = params;
  const tracer = params.tracer ?? createImportStageTracer({ userId });
  const log = getLog();
  const selector = parseAccountSelector(extracted);

  try {
    validateAccountSelector(selector);
    const contentSha256 = await tracer.run('2b', () =>
      assertNoDuplicateBlobImport(repo, userId, extracted.file.buffer),
    );
    await tracer.run('2', () =>
      validateExistingAccountBeforeLock(repo, userId, selector),
    );
    const parsed = await tracer.run('3', async () => parseImportUpload(extracted));
    tracer.setContext({ rowCount: parsed.rows.length });

    const importFileId = mintImportFileId();
    const importStartedAt = Date.now();
    tracer.setContext({
      importFileId,
      staging: repo.isImportStagingEnabled(),
    });

    await acquireImportLockForOrchestration(repo, userId, {
      import_file_id: importFileId,
      import_started_at: importStartedAt,
    });

    let persistStarted = false;
    try {
      const accountId = await tracer.run('2', () =>
        resolveAccountAfterLock(repo, userId, selector),
      );
      const amountNegation = await tracer.run('4', () =>
        applyAmountNegationPolicy(
          repo,
          userId,
          accountId,
          extracted,
          parsed.rows,
        ),
      );
      const plan = await runImportPlanningStages(
        userId,
        repo,
        accountId,
        parsed,
        tracer,
      );

      const transactionFileInput = buildTransactionFileInput({
        importFileId,
        accountId,
        contentSha256,
        extracted,
        parsed,
        amountNegated: amountNegation.applied,
        importStartedAt,
        importCompletedAt: Date.now(),
        plan,
      });

      persistStarted = true;
      await persistImportResult({
        repo,
        userId,
        plan,
        importFileId,
        importStartedAt,
        importCurrency: parsed.currency,
        transactionFileInput,
        extracted,
        contentSha256,
        accountId,
        tracer,
      });

      log.info('import.complete', {
        importFileId,
        rowCount: plan.summary.importRowCount,
        format: parsed.format,
        fileBytes: extracted.file.buffer.length,
        existingTransactionsUpdated: plan.existingPatches.length,
        newClustersTouched: plan.summary.newClustersTouched,
        retiredClusterCount: plan.retiredClusterIds.length,
        staging: repo.isImportStagingEnabled(),
      });

      tracer.emitSummary('ok');
      return buildImportOrchestrationResponse({
        plan,
        importFileId,
        parsed,
        amountNegation,
      });
    } catch (e) {
      if (!persistStarted) {
        await releaseImportLockBestEffort(repo, userId);
      }
      throw e;
    }
  } catch (e) {
    tracer.emitSummary('error');
    throw e;
  }
}
