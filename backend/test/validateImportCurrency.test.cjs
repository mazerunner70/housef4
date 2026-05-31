const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveAndValidateImportCurrency,
} = require('../dist/services/import/validateImportCurrency');
const { HttpError } = require('../dist/httpError');

test('resolveAndValidateImportCurrency — existing account uses client currency when sent', () => {
  assert.equal(
    resolveAndValidateImportCurrency({
      isNewAccount: false,
      clientCurrency: 'EUR',
      storedAccountCurrency: 'GBP',
      fileCurrencyHint: 'EUR',
    }),
    'EUR',
  );
});

test('resolveAndValidateImportCurrency — existing account falls back to stored currency', () => {
  assert.equal(
    resolveAndValidateImportCurrency({
      isNewAccount: false,
      clientCurrency: '',
      storedAccountCurrency: 'GBP',
      fileCurrencyHint: 'GBP',
    }),
    'GBP',
  );
});

test('resolveAndValidateImportCurrency — existing account without stored currency uses client currency', () => {
  assert.equal(
    resolveAndValidateImportCurrency({
      isNewAccount: false,
      clientCurrency: 'GBP',
      fileCurrencyHint: 'GBP',
    }),
    'GBP',
  );
});

test('resolveAndValidateImportCurrency — existing account rejects file hint vs client currency', () => {
  assert.throws(
    () =>
      resolveAndValidateImportCurrency({
        isNewAccount: false,
        clientCurrency: 'USD',
        storedAccountCurrency: 'GBP',
        fileCurrencyHint: 'EUR',
      }),
    (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.statusCode, 409);
      assert.equal(e.body.error, 'currency_mismatch');
      assert.equal(e.body.account_currency, 'USD');
      assert.equal(e.body.file_currency, 'EUR');
      return true;
    },
  );
});
