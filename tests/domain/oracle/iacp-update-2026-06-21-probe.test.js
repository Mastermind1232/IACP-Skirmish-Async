/**
 * PROBE-IACP-2026-06-21: the 7 alexanbv balance-revision card changes.
 * Pins the data/contract surface for each finalized card so future drift is loud.
 *
 *  1. Bo-Katan Kryze — Beskar Armor keyword (2 Block AFTER DEPLOYMENT) PLUS
 *     Dual-Wield Pistols grants 2 Block BEFORE her bonus ranged attack
 *     (dual_wield_block_bokatan); lost Personal Combat Shield + Defensive Fire.
 *  2. Dioxis Fumes — flat 1 Strain (no yellow die).
 *  3. Rebel Trooper (Elite) — cost 7/3, Get into Position (double action), Aim
 *     (per-figure, matches Regular), Get Ready, surges +3 Acc and +1 Dmg/Pierce 1.
 *  4. CT-1701 — Cover Fire once per round.
 *  5. Leia Organa — Military Efficiency is a SURGE ability.
 *  6. Get Behind Me! — GUARDIAN or Rebel melee FORCE USER.
 *  7. Bantha Rider — Wild Beast once/activation AND once/status phase.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const effects = JSON.parse(readFileSync(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8')).cards;
const ccEffects = JSON.parse(readFileSync(new URL('../../../data/cc-effects.json', import.meta.url), 'utf8'));
const lib = JSON.parse(readFileSync(new URL('../../../data/ability-library.json', import.meta.url), 'utf8')).abilities;

import { isCardPendingChange } from '../../../src/engine/cards-pending-change.js';

describe('PROBE-IACP-1: Bo-Katan Beskar Armor', () => {
  const bk = effects['Bo-Katan Kryze'];
  it('references dual_wield_block_bokatan / dual_wield_pistols_bokatan and NOT the old Defensive Fire / Personal Combat Shield / beskar_armor_bokatan ids', () => {
    const ids = bk.specialAbilityIds || [];
    assert.ok(ids.includes('dual_wield_block_bokatan'));
    assert.ok(ids.includes('dual_wield_pistols_bokatan'));
    assert.ok(!ids.includes('beskar_armor_bokatan'));
    assert.ok(!ids.includes('defensive_fire_bokatan'));
    assert.ok(!ids.includes('personal_combat_shield_gar_saxon'));
    assert.ok(!ids.includes('personal_combat_shield_bokatan'));
  });
  it('abilityText mentions Beskar Armor + 2 Block Tokens, not Defensive Fire / Personal Combat Shield', () => {
    assert.match(bk.abilityText, /Beskar Armor/);
    assert.match(bk.abilityText, /2 Block Tokens/);
    assert.ok(!/Defensive Fire/.test(bk.abilityText));
    assert.ok(!/Personal Combat Shield/.test(bk.abilityText));
  });
  it('Beskar Armor IS a passive keyword (triggers the after-deploy 2-block grant via post-deploy.js)', () => {
    assert.ok((bk.passives || []).includes('Beskar Armor'));
  });
  it('library carries dual_wield_block_bokatan (wired); old beskar_armor_bokatan / defensive_fire_bokatan removed', () => {
    assert.ok(lib.dual_wield_block_bokatan);
    assert.equal(lib.dual_wield_block_bokatan.wiredStatus, 'wired');
    assert.ok(!lib.beskar_armor_bokatan);
    assert.ok(!lib.defensive_fire_bokatan);
  });
  it('combat-bridge gates the 2-block-before-bonus-attack on dual_wield_block_bokatan (not the old beskar id)', () => {
    const bridge = readFileSync(new URL('../../../src/engine/combat-bridge.js', import.meta.url), 'utf8');
    assert.ok(bridge.includes('dual_wield_block_bokatan'), 'combat-bridge references the new id');
    assert.ok(!bridge.includes('beskar_armor_bokatan'), 'combat-bridge no longer references the old id');
  });
});

describe('PROBE-IACP-2: Dioxis Fumes flat 1 Strain', () => {
  it('cc-effects text says 1 Strain, no die roll', () => {
    const d = ccEffects.commandCards?.['Dioxis Fumes'] || ccEffects['Dioxis Fumes'] || findCc('Dioxis Fumes');
    assert.ok(d, 'Dioxis Fumes cc-effects entry exists');
    assert.match(d.effect, /1 Strain/);
    assert.ok(!/yellow/i.test(d.effect));
    assert.ok(!/roll/i.test(d.effect));
  });
});

describe('PROBE-IACP-3: Rebel Trooper (Elite) rework', () => {
  const rt = effects['Rebel Trooper (Elite)'];
  it('cost 7 / subCost 3', () => {
    assert.equal(rt.cost, 7);
    assert.equal(rt.subCost, 3);
  });
  it('surges: +3 Accuracy and +1 Damage / Pierce 1', () => {
    const s = rt.surgeAbilities || [];
    assert.ok(s.includes('accuracy 3'));
    assert.ok(s.includes('damage 1, pierce 1'));
  });
  it('Get into Position is a double-action special (actionCost 2, move 4 + Focus)', () => {
    const e = lib.get_into_position;
    assert.ok(e);
    assert.equal(e.mpBonus, 4);
    assert.equal(e.applyFocus, true);
    assert.equal(e.isMoveX, true);
    assert.equal(e.actionCost, 2);
  });
  it('references get_into_position / aim_rebel_trooper_elite / get_ready_rebel_trooper_elite', () => {
    const ids = rt.specialAbilityIds || [];
    assert.ok(ids.includes('get_into_position'));
    assert.ok(ids.includes('aim_rebel_trooper_elite'));
    assert.ok(ids.includes('get_ready_rebel_trooper_elite'));
  });
});

describe('PROBE-IACP-5: Leia Military Efficiency is a surge ability', () => {
  const leia = effects['Leia Organa'];
  it('military_efficiency is in surgeAbilities (requires a surge spent)', () => {
    assert.ok((leia.surgeAbilities || []).includes('military_efficiency'));
  });
  it('abilityText labels it "(Surge)"', () => {
    assert.match(leia.abilityText, /Military Efficiency \(Surge\)/);
  });
});

describe('PROBE-IACP-6: Get Behind Me! eligibility note', () => {
  it('cc-effects records the GUARDIAN / Rebel melee FORCE USER restriction', () => {
    const g = ccEffects.commandCards?.['Get Behind Me!'] || findCc('Get Behind Me!');
    assert.ok(g);
    assert.match(JSON.stringify(g), /GUARDIAN.*FORCE USER|FORCE USER.*GUARDIAN/);
  });
});

describe('PROBE-IACP-7: Bantha Rider Wild Beast double limit', () => {
  it('abilityText states once per activation and once per status phase', () => {
    const br = effects['Bantha Rider'];
    assert.match(br.abilityText, /once per activation/i);
    assert.match(br.abilityText, /once per status phase/i);
  });
});

describe('PROBE-IACP-8: The Armorer aura range increased to 4', () => {
  const armorer = effects['The Armorer'];
  it('abilityText: This is the Way + Survival is Strength both gated to within 4 spaces of the Armorer', () => {
    assert.match(armorer.abilityText, /This is the Way: When another friendly figure within 4 spaces of the Armorer/);
    assert.match(armorer.abilityText, /Survival is Strength: While a friendly figure within 4 spaces of the Armorer/);
    assert.ok(!/within 3 spaces/.test(armorer.abilityText), 'no stale within-3 wording remains');
  });
  it('This is the Way (win-conditions) enforces a within-4 range gate', () => {
    const wc = readFileSync(new URL('../../../src/engine/win-conditions.js', import.meta.url), 'utf8');
    const fn = wc.slice(wc.indexOf('export async function checkThisIsTheWay'),
      wc.indexOf('export async function decrementActivationIfGroupDefeated'));
    assert.match(fn, /countGameSpaces\(game, attackerPos, armorerPos\)\s*<=\s*4/,
      'checkThisIsTheWay must gate the attacker to within 4 of the Armorer');
  });
  it('Survival is Strength (combat.js) gate uses within-4', () => {
    const cb = readFileSync(new URL('../../../src/handlers/combat.js', import.meta.url), 'utf8');
    const call = cb.match(/isWithinSpaces\(_sisMapSp,[^\n]*_sisDefCoord[^\n]*?,\s*(\d+)\)/);
    assert.ok(call);
    assert.equal(call[1], '4');
  });
});

describe('PROBE-IACP-9: KX-Series Shoulder Rush rework', () => {
  it('shoulder_rush is a Double Action (actionCost 2) that moves up to 6', () => {
    const e = lib.shoulder_rush;
    assert.ok(e);
    assert.equal(e.actionCost, 2);
    assert.equal(e.freeMoveBonus, 6);
    assert.equal(e.shoulderRushPostMove, true);
  });
  it('KX-Series Security Droid (Elite) abilityText reflects move-6 + non-SMALL no-enter-still-attack', () => {
    const kx = effects['KX-Series Security Droid (Elite)'];
    assert.match(kx.abilityText, /Double Action \(Shoulder Rush\): Move up to 6 spaces/);
    assert.match(kx.abilityText, /not SMALL.*not pushed.*cannot enter its space.*still attack/s);
  });
});

describe('PROBE-IACP-PENDING: finalized cards removed from CARDS_PENDING_CHANGE', () => {
  for (const name of ['Rebel Trooper (Elite)', 'Rebel Trooper', 'Leia Organa', 'Bantha Rider', 'Get Behind Me!', 'Bo-Katan Kryze', 'Yoda', 'Stimulants', 'Wookiee Rage']) {
    it(`${name} is no longer pending`, () => {
      assert.equal(isCardPendingChange(name), false);
    });
  }
  it('CT-1701 STAYS pending (Barrage still changing; Cover Fire is hand-wired)', () => {
    assert.equal(isCardPendingChange('CT-1701'), true);
  });
});

// cc-effects.json may be a flat map or nested under commandCards — find tolerantly.
function findCc(name) {
  if (ccEffects[name]) return ccEffects[name];
  for (const v of Object.values(ccEffects)) {
    if (v && typeof v === 'object' && v[name]) return v[name];
  }
  return null;
}
