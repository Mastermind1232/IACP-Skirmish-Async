/**
 * [Smuggling Compartment] vs Agent Blaise's Interrogate surge.
 *
 * Interrogate is an ability that affects the opponent's Command cards, so SC
 * Part 1 applies: before Blaise looks at the hand, the SC owner may exhaust to
 * set aside cards. This drives handleScInterrogateConfirm directly with a mock
 * interaction (the combat thread resolves to null with a bare client, so the
 * resume is a no-op post; we assert the set-aside state mutation).
 *
 * alexanbv 2026-06-17: "Smug compart needs to work on any ability that affects
 * CC, like Blaise surge."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleScInterrogateConfirm } from '../../../src/handlers/post-combat.js';

function harness(values) {
  const game = {
    gameId: 'g1',
    player2Id: 'u2',
    player2CcHand: ['A', 'B', 'C'],
    p2DcList: [{ dcName: '[Smuggling Compartment]' }],
    p2DcMessageIds: ['m-sc'],
    exhaustedSkirmishUpgrades: {},
    pendingInterrogate: {
      gameId: 'g1', attackerPlayerNum: 1, opponentPlayerNum: 2,
      combat: { combatThreadId: null }, resultText: '', initialEmbedRefreshMsgIds: [],
      defenderPlayerNum: 2, awaitingSc: true,
    },
  };
  let edited = null;
  const interaction = {
    customId: 'sc_int_confirm_g1_2',
    user: { id: 'u2' },
    values,
    deferUpdate: async () => {},
    followUp: async () => {},
    message: { edit: async (p) => { edited = p; } },
  };
  const ctx = {
    getGame: () => game,
    client: {},
    saveGames: () => {},
    checkPostCombatSurges: async () => true,
    finishCombatResolution: async () => {},
    logGameAction: async () => {},
  };
  return { game, interaction, ctx, edited: () => edited };
}

describe('SC vs Interrogate — handleScInterrogateConfirm', () => {
  it('sets aside the chosen cards, exhausts the card, and stocks the return pile', async () => {
    const { game, interaction, ctx } = harness(['A', 'B']);
    await handleScInterrogateConfirm(interaction, ctx);
    assert.deepEqual(game.player2CcHand, ['C'], 'chosen cards leave hand');
    assert.deepEqual(game.smugglingCompartmentSetAside[2], ['A', 'B'], 'set-aside pile holds them for the return trigger');
    assert.ok((game.exhaustedSkirmishUpgrades['m-sc'] || []).some((n) => /Smuggling Compartment/.test(n)), 'the card is exhausted');
  });

  it('blocks a non-owner', async () => {
    const { game, interaction, ctx } = harness(['A']);
    interaction.user.id = 'someone-else';
    await handleScInterrogateConfirm(interaction, ctx);
    assert.deepEqual(game.player2CcHand, ['A', 'B', 'C'], 'hand untouched for a non-owner');
    assert.equal(game.smugglingCompartmentSetAside, undefined);
  });
});
