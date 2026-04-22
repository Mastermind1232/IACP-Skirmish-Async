/**
 * PROBE-VANGUARD: AT-RT's **Vanguard**.
 *
 * Card text: "While attacking, if the target is within 3 spaces,
 *  replace 1 of your attack dice with 1 red die."
 *
 * Helper owns slug id, range predicate, and the pure dice-swap
 * (first non-red → red). Distance lookup + message stay
 * handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasVanguardAbility,
  vanguardInRange,
  applyVanguardDieSwap,
  VANGUARD_ABILITY_ID,
  VANGUARD_MAX_DISTANCE,
  VANGUARD_REPLACEMENT_DIE,
} from '../../../src/game/vanguard-helpers.js';

describe('PROBE-VANGUARD-001: constants', () => {
  it('ability id', () => {
    assert.equal(VANGUARD_ABILITY_ID, 'vanguard');
  });
  it('max distance = 3', () => {
    assert.equal(VANGUARD_MAX_DISTANCE, 3);
  });
  it('replacement die = red', () => {
    assert.equal(VANGUARD_REPLACEMENT_DIE, 'red');
  });
});

describe('PROBE-VANGUARD-002: hasVanguardAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasVanguardAbility(['vanguard']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasVanguardAbility([]), false);
    assert.equal(hasVanguardAbility(null), false);
    assert.equal(hasVanguardAbility('vanguard'), false);
  });
});

describe('PROBE-VANGUARD-003: vanguardInRange', () => {
  it('distance ≤ 3 → true', () => {
    for (const d of [0, 1, 2, 3]) assert.equal(vanguardInRange(d), true, `d=${d}`);
  });
  it('distance > 3 → false', () => {
    assert.equal(vanguardInRange(4), false);
    assert.equal(vanguardInRange(10), false);
  });
  it('non-finite → false', () => {
    assert.equal(vanguardInRange(NaN), false);
    assert.equal(vanguardInRange(Infinity), false);
    assert.equal(vanguardInRange(undefined), false);
  });
});

describe('PROBE-VANGUARD-004: applyVanguardDieSwap', () => {
  it('first non-red die → red (pool with mixed colors)', () => {
    const r = applyVanguardDieSwap(['green', 'blue', 'red']);
    assert.deepStrictEqual(r, {
      applied: true,
      dice: ['red', 'blue', 'red'],
      replacedKind: 'green',
      replacedIndex: 0,
    });
  });
  it('skips leading reds, swaps first non-red', () => {
    const r = applyVanguardDieSwap(['red', 'red', 'yellow', 'blue']);
    assert.deepStrictEqual(r, {
      applied: true,
      dice: ['red', 'red', 'red', 'blue'],
      replacedKind: 'yellow',
      replacedIndex: 2,
    });
  });
  it('all-red pool → applied=false, same reference', () => {
    const dice = ['red', 'red', 'red'];
    const r = applyVanguardDieSwap(dice);
    assert.equal(r.applied, false);
    assert.equal(r.dice, dice);
  });
  it('empty pool → applied=false', () => {
    const r = applyVanguardDieSwap([]);
    assert.equal(r.applied, false);
  });
  it('non-array → applied=false', () => {
    assert.equal(applyVanguardDieSwap(null).applied, false);
    assert.equal(applyVanguardDieSwap(undefined).applied, false);
  });
  it('pure: no mutation', () => {
    const dice = ['green', 'blue'];
    applyVanguardDieSwap(dice);
    assert.deepStrictEqual(dice, ['green', 'blue']);
  });
});

describe('PROBE-VANGUARD-005: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.vanguard;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references vanguard', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('vanguard'),
    );
    assert.ok(refs.length > 0);
  });
});
