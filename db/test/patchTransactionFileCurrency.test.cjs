const { test } = require('node:test');
const assert = require('node:assert/strict');

const { DynamoFinanceRepository } = require('../dist/dynamoFinanceRepository');
const {
  userPk,
  txnSk,
  fileSk,
  fileTxnGsi2Pk,
  fileTxnGsi2Sk,
  clusterSk,
  clusterTxnGsi1Pk,
  clusterTxnGsi1Sk,
  PROFILE_SK,
} = require('../dist/keys');

function mockDoc(itemsByKey) {
  const keyOf = (k) => `${k.PK}|${k.SK}`;
  return {
    send: async (cmd) => {
      const name = cmd.constructor.name;
      if (name === 'GetCommand') {
        const item = itemsByKey.get(keyOf(cmd.input.Key));
        return { Item: item };
      }
      if (name === 'UpdateCommand') {
        const item = itemsByKey.get(keyOf(cmd.input.Key));
        if (!item) throw new Error('not found');
        const vals = cmd.input.ExpressionAttributeValues ?? {};
        if (cmd.input.UpdateExpression?.includes('#format.#currency')) {
          item.format = { ...(item.format ?? {}), currency: vals[':c'] };
          if (vals[':choice']) {
            item.format.currencyChoice = vals[':choice'];
          }
        }
        if (cmd.input.UpdateExpression?.includes('default_currency')) {
          item.default_currency = vals[':c'];
        }
        itemsByKey.set(keyOf(cmd.input.Key), item);
        return {};
      }
      if (name === 'QueryCommand') {
        const pk = cmd.input.ExpressionAttributeValues?.[':pk'];
        const out = [];
        for (const item of itemsByKey.values()) {
          if (item.GSI2PK === pk) out.push(item);
        }
        return { Items: out };
      }
      if (name === 'BatchWriteCommand') {
        for (const req of cmd.input.RequestItems?.t1 ?? []) {
          if (req.PutRequest?.Item) {
            itemsByKey.set(keyOf(req.PutRequest.Item), req.PutRequest.Item);
          }
        }
        return {};
      }
      return {};
    },
  };
}

test('patchTransactionFileCurrency — updates file, transactions, profile', async () => {
  const userId = 'u1';
  const fileId = 'file-1';
  const pk = userPk(userId);
  const items = new Map();

  items.set(`${pk}|${fileSk(fileId)}`, {
    PK: pk,
    SK: fileSk(fileId),
    entity_type: 'TRANSACTION_FILE',
    format: { currency: 'USD' },
  });
  items.set(`${pk}|${PROFILE_SK}`, {
    PK: pk,
    SK: PROFILE_SK,
    entity_type: 'PROFILE',
    net_worth: 0,
  });
  items.set(`${pk}|${txnSk('t1')}`, {
    PK: pk,
    SK: txnSk('t1'),
    entity_type: 'TRANSACTION',
    id: 't1',
    cluster_id: 'CL_1',
    transaction_file_id: fileId,
    GSI2PK: fileTxnGsi2Pk(userId, fileId),
    GSI2SK: fileTxnGsi2Sk('t1'),
    GSI1PK: clusterTxnGsi1Pk(userId, 'CL_1'),
    GSI1SK: clusterTxnGsi1Sk('t1'),
  });
  items.set(`${pk}|${clusterSk('CL_1')}`, {
    PK: pk,
    SK: clusterSk('CL_1'),
    entity_type: 'CLUSTER',
    cluster_id: 'CL_1',
    currency: 'USD',
    total_transactions: 1,
    total_amount: 10,
    sample_merchants: ['A'],
    suggested_category: null,
    assigned_category: null,
    pending_review: true,
  });

  const repo = new DynamoFinanceRepository(mockDoc(items), 't1');
  repo.fetchClusterAggregateMembers = async () => [
    {
      raw_merchant: 'A',
      amount: 10,
      status: 'PENDING_REVIEW',
      category: '',
      suggested_category: null,
      category_confidence: 0,
    },
  ];
  repo.fetchClusterAggregateMetadata = async () => null;

  const result = await repo.patchTransactionFileCurrency(userId, fileId, 'eur', {
    setProfileDefault: true,
  });

  assert.equal(result.currency, 'EUR');
  assert.equal(result.transactions_updated, 1);
  assert.equal(result.profile_default_updated, true);
  assert.equal(items.get(`${pk}|${fileSk(fileId)}`).format.currency, 'EUR');
  assert.equal(items.get(`${pk}|${fileSk(fileId)}`).format.currencyChoice, 'user_override');
  assert.equal(items.get(`${pk}|${txnSk('t1')}`).currency, 'EUR');
  assert.equal(items.get(`${pk}|${PROFILE_SK}`).default_currency, 'EUR');
});
