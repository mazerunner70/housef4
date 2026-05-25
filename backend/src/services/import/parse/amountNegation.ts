import type { FinanceRepository, TransactionFileRecord } from '@housef4/db';

import { find, some } from '../utils/lodashImport';
import type { ParsedImportRow } from './canonical';

/**
 * Interest income / credits — positive file amounts here are expected; do not use for the
 * "interest should be negative" expense heuristic.
 */
const INTEREST_INCOME_HINT =
  /\b(interest earned|interest paid to|credit interest|savings interest|dividend|int\.?\s*credit)\b/i;

/**
 * Interest / finance charges on cards and loans — under canonical sign these are expenses
 * (negative). If the file shows a positive amount for these, the export may use the opposite sign.
 */
const INTEREST_EXPENSE_HINT =
  /\b(interest|finance charge|fin\.?\s*chg|purchase interest|cash adv(?:ance)?\s*int)\b/i;

export function suggestNegateFromInterest(rows: ParsedImportRow[]): boolean {
  return some(
    rows,
    (r) =>
      !INTEREST_INCOME_HINT.test(r.raw_merchant) &&
      INTEREST_EXPENSE_HINT.test(r.raw_merchant) &&
      r.file_amount > 0,
  );
}

/**
 * If a recent import for this account explicitly recorded `amount_negated`, mirror that suggestion.
 * Items without the flag (legacy) are skipped so an older explicit value can apply.
 */
export async function suggestNegateFromPriorImport(
  repo: FinanceRepository,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const files: TransactionFileRecord[] = await repo.listTransactionFiles(userId);
  const prior = find(
    files,
    (f) =>
      f.account_id === accountId &&
      (f.format.amount_negated === true || f.format.amount_negated === false),
  );
  return prior?.format.amount_negated ?? false;
}

/** `true` / `1` / `yes` → true; `false` / `0` / `no` → false; empty or unknown → undefined (use auto). */
export function parseNegateAmountsField(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().toLowerCase();
  if (t === '' || t === 'auto') return undefined;
  if (t === 'true' || t === '1' || t === 'yes') return true;
  if (t === 'false' || t === '0' || t === 'no') return false;
  return undefined;
}

export function resolveAmountNegation(params: {
  readonly explicit: boolean | undefined;
  readonly suggestInterest: boolean;
  readonly suggestPriorImport: boolean;
}): boolean {
  if (params.explicit !== undefined) return params.explicit;
  return params.suggestInterest || params.suggestPriorImport;
}
