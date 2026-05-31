const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money } = require('@housef4/money');

const {
  buildPersistPlan,
  insertsFromNewRows,
  patchesForChangedRows,
  summarizeInserts,
} = require('../dist/services/import/planning/buildPersistPlan');

const INTERNAL_TRANSFER_EMBEDDING = new Float32Array([0.1, 0.2, 0.3]);

function existingTxn(overrides = {}) {
  return {
    id: 'txn-existing-1',
    user_id: 'user-1',
    date: 1_699_000_000_000,
    raw_merchant: 'Coffee Shop',
    cleaned_merchant: 'coffee shop',
    canonicalAmount: money(-300),
    cluster_id: 'CL_old',
    category: 'Food',
    status: 'CLASSIFIED',
    is_recurring: false,
    transaction_file_id: 'file-old',
    merchant_embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

function assignment(overrides = {}) {
  return {
    cluster_id: 'CL_old',
    category: 'Food',
    status: 'CLASSIFIED',
    suggested_category: null,
    category_confidence: 1,
    match_type: 'INHERITED',
    known_merchant: true,
    embedding: INTERNAL_TRANSFER_EMBEDDING,
    ...overrides,
  };
}

test('patchesForChangedRows — skips unchanged existing rows', () => {
  const old = existingTxn();
  const a = assignment();

  assert.deepEqual(patchesForChangedRows([old], [a]), []);
});

test('patchesForChangedRows — emits patch when cluster_id changes', () => {
  const old = existingTxn();
  const a = assignment({ cluster_id: 'CL_new' });

  const patches = patchesForChangedRows([old], [a]);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, 'txn-existing-1');
  assert.equal(patches[0].cluster_id, 'CL_new');
  assert.equal(patches[0].category, 'Food');
});

test('patchesForChangedRows — emits patch when pairing assignment is new', () => {
  const old = existingTxn();
  const a = assignment();

  const patches = patchesForChangedRows([old], [a], {
    'txn-existing-1': {
      pairing_id: 'pair-1',
      pairing_source: 'INGEST',
      pairing_confidence: 0.9,
    },
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].pairing_id, 'pair-1');
  assert.equal(patches[0].pairing_source, 'INGEST');
});

test('patchesForChangedRows — rejects misaligned existing vs assignments', () => {
  assert.throws(
    () => patchesForChangedRows([existingTxn()], []),
    /zipStrict: length mismatch/,
  );
});

test('summarizeInserts — counts known, unknown, and unique clusters', () => {
  const summary = summarizeInserts(
    [
      { known_merchant: true, cluster_id: 'CL_a' },
      { known_merchant: true, cluster_id: 'CL_b' },
      { known_merchant: false, cluster_id: 'CL_b' },
    ],
    3,
  );

  assert.deepEqual(summary, {
    importRowCount: 3,
    knownMerchants: 2,
    unknownMerchants: 1,
    newClustersTouched: 2,
  });
});

test('buildPersistPlan — composes patches, inserts, retired clusters, summary', () => {
  const existing = [existingTxn({ cluster_id: 'CL_retired' })];
  const existingSorted = existing;
  const parsedLength = 1;
  const newAssignment = assignment({
    cluster_id: 'CL_new',
    embedding: new Float32Array([0.5, 0.6, 0.7]),
    known_merchant: false,
    status: 'PENDING_REVIEW',
    category: 'Uncategorized',
    match_type: 'ML',
  });
  const existingAssignment = assignment({ cluster_id: 'CL_new' });

  const plan = buildPersistPlan({
    userId: 'user-1',
    parsedLength,
    existing,
    pairingByLegId: {},
    pipeline: {
      sources: [
        { kind: 'existing', record: existing[0] },
        {
          kind: 'new',
          id: 'txn-new-1',
          row: {
            date: 1_700_000_000_000,
            raw_merchant: 'Unknown Vendor',
            file_amount: -10,
            canonical_amount: -10,
          },
        },
      ],
      assignments: [existingAssignment, newAssignment],
      clusterSuggestions: new Map(),
      clusterHints: { CL_new: { previousCategoryId: 'Food' } },
      existingSorted,
    },
    importCurrency: 'USD',
  });

  assert.equal(plan.existingPatches.length, 1);
  assert.equal(plan.existingPatches[0].cluster_id, 'CL_new');
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.toInsert[0].id, 'txn-new-1');
  assert.equal(plan.toInsert[0].known_merchant, false);
  assert.deepEqual(plan.retiredClusterIds, ['CL_retired']);
  assert.deepEqual(plan.clusterHints, { CL_new: { previousCategoryId: 'Food' } });
  assert.deepEqual(plan.summary, {
    importRowCount: 1,
    knownMerchants: 0,
    unknownMerchants: 1,
    newClustersTouched: 1,
  });
});

test('insertsFromNewRows — maps new sources only', () => {
  const inserts = insertsFromNewRows(
    'user-1',
    [
      { kind: 'existing', record: existingTxn() },
      {
        kind: 'new',
        id: 'txn-new-1',
        row: {
          date: 1_700_000_000_000,
          raw_merchant: 'Rent',
          file_amount: -1000,
          canonical_amount: -1000,
        },
      },
    ],
    [assignment(), assignment({ cluster_id: 'CL_rent' })],
    1,
    'USD',
  );

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].id, 'txn-new-1');
  assert.equal(inserts[0].raw_merchant, 'Rent');
  assert.equal(inserts[0].cluster_id, 'CL_rent');
});
