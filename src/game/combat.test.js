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
  assert.ok(r.resultText.includes('bonus: +1 Hit'));
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
  assert.strictEqual(totals.dodge, false);
});

test('recalcDefenseTotals propagates dodge', () => {
  const dice = [
    { color: 'white', block: 0, evade: 0, dodge: true },
    { color: 'black', block: 2, evade: 0, dodge: false },
  ];
  const totals = recalcDefenseTotals(dice);
  assert.strictEqual(totals.dodge, true);
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

test('computeCombatResult Weakened on defender reduces block by 1', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 5, surge: 0 },
    defenseRoll: { block: 3, evade: 0 },
    defenderConds: ['Weaken'],
  });
  // effectiveBlock = max(0, 3 - 1) = 2; damage = 5 - 2 = 3
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.effectiveBlock, 2);
  assert.strictEqual(r.damage, 3);
  assert.ok(r.resultText.includes('Weakened'));
});

test('computeCombatResult Weakened on attacker reduces damage by 1', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    attackerConds: ['Weaken'],
  });
  // damage = 3 - 1 block = 2, then -1 weaken = 1
  assert.strictEqual(r.damage, 1);
  assert.ok(r.resultText.includes('Weakened'));
});

test('computeCombatResult Weakened attacker with 0 damage stays at 0', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 1, surge: 0 },
    defenseRoll: { block: 1, evade: 0 },
    attackerConds: ['Weaken'],
  });
  // damage = 1 - 1 = 0, weaken doesn't apply below 0
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
  assert.ok(r.resultText.includes('Deadly Spin'));
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

// --- parseSurgeEffect extended ---

test('parseSurgeEffect special keys: stun_net, focus, hide', () => {
  assert.deepStrictEqual(parseSurgeEffect('stun_net').conditions, ['Stun']);
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

test('parseSurgeEffect deadly_spin returns cleave 3 + cancel dodge', () => {
  const r = parseSurgeEffect('deadly_spin');
  assert.strictEqual(r.cleave, 3);
  assert.strictEqual(r.surgeCancelDodge, true);
});

test('parseSurgeEffect shrapnel returns blast 2', () => {
  const r = parseSurgeEffect('shrapnel');
  assert.strictEqual(r.blast, 2);
});

// --- getInnateRerolls ---

test('getInnateRerolls returns zeros for unknown DC', () => {
  const r = getInnateRerolls('NonExistent DC 12345');
  assert.strictEqual(r.attackReroll, 0);
  assert.strictEqual(r.defenseReroll, 0);
});
