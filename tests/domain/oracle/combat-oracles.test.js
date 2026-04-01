/**
 * Oracle tests for computeCombatResult.
 *
 * Each oracle encodes ONE Imperial Assault rule as a deterministic input/output pair.
 * Dice results are given (not rolled) — these are pure-function assertions against
 * the IACP/FFG rulebook. If computeCombatResult produces any other answer, the
 * oracle fails.
 *
 * Condition gating note: computeCombatResult does NOT gate condition application.
 * It always includes surge conditions in resultText for hits, regardless of damage.
 * The G22 condition gating rule (conditions only when damage > 0) is enforced by
 * the handler layer (src/handlers/combat.js), not by this function. A separate
 * handler-level oracle is needed for full G22 coverage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../../src/game/combat.js';

// ── ORACLE-COMBAT-001: Base Damage Formula ──────────────────────────────────
//
// Rule: "The attacker totals damage results, adds any bonus damage, then
//        subtracts the defender's block results (after pierce). Minimum 0."
// Implementation: src/game/combat.js:261
//   damage = hit ? max(0, roll.dmg + surgeD + bonusHits + perDefDieDamage - effectiveBlock) : 0

describe('ORACLE-COMBAT-001: Base Damage Formula', () => {
  it('001a: simple melee — 3 dmg vs 1 block, no modifiers → 2 damage', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
    assert.equal(result.effectiveBlock, 1);
  });

  it('001b: with surge damage — 2 roll + 1 surge dmg vs 1 block → 2 damage', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 4, dmg: 2, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      surgeDamage: 1,
      isRanged: true,
      distanceToTarget: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
    assert.equal(result.effectiveBlock, 1);
  });

  it('001c: block exceeds damage — 1 dmg vs 3 block → 0 damage (floor at 0)', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 1, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 0);
    assert.equal(result.effectiveBlock, 3);
  });

  it('001d: bonusHits included — 2 roll + 1 bonus hit vs 1 block → 2 damage', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      bonusHits: 1,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });
});

// ── ORACLE-COMBAT-002: Zero Damage Foundation ───────────────────────────────
//
// Rule: When total block >= total attack damage, final damage is 0.
//       computeCombatResult still reports hit: true (the attack landed,
//       it was just fully absorbed). This is the prerequisite that condition
//       gating (G22) depends on — the handler checks damage > 0 before
//       applying surge conditions.
//
// NOTE: computeCombatResult itself does NOT gate conditions. It includes
//       surgeConditions in resultText even when damage = 0. The G22 oracle
//       requires handler-level testing (Phase 2).

describe('ORACLE-COMBAT-002: Zero Damage Foundation (Condition Gating Prerequisite)', () => {
  it('002a: fully blocked with surge conditions — hit: true, damage: 0', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 1, surge: 1 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgeDamage: 1,
      surgeConditions: ['Stun'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 0);
    // Conditions ARE in resultText (computeCombatResult does not gate them).
    // Handler must check damage > 0 before applying — that's the G22 rule.
    assert.ok(result.resultText.includes('Stun'), 'resultText includes Stun (gating is handler responsibility)');
  });

  it('002b: exact block equals damage — damage floors to 0', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 0);
    assert.equal(result.effectiveBlock, 2);
  });

  it('002c: attackResultReplaceWithStun — damage > 0 becomes 0, Stun added', () => {
    // Set for Stun (command card): if attack would deal damage, set damage to 0
    // and apply Stun instead. This IS handled in computeCombatResult (line 269).
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      attackResultReplaceWithStun: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 0);
    assert.ok(result.resultText.includes('Set for Stun'));
  });

  it('002d: attackResultReplaceWithStun with 0 damage — no Stun added', () => {
    // If damage was already 0, Set for Stun does nothing (guard: damage > 0)
    const combat = {
      attackRoll:  { acc: 0, dmg: 1, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      attackResultReplaceWithStun: true,
      bonusConditions: [],
    };
    computeCombatResult(combat);
    // bonusConditions should NOT have Stun pushed into it
    assert.ok(!combat.bonusConditions.includes('Stun'), 'Set for Stun does not fire when damage is 0');
  });
});

// ── ORACLE-COMBAT-003: Weakened Modifier Ordering ───────────────────────────
//
// Rules:
//   Defender Weakened: "While defending, apply -1 to your block results."
//   Applied AFTER pierce. (src/game/combat.js:255-258)
//
//   Attacker Weakened: "While attacking, apply -1 to your damage results."
//   Applied AFTER block subtraction, only when damage > 0. (src/game/combat.js:263-265)
//
// The ordering matters: defender-weaken reduces effective block (pre-damage calc),
// attacker-weaken reduces final damage (post-damage calc).

describe('ORACLE-COMBAT-003: Weakened Modifier Ordering', () => {
  it('003a: defender weakened — reduces effective block after pierce', () => {
    // 2 dmg vs 3 block, pierce 1, defender weakened
    // effectiveBlock = max(0, 3 - 0 - 1) = 2, then -1 weaken = max(0, 1) = 1
    // damage = max(0, 2 - 1) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgePierce: 1,
      defenderConds: ['Weaken'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 1);
  });

  it('003b: attacker weakened — reduces damage after block subtraction', () => {
    // 3 dmg vs 1 block, attacker weakened
    // damage = max(0, 3 - 1) = 2, then -1 weaken = max(0, 1) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      attackerConds: ['Weaken'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 1);
  });

  it('003c: attacker weakened can reduce damage to 0', () => {
    // 2 dmg vs 1 block, attacker weakened
    // damage = max(0, 2 - 1) = 1, then -1 weaken = max(0, 0) = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      attackerConds: ['Weaken'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 0);
  });

  it('003d: attacker weakened does NOT apply when damage already 0', () => {
    // 1 dmg vs 3 block, attacker weakened
    // damage = max(0, 1 - 3) = 0, weaken guard (damage > 0) fails → stays 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 1, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      attackerConds: ['Weaken'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 0);
  });

  it('003e: both weakened — defender weaken then attacker weaken in sequence', () => {
    // 3 dmg vs 2 block, both weakened
    // effectiveBlock = max(0, 2 - 0 - 0) = 2, then -1 defender weaken = max(0, 1) = 1
    // damage = max(0, 3 - 1) = 2, then -1 attacker weaken = max(0, 1) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      attackerConds: ['Weaken'],
      defenderConds: ['Weaken'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 1);
  });
});

// ── ORACLE-COMBAT-004: Miss-Path Semantics ──────────────────────────────────
//
// Rules:
//   (a) Dodge: "If the defender rolls a Dodge, the attack misses."
//       Exception: surgeCancelDodge (Deadly Spin) cancels the Dodge.
//   (b) Accuracy: "For ranged attacks, if accuracy < distance, the attack misses."
//       Melee attacks NEVER enter this gate. (Prior audit RNG-03)
//   (c) forceMiss: On the Lam — forced miss regardless of dice.
//
// Implementation: src/game/combat.js:222-242
// These are independent if-branches; each must work in isolation.

describe('ORACLE-COMBAT-004: Miss-Path Semantics', () => {
  it('004a: dodge → miss, damage = 0', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 5, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: true },
    });
    assert.equal(result.hit, false);
    assert.equal(result.damage, 0);
    assert.ok(result.resultText.includes('Dodge'));
  });

  it('004b: ranged accuracy miss — acc 2 vs distance 4', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 2, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 4,
    });
    assert.equal(result.hit, false);
    assert.equal(result.damage, 0);
    assert.ok(result.resultText.includes('insufficient accuracy'));
  });

  it('004c: melee bypasses accuracy gate — acc 0, distance 5 → HIT (RNG-03 oracle)', () => {
    // This is the RNG-03 regression oracle. Melee attacks must NEVER enter
    // the accuracy gate, regardless of rolled accuracy or distance.
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: false,
      distanceToTarget: 5,
    });
    assert.equal(result.hit, true, 'melee attack must hit regardless of accuracy/distance');
    assert.equal(result.damage, 3);
  });

  it('004d: forceMiss (On the Lam) overrides everything', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 10, dmg: 10, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      forceMiss: true,
    });
    assert.equal(result.hit, false);
    assert.equal(result.damage, 0);
    assert.ok(result.resultText.includes('On the Lam'));
  });

  it('004e: surgeCancelDodge (Deadly Spin) cancels dodge → HIT', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: true },
      surgeCancelDodge: true,
    });
    assert.equal(result.hit, true, 'dodge cancelled by surgeCancelDodge');
    assert.equal(result.damage, 2);
  });

  it('004f: ranged hit — acc 4 vs distance 3 → HIT', () => {
    // Positive case: sufficient accuracy for ranged attack
    const result = computeCombatResult({
      attackRoll:  { acc: 4, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });

  it('004g: ranged accuracy exactly equals distance → HIT', () => {
    // Boundary: acc == distance means hit (< is miss, not <=)
    const result = computeCombatResult({
      attackRoll:  { acc: 4, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 4,
    });
    assert.equal(result.hit, true, 'accuracy == distance is a hit, not a miss');
    assert.equal(result.damage, 2);
  });
});

// ── ORACLE-COMBAT-005: Pierce vs Block vs Combat Suit ───────────────────────
//
// Rules:
//   Pierce N: "Reduce the defender's block results by N (min 0)."
//   Combat Suit (defenderReducePierce): "Reduce pierce applied to you by N."
//   defenderIgnorePierce: "Ignore all pierce applied to you."
//   surgeCancel (Kuiil): "Remove N block results from the defender's roll."
//
// Order of operations (src/game/combat.js:244-253):
//   1. Combat Suit reduces pierce: pierceToUse = max(0, totalPierce - reducePierce)
//   2. surgeCancel removes block from roll
//   3. effectiveBlock = max(0, blockForCalc - surgeCancel - pierceToUse)

describe('ORACLE-COMBAT-005: Pierce vs Block vs Combat Suit', () => {
  it('005a: basic pierce — 3 dmg, pierce 2 vs 3 block → 2 damage', () => {
    // effectiveBlock = max(0, 3 - 0 - 2) = 1
    // damage = max(0, 3 - 1) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgePierce: 2,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 2);
  });

  it('005b: Combat Suit reduces pierce — pierce 2, reducePierce 1 → effective pierce 1', () => {
    // pierceToUse = max(0, 2 - 1) = 1
    // effectiveBlock = max(0, 3 - 0 - 1) = 2
    // damage = max(0, 3 - 2) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgePierce: 2,
      defenderReducePierce: 1,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 2);
    assert.equal(result.damage, 1);
  });

  it('005c: defenderIgnorePierce — pierce 3 fully ignored', () => {
    // pierceToUse = 0 (ignore)
    // effectiveBlock = max(0, 3 - 0 - 0) = 3
    // damage = max(0, 3 - 3) = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgePierce: 3,
      defenderIgnorePierce: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 3);
    assert.equal(result.damage, 0);
  });

  it('005d: surgeCancel (Kuiil) removes block before pierce', () => {
    // surgeCancel = 2, pierce = 0
    // effectiveBlock = max(0, 3 - 2 - 0) = 1
    // damage = max(0, 3 - 1) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgeCancel: 2,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 2);
  });

  it('005e: surgeCancel + pierce combined', () => {
    // surgeCancel = 1, pierce = 1
    // effectiveBlock = max(0, 3 - 1 - 1) = 1
    // damage = max(0, 3 - 1) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgeCancel: 1,
      surgePierce: 1,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 2);
  });

  it('005f: pierce exceeds block — effectiveBlock floors to 0', () => {
    // pierce = 3, block = 1
    // effectiveBlock = max(0, 1 - 0 - 3) = 0
    // damage = max(0, 3 - 0) = 3
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      surgePierce: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 0);
    assert.equal(result.damage, 3);
  });
});

// ── ORACLE-COMBAT-006: Hidden (Defender Accuracy Penalty) ───────────────────
//
// Rule: "While attacking a Hidden figure, apply -2 to your accuracy results."
//       Condition string is 'Hide' (not 'Hidden'). (src/game/combat.js:219-220)
//       Only affects ranged attacks via the accuracy gate. Melee is unaffected
//       because melee bypasses the accuracy gate entirely (see ORACLE-004c).

describe('ORACLE-COMBAT-006: Hidden (Defender Accuracy Penalty)', () => {
  it('006a: ranged attack misses due to Hidden penalty — acc 4 vs distance 4, Hidden → miss', () => {
    // totalAccuracy = 4 + 0 + 0 - 2 (hidden) = 2 < 4 → miss
    const result = computeCombatResult({
      attackRoll:  { acc: 4, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 4,
      defenderConds: ['Hide'],
    });
    assert.equal(result.hit, false);
    assert.equal(result.damage, 0);
    assert.ok(result.resultText.includes('insufficient accuracy'));
    assert.ok(result.resultText.includes('Hidden'));
  });

  it('006b: ranged attack hits despite Hidden — acc 6 vs distance 4, Hidden → hit', () => {
    // totalAccuracy = 6 + 0 + 0 - 2 (hidden) = 4 ≥ 4 → hit
    const result = computeCombatResult({
      attackRoll:  { acc: 6, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 4,
      defenderConds: ['Hide'],
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });

  it('006c: melee attack unaffected by Hidden — acc 0, Hidden → still hits', () => {
    // Hidden applies -2 to accuracy (totalAcc = -2), but melee bypasses accuracy gate.
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      isRanged: false,
      distanceToTarget: 1,
      defenderConds: ['Hide'],
    });
    assert.equal(result.hit, true, 'melee ignores accuracy gate even with Hidden penalty');
    assert.equal(result.damage, 2);
  });
});

// ── ORACLE-COMBAT-007: Cunning (Block from Evade) ───────────────────────────
//
// Rule: "While defending, gain +1 Block for each Evade result."
//       (Han Solo, Jyn Odan, Nexu) (src/game/combat.js:248-249)
//       cunningBonus = defRoll.evade when hasCunning is true.
//       Added to blockForCalc alongside rolled block and bonusBlock.
//
// NOTE: The interaction between Cunning and ignoreDefenseResultsNotOnDice is
//       ambiguous (see deferred items). These scenarios test Cunning in
//       isolation and with pierce only — no ambiguous interactions.

describe('ORACLE-COMBAT-007: Cunning (Block from Evade)', () => {
  it('007a: Cunning converts 2 evade into +2 block → fully absorbs attack', () => {
    // cunningBonus = 2, blockForCalc = 1 + 0 + 2 = 3
    // effectiveBlock = 3, damage = max(0, 3 - 3) = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 2, dodge: false },
      hasCunning: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 3);
    assert.equal(result.damage, 0);
    assert.ok(result.resultText.includes('Cunning'));
  });

  it('007b: Cunning with 0 evade — no bonus', () => {
    // cunningBonus = 0, blockForCalc = 1 + 0 + 0 = 1
    // damage = max(0, 3 - 1) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      hasCunning: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 2);
  });

  it('007c: Cunning + pierce — pierce reduces total block including Cunning bonus', () => {
    // cunningBonus = 2, blockForCalc = 1 + 0 + 2 = 3
    // effectiveBlock = max(0, 3 - 0 - 1) = 2 (pierce reduces combined total)
    // damage = max(0, 3 - 2) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 2, dodge: false },
      hasCunning: true,
      surgePierce: 1,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 2);
    assert.equal(result.damage, 1);
  });
});

// ── ORACLE-COMBAT-008: maxDamageToDefender (Damage Cap) ─────────────────────
//
// Rule: "The maximum damage this attack can deal is N."
//       Applied AFTER attacker-weaken. (src/game/combat.js:267)
//       Order: damage calc → attacker weaken → damage cap

describe('ORACLE-COMBAT-008: maxDamageToDefender (Damage Cap)', () => {
  it('008a: damage capped — would be 5, cap is 3 → 3', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      maxDamageToDefender: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 3);
  });

  it('008b: damage below cap — no effect', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      maxDamageToDefender: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });

  it('008c: attacker weakened applies before cap — weaken to 4, then cap to 3', () => {
    // damage = max(0, 5 - 0) = 5
    // attacker weaken: max(0, 5 - 1) = 4
    // cap: 4 > 3 → 3
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: ['Weaken'],
      maxDamageToDefender: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 3);
  });
});

// ── ORACLE-COMBAT-009: Wookiee Avenger (Dodge-to-Evade Conversion) ──────────
//
// Rule: "While defending, convert Dodge results to Evade results."
//       Applied BEFORE the dodge miss check. (src/game/combat.js:230-233)
//       Mutates defenseRoll: sets dodge=false, increments evade by 1.
//       This means the attack does NOT miss from the converted dodge.

describe('ORACLE-COMBAT-009: Wookiee Avenger (Dodge-to-Evade Conversion)', () => {
  it('009a: dodge converted to evade — attack hits instead of missing', () => {
    // Before conversion: dodge=true, evade=0
    // After conversion: dodge=false, evade=1
    // Dodge miss check: defRoll.dodge is false → no miss
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: true },
      wookieeAvengerDefend: true,
    });
    assert.equal(result.hit, true, 'Wookiee Avenger converts dodge → no miss');
    assert.equal(result.damage, 2);
  });

  it('009b: no dodge rolled — Wookiee Avenger is a no-op', () => {
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      wookieeAvengerDefend: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });

  it('009c: dodge + Wookiee Avenger + Cunning — dodge→evade→block', () => {
    // Before: dodge=true, evade=0, block=2
    // Wookiee Avenger: dodge=false, evade=1
    // Cunning: cunningBonus = 1 (from converted evade)
    // blockForCalc = 2 + 0 + 1 = 3
    // effectiveBlock = 3, damage = max(0, 3 - 3) = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: true },
      wookieeAvengerDefend: true,
      hasCunning: true,
    });
    assert.equal(result.hit, true, 'dodge converted, not a miss');
    assert.equal(result.effectiveBlock, 3);
    assert.equal(result.damage, 0, 'converted dodge→evade→Cunning block absorbs all damage');
  });
});

// ── ORACLE-COMBAT-010: bonusBlock ───────────────────────────────────────────
//
// Rule: Bonus block from abilities/tokens is added to effective block alongside
//       rolled block. (src/game/combat.js:252)
//       blockForCalc = defRoll.block + bonusBlock + cunningBonus
//       (when ignoreDefenseResultsNotOnDice is false, which is the default)

describe('ORACLE-COMBAT-010: bonusBlock', () => {
  it('010a: bonusBlock increases effective block — 4 dmg vs 1 rolled + 2 bonus → 1 damage', () => {
    // blockForCalc = 1 + 2 + 0 = 3, effectiveBlock = 3
    // damage = max(0, 4 - 3) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 4, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      bonusBlock: 2,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 3);
    assert.equal(result.damage, 1);
  });

  it('010b: bonusBlock + pierce — pierce reduces combined total', () => {
    // blockForCalc = 1 + 2 + 0 = 3
    // effectiveBlock = max(0, 3 - 0 - 1) = 2
    // damage = max(0, 4 - 2) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 4, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      bonusBlock: 2,
      surgePierce: 1,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 2);
    assert.equal(result.damage, 2);
  });

  it('010c: bonusBlock alone fully absorbs damage — 0 rolled block + 3 bonus vs 2 dmg', () => {
    // blockForCalc = 0 + 3 + 0 = 3, effectiveBlock = 3
    // damage = max(0, 2 - 3) = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      bonusBlock: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 3);
    assert.equal(result.damage, 0);
  });
});

// ── ORACLE-COMBAT-011: perDefDieDamage ──────────────────────────────────────
//
// Rule: bonusDamagePerDefenseDie * defenseDiceCount is added to the ATTACK side
//       of the damage formula. More defense dice = more bonus attack damage.
//       (src/game/combat.js:259-261)
//       defenseDiceCount defaults to 1 when not specified.

describe('ORACLE-COMBAT-011: perDefDieDamage', () => {
  it('011a: 1 bonus per die, 1 defense die (default) → +1 attack damage', () => {
    // perDefDieDamage = 1 * 1 = 1
    // damage = max(0, 2 + 0 + 0 + 1 - 1) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      bonusDamagePerDefenseDie: 1,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });

  it('011b: 1 bonus per die, 2 defense dice → +2 attack damage', () => {
    // perDefDieDamage = 1 * 2 = 2
    // damage = max(0, 2 + 0 + 0 + 2 - 2) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      bonusDamagePerDefenseDie: 1,
      defenseDiceCount: 2,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 2);
  });

  it('011c: bonus overcomes block — 1 dmg + 3 bonus (3 dice) vs 3 block → 1 damage', () => {
    // perDefDieDamage = 1 * 3 = 3
    // damage = max(0, 1 + 0 + 0 + 3 - 3) = 1
    // Without bonus: max(0, 1 - 3) = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 1, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      bonusDamagePerDefenseDie: 1,
      defenseDiceCount: 3,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 1);
  });
});

// ── ORACLE-COMBAT-012: ignoreDefenseResultsNotOnDice ────────────────────────
//
// Rule: "Ignore defense results not on dice" — strips bonusBlock from the
//       block calculation. Rolled block is preserved.
//       (src/game/combat.js:250-252)
//
// NOTE: The interaction with Cunning (hasCunning) is DEFERRED as a rule
//       ambiguity. These scenarios test only the unambiguous bonusBlock
//       stripping behavior.

describe('ORACLE-COMBAT-012: ignoreDefenseResultsNotOnDice (unambiguous)', () => {
  it('012a: bonusBlock stripped — 3 dmg vs 1 rolled + 2 bonus, flag true → bonus ignored', () => {
    // blockForCalc = 1 + 0 (cunningBonus) = 1 (bonusBlock stripped!)
    // effectiveBlock = 1, damage = max(0, 3 - 1) = 2
    // Without flag: blockForCalc = 1 + 2 + 0 = 3, damage = 0
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      bonusBlock: 2,
      ignoreDefenseResultsNotOnDice: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 2);
  });

  it('012b: rolled block preserved — 3 dmg vs 2 rolled block, flag true → block counts', () => {
    // blockForCalc = 2 + 0 = 2 (rolled block kept)
    // effectiveBlock = 2, damage = max(0, 3 - 2) = 1
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      ignoreDefenseResultsNotOnDice: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 2);
    assert.equal(result.damage, 1);
  });

  it('012c: flag + pierce — bonusBlock stripped, pierce reduces remaining rolled block', () => {
    // blockForCalc = 2 + 0 = 2 (bonusBlock 3 stripped)
    // effectiveBlock = max(0, 2 - 0 - 1) = 1
    // damage = max(0, 3 - 1) = 2
    const result = computeCombatResult({
      attackRoll:  { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      bonusBlock: 3,
      surgePierce: 1,
      ignoreDefenseResultsNotOnDice: true,
    });
    assert.equal(result.hit, true);
    assert.equal(result.effectiveBlock, 1);
    assert.equal(result.damage, 2);
  });
});
