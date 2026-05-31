const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveImportCurrency,
} = require('../dist/services/import/resolveImportCurrency');

function stubRepo(overrides = {}) {
  return {
    listTransactionFiles: async () => overrides.transactionFiles ?? [],
    getDefaultCurrencyCode: async () => overrides.defaultCurrency ?? 'USD',
  };
}

test('resolveImportCurrency — file hint wins', async () => {
  const result = await resolveImportCurrency(
    stubRepo({ transactionFiles: [{ account_id: 'a1', format: { currency: 'GBP' } }] }),
    'user-1',
    'a1',
    'eur',
  );
  assert.equal(result.currency, 'EUR');
  assert.equal(result.currencyChoice, 'file_hint');
});

test('resolveImportCurrency — prior account file when no hint', async () => {
  const result = await resolveImportCurrency(
    stubRepo({
      transactionFiles: [
        { id: 'f2', account_id: 'a1', format: { currency: 'CAD' } },
        { id: 'f1', account_id: 'a2', format: { currency: 'JPY' } },
      ],
    }),
    'user-1',
    'a1',
  );
  assert.equal(result.currency, 'CAD');
  assert.equal(result.currencyChoice, 'prior_account_file');
});

test('resolveImportCurrency — profile default when no hint or prior', async () => {
  const result = await resolveImportCurrency(
    stubRepo({ defaultCurrency: 'CHF' }),
    'user-1',
    'a1',
  );
  assert.equal(result.currency, 'CHF');
  assert.equal(result.currencyChoice, 'profile_default');
});
