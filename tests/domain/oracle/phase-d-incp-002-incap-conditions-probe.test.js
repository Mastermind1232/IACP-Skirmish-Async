/**
 * Phase-D probe: CRR INCP-002 — "When a figure is incapacitated, it
 * discards all conditions, and conditions cannot be applied to that figure."
 *
 * Substrate: The Child's Force Exhaustion. When the opt-in Yes branch at
 * combat-reactions.js fires, game.childIncapacitated = true is set AND any
 * conditions on The Child are discarded. applyCondition() in
 * src/game/conditions.js then short-circuits for The Child while
 * game.childIncapacitated is true, enforcing the no-new-conditions half.
 *
 * Implementation chain (invariant pin):
 *   1. combat-reactions.js Force-Exhaustion handler (isYes branch):
 *      sets game.childIncapacitated = true AND deletes
 *      game.figureConditions[fe.childFigureKey] — pin "discards all
 *      conditions".
 *   2. src/game/conditions.js applyCondition: early-returns false when
 *      dcNameFromFigureKey(figureKey) === 'The Child' and
 *      game.childIncapacitated — pin "conditions cannot be applied".
 *      Returning false (not throwing) keeps the call site graceful and
 *      consistent with the "already has condition" short-circuit below it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CR_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat-reactions.js'), 'utf8');
const COND_SRC = readFileSync(resolve(ROOT, 'src/game/conditions.js'), 'utf8');

describe('PROBE-PD-INCP-002: incapacitated figure discards all conditions and cannot receive new ones', () => {
  it('002a: source — Force-Exhaustion Yes branch discards The Child\'s conditions at the moment of incapacitation', () => {
    // The discard sits inside the isYes block, immediately after the
    // childIncapacitated flip. The fe.childFigureKey lookup was captured when
    // pendingForceExhaustion was created in combat.js.
    assert.match(CR_SRC,
      /game\.childIncapacitated = true;[\s\S]*?if \(fe\.childFigureKey && game\.figureConditions\?\.\[fe\.childFigureKey\]\) \{\s*\n\s*delete game\.figureConditions\[fe\.childFigureKey\];\s*\n\s*\}/,
      'Force-Exhaustion Yes must discard The Child\'s conditions on incap — CRR-INCP-002 clause (a)');
  });

  it('002b: source — applyCondition short-circuits (returns false) for The Child while incapacitated', () => {
    assert.match(COND_SRC,
      /if \(game\?\.childIncapacitated && dcNameFromFigureKey\(figureKey\) === 'The Child'\) return false;/,
      'applyCondition must be a no-op for The Child while incapacitated — CRR-INCP-002 clause (b)');
  });

  it('002c: behavioural — applyCondition(The Child) after incap does not mutate figureConditions, returns false', async () => {
    // Live-module check: import the real applyCondition and exercise the gate.
    const { applyCondition } = await import(resolve(ROOT, 'src/game/conditions.js'));
    const game = { childIncapacitated: true, figureConditions: {} };
    const childKey = 'The Child-1-0';
    const result = applyCondition(game, childKey, 'Stun');
    assert.equal(result, false,
      'applyCondition must return false when The Child is incapacitated — CRR-INCP-002');
    assert.equal(game.figureConditions[childKey], undefined,
      'figureConditions must remain unchanged when condition is refused — CRR-INCP-002');
  });

  it('002d: behavioural — applyCondition(The Child) is NOT gated when childIncapacitated is false (pre-incap baseline)', async () => {
    // Guard against over-gating: the rule must not leak into the pre-incap state.
    const { applyCondition } = await import(resolve(ROOT, 'src/game/conditions.js'));
    const game = { figureConditions: {} };
    const childKey = 'The Child-1-0';
    const result = applyCondition(game, childKey, 'Focus');
    assert.equal(result, true,
      'applyCondition must succeed for The Child before incap — CRR-INCP-002 (no over-gate)');
    assert.deepEqual(game.figureConditions[childKey], ['Focus'],
      'figureConditions must reflect the newly applied condition — CRR-INCP-002 (no over-gate)');
  });

  it('002e: behavioural — the incap gate is scoped to The Child (other figures ignore childIncapacitated)', async () => {
    const { applyCondition } = await import(resolve(ROOT, 'src/game/conditions.js'));
    const game = { childIncapacitated: true, figureConditions: {} };
    const otherKey = 'Chopper-1-0';
    const result = applyCondition(game, otherKey, 'Stun');
    assert.equal(result, true,
      'applyCondition must succeed for non-Child figures regardless of childIncapacitated — CRR-INCP-002 scope');
    assert.deepEqual(game.figureConditions[otherKey], ['Stun'],
      'non-Child figureConditions must update normally — CRR-INCP-002 scope');
  });
});
