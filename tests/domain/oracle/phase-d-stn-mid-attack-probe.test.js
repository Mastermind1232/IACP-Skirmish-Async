/**
 * Phase-D probe: a figure can resolve an attack that has already been declared
 * if it becomes Stunned during that attack.
 *
 * PROBE-PD-STN-002: CRR STUNNED — "A figure can resolve an attack that has
 *   already been declared if it becomes Stunned during that attack."
 *
 * Implementation: `applyCondition` in src/game/conditions.js is the sole
 *   Stun-application path. It only mutates `game.figureConditions`; it does
 *   not read, mutate, or clear `game.pendingCombat`. No Stun-application
 *   call site in src/ follows `applyCondition(..., 'Stun')` with a
 *   pendingCombat abort/clear. Therefore a Stun landing mid-attack leaves
 *   the declared attack's pendingCombat state intact and the attack
 *   resolves normally.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCondition } from '../../../src/game/conditions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const COND_SRC = readFileSync(resolve(ROOT, 'src/game/conditions.js'), 'utf8');

describe('PROBE-PD-STN-002: mid-attack Stun does not abort a declared attack', () => {
  it('002a: source — applyCondition never reads or mutates pendingCombat', () => {
    assert.doesNotMatch(COND_SRC, /pendingCombat/,
      'applyCondition must not reference pendingCombat — CRR-STN-002 (Stun cannot abort a declared attack)');
  });

  it('002b: behavior — applying Stun to the attacker leaves pendingCombat intact', () => {
    const attackerFigureKey = 'p1_stormtrooper_1';
    const targetFigureKey = 'p2_rebel_trooper_1';
    const game = {
      figureConditions: {},
      pendingCombat: {
        attackerFigureKey,
        target: { figureKey: targetFigureKey },
        attackInfo: { dice: ['red', 'green'], mods: [] },
        phase: 'rolled',
      },
    };
    const applied = applyCondition(game, attackerFigureKey, 'Stun');
    assert.equal(applied, true, 'Stun must be newly applied');
    assert.ok(game.figureConditions[attackerFigureKey].includes('Stun'),
      'Stun condition is recorded on the attacker');
    assert.ok(game.pendingCombat && game.pendingCombat.attackerFigureKey === attackerFigureKey,
      'pendingCombat survives mid-attack Stun — CRR-STN-002');
    assert.deepEqual(game.pendingCombat.attackInfo.dice, ['red', 'green'],
      'declared attack dice are unchanged — CRR-STN-002');
  });

  it('002c: behavior — applying Stun to the defender also leaves pendingCombat intact', () => {
    const attackerFigureKey = 'p1_stormtrooper_1';
    const targetFigureKey = 'p2_rebel_trooper_1';
    const game = {
      figureConditions: {},
      pendingCombat: {
        attackerFigureKey,
        target: { figureKey: targetFigureKey },
        attackInfo: { dice: ['red'], mods: [] },
      },
    };
    applyCondition(game, targetFigureKey, 'Stun');
    assert.ok(game.pendingCombat,
      'pendingCombat survives a mid-attack Stun on the defender — CRR-STN-002');
    assert.equal(game.pendingCombat.target.figureKey, targetFigureKey,
      'pendingCombat target identity preserved');
  });
});
