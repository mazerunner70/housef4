/**
 * Import pipeline orchestration (HTTP import path).
 *
 * **Stage order is authoritative** relative to numbered stages in
 * `docs/03_detailed_design/import_transaction_files.md` §4.2. Step implementations
 * live in `importOrchestrationSteps.ts`.
 */

import type { FinanceRepository } from '@housef4/db';

import { getLog } from '../../requestLogContext';
import { mintImportFileId } from './planning/allocateBatchIds';
import {
  acquireImportLockForOrchestration,
  releaseImportLockBestEffort,
} from './importPersistPhase';
import {
  applyAmountNegationPolicy,
  assertNoDuplicateBlobImport,
  buildImportOrchestrationResponse,
  buildTransactionFileInput,
  parseImportAccountSelection,
  parseImportUpload,
  persistImportResult,
  resolveAccountAfterLock,
  runImportPlanningStages,
  validateImportAccountSelection,
  validateExistingAccountBeforeLock,
} from './importOrchestrationSteps';
import { resolveImportCurrency } from './resolveImportCurrency';
import type { MerchantEmbedder } from './clustering';
import type { ImportStageTracer } from './importStageTracing';
import { createImportStageTracer } from './importStageTracing';
import type { ExtractedImportUpload } from './ingress/multipartFile';
import { traceStage } from './utils/traceStage';

export type RunImportOrchestrationParams = Readonly<{
  userId: string;
  repo: FinanceRepository;
  /** Output of §4.2 stage 1 (`extractImportMultipart`). */
  extracted: ExtractedImportUpload;
  /** When omitted (e.g. unit tests), stage **1** is not traced. */
  tracer?: ImportStageTracer;
  /** Test seam — inject stub embedder at planning boundary (§4.7 Q3). */
  embedder?: MerchantEmbedder;
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
  const accountSelection = parseImportAccountSelection(extracted);

  try {
    validateImportAccountSelection(accountSelection, extracted);
    const contentSha256 = await traceStage(tracer, '2b', () =>
      assertNoDuplicateBlobImport(repo, userId, extracted.file.buffer),
    );
    await traceStage(tracer, '2', () =>
      validateExistingAccountBeforeLock(repo, userId, accountSelection),
    );
    const parsedUpload = await traceStage(tracer, '3', () => parseImportUpload(extracted));
    tracer.setContext({ rowCount: parsedUpload.rows.length });

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
      const accountId = await traceStage(tracer, '2', () =>
        resolveAccountAfterLock(repo, userId, accountSelection, extracted),
      );
      const amountNegation = await traceStage(tracer, '4', () =>
        applyAmountNegationPolicy(
          repo,
          userId,
          accountId,
          extracted,
          parsedUpload.rows,
        ),
      );
      const parsed = { ...parsedUpload, rows: amountNegation.rows };
      const importCurrency = await resolveImportCurrency(
        repo,
        userId,
        accountId,
        parsed.currency,
      );
      const plan = await runImportPlanningStages(
        userId,
        repo,
        accountId,
        { ...parsed, currency: importCurrency },
        tracer,
        params.embedder,
      );

      const transactionFileInput = buildTransactionFileInput({
        importFileId,
        accountId,
        contentSha256,
        extracted,
        parsed,
        importCurrency,
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
        importCurrency,
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
        importCurrency,
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
