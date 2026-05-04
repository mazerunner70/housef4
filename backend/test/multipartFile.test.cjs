const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractBackupMultipart,
  extractImportMultipart,
  MultipartFileTooLargeError,
} = require('../dist/services/import/multipartFile');

test('extractBackupMultipart rejects when file exceeds maxFileBytes', async () => {
  const boundary = '----housef4-test';
  const payload = 'x'.repeat(80);
  const body = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="backup"; filename="a.json"',
      'Content-Type: application/json',
      '',
      payload,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  await assert.rejects(
    () =>
      extractBackupMultipart(
        {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        { maxFileBytes: 40 },
      ),
    (e) =>
      e instanceof MultipartFileTooLargeError &&
      e.fieldName === 'backup' &&
      e.maxBytes === 40,
  );
});

test('extractBackupMultipart resolves when under maxFileBytes', async () => {
  const boundary = '----housef4-test2';
  const payload = '{"a":1}';
  const body = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="backup"; filename="a.json"',
      '',
      payload,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  const got = await extractBackupMultipart(
    { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
    { maxFileBytes: 1024 },
  );
  assert.ok(got);
  assert.deepEqual(JSON.parse(got.buffer.toString('utf8')), { a: 1 });
});

test('extractImportMultipart rejects when file exceeds maxFileBytes', async () => {
  const boundary = '----housef4-import';
  const payload = 'y'.repeat(60);
  const body = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="a.csv"',
      'Content-Type: text/csv',
      '',
      payload,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  await assert.rejects(
    () =>
      extractImportMultipart(
        {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        { maxFileBytes: 30 },
      ),
    (e) =>
      e instanceof MultipartFileTooLargeError &&
      e.fieldName === 'file' &&
      e.maxBytes === 30,
  );
});
