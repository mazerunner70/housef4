const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLedgerSnapshot,
} = require('../dist/services/import/ledgerSnapshot');

test('buildLedgerSnapshot — single read pass builds transactions + file→account map', async () => {
  const callLog = [];
  const log = (name) => callLog.push(name);

  const transactions = [
    {
      user_id: 'user-1',
      id: 'txn_a',
      date: 1_700_000_000_000,
      raw_merchant: 'Coffee',
      amount: -5,
      category: 'Food',
      status: 'CLASSIFIED',
      is_recurring: false,
      transaction_file_id: 'file-1',
    },
  ];

  const repo = {
    listTransactions: async (userId) => {
      log('listTransactions');
      assert.equal(userId, 'user-1');
      return transactions;
    },
    listTransactionFiles: async (userId) => {
      log('listTransactionFiles');
      assert.equal(userId, 'user-1');
      return [
        { id: 'file-1', account_id: 'acc-checking', user_id: 'user-1' },
        { id: 'file-2', account_id: 'acc-savings', user_id: 'user-1' },
      ];
    },
  };

  const snapshot = await buildLedgerSnapshot('user-1', repo);

  assert.deepEqual(callLog.sort(), ['listTransactionFiles', 'listTransactions']);
  assert.equal(snapshot.transactions.length, 1);
  assert.equal(snapshot.transactions[0].id, 'txn_a');
  assert.equal(snapshot.fileIdToAccountId.get('file-1'), 'acc-checking');
  assert.equal(snapshot.fileIdToAccountId.get('file-2'), 'acc-savings');
  assert.equal(snapshot.fileIdToAccountId.size, 2);
});
