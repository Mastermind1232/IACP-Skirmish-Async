/**
 * PROBE-SHOCK-AND-AWE: Cara Dune's **Shock and Awe**.
 *
 * Card text: "Once per round, during a Declare Attack step, you
 *  may replace 1 Yellow die with 1 Red die."
 *
 * Helper owns slug, source + replacement die kinds, per-figure
 * round-scoped key builder, already-used predicate, and the pure
 * die-swap (first Yellow → Red). Round-flag writeback + message
 * stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasShockAndAweAbility,
  buildShockAndAweRoundKey,
  isShockAndAweAlreadyUsed,
  applyShockAndAweDieSwap,
  SHOCK_AND_AWE_ABILITY_ID,
  SHOCK_AND_AWE_SOURCE_DIE,
  SHOCK_AND_AWE_REPLACEMENT_DIE,
} from '../../../src/game/shock-and-awe-helpers.js';

describe('PROBE-SHOCK-AND-AWE-001: constants', () => {
  it('ability id', () => {
    assert.equal(SHOCK_AND_AWE_ABILITY_ID, 'shock_and_awe');
  });
  it('source die = yellow', () => {
    assert.equal(SHOCK_AND_AWE_SOURCE_DIE, 'yellow');
  });
  it('replacement die = red', () => {
    assert.equal(SHOCK_AND_AWE_REPLACEMENT_DIE, 'red');
  });
});

describe('PROBE-SHOCK-AND-AWE-002: hasShockAndAweAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasShockAndAweAbility(['shock_and_awe']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasShockAndAweAbility([]), false);
    assert.equal(hasShockAndAweAbility(null), false);
    assert.equal(hasShockAndAweAbility('shock_and_awe'), false);
  });
});

describe('PROBE-SHOCK-AND-AWE-003: buildShockAndAweRoundKey', () => {
  it('concatenates figureKey + slug (pins handler format)', () => {
    assert.equal(buildShockAndAweRoundKey('p1_Cara_Dune_0'), 'p1_Cara_Dune_0_shock_and_awe');
  });
  it('different figures get different keys', () => {
    const a = buildShockAndAweRoundKey('p1_Cara_Dune_0');
    const b = buildShockAndAweRoundKey('p1_Cara_Dune_1');
    assert.notEqual(a, b);
  });
});

describe('PROBE-SHOCK-AND-AWE-004: isShockAndAweAlreadyUsed', () => {
  it('truthy entry → true', () => {
    assert.equal(isShockAndAweAlreadyUsed({ k: true }, 'k'), true);
  });
  it('missing entry → false', () => {
    assert.equal(isShockAndAweAlreadyUsed({}, 'k'), false);
  });
  it('null/undefined map → false', () => {
    assert.equal(isShockAndAweAlreadyUsed(null, 'k'), false);
    assert.equal(isShockAndAweAlreadyUsed(undefined, 'k'), false);
  });
});

describe('PROBE-SHOCK-AND-AWE-005: applyShockAndAweDieSwap', () => {
  it('first yellow → red', () => {
    const r = applyShockAndAweDieSwap(['blue', 'yellow', 'green']);
    assert.deepStrictEqual(r, {
      applied: true,
      dice: ['blue', 'red', 'green'],
      replacedIndex: 1,
    });
  });
  it('multiple yellows: only first swapped', () => {
    const r = applyShockAndAweDieSwap(['yellow', 'yellow']);
    assert.deepStrictEqual(r, {
      applied: true,
      dice: ['red', 'yellow'],
      replacedIndex: 0,
    });
  });
  it('no yellow → applied=false, same reference', () => {
    const dice = ['blue', 'green'];
    const r = applyShockAndAweDieSwap(dice);
    assert.equal(r.applied, false);
    assert.equal(r.dice, dice);
  });
  it('empty pool → applied=false', () => {
    const r = applyShockAndAweDieSwap([]);
    assert.equal(r.applied, false);
  });
  it('non-array → applied=false', () => {
    assert.equal(applyShockAndAweDieSwap(null).applied, false);
    assert.equal(applyShockAndAweDieSwap(undefined).applied, false);
  });
  it('pure: no mutation', () => {
    const dice = ['yellow', 'blue'];
    applyShockAndAweDieSwap(dice);
    assert.deepStrictEqual(dice, ['yellow', 'blue']);
  });
});

describe('PROBE-SHOCK-AND-AWE-006: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.shock_and_awe;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references shock_and_awe', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('shock_and_awe'),
    );
    assert.ok(refs.length > 0);
  });
});
