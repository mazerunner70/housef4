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
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.build, 'unknown');
  assert.equal(res.body.diagnostic.code, 'NO_TABLE_ENV');
  assert.match(res.body.diagnostic.hint, /DYNAMODB_TABLE_NAME/);
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
    path: '/api/not-implemented-yet',
    headers: {},
    rawBody: '',
    userId: 'user-1',
  });
  assert.equal(res.statusCode, 404);
});

test('GET /api/metrics with userId without DYNAMODB_TABLE_NAME returns 500', async () => {
  const prev = process.env.DYNAMODB_TABLE_NAME;
  delete process.env.DYNAMODB_TABLE_NAME;
  try {
    const res = await dispatch({
      method: 'GET',
      path: '/api/metrics',
      headers: {},
      rawBody: '',
      userId: 'user-1',
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal Server Error' });
  } finally {
    if (prev !== undefined) process.env.DYNAMODB_TABLE_NAME = prev;
  }
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

test('POST /api/rules/tag with invalid JSON returns 400', async () => {
  const res = await dispatch({
    method: 'POST',
    path: '/api/rules/tag',
    headers: {},
    rawBody: 'not-json',
    userId: 'user-1',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid JSON body');
});

test('GET /api/transactions with userId without DYNAMODB_TABLE_NAME returns 500', async () => {
  const prev = process.env.DYNAMODB_TABLE_NAME;
  delete process.env.DYNAMODB_TABLE_NAME;
  try {
    const res = await dispatch({
      method: 'GET',
      path: '/api/transactions',
      headers: {},
      rawBody: '',
      userId: 'user-1',
    });
    assert.equal(res.statusCode, 500);
  } finally {
    if (prev !== undefined) process.env.DYNAMODB_TABLE_NAME = prev;
  }
});

test('GET /api/backup/export without userId returns 401', async () => {
  const res = await dispatch({
    method: 'GET',
    path: '/api/backup/export',
    headers: {},
    rawBody: '',
  });
  assert.equal(res.statusCode, 401);
});

test('GET /api/backup/export with userId without DYNAMODB_TABLE_NAME returns 500', async () => {
  const prev = process.env.DYNAMODB_TABLE_NAME;
  delete process.env.DYNAMODB_TABLE_NAME;
  try {
    const res = await dispatch({
      method: 'GET',
      path: '/api/backup/export',
      headers: {},
      rawBody: '',
      userId: 'user-1',
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal Server Error' });
  } finally {
    if (prev !== undefined) process.env.DYNAMODB_TABLE_NAME = prev;
  }
});

test('POST /api/backup/restore without userId returns 401', async () => {
  const res = await dispatch({
    method: 'POST',
    path: '/api/backup/restore',
    headers: {},
    rawBody: '',
    bodyBuffer: Buffer.from([]),
  });
  assert.equal(res.statusCode, 401);
});

test('POST /api/backup/restore with empty buffer returns 400', async () => {
  const res = await dispatch({
    method: 'POST',
    path: '/api/backup/restore',
    headers: {},
    rawBody: '',
    bodyBuffer: Buffer.from([]),
    userId: 'user-1',
  });
  assert.equal(res.statusCode, 400);
});

test('POST /api/backup/restore without multipart returns 400', async () => {
  const res = await dispatch({
    method: 'POST',
    path: '/api/backup/restore',
    headers: { 'content-type': 'application/json' },
    rawBody: '{}',
    bodyBuffer: Buffer.from('{}'),
    userId: 'user-1',
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /multipart/i);
});
