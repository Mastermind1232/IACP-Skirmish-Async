/**
 * Card-text sweep, P batch: Probe Droid (Regular), Purge Commander (Elite),
 * Purge Trooper (Elite), R2-D2, Rancor, Rebel Pathfinder (Elite).
 *
 * No defects. Pinned anyway, because two entries in it look like missing data
 * and are not:
 *
 *   Purge Trooper (Elite) has NO innate/surge band at all — the art runs
 *   straight into the text box. An empty surgeAbilities reads as an omission
 *   and invites someone to "fill it in".
 *
 *   R2-D2's Lucky adds +1 DODGE, and the glyph sits one line below Service's
 *   "recovers 1 [Damage]". Two different symbols on adjacent lines is exactly
 *   the pairing that has produced drift elsewhere in this sweep.
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

describe('Purge Trooper (Elite) genuinely has no surges', () => {
  test('the card prints no band, so the empty list is correct', () => {
    const p = dc['Purge Trooper (Elite)'];
    assert.ok(!p.surgeAbilities || p.surgeAbilities.length === 0,
      'the art runs straight from illustration to text box — do not fill this in');
    assert.ok(!p.abilities, 'and no innates either');
    assert.ok(!p.passives);
  });

  test('its two abilities are both in specialAbilityIds', () => {
    assert.deepEqual(dc['Purge Trooper (Elite)'].specialAbilityIds,
      ['on_the_hunt', 'imperial_loadout_purge_trooper']);
  });

  test('and it still has a real stat line, so it is not a stub', () => {
    const p = dc['Purge Trooper (Elite)'];
    assert.equal(p.cost, 4);
    assert.equal(p.health, 8);
    assert.deepEqual(p.attack, { dice: ['red', 'green'], type: 'melee' });
    assert.deepEqual(p.defense, ['black']);
  });
});

describe('R2-D2 — Lucky adds a DODGE, not Damage', () => {
  test('the text says Dodge', () => {
    assert.match(dc['R2-D2'].abilityText,
      /Lucky: While defending, if you roll a blank result, add \+1 Dodge to the defense results\./);
  });

  test('Service on the line above uses the Damage symbol, and says Damage', () => {
    assert.match(dc['R2-D2'].abilityText, /recovers 1 Damage\./);
  });

  test('his innate band carries BOTH an accuracy and a surge bonus', () => {
    assert.deepEqual(dc['R2-D2'].abilities, ['+2 Accuracy', '+1 Surge']);
    assert.deepEqual(dc['R2-D2'].surgeAbilities, ['pierce 2', 'stun', 'weaken']);
  });

  test('the +1 Surge innate actually reaches combat', async () => {
    const { applyDcPassivesToCombat } = await import('../../../src/handlers/combat.js');
    const combat = {};
    applyDcPassivesToCombat(combat, dc['R2-D2'].abilities, [], {});
    assert.equal(combat.bonusAccuracy, 2);
    assert.equal(combat.surgeBonus, 1, 'an innate that grants a SURGE, not a surge ability');
  });
});

describe('the rest of the batch matches its art', () => {
  test('Probe Droid (Regular): Mobile, three surges, weaker than the Elite', () => {
    const r = dc['Probe Droid (Regular)'], e = dc['Probe Droid (Elite)'];
    assert.deepEqual(r.surgeAbilities, ['damage 1', 'recover 1', 'pierce 1']);
    assert.deepEqual(e.surgeAbilities, ['damage 2', 'recover 2', 'pierce 2'],
      'each of the Elite values is exactly one higher — a tempting copy target');
    assert.equal(r.speed, 3);
    assert.equal(e.speed, 4);
  });

  test('Purge Commander (Elite): +1 Damage and Pierce 2, no innate band', () => {
    assert.deepEqual(dc['Purge Commander (Elite)'].surgeAbilities, ['damage 1', 'pierce 2']);
    assert.ok(!dc['Purge Commander (Elite)'].abilities);
  });

  test('Rancor: Massive and Reach keywords, Block 1 innate, Cleave 3 surge', () => {
    const r = dc['Rancor'];
    assert.deepEqual(r.passives, ['Massive', 'Reach']);
    assert.deepEqual(r.abilities, ['Block 1']);
    assert.deepEqual(r.surgeAbilities, ['damage 2', 'cleave 3']);
    assert.equal(r.cost, 9);
    assert.equal(r.health, 15);
  });

  test('Rebel Pathfinder (Elite): one blue attack die only', () => {
    // A single-die attack pool looks truncated; it is not.
    assert.deepEqual(dc['Rebel Pathfinder (Elite)'].attack, { dice: ['blue'], type: 'range' });
    assert.deepEqual(dc['Rebel Pathfinder (Elite)'].surgeAbilities, ['accuracy 3', 'damage 2']);
    assert.deepEqual(dc['Rebel Pathfinder (Elite)'].abilities, ['+1 Accuracy']);
  });
});
