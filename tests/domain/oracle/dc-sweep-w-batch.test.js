/**
 * Card-text sweep, W batch: Tusken Raider (Regular), both Ugnaught Tinkerers,
 * Verena Talos, Vinto Hreeda, Wampa (Elite). No defects.
 *
 * One thing raised with alexanbv rather than changed. The Tusken Raider
 * (Regular) art carries a full-width band cell reading "Habitat: Desert" that
 * our data does not record. Three things say that omission is correct:
 *
 *   - the Tusken Raider (ELITE) card, which is IACP-badged, has no such row
 *   - the Regular's image is the pre-IACP FFG printing (smaller, old stat-bar
 *     styling, no IACP banner) — exactly the "older versions still in the
 *     module" case alexanbv described on 2026-09-02
 *   - "Habitat" appears NOWHERE in the codebase, data or spec sheet, so it is
 *     not a mechanic this game models at all
 *
 * Habitat is a campaign concept. Pinned as absent so a later sweep does not
 * "helpfully" add it.
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

describe('Habitat is not a mechanic this game models', () => {
  test('neither Tusken records it', () => {
    for (const n of ['Tusken Raider (Elite)', 'Tusken Raider (Regular)']) {
      assert.ok(!/habitat/i.test(dc[n].abilityText || ''), `${n} text`);
      assert.ok(!/habitat/i.test(JSON.stringify(dc[n])), `${n} entry`);
    }
  });

  test('and no card in the game does', () => {
    const hits = Object.entries(dc)
      .filter(([, v]) => v && typeof v === 'object' && /habitat/i.test(JSON.stringify(v)))
      .map(([k]) => k);
    assert.deepEqual(hits, [], 'if one appears, check it against an IACP-badged card first');
  });

  test('the two Tuskens differ in the ways the cards actually differ', () => {
    assert.deepEqual(dc['Tusken Raider (Elite)'].abilities, ['+1 Damage']);
    assert.ok(!dc['Tusken Raider (Regular)'].abilities, 'the Regular has no innate');
    assert.deepEqual(dc['Tusken Raider (Elite)'].surgeAbilities, ['pierce 1', 'weaken']);
    assert.deepEqual(dc['Tusken Raider (Regular)'].surgeAbilities, ['weaken', 'cleave 1']);
    assert.match(dc['Tusken Raider (Elite)'].abilityText, /Tusken Cycler\).*Apply \+2 Accuracy/s);
    assert.match(dc['Tusken Raider (Regular)'].abilityText, /Tusken Cycler\).*You cannot use abilities during this attack/s);
  });
});

describe('stat badges, read from full-resolution art', () => {
  const expected = {
    'Tusken Raider (Regular)':    { dice: ['red', 'green'], type: 'melee', def: ['black'], hp: 4, sp: 4 },
    'Ugnaught Tinkerer (Elite)':  { dice: ['yellow', 'blue'], type: 'range', def: ['black'], hp: 7, sp: 4 },
    'Ugnaught Tinkerer (Regular)':{ dice: ['blue', 'yellow'], type: 'range', def: ['black'], hp: 4, sp: 4 },
    'Verena Talos':               { dice: ['blue', 'green', 'yellow'], type: 'range', def: ['black'], hp: 11, sp: 4 },
    'Vinto Hreeda':               { dice: ['blue', 'green'], type: 'range', def: ['white'], hp: 8, sp: 5 },
    'Wampa (Elite)':              { dice: ['red', 'red'], type: 'melee', def: ['black'], hp: 12, sp: 3 },
  };
  for (const [name, e] of Object.entries(expected)) {
    test(`${name}: ${e.dice.join('+')} ${e.type}, ${e.hp}hp`, () => {
      assert.deepEqual(dc[name].attack, { dice: e.dice, type: e.type });
      assert.deepEqual(dc[name].defense, e.def);
      assert.equal(dc[name].health, e.hp);
      assert.equal(dc[name].speed, e.sp);
    });
  }

  test('the two Ugnaughts list the same pool in opposite order, which is cosmetic', () => {
    // Both cards print blue+yellow. A dice pool is a multiset, so the order
    // carries no meaning — pinned so nobody "fixes" one to match the other and
    // calls it a data change.
    const e = dc['Ugnaught Tinkerer (Elite)'].attack.dice;
    const r = dc['Ugnaught Tinkerer (Regular)'].attack.dice;
    assert.deepEqual([...e].sort(), [...r].sort());
    assert.notDeepEqual(e, r, 'they are stored in different orders today');
  });
});

describe('the rest of the batch', () => {
  test('both Ugnaughts place the Junk Droid, and only the Elite can Overclock it', () => {
    for (const n of ['Ugnaught Tinkerer (Elite)', 'Ugnaught Tinkerer (Regular)']) {
      assert.ok(dc[n].specialAbilityIds.includes('spot_weld'));
      assert.match(dc[n].abilityText, /Spot Weld\): Place the Junk Droid companion in an adjacent space\./);
    }
    assert.ok(dc['Ugnaught Tinkerer (Elite)'].specialAbilityIds.includes('overclock'));
    assert.ok(!dc['Ugnaught Tinkerer (Regular)'].specialAbilityIds.includes('overclock'));
  });

  test('Verena Talos: +1 Evade innate, fighting_knife as a surge', () => {
    assert.deepEqual(dc['Verena Talos'].abilities, ['+1 Evade']);
    assert.deepEqual(dc['Verena Talos'].surgeAbilities, ['damage 2', 'pierce 1', 'fighting_knife']);
  });

  test('Wampa (Elite): +2 Damage innate plus two keywords', () => {
    assert.deepEqual(dc['Wampa (Elite)'].abilities, ['+2 damage']);
    assert.deepEqual(dc['Wampa (Elite)'].passives, ['Reach', 'Efficient Travel']);
    assert.deepEqual(dc['Wampa (Elite)'].surgeAbilities, ['cleave 3', 'weaken, stun']);
  });

  test("Wampa's lowercase \"+2 damage\" still parses", async () => {
    // The spelling differs from every other card's "+N Damage". The parser is
    // case-insensitive, so this is cosmetic — asserted rather than normalised.
    const { applyDcPassivesToCombat } = await import('../../../src/handlers/combat.js');
    const combat = {};
    applyDcPassivesToCombat(combat, dc['Wampa (Elite)'].abilities, [], {});
    assert.equal(combat.bonusHits, 2);
  });
});
