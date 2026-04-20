/**
 * Phase-D probe: a Focused gained after dice are rolled cannot be used on
 * the current attack or test.
 *
 * PROBE-PD-FOC-006: CRR FOCUSED — "If a figure gains Focused after rolling
 *   dice for an attack or test, it cannot use the condition until its
 *   next attack or test."
 *
 * Implementation: the Focus→green-die grant is performed solely by
 *   `applyConditionWithDie(game, figureKey, 'Focus', attackInfo, 'green')`
 *   in src/game/conditions.js. That helper returns a NEW attackInfo with
 *   the green die appended; it is only called in combat.js pre-roll
 *   ability windows (before attackInfo.dice is frozen and rolled).
 *   All post-roll Focus gains go through the plain `applyCondition(game,
 *   figureKey, 'Focus')`, whose signature takes no attackInfo and which
 *   only mutates `game.figureConditions`. Therefore a Focused gained
 *   mid-attack cannot retroactively add a die to the current roll.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCondition, applyConditionWithDie } from '../../../src/game/conditions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const COND_SRC = readFileSync(resolve(ROOT, 'src/game/conditions.js'), 'utf8');

describe('PROBE-PD-FOC-006: post-roll Focused cannot be used on the current attack', () => {
  it('006a: source — plain applyCondition signature has no attackInfo/die parameter', () => {
    assert.match(COND_SRC,
      /export function applyCondition\(game, figureKey, cond\) \{/,
      'applyCondition must take only (game, figureKey, cond) — CRR-FOC-006 (cannot mutate attack dice)');
  });

  it('006b: source — plain applyCondition body does not touch attackInfo or dice', () => {
    const body = COND_SRC.match(
      /export function applyCondition\(game, figureKey, cond\) \{[\s\S]*?\n\}/
    );
    assert.ok(body, 'applyCondition body must be locatable');
    assert.doesNotMatch(body[0], /attackInfo/, 'no attackInfo reference — CRR-FOC-006');
    assert.doesNotMatch(body[0], /\.dice\b/, 'no dice reference — CRR-FOC-006');
  });

  it('006c: source — applyConditionWithDie is the sole path that adds a die', () => {
    assert.match(COND_SRC,
      /export function applyConditionWithDie\(game, figureKey, condition, attackInfo, dieColor\) \{/,
      'applyConditionWithDie must be exported with (game, figureKey, condition, attackInfo, dieColor) — CRR-FOC-006');
    assert.match(COND_SRC,
      /dice: \[\.\.\.\(attackInfo\.dice \|\| \[\]\), dieColor\]/,
      'applyConditionWithDie appends dieColor exactly once to attackInfo.dice — CRR-FOC-006');
  });

  it('006d: behavior — applyCondition(Focus) does not mutate an existing pendingCombat.attackInfo.dice', () => {
    const attackerFigureKey = 'p1_rebel_saboteur_1';
    const attackInfo = { dice: ['green', 'yellow'], mods: [] };
    const game = {
      figureConditions: {},
      pendingCombat: { attackerFigureKey, attackInfo, phase: 'rolled' },
    };
    const newlyApplied = applyCondition(game, attackerFigureKey, 'Focus');
    assert.equal(newlyApplied, true, 'Focus applied to the attacker');
    assert.deepEqual(game.pendingCombat.attackInfo.dice, ['green', 'yellow'],
      'post-roll Focus grant does not add a die to the current attack — CRR-FOC-006');
    assert.equal(game.pendingCombat.attackInfo.dice.length, 2,
      'dice count unchanged by post-roll Focus — CRR-FOC-006');
  });

  it('006e: behavior — pre-roll applyConditionWithDie DOES add the green die (contrast)', () => {
    const attackerFigureKey = 'p1_rebel_saboteur_1';
    const attackInfo = { dice: ['green', 'yellow'], mods: [] };
    const game = { figureConditions: {} };
    const { attackInfo: next, applied } = applyConditionWithDie(
      game, attackerFigureKey, 'Focus', attackInfo, 'green'
    );
    assert.equal(applied, true, 'Focus newly applied pre-roll');
    assert.deepEqual(next.dice, ['green', 'yellow', 'green'],
      'pre-roll path appends the green die — this is the ONLY Focus-die grant — CRR-FOC-006');
    assert.deepEqual(attackInfo.dice, ['green', 'yellow'],
      'original attackInfo is not mutated (pure helper) — CRR-FOC-006');
  });

  it('006f: behavior — duplicate Focus gain is a no-op on both helpers (no double-grant)', () => {
    const fk = 'p1_figA';
    const game = { figureConditions: { [fk]: ['Focus'] } };
    const again = applyCondition(game, fk, 'Focus');
    assert.equal(again, false, 'duplicate Focus returns false');
    const attackInfo = { dice: ['red'] };
    const { attackInfo: next, applied } = applyConditionWithDie(game, fk, 'Focus', attackInfo, 'green');
    assert.equal(applied, false, 'duplicate Focus via withDie returns applied:false');
    assert.deepEqual(next.dice, ['red'], 'no die is added when Focus was already present — CRR-FOC-006');
  });
});
