/**
 * Phase-D probe: attack-declaration timing — attacker must have a
 * valid position on the board (movement ended) to offer an attack,
 * and "before declaring an attack / a target" timings resolve before
 * pendingCombat is set (i.e. before Step 1).
 *
 * PROBE-PD-ATK-006: CRR ATTACK — "A figure must end its movement (not
 *   sharing a space with another non-companion figure) to perform
 *   an attack."
 *
 * PROBE-PD-ATK-013: CRR ATTACK — "Abilities with timing 'before
 *   declaring an attack' or 'before declaring a target' are performed
 *   immediately before Step 1."
 *
 * Implementation:
 *   - available-actions.js short-circuits attack-target computation
 *     with `if (!attackerPos) return [];` — a figure with no position
 *     (defeated, not placed, or mid-displacement before commit) never
 *     has attacks offered. Movement-end validity is enforced at
 *     commit time in `src/handlers/movement.js` (occupancy + Massive
 *     displacement), so `attackerPos` always refers to a committed,
 *     not-overlapping space.
 *   - `cc-timing.js` routes `beforeyoudeclareattack` and
 *     `beforedeclaringrangedattack` via `ctx.duringActivation` — true
 *     before pendingCombat is set (Step 1), ie these abilities
 *     resolve immediately before attack declaration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');
const CT_SRC = readFileSync(resolve(ROOT, 'src/game/cc-timing.js'), 'utf8');

describe('PROBE-PD-ATK-006/013: attack requires a committed attacker position; before-declare timings resolve pre-Step 1', () => {
  it('006a: source — available-actions.js returns [] for attack-target computation when attackerPos is absent (no position → no attack)', () => {
    assert.match(AA_SRC,
      /const attackerPos = game\.figurePositions\?\.\[playerNum\]\?\.\[figureKey\];\s*\n\s*if \(!attackerPos\) return \[\];/,
      'available-actions.js must short-circuit attack-target computation when attackerPos is missing — CRR-ATK-006');
  });

  it('013a: source — cc-timing.js routes "beforeyoudeclareattack" via ctx.duringActivation (playable before pendingCombat is set)', () => {
    assert.match(CT_SRC,
      /case 'beforeyoudeclareattack':[\s\S]*?return ctx\.duringActivation;/,
      'cc-timing must route beforeyoudeclareattack via duringActivation — CRR-ATK-013');
  });

  it('013b: source — cc-timing.js routes "beforedeclaringrangedattack" (Marksman) the same way (pre-Step 1)', () => {
    assert.match(CT_SRC,
      /case 'beforedeclaringrangedattack':[\s\S]*?return ctx\.duringActivation;/,
      'cc-timing must route beforedeclaringrangedattack via duringActivation — CRR-ATK-013');
  });

  it('013c: source — cc-timing.js distinguishes "whenyoudeclareattack" (ctx.duringAttack && ctx.isAttacker) from the before-declare window', () => {
    assert.match(CT_SRC,
      /case 'whenyoudeclareattack':[\s\S]*?return ctx\.duringAttack && ctx\.isAttacker;/,
      'when-you-declare-attack must be gated on duringAttack (post Step 1) — CRR-ATK-013');
  });
});
