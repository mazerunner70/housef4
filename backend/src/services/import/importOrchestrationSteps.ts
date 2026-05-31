/**
 * §4.2 stage helpers for `executeImportOrchestration`.
 * Each export maps to one numbered stage (or a tight group) in
 * `docs/03_detailed_design/import_transaction_files.md`.
 */

import type { FinanceRepository, TransactionFileCurrencyChoice } from '@housef4/db';

import { HttpError } from '../../httpError';
import {
  parseNegateAmountsField,
  resolveAmountNegation,
  suggestNegateFromInterest,
  suggestNegateFromPriorImport,
} from './parse/amountNegation';
import { allocateBatchArtefactIds } from './planning/allocateBatchIds';
import { withNegatedCanonicalAmount, type ParsedImportRow } from './parse/canonical';
import { computeImportBlobContentSha256 } from './blob/blobFingerprint';
import { buildLedgerSnapshot } from './planning/ledgerSnapshot';
import type { ExtractedImportUpload } from './ingress/multipartFile';
import { parseImportBuffer } from './parse/parseImportBuffer';
import {
  persistImportInPlace,
  persistImportViaStaging,
} from './importPersistPhase';
import { runImportPlanning } from './runImportPlanning';
import type { PersistPlan } from './planning/persistPlan';
import type { MerchantEmbedder } from './clustering';
import type { ImportStageTracer } from './importStageTracing';
import { traceStage } from './utils/traceStage';

/** Parsed account target: existing id, or `null` to create from `ExtractedImportUpload.newAccountName`. */
export type ImportAccountSelection = Readonly<{
  existingAccountId: string | null;
}>;

export type ParsedImportUpload = Readonly<{
  rows: ParsedImportRow[];
  format: ReturnType<typeof parseImportBuffer>['format'];
  currency?: string;
}>;

export type AmountNegationPolicy = Readonly<{
  applied: boolean;
  suggestInterest: boolean;
  suggestPriorImport: boolean;
  explicitOverride: boolean;
  explicitNegate: boolean | undefined;
}>;

export type AmountNegationResult = AmountNegationPolicy &
  Readonly<{ rows: ParsedImportRow[] }>;

type TransactionFileInput = Parameters<
  FinanceRepository['recordTransactionFile']
>[1];

/** §4.2 stage **2** — parse multipart account target (`new_account_name` wins over `account_id`). */
export function parseImportAccountSelection(
  extracted: ExtractedImportUpload,
): ImportAccountSelection {
  const newAccountName = extracted.newAccountName.trim();
  if (newAccountName.length > 0) {
    return { existingAccountId: null };
  }
  const existingId = extracted.accountId.trim();
  return {
    existingAccountId: existingId.length > 0 ? existingId : null,
  };
}

/** §4.2 stage **2** — reject when neither new nor existing account is provided. */
export function validateImportAccountSelection(
  selection: ImportAccountSelection,
  extracted: ExtractedImportUpload,
): void {
  if (selection.existingAccountId !== null) return;
  if (extracted.newAccountName.trim().length > 0) return;
  throw new HttpError(
    400,
    'Provide new_account_name or a valid account_id for this import',
  );
}

/** §4.2 stage **2b** — fingerprint raw bytes and reject duplicate uploads. */
export async function assertNoDuplicateBlobImport(
  repo: FinanceRepository,
  userId: string,
  fileBuffer: Buffer,
): Promise<string> {
  const contentSha256 = computeImportBlobContentSha256(fileBuffer);
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
  return contentSha256;
}

/** §4.2 stage **2** (read path) — validate existing account before lock. */
export async function validateExistingAccountBeforeLock(
  repo: FinanceRepository,
  userId: string,
  selection: ImportAccountSelection,
): Promise<void> {
  if (selection.existingAccountId === null) return;
  const acc = await repo.getAccount(userId, selection.existingAccountId);
  if (!acc) {
    throw new HttpError(400, 'Unknown account_id');
  }
}

/** §4.2 stage **3** — detect format and decode rows (local only). */
export function parseImportUpload(
  extracted: ExtractedImportUpload,
): ParsedImportUpload {
  const { rows, format, currency } = parseImportBuffer(
    extracted.file.buffer,
    extracted.file.filename,
    extracted.file.mimeType,
  );
  return { rows, format, currency };
}

/** §4.2 stage **2** (write path) — create account when requested (under lock). */
export async function resolveAccountAfterLock(
  repo: FinanceRepository,
  userId: string,
  selection: ImportAccountSelection,
  extracted: ExtractedImportUpload,
): Promise<string> {
  if (selection.existingAccountId !== null) {
    return selection.existingAccountId;
  }
  const created = await repo.createAccount(
    userId,
    extracted.newAccountName.trim(),
  );
  return created.id;
}

/** §4.2 stage **4** — canonical amount policy; returns new rows (no in-place mutation). */
export async function applyAmountNegationPolicy(
  repo: FinanceRepository,
  userId: string,
  accountId: string,
  extracted: ExtractedImportUpload,
  rows: ParsedImportRow[],
): Promise<AmountNegationResult> {
  const explicitNegate = parseNegateAmountsField(extracted.negateAmounts);
  const suggestInterest = suggestNegateFromInterest(rows);
  const suggestPriorImport = await suggestNegateFromPriorImport(
    repo,
    userId,
    accountId,
  );
  const negateDecided = resolveAmountNegation({
    explicit: explicitNegate,
    suggestInterest,
    suggestPriorImport,
  });
  return {
    applied: negateDecided,
    suggestInterest,
    suggestPriorImport,
    explicitOverride: explicitNegate !== undefined,
    explicitNegate,
    rows: negateDecided ? withNegatedCanonicalAmount(rows) : rows,
  };
}

/** §4.2 stages **5–9** — allocate ids, snapshot ledger, run planning. */
export async function runImportPlanningStages(
  userId: string,
  repo: FinanceRepository,
  accountId: string,
  parsed: ParsedImportUpload,
  tracer?: ImportStageTracer,
  embedder?: MerchantEmbedder,
): Promise<PersistPlan> {
  const { rows } = parsed;
  const { transactionIds } = await traceStage(tracer, '5', () =>
    Promise.resolve(allocateBatchArtefactIds(rows.length)),
  );

  if (rows.length === 0) {
    tracer?.markSkipped('6', 'zero_rows');
    tracer?.markSkipped('7', 'zero_rows');
    tracer?.markSkipped('8', 'zero_rows');
    tracer?.markSkipped('9', 'zero_rows');
    return runImportPlanning(userId, rows, {
      importAccountId: accountId,
      importCurrency: parsed.currency,
      newTransactionIds: transactionIds,
      embedder,
    });
  }

  const ledgerSnapshot = await traceStage(tracer, '6', () =>
    buildLedgerSnapshot(userId, repo),
  );

  return runImportPlanning(userId, rows, {
    importAccountId: accountId,
    importCurrency: parsed.currency,
    newTransactionIds: transactionIds,
    ledgerSnapshot,
    tracer,
    embedder,
  });
}

/** §4.2 stage **11** input — `TRANSACTION_FILE` metadata envelope. */
export function buildTransactionFileInput(params: {
  importFileId: string;
  accountId: string;
  contentSha256: string;
  extracted: ExtractedImportUpload;
  parsed: ParsedImportUpload;
  /** Resolved at import (file hint → prior account file → profile default). */
  importCurrency: string;
  currencyChoice: TransactionFileCurrencyChoice;
  amountNegated: boolean;
  importStartedAt: number;
  importCompletedAt: number;
  plan: PersistPlan;
}): TransactionFileInput {
  const {
    importFileId,
    accountId,
    contentSha256,
    extracted,
    parsed,
    importCurrency,
    currencyChoice,
    amountNegated,
    importStartedAt,
    importCompletedAt,
    plan,
  } = params;
  const displayName = extracted.file.filename?.trim() || 'import';
  const ingestPreview = {
    rowCount: plan.summary.importRowCount,
    knownMerchants: plan.summary.knownMerchants,
    unknownMerchants: plan.summary.unknownMerchants,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: plan.summary.newClustersTouched,
  };

  return {
    id: importFileId,
    account_id: accountId,
    content_sha256: contentSha256,
    source: {
      name: displayName,
      size_bytes: extracted.file.buffer.length,
      ...(extracted.file.mimeType && { content_type: extracted.file.mimeType }),
    },
    format: {
      ...(parsed.format === 'unknown' ? {} : { source_format: parsed.format }),
      currency: importCurrency,
      currencyChoice,
      amount_negated: amountNegated,
    },
    timing: {
      started_at: importStartedAt,
      completed_at: importCompletedAt,
    },
    result: ingestPreview,
  };
}

/** §4.2 stages **10–12** — persist via staging (§8.7) or in-place (§8.6). */
export async function persistImportResult(params: {
  repo: FinanceRepository;
  userId: string;
  plan: PersistPlan;
  importFileId: string;
  importStartedAt: number;
  importCurrency?: string;
  transactionFileInput: TransactionFileInput;
  extracted: ExtractedImportUpload;
  contentSha256: string;
  accountId: string;
  tracer?: ImportStageTracer;
}): Promise<void> {
  const persistParams = {
    userId: params.userId,
    repo: params.repo,
    plan: params.plan,
    importFileId: params.importFileId,
    importStartedAt: params.importStartedAt,
    importCurrency: params.importCurrency,
    transactionFileInput: params.transactionFileInput,
    extracted: params.extracted,
    contentSha256: params.contentSha256,
    accountId: params.accountId,
    tracer: params.tracer,
  };

  if (params.repo.isImportStagingEnabled()) {
    await persistImportViaStaging(persistParams);
  } else {
    await persistImportInPlace(persistParams);
  }
}

/** §4.2 stage **12** response — `ImportParseResult` shape for HTTP **200**. */
export function buildImportOrchestrationResponse(params: {
  plan: PersistPlan;
  importFileId: string;
  parsed: ParsedImportUpload;
  importCurrency: string;
  amountNegation: AmountNegationPolicy;
}): Record<string, unknown> {
  const { plan, importFileId, parsed, importCurrency, amountNegation } = params;
  const base: Record<string, unknown> = {
    rowCount: plan.summary.importRowCount,
    knownMerchants: plan.summary.knownMerchants,
    unknownMerchants: plan.summary.unknownMerchants,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: plan.summary.newClustersTouched,
    importFileId,
    currency: importCurrency,
  };
  if (parsed.format !== 'unknown') {
    base.sourceFormat = parsed.format;
  }
  base.amountNegation = {
    applied: amountNegation.applied,
    suggestInterest: amountNegation.suggestInterest,
    suggestPriorImport: amountNegation.suggestPriorImport,
    explicitOverride: amountNegation.explicitOverride,
  };
  return base;
}
