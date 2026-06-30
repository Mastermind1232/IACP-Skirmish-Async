/**
 * Tough Luck (CC) — end-of-rerolls picker (alexanbv 2026-06-30 redesign).
 *
 * NEW BEHAVIOR: no per-reroll pause. After all rerolls complete, each player
 * gets a one-time window to cancel any one rerolled opponent die:
 *   - Defender: cancels any rerolled ATTACK die.
 *   - Attacker: cancels any rerolled DEFENSE die.
 *
 * rerollDie now tracks all rerolled dice in combat._rerolledDice.
 * _offerToughLuckFinal posts the picker at end-of-rerolls and returns true
 * (pause) when a window is posted.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerollDie } from '../../../src/engine/combat-reroll.js';
import { _offerToughLuckFinal } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };
const deps = {
  rollSingleAttackDie: () => ({ color: 'blue', acc: 1, dmg: 1, surge: 0 }),
  rollSingleDefenseDie: () => ({ color: 'white', block: 1, evade: 0, dodge: false }),
  recalcAttackTotals: () => ({ acc: 0, dmg: 0, surge: 0 }),
  recalcDefenseTotals: () => ({ block: 0, evade: 0, dodge: false }),
};

describe('rerollDie accumulates all rerolled dice for the end-of-rerolls TL picker', () => {
  it('pushes unique (pool, index) entries into combat._rerolledDice', () => {
    const combat = { attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 0 }, { color: 'blue', acc: 0, dmg: 1, surge: 0 }], _rerolledDieIds: new Set() };
    rerollDie(combat, deps, { pool: 'attack', index: 0 });
    rerollDie(combat, deps, { pool: 'attack', index: 1 });
    // Rerolling index 0 again (special turn) should not add a duplicate.
    rerollDie(combat, deps, { pool: 'attack', index: 0, specialTurn: true });
    assert.equal(combat._rerolledDice.length, 2, 'only two unique dice tracked');
    assert.deepEqual(combat._rerolledDice[0], { pool: 'attack', index: 0 });
    assert.deepEqual(combat._rerolledDice[1], { pool: 'attack', index: 1 });
  });
});

describe('_offerToughLuckFinal: end-of-rerolls picker logic', () => {
  const sent = [];
  const capThread = { send: async (p) => { sent.push(typeof p === 'string' ? p : (p?.content ?? '')); return {}; } };

  function freshCombat() {
    return {
      gameId: 'g-tl-final',
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      combatThreadId: undefined,
      attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
      defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
      _rerolledDice: [{ pool: 'attack', index: 0 }],
    };
  }

  it('offers to the DEFENDER (attack die rerolled) when they hold Tough Luck', async () => {
    sent.length = 0;
    const game = { gameId: 'g-tl-final', player1Id: 'A', player2Id: 'D', player2CcHand: ['Tough Luck'] };
    const combat = freshCombat();
    const result = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(result, true, 'returns true when a window is posted');
    assert.equal(combat._pendingToughLuckFinal?.phase, 'defender');
    assert.equal(combat._pendingToughLuckFinal?.playerNum, 2);
    assert.ok(sent.some((m) => m.includes('Tough Luck')), 'picker message sent');
  });

  it('does NOT offer when defender has no Tough Luck', async () => {
    sent.length = 0;
    const game = { gameId: 'g-tl-final', player1Id: 'A', player2Id: 'D', player2CcHand: [] };
    const combat = freshCombat();
    const result = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(result, false, 'returns false — no window posted');
    assert.equal(combat._pendingToughLuckFinal, undefined);
  });

  it('offers to the ATTACKER (defense die rerolled) when they hold Tough Luck', async () => {
    sent.length = 0;
    const game = { gameId: 'g-tl-final', player1Id: 'A', player2Id: 'D', player1CcHand: ['Tough Luck'] };
    const combat = { ...freshCombat(), _rerolledDice: [{ pool: 'defense', index: 0 }] };
    const result = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(result, true);
    assert.equal(combat._pendingToughLuckFinal?.phase, 'attacker');
    assert.equal(combat._pendingToughLuckFinal?.playerNum, 1);
  });

  it('defender window fires first, attacker window fires second on subsequent call', async () => {
    sent.length = 0;
    const game = { gameId: 'g-tl-final', player1Id: 'A', player2Id: 'D', player1CcHand: ['Tough Luck'], player2CcHand: ['Tough Luck'] };
    const combat = { ...freshCombat(), _rerolledDice: [{ pool: 'attack', index: 0 }, { pool: 'defense', index: 0 }] };
    // First call: defender window
    let res = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(res, true);
    assert.equal(combat._pendingToughLuckFinal?.phase, 'defender');
    delete combat._pendingToughLuckFinal;
    // Second call: attacker window
    res = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(res, true);
    assert.equal(combat._pendingToughLuckFinal?.phase, 'attacker');
    delete combat._pendingToughLuckFinal;
    // Third call: nothing left
    res = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(res, false);
  });

  it('does not re-offer once a window was already shown (_tlFinalDefenderOffered flag)', async () => {
    sent.length = 0;
    const game = { gameId: 'g-tl-final', player1Id: 'A', player2Id: 'D', player2CcHand: ['Tough Luck'] };
    const combat = { ...freshCombat(), _tlFinalDefenderOffered: true };
    const result = await _offerToughLuckFinal(capThread, game, combat, {});
    assert.equal(result, false, 'already offered — should not repeat');
  });
});
