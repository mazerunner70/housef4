/**
 * Import pipeline orchestration (HTTP import path).
 *
 * **Stage order is authoritative** relative to numbered stages in
 * `docs/03_detailed_design/import_transaction_files.md` §4.2. Stages 6–9 are
 * Stage 5 (`allocateBatchArtefactIds`) and stage 6 (`buildLedgerSnapshot`) are explicit;
 * stages 7–9 are `runImportPlanning` (returns `PersistPlan`); stage 10 is `persistImportPlan`.
 */

import type { FinanceRepository } from '@housef4/db';

import { HttpError } from '../../httpError';
import { getLog } from '../../requestLogContext';
import {
  parseNegateAmountsField,
  resolveAmountNegation,
  suggestNegateFromInterest,
  suggestNegateFromPriorImport,
} from './amountNegation';
import { allocateBatchArtefactIds } from './allocateBatchIds';
import { applyImportAmountNegation } from './canonical';
import { computeImportBlobContentSha256 } from './blobFingerprint';
import {
  persistImportInPlace,
  persistImportViaStaging,
} from './importPersistPhase';
import { runImportPlanning } from './runImportPlanning';
import { buildLedgerSnapshot } from './ledgerSnapshot';
import type { ExtractedImportUpload } from './multipartFile';
import { parseImportBuffer } from './parseImportBuffer';

export type RunImportOrchestrationParams = Readonly<{
  userId: string;
  repo: FinanceRepository;
  /** Output of §4.2 stage 1 (`extractImportMultipart`). */
  extracted: ExtractedImportUpload;
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
  const log = getLog();

  // --- Stage 2: Resolve account — create new account or validate existing (`FinanceRepository`). ---
  const newName = extracted.newAccountName.trim();
  const existingId = extracted.accountId.trim();
  let accountId: string;
  if (newName.length > 0) {
    const created = await repo.createAccount(userId, newName);
    accountId = created.id;
  } else if (existingId.length > 0) {
    const acc = await repo.getAccount(userId, existingId);
    if (!acc) {
      throw new HttpError(400, 'Unknown account_id');
    }
    accountId = acc.id;
  } else {
    throw new HttpError(
      400,
      'Provide new_account_name or a valid account_id for this import',
    );
  }

  // --- Stage 2b: Duplicate blob guard — fingerprint raw multipart `file` bytes (§11.2.1). ---
  const contentSha256 = computeImportBlobContentSha256(extracted.file.buffer);
  const duplicate = await repo.findDuplicateBlobImport(userId, contentSha256);
  if (duplicate) {
    throw new HttpError(409, 'Import file contents already uploaded', {
      error: 'duplicate_blob',
      message:
        'This exact file was already imported. Check import history for details.',
      existingImportFileId: duplicate.importFileId,
      priorImportFileName: duplicate.sourceName,
      priorImportCompletedAt: duplicate.completedAt,
    });
  }

  const importStartedAt = Date.now();

  // --- Stage 3: Parse — detect format and decode rows (`parseImportBuffer`). ---
  const {
    rows,
    format: detectedFormat,
    currency: importCurrency,
  } = parseImportBuffer(
    extracted.file.buffer,
    extracted.file.filename,
    extracted.file.mimeType,
  );

  // --- Stage 4: Canonical amount policy (`resolveAmountNegation`, `applyImportAmountNegation`). ---
  const explicitNegate = parseNegateAmountsField(extracted.negateAmounts);
  const suggestInterest = suggestNegateFromInterest(rows);
  const suggestPriorImport = await suggestNegateFromPriorImport(
    repo,
    userId,
    accountId,
  );
  const amountNegated = resolveAmountNegation({
    explicit: explicitNegate,
    suggestInterest,
    suggestPriorImport,
  });
  applyImportAmountNegation(rows, amountNegated);

  // --- Stage 5: Allocate batch artefact IDs (`import_file_id`, per-row `transaction_id[]`). ---
  const { importFileId, transactionIds } = allocateBatchArtefactIds(rows.length);

  // --- Stage 6: Load ledger snapshot (`listTransactions` + file→account map). ---
  const ledgerSnapshot =
    rows.length > 0 ? await buildLedgerSnapshot(userId, repo) : undefined;

  // --- Stages 7–9: Pairing + cluster/categorise + build `PersistPlan` (`runImportPlanning`). ---
  const plan = await runImportPlanning(userId, rows, {
    importAccountId: accountId,
    importCurrency,
    newTransactionIds: transactionIds,
    ...(ledgerSnapshot && { ledgerSnapshot }),
  });

  // --- Stage 10–12: Persist (§8.7 staging when configured, else §8.6 in-place). ---
  const importCompletedAt = Date.now();
  const displayName = extracted.file.filename?.trim() || 'import';
  const ingestPreview = {
    rowCount: plan.summary.importRowCount,
    knownMerchants: plan.summary.knownMerchants,
    unknownMerchants: plan.summary.unknownMerchants,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: plan.summary.newClustersTouched,
  };
  const transactionFileInput = {
    id: importFileId,
    account_id: accountId,
    content_sha256: contentSha256,
    source: {
      name: displayName,
      size_bytes: extracted.file.buffer.length,
      ...(extracted.file.mimeType && { content_type: extracted.file.mimeType }),
    },
    format: {
      ...(detectedFormat === 'unknown' ? {} : { source_format: detectedFormat }),
      ...(importCurrency && { currency: importCurrency }),
      amount_negated: amountNegated,
    },
    timing: {
      started_at: importStartedAt,
      completed_at: importCompletedAt,
    },
    result: ingestPreview,
  };

  const persistParams = {
    userId,
    repo,
    plan,
    importFileId,
    importStartedAt,
    importCurrency,
    transactionFileInput,
  };

  if (repo.isImportStagingEnabled()) {
    await persistImportViaStaging(persistParams);
  } else {
    await persistImportInPlace(persistParams);
  }

  log.info('import.complete', {
    rowCount: ingestPreview.rowCount,
    format: detectedFormat,
    fileBytes: extracted.file.buffer.length,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: plan.summary.newClustersTouched,
    retiredClusterCount: plan.retiredClusterIds.length,
    staging: repo.isImportStagingEnabled(),
  });

  const base: Record<string, unknown> = {
    rowCount: ingestPreview.rowCount,
    knownMerchants: ingestPreview.knownMerchants,
    unknownMerchants: ingestPreview.unknownMerchants,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: plan.summary.newClustersTouched,
    importFileId,
  };
  if (detectedFormat !== 'unknown') {
    base.sourceFormat = detectedFormat;
  }
  base.amountNegation = {
    applied: amountNegated,
    suggestInterest,
    suggestPriorImport,
    explicitOverride: explicitNegate !== undefined,
  };
  return base;
}
