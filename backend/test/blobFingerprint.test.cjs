const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
  computeImportBlobContentSha256,
} = require('../dist/services/import/blob/blobFingerprint');

test('computeImportBlobContentSha256 — lowercase hex SHA-256 over raw bytes', () => {
  const buf = Buffer.from('date,amount\n2024-01-01,-5.00\n', 'utf8');
  const expected = createHash('sha256').update(buf).digest('hex');
  assert.equal(computeImportBlobContentSha256(buf), expected);
  assert.match(computeImportBlobContentSha256(buf), /^[0-9a-f]{64}$/);
});

test('computeImportBlobContentSha256 — distinct buffers produce distinct digests', () => {
  const a = computeImportBlobContentSha256(Buffer.from('a'));
  const b = computeImportBlobContentSha256(Buffer.from('b'));
  assert.notEqual(a, b);
});
