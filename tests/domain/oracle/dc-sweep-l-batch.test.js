/**
 * Card-text sweep, L batch. Three defects that changed how figures play.
 *
 * 1. Ko-Tun Feralo and Scout Trooper (Elite) both carried a bare "+3 Accuracy"
 *    in `abilities`, which the loader merges into the runtime `passives` view,
 *    so it applied to every attack. Neither card prints such an innate: their
 *    innate band reads "Professional" alone and the +3 is a SURGE.
 *
 *    Scout Trooper shows how it happened. Its +3 really exists, but it comes
 *    from Find Weakness ("While attacking, apply +3 Accuracy and -1 Evade").
 *    An audit on 2026-06-22 found the Accuracy half missing from the
 *    find_weakness handler and added it — without removing the placeholder
 *    innate that had been standing in for it. The card was then getting +6.
 *
 * 2. Kuiil had a white defence die. The card prints a dash: no defence die at
 *    all. Every defence roll was one die richer than the card allows.
 *
 * 3. Krrsantan's Electrified Knuckledusters is printed "Once during your
 *    activation". Our text and spec row both dropped the limit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';
import { getDcEffects } from '../../../src/data-loader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const raw = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();
const loaded = getDcEffects();
const rowsFor = (c) => abilitiesForCard(c) || [];

describe('the phantom +3 Accuracy innate', () => {
  for (const card of ['Ko-Tun Feralo', 'Scout Trooper (Elite)']) {
    test(`${card}: innate is Professional alone, and +3 Accuracy stays a surge`, () => {
      // Professional moved from `abilities` to `passives` on 2026-09-02
      // (alexanbv: "it is a keyword"), so the innate band is now expressed in
      // the keyword bucket. What matters here is unchanged: no bare +3 Accuracy
      // anywhere in either bucket.
      assert.deepEqual(raw[card].passives, ['Professional']);
      assert.ok(!(raw[card].abilities || []).includes('+3 Accuracy'));
      assert.ok(!(raw[card].passives || []).includes('+3 Accuracy'));
      assert.ok(raw[card].surgeAbilities.includes('accuracy 3'), 'the surge is untouched');
    });

    test(`${card}: no spec row registers it as an attack modifier`, () => {
      const innate = rowsFor(card).find((r) => r.ability === '+3 Accuracy');
      assert.equal(innate, undefined, 'the innate row is gone');
      assert.ok(rowsFor(card).some((r) => r.ability === 'Surge: +3 Accuracy'), 'the surge row remains');
    });
  }

  test('and the runtime passives view no longer carries it', async () => {
    // This is the half that made it bite: the loader unions `abilities` into
    // `passives`, and applyDcPassivesToCombat reads `passives`.
    const { applyDcPassivesToCombat } = await import('../../../src/handlers/combat.js');
    for (const card of ['Ko-Tun Feralo', 'Scout Trooper (Elite)']) {
      const combat = {};
      applyDcPassivesToCombat(combat, loaded[card].passives || [], [], {});
      assert.ok(!combat.bonusAccuracy, `${card} still gets a free +${combat.bonusAccuracy} Accuracy`);
      assert.equal(combat.rerollOneAttackDie, 1, `${card} keeps Professional's single reroll`);
    }
  });

  test("Scout Trooper's real +3 still comes from Find Weakness", () => {
    // Removing the innate must not remove the bonus the card actually grants.
    assert.ok(raw['Scout Trooper (Elite)'].specialAbilityIds.includes('find_weakness'));
    const src = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(src, /id === 'find_weakness'[\s\S]{0,400}bonusAccuracy \|\| 0\) \+ 3/);
    const row = rowsFor('Scout Trooper (Elite)').find((r) => r.ability === 'Find Weakness');
    assert.match(row.effect, /apply \+3 Accuracy and -1 Evade/);
  });

  test('Ko-Tun has no other source of a flat +3, so it is gone for good', () => {
    const text = raw['Ko-Tun Feralo'].abilityText;
    assert.ok(!/\+3 Accuracy/.test(text), 'none of her named abilities grant it');
    assert.deepEqual(raw['Ko-Tun Feralo'].specialAbilityIds,
      ['squad_cohesion_kotun', 'dead_precise_kotun', 'arms_distribution_kotun']);
  });
});

describe('Kuiil has no defence die', () => {
  test('the data matches the printed dash', () => {
    assert.deepEqual(raw['Kuiil'].defense, [], 'the card prints "—", not a white die');
  });

  test('an EMPTY array, not a missing field — the two are not equivalent', () => {
    // handlers/combat.js normalises a missing `defense` to ['white'], so
    // deleting the key would have quietly handed Kuiil the die back.
    assert.ok(Object.prototype.hasOwnProperty.call(raw['Kuiil'], 'defense'));
    const src = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(src, /Array\.isArray\(targetStats\.defense\) \? targetStats\.defense :/,
      'an array passes through as-is; only a non-array falls back to white');
  });

  test('and the defence roll really sums to nothing', async () => {
    const { rollDefenseDice } = await import('../../../src/game/combat.js');
    let block = 0, evade = 0, dodge = 0;
    for (const color of raw['Kuiil'].defense) {
      const r = rollDefenseDice(color);
      block += r.block; evade += r.evade; if (r.dodge) dodge += 1;
    }
    assert.deepEqual({ block, evade, dodge }, { block: 0, evade: 0, dodge: 0 },
      'zero dice means zero results, not a defaulted white die');
  });

  test('the rest of its stat line is unchanged', () => {
    const k = raw['Kuiil'];
    assert.equal(k.health, 8);
    assert.equal(k.speed, 2);
    assert.equal(k.cost, 3);
    assert.deepEqual(k.attack, { dice: ['green', 'yellow'], type: 'range' });
    assert.deepEqual(k.surgeAbilities, ['accuracy 2', 'damage 2', 'stun']);
    assert.deepEqual(k.passives, ['Efficient Travel']);
  });
});

describe('Krrsantan — Electrified Knuckledusters is once per activation', () => {
  test('the printed limit is in the card text', () => {
    assert.match(raw['Krrsantan'].abilityText,
      /Electrified Knuckledusters: Once during your activation, choose an adjacent hostile figure/);
  });

  test('and in the spec row, in the effect AND the limit column', () => {
    const row = rowsFor('Krrsantan').find((r) => r.ability === 'Electrified Knuckledusters');
    assert.match(row.effect, /^Once during your activation,/);
    assert.equal(row.limit, 'once per activation');
  });

  test('the ability library already declared oncePer, which is why this was text-only', () => {
    const lib = JSON.parse(readFileSync(resolve(root, 'data/ability-library.json'), 'utf8')).abilities;
    assert.equal(lib.electrified_knuckledusters.oncePer, 'activation');
  });

  test('the rest of Krrsantan matches', () => {
    const k = raw['Krrsantan'];
    assert.equal(k.health, 15);
    assert.deepEqual(k.abilities, ['Bleed', 'Pierce 1']);
    assert.deepEqual(k.surgeAbilities, ['accuracy 2, pierce 1', 'damage 1']);
  });
});
