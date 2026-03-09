import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGame, requirePlayer } from './guards.js';

function mockInteraction() {
  const i = { followUpCalled: false, followUpArgs: null, replyCalled: false, replyArgs: null };
  i.followUp = async (args) => { i.followUpCalled = true; i.followUpArgs = args; };
  i.reply = async (args) => { i.replyCalled = true; i.replyArgs = args; };
  return i;
}

describe('requireGame', () => {
  test('returns game when found', async () => {
    const game = { gameId: 'g1' };
    const result = await requireGame(mockInteraction(), () => game, 'g1');
    assert.strictEqual(result, game);
  });

  test('returns null and replies when not found', async () => {
    const interaction = mockInteraction();
    const result = await requireGame(interaction, () => null, 'g1');
    assert.strictEqual(result, null);
    assert.strictEqual(interaction.followUpCalled, true);
    assert.strictEqual(interaction.followUpArgs.content, 'Game not found.');
  });

  test('returns null for ended game when checkEnded=true', async () => {
    const interaction = mockInteraction();
    const result = await requireGame(interaction, () => ({ ended: true }), 'g1', { checkEnded: true });
    assert.strictEqual(result, null);
    assert.strictEqual(interaction.followUpArgs.content, 'This game has ended.');
  });

  test('returns game for ended game when checkEnded not set', async () => {
    const game = { ended: true };
    const result = await requireGame(mockInteraction(), () => game, 'g1');
    assert.strictEqual(result, game);
  });

  test('silent mode returns null without replying', async () => {
    const interaction = mockInteraction();
    const result = await requireGame(interaction, () => null, 'g1', { silent: true });
    assert.strictEqual(result, null);
    assert.strictEqual(interaction.followUpCalled, false);
  });
});

describe('requirePlayer', () => {
  const allow = () => true;
  const deny = () => false;

  test('returns true when authorized', async () => {
    const result = await requirePlayer(mockInteraction(), {}, 'u1', 1, allow);
    assert.strictEqual(result, true);
  });

  test('returns false and sends followUp when unauthorized', async () => {
    const interaction = mockInteraction();
    const result = await requirePlayer(interaction, {}, 'u99', 1, deny);
    assert.strictEqual(result, false);
    assert.strictEqual(interaction.followUpCalled, true);
  });

  test('forwards custom error message', async () => {
    const interaction = mockInteraction();
    await requirePlayer(interaction, {}, 'u99', 1, deny, 'Only the owner can move.');
    assert.strictEqual(interaction.followUpArgs.content, 'Only the owner can move.');
  });

  test('uses reply when useReply option set', async () => {
    const interaction = mockInteraction();
    await requirePlayer(interaction, {}, 'u99', 1, deny, 'Nope.', { useReply: true });
    assert.strictEqual(interaction.replyCalled, true);
    assert.strictEqual(interaction.followUpCalled, false);
  });
});
