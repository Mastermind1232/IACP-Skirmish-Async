/**
 * Card-text sweep, Q batch: both Rebel Saboteurs, both Rebel Troopers, both
 * Riot Troopers. No defects.
 *
 * Re-verified at FULL RESOLUTION after the Rebel Pathfinder miss, where I read
 * a die badge off a downscaled contact sheet, saw one die where the card prints
 * two, and then wrote a test asserting the single die was correct. Prose
 * survives that downscale; a die-colour swatch does not.
 *
 * Rebel Trooper (Elite) is on the do-not-correct list and is left alone: our
 * data carries alexanbv's post-print Get Ready ability and a different Aim
 * condition, neither of which the 12.0 Playtest art shows.
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

describe('stat badges, read from the full-resolution cards', () => {
  const expected = {
    'Rebel Saboteur (Elite)':   { dice: ['red', 'yellow'],  type: 'range', def: ['white'] },
    'Rebel Saboteur (Regular)': { dice: ['red', 'yellow'],  type: 'range', def: ['white'] },
    'Rebel Trooper (Elite)':    { dice: ['blue', 'yellow'], type: 'range', def: ['white'] },
    'Rebel Trooper (Regular)':  { dice: ['blue', 'yellow'], type: 'range', def: ['white'] },
    'Riot Trooper (Elite)':     { dice: ['blue', 'red'],    type: 'melee', def: ['black'] },
    'Riot Trooper (Regular)':   { dice: ['blue', 'red'],    type: 'melee', def: ['black'] },
  };
  for (const [name, e] of Object.entries(expected)) {
    test(`${name}: ${e.dice.join('+')} ${e.type}, ${e.def[0]} defence`, () => {
      assert.deepEqual(dc[name].attack, { dice: e.dice, type: e.type });
      assert.deepEqual(dc[name].defense, e.def);
    });
  }
});

describe('Rebel Saboteur — Overload is what makes the surge list matter', () => {
  test('both variants carry it, and it doubles a surge', () => {
    for (const n of ['Rebel Saboteur (Elite)', 'Rebel Saboteur (Regular)']) {
      assert.ok(dc[n].specialAbilityIds.includes('overload_saboteur'));
      assert.match(dc[n].abilityText, /Overload: You can trigger the same Surge ability up to twice per attack\./);
    }
  });

  test('Overload is wired as a per-surge use cap, not a flat bonus', () => {
    const handlers = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(handlers, /includes\('overload_saboteur'\) \? 2 : 1/);
  });

  test('Elite is strictly stronger, which is the copy-across risk', () => {
    assert.deepEqual(dc['Rebel Saboteur (Elite)'].surgeAbilities, ['stun', 'pierce 2', 'blast 2']);
    assert.deepEqual(dc['Rebel Saboteur (Regular)'].surgeAbilities, ['blast 1', 'pierce 1', 'stun']);
    assert.deepEqual(dc['Rebel Saboteur (Elite)'].abilities, ['+4 Accuracy']);
    assert.deepEqual(dc['Rebel Saboteur (Regular)'].abilities, ['+2 Accuracy']);
  });

  test('only the Elite has Priority Target', () => {
    assert.deepEqual(dc['Rebel Saboteur (Elite)'].passives, ['Priority Target']);
    assert.ok(!(dc['Rebel Saboteur (Regular)'].passives || []).includes('Priority Target'));
  });
});

describe('Rebel Trooper (Elite) keeps its post-print revision', () => {
  test('Get Ready exists in our data and not on the printed art', () => {
    assert.ok(dc['Rebel Trooper (Elite)'].specialAbilityIds.includes('get_ready_rebel_trooper_elite'));
    assert.match(dc['Rebel Trooper (Elite)'].abilityText, /Get Ready: At the start of your activation/);
  });

  test('and its Aim condition differs from the Regular\'s on purpose', () => {
    assert.match(dc['Rebel Trooper (Regular)'].abilityText,
      /Aim: If you have not exited your space during this activation/);
    assert.ok(dc['Rebel Trooper (Elite)'].specialAbilityIds.includes('aim_rebel_trooper_elite'));
  });
});

describe('Riot Trooper — the Elite gains Weaken and Professional', () => {
  test('Elite has both, Regular has neither', () => {
    assert.deepEqual(dc['Riot Trooper (Elite)'].abilities, ['Weaken', 'Stun Batons', 'Shield']);
    assert.deepEqual(dc['Riot Trooper (Elite)'].passives, ['Professional']);
    assert.deepEqual(dc['Riot Trooper (Regular)'].abilities, ['Stun Batons', 'Shield']);
    assert.deepEqual(dc['Riot Trooper (Regular)'].passives, []);
  });

  test('their surge pairs differ by one step', () => {
    assert.deepEqual(dc['Riot Trooper (Elite)'].surgeAbilities, ['damage 1', 'damage 2']);
    assert.deepEqual(dc['Riot Trooper (Regular)'].surgeAbilities, ['damage 1', 'damage 1']);
  });
});
