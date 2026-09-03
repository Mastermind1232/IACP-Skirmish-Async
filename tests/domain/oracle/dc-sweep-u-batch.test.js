/**
 * Card-text sweep, U batch: Super Commando (Elite), Taron Malicos, Tauntaun
 * Rider, The Armorer, The Child, The Grand Inquisitor. No defects.
 *
 * Tauntaun Rider is the first card to exercise the corrected art preference:
 * the module holds "Tauntaun Rider [IACP].png", and the resolver now reaches
 * for the bracketed IACP revision before a plain filename. alexanbv 2026-09-02:
 * "you should always read the iacp version if possible."
 *
 * The Armorer is on the do-not-correct list; its data was checked against the
 * 12.0 Playtest art and happens to agree, but the list still governs.
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
    'Super Commando (Elite)': { dice: ['green', 'yellow'], type: 'range', def: ['black'], hp: 7, sp: 4 },
    'Taron Malicos':          { dice: ['red', 'red'], type: 'melee', def: ['black'], hp: 11, sp: 4 },
    'Tauntaun Rider':         { dice: ['blue', 'green'], type: 'range', def: ['black'], hp: 10, sp: 4 },
    'The Armorer':            { dice: ['green', 'green', 'green'], type: 'melee', def: ['black'], hp: 11, sp: 4 },
    'The Grand Inquisitor':   { dice: ['red', 'green', 'yellow'], type: 'melee', def: ['white'], hp: 15, sp: 5 },
  };
  for (const [name, e] of Object.entries(expected)) {
    test(`${name}: ${e.dice.join('+')} ${e.type}, ${e.def[0]} defence`, () => {
      assert.deepEqual(dc[name].attack, { dice: e.dice, type: e.type });
      assert.deepEqual(dc[name].defense, e.def);
      assert.equal(dc[name].health, e.hp);
      assert.equal(dc[name].speed, e.sp);
    });
  }

  test('The Grand Inquisitor is the only one rolling WHITE', () => {
    // 15 health behind a white die is an unusual pairing and reads like a typo.
    assert.deepEqual(dc['The Grand Inquisitor'].defense, ['white']);
    assert.equal(dc['The Grand Inquisitor'].health, 15);
  });

  test('The Child has neither attack nor an innate band', () => {
    const c = dc['The Child'];
    assert.ok(!c.attack, 'the card prints a dash for Attack');
    assert.deepEqual(c.defense, ['white']);
    assert.ok(!c.surgeAbilities);
    assert.equal(c.cost, 0);
  });
});

describe('Super Commando (Elite) carries four separate innates', () => {
  test('two are keywords and two are stat mods', () => {
    // Professional moved to the keyword bucket earlier in this sweep.
    assert.deepEqual(dc['Super Commando (Elite)'].passives, ['Professional', 'Mobile']);
    assert.deepEqual(dc['Super Commando (Elite)'].abilities, ['+2 Accuracy', 'Pierce 1']);
  });

  test('its two limited abilities both declare oncePer', () => {
    const lib = JSON.parse(readFileSync(resolve(root, 'data/ability-library.json'), 'utf8')).abilities;
    assert.deepEqual(dc['Super Commando (Elite)'].specialAbilityIds, ['jetpack_rocket', 'shield_gauntlets']);
    assert.equal(lib.jetpack_rocket.oncePer, 'round', 'printed "Once per figure per round"');
    assert.equal(lib.shield_gauntlets.oncePer, 'activation');
  });
});

describe('the rest of the batch', () => {
  test('Taron Malicos: +1 Surge innate, Bleed as a surge', () => {
    assert.deepEqual(dc['Taron Malicos'].abilities, ['+1 Surge']);
    assert.deepEqual(dc['Taron Malicos'].surgeAbilities, ['pierce 3', 'damage 2', 'bleed']);
  });

  test('Tauntaun Rider: Mounted is a named ability, Efficient Travel a keyword', () => {
    assert.deepEqual(dc['Tauntaun Rider'].abilities, ['Mounted', 'Pierce 1']);
    assert.deepEqual(dc['Tauntaun Rider'].passives, ['Efficient Travel']);
    assert.deepEqual(dc['Tauntaun Rider'].surgeAbilities, ['damage 2', 'accuracy 3, damage 1']);
    assert.match(dc['Tauntaun Rider'].abilityText, /Mounted: At the start of your activation, gain 3 movement points\./);
  });

  test('The Armorer: three green dice and a Block-token surge', () => {
    assert.deepEqual(dc['The Armorer'].surgeAbilities, ['damage 1, pierce 1', 'cleave 2', 'block token']);
    assert.deepEqual(dc['The Armorer'].abilities, ['Beskar Armor']);
    assert.deepEqual(dc['The Armorer'].passives, ['Mobile']);
  });

  test('The Grand Inquisitor: no innate band, deadly_spin as a surge', () => {
    assert.deepEqual(dc['The Grand Inquisitor'].surgeAbilities, ['pierce 3', 'damage 2', 'deadly_spin']);
    assert.ok(!dc['The Grand Inquisitor'].abilities);
    assert.ok(!dc['The Grand Inquisitor'].passives);
  });
});
