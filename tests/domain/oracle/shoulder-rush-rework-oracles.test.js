/**
 * Oracle tests for the KX-Series Security Droid "Shoulder Rush" IACP rework
 * (alexanbv 2026-06-21).
 *
 * NEW card text:
 *   "Double Action (Shoulder Rush): Move up to 6 spaces and choose an adjacent
 *    hostile figure. If that figure is SMALL, push it 1 space and enter the
 *    space it exited. If the figure is not SMALL, it is not pushed and KX
 *    cannot enter its space, but KX may still attack it. Then perform an attack
 *    targeting the chosen figure."
 *
 * Verifies:
 *   - actionCost 2 (Double Action) on the library entry
 *   - freeMoveBonus 6 (move up to 6 spaces)
 *   - dc-effects abilityText updated to the new wording
 *   - the not-SMALL handler path still grants the free attack and does NOT
 *     enter the target's space (no push, no move-in)
 *   - derived specialCosts surfaces a cost of 2 for Shoulder Rush
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDcEffects, getAbilityLibrary, getDcStats } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const readSrc = (p) => readFileSync(join(ROOT, p), 'utf8');

const abilityLib = getAbilityLibrary();
const dcEffects = getDcEffects();

describe('ORACLE-SHOULDER-RUSH-REWORK: library + dc-effects metadata', () => {
  it('shoulder_rush is a Double Action (actionCost 2)', () => {
    const entry = abilityLib.abilities['shoulder_rush'];
    assert.ok(entry, 'shoulder_rush must exist in the ability library');
    assert.strictEqual(entry.actionCost, 2,
      'Shoulder Rush is now a Double Action (actionCost: 2)');
  });

  it('shoulder_rush moves up to 6 spaces (freeMoveBonus 6)', () => {
    const entry = abilityLib.abilities['shoulder_rush'];
    assert.strictEqual(entry.freeMoveBonus, 6,
      'Shoulder Rush now grants up to 6 spaces of movement');
  });

  it('shoulder_rush keeps its post-move continuation wiring', () => {
    const entry = abilityLib.abilities['shoulder_rush'];
    assert.strictEqual(entry.shoulderRushPostMove, true);
    assert.strictEqual(entry.wiredStatus, 'wired');
  });

  it('shoulder_rush description names the non-SMALL no-push/no-enter rule', () => {
    const d = abilityLib.abilities['shoulder_rush'].description || '';
    assert.match(d, /Double Action/);
    assert.match(d, /up to 6 spaces/);
    assert.match(d, /not SMALL/i);
    assert.match(d, /cannot enter its space/i);
  });

  it('KX-Series Security Droid (Elite) abilityText reflects the rework', () => {
    const eff = dcEffects['KX-Series Security Droid (Elite)'];
    assert.ok(eff, 'KX-Series Security Droid (Elite) must exist');
    const t = eff.abilityText || '';
    assert.match(t, /Double Action \(Shoulder Rush\)/);
    assert.match(t, /Move up to 6 spaces/);
    assert.match(t, /not SMALL.*not pushed.*cannot enter its space.*still attack/s);
  });

  it('derived specialCosts surfaces a 2-action cost for Shoulder Rush', () => {
    const stats = getDcStats('KX-Series Security Droid (Elite)');
    const idx = (stats.specials || []).findIndex(s => /Shoulder Rush/i.test(typeof s === 'string' ? s : (s?.label || s?.id || '')));
    assert.ok(idx >= 0, 'Shoulder Rush must be present in the DC specials list');
    assert.strictEqual((stats.specialCosts || [])[idx], 2,
      'Shoulder Rush double-action cost must surface as 2 in specialCosts');
  });
});

describe('ORACLE-SHOULDER-RUSH-REWORK: not-SMALL path still attacks, no enter', () => {
  it('handleShoulderRushFig grants the free attack on the non-SMALL branch', () => {
    const src = readSrc('src/handlers/dc-play-area.js');
    // Locate the non-SMALL / push-immune branch.
    const branchIdx = src.indexOf('if (!isSmall || pushImmune) {');
    assert.ok(branchIdx > 0, 'non-SMALL / push-immune branch must exist');
    const branch = src.slice(branchIdx, branchIdx + 700);
    // Free attack is still granted on this branch...
    assert.match(branch, /freeAttackBonusPending/,
      'non-SMALL branch must still grant the free attack');
    assert.match(branch, /forcedAttackTarget/,
      'non-SMALL branch must force the attack onto the chosen figure');
    // ...and KX must NOT push or enter the target space on this branch.
    assert.doesNotMatch(branch, /pushFigure/,
      'non-SMALL branch must NOT push or enter the target space');
  });
});
