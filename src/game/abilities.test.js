/**
 * Tests for src/game/abilities.js (F1 ability library). Run: node --test src/game/abilities.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import { getAbility, resolveSurgeAbility, getSurgeAbilityLabel } from './abilities.js';

test('getAbility returns library entry for known surge id', () => {
  const entry = getAbility('damage 1');
  assert.ok(entry);
  assert.strictEqual(entry.type, 'surge');
  assert.strictEqual(entry.surgeCost, 1);
  assert.strictEqual(entry.label, '+1 Hit');
  assert.strictEqual(getAbility('stun').label, 'Stun');
});

test('getAbility returns null for unknown id', () => {
  assert.strictEqual(getAbility('unknown_key'), null);
});

test('F13: getAbility supports surgeCost > 1 (multi-surge)', () => {
  const entry = getAbility('damage 4');
  assert.ok(entry);
  assert.strictEqual(entry.surgeCost, 2);
  assert.strictEqual(entry.label, '+4 Hits');
  assert.strictEqual(resolveSurgeAbility('damage 4').damage, 4);
});

test('resolveSurgeAbility returns same shape as parseSurgeEffect', () => {
  const r = resolveSurgeAbility('damage 2');
  assert.strictEqual(r.damage, 2);
  assert.strictEqual(r.pierce, 0);
  assert.strictEqual(r.accuracy, 0);
  assert.deepStrictEqual(r.conditions, []);
  const r2 = resolveSurgeAbility('damage 1, stun');
  assert.strictEqual(r2.damage, 1);
  assert.deepStrictEqual(r2.conditions, ['Stun']);
});

test('getSurgeAbilityLabel uses library when present', () => {
  assert.strictEqual(getSurgeAbilityLabel('damage 1'), '+1 Hit');
  assert.strictEqual(getSurgeAbilityLabel('pierce 2'), 'Pierce 2');
});

test('getSurgeAbilityLabel returns id for unknown (composite or not in library)', () => {
  const label = getSurgeAbilityLabel('some composite key');
  assert.strictEqual(label, 'some composite key');
});
