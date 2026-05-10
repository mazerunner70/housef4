const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeCsvCell,
  formatTransactionsAsCsv,
} = require('../dist/transactionCsvExport');

test('escapeCsvCell quotes commas and quotes', () => {
  assert.equal(escapeCsvCell('a'), 'a');
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
});

test('escapeCsvCell prefixes formula-leading strings before quoting', () => {
  assert.equal(escapeCsvCell('=1+2'), '\'=1+2');
  assert.equal(escapeCsvCell('+macro'), "'+macro");
  assert.equal(escapeCsvCell('-oops'), "'-oops");
  assert.equal(escapeCsvCell('@ref'), "'@ref");
  assert.equal(escapeCsvCell('=evil,fn'), `"'=evil,fn"`);
});

test('formatTransactionsAsCsv joins account and import metadata', () => {
  const csv = formatTransactionsAsCsv({
    transactions: [
      {
        user_id: 'u1',
        id: 't1',
        date: 2000,
        raw_merchant: 'Co,ffee',
        amount: -5,
        category: 'Food',
        status: 'CLASSIFIED',
        is_recurring: false,
        transaction_file_id: 'f1',
        cluster_id: 'c9',
        cleaned_merchant: 'COFFEE',
        suggested_category: null,
        category_confidence: 0.9,
        match_type: 'exact',
        merchant_embedding: [1, 2],
      },
    ],
    accounts: [{ user_id: 'u1', id: 'acc1', name: 'Main', created_at: 1 }],
    transactionFiles: [
      {
        user_id: 'u1',
        id: 'f1',
        account_id: 'acc1',
        source: { name: 'stmt.csv', size_bytes: 10 },
        format: { source_format: 'csv', currency: 'USD', amount_negated: false },
        timing: { started_at: 1, completed_at: 2 },
        result: {
          rowCount: 1,
          knownMerchants: 1,
          unknownMerchants: 0,
          existingTransactionsUpdated: 0,
          newClustersTouched: 1,
        },
      },
    ],
  });

  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('import_amount_negated'));
  assert.match(lines[1], /,USD,false,/);
  assert.match(lines[1], /,-5,,c9,/);
  assert.ok(lines[1].includes('"Co,ffee"'));
  assert.ok(lines[1].includes('c9'));
  assert.ok(lines[1].includes('Food'));
  assert.ok(lines[1].includes('acc1'));
  assert.ok(lines[1].includes('Main'));
  assert.ok(lines[1].includes('stmt.csv'));
  assert.ok(lines[1].includes('[1,2]'));
});
