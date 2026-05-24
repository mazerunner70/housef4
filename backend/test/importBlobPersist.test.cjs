const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  attachImportBlobAndRecordFile,
} = require('../dist/services/import/importBlobPersist');
const {
  computeImportBlobContentSha256,
} = require('../dist/services/import/blobFingerprint');

function zeroRowExtracted() {
  return {
    file: {
      filename: 'empty.csv',
      buffer: Buffer.from('date,amount,description\n', 'utf8'),
      mimeType: 'text/csv',
    },
    accountId: 'acc-1',
    newAccountName: '',
    negateAmounts: '',
  };
}

function baseTransactionFileInput(extracted, importFileId) {
  const contentSha256 = computeImportBlobContentSha256(extracted.file.buffer);
  return {
    id: importFileId,
    account_id: 'acc-1',
    content_sha256: contentSha256,
    source: {
      name: extracted.file.filename,
      size_bytes: extracted.file.buffer.length,
      content_type: extracted.file.mimeType,
    },
    format: { source_format: 'csv' },
    timing: { started_at: 1, completed_at: 2 },
    result: {
      rowCount: 0,
      knownMerchants: 0,
      unknownMerchants: 0,
      existingTransactionsUpdated: 0,
      newClustersTouched: 0,
    },
  };
}

test('attachImportBlobAndRecordFile — blob Put failure is non-fatal (metadata only)', async () => {
  const extracted = zeroRowExtracted();
  const importFileId = 'file-blob-fail';
  const transactionFileInput = baseTransactionFileInput(extracted, importFileId);
  let recorded;

  const repo = {
    recordTransactionFile: async (_userId, input) => {
      recorded = input;
    },
  };

  const store = {
    put: async () => {
      throw new Error('disk full');
    },
    delete: async () => {},
  };

  await attachImportBlobAndRecordFile({
    userId: 'u1',
    repo,
    store,
    extracted,
    contentSha256: transactionFileInput.content_sha256,
    importFileId,
    accountId: 'acc-1',
    transactionFileInput,
  });

  assert.equal(recorded.id, importFileId);
  assert.equal(recorded.blob, undefined);
});

test('attachImportBlobAndRecordFile — blob success attaches ref on TRANSACTION_FILE', async () => {
  const extracted = zeroRowExtracted();
  const importFileId = 'file-blob-ok';
  const transactionFileInput = baseTransactionFileInput(extracted, importFileId);
  let recorded;

  const repo = {
    recordTransactionFile: async (_userId, input) => {
      recorded = input;
    },
  };

  const store = {
    put: async ({ body, contentSha256 }) => ({
      ref: {
        kind: 'filesystem',
        key: 'imports/u1/file-blob-ok/empty.csv',
        content_sha256: contentSha256,
        stored_bytes: body.length,
      },
    }),
    delete: async () => {},
  };

  await attachImportBlobAndRecordFile({
    userId: 'u1',
    repo,
    store,
    extracted,
    contentSha256: transactionFileInput.content_sha256,
    importFileId,
    accountId: 'acc-1',
    transactionFileInput,
  });

  assert.equal(recorded.blob.kind, 'filesystem');
  assert.equal(recorded.blob.stored_bytes, extracted.file.buffer.length);
});

test('attachImportBlobAndRecordFile — Dynamo failure after blob deletes object and retries metadata-only', async () => {
  const extracted = zeroRowExtracted();
  const importFileId = 'file-compensate';
  const transactionFileInput = baseTransactionFileInput(extracted, importFileId);
  const deleted = [];
  let attempt = 0;

  const repo = {
    recordTransactionFile: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('dynamo throttled');
    },
  };

  const blobRef = {
    kind: 'filesystem',
    key: 'imports/u1/file-compensate/empty.csv',
    content_sha256: transactionFileInput.content_sha256,
    stored_bytes: extracted.file.buffer.length,
  };

  const store = {
    put: async () => ({ ref: blobRef }),
    delete: async (ref) => {
      deleted.push(ref.key);
    },
  };

  await attachImportBlobAndRecordFile({
    userId: 'u1',
    repo,
    store,
    extracted,
    contentSha256: transactionFileInput.content_sha256,
    importFileId,
    accountId: 'acc-1',
    transactionFileInput,
  });

  assert.deepEqual(deleted, [blobRef.key]);
  assert.equal(attempt, 2);
});

test('attachImportBlobAndRecordFile — Dynamo retry failure propagates after compensating delete', async () => {
  const extracted = zeroRowExtracted();
  const importFileId = 'file-compensate-fail';
  const transactionFileInput = baseTransactionFileInput(extracted, importFileId);

  const repo = {
    recordTransactionFile: async () => {
      throw new Error('dynamo unavailable');
    },
  };

  const store = {
    put: async ({ body, contentSha256 }) => ({
      ref: {
        kind: 'filesystem',
        key: 'k',
        content_sha256: contentSha256,
        stored_bytes: body.length,
      },
    }),
    delete: async () => {},
  };

  await assert.rejects(
    () =>
      attachImportBlobAndRecordFile({
        userId: 'u1',
        repo,
        store,
        extracted,
        contentSha256: transactionFileInput.content_sha256,
        importFileId,
        accountId: 'acc-1',
        transactionFileInput,
      }),
    /dynamo unavailable/,
  );
});
