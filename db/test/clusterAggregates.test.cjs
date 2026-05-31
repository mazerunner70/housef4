const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money } = require('@housef4/money');

const {
  buildClusterAggregateItem,
  clusterMembersFromTransactionItems,
  liveClusterIdsFromImportPlan,
  authoritativeAssignedCategory,
  computeClusterPendingReview,
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
      canonicalAmount: money(-1000),
      category: 'Food',
      status: 'CLASSIFIED',
      suggested_category: 'Food',
      category_confidence: 0.9,
    },
    {
      raw_merchant: 'Shop B',
      canonicalAmount: money(-500),
      category: 'Food',
      status: 'PENDING_REVIEW',
      suggested_category: 'Food',
      category_confidence: 0.5,
    },
  ], { currency: 'USD' });
  assert.equal(item.SK, clusterSk('CL_x'));
  assert.equal(item.total_transactions, 2);
  assert.equal(item.total_amount_minor, 1500);
  assert.equal(item.pending_review, true);
  assert.equal(item.suggested_category, 'Food');
  assert.equal(item.assigned_category, 'Food');
});

test('§7 — previous_category_id set when hint provided', () => {
  const pk = userPk('user-1');
  const item = buildClusterAggregateItem(
    pk,
    'CL_x',
    [
      {
        raw_merchant: 'Shop',
        canonicalAmount: money(-1000),
        category: 'Food',
        status: 'CLASSIFIED',
      },
    ],
    { currency: 'USD', previousCategoryId: 'Groceries' },
  );
  assert.equal(item.previous_category_id, 'Groceries');
  assert.equal(item.pending_review, true);
});

test('§7 — matching previous_category_id clears pending_review', () => {
  const pk = userPk('user-1');
  const item = buildClusterAggregateItem(
    pk,
    'CL_x',
    [
      {
        raw_merchant: 'Shop',
        canonicalAmount: money(-1000),
        category: 'Food',
        status: 'CLASSIFIED',
      },
    ],
    { currency: 'USD', previousCategoryId: 'Food' },
  );
  assert.equal(item.pending_review, false);
});

test('§7 — absent previous_category_id falls back to member status', () => {
  assert.equal(
    computeClusterPendingReview('Food', null, [
      { raw_merchant: 'A', canonicalAmount: money(-100), category: 'Food', status: 'CLASSIFIED' },
    ]),
    false,
  );
  assert.equal(
    computeClusterPendingReview('Food', null, [
      {
        raw_merchant: 'A',
        canonicalAmount: money(-100),
        category: 'Uncategorized',
        status: 'PENDING_REVIEW',
      },
    ]),
    true,
  );
});

test('authoritativeAssignedCategory — prefers user assignment over propagated', () => {
  const members = [
    { raw_merchant: 'A', canonicalAmount: money(-100), category: 'Food', status: 'CLASSIFIED' },
  ];
  assert.equal(authoritativeAssignedCategory(members, 'Travel'), 'Travel');
  assert.equal(authoritativeAssignedCategory(members, null), 'Food');
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
      amount_minor: -100,
      category: 'Food',
      status: 'CLASSIFIED',
    },
    {
      PK: pk,
      SK: txnSk('t2'),
      entity_type: 'TRANSACTION',
      cluster_id: 'CL_b',
      raw_merchant: 'B',
      amount_minor: -200,
      category: 'Food',
      status: 'CLASSIFIED',
    },
  ];
  assert.equal(clusterMembersFromTransactionItems(items, 'CL_a').length, 1);
});
