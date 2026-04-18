/**
 * Phase-D probes for ranged-at-adjacent-distance accuracy gate.
 *
 * PROBE-PD-ACC-003: A ranged attack targeting an adjacent figure (distance=1)
 *   with 0 accuracy MISSES — same acc<distance rule as all other ranged attacks.
 *   Pins CRR-ACC-003 + CRR-RNG-003 (same rule, two sections in CRR).
 *
 * The engine implementation is a general acc<dist gate in src/game/combat.js;
 * this probe asserts the adjacent (dist=1) boundary case.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../../src/game/combat.js';

describe('PROBE-PD-ACC-003: ranged attack adjacent requires ≥1 accuracy', () => {
  it('003a: ranged attack with acc=0 vs distance-1 (adjacent) target → miss', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 1,
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, false,
      `ranged-adjacent acc=0 must miss — CRR-ACC-003/RNG-003 violation. Got hit=${result.hit}`);
    assert.match(result.resultText || '', /insufficient accuracy/i);
  });

  it('003b: ranged attack with acc=1 vs distance-1 target → hit', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 1, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 1,
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, true,
      `ranged-adjacent acc=1 must hit (acc ≥ dist). Got hit=${result.hit}`);
  });
});
