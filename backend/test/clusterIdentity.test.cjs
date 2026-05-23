const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  findSplitClusterIds,
  buildPreviousIdSet,
  priorClusterIdsForGroup,
  resolveClusterIdByPhysicalGroup,
} = require('../dist/services/import/clusterIdentity');

test('buildPreviousIdSet: collects existing cluster ids in group', () => {
  const kind = ['existing', 'new', 'existing'];
  const prev = ['CL_AA', undefined, 'CL_AA'];
  const s = buildPreviousIdSet([0, 1, 2], kind, prev);
  assert.equal(s.size, 1);
  assert.ok(s.has('CL_AA'));
});

test('priorClusterIdsForGroup: distinct sorted predecessors', () => {
  const kind = ['existing', 'existing'];
  const prev = ['B', 'A'];
  assert.deepEqual(priorClusterIdsForGroup([0, 1], kind, prev), ['A', 'B']);
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

test('resolveClusterId: merge remints and records prior_cluster_ids', () => {
  const byLabel = new Map([
    [0, [0, 1]],
  ]);
  const kind = ['existing', 'existing'];
  const prev = ['A', 'B'];
  const r = resolveClusterIdByPhysicalGroup(byLabel, kind, prev);
  const row = r.get(0);
  assert.deepEqual(row.prior_cluster_ids, ['A', 'B']);
  assert.match(row.cluster_id, /^CL_[0-9a-f]+/);
  assert.notEqual(row.cluster_id, 'A');
  assert.notEqual(row.cluster_id, 'B');
});

test('resolveClusterId: §6.0 remints even when single prior id and not split', () => {
  const byLabel = new Map([
    [0, [0, 1]],
  ]);
  const kind = ['existing', 'new'];
  const prev = ['SAME', undefined];
  const r = resolveClusterIdByPhysicalGroup(byLabel, kind, prev);
  const row = r.get(0);
  assert.deepEqual(row.prior_cluster_ids, ['SAME']);
  assert.notEqual(row.cluster_id, 'SAME');
  assert.match(row.cluster_id, /^CL_[0-9a-f]+/);
});

test('resolveClusterId: split fragment remints with prior_cluster_ids', () => {
  const byLabel = new Map([
    [0, [0, 1]],
  ]);
  const kind = ['existing', 'existing'];
  const prev = ['Cfrag', 'Cfrag'];
  const r = resolveClusterIdByPhysicalGroup(byLabel, kind, prev);
  const row = r.get(0);
  assert.deepEqual(row.prior_cluster_ids, ['Cfrag']);
  assert.notEqual(row.cluster_id, 'Cfrag');
  assert.match(row.cluster_id, /^CL_[0-9a-f]+/);
});

test('resolveClusterId: new-only group has empty prior_cluster_ids', () => {
  const byLabel = new Map([[0, [0]]]);
  const kind = ['new'];
  const prev = [undefined];
  const r = resolveClusterIdByPhysicalGroup(byLabel, kind, prev);
  const row = r.get(0);
  assert.deepEqual(row.prior_cluster_ids, []);
  assert.match(row.cluster_id, /^CL_[0-9a-f]+/);
});

test('resolveClusterId: distinct groups receive distinct minted ids', () => {
  const byLabel = new Map([
    [0, [0]],
    [1, [1]],
  ]);
  const kind = ['existing', 'existing'];
  const prev = ['OLD_A', 'OLD_B'];
  const r = resolveClusterIdByPhysicalGroup(byLabel, kind, prev);
  const a = r.get(0);
  const b = r.get(1);
  assert.notEqual(a.cluster_id, b.cluster_id);
  assert.notEqual(a.cluster_id, 'OLD_A');
  assert.notEqual(b.cluster_id, 'OLD_B');
});
