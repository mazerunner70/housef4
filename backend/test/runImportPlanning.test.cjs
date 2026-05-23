const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  runImportPlanning,
} = require('../dist/services/import/runImportPlanning');

test('runImportPlanning — zero parsed rows returns empty PersistPlan', async () => {
  const plan = await runImportPlanning('user-1', [], {
    importAccountId: 'acc-1',
    newTransactionIds: [],
  });

  assert.deepEqual(plan, {
    toInsert: [],
    existingPatches: [],
    retiredClusterIds: [],
    summary: {
      importRowCount: 0,
      knownMerchants: 0,
      unknownMerchants: 0,
      newClustersTouched: 0,
    },
  });
});

test('runImportPlanning — requires ledgerSnapshot when parsed rows exist', async () => {
  await assert.rejects(
    () =>
      runImportPlanning(
        'user-1',
        [{ date: 1_700_000_000_000, raw_merchant: 'Coffee', amount: -5 }],
        {
          importAccountId: 'acc-1',
          newTransactionIds: ['txn-new-1'],
        },
      ),
    /ledgerSnapshot required/,
  );
});

test('runImportPlanning — newTransactionIds length must match parsed rows', async () => {
  await assert.rejects(
    () =>
      runImportPlanning(
        'user-1',
        [{ date: 1_700_000_000_000, raw_merchant: 'Coffee', amount: -5 }],
        {
          importAccountId: 'acc-1',
          newTransactionIds: ['txn-a', 'txn-b'],
          ledgerSnapshot: {
            transactions: [],
            fileIdToAccountId: new Map(),
          },
        },
      ),
    /newTransactionIds length must match parsed rows/,
  );
});

test('runImportPlanning — single row produces insert intent', async () => {
  const parsed = [
    {
      date: 1_700_000_000_000,
      raw_merchant: 'Coffee Shop',
      amount: -4.5,
    },
  ];
  const newTransactionIds = ['txn-new-1'];

  const plan = await runImportPlanning('user-1', parsed, {
    importAccountId: 'acc-checking',
    importCurrency: 'USD',
    newTransactionIds,
    ledgerSnapshot: {
      transactions: [],
      fileIdToAccountId: new Map(),
    },
  });

  assert.equal(plan.summary.importRowCount, 1);
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.toInsert[0].id, 'txn-new-1');
  assert.equal(plan.toInsert[0].raw_merchant, 'Coffee Shop');
  assert.equal(plan.existingPatches.length, 0);
  assert.equal(plan.summary.newClustersTouched, 1);
  assert.equal(plan.summary.knownMerchants + plan.summary.unknownMerchants, 1);
});
