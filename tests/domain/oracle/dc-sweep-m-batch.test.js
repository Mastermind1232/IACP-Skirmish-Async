/**
 * Card-text sweep, M batch: both Loth-cats, both Lukes, MHD-19, Mak Eshka'rey.
 *
 * One defect, and it is the kind that is invisible on a read because the wrong
 * value is a real effect of the card.
 *
 * Mak Eshka'rey's surge band prints ONE surge, "+1 Damage", plus the Critical
 * Hit surge written out in the text box. Our data had "pierce 2" and
 * "critical_hit": no Damage surge at all, and a Pierce 2 surge that does
 * nothing Critical Hit does not already do, since parseSurgeEffect
 * ('critical_hit') sets pierce = 2 itself. So Mak was offered a redundant
 * option and denied the real one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSurgeEffect } from '../../../src/game/combat.js';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();
const rowsFor = (c) => abilitiesForCard(c) || [];

describe("Mak Eshka'rey — the surge is +1 Damage, not a second Pierce 2", () => {
  const MAK = "Mak Eshka'rey";

  test('data has the Damage surge and no bare Pierce surge', () => {
    assert.deepEqual(dc[MAK].surgeAbilities, ['damage 1', 'critical_hit']);
  });

  test('Critical Hit already carries its own Pierce 2', () => {
    // This is why the extra surge was redundant rather than merely wrong.
    const crit = parseSurgeEffect('critical_hit');
    assert.equal(crit.pierce, 2);
    assert.equal(crit.surgeCriticalHit, true);
    assert.deepEqual(parseSurgeEffect('pierce 2').pierce, 2, 'the two would have been indistinguishable');
  });

  test('the spec row follows', () => {
    const rows = rowsFor(MAK);
    const surge = rows.find((r) => /^Surge:/.test(r.ability));
    assert.equal(surge.ability, 'Surge: +1 Damage');
    assert.match(surge.effect, /Spend 1 surge: \+1 Damage/);
    assert.ok(rows.some((r) => r.ability === 'Critical Hit'), 'Critical Hit stays its own row');
  });

  test('its innate band is Priority Target and +1 Accuracy', () => {
    assert.deepEqual(dc[MAK].passives, ['Priority Target']);
    assert.deepEqual(dc[MAK].abilities, ['+1 Accuracy']);
  });
});

describe('the Loth-cats differ only where the cards differ', () => {
  test('Elite gives a generic "?" token, Regular gives a Block token', () => {
    // Two near-identical cards whose one differing badge is easy to copy across.
    assert.match(dc['Loth-cat (Elite)'].abilityText, /Fresh Catch\): You or an adjacent CREATURE gains 1 Power Token\./);
    assert.match(dc['Loth-cat (Regular)'].abilityText, /Rat Catcher\): You or an adjacent CREATURE gains 1 Block Token\./);
  });

  test('the "?" one routes through the four-face prompt', () => {
    // alexanbv 2026-09-02: "? Is always any of the 4." Fresh Catch reaches the
    // shared prompt, which lists all four; nothing narrows it on the way.
    const src = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(src, /const btns = \['Damage', 'Surge', 'Block', 'Evade'\]\.map/);
    const abilities = readFileSync(resolve(root, 'src/game/abilities.js'), 'utf8');
    const branch = abilities.slice(abilities.indexOf("abilityId === 'fresh_catch_lothcat'"));
    assert.match(branch.slice(0, 1200), /pendingPowerTokenGrant/, 'it defers the face choice to the player');
  });

  test('costs, surges and innates match their cards', () => {
    const e = dc['Loth-cat (Elite)'], r = dc['Loth-cat (Regular)'];
    assert.equal(e.cost, 6); assert.equal(e.subCost, 3); assert.equal(e.health, 5); assert.equal(e.speed, 5);
    assert.equal(r.cost, 4); assert.equal(r.subCost, 2); assert.equal(r.health, 3); assert.equal(r.speed, 4);
    assert.deepEqual(e.surgeAbilities, ['damage 2']);
    assert.deepEqual(r.surgeAbilities, ['damage 1']);
    for (const c of [e, r]) assert.deepEqual(c.abilities, ['Curious', 'Pierce 1']);
  });
});

describe('the rest of the batch matches its art', () => {
  test('Luke (Hero of the Rebellion): +1 Block innate, three surges', () => {
    const l = dc['Luke Skywalker'];
    assert.deepEqual(l.abilities, ['Block 1'], '"Block 1" is the established spelling — 14 cards use it');
    assert.deepEqual(l.surgeAbilities, ['damage 2', 'recover 2', 'accuracy 2']);
    assert.equal(l.health, 10);
    assert.equal(l.speed, 5);
  });

  test("and Luke's Block innate lands on the DEFENDER side", async () => {
    // A bare "Block 1" reads like it could be an attack modifier. It is not.
    const { applyDcPassivesToCombat } = await import('../../../src/handlers/combat.js');
    // `dc` here is the RAW file, where Block 1 sits in `abilities`. The loader
    // unions abilities into the runtime `passives` view, so mirror that.
    const innate = [...(dc['Luke Skywalker'].passives || []), ...(dc['Luke Skywalker'].abilities || [])];
    const atk = {}; applyDcPassivesToCombat(atk, innate, [], {});
    const def = {}; applyDcPassivesToCombat(def, [], innate, {});
    assert.deepEqual(atk, {}, 'nothing on the attack side');
    assert.equal(def.bonusBlock, 1);
  });

  test('Luke (Jedi Knight): +1 Damage / +1 Evade innate, Pierce 3 surge', () => {
    const l = dc['Luke Skywalker (Jedi Knight)'];
    assert.deepEqual(l.abilities, ['+1 damage', '+1 Evade']);
    assert.deepEqual(l.surgeAbilities, ['damage 1', 'pierce 3']);
    assert.equal(l.health, 16);
  });

  test('MHD-19: three surges including Recover 2', () => {
    assert.deepEqual(dc['MHD-19'].surgeAbilities, ['damage 1', 'recover 2', 'focus']);
    assert.match(dc['MHD-19'].abilityText, /Medical Loadout\): You or an adjacent friendly figure recovers 3 Damage\./);
  });
});
