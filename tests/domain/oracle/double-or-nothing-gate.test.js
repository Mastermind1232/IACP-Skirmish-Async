/**
 * Double or Nothing — discrete post-reroll Double/Cancel/Decline reaction
 * (CSV row 625, alexanbv 2026-06-20).
 *
 * CSV: "Choose a die; its controller rerolls it; if the rerolled result has the
 * same number of symbols, you may double or cancel its results."
 *
 * The reroll itself rides on the generic reroll queue + rerollDie. AFTER the
 * reroll, when the die's WHOLE-die symbol count is unchanged, the CC's
 * CONTROLLER is offered an interactive prompt to DOUBLE, CANCEL, or DECLINE.
 * _offerDoubleOrNothing posts the prompt + stashes combat._pendingDoubleOrNothing;
 * handleDonGate (dongate_double/cancel/skip) applies the pick.
 *
 * Also covers rerollDie's symbol-count capture (prevSymbols/newSymbols on
 * combat._lastRerolledDie), the input the offer reads.
 *
 * NOTE: The old "TL first, then DON" ordering test was removed 2026-06-30 when
 * Tough Luck was redesigned from a per-reroll gate to an end-of-rerolls picker
 * (_offerToughLuckFinal). DON now fires immediately after each reroll with no
 * TL interleaving.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _offerDoubleOrNothing, handleDonGate, _driveGateOrOfferToughLuck } from '../../../src/handlers/combat.js';
import { rerollDie } from '../../../src/engine/combat-reroll.js';

const thread = { send: async () => ({}) };

function makeCtx(game) {
  return { getGame: () => game, saveGames: () => {}, replyIfGameEnded: async () => false };
}
function makeInteraction(customId, userId) {
  return {
    customId,
    user: { id: userId },
    client: {},
    message: { edit: async () => ({}) },
    deferUpdate: async () => ({}),
    followUp: async () => ({}),
  };
}

describe('rerollDie captures whole-die symbol counts for Double or Nothing', () => {
  it('records prevSymbols / newSymbols on _lastRerolledDie (attack pool)', () => {
    const combat = { attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 0 }] };
    // Deterministic injected roll: new die = 1 dmg + 1 surge + 1 acc = 3 symbols (was 3).
    const deps = {
      rollSingleAttackDie: () => ({ color: 'red', acc: 1, dmg: 1, surge: 1 }),
      recalcAttackTotals: (d) => d.reduce((t, x) => ({ acc: t.acc + x.acc, dmg: t.dmg + x.dmg, surge: t.surge + x.surge }), { acc: 0, dmg: 0, surge: 0 }),
    };
    const r = rerollDie(combat, deps, { pool: 'attack', index: 0 });
    assert.equal(r.ok, true);
    assert.equal(combat._lastRerolledDie.prevSymbols, 3); // 1+2+0
    assert.equal(combat._lastRerolledDie.newSymbols, 3);  // 1+1+1
  });
});

describe('Double or Nothing post-reroll Double/Cancel/Decline gate', () => {
  function freshGame(side = 'atk') {
    return {
      gameId: 'g-don',
      player1Id: 'A',
      player2Id: 'D',
      // Controller (P1) played Double or Nothing.
      doubleMatchingIconsOnReroll: { playerNum: 1, side },
      pendingCombat: {
        gameId: 'g-don',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: undefined,
        attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
        defenseDiceResults: [{ color: 'white', block: 2, evade: 1, dodge: false }],
        _lastRerolledDie: { pool: 'attack', index: 0, prevSymbols: 4, newSymbols: 4 },
      },
    };
  }

  it('offers Double/Cancel/Decline to the controller when symbol count matched', async () => {
    const game = freshGame('atk');
    const combat = game.pendingCombat;
    const posted = await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, combat._lastRerolledDie);
    assert.equal(posted, true, 'prompt posted when prev === new symbols');
    assert.deepEqual(combat._pendingDoubleOrNothing, { pool: 'attack', idx: 0, playerNum: 1, symbols: 4 });
    assert.equal(combat.doubleOrNothingApplied, undefined, 'not yet applied — awaits choice');
  });

  it('DOUBLE pick doubles the whole die result + recalcs + clears state', async () => {
    const game = freshGame('atk');
    const combat = game.pendingCombat;
    await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, combat._lastRerolledDie);
    await handleDonGate(makeInteraction('dongate_double_g-don', 'A'), makeCtx(game));
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 2, dmg: 4, surge: 2 });
    assert.equal(combat.attackRoll.dmg, 4);
    assert.equal(combat.doubleOrNothingApplied, true);
    assert.equal(game.doubleMatchingIconsOnReroll, null, 'arm consumed');
    assert.equal(combat._pendingDoubleOrNothing, undefined, 'pending cleared');
  });

  it('CANCEL pick zeroes the whole die result', async () => {
    const game = freshGame('atk');
    const combat = game.pendingCombat;
    await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, combat._lastRerolledDie);
    await handleDonGate(makeInteraction('dongate_cancel_g-don', 'A'), makeCtx(game));
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 0, dmg: 0, surge: 0 });
    assert.equal(combat.attackRoll.dmg, 0);
    assert.equal(combat.doubleOrNothingApplied, true);
  });

  it('DECLINE leaves the die unchanged but still clears the arm', async () => {
    const game = freshGame('atk');
    const combat = game.pendingCombat;
    await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, combat._lastRerolledDie);
    await handleDonGate(makeInteraction('dongate_skip_g-don', 'A'), makeCtx(game));
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 1, dmg: 2, surge: 1 });
    assert.equal(combat.doubleOrNothingApplied, true);
    assert.equal(game.doubleMatchingIconsOnReroll, null);
  });

  it('does NOT offer (and clears arm) when symbol count changed', async () => {
    const game = freshGame('atk');
    const combat = game.pendingCombat;
    const last = { pool: 'attack', index: 0, prevSymbols: 4, newSymbols: 2 };
    const posted = await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, last);
    assert.equal(posted, false, 'no prompt when symbol count changed');
    assert.equal(game.doubleMatchingIconsOnReroll, null, 'arm consumed so it cannot re-trigger');
    assert.equal(combat.doubleOrNothingApplied, true);
  });

  it('only the controller may respond (not the other player)', async () => {
    const game = freshGame('atk');
    const combat = game.pendingCombat;
    await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, combat._lastRerolledDie);
    // Player 2 (the defender, not the controller) clicks → rejected; die unchanged.
    await handleDonGate(makeInteraction('dongate_double_g-don', 'D'), makeCtx(game));
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 1, dmg: 2, surge: 1 }, 'non-controller click ignored');
    assert.ok(combat._pendingDoubleOrNothing, 'still pending after rejected click');
  });

  it('defense-side DON doubles a defense die', async () => {
    const game = freshGame('def');
    const combat = game.pendingCombat;
    combat._lastRerolledDie = { pool: 'defense', index: 0, prevSymbols: 3, newSymbols: 3 };
    const posted = await _offerDoubleOrNothing(game, combat, {}, thread, 'defense', 0, combat._lastRerolledDie);
    assert.equal(posted, true);
    await handleDonGate(makeInteraction('dongate_double_g-don', 'A'), makeCtx(game));
    assert.deepEqual(combat.defenseDiceResults[0], { color: 'white', block: 4, evade: 2, dodge: false });
  });

  it('pool mismatch (def arm, attack die rerolled) does not offer', async () => {
    const game = freshGame('def');
    const combat = game.pendingCombat;
    const last = { pool: 'attack', index: 0, prevSymbols: 4, newSymbols: 4 };
    const posted = await _offerDoubleOrNothing(game, combat, {}, thread, 'attack', 0, last);
    assert.equal(posted, false, 'def-side DON ignores an attack-die reroll');
    // Arm NOT consumed (the matching defense reroll may still come).
    assert.equal(game.doubleMatchingIconsOnReroll.side, 'def');
  });
});

// ── alexanbv 2026-06-30: ordering note ───────────────────────────────────────
// Tough Luck is now an end-of-rerolls picker (not per-reroll). DON fires
// immediately after each individual reroll with no TL interleaving.
describe('post-reroll: Double or Nothing fires directly (no TL interleave)', () => {
  function makeCapturingThread(log) {
    return { send: async (payload) => { log.push(typeof payload === 'string' ? payload : (payload?.content ?? '')); return {}; } };
  }
  function orderGame() {
    return {
      gameId: 'g-ord',
      player1Id: 'A',
      player2Id: 'D',
      doubleMatchingIconsOnReroll: { playerNum: 1, side: 'atk' },
      player2CcHand: ['Tough Luck'],
      pendingCombat: {
        gameId: 'g-ord',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: 'thr-ord',
        attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
        defenseDiceResults: [{ color: 'white', block: 2, evade: 1, dodge: false }],
        _lastRerolledDie: { pool: 'attack', index: 0, prevSymbols: 4, newSymbols: 4 },
      },
    };
  }
  const ctx = (game) => ({
    getGame: () => game, saveGames: () => {}, replyIfGameEnded: async () => false,
  });

  it('Double or Nothing is offered immediately (no TL gate in between)', async () => {
    const game = orderGame();
    const combat = game.pendingCombat;
    const log = [];
    const thr = makeCapturingThread(log);
    await _driveGateOrOfferToughLuck('rerolls', thr, game, combat, ctx(game));
    // DON offered immediately — no TL per-reroll gate.
    assert.ok(combat._pendingDoubleOrNothing, 'DON pending immediately after reroll');
    assert.equal(combat._pendingToughLuck, undefined, 'no per-reroll TL gate');
    // _lastRerolledDie stays alive while DON is pending (cleared in handleDonGate before resuming).
    assert.ok(combat._lastRerolledDie, '_lastRerolledDie still set while DON pending');
  });
});
