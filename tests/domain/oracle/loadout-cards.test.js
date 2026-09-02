/**
 * Loadout cards: where Purge Trooper's surges actually come from.
 *
 * alexanbv 2026-09-02: "purge trooper surges come from the LOADOUT card.
 * Confirm you understand how loadout cards work."
 *
 * Purge Trooper (Elite) prints NO surge band. Its card reads "Imperial Loadout:
 * When you are deployed, gain 1 Loadout card from the supply", and the Loadout
 * card carries the surges. So an empty `surgeAbilities` on the Deployment Card
 * is correct by design, not missing data — and filling it in would double the
 * figure's surge options once a Loadout is attached.
 *
 * A Loadout contributes four separate things, and all four are wired:
 *
 *   surgeKeys   pushed onto combat.bonusSurgeAbilities when the attack is built
 *   postAttack  stored as combat.loadoutPostAttack and fired after the attack
 *   passive     Electrostaff grants Reach, read by the adjacency check
 *   abilityText shown to the player on the attached card embed
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLoadoutCards, getDcEffects } from '../../../src/data-loader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const loadouts = getLoadoutCards();
const dc = getDcEffects();

describe('the Deployment Card carries no surges on purpose', () => {
  test('Purge Trooper (Elite) has none, and says why in its own text', () => {
    const p = dc['Purge Trooper (Elite)'];
    assert.ok(!p.surgeAbilities || p.surgeAbilities.length === 0);
    assert.match(p.abilityText, /Imperial Loadout: When you are deployed, gain 1 Loadout card from the supply\./);
    assert.ok(p.specialAbilityIds.includes('imperial_loadout_purge_trooper'));
  });

  test('every Loadout supplies surges of its own', () => {
    assert.deepEqual(Object.keys(loadouts).sort(), ['Electrobatons', 'Electrohammer', 'Electrostaff']);
    for (const [name, card] of Object.entries(loadouts)) {
      assert.ok(Array.isArray(card.surgeKeys) && card.surgeKeys.length >= 2, `${name} has surgeKeys`);
    }
  });

  test('their surge counts differ, so the choice matters', () => {
    assert.deepEqual(loadouts.Electrobatons.surgeKeys, ['damage 1', 'pierce 2', 'deadly']);
    assert.deepEqual(loadouts.Electrohammer.surgeKeys, ['damage 2', 'pierce 2']);
    assert.deepEqual(loadouts.Electrostaff.surgeKeys, ['damage 1', 'pierce 2']);
  });

  test('and every surge key is one the parser understands', async () => {
    // A typo here would silently give the figure a dead surge button.
    const { parseSurgeEffect } = await import('../../../src/game/combat.js');
    for (const [name, card] of Object.entries(loadouts)) {
      for (const k of card.surgeKeys) {
        const out = parseSurgeEffect(k);
        const meaningful = out.damage || out.pierce || out.accuracy || out.conditions?.length
          || Object.keys(out).some((f) => f.startsWith('surge'));
        assert.ok(meaningful, `${name}: "${k}" parses to nothing: ${JSON.stringify(out)}`);
      }
    }
  });
});

describe('all four contributions are wired', () => {
  const handlers = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
  const actions = readFileSync(resolve(root, 'src/engine/available-actions.js'), 'utf8');

  test('surgeKeys reach the attack pool', () => {
    assert.match(handlers, /if \(_loadoutCard\?\.surgeKeys\) game\.pendingCombat\.bonusSurgeAbilities\.push\(\.\.\._loadoutCard\.surgeKeys\);/);
  });

  test('postAttack is stored for the after-attack window', () => {
    assert.match(handlers, /if \(_loadoutCard\?\.postAttack\) game\.pendingCombat\.loadoutPostAttack = _loadoutCard\.postAttack;/);
    for (const n of ['flurry_of_blows', 'electro_pulse', 'quick_strike']) {
      assert.ok(Object.values(loadouts).some((c) => c.postAttack === n), `${n} is a real postAttack`);
    }
  });

  test("Electrostaff's Reach is read by the adjacency check", () => {
    assert.equal(loadouts.Electrostaff.passive, 'Reach');
    assert.match(actions, /getLoadoutCards\(\)\?\.\[_loadoutName\]\?\.passive === 'Reach'/);
    assert.ok(!loadouts.Electrobatons.passive, 'the other two grant no passive');
    assert.ok(!loadouts.Electrohammer.passive);
  });

  test('the chosen Loadout is per-figure, not per-card', () => {
    // Two Purge Troopers in one group can carry different Loadouts.
    assert.match(handlers, /getConfig\(game, attackerFigureKey\)\?\.loadout/);
  });

  test('each Loadout has card art to show the player', () => {
    for (const [name, card] of Object.entries(loadouts)) {
      assert.match(card.imagePath || '', /dc-supplemental\/IACP_Loadout Card--/, `${name} image`);
      assert.ok(card.abilityText, `${name} abilityText`);
    }
  });
});
