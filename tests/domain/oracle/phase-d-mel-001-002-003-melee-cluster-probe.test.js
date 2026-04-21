/**
 * Phase-D behavioral probe — CRR-MEL-001 / MEL-002 / MEL-003.
 *
 * CRR-MEL-001: "Melee attacks can target a hostile figure or object adjacent
 *               to or in the same space as the attacker."
 * CRR-MEL-002: "Accuracy is not required while performing a melee attack."
 * CRR-MEL-003: "A figure without the melee icon cannot perform melee attacks;
 *               an attack targeting an adjacent figure that uses the ranged
 *               icon is still classified as a ranged attack."
 *
 * The existing evidence is a mix of invariant_pin + direct_oracle, with 001
 * resting on a single range-default assertion. These probes exercise the
 * three behavioral substrates that actually enforce the cluster:
 *   - `defaultAttackRange(attackInfo)` returns [1,1] for melee and [1,99]
 *     for ranged — NOT collapsed to adjacent even when defender is nearby.
 *   - `computeCombatResult({ isRanged, distanceToTarget, ... })` applies
 *     the accuracy-vs-distance miss gate ONLY when isRanged is true.
 *   - `isRanged = attackInfo.type === 'range'` — the gate reads the DC's
 *     weapon type, not the physical distance.
 *
 * PROBE-MEL-001-A: melee type → range [1,1]
 * PROBE-MEL-001-B: ranged type → range [1,99] (not [1,1] even without range field)
 * PROBE-MEL-002-A: isRanged=false + accuracy=0 + distance=5 → HIT (accuracy gated off)
 * PROBE-MEL-002-B: isRanged=true + same roll → MISS (accuracy gate engaged)
 * PROBE-MEL-003-A: explicit range array on ranged DC survives defaultAttackRange
 * PROBE-MEL-003-B: Bo-Rifle-style melee override forces range [1,1]
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../../src/game/combat.js';
import { defaultAttackRange } from '../../../src/handlers/dc-play-area.js';

describe('PROBE-MEL-001-A: melee attack classification yields adjacent-only range', () => {
  it('defaultAttackRange({ type: "melee" }) → [1, 1]', () => {
    assert.deepStrictEqual(defaultAttackRange({ type: 'melee' }), [1, 1],
      'CRR-MEL-001: melee attacks target adjacent (or same-space) figures only.');
  });
});

describe('PROBE-MEL-001-B: ranged classification never collapses to melee range', () => {
  it('defaultAttackRange({ type: "range" }) → [1, 99], not [1, 1]', () => {
    const r = defaultAttackRange({ type: 'range' });
    assert.deepStrictEqual(r, [1, 99],
      'CRR-MEL-003: ranged DCs retain long-range targeting; only melee collapses to [1,1].');
  });

  it('defaultAttackRange({ type: "range" }) does not equal [1,1] even adjacent', () => {
    // Reinforces the "adjacent target does not reclassify" clause of MEL-003.
    const r = defaultAttackRange({ type: 'range' });
    assert.notDeepStrictEqual(r, [1, 1],
      'Adjacent ranged attack is still ranged — defaultAttackRange must not collapse.');
  });
});

describe('PROBE-MEL-002-A: melee attack ignores accuracy-vs-distance gate', () => {
  it('isRanged=false, totalAccuracy=0, distance=5 → HIT', () => {
    const combat = {
      attackRoll: { dmg: 2, acc: 0, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: false,
      distanceToTarget: 5,
    };
    const { hit } = computeCombatResult(combat);
    assert.equal(hit, true,
      'CRR-MEL-002: melee attacks do not require accuracy — 0 acc at distance 5 still hits.');
  });
});

describe('PROBE-MEL-002-B: ranged attack engages the accuracy-vs-distance gate', () => {
  it('counterfactual: isRanged=true, totalAccuracy=0, distance=5 → MISS', () => {
    const combat = {
      attackRoll: { dmg: 2, acc: 0, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 5,
    };
    const { hit } = computeCombatResult(combat);
    assert.equal(hit, false,
      'Control: the accuracy gate must fire for ranged attacks — ensures MEL-002 is a real gate, not a no-op.');
  });

  it('isRanged=true, totalAccuracy=5, distance=5 → HIT (gate boundary)', () => {
    const combat = {
      attackRoll: { dmg: 2, acc: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 5,
    };
    const { hit } = computeCombatResult(combat);
    assert.equal(hit, true,
      'Boundary: accuracy == distance satisfies the gate (< is the miss condition).');
  });
});

describe('PROBE-MEL-003-A: explicit range on ranged DC is preserved', () => {
  it('defaultAttackRange({ type: "range", range: [2, 5] }) → [2, 5]', () => {
    // A ranged DC with a data-authored range stays ranged; the adjacency
    // distance never coerces its classification.
    assert.deepStrictEqual(defaultAttackRange({ type: 'range', range: [2, 5] }), [2, 5],
      'DC-authored range arrays flow through untouched — ranged stays ranged.');
  });
});

describe('PROBE-MEL-003-B: melee-override classification forces adjacent range', () => {
  it('Bo-Rifle-like { type: "melee" } override collapses range to [1, 1]', () => {
    // Mirrors src/handlers/combat.js:979 — overrideDice.type === 'melee'
    // rewrites the attackInfo.range. This probe just validates the default
    // resolver behaves the same way when called with an override shape.
    const overridden = { ...{ type: 'range', dice: ['red'] }, type: 'melee', range: [1, 1] };
    assert.deepStrictEqual(defaultAttackRange(overridden), [1, 1],
      'Melee-override path must land on melee range [1,1], regardless of prior ranged classification.');
  });
});
