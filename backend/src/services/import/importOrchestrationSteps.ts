/**
 * §4.2 stage helpers for `executeImportOrchestration`.
 * Each export maps to one numbered stage (or a tight group) in
 * `docs/03_detailed_design/import_transaction_files.md`.
 */

import type { FinanceRepository } from '@housef4/db';

import { HttpError } from '../../httpError';
import {
  parseNegateAmountsField,
  resolveAmountNegation,
  suggestNegateFromInterest,
  suggestNegateFromPriorImport,
} from './amountNegation';
import { allocateBatchArtefactIds } from './allocateBatchIds';
import { applyImportAmountNegation, type ParsedImportRow } from './canonical';
import { computeImportBlobContentSha256 } from './blobFingerprint';
import { buildLedgerSnapshot } from './ledgerSnapshot';
import type { ExtractedImportUpload } from './multipartFile';
import { parseImportBuffer } from './parseImportBuffer';
import {
  persistImportInPlace,
  persistImportViaStaging,
} from './importPersistPhase';
import { runImportPlanning } from './runImportPlanning';
import type { PersistPlan } from './persistPlan';

export type AccountSelector = Readonly<{
  newName: string;
  existingId: string;
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

type TransactionFileInput = Parameters<
  FinanceRepository['recordTransactionFile']
>[1];

/** §4.2 stage **2** — parse multipart account selector fields. */
export function parseAccountSelector(
  extracted: ExtractedImportUpload,
): AccountSelector {
  return {
    newName: extracted.newAccountName.trim(),
    existingId: extracted.accountId.trim(),
  };
}

/** §4.2 stage **2** — reject when neither new nor existing account is provided. */
export function validateAccountSelector(selector: AccountSelector): void {
  if (selector.newName.length === 0 && selector.existingId.length === 0) {
    throw new HttpError(
      400,
      'Provide new_account_name or a valid account_id for this import',
    );
  }
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
  selector: AccountSelector,
): Promise<void> {
  if (selector.newName.length > 0) return;
  const acc = await repo.getAccount(userId, selector.existingId);
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
  selector: AccountSelector,
): Promise<string> {
  if (selector.newName.length > 0) {
    const created = await repo.createAccount(userId, selector.newName);
    return created.id;
  }
  return selector.existingId;
}

/** §4.2 stage **4** — canonical amount policy; mutates `rows` in place. */
export async function applyAmountNegationPolicy(
  repo: FinanceRepository,
  userId: string,
  accountId: string,
  extracted: ExtractedImportUpload,
  rows: ParsedImportRow[],
): Promise<AmountNegationPolicy> {
  const explicitNegate = parseNegateAmountsField(extracted.negateAmounts);
  const suggestInterest = suggestNegateFromInterest(rows);
  const suggestPriorImport = await suggestNegateFromPriorImport(
    repo,
    userId,
    accountId,
  );
  const applied = resolveAmountNegation({
    explicit: explicitNegate,
    suggestInterest,
    suggestPriorImport,
  });
  applyImportAmountNegation(rows, applied);
  return {
    applied,
    suggestInterest,
    suggestPriorImport,
    explicitOverride: explicitNegate !== undefined,
    explicitNegate,
  };
}

/** §4.2 stages **5–9** — allocate ids, snapshot ledger, run planning. */
export async function runImportPlanningStages(
  userId: string,
  repo: FinanceRepository,
  accountId: string,
  parsed: ParsedImportUpload,
): Promise<PersistPlan> {
  const { rows } = parsed;
  const { transactionIds } = allocateBatchArtefactIds(rows.length);
  const ledgerSnapshot =
    rows.length > 0 ? await buildLedgerSnapshot(userId, repo) : undefined;

  return runImportPlanning(userId, rows, {
    importAccountId: accountId,
    importCurrency: parsed.currency,
    newTransactionIds: transactionIds,
    ...(ledgerSnapshot && { ledgerSnapshot }),
  });
}

/** §4.2 stage **11** input — `TRANSACTION_FILE` metadata envelope. */
export function buildTransactionFileInput(params: {
  importFileId: string;
  accountId: string;
  contentSha256: string;
  extracted: ExtractedImportUpload;
  parsed: ParsedImportUpload;
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
      ...(parsed.currency && { currency: parsed.currency }),
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
}): Promise<void> {
  const persistParams = {
    userId: params.userId,
    repo: params.repo,
    plan: params.plan,
    importFileId: params.importFileId,
    importStartedAt: params.importStartedAt,
    importCurrency: params.importCurrency,
    transactionFileInput: params.transactionFileInput,
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
  amountNegation: AmountNegationPolicy;
}): Record<string, unknown> {
  const { plan, importFileId, parsed, amountNegation } = params;
  const base: Record<string, unknown> = {
    rowCount: plan.summary.importRowCount,
    knownMerchants: plan.summary.knownMerchants,
    unknownMerchants: plan.summary.unknownMerchants,
    existingTransactionsUpdated: plan.existingPatches.length,
    newClustersTouched: plan.summary.newClustersTouched,
    importFileId,
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
