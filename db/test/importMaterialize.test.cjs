const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  materializeImportPlanToItems,
  validateMaterializedImportStaging,
} = require('../dist/importMaterialize');
const { userPk, txnSk, clusterSk, fileSk, PROFILE_SK } = require('../dist/keys');

const userId = 'user-mat-1';
const pk = userPk(userId);

function txnItem(id, clusterId, fileId = 'file-old') {
  return {
    PK: pk,
    SK: txnSk(id),
    GSI1PK: `${pk}#CLUSTER#${clusterId}`,
    GSI1SK: txnSk(id),
    GSI2PK: `${pk}#FILE#${fileId}`,
    GSI2SK: txnSk(id),
    entity_type: 'TRANSACTION',
    user_id: userId,
    id,
    date: 1_700_000_000_000,
    raw_merchant: 'Shop',
    amount: -10,
    category: 'Food',
    status: 'CLASSIFIED',
    is_recurring: false,
    transaction_file_id: fileId,
    cluster_id: clusterId,
  };
}

test('materializeImportPlanToItems — adds file row and new txn without mutating primary until promote', () => {
  const primary = [
    txnItem('t1', 'CL_old'),
    {
      PK: pk,
      SK: clusterSk('CL_old'),
      entity_type: 'CLUSTER',
      cluster_id: 'CL_old',
      sample_merchants: ['Shop'],
      total_transactions: 1,
      total_amount: 10,
      suggested_category: null,
      assigned_category: 'Food',
      pending_review: false,
    },
    {
      PK: pk,
      SK: fileSk('file-old'),
      entity_type: 'TRANSACTION_FILE',
      user_id: userId,
      id: 'file-old',
      account_id: 'acc-1',
      source: { name: 'old.csv', size_bytes: 1 },
      format: {},
      timing: { started_at: 1, completed_at: 2 },
      result: { rowCount: 1 },
    },
  ];

  const plan = {
    toInsert: [
      {
        user_id: userId,
        id: 't-new',
        date: 1_700_100_000_000,
        raw_merchant: 'Cafe',
        cleaned_merchant: 'Cafe',
        amount: -5,
        cluster_id: 'CL_new',
        category: 'Food',
        status: 'CLASSIFIED',
        is_recurring: false,
        known_merchant: true,
        merchant_embedding: [0.1, 0.2],
        suggested_category: 'Food',
        category_confidence: 0.9,
        match_type: 'rule',
      },
    ],
    existingPatches: [
      {
        id: 't1',
        cluster_id: 'CL_remint',
        category: 'Food',
        status: 'CLASSIFIED',
        cleaned_merchant: 'Shop',
        merchant_embedding: [0.3, 0.4],
        suggested_category: 'Food',
        category_confidence: 0.8,
        match_type: 'rule',
      },
    ],
    retiredClusterIds: ['CL_old'],
  };

  const importFileId = 'file-new';
  const materialized = materializeImportPlanToItems({
    userId,
    importFileId,
    plan,
    primaryPartitionItems: primary,
    transactionFile: {
      id: importFileId,
      account_id: 'acc-1',
      source: { name: 'new.csv', size_bytes: 2 },
      format: {},
      timing: { started_at: 3, completed_at: 4 },
      result: { rowCount: 1 },
    },
  });

  validateMaterializedImportStaging(materialized, primary, plan);

  const patched = materialized.find((i) => i.id === 't1');
  assert.equal(patched.cluster_id, 'CL_remint');
  assert.ok(materialized.some((i) => i.id === 't-new'));
  assert.ok(materialized.some((i) => i.id === importFileId && i.entity_type === 'TRANSACTION_FILE'));
  assert.ok(!materialized.some((i) => i.cluster_id === 'CL_old' && i.entity_type === 'CLUSTER'));
  assert.ok(materialized.some((i) => i.cluster_id === 'CL_new' && i.entity_type === 'CLUSTER'));
});

test('materializeImportPlanToItems — zero-row import adds TRANSACTION_FILE only', () => {
  const primary = [
    {
      PK: pk,
      SK: fileSk('file-old'),
      entity_type: 'TRANSACTION_FILE',
      user_id: userId,
      id: 'file-old',
      account_id: 'acc-1',
      source: { name: 'old.csv', size_bytes: 1 },
      format: {},
      timing: { started_at: 1, completed_at: 2 },
      result: { rowCount: 0 },
    },
  ];
  const plan = { toInsert: [], existingPatches: [], retiredClusterIds: [] };
  const importFileId = 'file-empty';
  const materialized = materializeImportPlanToItems({
    userId,
    importFileId,
    plan,
    primaryPartitionItems: primary,
    transactionFile: {
      id: importFileId,
      account_id: 'acc-1',
      source: { name: 'empty.csv', size_bytes: 0 },
      format: {},
      timing: { started_at: 1, completed_at: 2 },
      result: { rowCount: 0 },
    },
  });
  validateMaterializedImportStaging(materialized, primary, plan);
  assert.equal(materialized.filter((i) => i.entity_type === 'TRANSACTION_FILE').length, 2);
  assert.ok(!materialized.some((i) => i.SK === PROFILE_SK));
});
