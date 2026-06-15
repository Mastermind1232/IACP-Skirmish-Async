import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rerollDie, selectableDieIndices } from './combat-reroll.js';
import { isDieRerolled, dieId } from './combat-reroll-lock.js';

// Deterministic mock roll/recalc deps.
const deps = {
  rollSingleAttackDie: (color) => ({ color, dmg: 2, surge: 1, acc: 3 }),
  rollSingleDefenseDie: (color) => ({ color, block: 1, evade: 0, dodge: false }),
  recalcAttackTotals: (dice) => ({ dmg: dice.reduce((s, d) => s + (d.dmg || 0), 0), surge: dice.reduce((s, d) => s + (d.surge || 0), 0), acc: dice.reduce((s, d) => s + (d.acc || 0), 0) }),
  recalcDefenseTotals: (dice) => ({ block: dice.reduce((s, d) => s + (d.block || 0), 0), evade: 0, dodge: false }),
};

function freshCombat() {
  return {
    attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }, { color: 'green', dmg: 1, surge: 0, acc: 0 }],
    defenseDiceResults: [{ color: 'white', block: 0, evade: 0, dodge: false }],
  };
}

describe('combat-reroll: generic reroll method', () => {
  it('rerolls a die, locks it (binary flag), and recalcs the pool totals', () => {
    const c = freshCombat();
    const r = rerollDie(c, deps, { pool: 'attack', index: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(c.attackDiceResults[0], { color: 'blue', dmg: 2, surge: 1, acc: 3 });
    assert.ok(isDieRerolled(c, dieId('attack', 0)), 'die 0 is now flagged rerolled');
    // totals recalculated: die0 (2/1/3) + die1 (1/0/0)
    assert.deepEqual(c.attackRoll, { dmg: 3, surge: 1, acc: 3 });
  });

  it('a rerolled die cannot be selected again (lock excludes it)', () => {
    const c = freshCombat();
    rerollDie(c, deps, { pool: 'attack', index: 0 });
    const sel = selectableDieIndices(c, { pool: 'attack' });
    assert.deepEqual(sel, [1], 'die 0 locked out; only die 1 selectable');
    const second = rerollDie(c, deps, { pool: 'attack', index: 0 });
    assert.deepEqual(second, { ok: false, reason: 'locked' });
  });

  it('color swap (Saska) rolls the new die in the chosen color', () => {
    const c = freshCombat();
    const r = rerollDie(c, deps, { pool: 'attack', index: 1, newColor: 'red' });
    assert.equal(r.ok, true);
    assert.equal(c.attackDiceResults[1].color, 'red');
  });

  it('specialTurn (Zeb / Rapid Recal) bypasses the lock and does NOT flag the die', () => {
    const c = freshCombat();
    rerollDie(c, deps, { pool: 'attack', index: 0 }); // locks die 0
    const turn = rerollDie(c, deps, { pool: 'attack', index: 0, specialTurn: true });
    assert.equal(turn.ok, true, 'specialTurn ignores the lock');
    // still selectable by special turns; an ordinary reroll stays blocked
    assert.deepEqual(rerollDie(c, deps, { pool: 'attack', index: 0 }), { ok: false, reason: 'locked' });
  });

  it('defense pool reroll updates combat.defenseRoll', () => {
    const c = freshCombat();
    const r = rerollDie(c, deps, { pool: 'defense', index: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(c.defenseRoll, { block: 1, evade: 0, dodge: false });
  });

  it('selectableDieIndices honors the ability eligibility predicate', () => {
    const c = freshCombat();
    // e.g. an ability that may only reroll dice currently showing 0 damage
    const sel = selectableDieIndices(c, { pool: 'attack', eligible: (d) => (d.dmg || 0) === 0 });
    assert.deepEqual(sel, [0]);
  });
});
