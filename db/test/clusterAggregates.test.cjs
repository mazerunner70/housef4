const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClusterAggregateItem,
  clusterMembersFromTransactionItems,
  liveClusterIdsFromImportPlan,
} = require('../dist/clusterAggregates');
const { userPk, clusterSk, txnSk } = require('../dist/keys');

test('liveClusterIdsFromImportPlan — unions inserts and patches', () => {
  const ids = liveClusterIdsFromImportPlan({
    toInsert: [{ cluster_id: 'CL_b' }],
    existingPatches: [{ cluster_id: 'CL_a' }],
    retiredClusterIds: ['CL_old'],
  });
  assert.deepEqual(ids, ['CL_a', 'CL_b']);
});

test('buildClusterAggregateItem — rebuilds totals from all members', () => {
  const pk = userPk('user-1');
  const item = buildClusterAggregateItem(pk, 'CL_x', [
    {
      raw_merchant: 'Shop A',
      amount: -10,
      status: 'CLASSIFIED',
      suggested_category: 'Food',
      category_confidence: 0.9,
    },
    {
      raw_merchant: 'Shop B',
      amount: -5,
      status: 'PENDING_REVIEW',
      suggested_category: 'Food',
      category_confidence: 0.5,
    },
  ]);
  assert.equal(item.SK, clusterSk('CL_x'));
  assert.equal(item.total_transactions, 2);
  assert.equal(item.total_amount, 15);
  assert.equal(item.pending_review, true);
  assert.equal(item.suggested_category, 'Food');
});

test('clusterMembersFromTransactionItems — filters by cluster_id', () => {
  const pk = userPk('u1');
  const items = [
    {
      PK: pk,
      SK: txnSk('t1'),
      entity_type: 'TRANSACTION',
      cluster_id: 'CL_a',
      raw_merchant: 'A',
      amount: -1,
      status: 'CLASSIFIED',
    },
    {
      PK: pk,
      SK: txnSk('t2'),
      entity_type: 'TRANSACTION',
      cluster_id: 'CL_b',
      raw_merchant: 'B',
      amount: -2,
      status: 'CLASSIFIED',
    },
  ];
  assert.equal(clusterMembersFromTransactionItems(items, 'CL_a').length, 1);
});
