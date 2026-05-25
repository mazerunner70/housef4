const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  replayClusteringForUser,
} = require('../dist/services/import/clustering/replayClustering');
const { hashEmbedding } = require('../dist/services/import/clustering/merchantsEmbedder');

const stubEmbedder = {
  usesModel: false,
  embed: async (text) => hashEmbedding(text),
};

test('replayClusteringForUser — diffs cleaned and category against stored ledger', async () => {
  const transactions = [
    {
      user_id: 'user-1',
      id: 'txn-a',
      date: 1_700_000_000_000,
      raw_merchant: 'SAINSBURYS S/MKTS ON 03 NOV CLP',
      cleaned_merchant: 'WRONG',
      amount: -10,
      cluster_id: 'CL_old_a',
      category: 'Uncategorized',
      status: 'PENDING_REVIEW',
      suggested_category: 'Groceries',
      match_type: 'ML',
      category_confidence: 0.4,
      is_recurring: false,
      transaction_file_id: 'file-1',
    },
    {
      user_id: 'user-1',
      id: 'txn-b',
      date: 1_700_000_000_001,
      raw_merchant: 'SAINSBURYS S/MKTS ON 04 NOV CLP',
      cleaned_merchant: 'SAINSBURYS SUPERMARKET',
      amount: -12,
      cluster_id: 'CL_old_a',
      category: 'Groceries',
      status: 'CLASSIFIED',
      is_recurring: false,
      transaction_file_id: 'file-1',
    },
    {
      user_id: 'user-1',
      id: 'txn-c',
      date: 1_700_000_000_002,
      raw_merchant: 'Payment, Thank You',
      cleaned_merchant: 'PAYMENT, THANK YOU',
      amount: 100,
      cluster_id: 'CL_old_c',
      category: 'Uncategorized',
      status: 'PENDING_REVIEW',
      is_recurring: false,
      transaction_file_id: 'file-1',
    },
  ];

  const repo = {
    listTransactions: async () => transactions,
    listTransactionFiles: async () => [
      { id: 'file-1', account_id: 'acc-1', user_id: 'user-1' },
    ],
  };

  const result = await replayClusteringForUser({
    userId: 'user-1',
    repo,
    embedder: stubEmbedder,
    filters: { txnIds: new Set(['txn-a']) },
    merchantStringMatch: { mode: 'off', maxDistance: 2 },
  });

  assert.equal(result.meta.corpus_transaction_count, 3);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.id, 'txn-a');
  assert.equal(row.replay.cleaned_merchant, 'SAINSBURYS SUPERMARKET');
  assert.equal(row.differs.cleaned_merchant, true);
  assert.equal(row.replay.match_type, 'RULE');
  assert.equal(row.replay.category, 'Groceries');
  assert.equal(row.replay.status, 'CLASSIFIED');
});

test('replayClusteringForUser — skips paired transfer legs', async () => {
  const transactions = [
    {
      user_id: 'user-1',
      id: 'txn-paired',
      date: 1_700_000_000_000,
      raw_merchant: 'Transfer to savings',
      amount: -50,
      cluster_id: 'internal_transfer',
      category: 'Uncategorized',
      status: 'CLASSIFIED',
      is_recurring: false,
      transaction_file_id: 'file-1',
      pairing_id: 'pair-1',
    },
  ];

  const repo = {
    listTransactions: async () => transactions,
    listTransactionFiles: async () => [
      { id: 'file-1', account_id: 'acc-1', user_id: 'user-1' },
    ],
  };

  const result = await replayClusteringForUser({
    userId: 'user-1',
    repo,
    embedder: stubEmbedder,
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].replay.skipped_clustering, true);
  assert.equal(result.rows[0].replay.physical_group_label, null);
});
