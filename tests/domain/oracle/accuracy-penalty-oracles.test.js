/**
 * Oracle tests for round accuracy penalties (Take Cover / Deflection).
 *
 * Rule (per-figure registry, alexanbv 2026-06-20):
 *   - Take Cover applies −2 Accuracy to ALL attacks targeting the defender
 *     ("During this round while defending"). Registered as an army-wide defense
 *     descriptor (no figure condition) in game.activeRoundModifiers.
 *   - Deflection applies −2 Accuracy ONLY to a RANGED attack targeting the figure
 *     that played it (CSV "when a Ranged attack targeting you is declared").
 *     Registered with conditions { selfIsSourceFigure, attackType: 'range' } so
 *     Melee attacks and other figures are unaffected.
 *   This is an ACCURACY penalty (affects ranged hit/miss via distance check),
 *   NOT Evade (which cancels surges).
 *
 * Confirmed-safe core:
 *   - Take Cover: +1 Block, −2 Accuracy (all attacks; not +2 Evade)
 *   - Deflection: −2 Accuracy (Ranged-only; not +2 Evade), plus unconditional
 *     1 counter-damage after a Ranged attack
 *   - Accuracy penalty feeds into totalAccuracy formula (combat.js) — can cause ranged miss
 *   - Melee attacks have no distance check — accuracy penalty is cosmetic only
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../../src/game/combat.js';
import { resolveAbility } from '../../../src/game/abilities.js';
import { evaluateRoundModifiers } from '../../../src/game/round-modifiers.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';

// ── ORACLE-ACCPEN-001: Take Cover Applies −2 Accuracy (Not Evade) ──────────
//
// Rule: Take Cover — "Until end of round, apply +1 Block and −2 Accuracy
//        when defending."
// Verifies: resolveAbility registers a Take Cover defense modifier (accuracyPenalty, not evade)

describe('ORACLE-ACCPEN-001: Take Cover Applies −2 Accuracy (Not Evade)', () => {
  it('001: Take Cover registers a +1 Block / −2 Accuracy defense modifier (not Evade)', () => {
    // Per-figure registry (alexanbv 2026-06-20): Take Cover registers an
    // army-wide defense descriptor with block:1 and accuracyPenalty:2.
    const game = {};
    const playerNum = 1;
    const result = resolveAbility('Take Cover', { game, playerNum });

    assert.equal(result.applied, true, 'Take Cover should resolve successfully');

    const d = (game.activeRoundModifiers || []).find(
      (m) => m.card === 'Take Cover' && m.side === 'defense'
    );
    assert.ok(d, 'Take Cover defense descriptor registered');
    assert.equal(d.effect.accuracyPenalty, 2, 'Take Cover applies −2 Accuracy');
    assert.equal(d.effect.block, 1, 'Take Cover still applies +1 Block');
    assert.equal(d.effect.evade || 0, 0, 'Take Cover must NOT apply Evade');
    // Army-wide (CSV "to the results" while defending) — no figure condition.
    assert.deepEqual(d.conditions, {});
  });
});

// ── ORACLE-ACCPEN-002: Deflection Applies −2 Accuracy vs RANGED (Not Evade) ──
//
// Rule: Deflection — CSV "when a Ranged attack targeting you is declared, apply
//        −2 Accuracy" + "after the attack is resolved, the attacker suffers 1
//        Damage". The −2 is Ranged-only, so it lives on the dedicated
//        self-figure, Ranged-only descriptor (NOT the all-attacks Take Cover
//        penalty).
// Verifies: resolveAbility registers a Ranged-only, self-figure Deflection modifier,
//           does NOT touch the shared all-attacks penalty or evade, and sets
//           deflectionPending for the counter-damage mechanic.

describe('ORACLE-ACCPEN-002: Deflection Applies −2 Accuracy vs Ranged (Not Evade)', () => {
  it('002: Deflection registers a Ranged-only, self-figure −2 Accuracy modifier + deflectionPending', () => {
    const game = {};
    const playerNum = 2;
    const result = resolveAbility('Deflection', { game, playerNum });

    assert.equal(result.applied, true, 'Deflection should resolve successfully');

    const d = (game.activeRoundModifiers || []).find(
      (m) => m.card === 'Deflection' && m.side === 'defense'
    );
    assert.ok(d, 'Deflection defense descriptor registered');
    assert.equal(d.effect.accuracyPenalty, 2, 'Deflection applies −2 Accuracy');
    // CSV "when a Ranged attack targeting YOU is declared" → self figure + range.
    assert.equal(d.conditions.selfIsSourceFigure, true);
    assert.equal(d.conditions.attackType, 'range');
    assert.equal(d.effect.evade || 0, 0, 'Deflection must NOT apply Evade');

    // Must set deflection counter-damage (still on its own flags).
    assert.equal(
      game.deflectionPending?.[playerNum], 1,
      'Deflection should set deflectionPending[2] = 1'
    );
    assert.equal(
      game.deflectionUnconditional?.[playerNum], true,
      'Deflection should set deflectionUnconditional[2] = true'
    );
  });
});

// ── ORACLE-ACCPEN-003: Take Cover (all attacks) + Deflection (Ranged-only) ──
//
// Rule: The two penalties live on SEPARATE counters. Against a RANGED attack
//       both apply (effective −4); against a MELEE attack only Take Cover's
//       −2 applies (Deflection's Ranged-only penalty does not).

describe('ORACLE-ACCPEN-003: Take Cover (all) + Deflection (Ranged-only) evaluate per-figure', () => {
  it('003: Take Cover penalty applies to any defender; Deflection only to its self figure vs Ranged', () => {
    // Both played by the same player. Take Cover is army-wide; Deflection is
    // self-figure + Ranged-only. The two descriptors are evaluated per-figure
    // by evaluateRoundModifiers — against the playing figure vs a Ranged attack
    // both apply (effective −4); against a Melee attack only Take Cover's −2.
    const game = { gameId: 'g-accpen', activeRoundModifiers: [] };
    const playerNum = 1;
    // Both CCs anchor on the same activating figure via dcMessageMeta.
    const msgId = 'm-accpen';
    game.dcActionsData = { [msgId]: {} };
    const dcMessageMeta = new Map([[msgId, { gameId: 'g-accpen', playerNum, dcName: 'Greedo', displayName: 'Greedo [Group 1]' }]]);
    // figureKeyForActivation resolves the source figure from the module-global
    // meta registry (registered at startup in production via game-state.js).
    _registerDcMessageMeta(dcMessageMeta);

    resolveAbility('Take Cover', { game, playerNum, dcMessageMeta });
    resolveAbility('Deflection', { game, playerNum, dcMessageMeta });

    const sourceFk = 'Greedo-1-0';
    const otherFk = 'Onar Koma-1-0';

    const evalForRanged = (fk) => evaluateRoundModifiers(game, {
      side: 'defense', figureKey: fk, playerNum, combat: { isRanged: true },
    }).accuracyPenalty;
    const evalForMelee = (fk) => evaluateRoundModifiers(game, {
      side: 'defense', figureKey: fk, playerNum, combat: { isRanged: false },
    }).accuracyPenalty;

    // Source figure vs Ranged: Take Cover (−2) + Deflection (−2) = −4.
    assert.equal(evalForRanged(sourceFk), 4, 'Source figure vs Ranged: combined −4');
    // Source figure vs Melee: only Take Cover (−2); Deflection is Ranged-only.
    assert.equal(evalForMelee(sourceFk), 2, 'Source figure vs Melee: only Take Cover −2');
    // OTHER figure vs Ranged: only Take Cover (army-wide); Deflection is self-only.
    assert.equal(evalForRanged(otherFk), 2, 'Other figure vs Ranged: only Take Cover −2');
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
      /MISS|Miss/.test(result.resultText),
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
