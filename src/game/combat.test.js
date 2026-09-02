/**
 * Tests for src/game/combat.js. Run: node --test src/game/combat.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  parseSurgeEffect,
  computeCombatResult,
  SURGE_LABELS,
  rollAttackDice,
  rollDefenseDice,
  rollSingleAttackDie,
  rollSingleDefenseDie,
  recalcAttackTotals,
  recalcDefenseTotals,
  getInnateRerolls,
  getAttackerSurgeAbilities,
} from './combat.js';

const emptyMod = { damage: 0, pierce: 0, accuracy: 0, conditions: [], blast: 0, recover: 0, cleave: 0 };

test('parseSurgeEffect', () => {
  assert.deepStrictEqual(parseSurgeEffect('damage 1'), { ...emptyMod, damage: 1 });
  assert.deepStrictEqual(parseSurgeEffect('damage 2'), { ...emptyMod, damage: 2 });
  assert.deepStrictEqual(parseSurgeEffect('pierce 1'), { ...emptyMod, pierce: 1 });
  assert.deepStrictEqual(parseSurgeEffect('accuracy 2'), { ...emptyMod, accuracy: 2 });
  assert.deepStrictEqual(parseSurgeEffect('stun'), { ...emptyMod, conditions: ['Stun'] });
  assert.deepStrictEqual(parseSurgeEffect('weaken'), { ...emptyMod, conditions: ['Weaken'] });
  assert.deepStrictEqual(parseSurgeEffect('damage 1, stun'), { ...emptyMod, damage: 1, conditions: ['Stun'] });
  assert.deepStrictEqual(parseSurgeEffect('+1 hit'), { ...emptyMod, damage: 1 });
  assert.deepStrictEqual(parseSurgeEffect('+2 hits'), { ...emptyMod, damage: 2 });
  assert.deepStrictEqual(parseSurgeEffect(''), emptyMod);
  assert.deepStrictEqual(parseSurgeEffect(null), emptyMod);
  assert.deepStrictEqual(parseSurgeEffect('blast 1'), { ...emptyMod, blast: 1 });
  assert.deepStrictEqual(parseSurgeEffect('recover 2'), { ...emptyMod, recover: 2 });
  assert.deepStrictEqual(parseSurgeEffect('cleave 1'), { ...emptyMod, cleave: 1 });
});

test('computeCombatResult hit and damage', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 1 },
    defenseRoll: { block: 1, evade: 0 },
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 2); // 3 dmg - 1 block
  assert.strictEqual(r.effectiveBlock, 1);
  assert.ok(r.resultText.includes('2 damage'));
});

test('computeCombatResult evade no longer causes miss (cancels surge instead)', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 0, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 1 },
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
    evadeCancelledSurge: 0,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 5);
});

test('computeCombatResult surge modifiers', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 1, dmg: 2, surge: 1 },
    defenseRoll: { block: 3, evade: 0 },
    surgeDamage: 2,
    surgePierce: 1,
    surgeAccuracy: 0,
  });
  assert.strictEqual(r.hit, true);
  // effectiveBlock = max(0, 3 - 1) = 2; damage = 2 + 2 - 2 = 2
  assert.strictEqual(r.effectiveBlock, 2);
  assert.strictEqual(r.damage, 2);
});

test('computeCombatResult bonusPierce', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 3, evade: 0 },
    bonusPierce: 2,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 2); // 3 dmg - (3 block - 2 pierce) = 3 - 1 = 2
  assert.ok(r.resultText.includes('bonus: +2 pierce'));
});

test('computeCombatResult bonusAccuracy (Deadeye)', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 0, dmg: 2, surge: 0 },
    defenseRoll: { block: 1, evade: 2 },
    bonusAccuracy: 2,
  });
  assert.strictEqual(r.hit, true); // 0 + 2 >= 2
  assert.strictEqual(r.damage, 1); // 2 - 1 block
  assert.ok(r.resultText.includes('bonus: +2 acc'));
});

test('computeCombatResult bonusHits (Beatdown)', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 2, surge: 0 },
    defenseRoll: { block: 2, evade: 0 },
    bonusHits: 1,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 1); // 2 dmg + 1 bonus - 2 block = 1
  // "Damage", not "Hit", per the 2026-08-31 vocabulary ruling.
  assert.ok(r.resultText.includes('bonus: +1 Damage'), r.resultText);
});

test('computeCombatResult a NEGATIVE bonusHits (Gamorrean Guard Regular)', () => {
  // The first card in the database with a printed innate penalty. The log must
  // read "-1", not "+-1", and the penalty must come off the damage.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    bonusHits: -1,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 2, '3 dmg - 1 penalty = 2');
  assert.ok(r.resultText.includes('bonus: -1 Damage'), r.resultText);
  assert.ok(!r.resultText.includes('+-'), 'never renders a doubled sign');
});

test('computeCombatResult a penalty cannot drive damage below zero', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 1, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    bonusHits: -3,
  });
  assert.strictEqual(r.damage, 0, 'clamped at zero');
});

test('computeCombatResult bonusBlock (Brace Yourself)', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 4, surge: 0 },
    defenseRoll: { block: 2, evade: 0 },
    bonusBlock: 2,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.effectiveBlock, 4); // 2 + 2 block
  assert.strictEqual(r.damage, 0); // 4 dmg - 4 block = 0
  assert.ok(r.resultText.includes('bonus: +2 Block'));
});

test('computeCombatResult bonusEvade display and surge cancellation', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 1, dmg: 3, surge: 2 },
    defenseRoll: { block: 0, evade: 0 },
    bonusEvade: 1,
    evadeCancelledSurge: 1,
  });
  assert.strictEqual(r.hit, true);
  assert.ok(r.resultText.includes('bonus: +1 Evade'));
  assert.ok(r.resultText.includes('Evade cancelled 1 surge'));
});

test('computeCombatResult ranged attack miss on insufficient accuracy', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    isRanged: true,
    distanceToTarget: 4,
  });
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.damage, 0);
  assert.ok(/MISS|Miss/.test(r.resultText));
  assert.ok(r.resultText.includes('insufficient accuracy'));
});

test('computeCombatResult ranged attack hit with enough accuracy', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 3, dmg: 4, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    isRanged: true,
    distanceToTarget: 3,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 3);
});

test('computeCombatResult dodge causes miss regardless of damage', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 5, dmg: 10, surge: 3 },
    defenseRoll: { block: 0, evade: 0, dodge: true },
    surgeDamage: 5,
  });
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.damage, 0);
  assert.ok(r.resultText.includes('Dodge'));
});

test('computeCombatResult melee attack ignores accuracy', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 0, dmg: 5, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    isRanged: false,
    distanceToTarget: 1,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 4);
});

test('computeCombatResult surge accuracy saves ranged attack', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 1, dmg: 4, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    isRanged: true,
    distanceToTarget: 3,
    surgeAccuracy: 2,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 4);
});

test('computeCombatResult surge conditions in text', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 1, surge: 1 },
    defenseRoll: { block: 0, evade: 0 },
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
    surgeConditions: ['Stun'],
  });
  assert.strictEqual(r.hit, true);
  assert.ok(r.resultText.includes('Stun'));
});

test('SURGE_LABELS has expected keys', () => {
  assert.ok(Object.keys(SURGE_LABELS).length > 0);
  assert.strictEqual(SURGE_LABELS['damage 1'], '+1 Damage');
  assert.strictEqual(SURGE_LABELS['stun'], 'Stun');
});

test('rollAttackDice returns shape, bounds, and individual dice', () => {
  const r = rollAttackDice(['red', 'green']);
  assert.ok(typeof r.acc === 'number' && r.acc >= 0);
  assert.ok(typeof r.dmg === 'number' && r.dmg >= 0);
  assert.ok(typeof r.surge === 'number' && r.surge >= 0);
  assert.ok(Array.isArray(r.dice));
  assert.strictEqual(r.dice.length, 2);
  assert.strictEqual(r.dice[0].color, 'red');
  assert.strictEqual(r.dice[1].color, 'green');
  const recalc = recalcAttackTotals(r.dice);
  assert.strictEqual(recalc.acc, r.acc);
  assert.strictEqual(recalc.dmg, r.dmg);
  assert.strictEqual(recalc.surge, r.surge);
});

test('rollDefenseDice returns shape with color', () => {
  const r = rollDefenseDice('white');
  assert.ok(typeof r.block === 'number' && r.block >= 0);
  assert.ok(typeof r.evade === 'number' && r.evade >= 0);
  assert.strictEqual(r.color, 'white');
  assert.ok(typeof r.dodge === 'boolean');
});

test('rollAttackDice empty colors', () => {
  const r = rollAttackDice([]);
  assert.strictEqual(r.acc, 0);
  assert.strictEqual(r.dmg, 0);
  assert.strictEqual(r.surge, 0);
  assert.strictEqual(r.dice.length, 0);
});

test('rollSingleAttackDie returns individual result', () => {
  const r = rollSingleAttackDie('blue');
  assert.strictEqual(r.color, 'blue');
  assert.ok(typeof r.acc === 'number');
  assert.ok(typeof r.dmg === 'number');
  assert.ok(typeof r.surge === 'number');
});

test('rollSingleDefenseDie returns individual result', () => {
  const r = rollSingleDefenseDie('white');
  assert.strictEqual(r.color, 'white');
  assert.ok(typeof r.block === 'number');
  assert.ok(typeof r.evade === 'number');
  assert.ok(typeof r.dodge === 'boolean');
});

test('recalcAttackTotals matches rollAttackDice', () => {
  const r = rollAttackDice(['blue', 'red', 'green']);
  const totals = recalcAttackTotals(r.dice);
  assert.strictEqual(totals.acc, r.acc);
  assert.strictEqual(totals.dmg, r.dmg);
  assert.strictEqual(totals.surge, r.surge);
});

test('recalcDefenseTotals aggregates correctly', () => {
  const dice = [
    { color: 'white', block: 1, evade: 0, dodge: false },
    { color: 'black', block: 2, evade: 1, dodge: false },
  ];
  const totals = recalcDefenseTotals(dice);
  assert.strictEqual(totals.block, 3);
  assert.strictEqual(totals.evade, 1);
  assert.strictEqual(totals.dodge, 0);
});

test('recalcDefenseTotals propagates dodge', () => {
  const dice = [
    { color: 'white', block: 0, evade: 0, dodge: true },
    { color: 'black', block: 2, evade: 0, dodge: false },
  ];
  const totals = recalcDefenseTotals(dice);
  assert.strictEqual(totals.dodge, 1);
});

// --- Extended computeCombatResult tests (Pillar 8) ---

test('computeCombatResult Hidden on defender reduces accuracy by 2', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 3, dmg: 4, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    isRanged: true,
    distanceToTarget: 2,
    defenderConds: ['Hide'],
  });
  // acc = 3 - 2 (hidden) = 1, distance = 2, so miss
  assert.strictEqual(r.hit, false);
  assert.ok(r.resultText.includes('Hidden'));
});

test('computeCombatResult Weakened on defender — flag detected, evade penalty applied upstream', () => {
  // destruct 2026-05-07: Weakened reduces SURGE (attacker) and EVADE
  // (defender) by 1, NOT damage and block. The Surge/Evade penalties are
  // applied upstream in handlers/combat.js handleCombatSurge before the
  // evade-cancels-surge calc; computeCombatResult only surfaces the flag
  // in resultText. Block reduction is no longer part of Weakened.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 3, evade: 0 },
    defenderConds: ['Weaken'],
  });
  // No block reduction — effectiveBlock matches the rolled block. Damage =
  // max(0, 5 - 3) = 2. The "Weakened (defender -1 evade)" detail line
  // only fires when the attacker had non-zero surge+evade interaction
  // (handlers/combat.js applies the penalty there).
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.effectiveBlock, 3);
  assert.strictEqual(r.damage, 2);
  assert.ok(r.resultText.includes('Weakened'));
});

test('computeCombatResult Weakened on attacker — flag detected, surge penalty applied upstream', () => {
  // Same architectural change — see test above.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    attackerConds: ['Weaken'],
  });
  // No damage reduction in computeCombatResult — that lived in the OLD
  // (wrong) Weaken impl. damage = max(0, 3 - 1) = 2.
  assert.strictEqual(r.damage, 2);
  assert.ok(r.resultText.includes('Weakened'));
});

test('computeCombatResult Weakened attacker with 0 damage stays at 0', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 1, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    attackerConds: ['Weaken'],
  });
  // damage = 1 - 1 = 0; Weakened doesn't reduce further (penalty is on
  // surge upstream, not on damage).
  assert.strictEqual(r.damage, 0);
});

test('computeCombatResult surgeCancelDodge overrides dodge', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 0, dodge: true },
    surgeCancelDodge: true,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 5);
  // surgeCancelDodge is the blanket cancel (Deadly surge); label now reads "Deadly".
  assert.ok(r.resultText.includes('Deadly'));
});

test('computeCombatResult maxDamageToDefender caps damage', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 10, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    maxDamageToDefender: 3,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 3);
});

test('computeCombatResult defenderIgnorePierce ignores all pierce', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 3, evade: 0 },
    surgePierce: 2,
    bonusPierce: 1,
    defenderIgnorePierce: true,
  });
  // 3 pierce ignored; effectiveBlock stays 3; damage = 3 - 3 = 0
  assert.strictEqual(r.damage, 0);
  assert.strictEqual(r.effectiveBlock, 3);
});

test('computeCombatResult surgeCancel reduces block before pierce', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 4, evade: 0 },
    surgePierce: 1,
    surgeCancel: 2,
  });
  // effectiveBlock = max(0, 4 - 2 cancel - 1 pierce) = 1; damage = 3 - 1 = 2
  assert.strictEqual(r.effectiveBlock, 1);
  assert.strictEqual(r.damage, 2);
});

test('computeCombatResult attackResultReplaceWithStun zeroes damage and adds Stun', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    attackResultReplaceWithStun: true,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 0);
  assert.ok(r.resultText.includes('Set for Stun'));
});

test('computeCombatResult Cunning adds evade as block', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 4, surge: 0 },
    defenseRoll: { block: 1, evade: 2 },
    hasCunning: true,
  });
  // block = 1 + 2 cunning = 3; damage = 4 - 3 = 1
  assert.strictEqual(r.effectiveBlock, 3);
  assert.strictEqual(r.damage, 1);
  assert.ok(r.resultText.includes('Cunning'));
});

test('computeCombatResult Cunning counts bonusEvade (Distracting / evade-token) sources', () => {
  // Defender rolls 1 evade and gains 2 bonus evade (e.g. Distracting + token spend).
  // destruct 2026-05-06: Cunning grants +1 Block per evade from ANY source.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 1, evade: 1 },
    hasCunning: true,
    bonusEvade: 2,
  });
  // block = defRoll.block (1) + bonusBlock (0) + cunning ((1 rolled + 2 bonus) = 3) = 4
  // damage = 5 - 4 = 1
  assert.strictEqual(r.effectiveBlock, 4);
  assert.strictEqual(r.damage, 1);
  assert.ok(r.resultText.includes('Cunning'), 'result mentions Cunning');
  assert.ok(r.resultText.includes('+3 Block'), 'cunning credits 3 block (1 rolled + 2 bonus)');
});

test('computeCombatResult Cunning floors at 0 when bonusEvade negative (Harsh Environment)', () => {
  // Harsh Environment exterior: -1 bonusEvade. With 0 rolled evade, total goes
  // to -1; clamp ensures Cunning contributes 0 block, not -1.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    hasCunning: true,
    bonusEvade: -1,
  });
  // block = 0 + cunning (clamped to 0) + bonusBlock (0) = 0; damage = 3
  assert.strictEqual(r.effectiveBlock, 0);
  assert.strictEqual(r.damage, 3);
});

test('computeCombatResult Cunning under Overwhelming Impact: dropped entirely', () => {
  // OI's ignoreDefenseResultsNotOnDice flag drops the cunningBonus modifier.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 4, surge: 0 },
    defenseRoll: { block: 1, evade: 2 },
    hasCunning: true,
    bonusEvade: 1,
    ignoreDefenseResultsNotOnDice: true,
  });
  // Under OI: blockForCalc = defRoll.block only = 1. damage = 4 - 1 = 3.
  assert.strictEqual(r.effectiveBlock, 1);
  assert.strictEqual(r.damage, 3);
});

test('computeCombatResult bonusDamagePerDefenseDie multiplied by dice count', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 1, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    bonusDamagePerDefenseDie: 1,
    defenseDiceCount: 2,
  });
  // damage = 1 + 1*2 = 3
  assert.strictEqual(r.damage, 3);
});

test('computeCombatResult ignoreDefenseResultsNotOnDice excludes bonusBlock', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    bonusBlock: 3,
    ignoreDefenseResultsNotOnDice: true,
  });
  // bonusBlock is ignored when ignoreDefenseResultsNotOnDice is set
  assert.strictEqual(r.effectiveBlock, 1);
  assert.strictEqual(r.damage, 4);
});

test('computeCombatResult zero damage hit still counts as hit', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 1, surge: 0 },
    defenseRoll: { block: 5, evade: 0 },
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 0);
});

test('computeCombatResult bonusBlast appears in result text', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    bonusBlast: 2,
  });
  assert.ok(r.resultText.includes('bonus: Blast 2'));
});

test('computeCombatResult combined surge blast and bonus blast', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    surgeBlast: 1,
    bonusBlast: 2,
  });
  assert.ok(r.resultText.includes('Blast 3'));
});

// --- 0-0-0 "Shocking Palm" surge: attack MISSES and defender becomes Stunned ---

test('Shocking Palm: attack is a MISS with 0 damage (would-have-dealt-damage case)', () => {
  const combat = { bonusConditions: [] };
  const r = computeCombatResult({
    attackRoll: { acc: 3, dmg: 5, surge: 1 },
    defenseRoll: { block: 0, evade: 0 },
    attackMissAndStun: true,
    bonusConditions: combat.bonusConditions,
  });
  // Real miss — not a 0-damage hit — so on-hit / non-miss triggers see a miss.
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.damage, 0);
  assert.ok(/MISS/.test(r.resultText));
  assert.ok(/Shocking Palm/.test(r.resultText));
  // Stun queued for unconditional step-8 application.
  assert.ok(combat.bonusConditions.includes('Stun'));
});

test('Shocking Palm: MISS + Stun queued even when fully blocked (0 damage anyway)', () => {
  const combat = { bonusConditions: [] };
  const r = computeCombatResult({
    attackRoll: { acc: 3, dmg: 2, surge: 1 },
    defenseRoll: { block: 5, evade: 0 },
    attackMissAndStun: true,
    bonusConditions: combat.bonusConditions,
  });
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.damage, 0);
  assert.ok(combat.bonusConditions.includes('Stun'));
});

// --- parseSurgeEffect extended ---

test('parseSurgeEffect special keys: stun_net, focus, hide', () => {
  // Zuckuss Stun Net is an "-ed"/not-miss surge — routed to noMissConditions (it
  // resolves on a hit even at 0 damage), NOT the damage-gated conditions list.
  assert.deepStrictEqual(parseSurgeEffect('stun_net').noMissConditions, ['Stun']);
  assert.strictEqual(parseSurgeEffect('stun_net').conditions.length, 0);
  assert.strictEqual(parseSurgeEffect('focus').surgeSelfFocus, true);
  assert.strictEqual(parseSurgeEffect('hide').surgeSelfHide, true);
});

test('parseSurgeEffect double-surge prefix stripped', () => {
  const r = parseSurgeEffect('double:damage 2');
  assert.strictEqual(r.damage, 2);
});

test('parseSurgeEffect critical_hit returns pierce 2 + flag', () => {
  const r = parseSurgeEffect('critical_hit');
  assert.strictEqual(r.pierce, 2);
  assert.strictEqual(r.surgeCriticalHit, true);
});

test('parseSurgeEffect deadly_spin returns cleave 3 + -1 dodge (not full cancel)', () => {
  const r = parseSurgeEffect('deadly_spin');
  assert.strictEqual(r.cleave, 3);
  // Deadly Spin is -1 Dodge (counted), routed via surgeDeadlySpinDodge — NOT a
  // blanket surgeCancelDodge (which would cancel ALL dodge regardless of count).
  assert.strictEqual(r.surgeDeadlySpinDodge, true);
  assert.strictEqual(r.surgeCancelDodge, undefined);
});

test('computeCombatResult Deadly Spin -1 Dodge: 1 dodge → hit, 2 dodge → still miss', () => {
  // 1 rolled Dodge minus 1 from Deadly Spin = 0 → hits.
  const r1 = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 0, dodge: 1 },
    surgeDeadlySpinDodge: true,
  });
  assert.strictEqual(r1.hit, true);
  assert.strictEqual(r1.damage, 5);
  // 2 rolled Dodge minus 1 = 1 → still a Dodge miss.
  const r2 = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 0, dodge: 2 },
    surgeDeadlySpinDodge: true,
  });
  assert.strictEqual(r2.hit, false);
});

test('parseSurgeEffect shrapnel returns surgeShrapnel marker, not auto-blast', () => {
  // Drokkatta card text (alexanbv 2026-05-10): "Shrapnel: Choose one:
  // This attack gains Blast 2, or after this attack resolves, if it
  // did not miss, each figure and object within 2 spaces of the
  // target space suffers 1 Damage." The choice is made via the
  // combat_passive_shrapnel_blast / _splash picker after the surge
  // is spent. parseSurgeEffect sets the surgeShrapnel marker so the
  // surge-done gate posts the picker; the chosen effect is applied
  // by handleCombatPassive (Blast 2 → combat.surgeBlast += 2) or
  // queued for after-attack-resolve (Splash → fireShrapnelSplash).
  const r = parseSurgeEffect('shrapnel');
  assert.strictEqual(r.surgeShrapnel, true);
  assert.strictEqual(r.blast, 0);
});

// --- getInnateRerolls ---

test('getInnateRerolls returns zeros for unknown DC', () => {
  const r = getInnateRerolls('NonExistent DC 12345');
  assert.strictEqual(r.attackReroll, 0);
  assert.strictEqual(r.defenseReroll, 0);
});

// ── Innate-passive integration: bonusBlock from passive 'Block 1' lands on
// defense calc, OI gate drops it. (destruct 2026-05-06 priority 1)
test('innate passive Block 1: applied via bonusBlock, dropped under OI', () => {
  // Without OI: bonusBlock counts toward effective block.
  const noOi = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
    bonusBlock: 1, // simulating passive 'Block 1' from Boba/AT-DP/etc.
  });
  // damage = 5 - (1 + 1) = 3
  assert.strictEqual(noOi.damage, 3);
  assert.strictEqual(noOi.effectiveBlock, 2);

  // With OI: bonusBlock dropped, only rolled block counts.
  const oi = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
    bonusBlock: 1,
    ignoreDefenseResultsNotOnDice: true, // OI active
  });
  // damage = 5 - 1 = 4 (passive Block 1 dropped)
  assert.strictEqual(oi.damage, 4);
  assert.strictEqual(oi.effectiveBlock, 1);
});

test('innate passive +1 Hit: bonusHits added to damage', () => {
  // Wampa (E) "+2 Hit", Luke JK / Greedo / Maul / Junk Droid "+1 Hit",
  // etc. — applied via bonusHits.
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 0 },
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
    bonusHits: 1, // simulating innate +1 Damage
  });
  assert.strictEqual(r.damage, 4); // 3 + 1
});

test('getAttackerSurgeAbilities: SU figure uses the SU card SURGES only (innate Bleed is NOT a surge)', () => {
  // The Flame Trooper Squad Upgrade figure → the SU card's OWN surgeAbilities
  // (damage 2 / blast 1). Its Bleed is INNATE (applied every attack via passives),
  // NOT a Surge: Bleed (alexanbv 2026-06-22 "innate bleed like Nexu").
  const su = getAttackerSurgeAbilities({ attackerDcName: 'Stormtrooper', suAttackerCard: 'Flame Trooper' });
  assert.ok(su.includes('damage 2') && su.includes('blast 1'), "uses Flame Trooper's own surges");
  assert.ok(!su.includes('bleed'), 'Bleed is innate, not a surge ability');
  // bonusSurgeAbilities (CC-granted) still append for the SU figure.
  const suBonus = getAttackerSurgeAbilities({ attackerDcName: 'Stormtrooper', suAttackerCard: 'Flame Trooper', bonusSurgeAbilities: ['recover 3'] });
  assert.ok(suBonus.includes('recover 3'));
});

// --- Demoralizing Monologue (Moff Gideon, attacker CC) — die-removal consumer ---
// The attacker forces a reroll of one defense die (index captured by the
// forced-reroll resolver onto combat.demoralizingMonologueDieIndex) and reveals
// 2+ cards (arms combat.demoralizingMonologueRemoveDie). computeCombatResult then
// removes that die's results from the defense aggregate (combat.defenseRoll).

test('Demoralizing Monologue: flag armed + die index removes that die block from defense', () => {
  const combat = {
    attackRoll: { acc: 2, dmg: 4, surge: 0 },
    defenseRoll: { block: 2, evade: 0 }, // 2 block total across the dice
    defenseDiceResults: [{ block: 1, evade: 0 }, { block: 1, evade: 0 }],
    demoralizingMonologueRemoveDie: { casterPlayerNum: 1 },
    demoralizingMonologueDieIndex: 0, // attacker rerolled die #0 (rolled 1 block)
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  };
  const r = computeCombatResult(combat);
  // Die #0's 1 block removed → only 1 block remains → 4 dmg - 1 block = 3.
  assert.strictEqual(r.damage, 3);
  assert.strictEqual(r.effectiveBlock, 1);
  assert.strictEqual(combat.defenseRoll.block, 1, 'defense block reduced by the chosen die');
});

test('Demoralizing Monologue: flag NOT armed leaves defense unchanged', () => {
  const combat = {
    attackRoll: { acc: 2, dmg: 4, surge: 0 },
    defenseRoll: { block: 2, evade: 0 },
    defenseDiceResults: [{ block: 1, evade: 0 }, { block: 1, evade: 0 }],
    // demoralizingMonologueRemoveDie NOT set (revealed < 2 cards)
    demoralizingMonologueDieIndex: 0,
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  };
  const r = computeCombatResult(combat);
  assert.strictEqual(r.damage, 2); // 4 dmg - 2 block, untouched
  assert.strictEqual(combat.defenseRoll.block, 2, 'defense block unchanged');
});

test('Demoralizing Monologue: removes evade and dodge of the chosen die; clamps at 0', () => {
  const combat = {
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 1, dodge: 1 },
    defenseDiceResults: [{ block: 0, evade: 1, dodge: 1 }],
    demoralizingMonologueRemoveDie: { casterPlayerNum: 1 },
    demoralizingMonologueDieIndex: 0,
    surgeCancelDodge: true, // ignore the dodge-miss path; we only assert the totals
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  };
  computeCombatResult(combat);
  assert.strictEqual(combat.defenseRoll.evade, 0, 'evade removed');
  assert.strictEqual(combat.defenseRoll.dodge, 0, 'dodge removed');
});

test('Demoralizing Monologue: idempotent — a second computeCombatResult does not double-subtract', () => {
  const combat = {
    attackRoll: { acc: 2, dmg: 4, surge: 0 },
    defenseRoll: { block: 2, evade: 0 },
    defenseDiceResults: [{ block: 1, evade: 0 }, { block: 1, evade: 0 }],
    demoralizingMonologueRemoveDie: { casterPlayerNum: 1 },
    demoralizingMonologueDieIndex: 0,
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  };
  computeCombatResult(combat);
  const r2 = computeCombatResult(combat);
  assert.strictEqual(combat.defenseRoll.block, 1, 'still only one die removed');
  assert.strictEqual(r2.damage, 3);
});
