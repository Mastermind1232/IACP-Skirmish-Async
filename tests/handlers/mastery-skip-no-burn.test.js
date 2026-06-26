/**
 * Mastery (Second Sister) once-per-round limit accounting
 * (residual follow-up 2026-06-26).
 *
 * The once-per-round stamp (`roundFigureAbilityUsed[<figKey>_mastery]`) must
 * fire EXACTLY ONCE, only when a redraw is actually COMMITTED (a card moves
 * discard -> hand). It must NOT fire when:
 *   - the picker is merely offered (combat-bridge.js no longer stamps), or
 *   - the player clicks Skip inside the picker (mastery_skip_), or
 *   - Rest in Peace blocks the retrieval.
 *
 * This test drives handleMasteryPick directly with a pre-armed pendingMastery
 * carrying masteryKey (the offer site supplies it), and asserts the stamp
 * behavior on the skip vs. commit paths.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleMasteryPick } from '../../src/handlers/post-combat.js';

const FIG = 'p1_SecondSister-1-0';
const MAST_KEY = `${FIG}_mastery`;

function makeGame() {
  return {
    gameId: 'gmast',
    player1Id: 'u1',
    player2Id: 'u2',
    player1CcDiscard: ['Force Push'],
    player1CcHand: [],
    roundFigureAbilityUsed: {},
    pendingMastery: {
      attackerPlayerNum: 1,
      discardKey: 'player1CcDiscard',
      eligible: ['Force Push'],
      resultText: 'result',
      combat: { combatThreadId: null },
      initialEmbedRefreshMsgIds: [],
      defenderPlayerNum: 2,
      masteryKey: MAST_KEY,
    },
  };
}

function makeInteraction(customId) {
  return {
    customId,
    user: { id: 'u1' },
    deferUpdate: async () => {},
    followUp: async () => {},
    message: { edit: async () => {} },
  };
}

function makeCtx(game) {
  return {
    getGame: () => game,
    client: {}, // no channels.fetch -> fetchCombatThread returns null (no thread sends)
    saveGames: () => {},
    checkPostCombatSurges: async () => false,
    finishCombatResolution: async () => {},
    updateHandChannelMessages: async () => {},
  };
}

describe('Mastery once-per-round stamp accounting', () => {
  it('does NOT burn the limit when the player Skips inside the picker', async () => {
    const game = makeGame();
    const ctx = makeCtx(game);
    await handleMasteryPick(makeInteraction('mastery_skip_gmast'), ctx);
    assert.equal(
      game.roundFigureAbilityUsed[MAST_KEY],
      undefined,
      'Skip must leave the once-per-round limit untouched',
    );
    assert.deepEqual(game.player1CcHand, [], 'Skip must not move any card to hand');
    assert.deepEqual(game.player1CcDiscard, ['Force Push'], 'Skip must leave discard untouched');
  });

  it('DOES burn the limit (once) when a redraw is committed', async () => {
    const game = makeGame();
    const ctx = makeCtx(game);
    // mastery_pick_<gameId>_<idx> — idx 0 selects 'Force Push'.
    await handleMasteryPick(makeInteraction('mastery_pick_gmast_0'), ctx);
    assert.equal(
      game.roundFigureAbilityUsed[MAST_KEY],
      true,
      'A committed redraw must stamp the once-per-round limit',
    );
    assert.deepEqual(game.player1CcHand, ['Force Push'], 'Committed redraw moves the card to hand');
    assert.deepEqual(game.player1CcDiscard, [], 'Committed redraw removes the card from discard');
  });

  it('does NOT burn the limit when Rest in Peace blocks the retrieval', async () => {
    const game = makeGame();
    game.restInPeaceActive = true;
    const ctx = makeCtx(game);
    await handleMasteryPick(makeInteraction('mastery_pick_gmast_0'), ctx);
    assert.equal(
      game.roundFigureAbilityUsed[MAST_KEY],
      undefined,
      'A Rest-in-Peace-blocked redraw must leave the limit untouched',
    );
    assert.deepEqual(game.player1CcHand, [], 'Blocked redraw must not move any card');
  });
});
