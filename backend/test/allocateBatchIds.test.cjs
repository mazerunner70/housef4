const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateBatchArtefactIds,
} = require('../dist/services/import/allocateBatchIds');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TXN_ID_RE = /^txn_[0-9a-f]{32}$/i;

test('allocateBatchArtefactIds — zero rows mints import file id only', () => {
  const { importFileId, transactionIds } = allocateBatchArtefactIds(0);

  assert.match(importFileId, UUID_RE);
  assert.deepEqual(transactionIds, []);
});

test('allocateBatchArtefactIds — row count matches transaction id array length', () => {
  const rowCount = 5;
  const { transactionIds } = allocateBatchArtefactIds(rowCount);

  assert.equal(transactionIds.length, rowCount);
  for (let i = 0; i < rowCount; i++) {
    assert.match(transactionIds[i], TXN_ID_RE);
  }
});

test('allocateBatchArtefactIds — all transaction ids are unique within the batch', () => {
  const { transactionIds } = allocateBatchArtefactIds(20);
  assert.equal(new Set(transactionIds).size, transactionIds.length);
});

test('allocateBatchArtefactIds — rejects negative and non-integer row counts', () => {
  assert.throws(
    () => allocateBatchArtefactIds(-1),
    /non-negative integer/,
  );
  assert.throws(
    () => allocateBatchArtefactIds(1.5),
    /non-negative integer/,
  );
});
