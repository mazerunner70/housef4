const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  executeImportOrchestration,
} = require('../dist/services/import/importOrchestration');
const { HttpError } = require('../dist/httpError');
const { ImportLockConflictError } = require('@housef4/db');
const {
  computeImportBlobContentSha256,
} = require('../dist/services/import/blobFingerprint');
const {
  resetImportBlobStoreForTests,
} = require('../dist/services/import/importBlobStore');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

/** Header-only CSV — parses to zero data rows (skips embedder in planning). */
function zeroRowExtracted(overrides = {}) {
  return {
    file: {
      filename: 'empty.csv',
      buffer: Buffer.from('date,amount,description\n', 'utf8'),
      mimeType: 'text/csv',
    },
    accountId: 'acc-1',
    newAccountName: '',
    negateAmounts: '',
    ...overrides,
  };
}

/**
 * Minimal `FinanceRepository` stub for orchestration parity tests.
 * Records method names in `callLog` (in invocation order).
 */
function createStubRepo(overrides = {}) {
  const callLog = [];
  const log = (name) => callLog.push(name);

  const repo = {
    callLog,
    lastTransactionFile: undefined,
    afterPromoteInvoked: false,

    getAccount: async (userId, accountId) => {
      log('getAccount');
      if (overrides.getAccount) {
        return overrides.getAccount(userId, accountId);
      }
      return { id: accountId, user_id: userId, name: 'Checking' };
    },

    createAccount: async (userId, name) => {
      log('createAccount');
      if (overrides.createAccount) {
        return overrides.createAccount(userId, name);
      }
      return { id: 'acc-new', user_id: userId, name };
    },

    findDuplicateBlobImport: async () => {
      log('findDuplicateBlobImport');
      return overrides.duplicate ?? null;
    },

    listTransactions: async () => {
      log('listTransactions');
      return overrides.transactions ?? [];
    },

    listTransactionFiles: async (userId) => {
      log('listTransactionFiles');
      if (overrides.listTransactionFiles) {
        return overrides.listTransactionFiles(userId);
      }
      return overrides.transactionFiles ?? [];
    },

    patchExistingTransactionsAfterImport: async (_userId, patches) => {
      log('patchExistingTransactionsAfterImport');
      repo.lastPatches = patches;
    },

    ingestImportBatch: async (_userId, rows, transactionFileId, fileCurrency) => {
      log('ingestImportBatch');
      repo.lastIngest = { rows, transactionFileId, fileCurrency };
      return (
        overrides.ingestResult ?? {
          rowCount: rows.length,
          knownMerchants: 0,
          unknownMerchants: 0,
          newClustersTouched: 0,
        }
      );
    },

    retireClusterAggregates: async (_userId, clusterIds) => {
      log('retireClusterAggregates');
      repo.lastRetiredClusterIds = clusterIds;
    },

    rebuildClusterAggregatesAfterImport: async (_userId, clusterIds) => {
      log('rebuildClusterAggregatesAfterImport');
      repo.lastRebuiltClusterIds = clusterIds;
    },

    recordTransactionFile: async (_userId, input) => {
      log('recordTransactionFile');
      repo.lastTransactionFile = input;
    },

    patchTransactionFileBlob: async (_userId, fileId, blob) => {
      log('patchTransactionFileBlob');
      repo.lastBlobPatch = { fileId, blob };
    },

    refreshStoredDashboardMetrics: async () => {
      log('refreshStoredDashboardMetrics');
    },

    isImportStagingEnabled: () =>
      overrides.importStagingEnabled ?? false,

    persistImportPlanViaStaging: async (_userId, input) => {
      log('persistImportPlanViaStaging');
      if (overrides.persistImportPlanViaStaging) {
        return overrides.persistImportPlanViaStaging(_userId, input);
      }
      repo.lastStagingPersist = input;
      assert.ok(
        typeof input.afterPromote === 'function',
        'staging persist must receive afterPromote hook for blob patch under lock',
      );
      if (input.afterPromote) {
        await input.afterPromote();
        repo.afterPromoteInvoked = true;
      }
    },

    acquireImportLock: async (_userId, input) => {
      log('acquireImportLock');
      repo.lastAcquireImportLock = input;
      if (overrides.acquireImportLock) {
        return overrides.acquireImportLock(_userId, input);
      }
    },

    releaseImportLock: async () => {
      log('releaseImportLock');
    },
  };

  return repo;
}

const PERSIST_STAGE_ORDER = [
  'acquireImportLock',
  'patchExistingTransactionsAfterImport',
  'ingestImportBatch',
  'rebuildClusterAggregatesAfterImport',
  'retireClusterAggregates',
  'recordTransactionFile',
  'refreshStoredDashboardMetrics',
  'releaseImportLock',
];

function assertPersistStagesInOrder(callLog) {
  const indices = PERSIST_STAGE_ORDER.map((name) => callLog.indexOf(name));
  assert.ok(
    indices.every((i) => i >= 0),
    `expected persist stages in callLog: ${PERSIST_STAGE_ORDER.join(', ')}; got ${callLog.join(', ')}`,
  );
  for (let i = 1; i < indices.length; i++) {
    assert.ok(
      indices[i] > indices[i - 1],
      `${PERSIST_STAGE_ORDER[i]} must run after ${PERSIST_STAGE_ORDER[i - 1]}`,
    );
  }
}

test('executeImportOrchestration — zero-row CSV commits persist stages in §4.2 order', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo();
  const userId = 'user-orchestration-1';

  const result = await executeImportOrchestration({ userId, repo, extracted });

  assert.equal(result.rowCount, 0);
  assert.equal(result.existingTransactionsUpdated, 0);
  assert.equal(result.newClustersTouched, 0);
  assert.equal(typeof result.importFileId, 'string');
  assert.match(result.importFileId, /^[0-9a-f-]{36}$/i);
  assert.equal(result.sourceFormat, 'csv');
  assert.deepEqual(result.amountNegation, {
    applied: false,
    suggestInterest: false,
    suggestPriorImport: false,
    explicitOverride: false,
  });

  assertPersistStagesInOrder(repo.callLog);
  assert.equal(repo.callLog[0], 'findDuplicateBlobImport');
  assert.equal(repo.callLog[1], 'getAccount');
  assert.ok(
    repo.callLog.indexOf('acquireImportLock') <
      repo.callLog.indexOf('listTransactionFiles'),
  );
  assert.ok(
    repo.callLog.indexOf('acquireImportLock') <
      repo.callLog.indexOf('patchExistingTransactionsAfterImport'),
  );

  const expectedSha = computeImportBlobContentSha256(extracted.file.buffer);
  assert.equal(repo.lastTransactionFile.content_sha256, expectedSha);
  assert.equal(repo.lastTransactionFile.account_id, 'acc-1');
  assert.equal(repo.lastTransactionFile.id, result.importFileId);
  assert.equal(repo.lastIngest.transactionFileId, result.importFileId);
  assert.deepEqual(repo.lastPatches, []);
  assert.deepEqual(repo.lastRetiredClusterIds, []);
});

test('executeImportOrchestration — createAccount path when new_account_name is set', async () => {
  const extracted = zeroRowExtracted({
    accountId: '',
    newAccountName: 'Savings',
  });
  const repo = createStubRepo();

  const result = await executeImportOrchestration({
    userId: 'user-orchestration-2',
    repo,
    extracted,
  });

  assert.equal(repo.callLog[0], 'findDuplicateBlobImport');
  assert.equal(repo.callLog[1], 'acquireImportLock');
  assert.equal(repo.callLog[2], 'createAccount');
  assert.equal(result.importFileId, repo.lastTransactionFile.id);
  assert.equal(repo.lastTransactionFile.account_id, 'acc-new');
});

test('executeImportOrchestration — duplicate blob aborts before parse/persist (409)', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo({
    duplicate: {
      importFileId: 'file-prior',
      sourceName: 'prior.csv',
      completedAt: 1_700_000_000_000,
    },
  });

  await assert.rejects(
    () =>
      executeImportOrchestration({
        userId: 'user-orchestration-3',
        repo,
        extracted,
      }),
    (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.statusCode, 409);
      assert.equal(e.body.error, 'duplicate_blob');
      assert.equal(e.body.existingImportFileId, 'file-prior');
      assert.equal(e.body.priorImportFileName, 'prior.csv');
      assert.equal(e.body.priorImportCompletedAt, 1_700_000_000_000);
      return true;
    },
  );

  assert.deepEqual(repo.callLog, ['findDuplicateBlobImport']);
  assert.equal(repo.lastTransactionFile, undefined);
});

test('executeImportOrchestration — unknown account_id returns 400 before duplicate check side effects', async () => {
  const extracted = zeroRowExtracted({ accountId: 'missing-acc' });
  const repo = createStubRepo({
    getAccount: async () => null,
  });

  await assert.rejects(
    () =>
      executeImportOrchestration({
        userId: 'user-orchestration-4',
        repo,
        extracted,
      }),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );

  assert.deepEqual(repo.callLog, ['findDuplicateBlobImport', 'getAccount']);
});

test('executeImportOrchestration — missing account selector returns 400', async () => {
  const extracted = zeroRowExtracted({
    accountId: '',
    newAccountName: '',
  });
  const repo = createStubRepo();

  await assert.rejects(
    () =>
      executeImportOrchestration({
        userId: 'user-orchestration-5',
        repo,
        extracted,
      }),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );

  assert.deepEqual(repo.callLog, []);
});

test('executeImportOrchestration — staging path promotes file row inside workflow (no recordTransactionFile)', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo({ importStagingEnabled: true });
  const userId = 'user-orchestration-staging';

  await executeImportOrchestration({ userId, repo, extracted });

  assert.ok(repo.callLog.includes('persistImportPlanViaStaging'));
  assert.ok(repo.afterPromoteInvoked, 'afterPromote runs inside staging before lock release');
  assert.ok(!repo.callLog.includes('patchExistingTransactionsAfterImport'));
  assert.ok(!repo.callLog.includes('ingestImportBatch'));
  assert.ok(!repo.callLog.includes('recordTransactionFile'));
  assert.ok(!repo.callLog.includes('patchTransactionFileBlob'));
  assert.ok(!repo.callLog.includes('refreshStoredDashboardMetrics'));
  assert.equal(repo.lastStagingPersist.importFileId, repo.lastStagingPersist.transactionFile.id);
  assert.equal(
    repo.lastStagingPersist.transactionFile.content_sha256,
    computeImportBlobContentSha256(extracted.file.buffer),
  );
});

test('executeImportOrchestration — staging path patches blob via afterPromote when storage enabled', async (t) => {
  const blobRoot = await mkdtemp(join(tmpdir(), 'housef4-staging-blob-'));
  t.after(async () => {
    delete process.env.IMPORT_BLOB_BACKEND;
    delete process.env.IMPORT_BLOB_LOCAL_ROOT;
    resetImportBlobStoreForTests();
    await rm(blobRoot, { recursive: true, force: true });
  });

  process.env.IMPORT_BLOB_BACKEND = 'filesystem';
  process.env.IMPORT_BLOB_LOCAL_ROOT = blobRoot;
  resetImportBlobStoreForTests();

  const extracted = zeroRowExtracted();
  const repo = createStubRepo({ importStagingEnabled: true });
  const userId = 'user-orchestration-staging-blob';

  await executeImportOrchestration({ userId, repo, extracted });

  assert.ok(repo.afterPromoteInvoked);
  assert.ok(repo.callLog.includes('patchTransactionFileBlob'));
  assert.ok(!repo.callLog.includes('recordTransactionFile'));
  assert.equal(repo.lastBlobPatch.fileId, repo.lastStagingPersist.importFileId);
  assert.equal(repo.lastBlobPatch.blob.stored_bytes, extracted.file.buffer.length);
});

test('executeImportOrchestration — in-place path acquires and releases IMPORT_LOCK', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo();
  const userId = 'user-orchestration-inplace-lock';

  await executeImportOrchestration({ userId, repo, extracted });

  assert.ok(repo.callLog.includes('acquireImportLock'));
  assert.ok(repo.callLog.includes('releaseImportLock'));
  assert.ok(
    repo.callLog.indexOf('acquireImportLock') <
      repo.callLog.indexOf('patchExistingTransactionsAfterImport'),
  );
  assert.ok(
    repo.callLog.indexOf('refreshStoredDashboardMetrics') <
      repo.callLog.indexOf('releaseImportLock'),
  );
  assert.equal(repo.lastAcquireImportLock.import_file_id, repo.lastTransactionFile.id);
});

test('executeImportOrchestration — import_in_progress returns 409 before persist (in-place)', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo({
    acquireImportLock: async () => {
      throw new ImportLockConflictError('user-lock', 'import_in_progress');
    },
  });

  await assert.rejects(
    () =>
      executeImportOrchestration({
        userId: 'user-lock',
        repo,
        extracted,
      }),
    (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.statusCode, 409);
      assert.equal(e.body.error, 'import_in_progress');
      assert.match(e.body.message, /in progress/i);
      return true;
    },
  );

  assert.ok(repo.callLog.includes('acquireImportLock'));
  assert.ok(!repo.callLog.includes('patchExistingTransactionsAfterImport'));
  assert.ok(!repo.callLog.includes('releaseImportLock'));
});

test('executeImportOrchestration — planning failure releases IMPORT_LOCK before persist', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo({
    listTransactionFiles: async () => {
      throw new Error('planning read failed');
    },
  });

  await assert.rejects(
    () =>
      executeImportOrchestration({
        userId: 'user-plan-fail',
        repo,
        extracted,
      }),
    (e) => e instanceof Error && e.message === 'planning read failed',
  );

  assert.ok(repo.callLog.includes('acquireImportLock'));
  assert.ok(repo.callLog.includes('releaseImportLock'));
  assert.ok(!repo.callLog.includes('patchExistingTransactionsAfterImport'));
  assert.ok(
    repo.callLog.indexOf('releaseImportLock') >
      repo.callLog.indexOf('acquireImportLock'),
  );
});

test('executeImportOrchestration — restore_in_progress returns 409 before persist (staging path)', async () => {
  const extracted = zeroRowExtracted();
  const repo = createStubRepo({
    importStagingEnabled: true,
    acquireImportLock: async () => {
      throw new ImportLockConflictError('user-restore', 'restore_in_progress');
    },
  });

  await assert.rejects(
    () =>
      executeImportOrchestration({
        userId: 'user-restore',
        repo,
        extracted,
      }),
    (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.statusCode, 409);
      assert.equal(e.body.error, 'restore_in_progress');
      return true;
    },
  );
});
