/**
 * Gamorrean Guard (Regular) and HK Assassin Droid (Regular).
 *
 * Both had art in the module and NO database entry, so neither could be
 * fielded. alexanbv 2026-09-01: "Regulars are correct. You need to be able to
 * read innate negatives. You need to add all abilities. They are different from
 * elites."
 *
 * The "different from elites" part is the trap. It would have been quick and
 * wrong to clone the Elite entries:
 *
 *   Elite Gamorrean : "Gamorrean Honor GUARD — apply +1 Block"
 *   Regular         : "Gamorrean Honor — you may reroll 1 defense die"
 *
 * plus the Regular has Labored Attack (a Strain-costed reroll) which the Elite
 * does not, and lacks the Elite's Professional. The HK Regular likewise has
 * neither Merciless nor Priority Target.
 *
 * The innate -1 Damage is the other half: the passive parser matched a literal
 * "+" only, so a printed penalty was read by nothing and the figure would have
 * hit harder than its card.
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

describe('Gamorrean Guard (Regular) — printed stats', () => {
  const card = dc['Gamorrean Guard (Regular)'];
  test('exists and is fieldable', () => {
    assert.ok(card, 'entry exists — without it the figure cannot be deployed at all');
  });
  test('cost 6 / 3, distinct from the Elite 7 / 4', () => {
    assert.equal(card.cost, 6);
    assert.equal(card.subCost, 3);
    assert.equal(dc['Gamorrean Guard (Elite)'].cost, 7, 'Elite is unchanged');
  });
  test('Health 5, Speed 4, black defence, melee red+red', () => {
    assert.equal(card.health, 5);
    assert.equal(card.speed, 4);
    assert.deepEqual(card.defense, ['black']);
    assert.deepEqual(card.attack, { dice: ['red', 'red'], type: 'melee' });
  });
  test('Reach, Cleave 1, and the innate -1 Damage', () => {
    assert.deepEqual(card.passives, ['Reach']);
    assert.deepEqual(card.surgeAbilities, ['cleave 1']);
    assert.deepEqual(card.abilities, ['-1 Damage'], 'the penalty is printed and must be recorded');
  });
  test('its abilities are NOT the Elite\'s', () => {
    const elite = dc['Gamorrean Guard (Elite)'];
    assert.ok(/Gamorrean Honor:/.test(card.abilityText), 'Regular has "Gamorrean Honor"');
    assert.ok(/Gamorrean Honor Guard:/.test(elite.abilityText), 'Elite has "Gamorrean Honor Guard"');
    assert.ok(/reroll 1 defense die/.test(card.abilityText), 'Regular rerolls a defence die');
    assert.ok(/apply \+1 Block/.test(elite.abilityText), 'Elite applies +1 Block');
    assert.ok(/Labored Attack:/.test(card.abilityText), 'Labored Attack is Regular-only');
    assert.ok(!/Labored Attack/.test(elite.abilityText));
    assert.ok(!/Professional/.test(card.abilityText), 'Professional is Elite-only');
  });
});

describe('HK Assassin Droid (Regular) — printed stats', () => {
  const card = dc['HK Assassin Droid (Regular)'];
  test('exists and is fieldable', () => {
    assert.ok(card);
  });
  test('cost 8 / 4 — genuinely the same as the Elite', () => {
    // Surprising but both badges read it. Pinned so nobody "corrects" it later.
    assert.equal(card.cost, 8);
    assert.equal(card.subCost, 4);
    assert.equal(dc['HK Assassin Droid (Elite)'].cost, 8);
  });
  test('Health 5, Speed 4, black defence, ranged blue+blue+yellow', () => {
    assert.equal(card.health, 5);
    assert.equal(card.speed, 4);
    assert.deepEqual(card.defense, ['black']);
    assert.deepEqual(card.attack, { dice: ['blue', 'blue', 'yellow'], type: 'range' });
  });
  test('three surges, and NOT the Elite\'s extra abilities', () => {
    assert.deepEqual(card.surgeAbilities, ['weaken', 'damage 1', 'pierce 1']);
    assert.ok(!/Merciless/.test(card.abilityText), 'Merciless is Elite-only');
    assert.deepEqual(card.passives ?? [], [], 'Priority Target is Elite-only');
  });
  test('its Targeting Computer is registered under its own id', () => {
    assert.deepEqual(card.specialAbilityIds, ['targeting_computer_hk_reg']);
  });
});

describe('the Regular abilities actually register', () => {
  // A card entry alone would give two fieldable figures whose abilities do
  // nothing — the failure mode this sweep keeps turning up. The rerolls window
  // is CSV-driven, so the spec rows are what make them real.
  test('Gamorrean Regular has all five spec rows', () => {
    const rows = abilitiesForCard('Gamorrean Guard (Regular)') || [];
    const names = rows.map((r) => r.ability);
    for (const a of ['Reach', '-1 Damage', 'Gamorrean Honor', 'Labored Attack', 'Surge: Cleave 1']) {
      assert.ok(names.includes(a), `missing spec row: ${a}`);
    }
  });

  test('Gamorrean Honor is a DEFENDER-side reroll', () => {
    const row = (abilitiesForCard('Gamorrean Guard (Regular)') || []).find((r) => r.ability === 'Gamorrean Honor');
    assert.equal(row.attack_side, 'defender', 'the defending figure rerolls its own die');
    assert.match(row.effect, /reroll 1 defense die/);
  });

  test('Labored Attack carries its Strain cost', () => {
    const row = (abilitiesForCard('Gamorrean Guard (Regular)') || []).find((r) => r.ability === 'Labored Attack');
    assert.match(row.pipelines, /strain/, 'the pipelines column is what makes the cost bite');
    assert.match(row.effect, /suffer 1 Strain to reroll 1 attack die/);
  });

  test('HK Regular has its five spec rows, including the forced defender reroll', () => {
    const rows = abilitiesForCard('HK Assassin Droid (Regular)') || [];
    const names = rows.map((r) => r.ability);
    for (const a of ['Targeting Computer', 'Versatile Weaponry', 'Surge: +1 Damage', 'Surge: Pierce 1']) {
      assert.ok(names.includes(a), `missing spec row: ${a}`);
    }
    const vw = rows.find((r) => r.ability === 'Versatile Weaponry');
    assert.match(vw.effect, /force the defender to reroll/, 'this phrasing is what flips the pool to defense');
  });
});

describe('innate negatives are readable', () => {
  // Until 2026-09-01 the passive parser matched a literal "+" only, so a
  // printed penalty was silently ignored.
  const src = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');

  test('the damage innate accepts a sign', () => {
    assert.match(src, /const dmg\s*=\s*p\.match\(\/\^\(\[\+-\]\)/, 'damage innate must accept + or -');
  });
  test('the hit and accuracy innates accept a sign too', () => {
    assert.match(src, /const hit\s*=\s*p\.match\(\/\^\(\[\+-\]\)/);
    assert.match(src, /const acc\s*=\s*p\.match\(\/\^\(\[\+-\]\)/);
  });
  test('no innate pattern is still anchored to a bare plus', () => {
    assert.ok(!/p\.match\(\/\^\\\+\(\\d\+\)\\s\+damage\$\//.test(src),
      'the old plus-only damage pattern must be gone');
  });
});
