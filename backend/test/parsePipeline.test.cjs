const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBankCsv } = require('../dist/services/import/parse/parseCsv');
const { parseImportBuffer } = require('../dist/services/import/parse/parseImportBuffer');
const { withCanonicalAmount } = require('../dist/services/import/parse/canonical');

test('parseBankCsv maps valid rows and drops invalid rows', () => {
  const csv = [
    'date,amount,description',
    '2024-01-15,10.50,Grocery store',
    '2024-01-16,,Missing amount',
    'bad-date,5.00,Bad date',
    '2024-01-17,-2.00,Refund',
  ].join('\n');

  const rows = parseBankCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].raw_merchant, 'Grocery store');
  assert.equal(rows[0].amount, 10.5);
  assert.equal(rows[1].raw_merchant, 'Refund');
  assert.equal(rows[1].amount, -2);
});

test('parseBankCsv returns empty array for unrecognised headers', () => {
  assert.deepEqual(parseBankCsv('foo,bar\n1,2\n'), []);
});

test('parseImportBuffer detects csv by extension', () => {
  const csv = 'date,amount,description\n2024-01-15,10.50,Grocery store\n';
  const result = parseImportBuffer(
    Buffer.from(csv, 'utf8'),
    'transactions.csv',
    'text/csv',
  );
  assert.equal(result.format, 'csv');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].file_amount, 10.5);
  assert.equal(result.rows[0].canonical_amount, 10.5);
});

test('parseImportBuffer falls back to first parser that yields rows', () => {
  const csv = 'date,amount,description\n2024-03-01,42.00,Unknown format upload\n';
  const result = parseImportBuffer(
    Buffer.from(csv, 'utf8'),
    'upload.bin',
    'application/octet-stream',
  );
  assert.equal(result.format, 'csv');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].raw_merchant, 'Unknown format upload');
});

test('parseImportBuffer returns unknown when no parser matches', () => {
  const result = parseImportBuffer(
    Buffer.from('not import data', 'utf8'),
    'notes.txt',
    'text/plain',
  );
  assert.equal(result.format, 'unknown');
  assert.deepEqual(result.rows, []);
});

test('withCanonicalAmount preserves file and canonical amounts', () => {
  const rows = withCanonicalAmount([
    { date: 1, amount: -5, raw_merchant: 'Coffee' },
  ]);
  assert.deepEqual(rows[0], {
    date: 1,
    file_amount: -5,
    canonical_amount: -5,
    raw_merchant: 'Coffee',
  });
});
