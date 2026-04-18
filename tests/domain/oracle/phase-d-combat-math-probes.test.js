/**
 * Phase-D probes for combat-math invariants.
 *
 * PROBE-PD-ACC-004: Attacking an object in the same space requires 0 Accuracy —
 *   ranged acc<dist gate must NOT trip when distanceToTarget=0.
 *   Pins CRR-ACC-004.
 *
 * PROBE-PD-PRC-003: Multiple Pierce sources add together on one attack —
 *   surgePierce and bonusPierce both reduce effective block.
 *   Pins CRR-PRC-003.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../../src/game/combat.js';

describe('PROBE-PD-ACC-004: ranged attack vs distance-0 (same space) passes acc gate', () => {
  it('004: acc=0, dmg=3, distance=0 → hit (no accuracy requirement at distance 0)', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 0,
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, true,
      `same-space attack with acc=0 must hit — CRR-ACC-004. Got hit=${result.hit}`);
    assert.equal(result.damage, 3, 'damage resolves normally');
  });
});

describe('PROBE-PD-PRC-003: multiple Pierce sources add together on one attack', () => {
  it('003: surgePierce=1 + bonusPierce=2 → total 3 pierce reduces 3 block', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 5, dmg: 4, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      isRanged: false,
      surgeDamage: 0,
      surgePierce: 1,
      bonusPierce: 2,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, true, 'hits');
    assert.equal(result.damage, 4,
      `CRR-PRC-003: 1 surgePierce + 2 bonusPierce = 3 total pierce; 3 block - 3 pierce = 0 effective block; 4 dmg - 0 = 4. Got damage=${result.damage}`);
  });

  it('003b: pierce sources accumulate but do not exceed block to create negative block', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      isRanged: false,
      surgeDamage: 0,
      surgePierce: 2,
      bonusPierce: 3,
      surgeAccuracy: 0,
    });
    assert.equal(result.damage, 2,
      'pierce total of 5 clamps against 1 block → 0 effective block; damage = 2 - 0 = 2');
  });
});
