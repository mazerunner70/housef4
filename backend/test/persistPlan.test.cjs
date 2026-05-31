const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money } = require('@housef4/money');

const {
  persistImportPlan,
  toImportPersistPlan,
} = require('../dist/services/import/planning/persistPlan');

const STAGE_10_ORDER = [
  'patchExistingTransactionsAfterImport',
  'ingestImportBatch',
  'rebuildClusterAggregatesAfterImport',
  'retireClusterAggregates',
];

function createStubRepo(overrides = {}) {
  const callLog = [];
  const log = (name) => callLog.push(name);

  const repo = {
    callLog,

    patchExistingTransactionsAfterImport: async (_userId, patches) => {
      log('patchExistingTransactionsAfterImport');
      repo.lastPatches = patches;
    },

    ingestImportBatch: async (_userId, rows, transactionFileId, fileCurrency) => {
      log('ingestImportBatch');
      repo.lastIngest = { rows, transactionFileId, fileCurrency };
      return (
        overrides.ingestResult ?? {
          rowCount: rows.length,
          knownMerchants: 1,
          unknownMerchants: 0,
          newClustersTouched: 1,
        }
      );
    },

    retireClusterAggregates: async (_userId, clusterIds) => {
      log('retireClusterAggregates');
      repo.lastRetiredClusterIds = clusterIds;
    },

    rebuildClusterAggregatesAfterImport: async (_userId, clusterIds, fileCurrency, clusterHints) => {
      log('rebuildClusterAggregatesAfterImport');
      repo.lastRebuiltClusterIds = clusterIds;
      repo.lastRebuildCurrency = fileCurrency;
      repo.lastClusterHints = clusterHints;
    },
  };

  return repo;
}

function samplePlan(overrides = {}) {
  return {
    toInsert: [
      {
        user_id: 'user-1',
        id: 'txn_new_1',
        date: 1_700_000_000_000,
        raw_merchant: 'Coffee Shop',
        cleaned_merchant: 'coffee shop',
        canonicalAmount: money(-450),
        fileAmount: money(450),
        cluster_id: 'CL_abc',
        category: 'Food',
        status: 'PENDING_REVIEW',
        is_recurring: false,
        known_merchant: true,
      },
    ],
    existingPatches: [{ id: 'txn_old_1', cluster_id: 'CL_xyz', category: 'Food', status: 'PENDING_REVIEW' }],
    retiredClusterIds: ['CL_retired'],
    clusterHints: { CL_abc: { previousCategoryId: null }, CL_xyz: { previousCategoryId: 'Food' } },
    summary: {
      importRowCount: 1,
      knownMerchants: 1,
      unknownMerchants: 0,
      newClustersTouched: 1,
    },
    ...overrides,
  };
}

function assertStage10Order(callLog) {
  const indices = STAGE_10_ORDER.map((name) => callLog.indexOf(name));
  assert.ok(
    indices.every((i) => i >= 0),
    `expected stage-10 writes in callLog: ${STAGE_10_ORDER.join(', ')}; got ${callLog.join(', ')}`,
  );
  for (let i = 1; i < indices.length; i++) {
    assert.ok(
      indices[i] > indices[i - 1],
      `${STAGE_10_ORDER[i]} must run after ${STAGE_10_ORDER[i - 1]}`,
    );
  }
}

test('persistImportPlan — §8.6 write order patch → ingest → rebuild → retire', async () => {
  const repo = createStubRepo();
  const plan = samplePlan();
  const userId = 'user-1';
  const importFileId = 'file-uuid-1';

  const result = await persistImportPlan({
    userId,
    repo,
    plan,
    importFileId,
    fileCurrency: 'USD',
  });

  assertStage10Order(repo.callLog);
  assert.deepEqual(repo.lastPatches, plan.existingPatches);
  assert.equal(repo.lastIngest.transactionFileId, importFileId);
  assert.equal(repo.lastIngest.fileCurrency, 'USD');
  assert.deepEqual(repo.lastIngest.rows, plan.toInsert);
  assert.deepEqual(repo.lastRetiredClusterIds, plan.retiredClusterIds);
  assert.deepEqual(repo.lastRebuiltClusterIds, ['CL_abc', 'CL_xyz']);
  assert.equal(repo.lastRebuildCurrency, 'USD');
  assert.deepEqual(repo.lastClusterHints, plan.clusterHints);
  assert.equal(result.rowCount, 1);
  assert.equal(result.knownMerchants, 1);
});

test('persistImportPlan — empty plan still runs all four stages', async () => {
  const repo = createStubRepo({
    ingestResult: {
      rowCount: 0,
      knownMerchants: 0,
      unknownMerchants: 0,
      newClustersTouched: 0,
    },
  });
  const plan = samplePlan({
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

  await persistImportPlan({
    userId: 'user-1',
    repo,
    plan,
    importFileId: 'file-empty',
  });

  assertStage10Order(repo.callLog);
  assert.deepEqual(repo.lastPatches, []);
  assert.deepEqual(repo.lastIngest.rows, []);
  assert.deepEqual(repo.lastRetiredClusterIds, []);
  assert.deepEqual(repo.lastRebuiltClusterIds, []);
});

test('toImportPersistPlan — projects write intents for staging (§8.7)', () => {
  const plan = samplePlan();
  assert.deepEqual(toImportPersistPlan(plan), {
    toInsert: plan.toInsert,
    existingPatches: plan.existingPatches,
    retiredClusterIds: plan.retiredClusterIds,
    clusterHints: plan.clusterHints,
  });
  assert.equal('summary' in toImportPersistPlan(plan), false);
});
