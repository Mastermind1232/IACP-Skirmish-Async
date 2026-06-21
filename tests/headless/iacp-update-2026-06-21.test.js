/**
 * IACP 2026-06-21 card-update behavioral tests (alexanbv).
 *
 *   1. [Mortar Trooper] — innate +1 Accuracy (was +2), Surge: +2 Damage,
 *      Surge: +2 Accuracy.
 *   2. Guidance Systems ([Mortar Trooper]) — LIMIT once per attack (gate
 *      ability no longer re-offers after one use this attack).
 *   3. The Armorer — HP increased 10 → 11.
 *   4. 74-Z Speeder Bike — Forward Mounted Blasters "same row" means same LINE
 *      (same row OR same column / horizontal OR vertical).
 *
 * Classification: harness (asserts production data + the gate ability gating).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects } from '../../src/data-loader.js';
import '../../src/engine/combat-abilities-mods.js'; // self-registers mods-window abilities
import { abilitiesForWindow } from '../../src/engine/combat-timing-registry.js';

const dc = getDcEffects();
const at = (side, g, c, d) => abilitiesForWindow('mods', side, g, c, d);

describe('IACP 2026-06-21: data changes', () => {
  it('[Mortar Trooper] has innate +1 Accuracy (not +2) and the two surge abilities', () => {
    const mt = dc['[Mortar Trooper]'];
    assert.ok(mt, '[Mortar Trooper] present');
    assert.ok(mt.abilities.includes('+1 Accuracy'), 'innate +1 Accuracy');
    assert.ok(!mt.abilities.includes('+2 Accuracy'), 'no innate +2 Accuracy');
    assert.deepEqual(mt.surgeAbilities, ['accuracy 2', 'damage 2'], 'Surge: +2 Accuracy / +2 Damage');
  });

  it('The Armorer HP is 11', () => {
    assert.equal(dc['The Armorer'].health, 11);
  });

  it('74-Z Forward Mounted Blasters ability text references same line (row OR column)', () => {
    const txt = dc['74-Z Speeder Bike (Elite)'].abilityText;
    assert.match(txt, /Forward Mounted Blasters/);
    assert.match(txt, /same row or column/i);
  });
});

describe('IACP 2026-06-21: Guidance Systems once per attack', () => {
  const KEY = '[Mortar Trooper]:Guidance Systems';
  const baseGame = (extra = {}) => ({ p1DcAttachments: { m: ['[Mortar Trooper]'] }, ...extra });
  const baseCombat = (extra = {}) => ({ attackerMsgId: 'm', attackRoll: { dmg: 3 }, ...extra });
  const find = (list, id) => list.find((a) => a.id === id);
  const deps = { getDcEffects: () => dc, getMapData: () => ({}) };

  it('offered once, then NOT re-offered after it is used this attack', () => {
    const g = baseGame();
    const c = baseCombat();
    assert.ok(find(at('attacker', g, c, deps), 'guidance_systems'), 'offered first time');
    const cUsed = baseCombat({ _abilityUsedThisAttack: { [KEY]: true } });
    assert.equal(find(at('attacker', g, cUsed, deps), 'guidance_systems'), undefined, 'not re-offered once used');
  });

  it('an unrelated per-attack mark does NOT block it', () => {
    const g = baseGame();
    const cOther = baseCombat({ _abilityUsedThisAttack: { 'Something Else:Foo': true } });
    assert.ok(find(at('attacker', g, cOther, deps), 'guidance_systems'), 'still offered');
  });
});
