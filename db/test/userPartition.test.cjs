const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');
const {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  queryUserPartitionPages,
  collectUserPartitionItems,
  deleteUserPartition,
  acquireRestoreLock,
  releaseRestoreLock,
  deleteRestoreLockIfPresent,
  getRestoreLock,
  RestoreLockConflictError,
} = require('../dist/userPartition');
const { RESTORE_LOCK_SK, userPk } = require('../dist/keys');

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

test('queryUserPartitionPages paginates until LastEvaluatedKey is absent', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  let calls = 0;
  /** @type {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} */
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      assert.equal(cmd.input.TableName, 'tbl');
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          Items: [{ PK: userPk('u1'), SK: 'PROFILE' }],
          LastEvaluatedKey: { PK: userPk('u1'), SK: 'PROFILE' },
        });
      }
      return Promise.resolve({
        Items: [{ PK: userPk('u1'), SK: 'METRICS' }],
      });
    },
  };
  const pages = [];
  for await (const page of queryUserPartitionPages({
    docClient,
    dataset: 'primary',
    userId: 'u1',
    pageLimit: 10,
  })) {
    pages.push(page);
  }
  assert.equal(calls, 2);
  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((p) => p.map((i) => i.SK)),
    [['PROFILE'], ['METRICS']],
  );
});

test('queryUserPartitionPages with excludeRestoreLock drops lock row', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  let calls = 0;
  const docClient = {
    send(cmd) {
      calls += 1;
      assert.ok(cmd instanceof QueryCommand);
      assert.equal(cmd.input.TableName, 'tbl');
      return Promise.resolve({
        Items: [
          { PK: userPk('x'), SK: 'PROFILE' },
          { PK: userPk('x'), SK: RESTORE_LOCK_SK },
        ],
      });
    },
  };
  const pages = [];
  for await (const page of queryUserPartitionPages({
    docClient,
    dataset: 'primary',
    userId: 'x',
    excludeRestoreLock: true,
  })) {
    pages.push(page);
  }
  assert.equal(calls, 1);
  assert.deepEqual(pages.flat().map((i) => i.SK), ['PROFILE']);
});

test('collectUserPartitionItems concatenates pages', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  let calls = 0;
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof QueryCommand);
      assert.equal(cmd.input.TableName, 'tbl');
      calls += 1;
      return Promise.resolve({
        Items: [{ SK: calls === 1 ? 'A' : 'B' }],
        LastEvaluatedKey: calls === 1 ? { PK: userPk('u'), SK: 'A' } : undefined,
      });
    },
  };
  const all = await collectUserPartitionItems({
    docClient,
    dataset: 'primary',
    userId: 'u',
  });
  assert.equal(all.length, 2);
});

test('deleteUserPartition skips RESTORE_LOCK on primary when option omitted', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  const deleted = [];
  const docClient = {
    send(cmd) {
      if (cmd instanceof QueryCommand) {
        assert.equal(cmd.input.TableName, 'tbl');
        return Promise.resolve({
          Items: [
            { PK: userPk('u42'), SK: 'TXN#a' },
            { PK: userPk('u42'), SK: RESTORE_LOCK_SK },
          ],
        });
      }
      if (cmd instanceof BatchWriteCommand) {
        const reqs = cmd.input.RequestItems?.tbl ?? [];
        for (const r of reqs) {
          if (r.DeleteRequest?.Key?.SK != null)
            deleted.push(r.DeleteRequest.Key.SK);
        }
        return Promise.resolve({});
      }
      assert.fail('unexpected command');
    },
  };

  await deleteUserPartition({ docClient, dataset: 'primary', userId: 'u42' });
  const sortedDeleted = [...deleted].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  assert.deepEqual(sortedDeleted, ['TXN#a']);
});

test('deleteUserPartition on restore_staging uses DYNAMODB_RESTORE_STAGING_TABLE_NAME', async (t) => {
  withEnv(t, {
    DYNAMODB_RESTORE_STAGING_TABLE_NAME: 'staging-tbl',
  });
  let queryTable;
  const docClient = {
    send(cmd) {
      if (cmd instanceof QueryCommand) {
        queryTable = cmd.input.TableName;
        return Promise.resolve({
          Items: [{ PK: userPk('u'), SK: 'PROFILE' }],
        });
      }
      if (cmd instanceof BatchWriteCommand) {
        assert.ok(cmd.input.RequestItems?.['staging-tbl']?.length);
        return Promise.resolve({});
      }
      assert.fail('unexpected command');
    },
  };

  await deleteUserPartition({
    docClient,
    dataset: 'restore_staging',
    userId: 'u',
  });
  assert.equal(queryTable, 'staging-tbl');
});

test('deleteUserPartition on restore_staging deletes RESTORE_LOCK SK if present', async (t) => {
  withEnv(t, {
    DYNAMODB_RESTORE_STAGING_TABLE_NAME: 'staging-tbl',
  });
  const deleted = [];
  const docClient = {
    send(cmd) {
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({
          Items: [
            { PK: userPk('u'), SK: 'PROFILE' },
            { PK: userPk('u'), SK: RESTORE_LOCK_SK },
          ],
        });
      }
      if (cmd instanceof BatchWriteCommand) {
        const reqs = cmd.input.RequestItems?.['staging-tbl'] ?? [];
        for (const r of reqs) {
          deleted.push(String(r.DeleteRequest?.Key?.SK ?? ''));
        }
        return Promise.resolve({});
      }
      assert.fail('unexpected command');
    },
  };
  await deleteUserPartition({
    docClient,
    dataset: 'restore_staging',
    userId: 'u',
  });
  const sortedDeleted = [...deleted].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  const expected = [RESTORE_LOCK_SK, 'PROFILE'].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  assert.deepEqual(sortedDeleted, expected);
});

test('deleteUserPartition rejects when staging env is missing', async (t) => {
  const prevStaging = process.env.DYNAMODB_RESTORE_STAGING_TABLE_NAME;
  delete process.env.DYNAMODB_RESTORE_STAGING_TABLE_NAME;
  t.after(() => {
    if (prevStaging === undefined) delete process.env.DYNAMODB_RESTORE_STAGING_TABLE_NAME;
    else process.env.DYNAMODB_RESTORE_STAGING_TABLE_NAME = prevStaging;
  });
  const noop = {
    async send() {
      assert.fail('should not reach DynamoDB');
    },
  };
  await assert.rejects(
    () =>
      deleteUserPartition({
        docClient: noop,
        dataset: 'restore_staging',
        userId: 'u',
      }),
    /DYNAMODB_RESTORE_STAGING_TABLE_NAME/,
  );
});

test('acquireRestoreLock succeeds on conditional put against DYNAMODB_TABLE_NAME', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'tbl' });
  let putCount = 0;
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof PutCommand);
      assert.equal(cmd.input.TableName, 'tbl');
      putCount += 1;
      assert.match(cmd.input.ConditionExpression, /attribute_not_exists/);
      return Promise.resolve({});
    },
  };
  await acquireRestoreLock(docClient, 'user1', {
    restore_started_at: 1700,
    backup_schema_version: 1,
  });
  assert.equal(putCount, 1);
});

test('acquireRestoreLock maps ConditionalCheckFailedException to RestoreLockConflictError', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'ignored' });
  const docClient = {
    send() {
      throw new ConditionalCheckFailedException({
        message: 'conditional failure',
        $metadata: {},
      });
    },
  };

  await assert.rejects(
    () => acquireRestoreLock(docClient, 'user2', { restore_started_at: 5 }),
    (err) =>
      err instanceof RestoreLockConflictError && err.userId === 'user2',
  );
});

test('releaseRestoreLock sends DeleteCommand with primary table from env', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'prim' });
  let got;
  const docClient = {
    send(cmd) {
      got = cmd;
      assert.ok(cmd instanceof DeleteCommand);
      return Promise.resolve({});
    },
  };
  await releaseRestoreLock(docClient, 'u9');
  assert.deepEqual(got.input.Key, {
    PK: userPk('u9'),
    SK: RESTORE_LOCK_SK,
  });
  assert.equal(got.input.TableName, 'prim');
});

test('deleteRestoreLockIfPresent returns true when Delete returns Attributes', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'prim' });
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof DeleteCommand);
      assert.equal(cmd.input.ReturnValues, 'ALL_OLD');
      return Promise.resolve({
        Attributes: { PK: userPk('u8'), SK: RESTORE_LOCK_SK },
      });
    },
  };
  const cleared = await deleteRestoreLockIfPresent(docClient, 'u8');
  assert.equal(cleared, true);
});

test('deleteRestoreLockIfPresent returns false when lock was absent', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'prim' });
  const docClient = {
    send() {
      return Promise.resolve({});
    },
  };
  const cleared = await deleteRestoreLockIfPresent(docClient, 'u8');
  assert.equal(cleared, false);
});

test('getRestoreLock omits restore_started_at when missing or invalid', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 't-rest' });
  for (const item of [{ restore_started_at: 'nope' }, {}]) {
    const docClient = {
      send() {
        return Promise.resolve({
          Item: {
            entity_type: 'RESTORE_LOCK',
            user_id: 'u99',
            ...item,
            PK: userPk('u99'),
            SK: RESTORE_LOCK_SK,
          },
        });
      },
    };
    const row = await getRestoreLock(docClient, 'u99');
    assert.deepEqual(row, {
      entity_type: 'RESTORE_LOCK',
      user_id: 'u99',
    });
  }
});

test('getRestoreLock parses saved row using DYNAMODB_TABLE_NAME', async (t) => {
  withEnv(t, { DYNAMODB_TABLE_NAME: 'metrics-prod' });
  const docClient = {
    send(cmd) {
      assert.ok(cmd instanceof GetCommand);
      assert.equal(cmd.input.TableName, 'metrics-prod');
      return Promise.resolve({
        Item: {
          entity_type: 'RESTORE_LOCK',
          user_id: 'me',
          restore_started_at: 99,
          backup_schema_version: 2,
          PK: userPk('me'),
          SK: RESTORE_LOCK_SK,
        },
      });
    },
  };
  const row = await getRestoreLock(docClient, 'me');
  assert.deepEqual(row, {
    entity_type: 'RESTORE_LOCK',
    user_id: 'me',
    restore_started_at: 99,
    backup_schema_version: 2,
  });
});
