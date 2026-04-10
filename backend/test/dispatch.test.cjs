const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dispatch } = require('../dist/dispatch');

test('GET /api/health returns 200', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/health',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('GET /api/health accepts API Gateway-style prefixed path', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/Prod/api/health',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 200);
});

test('unknown route returns 404', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/metrics',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 404);
});
