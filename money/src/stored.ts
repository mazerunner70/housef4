import { MoneyError } from './errors';
import { parseCurrency, resolveCurrency } from './currency';
import { Money } from './money';

export type StoredAmountFields = {
  amount_minor: number;
  file_amount_minor?: number;
};

export type ReadAmountResult = StoredAmountFields & {
  /** Present only when reading legacy rows that stored scale explicitly. */
  amount_scale?: number;
};

function readOptionalStoredUnits(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) return undefined;
  return n;
}

function readScaleFromRow(row: Record<string, unknown>, currency?: string): number {
  const explicit = Number(row.amount_scale);
  if (Number.isInteger(explicit) && explicit >= 0 && explicit <= 8) {
    return explicit;
  }
  if (currency !== undefined && currency.trim() !== '') {
    return parseCurrency(currency).scale;
  }
  if (typeof row.currency === 'string' && row.currency.trim() !== '') {
    return parseCurrency(row.currency).scale;
  }
  throw new MoneyError(
    'Cannot determine amount scale: provide currency or amount_scale on the row',
  );
}

function majorToUnitsAtScale(major: number, scale: number): number {
  if (!Number.isFinite(major)) {
    throw new MoneyError('Major amount must be finite');
  }
  return Math.round(major * 10 ** scale);
}

function unitsToMajorAtScale(units: number, scale: number): number {
  if (!Number.isInteger(units)) {
    throw new MoneyError('Stored amount_minor must be an integer');
  }
  return units / 10 ** scale;
}

/**
 * Read transaction amount fields from a Dynamo item or backup row.
 * Prefers `amount_minor`; legacy major-unit `amount` requires resolvable scale.
 */
export function readStoredAmount(
  row: Record<string, unknown>,
  currency?: string,
): ReadAmountResult {
  const storedUnits = readOptionalStoredUnits(row.amount_minor);
  if (storedUnits !== undefined) {
    const out: ReadAmountResult = { amount_minor: storedUnits };
    const fileUnits = readOptionalStoredUnits(row.file_amount_minor);
    if (fileUnits !== undefined) {
      out.file_amount_minor = fileUnits;
    }
    const explicitScale = Number(row.amount_scale);
    if (Number.isInteger(explicitScale) && explicitScale >= 0 && explicitScale <= 8) {
      out.amount_scale = explicitScale;
    }
    return out;
  }

  const scale = readScaleFromRow(row, currency);
  const legacyMajor = Number(row.amount);
  if (!Number.isFinite(legacyMajor)) {
    throw new MoneyError('Missing or invalid amount on stored row');
  }
  const out: ReadAmountResult = {
    amount_minor: majorToUnitsAtScale(legacyMajor, scale),
  };
  if (row.amount_scale !== undefined && row.amount_scale !== null) {
    out.amount_scale = scale;
  }
  if (row.file_amount !== undefined && row.file_amount !== null) {
    const legacyFile = Number(row.file_amount);
    if (!Number.isFinite(legacyFile)) {
      throw new MoneyError('Invalid file_amount on stored row');
    }
    out.file_amount_minor = majorToUnitsAtScale(legacyFile, scale);
  }
  return out;
}

/** Dynamo / backup write shape for canonical amounts (no amount_scale on new rows). */
export function writeStoredAmountFields(
  amount: Money,
  opts: { fileAmount?: Money } = {},
): Record<string, number> {
  const out: Record<string, number> = { amount_minor: amount.units };
  if (opts.fileAmount !== undefined) {
    out.file_amount_minor = opts.fileAmount.units;
  }
  return out;
}

/** API / backup wire: major-unit decimal derived from stored `*_minor` fields. */
export function storedAmountFieldsToWireMajor(
  fields: ReadAmountResult,
  currency?: string,
): { amount: number; file_amount?: number } {
  const scale =
    fields.amount_scale ??
    (currency !== undefined && currency.trim() !== ''
      ? resolveCurrency(currency).scale
      : undefined);
  if (scale === undefined) {
    throw new MoneyError(
      'Cannot convert stored amounts to wire major: currency or amount_scale is required',
    );
  }
  const amount = unitsToMajorAtScale(fields.amount_minor, scale);
  if (fields.file_amount_minor === undefined) {
    return { amount };
  }
  return {
    amount,
    file_amount: unitsToMajorAtScale(fields.file_amount_minor, scale),
  };
}
