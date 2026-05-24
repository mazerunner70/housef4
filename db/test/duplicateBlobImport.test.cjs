const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoFinanceRepository } = require('../dist/dynamoFinanceRepository');
const { FILE_PREFIX, userPk } = require('../dist/keys');

/**
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string | undefined>} assignments
 */
function withEnv(t, assignments) {
  const previous = {};
  for (const key of Object.keys(assignments)) {
    previous[key] = process.env[key];
    const v = assignments[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  t.after(() => {
    for (const key of Object.keys(assignments)) {
      const p = previous[key];
      if (p === undefined) delete process.env[key];
      else process.env[key] = p;
    }
  });
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function transactionFileItem(userId, fileId, overrides = {}) {
  return {
    PK: userPk(userId),
    SK: `${FILE_PREFIX}${fileId}`,
    entity_type: 'TRANSACTION_FILE',
    user_id: userId,
    id: fileId,
    account_id: 'acc-1',
    source: { name: 'chase.csv', size_bytes: 10 },
    format: {},
    timing: { started_at: 1, completed_at: 1_700_000_000_000 },
    result: {
      rowCount: 1,
      knownMerchants: 0,
      unknownMerchants: 1,
      existingTransactionsUpdated: 0,
      newClustersTouched: 1,
    },
    ...overrides,
  };
}

const baseFileInput = {
  id: 'file-new',
  account_id: 'acc-1',
  source: { name: 'upload.csv', size_bytes: 12 },
  format: {},
  timing: { started_at: 100, completed_at: 200 },
  result: {
    rowCount: 0,
    knownMerchants: 0,
    unknownMerchants: 0,
    existingTransactionsUpdated: 0,
    newClustersTouched: 0,
  },
};

test('findDuplicateBlobImport — returns prior file metadata when hash matches', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const hash = sha256Hex(Buffer.from('same-bytes'));

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      assert.equal(cmd.input.ExpressionAttributeValues[':h'], hash);
      return Promise.resolve({
        Items: [
          transactionFileItem('u-dedupe', 'file-prior', {
            content_sha256: hash,
            source: { name: 'prior.ofx', size_bytes: 99 },
            timing: { started_at: 50, completed_at: 1_800_000_000_000 },
          }),
        ],
      });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const match = await repo.findDuplicateBlobImport('u-dedupe', hash);

  assert.deepEqual(match, {
    importFileId: 'file-prior',
    sourceName: 'prior.ofx',
    completedAt: 1_800_000_000_000,
  });
});

test('findDuplicateBlobImport — returns null when no file has the hash', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const hash = sha256Hex(Buffer.from('unique'));

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      return Promise.resolve({ Items: [] });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const match = await repo.findDuplicateBlobImport('u-dedupe', hash);
  assert.equal(match, null);
});

test('findDuplicateBlobImport — skips legacy rows without content_sha256', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const hash = sha256Hex(Buffer.from('new-upload'));

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      return Promise.resolve({
        Items: [
          transactionFileItem('u-legacy', 'file-old', {
            name: 'legacy.csv',
            timing: { started_at: 1, completed_at: 2 },
          }),
        ],
      });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const match = await repo.findDuplicateBlobImport('u-legacy', hash);
  assert.equal(match, null);
});

test('findDuplicateBlobImport — empty hash short-circuits without query', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  let called = false;

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send() {
      called = true;
      return Promise.resolve({ Items: [] });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  assert.equal(await repo.findDuplicateBlobImport('u1', ''), null);
  assert.equal(await repo.findDuplicateBlobImport('u1', '   '), null);
  assert.equal(called, false);
});

test('recordTransactionFile — persists content_sha256 on the Dynamo item', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const hash = sha256Hex(Buffer.from('persist-me'));
  /** @type {Record<string, unknown> | undefined} */
  let putItem;

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof PutCommand);
      putItem = cmd.input.Item;
      return Promise.resolve({});
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  await repo.recordTransactionFile('u1', {
    ...baseFileInput,
    content_sha256: hash,
  });

  assert.equal(putItem.content_sha256, hash);
  assert.equal(putItem.entity_type, 'TRANSACTION_FILE');
});

test('patchTransactionFileBlob — sets blob map on existing TRANSACTION_FILE', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  /** @type {Record<string, unknown> | undefined} */
  let updateInput;

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof UpdateCommand);
      updateInput = cmd.input;
      return Promise.resolve({});
    },
  };

  const blob = {
    kind: 's3',
    key: 'imports/u1/f1/Statement.csv',
    bucket: 'housef4-dev-import-blobs',
    content_sha256: sha256Hex(Buffer.from('patch')),
    stored_bytes: 99,
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  await repo.patchTransactionFileBlob('u1', 'f1', blob);

  assert.equal(updateInput.TableName, 'tbl');
  assert.equal(updateInput.Key.PK, userPk('u1'));
  assert.equal(updateInput.Key.SK, `${FILE_PREFIX}f1`);
  assert.deepEqual(updateInput.ExpressionAttributeValues[':blob'], blob);
  assert.equal(updateInput.ConditionExpression, 'entity_type = :et');
});

test('listTransactionFiles — surfaces content_sha256 when stored', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const hash = sha256Hex(Buffer.from('listed'));

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      return Promise.resolve({
        Items: [
          transactionFileItem('u1', 'f1', { content_sha256: hash }),
          transactionFileItem('u1', 'f2'),
        ],
      });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const files = await repo.listTransactionFiles('u1');

  assert.equal(files.length, 2);
  const withHash = files.find((f) => f.id === 'f1');
  const legacy = files.find((f) => f.id === 'f2');
  assert.equal(withHash.content_sha256, hash);
  assert.equal(legacy.content_sha256, undefined);
});

test('listTransactionFiles — surfaces blob map when stored', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const blob = {
    kind: 's3',
    key: 'imports/u1/f1/Statement.csv',
    bucket: 'housef4-dev-import-blobs',
    content_sha256: sha256Hex(Buffer.from('listed')),
    stored_bytes: 42,
  };

  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      return Promise.resolve({
        Items: [transactionFileItem('u1', 'f1', { blob })],
      });
    },
  };

  const repo = new DynamoFinanceRepository(docClient, 'tbl');
  const files = await repo.listTransactionFiles('u1');

  assert.equal(files.length, 1);
  assert.deepEqual(files[0].blob, blob);
});
