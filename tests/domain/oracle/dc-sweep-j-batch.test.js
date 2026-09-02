/**
 * Card-text sweep, J batch: Jarrod Kelvin and Jet Trooper (Regular).
 *
 * Two pieces of drift, both of the kind that reads plausibly and plays wrong.
 *
 * 1. Jarrod's third surge was booked as a GENERIC power token, which prompts the
 *    player to pick a face. His card prints the filled badge with the white
 *    four-pointed star — the same badge Cassian Andor's "Gain 2" uses, and our
 *    data calls that one "hit token". Gar Saxon (trefoil) and the 74-Z (circular
 *    arrows) print visibly different badges for their block/evade tokens, so the
 *    three are distinguishable and Jarrod's is unambiguously Damage.
 *
 *    "power token" was used by exactly one card in the whole database, which is
 *    the cheap signal worth checking: a value with a single user is usually a
 *    transcription that never got a second opinion.
 *
 * 2. Jet Trooper (Regular)'s accuracy surge was +3. The card prints +2; +3 is
 *    the ELITE's value, which is what makes the error invisible on a read.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();
const rowsFor = (card) => abilitiesForCard(card) || [];

describe('Jarrod Kelvin — the surge grants a DAMAGE token, not a player choice', () => {
  test('data grants a Damage token', () => {
    assert.deepEqual(dc['Jarrod Kelvin'].surgeAbilities, ['damage 2', 'pierce 2', 'hit token']);
  });

  test('it resolves to a Damage token and NOT to a face prompt', async () => {
    const { parseSurgeEffect } = await import('../../../src/game/combat.js');
    const out = parseSurgeEffect('hit token');
    assert.equal(out.surgeGrantHitToken, 1);
    assert.ok(!out.surgeGrantPowerToken, 'a generic power token would prompt the player to pick a face');
  });

  test('no card is left on the generic "power token" value', () => {
    // If one reappears, its badge should be checked against Cassian's before it
    // is believed: the generic token prints a "?" and this one prints a star.
    const users = Object.entries(dc)
      .filter(([, v]) => v && typeof v === 'object' && (v.surgeAbilities || []).includes('power token'))
      .map(([k]) => k);
    assert.deepEqual(users, []);
  });

  test('its spec row matches, and Droid Master quotes the card exactly', () => {
    const rows = rowsFor('Jarrod Kelvin');
    const tok = rows.find((r) => /token/i.test(r.ability));
    assert.equal(tok.ability, 'Surge: gain 1 Damage token');
    const dm = rows.find((r) => r.ability === 'Droid Master');
    assert.match(dm.effect, /^At the start of the mission,/, 'the card says "the mission", not "a mission"');
    assert.match(dc['Jarrod Kelvin'].abilityText, /Droid Master: At the start of the mission,/);
  });

  test('the innate band is +1 Damage and +1 Evade', () => {
    assert.deepEqual(dc['Jarrod Kelvin'].abilities, ['+1 damage', '+1 Evade']);
  });
});

describe('Jet Trooper (Regular) — +2 Accuracy, not the Elite\'s +3', () => {
  test('the Regular is +2 and the Elite is still +3', () => {
    assert.deepEqual(dc['Jet Trooper (Regular)'].surgeAbilities, ['damage 1', 'accuracy 2']);
    assert.deepEqual(dc['Jet Trooper (Elite)'].surgeAbilities, ['accuracy 3', 'damage 2'],
      'the Elite is unchanged — it is the value the Regular was wrongly copying');
  });

  test('the spec row agrees, in both its name and its effect', () => {
    const row = rowsFor('Jet Trooper (Regular)').find((r) => /Accuracy/.test(r.ability));
    assert.equal(row.ability, 'Surge: +2 Accuracy');
    assert.match(row.effect, /Spend 1 surge: \+2 Accuracy/);
  });

  test('Jets keeps its within-2 condition, in the CSV and in the code', () => {
    // The range clause lives in the `conditional` column, not the effect prose,
    // so reading the effect alone makes it look unconditional. It is not.
    const row = rowsFor('Jet Trooper (Regular)').find((r) => r.ability === 'Jets');
    assert.match(row.conditional, /within 2 spaces/);
    const src = readFileSync(resolve(root, 'src/handlers/after-attack-resolve.js'), 'utf8');
    assert.match(src, /_atkPassives\.includes\('Jets'\) && combat\.distanceToTarget != null && combat\.distanceToTarget <= 2/);
  });
});

describe('the rest of the J batch matches its art', () => {
  test('both Jawa Scavengers: +2 Accuracy innate, +2 Damage / +2 Accuracy surges', () => {
    assert.deepEqual(dc['Jawa Scavenger (Elite)'].surgeAbilities, ['damage 2', 'accuracy 2', 'pierce 2', 'bargain']);
    assert.deepEqual(dc['Jawa Scavenger (Regular)'].surgeAbilities, ['damage 2', 'accuracy 2', 'harass']);
    for (const n of ['Jawa Scavenger (Elite)', 'Jawa Scavenger (Regular)']) {
      assert.deepEqual(dc[n].abilities, ['+2 Accuracy']);
      assert.deepEqual(dc[n].defense, ['white']);
    }
  });

  test('Junk Droid: 1 health, no defence die, +1 Damage innate', () => {
    const j = dc['Junk Droid'];
    assert.equal(j.health, 1);
    assert.equal(j.speed, 4);
    assert.ok(!j.defense || j.defense.length === 0, 'the card prints a dash, not a die');
    assert.deepEqual(j.abilities, ['+1 damage']);
    assert.deepEqual(j.attack, { dice: ['green'], type: 'melee' });
  });
});
