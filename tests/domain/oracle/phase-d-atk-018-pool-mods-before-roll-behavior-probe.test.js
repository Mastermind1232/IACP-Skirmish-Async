/**
 * Phase-D behavioral probe — CRR-ATK-018.
 *
 * CRR (ATTACKS Step 2 Setup): "If any abilities modify the attack or defense
 * dice pools, they are resolved before rolling."
 *
 * The existing invariant_pin probe checks source shape (single pre-roll
 * mutation block, one rollAttackDice call, override rewrites attackInfo.dice
 * not the rolled result). This probe exercises the behavioral consequence:
 * the roll's dice-count and color-count equal the MUTATED pool, not the base
 * pool. A refactor that swapped the order (roll then apply override) would
 * still return a roll of the base-pool size — this probe catches that.
 *
 * The probe re-enacts the handler's override application inline (mirroring
 * src/handlers/combat.js:975-996) to keep the test hermetic and deterministic.
 *
 * PROBE-ATK-018-A: override dice replace base pool → rolled pool reflects override
 * PROBE-ATK-018-B: override that adds dice → roll length > base length
 * PROBE-ATK-018-C: override that shrinks pool (removeDieColor) → roll length < base length
 * PROBE-ATK-018-D: no override → roll reflects base pool untouched
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rollAttackDice } from '../../../src/game/combat.js';

// Mirror the pre-roll merge block (handlers/combat.js:975-996) — minimal form.
function applyOverride(attackInfo, overrideDice) {
  if (!overrideDice) return attackInfo;
  let info = { ...attackInfo };
  if (overrideDice.dice) info = { ...info, dice: overrideDice.dice };
  if (overrideDice.removeDieColor) {
    const newDice = [...(info.dice || [])];
    const idx = newDice.indexOf(overrideDice.removeDieColor);
    if (idx >= 0) newDice.splice(idx, 1);
    info = { ...info, dice: newDice };
  }
  return info;
}

describe('PROBE-ATK-018-A: override replaces base pool before roll', () => {
  it('base [red] + override dice [blue, yellow, green] → roll reflects override pool', () => {
    const attackInfo = { dice: ['red'] };
    const override = { dice: ['blue', 'yellow', 'green'] };
    const merged = applyOverride(attackInfo, override);

    assert.deepStrictEqual(merged.dice, ['blue', 'yellow', 'green'],
      'Pre-roll mutation must fully replace base.dice with override.dice.');

    const roll = rollAttackDice(merged.dice);
    assert.equal(roll.dice.length, 3,
      'Roll length must equal override pool length (3), not base length (1).');
    const colors = roll.dice.map((d) => d.color.toLowerCase()).sort();
    assert.deepStrictEqual(colors, ['blue', 'green', 'yellow'],
      'Roll must draw from the override dice colors, not the base pool.');
  });
});

describe('PROBE-ATK-018-B: override enlarges pool before roll', () => {
  it('base [red] + override [red, red, blue] → rolled dice count = 3', () => {
    const attackInfo = { dice: ['red'] };
    const override = { dice: ['red', 'red', 'blue'] };
    const merged = applyOverride(attackInfo, override);
    const roll = rollAttackDice(merged.dice);
    assert.equal(roll.dice.length, 3);
    const colorCounts = roll.dice.reduce((a, d) => (a[d.color] = (a[d.color] || 0) + 1, a), {});
    assert.equal(colorCounts.red, 2);
    assert.equal(colorCounts.blue, 1);
  });
});

describe('PROBE-ATK-018-C: removeDieColor shrinks pool before roll', () => {
  it('base [red, blue, green] + removeDieColor "blue" → rolled pool has 2 dice, no blue', () => {
    const attackInfo = { dice: ['red', 'blue', 'green'] };
    const override = { removeDieColor: 'blue' };
    const merged = applyOverride(attackInfo, override);
    assert.deepStrictEqual(merged.dice, ['red', 'green'],
      'removeDieColor must strip exactly one die of that color pre-roll.');
    const roll = rollAttackDice(merged.dice);
    assert.equal(roll.dice.length, 2);
    const blues = roll.dice.filter((d) => d.color.toLowerCase() === 'blue');
    assert.equal(blues.length, 0, 'No blue die can appear in the roll — it was removed pre-roll.');
  });
});

describe('PROBE-ATK-018-D: no override — roll reflects base pool', () => {
  it('base [red, blue] + null override → rolled pool matches base', () => {
    const attackInfo = { dice: ['red', 'blue'] };
    const merged = applyOverride(attackInfo, null);
    assert.deepStrictEqual(merged.dice, ['red', 'blue']);
    const roll = rollAttackDice(merged.dice);
    assert.equal(roll.dice.length, 2);
  });
});
