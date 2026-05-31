import { MoneyError } from './errors';
import { resolveCurrency, validateAmountStringSymbol, type Currency } from './currency';

/** Signed integer amount in minor units (construct via {@link Money.of} or {@link money}). */
export class Money {
  readonly units: number;

  private constructor(units: number) {
    if (!Number.isInteger(units)) {
      throw new MoneyError(`Money units must be an integer, got ${units}`);
    }
    this.units = units;
  }

  static of(units: number): Money {
    return new Money(units);
  }

  static zero(currency: Currency | string): Money {
    resolveCurrency(currency);
    return Money.of(0);
  }

  add(other: Money, currency: Currency | string): Money {
    resolveCurrency(currency);
    return Money.of(this.units + other.units);
  }

  subtract(other: Money, currency: Currency | string): Money {
    resolveCurrency(currency);
    return Money.of(this.units - other.units);
  }

  abs(currency: Currency | string): Money {
    resolveCurrency(currency);
    return Money.of(Math.abs(this.units));
  }

  negate(currency: Currency | string): Money {
    resolveCurrency(currency);
    return Money.of(-this.units);
  }

  isZero(): boolean {
    return this.units === 0;
  }

  isPositive(): boolean {
    return this.units > 0;
  }

  isNegative(): boolean {
    return this.units < 0;
  }

  equals(other: Money, currency: Currency | string): boolean {
    resolveCurrency(currency);
    return this.units === other.units;
  }

  compareTo(other: Money, currency: Currency | string): number {
    resolveCurrency(currency);
    return this.units - other.units;
  }
}

/** Construct {@link Money} from integer minor units (storage boundary; currency is external). */
export function money(units: number): Money {
  return Money.of(units);
}

function scaleFactor(scale: number): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 8) {
    throw new MoneyError(`Invalid currency scale: ${scale}`);
  }
  return 10 ** scale;
}

function majorToUnits(major: number, currency: Currency): number {
  if (!Number.isFinite(major)) {
    throw new MoneyError('Major amount must be a finite number');
  }
  return Math.round(major * scaleFactor(currency.scale));
}

function unitsToMajor(units: number, currency: Currency): number {
  if (!Number.isInteger(units)) {
    throw new MoneyError('Cannot convert non-integer units to major');
  }
  return units / scaleFactor(currency.scale);
}

function stripAmountDecorations(raw: string, currency: Currency): string {
  let t = raw.trim().replace(/^\((.+)\)$/, '-$1');
  const escapedSymbol = currency.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(escapedSymbol, 'g'), '');
  return t.replaceAll(/[,\s]/g, '');
}

/** Convert a major-unit decimal to minor-unit {@link Money}. */
export function fromMajor(major: number, currency: Currency | string): Money {
  const c = resolveCurrency(currency);
  return Money.of(majorToUnits(major, c));
}

/** Convert minor-unit {@link Money} to a major-unit decimal. */
export function toMajor(amount: Money, currency: Currency | string): number {
  const c = resolveCurrency(currency);
  return unitsToMajor(amount.units, c);
}

/** Locale currency string for display (requires a valid ISO code on the currency). */
export function formatAmount(amount: Money, currency: Currency | string): string {
  const c = resolveCurrency(currency);
  const major = toMajor(amount, c);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: c.id,
    }).format(major);
  } catch (cause) {
    throw new MoneyError(`Cannot format amount for currency ${c.id}`, { cause });
  }
}

/**
 * Parse a human/CSV decimal string into {@link Money}.
 * Validates an embedded currency symbol when present; strips symbol and grouping.
 */
export function parseDecimalString(raw: string, currency: Currency | string): Money {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new MoneyError('Amount string is required');
  }
  const c = resolveCurrency(currency);
  validateAmountStringSymbol(raw, c);
  const normalized = stripAmountDecorations(raw, c);
  if (normalized === '') {
    throw new MoneyError('Amount string is required');
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    throw new MoneyError(`Invalid amount string: ${raw}`);
  }
  return fromMajor(n, c);
}

export function add(a: Money, b: Money, currency: Currency | string): Money {
  return a.add(b, currency);
}

export function abs(m: Money, currency: Currency | string): Money {
  return m.abs(currency);
}

export function negate(m: Money, currency: Currency | string): Money {
  return m.negate(currency);
}

/** Signed residual A + B (transfer pairing). */
export function pairingResidual(a: Money, b: Money, currency: Currency | string): Money {
  return add(a, b, currency);
}

/** Absolute residual |A + B| in integer units. */
export function pairingResidualAbs(a: Money, b: Money, currency: Currency | string): number {
  resolveCurrency(currency);
  return Math.abs(a.units + b.units);
}

export function pairingIsExact(a: Money, b: Money, currency: Currency | string): boolean {
  resolveCurrency(currency);
  return a.units + b.units === 0;
}
