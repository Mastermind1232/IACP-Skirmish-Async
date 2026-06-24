/**
 * Coverage for the unified counter-window PASS path → Smuggling Compartment offer
 * for a hand-affecting CC (SC_HAND_CCS). Replaces the deleted old-window test
 * that exercised the same linkage through handleCommDisruptionSkip.
 *
 * Order (alexanbv): play → Negate/Comms window → (responder passes) → Smuggling
 * Compartment offer to the affected player → effect. We drive handleCcCounterPass
 * with a 'Collect Intel' (SC_HAND_CCS) play on the stack and assert that, when the
 * affected opponent has SC available, the effect is DEFERRED behind the SC prompt
 * (resolveAbility not yet called); when SC is unavailable it resolves immediately.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleCcCounterPass } from '../../../src/handlers/cc-pipeline.js';

function harness({ scAvailable }) {
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: 'm-prompt' }; } };
  const game = {
    gameId: 'g1',
    player1Id: 'u1', player2Id: 'u2',
    p2HandId: 'h2',
    player1CcHand: [], player2CcHand: ['X', 'Y'],
    player1CcDiscard: [], player2CcDiscard: [],
    // P2 (the affected opponent) holds [Smuggling Compartment], unexhausted — or not.
    p2DcList: scAvailable ? [{ dcName: '[Smuggling Compartment]' }] : [],
    p2DcMessageIds: scAvailable ? ['m-sc'] : [],
    exhaustedSkirmishUpgrades: {},
    // A 'Collect Intel' (SC_HAND_CCS) played by P1 sits on the counter-window stack.
    ccCounterWindow: { gameId: 'g1', stack: [{ card: 'Collect Intel', cost: 1, playedBy: 1, abilityId: 'Collect Intel' }] },
  };
  const calls = { resolveAbility: 0 };
  const interaction = {
    customId: 'cc_counter_pass_g1',
    user: { id: 'u2' }, // P2 is the responder (counterResponder of a P1 play)
    message: { edit: async () => {} },
    followUp: async () => {},
    reply: async () => {},
    client: { channels: { fetch: async () => channel } },
  };
  const ctx = {
    getGame: () => game,
    saveGames: () => {},
    client: interaction.client,
    logGameAction: async () => {},
    resolveAbility: () => { calls.resolveAbility++; return { applied: true }; },
    dcMessageMeta: new Map(),
    dcHealthState: new Map(),
    checkWinConditions: async () => {},
  };
  return { game, interaction, ctx, calls, sent };
}

describe('Unified counter-window pass path → Smuggling Compartment', () => {
  it('a passed window on a SC_HAND_CC offers SC to the affected opponent and DEFERS the effect', async () => {
    const { game, interaction, ctx, calls, sent } = harness({ scAvailable: true });
    await handleCcCounterPass(interaction, ctx);
    // SC prompt posted to the affected player's hand channel; effect deferred.
    assert.equal(calls.resolveAbility, 0, 'effect deferred behind the SC prompt');
    assert.ok(game.pendingCcEffect, 'deferred effect is still pending');
    assert.equal(game.pendingCcEffect.scProtect, true, 'scProtect set for the SC_HAND_CC');
    const prompt = sent.find((p) => JSON.stringify(p?.components || []).includes('sc_cc_open_'));
    assert.ok(prompt, 'an SC set-aside prompt was posted');
    assert.ok(!game.ccCounterWindow, 'counter-window closed after the pass');
  });

  it('a passed window on a SC_HAND_CC with NO SC available resolves the effect immediately', async () => {
    const { interaction, ctx, calls } = harness({ scAvailable: false });
    await handleCcCounterPass(interaction, ctx);
    assert.equal(calls.resolveAbility, 1, 'effect resolved (no SC to offer)');
  });
});
