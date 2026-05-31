const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DynamoFinanceRepository } = require('../dist/dynamoFinanceRepository');
const { userPk, fileSk } = require('../dist/keys');

function mockDoc(itemsByKey) {
  const keyOf = (k) => `${k.PK}|${k.SK}`;
  return {
    send: async (cmd) => {
      const name = cmd.constructor.name;
      if (name === 'QueryCommand') {
        const pk = cmd.input.ExpressionAttributeValues?.[':pk'];
        const fp = cmd.input.ExpressionAttributeValues?.[':fp'];
        const out = [];
        for (const item of itemsByKey.values()) {
          if (item.PK !== pk) continue;
          if (fp && !String(item.SK).startsWith(fp)) continue;
          out.push(item);
        }
        return { Items: out };
      }
      return {};
    },
  };
}

test('listTransactionFiles — omits invalid currencyChoice; keeps valid and legacy rows', async () => {
  const userId = 'u1';
  const pk = userPk(userId);
  const items = new Map([
    [
      `${pk}|${fileSk('legacy')}`,
      {
        PK: pk,
        SK: fileSk('legacy'),
        entity_type: 'TRANSACTION_FILE',
        id: 'legacy',
        account_id: 'a1',
        source: { name: 'old.csv', size_bytes: 1 },
        format: { currency: 'USD' },
        timing: { started_at: 1, completed_at: 2 },
        result: { rowCount: 0, knownMerchants: 0, unknownMerchants: 0 },
      },
    ],
    [
      `${pk}|${fileSk('bad-choice')}`,
      {
        PK: pk,
        SK: fileSk('bad-choice'),
        entity_type: 'TRANSACTION_FILE',
        id: 'bad-choice',
        account_id: 'a1',
        source: { name: 'bad.csv', size_bytes: 1 },
        format: { currency: 'EUR', currencyChoice: 'manual_guess' },
        timing: { started_at: 1, completed_at: 2 },
        result: { rowCount: 0, knownMerchants: 0, unknownMerchants: 0 },
      },
    ],
    [
      `${pk}|${fileSk('good')}`,
      {
        PK: pk,
        SK: fileSk('good'),
        entity_type: 'TRANSACTION_FILE',
        id: 'good',
        account_id: 'a1',
        source: { name: 'good.csv', size_bytes: 1 },
        format: { currency: 'GBP', currencyChoice: 'file_hint' },
        timing: { started_at: 1, completed_at: 2 },
        result: { rowCount: 0, knownMerchants: 0, unknownMerchants: 0 },
      },
    ],
  ]);

  const repo = new DynamoFinanceRepository(mockDoc(items), 't1');
  const files = await repo.listTransactionFiles(userId);
  const byId = Object.fromEntries(files.map((f) => [f.id, f]));

  assert.equal(byId.legacy.format.currency, 'USD');
  assert.equal(byId.legacy.format.currencyChoice, undefined);
  assert.equal(byId['bad-choice'].format.currency, 'EUR');
  assert.equal(byId['bad-choice'].format.currencyChoice, undefined);
  assert.equal(byId.good.format.currencyChoice, 'file_hint');
});
