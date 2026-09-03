/**
 * Card-text sweep, V batch: The Mandalorian, Thrawn, both Trandoshan Hunters,
 * Tress Hacnua, Tusken Raider (Elite). No defects.
 *
 * Thrawn nearly became a false positive. His card prints a DOUBLE-surge cell —
 * two squiggles, "+3 Damage" — and his `surgeAbilities` list is just
 * ["pierce 1"], so the double looked missing. It is not: two-surge-cost
 * abilities live in a SEPARATE `doubleSurgeAbilities` field, which
 * getAttackerSurgeAbilities merges in with a "double:" prefix at attack time.
 *
 * Only three cards in the game use that field, so it is easy to forget it
 * exists and read a card as short an ability. The sweep's comparison tool now
 * prints it alongside the normal surges for exactly that reason.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSurgeEffect, getAttackerSurgeAbilities } from '../../../src/game/combat.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();

describe('double-surge abilities live in their own field', () => {
  test('exactly three cards have one, and Thrawn is one of them', () => {
    const users = Object.entries(dc)
      .filter(([, v]) => v && typeof v === 'object' && v.doubleSurgeAbilities?.length)
      .map(([k, v]) => [k, v.doubleSurgeAbilities]);
    assert.deepEqual(users.sort(), [
      ['General Weiss', ['blast 3']],
      ['Hera Syndulla', ['pierce 2']],
      ['Thrawn', ['damage 3']],
    ]);
  });

  test("Thrawn's +3 Damage reaches the attack pool with a double: prefix", () => {
    const keys = getAttackerSurgeAbilities({ attackerDcName: 'Thrawn' }, dc['Thrawn']);
    assert.deepEqual(keys, ['pierce 1', 'double:damage 3']);
  });

  test('and the prefix is stripped when the effect is parsed', () => {
    assert.equal(parseSurgeEffect('double:damage 3').damage, 3);
  });

  test('the prefix is what makes it cost 2 surges', () => {
    const handlers = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(handlers, /key\?\.startsWith\?\.\('double:'\) \? 2 : \(getAbility\(key\)\?\.surgeCost \?\? 1\)/);
  });
});

describe('stat badges, read from full-resolution art', () => {
  const expected = {
    'The Mandalorian':            { dice: ['blue', 'red', 'green'], type: 'range', def: ['black'], hp: 12, sp: 4 },
    'Thrawn':                     { dice: ['blue', 'green', 'yellow'], type: 'range', def: ['black'], hp: 9, sp: 4 },
    'Trandoshan Hunter (Elite)':  { dice: ['blue', 'green'], type: 'range', def: ['black'], hp: 8, sp: 4 },
    'Trandoshan Hunter (Regular)':{ dice: ['blue', 'green'], type: 'range', def: ['black'], hp: 6, sp: 4 },
    'Tress Hacnua':               { dice: ['green', 'yellow', 'red'], type: 'melee', def: ['white'], hp: 10, sp: 5 },
    'Tusken Raider (Elite)':      { dice: ['red', 'green'], type: 'melee', def: ['black'], hp: 7, sp: 4 },
  };
  for (const [name, e] of Object.entries(expected)) {
    test(`${name}: ${e.dice.join('+')} ${e.type}, ${e.hp}hp`, () => {
      assert.deepEqual(dc[name].attack, { dice: e.dice, type: e.type });
      assert.deepEqual(dc[name].defense, e.def);
      assert.equal(dc[name].health, e.hp);
      assert.equal(dc[name].speed, e.sp);
    });
  }
});

describe('the rest of the batch', () => {
  test('The Mandalorian: a Block-token surge and a combo surge', () => {
    assert.deepEqual(dc['The Mandalorian'].surgeAbilities,
      ['damage 2', 'block token', 'accuracy 2, pierce 1']);
    assert.deepEqual(dc['The Mandalorian'].abilities, ['Beskar Armor']);
  });

  test('Tress Hacnua: four surges, two of them with an X value', () => {
    // "X equals the number of Surge rolled" — a variable payload is unusual
    // enough that a literal "X" in the data reads like a placeholder.
    assert.deepEqual(dc['Tress Hacnua'].surgeAbilities,
      ['damage 1, weaken', 'cleave X', 'recover X', 'damage 1, stun']);
    assert.match(dc['Tress Hacnua'].abilityText,
      /Krayt Dragon Fury: While attacking, X equals the number of Surge rolled\./);
  });

  test('the two Trandoshan Hunters differ in Hardy and their scattergun', () => {
    assert.deepEqual(dc['Trandoshan Hunter (Elite)'].abilities, ['Hardy']);
    assert.ok(!dc['Trandoshan Hunter (Regular)'].abilities);
    assert.match(dc['Trandoshan Hunter (Elite)'].abilityText, /ACP Scattergun: .*apply \+2 Damage/);
    assert.match(dc['Trandoshan Hunter (Regular)'].abilityText, /Scattergun: .*apply \+1 Damage/);
  });

  test('Tusken Raider (Elite): +1 Damage innate, Pierce 1 and Weaken surges', () => {
    assert.deepEqual(dc['Tusken Raider (Elite)'].abilities, ['+1 Damage']);
    assert.deepEqual(dc['Tusken Raider (Elite)'].surgeAbilities, ['pierce 1', 'weaken']);
  });
});
