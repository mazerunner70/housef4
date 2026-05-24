const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImportBlobObjectKey,
  sanitizeImportBlobFilename,
} = require('../dist/services/import/importBlobKey');

test('sanitizeImportBlobFilename — strips path segments and caps length', () => {
  assert.equal(sanitizeImportBlobFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeImportBlobFilename(''), 'upload.bin');
  assert.equal(sanitizeImportBlobFilename('/tmp/foo/bar.csv'), 'bar.csv');
  const long = `${'a'.repeat(200)}.csv`;
  assert.ok(sanitizeImportBlobFilename(long).length <= 120);
  assert.ok(sanitizeImportBlobFilename(long).endsWith('.csv'));
});

test('buildImportBlobObjectKey — deterministic user-scoped layout', () => {
  assert.equal(
    buildImportBlobObjectKey('user-1', 'file-1', 'Statement.qfx'),
    'imports/user-1/file-1/Statement.qfx',
  );
});
