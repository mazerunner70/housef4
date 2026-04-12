/** One normalized row after format-specific parsing (before ids / clustering). */
export interface ParsedImportRow {
  date: number;
  amount: number;
  raw_merchant: string;
}

export type ImportSourceFormatKey = 'csv' | 'ofx' | 'qfx' | 'qif';
