const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parsedRowsFromParserOutput,
  applyImportAmountNegation,
} = require('../dist/services/import/parse/canonical');
const {
  suggestNegateFromInterest,
  parseNegateAmountsField,
  resolveAmountNegation,
} = require('../dist/services/import/parse/amountNegation');

test('suggestNegateFromInterest when interest expense is positive', () => {
  const rows = parsedRowsFromParserOutput([
    {
      date: 1,
      amount: 2.5,
      raw_merchant: 'INTEREST CHARGE PURCHASES',
    },
  ]);
  assert.equal(suggestNegateFromInterest(rows), true);
});

test('suggestNegateFromInterest skips interest earned', () => {
  const rows = parsedRowsFromParserOutput([
    { date: 1, amount: 0.12, raw_merchant: 'INTEREST EARNED' },
  ]);
  assert.equal(suggestNegateFromInterest(rows), false);
});

test('resolveAmountNegation respects explicit override', () => {
  assert.equal(
    resolveAmountNegation({
      explicit: false,
      suggestInterest: true,
      suggestPriorImport: true,
    }),
    false,
  );
  assert.equal(
    resolveAmountNegation({
      explicit: undefined,
      suggestInterest: true,
      suggestPriorImport: false,
    }),
    true,
  );
});

test('parseNegateAmountsField', () => {
  assert.equal(parseNegateAmountsField(undefined), undefined);
  assert.equal(parseNegateAmountsField(''), undefined);
  assert.equal(parseNegateAmountsField('auto'), undefined);
  assert.equal(parseNegateAmountsField('true'), true);
  assert.equal(parseNegateAmountsField('FALSE'), false);
});

test('applyImportAmountNegation flips canonical_amount only', () => {
  const rows = parsedRowsFromParserOutput([
    { date: 1, amount: 10, raw_merchant: 'X' },
  ]);
  applyImportAmountNegation(rows, true);
  assert.equal(rows[0].file_amount, 10);
  assert.equal(rows[0].canonical_amount, -10);
});
