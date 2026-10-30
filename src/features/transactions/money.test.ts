import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { centsToDecimal, decimalToCents } from './money';

describe('money', () => {
  test('cents to numeric', () => {
    assert.equal(centsToDecimal(-12340), '-123.40');
    assert.equal(centsToDecimal(5), '0.05');
    assert.equal(centsToDecimal(-5), '-0.05');
    assert.equal(centsToDecimal(0), '0.00');
    assert.equal(centsToDecimal(123456789), '1234567.89');
  });

  test('numeric to cents', () => {
    assert.equal(decimalToCents('-123.40'), -12340);
    assert.equal(decimalToCents('0.05'), 5);
    assert.equal(decimalToCents('-0.05'), -5);
    assert.equal(decimalToCents('12.5'), 1250);
    assert.equal(decimalToCents('100'), 10000);
    assert.equal(decimalToCents('-0.00'), 0);
  });

  test('round-trips without float error', () => {
    for (const cents of [1, 10, 99, 101, 1999, -2999, 1_000_000_01]) {
      assert.equal(decimalToCents(centsToDecimal(cents)), cents);
    }
  });

  test('rejects anything that is not money', () => {
    assert.throws(() => centsToDecimal(1.5));
    assert.throws(() => decimalToCents('R10.00'));
    assert.throws(() => decimalToCents('1.234'));
  });
});
