/**
 * Transfer pairing orchestration invoked during **file import**.
 *
 * Core matching rules live in `@housef4/db` (`transferPairing`). This module builds
 * proposal/counterparty pools from import rows + existing ledger state; other callers
 * (manual pair, reconciliation jobs, etc.) can live alongside this folder later.
 */

import type {
  TransactionRecord,
  TransferPairingAssignment,
  TransferPairingLeg,
} from '@housef4/db';
import { TRANSFER_PAIRING_DAY_MS, computeAutoTransferPairingsSortedPools } from '@housef4/db';

import type { ParsedImportRow } from '../import/canonical';

/** Default W in **W × 86 400 000 ms** (`transfer_matching.md` §3). */
export const INGEST_TRANSFER_PAIR_WINDOW_DAYS = 4;

/** Default residual tolerance for ingest pairing (`transfer_matching.md` §3.1). */
export const INGEST_TRANSFER_PAIR_EPSILON = 0.01;

export function existingTxnTouchesImportDateWindow(
  txnDateMs: number,
  importDatesMs: readonly number[],
  windowDays: number,
): boolean {
  const halfBandMs = windowDays * TRANSFER_PAIRING_DAY_MS;
  for (const d of importDatesMs) {
    if (Math.abs(txnDateMs - d) <= halfBandMs) return true;
  }
  return false;
}

/** One leg per new import row (proposal side of {@link computeAutoTransferPairingsSortedPools}). */
function ingestProposalLegsFromParsed(params: {
  parsed: readonly ParsedImportRow[];
  newTransactionIds: readonly string[];
  importAccountId: string;
  importCurrency?: string;
}): TransferPairingLeg[] {
  if (params.parsed.length !== params.newTransactionIds.length) {
    throw new Error(
      'ingestProposalLegsFromParsed: parsed rows and newTransactionIds length mismatch',
    );
  }
  return params.parsed.map((row, i) => {
    const nid = params.newTransactionIds[i];
    if (nid === undefined) {
      throw new Error('ingestProposalLegsFromParsed: missing id at index ' + String(i));
    }
    return {
      id: nid,
      account_id: params.importAccountId,
      date: row.date,
      amount: row.canonical_amount,
      ...(params.importCurrency ? { currency: params.importCurrency } : {}),
    };
  });
}

/** Existing legs within **W × 86 400 000 ms** of any import date (counterpart pool), excluding rows already paired (§4.1 one-to-one; `transfer_matching.md`). */
function ingestCounterpartLegsNearImport(params: {
  existingTransactions: readonly TransactionRecord[];
  importDatesMs: readonly number[];
  windowDays: number;
  fileIdToAccountId: ReadonlyMap<string, string>;
}): TransferPairingLeg[] {
  const legs: TransferPairingLeg[] = [];
  for (const tx of params.existingTransactions) {
    if (tx.pairing_id) continue;
    if (!existingTxnTouchesImportDateWindow(tx.date, params.importDatesMs, params.windowDays)) {
      continue;
    }
    const acc = params.fileIdToAccountId.get(tx.transaction_file_id);
    if (!acc) continue;
    legs.push({
      id: tx.id,
      account_id: acc,
      date: tx.date,
      amount: tx.amount,
    });
  }
  return legs;
}

/**
 * Runs transfer pairing on **new import legs** plus **existing** transactions inside the **§3 epoch-ms hull**
 * (within **W × 86 400 000 ms** of some import timestamp). **`proposalRootIds`** restricts pairing roots so
 * existing↔existing pairs are not formed during ingest.
 */
export function computeIngestTransferPairings(params: {
  importAccountId: string;
  importCurrency?: string;
  parsed: readonly ParsedImportRow[];
  newTransactionIds: readonly string[];
  existingTransactions: readonly TransactionRecord[];
  fileIdToAccountId: ReadonlyMap<string, string>;
  windowDays?: number;
  epsilon?: number;
}): Record<string, TransferPairingAssignment> {
  const windowDays = params.windowDays ?? INGEST_TRANSFER_PAIR_WINDOW_DAYS;
  const epsilon = params.epsilon ?? INGEST_TRANSFER_PAIR_EPSILON;
  const importDatesMs = params.parsed.map((r) => r.date);

  const proposalLegs = ingestProposalLegsFromParsed({
    parsed: params.parsed,
    newTransactionIds: params.newTransactionIds,
    importAccountId: params.importAccountId,
    importCurrency: params.importCurrency,
  });
  const counterpartLegs = ingestCounterpartLegsNearImport({
    existingTransactions: params.existingTransactions,
    importDatesMs,
    windowDays,
    fileIdToAccountId: params.fileIdToAccountId,
  });

  const proposalRootIds = new Set(params.newTransactionIds);
  const { byLegId } = computeAutoTransferPairingsSortedPools(counterpartLegs, proposalLegs, {
    windowDays,
    epsilon,
    proposalRootIds,
  });
  return byLegId;
}
