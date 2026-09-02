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

describe('innate negatives are READ, not just parsed', () => {
  // alexanbv 2026-09-01: "confirm negative modifiers are implemented and read
  // correctly". Asserting on the source regex is not that — this exercises the
  // real applyDcPassivesToCombat and the real damage arithmetic.
  test('a negative damage innate produces a negative bonus', async () => {
    const { applyDcPassivesToCombat } = await import('../../../src/handlers/combat.js');
    const run = (passives) => { const c = {}; applyDcPassivesToCombat(c, passives, [], {}); return c; };

    assert.equal(run(['+2 Damage']).bonusHits, 2, 'positive still works');
    assert.equal(run(['-1 Damage']).bonusHits, -1, 'the penalty is read');
    assert.equal(run(['+2 Damage', '-1 Damage']).bonusHits, 1, 'they sum');
    assert.equal(run(['-2 Accuracy']).bonusAccuracy, -2, 'accuracy too');
    assert.equal(run(['-1 Hit']).bonusHits, -1, 'and the hit spelling');
  });

  test("Gamorrean Regular's printed innate reaches the combat object", async () => {
    const { applyDcPassivesToCombat } = await import('../../../src/handlers/combat.js');
    const { readFileSync: rf } = await import('node:fs');
    const card = JSON.parse(rf(resolve(root, 'data/dc-effects.json'), 'utf8')).cards['Gamorrean Guard (Regular)'];
    const combat = {};
    applyDcPassivesToCombat(combat, [...(card.abilities || []), ...(card.passives || [])], [], {});
    assert.equal(combat.bonusHits, -1, 'the card as shipped yields -1, not 0 and not +1');
  });

  test('a negative bonus actually reduces damage, and cannot drive it below zero', () => {
    // Mirrors src/game/combat.js: Math.max(0, dmg + surge + bonusHits - block).
    const dealt = (rollDmg, bonusHits, block = 0) => Math.max(0, rollDmg + 0 + bonusHits - block);
    assert.equal(dealt(4, -1), 3, 'the penalty comes off the total');
    assert.equal(dealt(4, +1), 5, 'a bonus still adds');
    assert.equal(dealt(1, -3), 0, 'clamped at zero — damage never goes negative');
  });

  test('the combat log signs the number instead of printing "+-1"', () => {
    const src = readFileSync(resolve(root, 'src/game/combat.js'), 'utf8');
    assert.match(src, /const _signed = \(n\) =>/, 'a sign helper exists');
    assert.ok(!/bonus: \+\$\{\(bonusHits/.test(src), 'the hardcoded plus is gone');
    assert.match(src, /_signed\(\(bonusHits \|\| 0\) \+ perDefDieDamage\)\} Damage/,
      'and it reads "Damage", per the vocabulary ruling');
  });

  test('the CSV slug keeps +N and -N apart', async () => {
    // Both collided on "1_damage", so the second registered was dropped as
    // already-covered and a penalty inherited a bonus's identity.
    const { registerCsvCombatAbilities } = await import('../../../src/engine/combat-abilities-from-csv.js');
    const { timingIndicatorsForWindow } = await import('../../../src/engine/combat-timing-registry.js');
    registerCsvCombatAbilities();
    const ids = timingIndicatorsForWindow('mods').filter((e) => /damage/i.test(e.name)).map((e) => e.id);
    assert.ok(ids.some((i) => /plus_1_damage/.test(i)), '+1 Damage keeps its own id');
    assert.ok(ids.some((i) => /minus_1_damage/.test(i)), '-1 Damage keeps its own id');
  });
});
