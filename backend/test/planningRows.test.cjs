const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money } = require('@housef4/money');

const {
  buildPlanningRows,
  clusterableRows,
  partitionPlanningRows,
} = require('../dist/services/import/planning/planningRows');

function existingTxn(id, date, pairingId) {
  return {
    id,
    user_id: 'user-1',
    date,
    raw_merchant: `Merchant ${id}`,
    canonicalAmount: money(-1000),
    cluster_id: 'CL_old',
    category: 'Food',
    status: 'CLASSIFIED',
    is_recurring: false,
    transaction_file_id: 'file-old',
    ...(pairingId && { pairing_id: pairingId }),
  };
}

function parsedRow(rawMerchant, date = 1_700_000_000_000) {
  return {
    date,
    raw_merchant: rawMerchant,
    file_amount: -5,
    canonical_amount: -5,
  };
}

test('buildPlanningRows — zipWith aligns parsed rows with new transaction ids', () => {
  const parsed = [parsedRow('Coffee'), parsedRow('Rent')];
  const rows = buildPlanningRows([], parsed, ['txn-a', 'txn-b'], new Set());

  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'new');
  assert.equal(rows[0].id, 'txn-a');
  assert.equal(rows[0].row.raw_merchant, 'Coffee');
  assert.equal(rows[1].id, 'txn-b');
  assert.equal(rows[1].row.raw_merchant, 'Rent');
});

test('buildPlanningRows — rejects id / parsed length mismatch', () => {
  assert.throws(
    () => buildPlanningRows([], [parsedRow('Coffee')], ['a', 'b'], new Set()),
    /newTransactionIds length must match parsed rows/,
  );
});

test('buildPlanningRows — sortBy orders existing before new rows', () => {
  const existing = [
    existingTxn('txn-late', 2_000),
    existingTxn('txn-early', 1_000),
  ];
  const parsed = [parsedRow('New purchase')];

  const rows = buildPlanningRows(existing, parsed, ['txn-new'], new Set());

  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, 'existing');
  assert.equal(rows[0].id, 'txn-early');
  assert.equal(rows[1].id, 'txn-late');
  assert.equal(rows[2].kind, 'new');
  assert.equal(rows[2].id, 'txn-new');
});

test('buildPlanningRows — paired legs are non-clusterable', () => {
  const parsed = [parsedRow('Transfer out'), parsedRow('Coffee')];
  const pairedTxnIds = new Set(['txn-paired']);

  const rows = buildPlanningRows([], parsed, ['txn-paired', 'txn-open'], pairedTxnIds);

  assert.deepEqual(
    rows.map((r) => ({ id: r.id, clusterable: r.clusterable })),
    [
      { id: 'txn-paired', clusterable: false },
      { id: 'txn-open', clusterable: true },
    ],
  );
});

test('buildPlanningRows — existing rows with pairing_id excluded via pairedTxnIds', () => {
  const existing = [
    existingTxn('txn-open', 1_000),
    existingTxn('txn-paired', 1_100, 'pair-1'),
  ];
  const pairedTxnIds = new Set(['txn-paired']);

  const rows = buildPlanningRows(existing, [], [], pairedTxnIds);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].clusterable, true);
  assert.equal(rows[1].clusterable, false);
});

test('clusterableRows and partitionPlanningRows — preserve counts', () => {
  const rows = buildPlanningRows(
    [existingTxn('txn-paired', 1_000, 'pair-1'), existingTxn('txn-open', 1_100)],
    [parsedRow('Transfer'), parsedRow('Coffee')],
    ['txn-new-paired', 'txn-new-open'],
    new Set(['txn-paired', 'txn-new-paired']),
  );

  const { clusterable, nonClusterable } = partitionPlanningRows(rows);

  assert.equal(rows.length, 4);
  assert.equal(clusterable.length, 2);
  assert.equal(nonClusterable.length, 2);
  assert.deepEqual(
    clusterable.map((r) => r.id),
    ['txn-open', 'txn-new-open'],
  );
  assert.deepEqual(
    nonClusterable.map((r) => r.id),
    ['txn-paired', 'txn-new-paired'],
  );
  assert.deepEqual(clusterableRows(rows).map((r) => r.id), ['txn-open', 'txn-new-open']);
});
