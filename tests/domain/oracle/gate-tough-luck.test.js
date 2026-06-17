/**
 * Tough Luck (CC) — the single generic post-reroll reaction (alexanbv 2026-06-17).
 * After ANY reroll, the relevant player BY THE DIE'S POOL is prompted: an attack
 * die reroll → the DEFENDER may react; a defense die reroll → the ATTACKER —
 * regardless of who did the rerolling. Only fires if that player holds Tough Luck.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerollDie } from '../../../src/engine/combat-reroll.js';
import { _offerToughLuck } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };
const deps = {
  rollSingleAttackDie: () => ({ color: 'blue', acc: 1, dmg: 1, surge: 0 }),
  rollSingleDefenseDie: () => ({ color: 'white', block: 1, evade: 0, dodge: false }),
  recalcAttackTotals: () => ({ acc: 0, dmg: 0, surge: 0 }),
  recalcDefenseTotals: () => ({ block: 0, evade: 0, dodge: false }),
};

describe('rerollDie records the last rerolled die for the Tough Luck offer', () => {
  it('sets combat._lastRerolledDie on success', () => {
    const combat = { attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 0 }], _rerolledDieIds: new Set() };
    rerollDie(combat, deps, { pool: 'attack', index: 0 });
    assert.deepEqual(combat._lastRerolledDie, { pool: 'attack', index: 0 });
  });
});

describe('_offerToughLuck prompts the player chosen by the die pool', () => {
  function combat() {
    return {
      gameId: 'g', attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 0 }],
      defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
    };
  }
  it('attack-die reroll → offers to the DEFENDER (only if they hold Tough Luck)', async () => {
    const c = combat();
    const game = { player2CcHand: ['Tough Luck'], player2Id: 'D' };
    assert.equal(await _offerToughLuck(game, c, {}, thread, 'attack', 0), true);
    assert.equal(c._pendingToughLuck.playerNum, 2, 'defender prompted for an attack die');
    // defender without Tough Luck → no offer
    const c2 = combat();
    assert.equal(await _offerToughLuck({ player2CcHand: [] }, c2, {}, thread, 'attack', 0), false);
    assert.equal(c2._pendingToughLuck, undefined);
  });
  it('defense-die reroll → offers to the ATTACKER', async () => {
    const c = combat();
    const game = { player1CcHand: ['Tough Luck'], player1Id: 'A' };
    assert.equal(await _offerToughLuck(game, c, {}, thread, 'defense', 0), true);
    assert.equal(c._pendingToughLuck.playerNum, 1, 'attacker prompted for a defense die');
  });
});
