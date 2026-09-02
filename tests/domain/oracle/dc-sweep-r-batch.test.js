/**
 * Card-text sweep, R batch: both Royal Guards, Royal Guard Champion,
 * SC2-M Repulsor Tank, Sabine Wren, Salacious B. Crumb. No defects.
 *
 * Every stat badge read from the full-resolution card. The comparison tool
 * itself had to be fixed first: it stripped "(Regular)" and matched
 * "Royal Guard (Elite).png" for BOTH Royal Guards, so it was comparing the
 * Regular's data against the Elite's card and calling it a match. It now
 * resolves art strictly and reports ambiguity instead of guessing — a checker
 * that silently checks the wrong thing is worse than no checker.
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

describe('stat badges, read from each card\'s OWN art', () => {
  const expected = {
    'Royal Guard (Elite)':   { dice: ['red', 'yellow'], type: 'melee', def: ['black'], hp: 10, sp: 5 },
    'Royal Guard (Regular)': { dice: ['red', 'yellow'], type: 'melee', def: ['black'], hp: 8,  sp: 5 },
    'Royal Guard Champion':  { dice: ['red', 'green', 'yellow'], type: 'melee', def: ['black', 'white'], hp: 13, sp: 6 },
    'SC2-M Repulsor Tank':   { dice: ['blue', 'red', 'yellow'], type: 'range', def: ['black'], hp: 12, sp: 4 },
    'Sabine Wren':           { dice: ['blue', 'green', 'green'], type: 'range', def: ['white'], hp: 11, sp: 4 },
  };
  for (const [name, e] of Object.entries(expected)) {
    test(`${name}: ${e.dice.join('+')} ${e.type}, ${e.def.join('+')} defence, ${e.hp}hp`, () => {
      assert.deepEqual(dc[name].attack, { dice: e.dice, type: e.type });
      assert.deepEqual(dc[name].defense, e.def);
      assert.equal(dc[name].health, e.hp);
      assert.equal(dc[name].speed, e.sp);
    });
  }

  test('the two Royal Guards differ ONLY in health, which is why the art mixup mattered', () => {
    const el = dc['Royal Guard (Elite)'], rg = dc['Royal Guard (Regular)'];
    assert.deepEqual(el.attack, rg.attack);
    assert.deepEqual(el.defense, rg.defense);
    assert.equal(el.speed, rg.speed);
    assert.notEqual(el.health, rg.health, '10 vs 8 — the one field a wrong-card check would have missed');
  });

  test('Royal Guard Champion rolls TWO defence dice', () => {
    // Unusual enough to look like a duplicate entry.
    assert.equal(dc['Royal Guard Champion'].defense.length, 2);
    assert.deepEqual(dc['Royal Guard Champion'].defense, ['black', 'white']);
  });
});

describe('the Royal Guard line escalates in a specific order', () => {
  test('Regular: Reach only, Stun and Pierce 1', () => {
    assert.deepEqual(dc['Royal Guard (Regular)'].passives, ['Reach']);
    assert.deepEqual(dc['Royal Guard (Regular)'].surgeAbilities, ['stun', 'pierce 1']);
    assert.ok(!dc['Royal Guard (Regular)'].abilities);
  });

  test('Elite adds Professional and an innate Pierce 1, and its Stun surge also grants an Evade token', () => {
    assert.deepEqual(dc['Royal Guard (Elite)'].passives, ['Professional', 'Reach']);
    assert.deepEqual(dc['Royal Guard (Elite)'].abilities, ['Pierce 1']);
    assert.deepEqual(dc['Royal Guard (Elite)'].surgeAbilities, ['stun, evade token', 'damage 2']);
  });

  test('the Elite\'s combo surge parses to BOTH halves', async () => {
    // "stun, evade token" is one surge doing two things; a splitter that
    // dropped either half would be invisible in the data.
    const { parseSurgeEffect } = await import('../../../src/game/combat.js');
    const out = parseSurgeEffect('stun, evade token');
    assert.ok((out.conditions || []).includes('Stun'), `conditions: ${JSON.stringify(out.conditions)}`);
    assert.equal(out.surgeGrantEvade, 1);
  });

  test('Champion carries Bleed as a SURGE, not an innate', () => {
    assert.deepEqual(dc['Royal Guard Champion'].surgeAbilities, ['damage 2', 'bleed', 'pierce 2']);
    assert.deepEqual(dc['Royal Guard Champion'].passives, ['Reach']);
    assert.match(dc['Royal Guard Champion'].abilityText,
      /Overpower: While attacking, you may reroll 1 red die\. While defending, you may reroll 1 black die\./);
  });
});

describe('the rest of the batch', () => {
  test('SC2-M: Massive keyword and a +2 Accuracy innate', () => {
    assert.deepEqual(dc['SC2-M Repulsor Tank'].passives, ['Massive']);
    assert.deepEqual(dc['SC2-M Repulsor Tank'].abilities, ['+2 Accuracy']);
    assert.deepEqual(dc['SC2-M Repulsor Tank'].surgeAbilities, ['damage 2', 'blast 1']);
  });

  test('Sabine Wren: Mobile, and Parting Gift is once per activation', () => {
    assert.deepEqual(dc['Sabine Wren'].passives, ['Mobile']);
    assert.deepEqual(dc['Sabine Wren'].surgeAbilities, ['pierce 2', 'damage 1, blast 1']);
    assert.match(dc['Sabine Wren'].abilityText, /Parting Gift: Once during your activation/);
    const lib = JSON.parse(readFileSync(resolve(root, 'data/ability-library.json'), 'utf8')).abilities;
    assert.equal(lib.parting_gift.oncePer, 'activation', 'and the limit is declared, so the wrapper enforces it');
  });

  test('Salacious B. Crumb is a companion with no attack or defence at all', () => {
    const s = dc['Salacious B. Crumb'];
    assert.equal(s.companion, true);
    assert.ok(!s.attack, 'the card prints a dash for Attack');
    assert.ok(!s.defense);
    assert.equal(s.health, 6);
    assert.equal(s.speed, 3);
  });
});
