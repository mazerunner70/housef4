const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  bodyFieldsFromBuffer,
  methodMayHaveBody,
  normalizeHeaderValues,
  queryFromUrl,
  serializeResponsePayload,
} = require('../dist/adapters/httpCommon');

test('methodMayHaveBody excludes GET and HEAD', () => {
  assert.equal(methodMayHaveBody('GET'), false);
  assert.equal(methodMayHaveBody('head'), false);
  assert.equal(methodMayHaveBody('POST'), true);
});

test('normalizeHeaderValues joins repeated header values', () => {
  assert.deepEqual(
    normalizeHeaderValues({ accept: ['text/html', 'application/json'], host: 'localhost' }),
    { accept: 'text/html, application/json', host: 'localhost' },
  );
});

test('queryFromUrl returns undefined for empty search params', () => {
  const url = new URL('http://127.0.0.1/api/health');
  assert.equal(queryFromUrl(url), undefined);
});

test('queryFromUrl maps search params to a query record', () => {
  const url = new URL('http://127.0.0.1/items?limit=10&cursor=abc');
  assert.deepEqual(queryFromUrl(url), { limit: '10', cursor: 'abc' });
});

test('serializeResponsePayload passes through strings and JSON-encodes objects', () => {
  assert.equal(serializeResponsePayload('plain'), 'plain');
  assert.equal(serializeResponsePayload({ ok: true }), '{"ok":true}');
});

test('bodyFieldsFromBuffer omits empty buffers', () => {
  assert.deepEqual(bodyFieldsFromBuffer(Buffer.alloc(0)), {
    rawBody: '',
    bodyBuffer: undefined,
  });
});

test('bodyFieldsFromBuffer exposes utf8 text and raw bytes', () => {
  const buf = Buffer.from('hello', 'utf8');
  assert.deepEqual(bodyFieldsFromBuffer(buf), {
    rawBody: 'hello',
    bodyBuffer: buf,
  });
});
