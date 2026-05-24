const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  groupBy,
  zipWith,
  zipStrict,
  flow,
  compact,
} = require('../dist/services/import/utils/lodashImport');

test('groupBy indexes rows by key', () => {
  const rows = [
    { id: 'a', cluster: 1 },
    { id: 'b', cluster: 2 },
    { id: 'c', cluster: 1 },
  ];
  const byCluster = groupBy(rows, (r) => r.cluster);
  assert.deepEqual(Object.keys(byCluster).sort(), ['1', '2']);
  assert.equal(byCluster['1'].length, 2);
  assert.equal(byCluster['2'][0].id, 'b');
});

test('zipWith aligns parallel arrays', () => {
  const ids = ['t1', 't2'];
  const amounts = [10, -5];
  const paired = zipWith(ids, amounts, (id, amount) => ({ id, amount }));
  assert.deepEqual(paired, [
    { id: 't1', amount: 10 },
    { id: 't2', amount: -5 },
  ]);
});

test('zipStrict throws on length mismatch', () => {
  assert.throws(
    () => zipStrict(['a'], [1, 2]),
    /zipStrict: length mismatch \(1 vs 2\)/,
  );
});

test('zipStrict pairs equal-length arrays', () => {
  assert.deepEqual(
    zipStrict(['x', 'y'], [1, 2]),
    [
      ['x', 1],
      ['y', 2],
    ],
  );
});

test('flow composes unary transforms left-to-right', () => {
  const parseLike = flow(
    (text) => text.split(','),
    (parts) => parts.map((p) => p.trim()),
    compact,
  );
  assert.deepEqual(parseLike('a, ,b'), ['a', 'b']);
});

test('compact drops nullish and falsey holes from arrays', () => {
  assert.deepEqual(compact([0, 1, null, 2, undefined, false, 'x']), [1, 2, 'x']);
});
