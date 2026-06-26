// "After Attack Resolves" window — neutral "Play a Command Card" button + its
// ephemeral pick list (alexanbv 2026-06-25).
//
// This window is the ONE combat window NOT on the unified gate framework — it
// has its own aar_* handlers (see ARCHITECTURE NOTE on postPostResolveWindow).
// Headless self-play drains the window via autoPostResolve (selfPlay), so it
// never exercises this live button path; these focused unit tests cover it.
//
// Asserts: the Play-CC button opens an EPHEMERAL private list of THAT side's
// after-attack-playable CCs (and an empty-state message when none), and that
// picking a card stages pendingCcConfirmation + pendingCombatCcResolve and
// routes through ctx.handleCcConfirmPlay (the normal CC pipeline).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleAarPlayCc, handleAarCcPick } from '../../src/handlers/after-attack-resolve.js';

// Attacker (player 1) holds Escalating Hostility (afterAttack, Any Figure). With
// combat.hit=true it is after-attack-playable by the attacker via the real
// getPlayableReactionCardsForTiming pipeline (no stub needed).
function gameWithAttackerCc() {
  return {
    gameId: 't1', player1Id: 'P1', player2Id: 'P2',
    player1CcHand: ['Escalating Hostility'], player2CcHand: [],
    pendingCombat: {
      gameId: 't1', attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackerFigureKey: 'A-1-0', target: { figureKey: 'D-2-0' }, hit: true,
    },
  };
}

function mockInteraction(customId, userId) {
  const followUps = [];
  let publicEdited = false;
  const interaction = {
    customId,
    user: { id: userId },
    client: { channels: { fetch: async () => null } },
    message: { edit: async () => { publicEdited = true; } },
    deferUpdate: async () => {},
    followUp: async (p) => { followUps.push(p); },
  };
  return { interaction, followUps, getPublicEdited: () => publicEdited };
}

function customIds(payload) {
  const out = [];
  for (const row of (payload.components || [])) for (const c of (row.components || [])) out.push(c.data?.custom_id ?? c.custom_id);
  return out;
}
function labels(payload) {
  const out = [];
  for (const row of (payload.components || [])) for (const c of (row.components || [])) out.push(c.data?.label ?? c.label);
  return out;
}

describe('AAR Play-CC — handleAarPlayCc opens an ephemeral private list', () => {
  it('replies ephemerally with the attacker side\'s playable CC, stashes choices, leaves the public window up', async () => {
    const game = gameWithAttackerCc();
    const { interaction, followUps, getPublicEdited } = mockInteraction('aar_playcc_t1_atk', 'P1');
    let saved = false;
    const ctx = { getGame: () => game, saveGames: () => { saved = true; } };

    await handleAarPlayCc(interaction, ctx);

    assert.equal(followUps.length, 1, 'expected one ephemeral reply');
    assert.equal(followUps[0].ephemeral, true, 'CC list must be ephemeral (private)');
    // The card appears as a pick button (by index, NOT by name in the customId).
    const ids = customIds(followUps[0]);
    assert.ok(ids.includes('aar_ccpick_t1_atk_0'), 'pick button for index 0 missing');
    assert.ok(labels(followUps[0]).includes('Escalating Hostility'), 'card label missing from list');
    // Choices stashed for the pick handler (index -> card).
    assert.deepEqual(game._aarCcChoices?.atk, ['Escalating Hostility']);
    assert.ok(saved, 'should saveGames after stashing choices');
    // Public window untouched (multi-CC: stays up).
    assert.equal(getPublicEdited(), false, 'Play-CC must NOT clear the public window');
  });

  it('empty state: ephemeral "no Command Cards playable" when the side holds none', async () => {
    const game = gameWithAttackerCc();
    // Defender (player 2) holds no after-attack CCs.
    const { interaction, followUps } = mockInteraction('aar_playcc_t1_def', 'P2');
    const ctx = { getGame: () => game, saveGames: () => {} };

    await handleAarPlayCc(interaction, ctx);

    assert.equal(followUps.length, 1);
    assert.equal(followUps[0].ephemeral, true);
    assert.match(followUps[0].content, /no Command Cards playable/i);
    assert.ok(!game._aarCcChoices?.def, 'no choices should be stashed when empty');
  });

  it('owner-only: a wrong-player click is rejected ephemerally and stashes nothing', async () => {
    const game = gameWithAttackerCc();
    // Defender (P2) clicks the ATTACKER's Play-CC button.
    const { interaction, followUps } = mockInteraction('aar_playcc_t1_atk', 'P2');
    const ctx = { getGame: () => game, saveGames: () => {} };

    await handleAarPlayCc(interaction, ctx);

    assert.equal(followUps.length, 1);
    assert.equal(followUps[0].ephemeral, true);
    assert.match(followUps[0].content, /for the other side/i);
    assert.ok(!game._aarCcChoices, 'wrong-player click must not stash choices');
  });
});

describe('AAR Play-CC — handleAarCcPick routes the play through the normal pipeline', () => {
  it('stages pendingCcConfirmation + pendingCombatCcResolve and invokes ctx.handleCcConfirmPlay with a rewritten customId', async () => {
    const game = gameWithAttackerCc();
    // Pre-stash as handleAarPlayCc would.
    game._aarCcChoices = { atk: ['Escalating Hostility'] };
    const { interaction } = mockInteraction('aar_ccpick_t1_atk_0', 'P1');

    let confirmCalledWith = null;
    const ctx = {
      getGame: () => game,
      saveGames: () => {},
      handleCcConfirmPlay: async (proxy) => { confirmCalledWith = proxy.customId; },
    };

    await handleAarCcPick(interaction, ctx);

    // Staged for the confirm path.
    assert.ok(game.pendingCcConfirmation, 'pendingCcConfirmation should be set');
    assert.equal(game.pendingCcConfirmation.playerNum, 1);
    assert.equal(game.pendingCcConfirmation.card, 'Escalating Hostility');
    // Resume descriptor so the window re-posts after the counter window closes.
    assert.deepEqual(game.pendingCombatCcResolve, { kind: 'after_attack', effectSide: 'attacker', gameId: 't1' });
    // Routed through the normal confirm handler with a rewritten cc_confirm_play_ id.
    assert.equal(confirmCalledWith, 'cc_confirm_play_t1', 'handleCcConfirmPlay must be invoked with a rewritten customId');
  });

  it('rejects a pick whose card is no longer in hand (ephemeral, no play)', async () => {
    const game = gameWithAttackerCc();
    game._aarCcChoices = { atk: ['Escalating Hostility'] };
    game.player1CcHand = []; // card gone from hand
    const { interaction, followUps } = mockInteraction('aar_ccpick_t1_atk_0', 'P1');
    let confirmCalled = false;
    const ctx = {
      getGame: () => game, saveGames: () => {},
      handleCcConfirmPlay: async () => { confirmCalled = true; },
    };

    await handleAarCcPick(interaction, ctx);

    assert.equal(confirmCalled, false, 'must not route the play when the card left hand');
    assert.equal(followUps.length, 1);
    assert.match(followUps[0].content, /no longer in your hand/i);
    assert.ok(!game.pendingCcConfirmation, 'must not stage a play');
  });

  it('owner-only: a wrong-player pick is rejected and routes nothing', async () => {
    const game = gameWithAttackerCc();
    game._aarCcChoices = { atk: ['Escalating Hostility'] };
    const { interaction, followUps } = mockInteraction('aar_ccpick_t1_atk_0', 'P2');
    let confirmCalled = false;
    const ctx = {
      getGame: () => game, saveGames: () => {},
      handleCcConfirmPlay: async () => { confirmCalled = true; },
    };

    await handleAarCcPick(interaction, ctx);

    assert.equal(confirmCalled, false);
    assert.match(followUps[0]?.content || '', /for the other side/i);
    assert.ok(!game.pendingCcConfirmation);
  });
});
