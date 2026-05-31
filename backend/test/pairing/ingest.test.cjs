const { test } = require('node:test');
const assert = require('node:assert/strict');
const { money } = require('@housef4/money');

const {
  computeIngestTransferPairings,
  existingTxnTouchesImportDateWindow,
  INGEST_TRANSFER_PAIR_WINDOW_DAYS,
} = require('../../dist/services/pairing');

function utc(y, m0, d) {
  return Date.UTC(y, m0, d);
}

const M = (major) => Math.round(major * 100);

test('existingTxnTouchesImportDateWindow respects |Δt| ≤ W × 86_400_000 ms hull', () => {
  const imp = [utc(2024, 0, 1)];
  assert.equal(existingTxnTouchesImportDateWindow(utc(2024, 0, 5), imp, 4), true);
  assert.equal(existingTxnTouchesImportDateWindow(utc(2024, 0, 6), imp, 4), false);
});

test('computeIngestTransferPairings ignores existing rows outside import date hull', () => {
  const newIds = ['txn_new'];
  const pairing = computeIngestTransferPairings({
    importAccountId: 'acc_chk',
    importCurrency: 'USD',
    parsed: [
      {
        date: utc(2024, 5, 1),
        file_amount: -50,
        canonical_amount: -50,
        raw_merchant: 'out',
      },
    ],
    newTransactionIds: newIds,
    existingTransactions: [
      {
        user_id: 'u',
        id: 'far',
        date: utc(2024, 0, 1),
        raw_merchant: 'y',
        canonicalAmount: money(M(50)),
        category: 'Uncategorized',
        status: 'CLASSIFIED',
        is_recurring: false,
        transaction_file_id: 'file_sv',
      },
      {
        user_id: 'u',
        id: 'near',
        date: utc(2024, 5, 2),
        raw_merchant: 'z',
        canonicalAmount: money(M(50)),
        category: 'Uncategorized',
        status: 'CLASSIFIED',
        is_recurring: false,
        transaction_file_id: 'file_sv',
      },
    ],
    fileIdToAccountId: new Map([['file_sv', 'acc_sv']]),
    windowDays: INGEST_TRANSFER_PAIR_WINDOW_DAYS,
    epsilonAmount: money(0),
  });

  assert.ok(pairing.txn_new);
  assert.ok(pairing.near);
  assert.equal(pairing.far, undefined);
});

test('computeIngestTransferPairings does not reuse an existing row that already has pairing_id', () => {
  const pairing = computeIngestTransferPairings({
    importAccountId: 'acc_chk',
    importCurrency: 'USD',
    parsed: [
      {
        date: utc(2024, 5, 1),
        file_amount: -50,
        canonical_amount: -50,
        raw_merchant: 'out',
      },
    ],
    newTransactionIds: ['txn_new'],
    existingTransactions: [
      {
        user_id: 'u',
        id: 'near_already_paired',
        date: utc(2024, 5, 2),
        raw_merchant: 'z',
        canonicalAmount: money(M(50)),
        category: 'Uncategorized',
        status: 'CLASSIFIED',
        is_recurring: false,
        transaction_file_id: 'file_sv',
        pairing_id: 'pair-existing',
        pairing_source: 'auto',
      },
    ],
    fileIdToAccountId: new Map([['file_sv', 'acc_sv']]),
    windowDays: INGEST_TRANSFER_PAIR_WINDOW_DAYS,
    epsilonAmount: money(0),
  });

  assert.equal(pairing.txn_new, undefined);
});
