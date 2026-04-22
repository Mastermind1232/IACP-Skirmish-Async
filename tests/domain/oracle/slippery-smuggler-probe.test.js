/**
 * PROBE-SLIPPERY-SMUGGLER: Alliance Smuggler (Elite/Regular)'s **Slippery**.
 *
 * Card text: "While defending, apply -2 Accuracy to the attack
 *  results."
 *
 * Phase 2.2 medium-risk probe grind (2026-04-22). Atom wired at
 * combat.js:2092 with predicate + bonus inlined. Pure helpers
 * extracted to src/game/slippery-smuggler-helpers.js. Covers two
 * atoms: slippery_smuggler_elite + slippery_smuggler_reg.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSlipperyAbility,
  applySlipperyBonus,
  SLIPPERY_SMUGGLER_ABILITY_IDS,
  SLIPPERY_BONUS_ACCURACY,
} from '../../../src/game/slippery-smuggler-helpers.js';

describe('PROBE-SLIPPERY-001: constants', () => {
  it('both slugs, frozen', () => {
    assert.deepStrictEqual([...SLIPPERY_SMUGGLER_ABILITY_IDS].sort(), [
      'slippery_smuggler_elite',
      'slippery_smuggler_reg',
    ]);
    assert.ok(Object.isFrozen(SLIPPERY_SMUGGLER_ABILITY_IDS));
  });

  it('bonus = -2 Accuracy', () => {
    assert.equal(SLIPPERY_BONUS_ACCURACY, -2);
  });
});

describe('PROBE-SLIPPERY-002: hasSlipperyAbility', () => {
  it('elite slug → true', () => {
    assert.equal(hasSlipperyAbility(['slippery_smuggler_elite']), true);
  });
  it('reg slug → true', () => {
    assert.equal(hasSlipperyAbility(['slippery_smuggler_reg']), true);
  });
  it('mixed with other abilities → true', () => {
    assert.equal(hasSlipperyAbility(['improved_smugglers_instincts', 'slippery_smuggler_elite']), true);
  });
  it('unrelated ids → false', () => {
    assert.equal(hasSlipperyAbility(['take_cover_jawa_elite']), false);
  });
  it('non-array → false', () => {
    assert.equal(hasSlipperyAbility(null), false);
    assert.equal(hasSlipperyAbility('slippery_smuggler_elite'), false);
  });
});

describe('PROBE-SLIPPERY-003: applySlipperyBonus math', () => {
  it('zero existing → bonusAccuracy = -2', () => {
    assert.deepStrictEqual(applySlipperyBonus({ bonusAccuracy: 0 }), {
      applied: true,
      bonusAccuracy: -2,
    });
  });

  it('stacks on existing bonus', () => {
    assert.deepStrictEqual(applySlipperyBonus({ bonusAccuracy: 3 }), {
      applied: true,
      bonusAccuracy: 1,
    });
  });

  it('can drive bonusAccuracy strongly negative', () => {
    assert.deepStrictEqual(applySlipperyBonus({ bonusAccuracy: -5 }), {
      applied: true,
      bonusAccuracy: -7,
    });
  });

  it('defaults / null / undefined → treated as 0', () => {
    assert.deepStrictEqual(applySlipperyBonus(), { applied: true, bonusAccuracy: -2 });
    assert.deepStrictEqual(applySlipperyBonus({}), { applied: true, bonusAccuracy: -2 });
    assert.deepStrictEqual(applySlipperyBonus({ bonusAccuracy: null }), {
      applied: true,
      bonusAccuracy: -2,
    });
  });

  it('pure: no mutation', () => {
    const input = { bonusAccuracy: 4 };
    applySlipperyBonus(input);
    assert.deepStrictEqual(input, { bonusAccuracy: 4 });
  });
});

describe('PROBE-SLIPPERY-004: library + dc-effects wiring', () => {
  it('elite library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.slippery_smuggler_elite;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Slippery/i);
  });

  it('reg library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.slippery_smuggler_reg;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });

  it('Alliance Smuggler (Elite) references elite slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const s = effects.cards?.['Alliance Smuggler (Elite)'];
    assert.ok(s);
    assert.ok((s.specialAbilityIds || []).includes('slippery_smuggler_elite'));
  });

  it('Alliance Smuggler (Regular) references reg slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const s = effects.cards?.['Alliance Smuggler (Regular)'];
    assert.ok(s);
    assert.ok((s.specialAbilityIds || []).includes('slippery_smuggler_reg'));
  });
});
