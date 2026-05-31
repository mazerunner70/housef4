'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ALL_CURRENCIES,
  Currency,
  Money,
  MoneyError,
  currencyScale,
  detectAmountStringCurrency,
  formatAmount,
  formatCurrencyDescriptor,
  formatCurrencyLabel,
  fromMajor,
  isCurrencyId,
  money,
  parseCurrency,
  parseDecimalString,
  pairingIsExact,
  pairingResidualAbs,
  readStoredAmount,
  storedAmountFieldsToWireMajor,
  toMajor,
  validateAmountStringSymbol,
  writeStoredAmountFields,
} = require('../dist/index.js');

describe('Currency', () => {
  it('exposes id, name, symbol, and scale for each supported code', () => {
    assert.equal(Currency.USD.id, 'USD');
    assert.equal(Currency.USD.name, 'US Dollar');
    assert.equal(Currency.USD.symbol, '$');
    assert.equal(Currency.USD.scale, 2);
    assert.equal(Currency.JPY.scale, 0);
    assert.equal(ALL_CURRENCIES.length, 6);
  });

  it('parseCurrency accepts case-insensitive codes', () => {
    assert.equal(parseCurrency('usd').id, 'USD');
    assert.equal(parseCurrency(' EUR ').id, 'EUR');
  });

  it('parseCurrency throws for unsupported codes', () => {
    assert.throws(() => parseCurrency('CHF'), MoneyError);
    assert.throws(() => parseCurrency(''), MoneyError);
  });

  it('isCurrencyId narrows supported codes', () => {
    assert.equal(isCurrencyId('JPY'), true);
    assert.equal(isCurrencyId('CHF'), false);
  });

  it('formats labels and descriptors', () => {
    assert.equal(formatCurrencyLabel(Currency.EUR), 'Euro (EUR)');
    assert.equal(formatCurrencyDescriptor('GBP'), '£ GBP');
  });

  it('detectAmountStringCurrency resolves multi-char symbols', () => {
    assert.equal(detectAmountStringCurrency('CA$12.00')?.id, 'CAD');
    assert.equal(detectAmountStringCurrency('A$9.50')?.id, 'AUD');
    assert.equal(detectAmountStringCurrency('$10')?.id, 'USD');
    assert.equal(detectAmountStringCurrency('€1')?.id, 'EUR');
  });
});

describe('currencyScale', () => {
  it('returns scale from Currency or code', () => {
    assert.equal(currencyScale(Currency.USD), 2);
    assert.equal(currencyScale('JPY'), 0);
  });

  it('throws for unsupported currency', () => {
    assert.throws(() => currencyScale('CHF'), MoneyError);
  });
});

describe('Money', () => {
  it('rejects non-integer units', () => {
    assert.throws(() => Money.of(1.5), MoneyError);
    assert.throws(() => money(NaN), MoneyError);
  });

  it('requires currency for arithmetic helpers', () => {
    const a = money(100);
    const b = money(-40);
    assert.equal(a.add(b, 'USD').units, 60);
    assert.equal(a.subtract(b, Currency.USD).units, 140);
    assert.equal(a.negate('USD').units, -100);
    assert.equal(b.abs('USD').units, 40);
    assert.equal(a.isPositive(), true);
    assert.equal(b.isNegative(), true);
    assert.throws(() => a.add(b, 'CHF'), MoneyError);
  });
});

describe('fromMajor / toMajor', () => {
  it('rounds half away from zero at scale 2', () => {
    assert.equal(fromMajor(10.005, Currency.USD).units, 1001);
    assert.equal(fromMajor(-10.005, Currency.USD).units, -1001);
  });

  it('round-trips common values', () => {
    const m = fromMajor(-10.5, 'USD');
    assert.equal(m.units, -1050);
    assert.equal(toMajor(m, 'USD'), -10.5);
  });

  it('handles JPY scale 0', () => {
    assert.equal(fromMajor(1500, Currency.JPY).units, 1500);
    assert.equal(toMajor(money(1500), 'JPY'), 1500);
  });
});

describe('parseDecimalString', () => {
  it('strips matching currency symbols and grouping', () => {
    assert.equal(parseDecimalString('$1,234.56', Currency.USD).units, 123456);
    assert.equal(parseDecimalString('€42.00', 'EUR').units, 4200);
    assert.equal(parseDecimalString('(42.00)', 'USD').units, -4200);
  });

  it('throws when symbol does not match expected currency', () => {
    assert.throws(() => parseDecimalString('$10', 'EUR'), MoneyError);
    assert.throws(() => parseDecimalString('€10', 'USD'), MoneyError);
    assert.throws(() => validateAmountStringSymbol('£1', 'USD'), MoneyError);
  });

  it('throws on empty or invalid input', () => {
    assert.throws(() => parseDecimalString('', 'USD'), MoneyError);
    assert.throws(() => parseDecimalString('not-a-number', 'USD'), MoneyError);
  });
});

describe('formatAmount', () => {
  it('formats with Intl for supported codes', () => {
    const s = formatAmount(fromMajor(-10.5, 'USD'), 'USD');
    assert.match(s, /10\.50/);
  });
});

describe('pairing', () => {
  it('exact when residuals cancel', () => {
    const a = fromMajor(-100, 'USD');
    const b = fromMajor(100, 'USD');
    assert.equal(pairingIsExact(a, b, 'USD'), true);
    assert.equal(pairingResidualAbs(a, b, 'USD'), 0);
  });
});

describe('readStoredAmount / writeStoredAmountFields', () => {
  it('prefers amount_minor when present', () => {
    const read = readStoredAmount({ amount_minor: -1050, file_amount_minor: 1050 }, 'USD');
    assert.equal(read.amount_minor, -1050);
    assert.equal(read.file_amount_minor, 1050);
    assert.equal(read.amount_scale, undefined);
  });

  it('converts legacy major-unit amount', () => {
    const read = readStoredAmount({ amount: -10.5, file_amount: 10.5 }, 'USD');
    assert.equal(read.amount_minor, -1050);
    assert.equal(read.file_amount_minor, 1050);
  });

  it('writes canonical fields', () => {
    assert.deepEqual(
      writeStoredAmountFields(money(-1050), { fileAmount: money(1050) }),
      {
        amount_minor: -1050,
        file_amount_minor: 1050,
      },
    );
  });

  it('wire major requires currency or amount_scale', () => {
    const fields = readStoredAmount({ amount_minor: -1050 }, 'USD');
    assert.deepEqual(storedAmountFieldsToWireMajor(fields, 'USD'), { amount: -10.5 });
    assert.throws(() => storedAmountFieldsToWireMajor(fields), MoneyError);
  });

  it('throws when scale cannot be resolved', () => {
    assert.throws(() => readStoredAmount({ amount: -10.5 }), MoneyError);
  });
});
