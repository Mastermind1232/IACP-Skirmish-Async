/**
 * PROBE-FEINT: Feint Command Card behavioral oracle.
 *
 * CSV (Feint, attack:modifiers / attacker): effect = "Choose 1 attack die and 1
 * defense die and remove their results"; use-condition = "attacking a figure
 * within 2 spaces".
 *
 * Timing: the modifiers window, AFTER both pools are rolled (same window as
 * Heightened Reflexes). The effect removes 1 ROLLED attack-die RESULT and 1
 * ROLLED defense-die RESULT (NOT pool dice). Implemented as a two-step
 * interactive pick via the chained-requiresChoice flow:
 *   step 1 → choose attack die (zeroed), step 2 → choose defense die (zeroed).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

function buildCombat({ dist = 1 } = {}) {
  return {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    distanceToTarget: dist,
    attackDiceResults: [
      { color: 'blue', dmg: 2, surge: 1, acc: 1 },
      { color: 'green', dmg: 1, surge: 0, acc: 0 },
    ],
    defenseDiceResults: [
      { color: 'white', block: 1, evade: 1, dodge: false },
      { color: 'black', block: 2, evade: 0, dodge: false },
    ],
    attackRoll: { dmg: 3, surge: 1, acc: 1 },
    defenseRoll: { block: 3, evade: 1, dodge: false },
  };
}

describe('PROBE-FEINT-001: two-step pick removes 1 attack-die + 1 defense-die rolled RESULT', () => {
  it('step 1 offers attack dice, step 2 offers defense dice, both results zeroed', () => {
    const combat = buildCombat();
    const game = { gameId: 'gf', combat };

    // Step 1: attack-die picker.
    let r = resolveAbility('Feint', { game, playerNum: 1, combat });
    assert.equal(r.requiresChoice, true, 'step 1 should require a choice');
    assert.equal(r.choiceOptions.length, 2, 'two attack dice offered');
    assert.match(r.choiceOptions[0], /Attack die/);

    // Choose attack die index 0 (blue, 2dmg/1srg/1acc).
    r = resolveAbility('Feint', { game, playerNum: 1, combat, choiceIndex: 0 });
    assert.equal(r.requiresChoice, true, 'step 2 should require a choice');
    assert.equal(r.applied, false);
    assert.match(r.choiceOptions[0], /Defense die/);
    // Attack roll recomputed: only the green die (1 dmg) remains.
    assert.deepStrictEqual(combat.attackRoll, { acc: 0, dmg: 1, surge: 0 }, 'attack-die result removed + recomputed');

    // Choose defense die index 1 (black, 2 block).
    r = resolveAbility('Feint', { game, playerNum: 1, combat, choiceIndex: 1 });
    assert.equal(r.applied, true, 'final step applies');
    assert.deepStrictEqual(combat.defenseRoll, { block: 1, evade: 1, dodge: false }, 'defense-die result removed + recomputed');
    // Cleanup flags removed.
    assert.equal(combat._feintAttackRemoved, undefined);
    assert.equal(combat._feintAttackRemovedIdx, undefined);
  });
});

describe('PROBE-FEINT-002: within-2 use-condition', () => {
  it('refuses when the target is more than 2 spaces away', () => {
    const combat = buildCombat({ dist: 3 });
    const r = resolveAbility('Feint', { game: { combat }, playerNum: 1, combat });
    assert.equal(r.applied, false);
    assert.ok(/within|2 spaces|3 spaces/.test(r.manualMessage || ''), 'should flag the distance condition');
    assert.notEqual(r.requiresChoice, true, 'no pick offered when out of range');
  });

  it('allows at exactly 2 spaces', () => {
    const combat = buildCombat({ dist: 2 });
    const r = resolveAbility('Feint', { game: { combat }, playerNum: 1, combat });
    assert.equal(r.requiresChoice, true, 'within 2 → playable');
  });
});

describe('PROBE-FEINT-003: library-contract pinning', () => {
  it('library entry uses feintEffect (not the old defensePoolRemoveMax proxy)', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.Feint;
    assert.ok(entry, 'Feint must exist');
    assert.equal(entry.type, 'ccEffect');
    assert.equal(entry.feintEffect, true);
    assert.equal(entry.defensePoolRemoveMax, undefined, 'the old pool-die proxy is gone');
    assert.equal(entry.wiredStatus, 'wired');
  });
});
