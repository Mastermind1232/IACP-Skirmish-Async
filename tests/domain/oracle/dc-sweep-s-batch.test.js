/**
 * Card-text sweep, S batch: Saska Teft, Saw Gerrera, Scout Trooper (Elite),
 * Second Sister, both Sentry Droids.
 *
 * One defect: Saw Gerrera's card prints THREE surges and our data had two. The
 * missing one was "+2 Accuracy", so every attack he made was short an option.
 *
 * It is worth recording why this one was believed where [Flame Trooper]'s six
 * were not. Saw's card matched us on everything else — cost, health, speed,
 * both dice, defence die, all three innates, both text abilities — and
 * disagreed on exactly one line. A single isolated mismatch is usually a real
 * defect; a cluster of independent ones usually means the local art is stale.
 * Both readings were confirmed by alexanbv the same day.
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

describe('Saw Gerrera has three surges, not two', () => {
  test('the +2 Accuracy surge is present', () => {
    assert.deepEqual(dc['Saw Gerrera'].surgeAbilities, ['damage 2', 'accuracy 2', 'hide']);
  });

  test('the spec sheet has a row for it', () => {
    const rows = (abilitiesForCard('Saw Gerrera') || []).filter((r) => /^Surge:/.test(r.ability));
    assert.deepEqual(rows.map((r) => r.ability).sort(),
      ['Surge: +2 Accuracy', 'Surge: +2 Damage', 'Surge: you become Hidden']);
  });

  test('his innate +2 Accuracy is a SEPARATE thing from the surge', () => {
    // Both exist on the card, which is what makes the missing surge easy to
    // overlook: grep for "+2 Accuracy" and the innate answers for it.
    assert.deepEqual(dc['Saw Gerrera'].abilities, ['Brutal Tactics', '+2 Accuracy', '+1 Surge']);
    const innate = (abilitiesForCard('Saw Gerrera') || []).find((r) => r.ability === '+2 Accuracy');
    assert.ok(innate, 'the innate row still exists too');
    assert.match(innate.effect, /Apply \+2 Accuracy to the attack results/);
  });

  test('the rest of his card was already right', () => {
    const s = dc['Saw Gerrera'];
    assert.equal(s.cost, 4);
    assert.equal(s.health, 7);
    assert.equal(s.speed, 4);
    assert.deepEqual(s.attack, { dice: ['blue', 'red'], type: 'range' });
    assert.deepEqual(s.defense, ['black']);
  });
});

describe('the rest of the batch matches its art', () => {
  test('Saska Teft: three COMBO surges, no single-effect ones', () => {
    assert.deepEqual(dc['Saska Teft'].surgeAbilities,
      ['damage 1, pierce 1', 'damage 2, accuracy 1', 'weaken, stun']);
    assert.deepEqual(dc['Saska Teft'].abilities, ['+2 Accuracy']);
  });

  test('Scout Trooper (Elite): the phantom +3 Accuracy stays gone', () => {
    // Removed earlier in this sweep; its band prints "Professional" alone.
    assert.deepEqual(dc['Scout Trooper (Elite)'].passives, ['Professional']);
    assert.ok(!dc['Scout Trooper (Elite)'].abilities);
    assert.deepEqual(dc['Scout Trooper (Elite)'].surgeAbilities,
      ['accuracy 3', 'damage 2', 'pierce 1, weaken']);
  });

  test('Second Sister: +1 Surge innate, Mastery as a surge', () => {
    assert.deepEqual(dc['Second Sister'].abilities, ['+1 Surge']);
    assert.deepEqual(dc['Second Sister'].surgeAbilities, ['pierce 3', 'damage 2', 'mastery']);
    assert.deepEqual(dc['Second Sister'].attack, { dice: ['red', 'yellow'], type: 'melee' });
  });

  test('the two Sentry Droids differ only in accuracy and dice', () => {
    const e = dc['Sentry Droid (Elite)'], r = dc['Sentry Droid (Regular)'];
    assert.deepEqual(e.surgeAbilities, ['damage 1', 'pierce 2', 'accuracy 2']);
    assert.deepEqual(r.surgeAbilities, ['damage 1', 'pierce 2', 'accuracy 1']);
    assert.deepEqual(e.attack, { dice: ['green', 'green', 'yellow'], type: 'range' });
    assert.deepEqual(r.attack, { dice: ['green', 'green'], type: 'range' });
    for (const c of [e, r]) assert.ok(!c.abilities && !c.passives, 'neither has an innate band');
  });
});
