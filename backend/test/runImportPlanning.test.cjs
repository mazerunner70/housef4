const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money } = require('@housef4/money');

const {
  runImportPlanning,
} = require('../dist/services/import/runImportPlanning');

function parsedRow(date, merchant, amountMajor) {
  return {
    date,
    raw_merchant: merchant,
    file_amount: amountMajor,
    canonical_amount: amountMajor,
  };
}

test('runImportPlanning — zero parsed rows returns empty PersistPlan', async () => {
  const plan = await runImportPlanning('user-1', [], {
    importAccountId: 'acc-1',
    newTransactionIds: [],
  });

  assert.deepEqual(plan, {
    toInsert: [],
    existingPatches: [],
    retiredClusterIds: [],
    clusterHints: {},
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
        [parsedRow(1_700_000_000_000, 'Coffee', -5)],
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
        [parsedRow(1_700_000_000_000, 'Coffee', -5)],
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
  const parsed = [parsedRow(1_700_000_000_000, 'Coffee Shop', -4.5)];
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
  assert.equal(plan.toInsert[0].canonicalAmount.units, -450);
  assert.equal(plan.existingPatches.length, 0);
  assert.equal(plan.summary.newClustersTouched, 1);
  assert.equal(plan.summary.knownMerchants + plan.summary.unknownMerchants, 1);
});

test('runImportPlanning — §6.0 remint retires prior cluster ids on existing rows', async () => {
  const priorClusterId = 'CL_prior_merchant';
  const existingTxn = {
    id: 'txn-existing-1',
    user_id: 'user-1',
    date: 1_699_000_000_000,
    raw_merchant: 'Coffee Shop',
    cleaned_merchant: 'coffee shop',
    canonicalAmount: money(-300),
    cluster_id: priorClusterId,
    category: 'Food',
    status: 'CLASSIFIED',
    is_recurring: false,
    transaction_file_id: 'file-old',
  };
  const parsed = [parsedRow(1_700_000_000_000, 'Coffee Shop', -4.5)];

  const plan = await runImportPlanning('user-1', parsed, {
    importAccountId: 'acc-checking',
    importCurrency: 'USD',
    newTransactionIds: ['txn-new-1'],
    ledgerSnapshot: {
      transactions: [existingTxn],
      fileIdToAccountId: new Map([['file-old', 'acc-checking']]),
    },
    physicalGroupLabels: [0, 0],
  });

  assert.equal(plan.toInsert.length, 1);
  assert.notEqual(plan.toInsert[0].cluster_id, priorClusterId);
  assert.equal(plan.existingPatches.length, 1);
  assert.notEqual(plan.existingPatches[0].cluster_id, priorClusterId);
  assert.equal(plan.existingPatches[0].cluster_id, plan.toInsert[0].cluster_id);
  assert.ok(plan.retiredClusterIds.includes(priorClusterId));

  const remintedId = plan.toInsert[0].cluster_id;
  assert.equal(plan.clusterHints[remintedId]?.previousCategoryId, 'Food');
});

test('runImportPlanning — injected embedder bypasses model load (§4.7 Q3)', async () => {
  let embedCalls = 0;
  const stubEmbedder = {
    usesModel: false,
    embed: async () => {
      embedCalls += 1;
      return new Float32Array([0.1, 0.2, 0.3]);
    },
  };
  const parsed = [parsedRow(1_700_000_000_000, 'Coffee Shop', -4.5)];

  const plan = await runImportPlanning('user-1', parsed, {
    importAccountId: 'acc-checking',
    importCurrency: 'USD',
    newTransactionIds: ['txn-new-1'],
    ledgerSnapshot: {
      transactions: [],
      fileIdToAccountId: new Map(),
    },
    embedder: stubEmbedder,
    physicalGroupLabels: [0],
  });

  assert.ok(embedCalls > 0);
  assert.equal(plan.toInsert.length, 1);
});
