import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createParserRegistry } from './registry';
import type { IBankEmailParser } from './types';

const parser = (name: string): IBankEmailParser => ({ parse: () => ({ status: 'ignored', reason: name }) });

describe('parser registry', () => {
  const absa = parser('absa');
  const other = parser('other');
  const registry = createParserRegistry([
    { sender: 'NotifyMe@absa.co.za', parser: absa },
    { sender: 'alerts@otherbank.example', parser: other },
  ]);

  test('picks the parser by the From header, whatever its case or display name', () => {
    assert.equal(registry.parserFor('Absa <notifyme@ABSA.co.za>'), absa);
    assert.equal(registry.parserFor('alerts@otherbank.example'), other);
    assert.equal(registry.parserFor('someone@example.com'), null);
    assert.equal(registry.parserFor(''), null);
    assert.equal(registry.parserFor('notifyme@absa.co.za <evil@example.com>'), null);
    assert.equal(registry.parserFor('xnotifyme@absa.co.za'), null);
  });

  test('searches Gmail for one bank, or for any of several', () => {
    assert.equal(createParserRegistry([{ sender: 'notifyme@absa.co.za', parser: absa }]).query('30d'), 'from:notifyme@absa.co.za newer_than:30d');
    assert.equal(registry.query('7d'), 'from:(notifyme@absa.co.za OR alerts@otherbank.example) newer_than:7d');
  });

  test('refuses to be empty', () => {
    assert.throws(() => createParserRegistry([]));
  });
});
