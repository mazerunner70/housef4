const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanMerchantName,
  removeDdMmmDates,
  cleanMerchantForClustering,
} = require('../dist/services/import/merchantNormalize');

test('cleanMerchantName: notebook head() examples (before remove_dd_mmm_dates)', () => {
  assert.equal(cleanMerchantName('PAYPAL PAYMENT'), 'PAYMENT');
  assert.equal(
    cleanMerchantName('AMZNMktplace*CV3L1 \tON 03 DEC BC'),
    'AMZNMKTPLACE ON 03 DEC BC',
  );
  assert.equal(cleanMerchantName('CEX \tON 01 JUN CLP'), 'CEX ON 01 JUN CLP');
  assert.equal(
    cleanMerchantName('SPEEDWELL PHARMACY \tON 16 JUN CL'),
    'SPEEDWELL PHARMACY ON 16 JUN CL',
  );
  assert.equal(
    cleanMerchantName('SAINSBURYS S/MKTS \tON 03 NOV CLP'),
    'SAINSBURYS SUPERMARKET ON 03 NOV CLP',
  );
});

test('removeDdMmmDates: notebook second head() examples', () => {
  assert.equal(
    removeDdMmmDates('AMZNMKTPLACE ON 03 DEC BC'),
    'AMZNMKTPLACE',
  );
  assert.equal(removeDdMmmDates('CEX ON 01 JUN CLP'), 'CEX');
  assert.equal(
    removeDdMmmDates('SPEEDWELL PHARMACY ON 16 JUN CL'),
    'SPEEDWELL PHARMACY',
  );
  assert.equal(
    removeDdMmmDates('SAINSBURYS SUPERMARKET ON 03 NOV CLP'),
    'SAINSBURYS SUPERMARKET',
  );
});

test('cleanMerchantForClustering: full pipeline golden strings', () => {
  assert.equal(cleanMerchantForClustering('PAYPAL PAYMENT'), 'PAYMENT');
  assert.equal(
    cleanMerchantForClustering('AMZNMktplace*CV3L1 \tON 03 DEC BC'),
    'AMZNMKTPLACE',
  );
  assert.equal(cleanMerchantForClustering('CEX \tON 01 JUN CLP'), 'CEX');
  assert.equal(
    cleanMerchantForClustering('SPEEDWELL PHARMACY \tON 16 JUN CL'),
    'SPEEDWELL PHARMACY',
  );
  assert.equal(
    cleanMerchantForClustering('SAINSBURYS S/MKTS \tON 03 NOV CLP'),
    'SAINSBURYS SUPERMARKET',
  );
});

test('cleanMerchantForClustering: empty and non-string-safe', () => {
  assert.equal(cleanMerchantForClustering(''), '');
});
