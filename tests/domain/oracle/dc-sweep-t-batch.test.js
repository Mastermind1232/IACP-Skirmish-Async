/**
 * Card-text sweep, T batch: Shoretrooper (Elite), Shyla Varad, both
 * Snowtroopers, both Stormtroopers. No defects.
 *
 * Four of the six are Trooper cards that share the SAME Squad Training text and
 * the same blue+green pool, differing only in surge values and health. That is
 * the densest copy-across risk the sweep has hit, so each one's distinguishing
 * values are pinned rather than the set being spot-checked.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();

describe('stat badges, read from full-resolution art', () => {
  const expected = {
    'Shoretrooper (Elite)':   { dice: ['red', 'green'], type: 'range', hp: 7, sp: 5 },
    'Shyla Varad':            { dice: ['green', 'green', 'yellow'], type: 'melee', hp: 12, sp: 4 },
    'Snowtrooper (Elite)':    { dice: ['blue', 'green', 'yellow'], type: 'range', hp: 7, sp: 4 },
    'Snowtrooper (Regular)':  { dice: ['blue', 'green'], type: 'range', hp: 4, sp: 4 },
    'Stormtrooper (Elite)':   { dice: ['blue', 'green'], type: 'range', hp: 5, sp: 4 },
    'Stormtrooper (Regular)': { dice: ['blue', 'green'], type: 'range', hp: 3, sp: 4 },
  };
  for (const [name, e] of Object.entries(expected)) {
    test(`${name}: ${e.dice.join('+')} ${e.type}, ${e.hp}hp`, () => {
      assert.deepEqual(dc[name].attack, { dice: e.dice, type: e.type });
      assert.equal(dc[name].health, e.hp);
      assert.equal(dc[name].speed, e.sp);
      assert.deepEqual(dc[name].defense, ['black'], 'all six roll black');
    });
  }
});

describe('the four Troopers share text and differ in values', () => {
  test('three of them carry the identical Squad Training sentence', () => {
    const line = /Squad Training: While attacking, while adjacent to another friendly TROOPER, you may reroll 1 attack die\./;
    assert.match(dc['Shoretrooper (Elite)'].abilityText, line);
    assert.match(dc['Stormtrooper (Regular)'].abilityText, line);
    // The Stormtrooper Elite's wording drops "While attacking," — pinned as-is
    // rather than normalised, since the card is the authority on its own text.
    assert.match(dc['Stormtrooper (Elite)'].abilityText,
      /Squad Training: While adjacent to another friendly TROOPER, you may reroll 1 attack die\./);
  });

  test('but each registers its own ability id, so they cannot share state', () => {
    assert.deepEqual(dc['Shoretrooper (Elite)'].specialAbilityIds, ['squad_training_shoretrooper_elite']);
    assert.deepEqual(dc['Stormtrooper (Elite)'].specialAbilityIds, ['squad_training_stormtrooper_elite']);
    assert.deepEqual(dc['Stormtrooper (Regular)'].specialAbilityIds, ['squad_training_stormtrooper_reg']);
  });

  test('their surge sets are all different', () => {
    assert.deepEqual(dc['Shoretrooper (Elite)'].surgeAbilities, ['accuracy 2', 'damage 2']);
    assert.deepEqual(dc['Stormtrooper (Elite)'].surgeAbilities, ['accuracy 3', 'damage 2']);
    assert.deepEqual(dc['Stormtrooper (Regular)'].surgeAbilities, ['damage 1', 'accuracy 2']);
    assert.deepEqual(dc['Snowtrooper (Regular)'].surgeAbilities, ['weaken', 'accuracy 2', 'pierce 1']);
  });

  test('only the Shoretrooper has an innate accuracy bonus', () => {
    assert.deepEqual(dc['Shoretrooper (Elite)'].abilities, ['+2 Accuracy']);
    assert.deepEqual(dc['Shoretrooper (Elite)'].passives, ['Efficient Travel']);
    assert.deepEqual(dc['Stormtrooper (Elite)'].abilities, ['Last Stand'], 'a named ability, not a stat mod');
    assert.ok(!dc['Stormtrooper (Regular)'].abilities);
    assert.ok(!dc['Snowtrooper (Regular)'].abilities);
  });
});

describe('the two non-Trooper-pattern cards', () => {
  test('Snowtrooper (Elite): three figures, two COMBO surges, Efficient Travel', () => {
    const s = dc['Snowtrooper (Elite)'];
    assert.equal(s.figures, 3);
    assert.deepEqual(s.surgeAbilities, ['accuracy 2, damage 1', 'damage 1, weaken', 'focus']);
    assert.deepEqual(s.passives, ['Efficient Travel']);
    assert.match(s.abilityText, /Spiked Boots: You cannot be pushed out of your space except by/);
  });

  test('Shyla Varad: +1 Evade innate and a Cleave surge', () => {
    assert.deepEqual(dc['Shyla Varad'].abilities, ['+1 Evade']);
    assert.deepEqual(dc['Shyla Varad'].surgeAbilities, ['damage 2', 'pierce 2', 'cleave 2']);
    assert.match(dc['Shyla Varad'].abilityText, /Mandalorian Whip\): Choose a SMALL, hostile figure within 3 spaces/);
  });
});
