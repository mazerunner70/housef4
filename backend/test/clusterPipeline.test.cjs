const { test } = require('node:test');
const assert = require('node:assert/strict');

const { splitNoiseLabels, unanimousPriorCategoryForGroup } = require('../dist/services/import/clustering/clusterPipeline');

test('splitNoiseLabels: each -1 becomes its own singleton group label', () => {
  assert.deepEqual(splitNoiseLabels([-1, -1, 0]), [-1000000, -1000001, 0]);
});

test('splitNoiseLabels: non-noise labels are unchanged', () => {
  assert.deepEqual(splitNoiseLabels([0, 0, 1]), [0, 0, 1]);
});

test('unanimousPriorCategoryForGroup — unanimous existing categories', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    { kind: 'new', row: {}, id: 'n1' },
  ];
  assert.equal(unanimousPriorCategoryForGroup([0, 1, 2], sources), 'Food');
});

test('unanimousPriorCategoryForGroup — mixed existing categories returns null', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Travel', status: 'CLASSIFIED' },
    },
  ];
  assert.equal(unanimousPriorCategoryForGroup([0, 1], sources), null);
});

test('unanimousPriorCategoryForGroup — new-only group returns null', () => {
  const sources = [{ kind: 'new', row: {}, id: 'n1' }];
  assert.equal(unanimousPriorCategoryForGroup([0], sources), null);
});
