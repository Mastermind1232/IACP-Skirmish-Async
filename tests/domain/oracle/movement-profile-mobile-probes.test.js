/**
 * Tier 3 Legality-Oracle Probes: Movement-Profile Mobile flags
 *
 * Pins the CRR MOBILE keyword rules (p.47):
 *   "Figures that have the Mobile keyword ignore additional movement point
 *   costs when entering difficult terrain and spaces containing hostile
 *   figures. They ignore terrain for movement, so can move through and
 *   enter impassable and blocking terrain..."
 *
 * Surface under test: getMovementProfile() in src/game/movement.js.
 * Lines 407-409:
 *   ignoreDifficult: isMassive || isMobile || hasEfficientTravel || hasSurvivalist,
 *   ignoreBlocking: isMassive || isMobile,
 *   ignoreFigureCost: isMassive || isMobile || hasEfficientTravel || hasSurvivalist,
 *
 * Fixture: Bo-Katan Kryze has "Mobile" in passives (data/dc-effects.json).
 * getDcKeywords promotes Mobile/Massive/Efficient Travel passives to keywords.
 *
 * PROBE-MOB-001: Mobile → ignoreDifficult=true
 * PROBE-MOB-002: Mobile → ignoreBlocking=true
 * PROBE-MOB-003: Mobile → ignoreFigureCost=true
 * PROBE-MOB-004: Negative control — non-Mobile DC has all three flags false
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMovementProfile } from '../../../src/game/movement.js';

function makeMinimalGame() {
  return {
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {},
  };
}

// ── PROBE-MOB-001: Mobile → ignoreDifficult=true ─────────────────────────────

describe('PROBE-MOB-001: Mobile keyword sets ignoreDifficult=true', () => {
  it('001: Bo-Katan Kryze (Mobile passive) → profile.ignoreDifficult=true', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Bo-Katan Kryze', 'Bo-Katan Kryze-1-0', game);
    assert.strictEqual(profile.isMobile, true, 'isMobile must be true');
    assert.strictEqual(profile.ignoreDifficult, true,
      'Mobile figures ignore difficult-terrain movement cost');
  });
});

// ── PROBE-MOB-002: Mobile → ignoreBlocking=true ──────────────────────────────

describe('PROBE-MOB-002: Mobile keyword sets ignoreBlocking=true', () => {
  it('002: Bo-Katan Kryze (Mobile passive) → profile.ignoreBlocking=true', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Bo-Katan Kryze', 'Bo-Katan Kryze-1-0', game);
    assert.strictEqual(profile.ignoreBlocking, true,
      'Mobile figures can move through blocking/impassable terrain');
  });
});

// ── PROBE-MOB-003: Mobile → ignoreFigureCost=true ────────────────────────────

describe('PROBE-MOB-003: Mobile keyword sets ignoreFigureCost=true', () => {
  it('003: Bo-Katan Kryze (Mobile passive) → profile.ignoreFigureCost=true', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Bo-Katan Kryze', 'Bo-Katan Kryze-1-0', game);
    assert.strictEqual(profile.ignoreFigureCost, true,
      'Mobile figures ignore hostile-figure additional movement cost');
  });
});

// ── PROBE-MOB-004: Negative control — non-Mobile DC ──────────────────────────

describe('PROBE-MOB-004: non-Mobile DC does not get Mobile flags', () => {
  it('004: Rebel Trooper (no Mobile) → all three ignore flags are false', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    assert.strictEqual(profile.isMobile, false, 'Rebel Trooper is not Mobile');
    assert.strictEqual(profile.ignoreDifficult, false,
      'non-Mobile / non-Massive figures pay difficult-terrain cost');
    assert.strictEqual(profile.ignoreBlocking, false,
      'non-Mobile / non-Massive figures cannot cross blocking terrain');
    assert.strictEqual(profile.ignoreFigureCost, false,
      'non-Mobile / non-Massive figures pay hostile-figure cost');
  });
});
