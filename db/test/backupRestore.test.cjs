const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BackupRestoreClientError,
  validateBackupSnapshotForRestore,
} = require('../dist/backupRestore');
const { BACKUP_SCHEMA_VERSION_V1 } = require('../dist/types');

function minimalSnapshot(uid) {
  return {
    backup_schema_version: BACKUP_SCHEMA_VERSION_V1,
    exported_at: 1,
    app_user_id: uid,
    accounts: [],
    profile: null,
    metrics: null,
    transactions: [],
    clusters: [],
    transaction_files: [],
  };
}

test('validateBackupSnapshotForRestore rejects app_user_id mismatch (403)', () => {
  assert.throws(
    () =>
      validateBackupSnapshotForRestore('user-a', {
        ...minimalSnapshot('user-b'),
      }),
    (e) => e instanceof BackupRestoreClientError && e.statusCode === 403,
  );
});

test('validateBackupSnapshotForRestore rejects bad transaction_file_id reference', () => {
  const snap = {
    ...minimalSnapshot('u1'),
    accounts: [
      {
        entity_type: 'ACCOUNT',
        user_id: 'u1',
        id: 'acc1',
        name: 'Checking',
        created_at: 1,
      },
    ],
    clusters: [
      {
        entity_type: 'CLUSTER',
        cluster_id: 'c1',
        sample_merchants: ['x'],
        total_transactions: 1,
        total_amount: 1,
        suggested_category: null,
        assigned_category: null,
        pending_review: false,
      },
    ],
    transaction_files: [
      {
        entity_type: 'TRANSACTION_FILE',
        user_id: 'u1',
        id: 'file-real',
        account_id: 'acc1',
        source: { name: 'a', size_bytes: 1 },
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
    ],
    transactions: [
      {
        entity_type: 'TRANSACTION',
        user_id: 'u1',
        id: 't1',
        date: 100,
        raw_merchant: 'm',
        amount: -1,
        category: 'Food',
        status: 'CLASSIFIED',
        is_recurring: false,
        transaction_file_id: 'missing-file',
        cluster_id: 'c1',
      },
    ],
  };
  assert.throws(
    () => validateBackupSnapshotForRestore('u1', snap),
    (e) =>
      e instanceof BackupRestoreClientError &&
      e.statusCode === 400 &&
      /unknown transaction_file_id/.test(e.message),
  );
});

test('validateBackupSnapshotForRestore rejects transaction user_id mismatch (403)', () => {
  const snap = {
    ...minimalSnapshot('u1'),
    accounts: [
      {
        entity_type: 'ACCOUNT',
        user_id: 'u1',
        id: 'acc1',
        name: 'Checking',
        created_at: 1,
      },
    ],
    clusters: [
      {
        entity_type: 'CLUSTER',
        cluster_id: 'c1',
        sample_merchants: ['x'],
        total_transactions: 1,
        total_amount: 1,
        suggested_category: null,
        assigned_category: null,
        pending_review: false,
      },
    ],
    transaction_files: [
      {
        entity_type: 'TRANSACTION_FILE',
        user_id: 'u1',
        id: 'f1',
        account_id: 'acc1',
        source: { name: 'a', size_bytes: 1 },
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
    ],
    transactions: [
      {
        entity_type: 'TRANSACTION',
        user_id: 'other-user',
        id: 't1',
        date: 100,
        raw_merchant: 'm',
        amount: -1,
        category: 'Food',
        status: 'CLASSIFIED',
        is_recurring: false,
        transaction_file_id: 'f1',
        cluster_id: 'c1',
      },
    ],
  };
  assert.throws(
    () => validateBackupSnapshotForRestore('u1', snap),
    (e) =>
      e instanceof BackupRestoreClientError &&
      e.statusCode === 403 &&
      /transaction user_id/.test(e.message),
  );
});

test('validateBackupSnapshotForRestore rejects duplicate transaction id (400)', () => {
  const txRow = {
    entity_type: 'TRANSACTION',
    user_id: 'u1',
    id: 't-dup',
    date: 100,
    raw_merchant: 'm',
    amount: -1,
    category: 'Food',
    status: 'CLASSIFIED',
    is_recurring: false,
    transaction_file_id: 'f1',
    cluster_id: 'c1',
  };
  const snap = {
    ...minimalSnapshot('u1'),
    accounts: [
      {
        entity_type: 'ACCOUNT',
        user_id: 'u1',
        id: 'acc1',
        name: 'Checking',
        created_at: 1,
      },
    ],
    clusters: [
      {
        entity_type: 'CLUSTER',
        cluster_id: 'c1',
        sample_merchants: ['x'],
        total_transactions: 1,
        total_amount: 1,
        suggested_category: null,
        assigned_category: null,
        pending_review: false,
      },
    ],
    transaction_files: [
      {
        entity_type: 'TRANSACTION_FILE',
        user_id: 'u1',
        id: 'f1',
        account_id: 'acc1',
        source: { name: 'a', size_bytes: 1 },
        format: {},
        timing: { started_at: 1, completed_at: 2 },
        result: {
          rowCount: 2,
          knownMerchants: 0,
          unknownMerchants: 2,
          existingTransactionsUpdated: 0,
          newClustersTouched: 1,
        },
      },
    ],
    transactions: [txRow, { ...txRow, date: 101 }],
  };
  assert.throws(
    () => validateBackupSnapshotForRestore('u1', snap),
    (e) =>
      e instanceof BackupRestoreClientError &&
      e.statusCode === 400 &&
      /duplicate transaction id/.test(e.message),
  );
});

test('validateBackupSnapshotForRestore accepts empty collections', () => {
  const v = validateBackupSnapshotForRestore('u1', minimalSnapshot('u1'));
  assert.equal(v.accounts.length, 0);
  assert.equal(v.transactions.length, 0);
});
