/**
 * Card-text sweep, O batch: Nexu (Regular), Obi-Wan Kenobi, Onar Koma,
 * Paz Vizsla, Pit Droid, Probe Droid (Elite).
 *
 * One defect: Onar Koma prints a DASH in his Defense circle and our data gave
 * him a black die — the stronger of the two — on every defence. That is the
 * second dash-defence figure the sweep has found, after Kuiil, and there is no
 * way to detect them except by reading each stat bar.
 *
 * As with Kuiil, the fix is `defense: []` and NOT a deleted field:
 * handlers/combat.js normalises a MISSING defense to ['white'], so dropping the
 * key would have swapped a wrong black die for a wrong white one.
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

describe('Onar Koma has no defence die', () => {
  test('the data matches the printed dash', () => {
    assert.deepEqual(dc['Onar Koma'].defense, [], 'the card prints "—", not a black die');
  });

  test('an EMPTY array, not a missing field', () => {
    assert.ok(Object.prototype.hasOwnProperty.call(dc['Onar Koma'], 'defense'),
      'a missing field is normalised to white, which would still be wrong');
  });

  test('he is on the headless exception list alongside Kuiil', () => {
    const inv = readFileSync(resolve(root, 'tests/headless/data-integrity.test.js'), 'utf8');
    assert.match(inv, /const PRINTS_NO_DEFENSE_DIE = \['Kuiil', 'Onar Koma'\];/);
  });

  test('the rest of his stat line and surges are unchanged', () => {
    const o = dc['Onar Koma'];
    assert.equal(o.cost, 6);
    assert.equal(o.health, 15);
    assert.equal(o.speed, 4);
    assert.deepEqual(o.attack, { dice: ['blue', 'red', 'green'], type: 'range' });
    assert.deepEqual(o.surgeAbilities, ['damage 2, accuracy -2', 'damage 1, accuracy -1']);
    assert.match(o.abilityText, /Immune: You cannot gain HARMFUL conditions\./);
  });

  test('his two surges carry NEGATIVE accuracy, and the parser reads it', async () => {
    // A surge that costs accuracy is unusual enough to be worth pinning: a
    // parser that only matched "+N" would silently drop the penalty.
    const { parseSurgeEffect } = await import('../../../src/game/combat.js');
    assert.equal(parseSurgeEffect('damage 2, accuracy -2').accuracy, -2);
    assert.equal(parseSurgeEffect('damage 2, accuracy -2').damage, 2);
    assert.equal(parseSurgeEffect('damage 1, accuracy -1').accuracy, -1);
  });
});

describe('the rest of the batch matches its art', () => {
  test('Nexu (Regular): Cleave 1 is a SURGE here, where the Elite has Cleave 2 innate', () => {
    // The two Nexu cards put the same keyword in different places, which is the
    // shape that invites copying one onto the other.
    assert.deepEqual(dc['Nexu (Regular)'].surgeAbilities, ['pierce 2', 'cleave 1']);
    assert.deepEqual(dc['Nexu (Regular)'].abilities, ['Bleed']);
    assert.deepEqual(dc['Nexu (Elite)'].abilities, ['Bleed', 'Cleave 2'], 'Elite carries it as an innate');
    assert.deepEqual(dc['Nexu (Elite)'].surgeAbilities, ['damage 2']);
  });

  test('Obi-Wan Kenobi: +1 Evade innate, +2 Damage and Pierce 3 surges', () => {
    assert.deepEqual(dc['Obi-Wan Kenobi'].abilities, ['+1 Evade']);
    assert.deepEqual(dc['Obi-Wan Kenobi'].surgeAbilities, ['damage 2', 'pierce 3']);
    assert.equal(dc['Obi-Wan Kenobi'].health, 12);
  });

  test('Paz Vizsla: TWO Block-token surges, not one', () => {
    // Duplicated entries in a list read like a mistake and are easy to "tidy".
    // His card prints two separate "Gain 1 [Block]" cells.
    assert.deepEqual(dc['Paz Vizsla'].surgeAbilities, ['block token', 'accuracy 1', 'block token']);
    assert.equal(dc['Paz Vizsla'].surgeAbilities.filter((s) => s === 'block token').length, 2);
  });

  test('Probe Droid (Elite): Mobile keyword, three surges', () => {
    assert.deepEqual(dc['Probe Droid (Elite)'].passives, ['Mobile']);
    assert.deepEqual(dc['Probe Droid (Elite)'].surgeAbilities, ['damage 2', 'recover 2', 'pierce 2']);
  });

  test('Pit Droid stays campaign-only, so skirmish ignores it', () => {
    assert.equal(dc['Pit Droid'].campaignOnly, true);
    assert.equal(dc['Pit Droid'].companion, true);
    assert.equal(dc['Pit Droid'].cost, 0);
  });
});
