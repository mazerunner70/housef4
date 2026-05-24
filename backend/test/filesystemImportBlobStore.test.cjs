const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const {
  FilesystemImportBlobStore,
} = require('../dist/services/import/blob/filesystemImportBlobStore');
const {
  computeImportBlobContentSha256,
} = require('../dist/services/import/blob/blobFingerprint');

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'housef4-blob-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('FilesystemImportBlobStore — put writes bytes and delete removes file', async () => {
  const store = new FilesystemImportBlobStore(root);
  const body = Buffer.from('date,amount,description\n2024-01-01,-1,coffee\n', 'utf8');
  const contentSha256 = computeImportBlobContentSha256(body);

  const { ref } = await store.put({
    userId: 'u1',
    importFileId: 'f1',
    accountId: 'acc1',
    originalName: 'import.csv',
    contentSha256,
    body,
  });

  assert.equal(ref.kind, 'filesystem');
  assert.equal(ref.content_sha256, contentSha256);
  assert.equal(ref.stored_bytes, body.length);
  assert.ok(ref.key.includes('imports/u1/f1/import.csv'));

  await store.delete(ref);
});
