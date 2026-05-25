const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  levenshteinDistance,
  merchantsMatch,
  mergeLabelsByCleanedMerchant,
} = require('../dist/services/import/clustering/merchantStringMatch');

test('levenshteinDistance — identical strings', () => {
  assert.equal(levenshteinDistance('abc', 'abc'), 0);
});

test('levenshteinDistance — single edit', () => {
  assert.equal(levenshteinDistance('kitten', 'sitten'), 1);
});

test('merchantsMatch — exact mode', () => {
  const exact = { mode: 'exact', maxDistance: 2 };
  assert.equal(merchantsMatch('FOO', 'FOO', exact), true);
  assert.equal(merchantsMatch('FOO', 'FO', exact), false);
});

test('merchantsMatch — levenshtein mode', () => {
  const fuzzy = { mode: 'levenshtein', maxDistance: 2 };
  assert.equal(
    merchantsMatch('THESELFSTORAGECOMPAN, HEMEL', 'THESELFSTORAGECOMPAN HEMEL', fuzzy),
    true,
  );
});

test('mergeLabelsByCleanedMerchant — exact match merges noise singletons', () => {
  const merged = mergeLabelsByCleanedMerchant(
    [-1000000, -1000001, 0],
    ['THESELFSTORAGECOMPAN, HEMEL', 'THESELFSTORAGECOMPAN, HEMEL', 'INTEREST'],
    { mode: 'exact', maxDistance: 2 },
  );
  assert.equal(merged[0], merged[1]);
  assert.notEqual(merged[0], merged[2]);
});

test('mergeLabelsByCleanedMerchant — off leaves labels unchanged', () => {
  const labels = [-1000000, -1000001];
  const merged = mergeLabelsByCleanedMerchant(
    labels,
    ['SAME', 'SAME'],
    { mode: 'off', maxDistance: 2 },
  );
  assert.deepEqual(merged, labels);
});
