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

test('parseSurgeEffect', () => {
  assert.deepStrictEqual(parseSurgeEffect('damage 1'), { damage: 1, pierce: 0, accuracy: 0, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect('damage 2'), { damage: 2, pierce: 0, accuracy: 0, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect('pierce 1'), { damage: 0, pierce: 1, accuracy: 0, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect('accuracy 2'), { damage: 0, pierce: 0, accuracy: 2, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect('stun'), { damage: 0, pierce: 0, accuracy: 0, conditions: ['Stun'] });
  assert.deepStrictEqual(parseSurgeEffect('weaken'), { damage: 0, pierce: 0, accuracy: 0, conditions: ['Weaken'] });
  assert.deepStrictEqual(parseSurgeEffect('damage 1, stun'), { damage: 1, pierce: 0, accuracy: 0, conditions: ['Stun'] });
  assert.deepStrictEqual(parseSurgeEffect('+1 hit'), { damage: 1, pierce: 0, accuracy: 0, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect('+2 hits'), { damage: 2, pierce: 0, accuracy: 0, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect(''), { damage: 0, pierce: 0, accuracy: 0, conditions: [] });
  assert.deepStrictEqual(parseSurgeEffect(null), { damage: 0, pierce: 0, accuracy: 0, conditions: [] });
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
