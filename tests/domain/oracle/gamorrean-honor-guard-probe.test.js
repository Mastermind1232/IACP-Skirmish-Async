/**
 * PROBE-GAMORREAN-HG: Gamorrean Guard (Elite)'s **Gamorrean Honor Guard**.
 *
 * Card text: "While defending against a Ranged attack, apply +1 Block."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasGamorreanHonorGuardAbility,
  gamorreanHonorGuardApplies,
  applyGamorreanHonorGuardBonus,
  GAMORREAN_HONOR_GUARD_ABILITY_ID,
  GAMORREAN_HONOR_GUARD_BONUS_BLOCK,
} from '../../../src/game/gamorrean-honor-guard-helpers.js';

describe('PROBE-GHG-001: constants', () => {
  it('ability id', () => {
    assert.equal(GAMORREAN_HONOR_GUARD_ABILITY_ID, 'gamorrean_honor_guard');
  });
  it('bonus = +1 Block', () => {
    assert.equal(GAMORREAN_HONOR_GUARD_BONUS_BLOCK, 1);
  });
});

describe('PROBE-GHG-002: hasGamorreanHonorGuardAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasGamorreanHonorGuardAbility(['gamorrean_honor_guard']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasGamorreanHonorGuardAbility([]), false);
    assert.equal(hasGamorreanHonorGuardAbility(null), false);
    assert.equal(hasGamorreanHonorGuardAbility('gamorrean_honor_guard'), false);
  });
});

describe('PROBE-GHG-003: ranged gate', () => {
  it('true → applies', () => {
    assert.equal(gamorreanHonorGuardApplies(true), true);
  });
  it('false → not applies', () => {
    assert.equal(gamorreanHonorGuardApplies(false), false);
  });
  it('non-boolean truthy → does NOT apply (strict check)', () => {
    assert.equal(gamorreanHonorGuardApplies(1), false);
    assert.equal(gamorreanHonorGuardApplies('ranged'), false);
    assert.equal(gamorreanHonorGuardApplies(null), false);
    assert.equal(gamorreanHonorGuardApplies(undefined), false);
  });
});

describe('PROBE-GHG-004: applyGamorreanHonorGuardBonus math', () => {
  it('zero existing → +1 Block', () => {
    assert.deepStrictEqual(applyGamorreanHonorGuardBonus({ bonusBlock: 0 }), {
      applied: true,
      bonusBlock: 1,
    });
  });
  it('stacks (e.g. Composite Plating)', () => {
    assert.deepStrictEqual(applyGamorreanHonorGuardBonus({ bonusBlock: 1 }), {
      applied: true,
      bonusBlock: 2,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyGamorreanHonorGuardBonus(), { applied: true, bonusBlock: 1 });
    assert.deepStrictEqual(applyGamorreanHonorGuardBonus({ bonusBlock: null }), {
      applied: true,
      bonusBlock: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusBlock: 4 };
    applyGamorreanHonorGuardBonus(input);
    assert.deepStrictEqual(input, { bonusBlock: 4 });
  });
});

describe('PROBE-GHG-005: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.gamorrean_honor_guard;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Gamorrean Honor Guard/i);
  });
  it('Gamorrean Guard (Elite) references the slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Gamorrean Guard (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('gamorrean_honor_guard'));
  });
});
