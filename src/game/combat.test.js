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

test('computeCombatResult miss', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 0, dmg: 5, surge: 0 },
    defenseRoll: { block: 0, evade: 1 },
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
  });
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.damage, 0);
  assert.ok(r.resultText.includes('Miss'));
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
  assert.ok(r.resultText.includes('CC bonus: +2 pierce'));
});

test('computeCombatResult bonusAccuracy (Deadeye)', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 0, dmg: 2, surge: 0 },
    defenseRoll: { block: 1, evade: 2 },
    bonusAccuracy: 2,
  });
  assert.strictEqual(r.hit, true); // 0 + 2 >= 2
  assert.strictEqual(r.damage, 1); // 2 - 1 block
  assert.ok(r.resultText.includes('CC bonus: +2 acc'));
});

test('computeCombatResult bonusHits (Beatdown)', () => {
  const r = computeCombatResult({
    attackRoll: { acc: 2, dmg: 2, surge: 0 },
    defenseRoll: { block: 2, evade: 0 },
    bonusHits: 1,
  });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.damage, 1); // 2 dmg + 1 bonus - 2 block = 1
  assert.ok(r.resultText.includes('CC bonus: +1 Hit'));
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
  assert.ok(r.resultText.includes('CC bonus: +2 Block'));
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
  assert.strictEqual(SURGE_LABELS['damage 1'], '+1 Hit');
  assert.strictEqual(SURGE_LABELS['stun'], 'Stun');
});

test('rollAttackDice returns shape and bounds', () => {
  const r = rollAttackDice(['red']);
  assert.ok(typeof r.acc === 'number' && r.acc >= 0);
  assert.ok(typeof r.dmg === 'number' && r.dmg >= 0);
  assert.ok(typeof r.surge === 'number' && r.surge >= 0);
});

test('rollDefenseDice returns shape', () => {
  const r = rollDefenseDice('white');
  assert.ok(typeof r.block === 'number' && r.block >= 0);
  assert.ok(typeof r.evade === 'number' && r.evade >= 0);
});

test('rollAttackDice empty colors', () => {
  const r = rollAttackDice([]);
  assert.strictEqual(r.acc, 0);
  assert.strictEqual(r.dmg, 0);
  assert.strictEqual(r.surge, 0);
});
