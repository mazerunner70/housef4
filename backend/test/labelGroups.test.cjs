const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  splitNoiseLabels,
  groupIndicesByLabel,
  resolvePhysicalGroupLabels,
} = require('../dist/services/import/clustering/labelGroups');

test('splitNoiseLabels: each -1 becomes its own singleton group label', () => {
  assert.deepEqual(splitNoiseLabels([-1, -1, 0]), [-1000000, -1000001, 0]);
});

test('splitNoiseLabels: non-noise labels are unchanged', () => {
  assert.deepEqual(splitNoiseLabels([0, 0, 1]), [0, 0, 1]);
});

test('groupIndicesByLabel — lodash groupBy over source indices', () => {
  const byLabel = groupIndicesByLabel([0, 0, 1, 0]);
  assert.deepEqual(byLabel.get(0), [0, 1, 3]);
  assert.deepEqual(byLabel.get(1), [2]);
});

test('resolvePhysicalGroupLabels — rejects length mismatch for test hook', () => {
  assert.throws(
    () => resolvePhysicalGroupLabels(2, [[0], [0]], [0]),
    /physicalGroupLabels length must match clusterable sources/,
  );
});

test('resolvePhysicalGroupLabels — splits noise in test hook labels', () => {
  const labels = resolvePhysicalGroupLabels(2, [[0], [0]], [-1, -1]);
  assert.deepEqual(labels, [-1000000, -1000001]);
});
