/**
 * [Smuggling Compartment] before a hand-affecting CC's effect (Stall for Time).
 *
 * Order per alexanbv 2026-06-17: play → Negate/Comms window → Smuggling
 * Compartment → effect. handleScCcConfirm applies the set-aside then resumes the
 * deferred CC effect (re-resolveAbility). Drives the confirm handler with a mock
 * interaction/ctx and asserts the set-aside state + that the deferred effect was
 * resolved against the reduced hand.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleScCcConfirm } from '../../../src/handlers/cc-hand.js';

function harness(values) {
  const game = {
    gameId: 'g1',
    player2Id: 'u2',
    player2CcHand: ['A', 'B', 'C'],
    p2DcList: [{ dcName: '[Smuggling Compartment]' }],
    p2DcMessageIds: ['m-sc'],
    exhaustedSkirmishUpgrades: {},
    pendingScCc: { abilityId: 'Stall for Time', card: 'Stall for Time', playedBy: 1, msgId: null, fromDc: false },
  };
  const calls = { resolveAbility: [], applyResult: 0, winCheck: 0 };
  const interaction = {
    customId: 'sc_cc_confirm_g1_2',
    user: { id: 'u2' },
    values,
    deferUpdate: async () => {},
    followUp: async () => {},
    client: {},
    message: { edit: async () => {} },
  };
  const ctx = {
    getGame: () => game,
    client: {},
    saveGames: () => {},
    logGameAction: async () => {},
    resolveAbility: (abilityId, c) => { calls.resolveAbility.push({ abilityId, playerNum: c.playerNum }); return { applied: true }; },
    // applyAbilityResult is imported inside cc-hand; the resume just needs resolveAbility to run.
    dcMessageMeta: new Map(),
    dcHealthState: new Map(),
    checkWinConditions: async () => { calls.winCheck++; },
  };
  return { game, interaction, ctx, calls };
}

describe('SC before a hand-affecting CC — handleScCcConfirm', () => {
  it('sets aside chosen cards, exhausts SC, then resumes the deferred effect', async () => {
    const { game, interaction, ctx, calls } = harness(['A', 'B']);
    await handleScCcConfirm(interaction, ctx);
    assert.deepEqual(game.player2CcHand, ['C'], 'chosen cards left the hand before the effect');
    assert.deepEqual(game.smugglingCompartmentSetAside[2], ['A', 'B']);
    assert.ok((game.exhaustedSkirmishUpgrades['m-sc'] || []).some((n) => /Smuggling Compartment/.test(n)), 'SC exhausted');
    assert.equal(calls.resolveAbility.length, 1, 'deferred effect resolved once');
    assert.equal(calls.resolveAbility[0].abilityId, 'Stall for Time');
    assert.equal(game.pendingScCc, undefined, 'pending cleared');
  });

  it('blocks a non-owner', async () => {
    const { game, interaction, ctx, calls } = harness(['A']);
    interaction.user.id = 'intruder';
    await handleScCcConfirm(interaction, ctx);
    assert.deepEqual(game.player2CcHand, ['A', 'B', 'C']);
    assert.equal(calls.resolveAbility.length, 0);
  });

  it('stands up the choice prompt when the deferred effect is interactive (Intel Leak)', async () => {
    const { game, interaction, ctx } = harness(['A']);
    game.pendingScCc = { abilityId: 'Intelligence Leak', card: 'Intelligence Leak', playedBy: 1, msgId: null, fromDc: false };
    game.p1HandId = 'hand1';
    ctx.resolveAbility = () => ({ requiresChoice: true, choiceOptions: ['Card X', 'Card Y'] });
    await handleScCcConfirm(interaction, ctx);
    assert.ok(game.pendingCcChoice, 'choice prompt is set up for the looker');
    assert.equal(game.pendingCcChoice.abilityId, 'Intelligence Leak');
    assert.equal(game.pendingCcChoice.playerNum, 1);
  });
});
