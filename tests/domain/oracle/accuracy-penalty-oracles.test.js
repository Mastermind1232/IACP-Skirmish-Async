/**
 * Oracle tests for roundDefenseAccuracyPenalty (Take Cover / Deflection).
 *
 * Rule: Take Cover and Deflection each apply −2 Accuracy to attacking figures
 *       when the defender's player has played the CC this round.
 *       This is an ACCURACY penalty (affects ranged hit/miss via distance check),
 *       NOT Evade (which cancels surges).
 *
 * Confirmed-safe core:
 *   - Take Cover: +1 Block, −2 Accuracy (not +2 Evade)
 *   - Deflection: −2 Accuracy (not +2 Evade), plus unconditional 1 counter-damage after attack
 *   - Penalties accumulate additively across multiple CCs in the same round
 *   - Accuracy penalty feeds into totalAccuracy formula (combat.js) — can cause ranged miss
 *   - Melee attacks have no distance check — accuracy penalty is cosmetic only
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../../src/game/combat.js';
import { resolveAbility } from '../../../src/game/abilities.js';

// ── ORACLE-ACCPEN-001: Take Cover Applies −2 Accuracy (Not Evade) ──────────
//
// Rule: Take Cover — "Until end of round, apply +1 Block and −2 Accuracy
//        when defending."
// Verifies: resolveAbility sets game.roundDefenseAccuracyPenalty (not roundDefenseBonusEvade)

describe('ORACLE-ACCPEN-001: Take Cover Applies −2 Accuracy (Not Evade)', () => {
  it('001: Take Cover sets roundDefenseAccuracyPenalty, not roundDefenseBonusEvade', () => {
    const game = {};
    const playerNum = 1;
    const result = resolveAbility('Take Cover', { game, playerNum });

    assert.equal(result.applied, true, 'Take Cover should resolve successfully');

    // Must set accuracy penalty
    assert.equal(
      game.roundDefenseAccuracyPenalty?.[playerNum], 2,
      'Take Cover should set roundDefenseAccuracyPenalty[1] = 2'
    );

    // Must NOT set evade bonus
    assert.equal(
      game.roundDefenseBonusEvade?.[playerNum] || 0, 0,
      'Take Cover must NOT set roundDefenseBonusEvade'
    );

    // Must also set block bonus
    assert.equal(
      game.roundDefenseBonusBlock?.[playerNum], 1,
      'Take Cover should still set +1 Block'
    );
  });
});

// ── ORACLE-ACCPEN-002: Deflection Applies −2 Accuracy (Not Evade) ──────────
//
// Rule: Deflection — "Until end of round, apply −2 Accuracy when defending.
//        After the attack is resolved, the attacker suffers 1 Damage."
// Verifies: resolveAbility sets game.roundDefenseAccuracyPenalty (not roundDefenseBonusEvade)
//           AND sets deflectionPending for the counter-damage mechanic.

describe('ORACLE-ACCPEN-002: Deflection Applies −2 Accuracy (Not Evade)', () => {
  it('002: Deflection sets roundDefenseAccuracyPenalty and deflectionPending, not roundDefenseBonusEvade', () => {
    const game = {};
    const playerNum = 2;
    const result = resolveAbility('Deflection', { game, playerNum });

    assert.equal(result.applied, true, 'Deflection should resolve successfully');

    // Must set accuracy penalty
    assert.equal(
      game.roundDefenseAccuracyPenalty?.[playerNum], 2,
      'Deflection should set roundDefenseAccuracyPenalty[2] = 2'
    );

    // Must NOT set evade bonus
    assert.equal(
      game.roundDefenseBonusEvade?.[playerNum] || 0, 0,
      'Deflection must NOT set roundDefenseBonusEvade'
    );

    // Must set deflection counter-damage
    assert.equal(
      game.deflectionPending?.[playerNum], 1,
      'Deflection should set deflectionPending[2] = 1'
    );

    // Must set unconditional flag
    assert.equal(
      game.deflectionUnconditional?.[playerNum], true,
      'Deflection should set deflectionUnconditional[2] = true'
    );
  });
});

// ── ORACLE-ACCPEN-003: Stacking — Both CCs = −4 Accuracy Cumulative ────────
//
// Rule: Round-scoped CC effects accumulate additively. If a player plays
//       Take Cover (−2 Accuracy) AND Deflection (−2 Accuracy) in one round,
//       the combined penalty is −4 Accuracy.

describe('ORACLE-ACCPEN-003: Stacking — Take Cover + Deflection = −4 Accuracy', () => {
  it('003: Both CCs in same round produce cumulative −4 accuracy penalty', () => {
    const game = {};
    const playerNum = 1;

    resolveAbility('Take Cover', { game, playerNum });
    resolveAbility('Deflection', { game, playerNum });

    assert.equal(
      game.roundDefenseAccuracyPenalty?.[playerNum], 4,
      'Combined accuracy penalty should be 2 + 2 = 4'
    );

    // Evade must still be 0
    assert.equal(
      game.roundDefenseBonusEvade?.[playerNum] || 0, 0,
      'Neither CC should contribute to roundDefenseBonusEvade'
    );

    // Block should be 1 (only Take Cover contributes block)
    assert.equal(
      game.roundDefenseBonusBlock?.[playerNum], 1,
      'Only Take Cover contributes +1 Block'
    );
  });
});

// ── ORACLE-ACCPEN-004: Ranged Miss From Accuracy Penalty Alone ─────────────
//
// Rule: "The attack is a miss if the total accuracy is less than the number
//        of spaces to the target." (RULES_REFERENCE.md)
//       defenderAccuracyPenalty reduces totalAccuracy in the formula:
//         totalAccuracy = roll.acc + surgeAcc + bonusAcc − hiddenAccPenalty − defenderAccPenalty
//       If totalAccuracy < distanceToTarget → miss.

describe('ORACLE-ACCPEN-004: Ranged Miss From Accuracy Penalty', () => {
  it('004: accuracy penalty causes miss when total accuracy < distance', () => {
    // Attack roll: 4 accuracy. Distance: 4. Without penalty → hit (4 >= 4).
    // With defenderAccuracyPenalty = 2 → totalAccuracy = 2 < 4 → miss.
    const result = computeCombatResult({
      attackRoll:  { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 4,
      defenderAccuracyPenalty: 2,
    });

    assert.equal(result.hit, false, 'Attack should miss: totalAccuracy 2 < distance 4');
    assert.equal(result.damage, 0, 'Miss should deal 0 damage');
    assert.ok(
      result.resultText.includes('Miss'),
      'Result text should indicate a miss'
    );
  });

  it('004b: same attack WITHOUT penalty would hit', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 4,
    });

    assert.equal(result.hit, true, 'Without penalty: totalAccuracy 4 >= distance 4 → hit');
    assert.equal(result.damage, 2, 'Should deal 3 - 1 = 2 damage');
  });
});

// ── ORACLE-ACCPEN-005: Melee Ignores Accuracy Penalty ──────────────────────
//
// Rule: Melee attacks have no distance check — the accuracy value is irrelevant.
//       Even if defenderAccuracyPenalty is present and would reduce accuracy
//       below 0, the attack still hits (assuming no other miss conditions).

describe('ORACLE-ACCPEN-005: Melee Ignores Accuracy Penalty', () => {
  it('005: melee attack hits despite large accuracy penalty', () => {
    // Melee: acc = 0, defenderAccuracyPenalty = 4 → totalAccuracy = −4.
    // But isRanged is falsy, so no distance check → still hits.
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 5, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      defenderAccuracyPenalty: 4,
    });

    assert.equal(result.hit, true, 'Melee attack should hit regardless of accuracy penalty');
    assert.equal(result.damage, 4, 'Should deal 5 - 1 = 4 damage');
  });
});
