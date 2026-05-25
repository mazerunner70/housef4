import { map } from '../utils/lodashImport';


/** Raw row from format-specific parsers (`amount` = file-signed only). */
export type ParserOutputRow = {
  date: number;
  amount: number;
  raw_merchant: string;
};

/**
 * One normalized row after format-specific parsing (before ids / clustering).
 * `file_amount` is exactly what the parser read; `canonical_amount` follows the
 * product sign convention (negative = money from the account, positive = money into the account)
 * after optional import negation.
 */
export interface ParsedImportRow {
  date: number;
  file_amount: number;
  canonical_amount: number;
  raw_merchant: string;
}

/** Attach `file_amount` / `canonical_amount` from legacy parser output (`amount` = file-signed). */
export function withCanonicalAmount(
  rows: ParserOutputRow[],
): ParsedImportRow[] {
  return map(rows, (r) => ({
    date: r.date,
    file_amount: r.amount,
    canonical_amount: r.amount,
    raw_merchant: r.raw_merchant,
  }));
}

/** create negated list,  setting `canonical_amount` to `-file_amount`. */
export function withNegatedCanonicalAmount(
  rows: ParsedImportRow[]
): ParsedImportRow[] {
  return map(rows, (row) => ({ ...row, canonical_amount: -row.file_amount }));
}

export type ImportSourceFormatKey = 'csv' | 'ofx' | 'qfx' | 'qif';
