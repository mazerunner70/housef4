import { fromMajor, type Money } from '@housef4/money';

import type { ParsedImportRow } from './canonical';

/** Convert parser major-unit amounts to domain {@link Money} for persistence / pairing. */
export function parsedRowAmounts(
  row: Pick<ParsedImportRow, 'file_amount' | 'canonical_amount'>,
  currency: string,
): {
  canonicalAmount: Money;
  fileAmount: Money;
} {
  return {
    canonicalAmount: fromMajor(row.canonical_amount, currency),
    fileAmount: fromMajor(row.file_amount, currency),
  };
}
