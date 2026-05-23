const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeAutoTransferPairings,
  computeAutoTransferPairingsSortedPools,
  utcCalendarDaysApart,
  utcDayOrdinal,
} = require('../dist/transferPairing');

function utc(year, month0, day) {
  return Date.UTC(year, month0, day);
}

test('utcCalendarDaysApart counts whole UTC calendar days', () => {
  assert.equal(utcCalendarDaysApart(Date.UTC(2024, 0, 1, 12), Date.UTC(2024, 0, 1, 18)), 0);
  assert.equal(utcCalendarDaysApart(utc(2024, 0, 1), utc(2024, 0, 5)), 4);
  assert.equal(utcCalendarDaysApart(utc(2024, 0, 1), utc(2024, 0, 6)), 5);
});

test('proposalRootIds skips proposals when roots never initiate', () => {
  const r = computeAutoTransferPairings(
    [
      { id: 'e1', account_id: 'a', date: utc(2024, 0, 1), amount: -10 },
      { id: 'e2', account_id: 'b', date: utc(2024, 0, 1), amount: 10 },
    ],
    {
      windowDays: 4,
      epsilon: 0,
      proposalRootIds: new Set(['nobody']),
      createPairingId: () => assert.fail('should not mint ids'),
    },
  );
  assert.deepEqual(r.byLegId, {});
});

test('proposalRootIds pairs when new leg initiates with counterparty', () => {
  let n = 0;
  const r = computeAutoTransferPairings(
    [
      { id: 'new1', account_id: 'a', date: utc(2024, 0, 1), amount: -10 },
      { id: 'old2', account_id: 'b', date: utc(2024, 0, 1), amount: 10 },
    ],
    {
      windowDays: 4,
      epsilon: 0,
      proposalRootIds: new Set(['new1']),
      createPairingId: () => `pid-${++n}`,
    },
  );
  assert.ok(r.byLegId.new1 && r.byLegId.old2);
});

test('empty input yields no assignments', () => {
  const r = computeAutoTransferPairings([], {
    windowDays: 4,
    epsilon: 0,
    createPairingId: () => assert.fail('should not mint ids'),
  });
  assert.deepEqual(r.byLegId, {});
});

test('pairs inverse amounts on different accounts with exact confidence', () => {
  let n = 0;
  const legs = [
    { id: 'out', account_id: 'acc_chk', date: utc(2024, 2, 10), amount: -250 },
    { id: 'in', account_id: 'acc_sv', date: utc(2024, 2, 10), amount: 250 },
  ];
  const r = computeAutoTransferPairings(legs, {
    windowDays: 4,
    epsilon: 0,
    createPairingId: () => `pid-${++n}`,
  });
  assert.equal(r.byLegId.out.pairing_id, r.byLegId.in.pairing_id);
  assert.equal(r.byLegId.out.pairing_source, 'auto');
  assert.equal(r.byLegId.out.pairing_confidence, 'exact');
  assert.equal(r.byLegId.in.pairing_confidence, 'exact');
});

test('respects epsilon for non-zero residual', () => {
  let n = 0;
  const legs = [
    { id: 'a', account_id: 'x', date: utc(2024, 1, 1), amount: -100.01 },
    { id: 'b', account_id: 'y', date: utc(2024, 1, 1), amount: 100 },
  ];
  const r = computeAutoTransferPairings(legs, {
    windowDays: 4,
    epsilon: 0.05,
    createPairingId: () => `pid-${++n}`,
  });
  assert.ok(r.byLegId.a);
  assert.equal(r.byLegId.a.pairing_confidence, 'within_epsilon');
});

test('does not pair same account', () => {
  const r = computeAutoTransferPairings(
    [
      { id: 'a', account_id: 'acc1', date: utc(2024, 0, 1), amount: -10 },
      { id: 'b', account_id: 'acc1', date: utc(2024, 0, 1), amount: 10 },
    ],
    { windowDays: 4, epsilon: 0, createPairingId: () => 'n/a' },
  );
  assert.deepEqual(r.byLegId, {});
});

test('does not pair when |Δt_ms| exceeds W × 86_400_000', () => {
  const r = computeAutoTransferPairings(
    [
      { id: 'a', account_id: 'x', date: utc(2024, 0, 1), amount: -50 },
      { id: 'b', account_id: 'y', date: utc(2024, 0, 6), amount: 50 },
    ],
    { windowDays: 4, epsilon: 0, createPairingId: () => 'n/a' },
  );
  assert.deepEqual(r.byLegId, {});
});

test('pairs when |Δt_ms| equals W × 86_400_000 (nominal boundary)', () => {
  let n = 0;
  const r = computeAutoTransferPairings(
    [
      { id: 'a', account_id: 'x', date: utc(2024, 0, 1), amount: -50 },
      { id: 'b', account_id: 'y', date: utc(2024, 0, 5), amount: 50 },
    ],
    { windowDays: 4, epsilon: 0, createPairingId: () => `pid-${++n}` },
  );
  assert.ok(r.byLegId.a && r.byLegId.b);
});

test('currency mismatch blocks pairing when both present', () => {
  const r = computeAutoTransferPairings(
    [
      { id: 'a', account_id: 'x', date: utc(2024, 0, 1), amount: -20, currency: 'USD' },
      { id: 'b', account_id: 'y', date: utc(2024, 0, 1), amount: 20, currency: 'EUR' },
    ],
    { windowDays: 4, epsilon: 0, createPairingId: () => 'n/a' },
  );
  assert.deepEqual(r.byLegId, {});
});

test('collision: two debits compete for one credit — first root in §4 order claims credit', () => {
  let n = 0;
  const legs = [
    { id: 't_low', account_id: 'chk', date: utc(2024, 4, 1), amount: -100 },
    { id: 't_high', account_id: 'chk', date: utc(2024, 4, 1), amount: -100 },
    { id: 'credit', account_id: 'sv', date: utc(2024, 4, 1), amount: 100 },
  ];
  const r = computeAutoTransferPairings(legs, {
    windowDays: 4,
    epsilon: 0,
    createPairingId: () => `pid-${++n}`,
  });
  assert.equal(Object.keys(r.byLegId).length, 2);
  assert.ok(r.byLegId.credit);
  assert.equal(
    Boolean(r.byLegId.t_low) + Boolean(r.byLegId.t_high),
    1,
    'exactly one debit should pair with the sole credit',
  );
});

test('tie-break prefers smallest |Δt_ms| then lexicographic (account_id, id) on B', () => {
  let n = 0;
  const legs = [
    { id: 'out', account_id: 'chk', date: utc(2024, 6, 10), amount: -75 },
    { id: 'later_inflow', account_id: 'zz_sv', date: utc(2024, 6, 13), amount: 75 },
    { id: 'earlier_inflow', account_id: 'aa_sv', date: utc(2024, 6, 11), amount: 75 },
  ];
  const r = computeAutoTransferPairings(legs, {
    windowDays: 4,
    epsilon: 0,
    createPairingId: () => `pid-${++n}`,
  });
  assert.ok(r.byLegId.out);
  assert.equal(r.byLegId.out.pairing_id, r.byLegId.earlier_inflow.pairing_id);
  assert.equal(r.byLegId.later_inflow, undefined);
});

test('equal residual and date distance: lexicographically smaller partner wins', () => {
  let n = 0;
  const sameDay = utc(2024, 8, 1);
  const legs = [
    { id: 'debit', account_id: 'chk', date: sameDay, amount: -40 },
    { id: 'in_z', account_id: 'z_sv', date: sameDay, amount: 40 },
    { id: 'in_a', account_id: 'a_sv', date: sameDay, amount: 40 },
  ];
  const r = computeAutoTransferPairings(legs, {
    windowDays: 4,
    epsilon: 0,
    createPairingId: () => `pid-${++n}`,
  });
  assert.ok(r.byLegId.debit);
  assert.equal(r.byLegId.debit.pairing_id, r.byLegId.in_a.pairing_id);
  assert.equal(r.byLegId.in_z, undefined);
});

test('deterministic root order: repeated runs match', () => {
  let seq = 0;
  const legs = [
    ...[
      { id: `d${++seq}a`, account_id: 'chk', date: utc(2025, 0, 1), amount: -10 },
      { id: `d${seq}b`, account_id: 'chk', date: utc(2025, 0, 1), amount: -10 },
      { id: `c${seq}`, account_id: 'sv', date: utc(2025, 0, 1), amount: 10 },
    ],
    ...[
      { id: `d${++seq}a`, account_id: 'chk', date: utc(2025, 0, 1), amount: -10 },
      { id: `d${seq}b`, account_id: 'chk', date: utc(2025, 0, 1), amount: -10 },
      { id: `c${seq}`, account_id: 'sv', date: utc(2025, 0, 1), amount: 10 },
    ],
  ];

  const run = () => {
    let i = 0;
    return computeAutoTransferPairings(legs, {
      windowDays: 4,
      epsilon: 0,
      createPairingId: () => `id-${++i}`,
    });
  };

  const r1 = run();
  const r2 = run();
  assert.deepEqual(r1.byLegId, r2.byLegId);
});

function pairingClusters(byLegId) {
  const m = new Map();
  for (const [legId, asg] of Object.entries(byLegId)) {
    const pid = asg.pairing_id;
    let arr = m.get(pid);
    if (!arr) {
      arr = [];
      m.set(pid, arr);
    }
    arr.push(legId);
  }
  return [...m.values()]
    .map((xs) => xs.sort())
    .sort((a, b) => a.join(',').localeCompare(b.join(',')));
}

function assertSamePairingOutcome(brute, fast) {
  assert.deepEqual(pairingClusters(brute.byLegId), pairingClusters(fast.byLegId));
  const ids = new Set([...Object.keys(brute.byLegId), ...Object.keys(fast.byLegId)]);
  for (const id of ids) {
    assert.equal(brute.byLegId[id]?.pairing_confidence, fast.byLegId[id]?.pairing_confidence);
    assert.equal(brute.byLegId[id]?.pairing_source, fast.byLegId[id]?.pairing_source);
  }
}

test('utcDayOrdinal distance matches utcCalendarDaysApart', () => {
  const a = Date.UTC(2024, 5, 1, 15, 30);
  const b = Date.UTC(2024, 5, 8, 9, 0);
  assert.equal(
    Math.abs(utcDayOrdinal(a) - utcDayOrdinal(b)),
    utcCalendarDaysApart(a, b),
  );
});

test('sorted pools matches brute force on mixed counterparts and proposals', () => {
  let id = 0;
  const mk = (date, amount, acc) => ({
    id: `leg_${++id}`,
    account_id: acc,
    date,
    amount,
  });
  const counterparts = [
    mk(Date.UTC(2024, 0, 10), 100, 'sv'),
    mk(Date.UTC(2024, 0, 11), -50, 'chk'),
    mk(Date.UTC(2024, 0, 20), 25, 'sv'),
  ];
  const proposals = [
    mk(Date.UTC(2024, 0, 10), -100, 'chk'),
    mk(Date.UTC(2024, 0, 11), 50, 'sv'),
    mk(Date.UTC(2024, 0, 20), -25, 'chk'),
  ];
  const merged = [...counterparts, ...proposals];
  const proposalRootIds = new Set(proposals.map((p) => p.id));
  let k = 0;
  const mkPid = () => `pid_${++k}`;
  const opts = {
    windowDays: 4,
    epsilon: 0,
    proposalRootIds,
    createPairingId: mkPid,
  };
  const brute = computeAutoTransferPairings(merged, opts);
  let k2 = 0;
  const mkPid2 = () => `pid_${++k2}`;
  const fast = computeAutoTransferPairingsSortedPools(counterparts, proposals, {
    ...opts,
    createPairingId: mkPid2,
  });
  assertSamePairingOutcome(brute, fast);
});
