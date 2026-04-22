/**
 * PROBE-COMPOSITE-PLATING: Heavy Stormtrooper (Regular)'s **Composite
 * Plating**.
 *
 * Card text: "While defending, if the attacker is 4 or more spaces
 *  away, apply +1 Block."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCompositePlatingAbility,
  compositePlatingApplies,
  applyCompositePlatingBonus,
  COMPOSITE_PLATING_ABILITY_ID,
  COMPOSITE_PLATING_MIN_DISTANCE,
  COMPOSITE_PLATING_BONUS_BLOCK,
} from '../../../src/game/composite-plating-helpers.js';

describe('PROBE-COMPOSITE-001: constants', () => {
  it('ability id = composite_plating', () => {
    assert.equal(COMPOSITE_PLATING_ABILITY_ID, 'composite_plating');
  });
  it('distance gate = 4', () => {
    assert.equal(COMPOSITE_PLATING_MIN_DISTANCE, 4);
  });
  it('bonus = +1 Block', () => {
    assert.equal(COMPOSITE_PLATING_BONUS_BLOCK, 1);
  });
});

describe('PROBE-COMPOSITE-002: hasCompositePlatingAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasCompositePlatingAbility(['composite_plating']), true);
  });
  it('slug missing / non-array → false', () => {
    assert.equal(hasCompositePlatingAbility([]), false);
    assert.equal(hasCompositePlatingAbility(['focus']), false);
    assert.equal(hasCompositePlatingAbility(null), false);
    assert.equal(hasCompositePlatingAbility('composite_plating'), false);
  });
});

describe('PROBE-COMPOSITE-003: distance gate', () => {
  it('<4 → closed', () => {
    assert.equal(compositePlatingApplies(0), false);
    assert.equal(compositePlatingApplies(3), false);
  });
  it('=4 → open', () => {
    assert.equal(compositePlatingApplies(4), true);
  });
  it('>4 → open', () => {
    assert.equal(compositePlatingApplies(99), true);
  });
  it('non-number → closed', () => {
    assert.equal(compositePlatingApplies(null), false);
    assert.equal(compositePlatingApplies('4'), false);
  });
});

describe('PROBE-COMPOSITE-004: applyCompositePlatingBonus math', () => {
  it('zero existing → +1 Block', () => {
    assert.deepStrictEqual(applyCompositePlatingBonus({ bonusBlock: 0 }), {
      applied: true,
      bonusBlock: 1,
    });
  });
  it('stacks on existing bonus (e.g. Gamorrean Honor Guard)', () => {
    assert.deepStrictEqual(applyCompositePlatingBonus({ bonusBlock: 1 }), {
      applied: true,
      bonusBlock: 2,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyCompositePlatingBonus(), { applied: true, bonusBlock: 1 });
    assert.deepStrictEqual(applyCompositePlatingBonus({ bonusBlock: null }), {
      applied: true,
      bonusBlock: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusBlock: 3 };
    applyCompositePlatingBonus(input);
    assert.deepStrictEqual(input, { bonusBlock: 3 });
  });
});

describe('PROBE-COMPOSITE-005: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.composite_plating;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Composite Plating/i);
  });
  it('Heavy Stormtrooper (Regular) references composite_plating', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Heavy Stormtrooper (Regular)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('composite_plating'));
  });
});
