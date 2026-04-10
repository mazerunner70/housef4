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

test('HEAD /api/health returns 200', async () => {
  const res = await dispatch({
    method: 'HEAD',
    path: '/api/health',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 200);
});

test('protected API path without userId returns 401', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/metrics',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 401);
});

test('unknown protected route with userId returns 404', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/metrics',
    headers: {},
    rawBody: '',
    userId: 'user-1',
  });
  assert.equal(res.statusCode, 404);
});

test('GET /api/me returns userId when authenticated', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/me',
    headers: {},
    rawBody: '',
    userId: 'cognito-sub-abc',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { userId: 'cognito-sub-abc' });
});

test('GET /api/me without userId returns 401', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/me',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 401);
});
