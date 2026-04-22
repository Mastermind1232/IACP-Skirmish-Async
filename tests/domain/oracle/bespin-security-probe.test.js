/**
 * PROBE-BESPIN-SECURITY: Wing Guard (Elite)'s **Bespin Security**.
 *
 * Card text: "While an adjacent friendly LEADER or SCUM TROOPER is
 *  attacking, it may reroll 1 attack die."
 *
 * Helper covers the attacker-trait gate + reroll math. Adjacency
 * lookup is handler-owned and out of scope.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasBespinSecurityAbility,
  attackerQualifiesForBespin,
  applyBespinSecurityReroll,
  BESPIN_SECURITY_ABILITY_ID,
  BESPIN_SECURITY_REROLLS,
} from '../../../src/game/bespin-security-helpers.js';

describe('PROBE-BESPIN-SECURITY-001: constants', () => {
  it('ability id', () => {
    assert.equal(BESPIN_SECURITY_ABILITY_ID, 'bespin_security');
  });
  it('reroll count = 1', () => {
    assert.equal(BESPIN_SECURITY_REROLLS, 1);
  });
});

describe('PROBE-BESPIN-SECURITY-002: hasBespinSecurityAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasBespinSecurityAbility(['bespin_security']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasBespinSecurityAbility([]), false);
    assert.equal(hasBespinSecurityAbility(null), false);
    assert.equal(hasBespinSecurityAbility('bespin_security'), false);
  });
});

describe('PROBE-BESPIN-SECURITY-003: attackerQualifiesForBespin', () => {
  it('LEADER keyword → true regardless of affiliation', () => {
    assert.equal(attackerQualifiesForBespin(['LEADER'], 'Rebel'), true);
    assert.equal(attackerQualifiesForBespin(['Leader'], 'Imperial'), true);
    assert.equal(attackerQualifiesForBespin(['LEADER'], 'Scum'), true);
  });
  it('SCUM TROOPER → true', () => {
    assert.equal(attackerQualifiesForBespin(['TROOPER'], 'Scum'), true);
    assert.equal(attackerQualifiesForBespin(['trooper'], 'Scum'), true);
  });
  it('TROOPER but not Scum → false', () => {
    assert.equal(attackerQualifiesForBespin(['TROOPER'], 'Rebel'), false);
    assert.equal(attackerQualifiesForBespin(['TROOPER'], 'Imperial'), false);
  });
  it('neither trigger keyword → false', () => {
    assert.equal(attackerQualifiesForBespin(['BRAWLER'], 'Scum'), false);
    assert.equal(attackerQualifiesForBespin([], 'Scum'), false);
  });
  it('non-array keywords → false', () => {
    assert.equal(attackerQualifiesForBespin(null, 'Scum'), false);
    assert.equal(attackerQualifiesForBespin('LEADER', 'Scum'), false);
  });
});

describe('PROBE-BESPIN-SECURITY-004: applyBespinSecurityReroll math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyBespinSecurityReroll({ rerollOneAttackDie: 0 }), {
      applied: true,
      rerollOneAttackDie: 1,
    });
  });
  it('stacks on prior rerolls', () => {
    assert.deepStrictEqual(applyBespinSecurityReroll({ rerollOneAttackDie: 2 }), {
      applied: true,
      rerollOneAttackDie: 3,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyBespinSecurityReroll(), { applied: true, rerollOneAttackDie: 1 });
    assert.deepStrictEqual(applyBespinSecurityReroll({ rerollOneAttackDie: null }), {
      applied: true,
      rerollOneAttackDie: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { rerollOneAttackDie: 4 };
    applyBespinSecurityReroll(input);
    assert.deepStrictEqual(input, { rerollOneAttackDie: 4 });
  });
});

describe('PROBE-BESPIN-SECURITY-005: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.bespin_security;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Bespin Security/i);
  });
  it('Wing Guard (Elite) references bespin_security', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Wing Guard (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('bespin_security'));
  });
});
