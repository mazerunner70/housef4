/** Raw row from format-specific parsers (`amount` = file-signed only). */
export type ParserOutputRow = {
  date: number;
  amount: number;
  raw_merchant: string;
};

/**
 * One normalized row after format-specific parsing (before ids / clustering).
 * `file_amount` is exactly what the parser read; `canonical_amount` follows the
 * product sign convention (spending negative, income positive) after optional import negation.
 */
export interface ParsedImportRow {
  date: number;
  file_amount: number;
  canonical_amount: number;
  raw_merchant: string;
}

/** Attach `file_amount` / `canonical_amount` from legacy parser output (`amount` = file-signed). */
export function parsedRowsFromParserOutput(
  rows: ParserOutputRow[],
): ParsedImportRow[] {
  return rows.map((r) => ({
    date: r.date,
    file_amount: r.amount,
    canonical_amount: r.amount,
    raw_merchant: r.raw_merchant,
  }));
}

/** When import negation is on, flip canonical amounts so `canonical_amount === -file_amount`. */
export function applyImportAmountNegation(
  rows: ParsedImportRow[],
  negate: boolean,
): void {
  if (!negate) return;
  for (const r of rows) {
    r.canonical_amount = -r.file_amount;
  }
}

export type ImportSourceFormatKey = 'csv' | 'ofx' | 'qfx' | 'qif';
