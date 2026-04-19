const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  dbscanCosine,
  cosineDistance,
} = require('../dist/services/import/dbscanCosine');

function norm3(x, y, z) {
  const n = Math.hypot(x, y, z) || 1;
  return new Float32Array([x / n, y / n, z / n]);
}

test('cosineDistance: identical vectors', () => {
  const a = norm3(1, 0, 0);
  assert.equal(cosineDistance(a, a), 0);
});

test('dbscanCosine: two dense pairs with noise', () => {
  const a = norm3(1, 0, 0);
  const b = norm3(0.99, 0.01, 0);
  const c = norm3(0, 1, 0);
  const d = norm3(0.01, 0.99, 0);
  const o = norm3(0, 0, 1);
  const labels = dbscanCosine([a, b, c, d, o], 0.05, 2);
  assert.equal(labels.length, 5);
  assert.equal(labels[0], labels[1]);
  assert.equal(labels[2], labels[3]);
  assert.notEqual(labels[0], labels[2]);
  assert.equal(labels[4], -1);
});
