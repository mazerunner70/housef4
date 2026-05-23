const { test } = require('node:test');
const assert = require('node:assert/strict');

const { splitNoiseLabels } = require('../dist/services/import/clusterPipeline');

test('splitNoiseLabels: each -1 becomes its own singleton group label', () => {
  assert.deepEqual(splitNoiseLabels([-1, -1, 0]), [-1000000, -1000001, 0]);
});

test('splitNoiseLabels: non-noise labels are unchanged', () => {
  assert.deepEqual(splitNoiseLabels([0, 0, 1]), [0, 0, 1]);
});
