/**
 * Import pipeline orchestration (HTTP import path).
 *
 * **Stage order is authoritative** relative to numbered stages in
 * `docs/03_detailed_design/import_transaction_files.md` §4.2. Stages 6–9 are
 * still bundled inside `enrichImportRows`; later issues split snapshot,
 * PersistPlan, and planning without changing externally visible behaviour here.
 */

import { randomUUID } from 'node:crypto';

import type { FinanceRepository } from '@housef4/db';

import { HttpError } from '../../httpError';
import { getLog } from '../../requestLogContext';
import {
  parseNegateAmountsField,
  resolveAmountNegation,
  suggestNegateFromInterest,
  suggestNegateFromPriorImport,
} from './amountNegation';
import { applyImportAmountNegation } from './canonical';
import { computeImportBlobContentSha256 } from './blobFingerprint';
import { enrichImportRows } from './enrichImportRows';
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

  // --- Stage 5: Allocate batch artefact IDs (`import_file_id`, per-row `transaction_id[]` minted inside planning). ---
  const importFileId = randomUUID();

  // --- Stages 6–9: Ledger snapshot + pairing + cluster/categorise + persist intents (`enrichImportRows`). ---
  const enriched = await enrichImportRows(userId, rows, repo, {
    importAccountId: accountId,
    importCurrency,
  });

  // --- Stage 10: Apply persist plan — patches → ingest → retire (fixed order, §8.1). ---
  await repo.patchExistingTransactionsAfterImport(
    userId,
    enriched.existingPatches,
  );
  const result = await repo.ingestImportBatch(
    userId,
    enriched.toInsert,
    importFileId,
    importCurrency,
  );
  await repo.retireClusterAggregates(userId, enriched.retiredClusterIds);

  // --- Stage 11: Record `TRANSACTION_FILE` metadata (timing, format, fingerprint). ---
  const displayName = extracted.file.filename?.trim() || 'import';
  const importCompletedAt = Date.now();
  const ingest = {
    ...result,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
  };
  await repo.recordTransactionFile(userId, {
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
    result: ingest,
  });

  log.info('import.complete', {
    rowCount: result.rowCount,
    format: detectedFormat,
    fileBytes: extracted.file.buffer.length,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
    retiredClusterCount: enriched.retiredClusterIds.length,
  });

  // --- Stage 12: Derive aggregates (`METRICS`). ---
  await repo.refreshStoredDashboardMetrics(userId);

  const base: Record<string, unknown> = {
    rowCount: result.rowCount,
    knownMerchants: result.knownMerchants,
    unknownMerchants: result.unknownMerchants,
    existingTransactionsUpdated: enriched.existingPatches.length,
    newClustersTouched: enriched.summary.newClustersTouched,
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
