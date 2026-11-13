import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fromAddress, senderAuthFailure } from './sender-auth';

const BANK = 'notifyme@absa.co.za';
// As Gmail records a real Absa notification.
const GENUINE =
  'mx.google.com; dkim=pass header.i=@absa.co.za header.s=homebanking header.b=mI0oGVL8; spf=pass (google.com: domain of notifyme@absa.co.za designates 169.202.185.70 as permitted sender) smtp.mailfrom=notifyme@absa.co.za; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=absa.co.za';

describe('fromAddress', () => {
  test('reads bare and display-name forms', () => {
    assert.equal(fromAddress('notifyme@absa.co.za'), BANK);
    assert.equal(fromAddress('Absa <NotifyMe@ABSA.co.za>'), BANK);
    assert.equal(fromAddress('"Absa Bank" <notifyme@absa.co.za> '), BANK);
  });

  test('refuses lookalikes and multiple addresses', () => {
    assert.equal(fromAddress('notifyme@absa.co.za <evil@example.com>'), null);
    assert.equal(fromAddress('a@example.com, notifyme@absa.co.za'), null);
    assert.equal(fromAddress('Absa'), null);
    assert.equal(fromAddress(''), null);
  });
});

describe('senderAuthFailure', () => {
  test('accepts a DMARC pass for the bank domain recorded by Gmail', () => {
    assert.equal(senderAuthFailure(GENUINE, BANK), null);
  });

  test('refuses a DMARC failure or a missing result', () => {
    assert.match(senderAuthFailure(GENUINE.replace('dmarc=pass', 'dmarc=fail'), BANK)!, /DMARC fail/);
    assert.match(senderAuthFailure('mx.google.com; spf=pass smtp.mailfrom=x@absa.co.za', BANK)!, /no DMARC/);
    assert.match(senderAuthFailure('', BANK)!, /no Authentication-Results/);
  });

  test('refuses a pass for another domain', () => {
    assert.match(senderAuthFailure(GENUINE.replace('header.from=absa.co.za', 'header.from=absa.co.za.evil.example'), BANK)!, /not absa\.co\.za/);
  });

  test('refuses results not written by Gmail', () => {
    assert.match(senderAuthFailure(GENUINE.replace('mx.google.com', 'mail.evil.example'), BANK)!, /not mx\.google\.com/);
  });
});
