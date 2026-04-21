/**
 * Phase-D behavioral probe — CRR-WIN-004.
 *
 * CRR: "A player earns victory points each time the player defeats an
 * opponent's figure ... the opposing player scores VPs equal to that
 * figure's Figure Cost."
 *
 * The existing assertion "attacker gains kill VP equal to deployment cost"
 * only pins the happy path for a single cost value. This probe exercises
 * `calculateKillVp` across the scaling dimensions:
 *
 *  - VP equals DC's `cost` for single-figure groups.
 *  - VP equals DC's `subCost` when group has >1 figures and subCost is set
 *    (the "per-figure kill" rule for multi-figure groups).
 *  - Companions award 0 VP.
 *  - Default cost (5) is used when stats are missing (defensive fallback).
 *
 * PROBE-WIN-004-A: single-figure DC → VP = cost
 * PROBE-WIN-004-B: multi-figure DC with subCost → VP = subCost (not cost)
 * PROBE-WIN-004-C: companion DC → VP = 0
 * PROBE-WIN-004-D: missing cost → defaults to 5
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateKillVp } from '../../../src/engine/mission-helpers.js';

function mkDeps({ stats, effects, companions = [] } = {}) {
  return {
    getDcStats: (name) => stats[name] || null,
    getDcEffects: () => effects || {},
    isDcCompanion: (name) => companions.includes(name),
  };
}

describe('PROBE-WIN-004-A: single-figure DC — VP equals figure cost', () => {
  it('cost=6, figures=1 → 6 VP', () => {
    const deps = mkDeps({
      stats: { 'Greedo': { cost: 6, figures: 1 } },
      effects: { 'Greedo': {} },
    });
    assert.equal(calculateKillVp('Greedo', deps), 6);
  });

  it('cost=12, figures=1 → 12 VP', () => {
    const deps = mkDeps({
      stats: { 'Darth Vader': { cost: 12, figures: 1 } },
      effects: { 'Darth Vader': {} },
    });
    assert.equal(calculateKillVp('Darth Vader', deps), 12);
  });
});

describe('PROBE-WIN-004-B: multi-figure DC — VP equals subCost, not cost', () => {
  it('cost=8, figures=3, subCost=3 → 3 VP per kill (not 8)', () => {
    const deps = mkDeps({
      stats: { '[Stormtrooper]': { cost: 8, figures: 3 } },
      effects: { '[Stormtrooper]': { subCost: 3 } },
    });
    assert.equal(calculateKillVp('[Stormtrooper]', deps), 3,
      'Multi-figure group with subCost uses subCost per defeated figure.');
  });

  it('cost=6, figures=2, no subCost → falls back to cost (6)', () => {
    const deps = mkDeps({
      stats: { '[Jawa Scavenger]': { cost: 6, figures: 2 } },
      effects: { '[Jawa Scavenger]': {} },
    });
    assert.equal(calculateKillVp('[Jawa Scavenger]', deps), 6,
      'Missing subCost must fall back to full deployment cost.');
  });
});

describe('PROBE-WIN-004-C: companion DC — VP is 0', () => {
  it('companion is recognised and awards 0 VP regardless of cost', () => {
    const deps = mkDeps({
      stats: { 'R2-D2': { cost: 5, figures: 1 } },
      effects: { 'R2-D2': {} },
      companions: ['R2-D2'],
    });
    assert.equal(calculateKillVp('R2-D2', deps), 0,
      'CRR: companions do not award VP on defeat.');
  });
});

describe('PROBE-WIN-004-D: missing stats — defaults to 5', () => {
  it('no stats entry → cost defaults to 5', () => {
    const deps = mkDeps({ stats: {}, effects: {} });
    assert.equal(calculateKillVp('Unknown DC', deps), 5,
      'Defensive default: missing stats fall back to 5 VP.');
  });
});
