const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  findSplitClusterIds,
  buildPreviousIdSet,
  resolveClusterIdByPhysicalGroup,
} = require('../dist/services/import/clusterIdentity');

test('buildPreviousIdSet: collects existing cluster ids in group', () => {
  const kind = ['existing', 'new', 'existing'];
  const prev = ['CL_AA', undefined, 'CL_AA'];
  const s = buildPreviousIdSet([0, 1, 2], kind, prev);
  assert.equal(s.size, 1);
  assert.ok(s.has('CL_AA'));
});

test('findSplitClusterIds: one id in two label buckets is split', () => {
  const labels = [0, 0, 1];
  const kind = ['existing', 'existing', 'existing'];
  const prev = ['C1', 'C1', 'C1'];
  const split = findSplitClusterIds(labels, kind, prev);
  assert.ok(split.has('C1'));
});

test('findSplitClusterIds: same bucket is not split', () => {
  const labels = [0, 0, 0];
  const kind = ['existing', 'existing', 'existing'];
  const prev = ['C1', 'C1', 'C1'];
  const split = findSplitClusterIds(labels, kind, prev);
  assert.equal(split.size, 0);
});

test('resolveClusterId: merge mints a new id', () => {
  const byLabel = new Map([
    [0, [0, 1]],
  ]);
  const kind = ['existing', 'existing'];
  const prev = ['A', 'B'];
  const split = new Set();
  const cleaned = ['a', 'b'];
  const embeddings = [new Float32Array([1, 0, 0]), new Float32Array([1, 0, 0])];
  const r = resolveClusterIdByPhysicalGroup(
    byLabel,
    kind,
    prev,
    split,
    cleaned,
    embeddings,
  );
  const row = r.get(0);
  assert.equal(row.conserve, false);
  assert.match(row.cluster_id, /^CL_[0-9a-f]+/);
  assert.notEqual(row.cluster_id, 'A');
  assert.notEqual(row.cluster_id, 'B');
});

test('resolveClusterId: conservation when single id and not split', () => {
  const byLabel = new Map([
    [0, [0, 1]],
  ]);
  const kind = ['existing', 'new'];
  const prev = ['SAME', undefined];
  const split = new Set();
  const cleaned = ['a', 'b'];
  const embeddings = [new Float32Array([1, 0, 0]), new Float32Array([0.9, 0.1, 0])];
  const r = resolveClusterIdByPhysicalGroup(
    byLabel,
    kind,
    prev,
    split,
    cleaned,
    embeddings,
  );
  const row = r.get(0);
  assert.equal(row.conserve, true);
  assert.equal(row.cluster_id, 'SAME');
});

test('resolveClusterId: split fragment re-mints (does not keep C)', () => {
  const byLabel = new Map([
    [0, [0, 1]],
  ]);
  const kind = ['existing', 'existing'];
  const prev = ['Cfrag', 'Cfrag'];
  const split = new Set(['Cfrag']);
  const cleaned = ['a', 'a'];
  const embeddings = [new Float32Array([1, 0, 0]), new Float32Array([1, 0, 0])];
  const r = resolveClusterIdByPhysicalGroup(
    byLabel,
    kind,
    prev,
    split,
    cleaned,
    embeddings,
  );
  const row = r.get(0);
  assert.equal(row.conserve, false);
  assert.notEqual(row.cluster_id, 'Cfrag');
  assert.match(row.cluster_id, /^CL_[0-9a-f]+/);
});
