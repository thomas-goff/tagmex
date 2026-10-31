import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CommandError } from '@/features/commands/commands';
import { verifyDiscordSignature } from './discord-signature';
import type { InteractionReply } from './discord';
import { reviewComponents } from './review-components';
import { handleInteraction, type Interaction, type InteractionDeps } from './review-interactions';

const OWNER = '123456789012345678';
const TX = '11111111-1111-4111-8111-111111111111';
const CAT = '00000000-0000-4000-8000-000000000001';
const category = { id: CAT, name: 'Groceries', kind: 'expense' as const, isSystem: false };

function click(customId: string, values?: string[], userId = OWNER): Interaction {
  return { type: 3, application_id: 'app', token: 'tok', data: { custom_id: customId, values }, member: { user: { id: userId } } };
}

function fakeDeps(categorise: InteractionDeps['commands']['categorise'] = async () => ({ status: 'done', category, appliedTo: 0 }) as never) {
  const calls: unknown[][] = [];
  const replies: InteractionReply[] = [];
  const edits: InteractionReply[] = [];
  const deps: InteractionDeps = {
    ownerDiscordId: OWNER,
    reviewOwner: async (transactionId) => (transactionId === TX ? 'owner' : null),
    commands: {
      categorise: async (...args) => {
        calls.push(['categorise', ...args]);
        return categorise(...args);
      },
      exclude: async (...args) => {
        calls.push(['exclude', ...args]);
        return {} as never;
      },
    },
    followUp: async (_app, _token, reply) => void replies.push(reply),
    editOriginal: async (_app, _token, reply) => void edits.push(reply),
    log: { error: () => {} },
  };
  return { deps, calls, replies, edits };
}

const [pickRow, buttonRow] = reviewComponents(TX, [{ id: CAT, name: 'Groceries', emoji: '🛒' }], CAT);
const pickId = pickRow!.components[0]!.custom_id;
const acceptId = buttonRow!.components[0]!.custom_id;
const excludeId = buttonRow!.components[1]!.custom_id;

describe('#needs-review clicks', () => {
  test("Discord's PING gets a PONG", () => {
    assert.deepEqual(handleInteraction({ type: 1, application_id: 'app', token: 't' }, fakeDeps().deps).response, { type: 1 });
  });

  test('only the owner may click; nothing runs for anyone else', () => {
    const { deps } = fakeDeps();
    const stranger = handleInteraction(click(acceptId, undefined, '999999999999'), deps);
    assert.equal((stranger.response as { type: number }).type, 4);
    assert.equal(stranger.work, undefined);

    const nobody = handleInteraction(click(acceptId), { ...deps, ownerDiscordId: undefined });
    assert.equal(nobody.work, undefined);
  });

  test('a dropdown pick defers, then categorises with a learned rule', async () => {
    const { deps, calls, replies } = fakeDeps();
    const { response, work } = handleInteraction(click(pickId, [CAT]), deps);
    assert.deepEqual(response, { type: 6 });
    await work!();
    assert.deepEqual(calls, [['categorise', 'owner', { transactionId: TX, category: CAT, applyToSimilar: true, confirm: false }]]);
    assert.deepEqual(replies, []);
  });

  test('Exclude excludes', async () => {
    const { deps, calls } = fakeDeps();
    await handleInteraction(click(excludeId), deps).work!();
    assert.deepEqual(calls, [['exclude', 'owner', TX]]);
  });

  test('a big learned rule asks first, and the confirm button finishes it', async () => {
    const { deps, calls, replies, edits } = fakeDeps(async (_userId, input) =>
      input.confirm ? ({ status: 'done', category, appliedTo: 29 } as never) : ({ status: 'needs_confirmation', category, wouldAlsoChange: 29 } as never),
    );
    await handleInteraction(click(acceptId), deps).work!();
    assert.match(replies[0]!.content, /file 30 transactions/);
    const confirmId = replies[0]!.components![0]!.components[0]!.custom_id;

    await handleInteraction(click(confirmId), deps).work!();
    assert.equal((calls[1]![2] as { confirm: boolean }).confirm, true);
    assert.deepEqual(edits, [{ content: '✅ Filed 30 as Groceries, sir.', components: [] }]);
  });

  test('a command error is told to the clicker; a transaction with no review message is refused', async () => {
    const { deps, replies } = fakeDeps(async () => {
      throw new CommandError('excluded', 'That transaction is excluded. Restore it first.');
    });
    await handleInteraction(click(acceptId), deps).work!();
    assert.equal(replies[0]!.content, 'That transaction is excluded. Restore it first.');

    const other = fakeDeps();
    await handleInteraction(click(`review:exclude:${CAT}`), other.deps).work!();
    assert.deepEqual(other.calls, []);
    assert.match(other.replies[0]!.content, /can't find/);
  });

  test('controls that are not ours are refused without work', () => {
    const { response, work } = handleInteraction(click('review:delete:everything'), fakeDeps().deps);
    assert.equal((response as { type: number }).type, 4);
    assert.equal(work, undefined);
  });
});

describe('Discord request signatures', () => {
  test('a valid Ed25519 signature passes; a changed body, wrong key or junk fails', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('hex');
    const body = '{"type":1}';
    const timestamp = '1793404174';
    const signature = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(timestamp + body))).toString('hex');

    assert.equal(await verifyDiscordSignature(publicKey, signature, timestamp, body), true);
    assert.equal(await verifyDiscordSignature(publicKey, signature, timestamp, '{"type":2}'), false);
    assert.equal(await verifyDiscordSignature(publicKey, signature, '1793404175', body), false);
    assert.equal(await verifyDiscordSignature('ab'.repeat(32), signature, timestamp, body), false);
    assert.equal(await verifyDiscordSignature(publicKey, 'nothex', timestamp, body), false);
    assert.equal(await verifyDiscordSignature(publicKey, '', timestamp, body), false);
  });
});
