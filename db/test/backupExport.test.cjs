const { test } = require('node:test');
const assert = require('node:assert/strict');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoFinanceRepository } = require('../dist/dynamoFinanceRepository');
const {
  CLUSTER_PREFIX,
  FILE_PREFIX,
  METRICS_SK,
  TXN_PREFIX,
  userPk,
} = require('../dist/keys');

/**
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string | undefined>} assignments
 */
function withEnv(t, assignments) {
  const previous = {};
  for (const key of Object.keys(assignments)) {
    previous[key] = process.env[key];
    const v = assignments[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  t.after(() => {
    for (const key of Object.keys(assignments)) {
      const p = previous[key];
      if (p === undefined) delete process.env[key];
      else process.env[key] = p;
    }
  });
}

test('exportBackupSnapshot maps partition items into V1 envelope', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      assert.equal(cmd.input.TableName, 'tbl');
      return Promise.resolve({
        Items: [
          {
            PK: userPk('u1'),
            SK: 'PROFILE',
            entity_type: 'PROFILE',
            net_worth: 100,
          },
          {
            PK: userPk('u1'),
            SK: METRICS_SK,
            entity_type: 'METRICS',
            user_id: 'u1',
            metrics_updated_at: 555,
            transaction_count: 1,
            monthly_cashflow: { income: 1, expenses: 2, net: -1 },
            spending_by_category: [],
            cashflow_history: [],
            cashflow_period_label: 'May 2026',
          },
          {
            PK: userPk('u1'),
            SK: `${TXN_PREFIX}tx-1`,
            entity_type: 'TRANSACTION',
            user_id: 'u1',
            id: 'tx-1',
            date: 1000,
            raw_merchant: 'Coffee',
            amount: -5,
            cluster_id: 'c1',
            category: 'Food',
            status: 'CLASSIFIED',
            is_recurring: false,
            transaction_file_id: 'f1',
          },
          {
            PK: userPk('u1'),
            SK: `${CLUSTER_PREFIX}c1`,
            entity_type: 'CLUSTER',
            cluster_id: 'c1',
            sample_merchants: ['Coffee'],
            total_transactions: 1,
            total_amount: 5,
            suggested_category: 'Food',
            assigned_category: 'Food',
            pending_review: false,
          },
          {
            PK: userPk('u1'),
            SK: `${FILE_PREFIX}f1`,
            entity_type: 'TRANSACTION_FILE',
            user_id: 'u1',
            id: 'f1',
            account_id: 'acc-a',
            source: { name: 'csv', size_bytes: 10 },
            format: {},
            timing: { started_at: 1, completed_at: 2 },
            result: {
              rowCount: 1,
              knownMerchants: 0,
              unknownMerchants: 1,
              existingTransactionsUpdated: 0,
              newClustersTouched: 1,
            },
          },
          {
            PK: userPk('u1'),
            SK: `ACCOUNT#acc-a`,
            entity_type: 'ACCOUNT',
            user_id: 'u1',
            id: 'acc-a',
            name: 'Checking',
            created_at: 99,
          },
        ],
      });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const snap = await repo.exportBackupSnapshot('u1');

  assert.equal(snap.backup_schema_version, 1);
  assert.equal(snap.app_user_id, 'u1');
  assert.equal(snap.accounts.length, 1);
  assert.deepEqual(snap.accounts[0], {
    entity_type: 'ACCOUNT',
    user_id: 'u1',
    id: 'acc-a',
    name: 'Checking',
    created_at: 99,
  });

  assert.equal(snap.transactions.length, 1);
  assert.equal(snap.transactions[0].id, 'tx-1');
  assert.equal(snap.transactions[0].entity_type, 'TRANSACTION');

  assert.equal(snap.clusters.length, 1);
  assert.equal(snap.clusters[0].cluster_id, 'c1');

  assert.equal(snap.transaction_files.length, 1);
  assert.equal(snap.transaction_files[0].id, 'f1');

  assert.ok(snap.profile);
  assert.equal(snap.profile.entity_type, 'PROFILE');
  assert.equal(snap.profile.net_worth, 100);

  assert.ok(snap.metrics);
  assert.equal(snap.metrics.entity_type, 'METRICS');
  assert.equal(snap.metrics.transaction_count, 1);
});

test('exportBackupSnapshot omits RESTORE_LOCK when excludeRestoreLock filters', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });

  const { RESTORE_LOCK_SK } = require('../dist/keys');

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      return Promise.resolve({
        Items: [
          {
            PK: userPk('u2'),
            SK: RESTORE_LOCK_SK,
            entity_type: 'RESTORE_LOCK',
            user_id: 'u2',
          },
          {
            PK: userPk('u2'),
            SK: 'PROFILE',
            entity_type: 'PROFILE',
            net_worth: 0,
          },
        ],
      });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const snap = await repo.exportBackupSnapshot('u2');
  assert.equal(snap.backup_schema_version, 1);
  assert.ok(snap.profile);
  assert.equal(snap.accounts.length, 0);
});
