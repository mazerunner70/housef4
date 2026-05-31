import {
  fromMajor,
  money,
  readStoredAmount,
  storedAmountFieldsToWireMajor,
  toMajor,
  writeStoredAmountFields,
  type Money,
  type ReadAmountResult,
} from '@housef4/money';

import type { TransactionRecord } from './types';

export { readStoredAmount, writeStoredAmountFields, storedAmountFieldsToWireMajor };

type TransactionAmountFields = Pick<
  TransactionRecord,
  'canonicalAmount' | 'fileAmount'
>;

function recordToStoredFields(rec: TransactionAmountFields): ReadAmountResult {
  const storedFields: ReadAmountResult = {
    amount_minor: rec.canonicalAmount.units,
  };
  if (rec.fileAmount !== undefined) {
    storedFields.file_amount_minor = rec.fileAmount.units;
  }
  return storedFields;
}

/** Read canonical amount from a Dynamo item or backup row. */
export function readCanonicalAmountFromRow(
  row: Record<string, unknown>,
  accountCurrency?: string,
): Money {
  return money(readStoredAmount(row, accountCurrency).amount_minor);
}

/** Apply canonical amount fields from a Dynamo item or backup row onto a transaction record. */
export function applyStoredAmountToRecord(
  row: Record<string, unknown>,
  rec: TransactionAmountFields,
  accountCurrency: string,
): void {
  const storedFields = readStoredAmount(row, accountCurrency);
  rec.canonicalAmount = money(storedFields.amount_minor);
  if (storedFields.file_amount_minor !== undefined) {
    rec.fileAmount = money(storedFields.file_amount_minor);
  }
}

/** API / backup wire major decimal for the transaction canonical amount. */
export function canonicalAmountToWireMajor(
  rec: Pick<TransactionRecord, 'canonicalAmount'>,
  accountCurrency: string,
): number {
  return storedAmountFieldsToWireMajor(recordToStoredFields(rec), accountCurrency).amount;
}

/** API / backup wire major decimal for the optional file-native amount. */
export function fileAmountToWireMajor(
  rec: Pick<TransactionRecord, 'canonicalAmount' | 'fileAmount'>,
  accountCurrency: string,
): number | undefined {
  return storedAmountFieldsToWireMajor(recordToStoredFields(rec), accountCurrency)
    .file_amount;
}

/** API / backup wire major decimal for a cluster aggregate total. */
export function totalAmountToWireMajor(
  totalAmount: Money,
  accountCurrency: string,
  scale?: number,
): number {
  if (scale === undefined) {
    return toMajor(totalAmount, accountCurrency);
  }
  return totalAmount.units / 10 ** scale;
}

/** Flatten domain amount fields to Dynamo / backup `*_minor` attributes. */
export function recordToStoredAmountFields(
  rec: Pick<TransactionRecord, 'canonicalAmount' | 'fileAmount'>,
): Record<string, number> {
  return writeStoredAmountFields(rec.canonicalAmount, {
    fileAmount: rec.fileAmount,
  });
}

/** Read cluster `total_amount_minor` (or legacy major) as {@link Money}. */
export function readClusterTotalAmount(
  item: Record<string, unknown>,
  accountCurrency?: string,
): Money {
  const direct = item.total_amount_minor;
  if (direct !== undefined && direct !== null && Number.isInteger(Number(direct))) {
    return money(Number(direct));
  }
  const legacyMajor = Number(item.total_amount ?? 0);
  if (!Number.isFinite(legacyMajor)) {
    return money(0);
  }
  const legacyScale = Number(item.amount_scale);
  if (Number.isInteger(legacyScale) && legacyScale >= 0) {
    return money(Math.round(legacyMajor * 10 ** legacyScale));
  }
  if (accountCurrency?.trim()) {
    return fromMajor(legacyMajor, accountCurrency);
  }
  if (typeof item.currency === 'string' && item.currency.trim() !== '') {
    return fromMajor(legacyMajor, item.currency);
  }
  throw new Error('readClusterTotalAmount: currency or amount_scale required for legacy total_amount');
}
