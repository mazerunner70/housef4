const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  unanimousPriorCategoryForGroup,
  inheritedCategoryForGroup,
} = require('../dist/services/import/clustering/assignment');

test('unanimousPriorCategoryForGroup — unanimous existing categories', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    { kind: 'new', row: {}, id: 'n1' },
  ];
  assert.equal(unanimousPriorCategoryForGroup([0, 1, 2], sources), 'Food');
});

test('unanimousPriorCategoryForGroup — mixed existing categories returns null', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Travel', status: 'CLASSIFIED' },
    },
  ];
  assert.equal(unanimousPriorCategoryForGroup([0, 1], sources), null);
});

test('unanimousPriorCategoryForGroup — new-only group returns null', () => {
  const sources = [{ kind: 'new', row: {}, id: 'n1' }];
  assert.equal(unanimousPriorCategoryForGroup([0], sources), null);
});

test('inheritedCategoryForGroup — plurality wins', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Travel', status: 'CLASSIFIED' },
    },
  ];
  assert.equal(inheritedCategoryForGroup([0, 1, 2], sources), 'Food');
});

test('inheritedCategoryForGroup — tie breaks lexicographically', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Travel', status: 'CLASSIFIED' },
    },
    {
      kind: 'existing',
      record: { category: 'Food', status: 'CLASSIFIED' },
    },
  ];
  assert.equal(inheritedCategoryForGroup([0, 1], sources), 'Food');
});

test('inheritedCategoryForGroup — ignores non-CLASSIFIED existing rows', () => {
  const sources = [
    {
      kind: 'existing',
      record: { category: 'Food', status: 'PENDING_REVIEW' },
    },
    { kind: 'new', row: {}, id: 'n1' },
  ];
  assert.equal(inheritedCategoryForGroup([0, 1], sources), null);
});
