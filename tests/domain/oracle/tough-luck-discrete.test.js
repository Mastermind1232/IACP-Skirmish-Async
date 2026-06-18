/**
 * Tough Luck — discrete one-shot post-reroll reaction (alexanbv 2026-06-18).
 *
 * Tough Luck is NOT a round-long proactive effect. It reacts to a SINGLE
 * opponent reroll: holding the card, the relevant player (by die pool) is
 * offered a remove/skip prompt; on remove the rerolled die's RESULT is zeroed,
 * the card is discarded from hand, and the pending state is cleared. A SECOND
 * opponent reroll in the same round must NOT offer Tough Luck again unless the
 * player holds another copy.
 *
 * This exercises the complete discrete mechanism: _offerToughLuck (the offer)
 * + handleToughLuckGate (the tlgate_ remove/skip resolution).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _offerToughLuck, handleToughLuckGate } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };

// Minimal recalc stubs (real totals are irrelevant to the discrete-behaviour
// assertions; we only check that the rerolled die's result is zeroed and that
// the offer does not persist).
function recalcAttackTotals(dice) {
  return dice.reduce((t, d) => ({ acc: t.acc + (d.acc || 0), dmg: t.dmg + (d.dmg || 0), surge: t.surge + (d.surge || 0) }), { acc: 0, dmg: 0, surge: 0 });
}
function recalcDefenseTotals(dice) {
  return dice.reduce((t, d) => ({ block: t.block + (d.block || 0), evade: t.evade + (d.evade || 0), dodge: t.dodge || d.dodge }), { block: 0, evade: 0, dodge: false });
}

function makeCtx(game) {
  return {
    getGame: () => game,
    saveGames: () => {},
    replyIfGameEnded: async () => false,
    recalcAttackTotals,
    recalcDefenseTotals,
  };
}

function makeInteraction(customId, userId) {
  return {
    customId,
    user: { id: userId },
    client: {}, // fetchCombatThread tolerates a missing thread id → null thread
    message: { edit: async () => ({}) },
    deferUpdate: async () => ({}),
    followUp: async () => ({}),
  };
}

describe('Tough Luck is a discrete one-shot post-reroll reaction', () => {
  function freshGame() {
    return {
      gameId: 'g-tl-discrete',
      player1Id: 'A',
      player2Id: 'D',
      // Defender (P2) holds ONE Tough Luck.
      player2CcHand: ['Tough Luck'],
      player2CcDiscard: [],
      pendingCombat: {
        gameId: 'g-tl-discrete',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: undefined,
        attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
        defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
      },
    };
  }

  it('offers on opponent reroll, removes one die + discards the card, and does NOT stay armed', async () => {
    const game = freshGame();
    const combat = game.pendingCombat;

    // First attack-die reroll → the DEFENDER (holds Tough Luck) is offered.
    assert.equal(await _offerToughLuck(game, combat, {}, thread, 'attack', 0), true);
    assert.deepEqual(combat._pendingToughLuck, { pool: 'attack', idx: 0, playerNum: 2 });
    // Strictly discrete: no round-long arming on the game object.
    assert.equal(game.toughLuckPlayerNum, undefined, 'must not arm a round-long flag');
    assert.equal(game.pendingToughLuck, undefined, 'must not set a game-level pending flag');

    // Defender removes the rerolled die's result.
    const ctx = makeCtx(game);
    await handleToughLuckGate(makeInteraction('tlgate_remove_g-tl-discrete_attack_0', 'D'), ctx);

    // Die result zeroed.
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 0, dmg: 0, surge: 0 });
    // Pool recalculated to reflect the removed result.
    assert.deepEqual(combat.attackRoll, { acc: 0, dmg: 0, surge: 0 });
    // Card consumed from hand → discard.
    assert.deepEqual(game.player2CcHand, [], 'Tough Luck left the hand');
    assert.deepEqual(game.player2CcDiscard, ['Tough Luck'], 'Tough Luck went to discard');
    // Pending state cleared.
    assert.equal(combat._pendingToughLuck, undefined, 'pending state cleared after use');

    // A SECOND opponent reroll in the same round must NOT re-offer Tough Luck:
    // the only copy is now in the discard pile, not the hand.
    combat.attackDiceResults = [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }];
    assert.equal(await _offerToughLuck(game, combat, {}, thread, 'attack', 0), false,
      'second reroll must not re-offer Tough Luck after the single copy was used');
    assert.equal(combat._pendingToughLuck, undefined);
  });

  it('a SECOND held copy DOES offer on a subsequent reroll', async () => {
    const game = freshGame();
    game.player2CcHand = ['Tough Luck', 'Tough Luck'];
    const combat = game.pendingCombat;
    const ctx = makeCtx(game);

    // First reroll → offer + remove (consumes one copy).
    assert.equal(await _offerToughLuck(game, combat, {}, thread, 'attack', 0), true);
    await handleToughLuckGate(makeInteraction('tlgate_remove_g-tl-discrete_attack_0', 'D'), ctx);
    assert.deepEqual(game.player2CcHand, ['Tough Luck'], 'one copy remains in hand');

    // Second reroll → still offered, because a second copy is held.
    combat.attackDiceResults = [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }];
    assert.equal(await _offerToughLuck(game, combat, {}, thread, 'attack', 0), true,
      'second held copy must be offered on a subsequent reroll');
    assert.deepEqual(combat._pendingToughLuck, { pool: 'attack', idx: 0, playerNum: 2 });
  });

  it('skip leaves the die intact and keeps the card in hand', async () => {
    const game = freshGame();
    const combat = game.pendingCombat;
    const ctx = makeCtx(game);

    assert.equal(await _offerToughLuck(game, combat, {}, thread, 'attack', 0), true);
    await handleToughLuckGate(makeInteraction('tlgate_skip_g-tl-discrete', 'D'), ctx);

    // Skip: die untouched, card stays in hand, pending cleared.
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 1, dmg: 2, surge: 1 });
    assert.deepEqual(game.player2CcHand, ['Tough Luck'], 'card not consumed on skip');
    assert.deepEqual(game.player2CcDiscard, []);
    assert.equal(combat._pendingToughLuck, undefined);
  });
});
