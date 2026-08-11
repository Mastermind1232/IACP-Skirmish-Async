/**
 * Card-data invariants that engine code silently depends on.
 *
 * Each case below corresponds to a live bug caused by data that looked fine but
 * violated an assumption the code makes. These are cheap to assert and
 * impossible to spot by reading a 7000-line JSON file.
 *
 * alexanbv 2026-08-11.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getDcEffects } from '../../src/data-loader.js';

const cards = () => getDcEffects() || {};

describe('card data invariants', () => {
  test('subCost only appears on multi-figure groups', () => {
    // subCost is the cost of a SUB-GROUP, so it is meaningless on a 1-figure
    // card — but several engine sites read `subCost ?? cost`, so a stray value
    // wins and understates the card. Paz Vizsla carried subCost 0 (real cost 7)
    // and Imperial Officer (Elite) carried 2 (real cost 4, which is the
    // REGULAR officer's cost). Consequences: False Orders accepted Paz as a
    // "cost 4 or less" target, Primary Target scored him 0, and Reinforce
    // returned him under a maxFigureCost of 4.
    const bad = Object.entries(cards())
      .filter(([, c]) => c?.subCost != null && (c.figures ?? 1) <= 1)
      .map(([n, c]) => `${n} (cost ${c.cost}, subCost ${c.subCost}, figures ${c.figures ?? 1})`);
    assert.deepEqual(bad, [], `single-figure cards must not carry subCost:\n  ${bad.join('\n  ')}`);
  });

  test('every card with attack dice declares an attack type', () => {
    // Code branches on `attack.type === 'melee'` / `!== 'melee'`. A missing
    // type makes every such test take the non-melee branch by accident.
    // [Flame Trooper] and [Mortar Trooper] were the only two omitting it, which
    // made Pummel tell a Squad Upgrade figure on them that it lacked the MELEE
    // attack type.
    const bad = Object.entries(cards())
      .filter(([, c]) => Array.isArray(c?.attack?.dice) && c.attack.dice.length > 0 && !c.attack.type)
      .map(([n]) => n);
    assert.deepEqual(bad, [], `cards with attack dice but no attack.type:\n  ${bad.join('\n  ')}`);
  });

  test('attack type is one of the known values', () => {
    // 'none' is legitimate — C-3P0 is a Non-Combatant with no real attack.
    const allowed = new Set(['melee', 'range', 'none']);
    const bad = Object.entries(cards())
      .filter(([, c]) => c?.attack?.type && !allowed.has(c.attack.type))
      .map(([n, c]) => `${n} -> ${c.attack.type}`);
    assert.deepEqual(bad, [], `unexpected attack.type values:\n  ${bad.join('\n  ')}`);
  });

  test('companion is either true or a card name that exists', () => {
    // Overloaded field: `true` on a companion's own card, a STRING naming the
    // companion on a host/attachment. A truthy read matches both, which is why
    // Iden Versio and Jarrod Kelvin were classified as companions (0 kill VP,
    // allowed to share spaces, refused on interact).
    const all = cards();
    const bad = [];
    for (const [name, c] of Object.entries(all)) {
      const v = c?.companion;
      if (v === undefined) continue;
      if (v === true) continue;
      if (typeof v === 'string' && all[v]) continue;
      bad.push(`${name} -> ${JSON.stringify(v)}`);
    }
    assert.deepEqual(bad, [], `companion must be true or an existing card name:\n  ${bad.join('\n  ')}`);
  });
});
