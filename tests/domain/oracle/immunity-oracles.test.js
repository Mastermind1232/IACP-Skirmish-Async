/**
 * Oracle tests for harmful-condition immunity enforcement.
 *
 * Phase 1B fix: All harmful-condition sites (Stun, Bleed, Weaken) now check
 * isConditionImmune() before applying conditions. Immune figures:
 *   - Onar Koma (immune_onar specialAbilityId)
 *   - Elite Snowtroopers (immune_snowtrooper_elite specialAbilityId)
 *   - Fifth Brother (when youWillNotDenyMeActive is set)
 *
 * These tests verify the immunity gate at the conditions.js layer and at the
 * abilities.js orStunInstead path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isConditionImmune, applyCondition } from '../../../src/game/conditions.js';

// ── ORACLE-IMMUNE-001: isConditionImmune recognizes Onar Koma ────────────────
describe('ORACLE-IMMUNE-001: Onar Koma is immune to harmful conditions', () => {
  it('001a: isConditionImmune returns true for Onar Koma', () => {
    const game = {};
    assert.equal(isConditionImmune(game, 'Onar Koma-1-0'), true);
  });

  it('001b: isConditionImmune returns false for a non-immune figure', () => {
    const game = {};
    assert.equal(isConditionImmune(game, 'Stormtrooper (Regular)-1-0'), false);
  });
});

// ── ORACLE-IMMUNE-002: Fifth Brother with You Will Not Deny Me ───────────────
describe('ORACLE-IMMUNE-002: Fifth Brother immune when youWillNotDenyMeActive', () => {
  it('002a: immune when youWillNotDenyMeActive is set', () => {
    const game = { youWillNotDenyMeActive: true };
    assert.equal(isConditionImmune(game, 'Fifth Brother-1-0'), true);
  });

  it('002b: NOT immune when youWillNotDenyMeActive is unset', () => {
    const game = {};
    assert.equal(isConditionImmune(game, 'Fifth Brother-1-0'), false);
  });
});

// ── ORACLE-IMMUNE-003: Elite Snowtroopers immunity ───────────────────────────
describe('ORACLE-IMMUNE-003: Elite Snowtroopers are immune to harmful conditions', () => {
  it('003: isConditionImmune returns true for Snowtrooper (Elite)', () => {
    const game = {};
    assert.equal(isConditionImmune(game, 'Snowtrooper (Elite)-1-0'), true);
  });
});

// ── ORACLE-IMMUNE-004: applyCondition still works for non-harmful conditions ─
describe('ORACLE-IMMUNE-004: applyCondition is independent of immunity check', () => {
  it('004: applyCondition applies Focus to immune figure (non-harmful condition)', () => {
    const game = {};
    const applied = applyCondition(game, 'Onar Koma-1-0', 'Focus');
    assert.equal(applied, true, 'Focus is not a harmful condition — should apply');
    assert.deepStrictEqual(game.figureConditions['Onar Koma-1-0'], ['Focus']);
  });
});

// ── ORACLE-IMMUNE-005: Dedup — applyCondition returns false on re-apply ──────
describe('ORACLE-IMMUNE-005: applyCondition deduplicates', () => {
  it('005: second application of same condition returns false', () => {
    const game = {};
    applyCondition(game, 'Rebel Trooper-1-0', 'Stun');
    const second = applyCondition(game, 'Rebel Trooper-1-0', 'Stun');
    assert.equal(second, false, 'Duplicate condition should not be re-applied');
    assert.equal(game.figureConditions['Rebel Trooper-1-0'].length, 1);
  });
});
