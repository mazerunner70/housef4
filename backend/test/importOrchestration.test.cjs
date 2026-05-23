const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  executeImportOrchestration,
} = require('../dist/services/import/importOrchestration');
const { HttpError } = require('../dist/httpError');
const {
  computeImportBlobContentSha256,
} = require('../dist/services/import/blobFingerprint');

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

    listTransactionFiles: async () => {
      log('listTransactionFiles');
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

    recordTransactionFile: async (_userId, input) => {
      log('recordTransactionFile');
      repo.lastTransactionFile = input;
    },

    refreshStoredDashboardMetrics: async () => {
      log('refreshStoredDashboardMetrics');
    },
  };

  return repo;
}

const PERSIST_STAGE_ORDER = [
  'patchExistingTransactionsAfterImport',
  'ingestImportBatch',
  'retireClusterAggregates',
  'recordTransactionFile',
  'refreshStoredDashboardMetrics',
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
  assert.equal(repo.callLog[0], 'getAccount');
  assert.ok(
    repo.callLog.indexOf('findDuplicateBlobImport') < repo.callLog.indexOf('listTransactionFiles'),
  );
  assert.ok(
    repo.callLog.indexOf('listTransactionFiles') <
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

  assert.equal(repo.callLog[0], 'createAccount');
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
      return true;
    },
  );

  assert.deepEqual(repo.callLog, ['getAccount', 'findDuplicateBlobImport']);
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

  assert.deepEqual(repo.callLog, ['getAccount']);
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
