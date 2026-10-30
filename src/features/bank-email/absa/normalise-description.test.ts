import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normaliseDescription } from './normalise-description';

// Shapes from real NotifyMe Merchant/Reference fields (values anonymised).
describe('normaliseDescription', () => {
  test('drops account and reference numbers after the payee', () => {
    assert.equal(normaliseDescription('TELCO 0123456789 X1234567'), 'TELCO');
  });

  test('keeps the description after an EFT reference', () => {
    assert.equal(normaliseDescription('EFTAB12C34D5E678/SALARY'), 'SALARY');
  });

  test('keeps a merchant and suburb as is', () => {
    assert.equal(normaliseDescription('SOME SHOP - SUBURB'), 'SOME SHOP - SUBURB');
  });

  test('upper-cases and collapses whitespace', () => {
    assert.equal(normaliseDescription('  Some   Restaurant  '), 'SOME RESTAURANT');
  });

  test('keeps short numbers that are part of a name', () => {
    assert.equal(normaliseDescription('CAFE 101 ROSEBANK'), 'CAFE 101 ROSEBANK');
  });

  test('trims separators left behind by removed numbers', () => {
    assert.equal(normaliseDescription('SHOP - 12345678'), 'SHOP');
  });

  // Same merchant, different reference numbers: one learned rule must cover every month.
  test('gives recurring debit orders a stable description', () => {
    assert.equal(normaliseDescription('INSURER 4000123456 M0001'), normaliseDescription('INSURER 4000123456 M0002'));
  });

  test('falls back to the raw text when nothing would be left', () => {
    assert.equal(normaliseDescription('12345678'), '12345678');
  });
});
