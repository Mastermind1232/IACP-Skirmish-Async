/**
 * PROBE-DEAD-PRECISE-KOTUN: Ko-Tun Feralo's **Dead Precise**.
 *
 * Card text: "If you have not exited a space during this activation,
 *  apply +2 Accuracy to your attack results."
 *
 * Phase 2.2 medium-risk probe grind (2026-04-22). Atom wired at
 * combat.js:2121 with predicate + bonus inlined. Pure helpers
 * extracted to src/game/dead-precise-kotun-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasDeadPreciseAbility,
  deadPreciseBonusApplies,
  applyDeadPreciseBonus,
  DEAD_PRECISE_ABILITY_ID,
  DEAD_PRECISE_BONUS_ACCURACY,
} from '../../../src/game/dead-precise-kotun-helpers.js';

describe('PROBE-DEAD-PRECISE-001: constants', () => {
  it('ability id = dead_precise_kotun', () => {
    assert.equal(DEAD_PRECISE_ABILITY_ID, 'dead_precise_kotun');
  });
  it('bonus = +2 Accuracy', () => {
    assert.equal(DEAD_PRECISE_BONUS_ACCURACY, 2);
  });
});

describe('PROBE-DEAD-PRECISE-002: hasDeadPreciseAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasDeadPreciseAbility(['dead_precise_kotun']), true);
  });
  it('slug missing → false', () => {
    assert.equal(hasDeadPreciseAbility(['focus']), false);
    assert.equal(hasDeadPreciseAbility([]), false);
  });
  it('non-array → false', () => {
    assert.equal(hasDeadPreciseAbility(null), false);
    assert.equal(hasDeadPreciseAbility('dead_precise_kotun'), false);
  });
});

describe('PROBE-DEAD-PRECISE-003: move gate', () => {
  it('not moved → true', () => {
    assert.equal(deadPreciseBonusApplies('Ko-Tun-1-0', {}), true);
  });
  it('moved → false', () => {
    assert.equal(deadPreciseBonusApplies('Ko-Tun-1-0', { 'Ko-Tun-1-0': true }), false);
  });
  it('missing map → true', () => {
    assert.equal(deadPreciseBonusApplies('Ko-Tun-1-0'), true);
    assert.equal(deadPreciseBonusApplies('Ko-Tun-1-0', null), true);
  });
  it('missing figureKey → false', () => {
    assert.equal(deadPreciseBonusApplies(null, {}), false);
    assert.equal(deadPreciseBonusApplies('', {}), false);
  });
  it('other figure moved → not blocked for this one', () => {
    assert.equal(deadPreciseBonusApplies('Ko-Tun-1-0', { 'Other-1-0': true }), true);
  });
});

describe('PROBE-DEAD-PRECISE-004: applyDeadPreciseBonus math', () => {
  it('zero existing → +2 Accuracy', () => {
    assert.deepStrictEqual(applyDeadPreciseBonus({ bonusAccuracy: 0 }), {
      applied: true,
      bonusAccuracy: 2,
    });
  });

  it('stacks on existing bonus', () => {
    assert.deepStrictEqual(applyDeadPreciseBonus({ bonusAccuracy: 3 }), {
      applied: true,
      bonusAccuracy: 5,
    });
  });

  it('stacks correctly on negative existing (e.g. Slippery debuff)', () => {
    assert.deepStrictEqual(applyDeadPreciseBonus({ bonusAccuracy: -2 }), {
      applied: true,
      bonusAccuracy: 0,
    });
  });

  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyDeadPreciseBonus(), { applied: true, bonusAccuracy: 2 });
    assert.deepStrictEqual(applyDeadPreciseBonus({ bonusAccuracy: null }), {
      applied: true,
      bonusAccuracy: 2,
    });
  });

  it('pure: no mutation', () => {
    const input = { bonusAccuracy: 5 };
    applyDeadPreciseBonus(input);
    assert.deepStrictEqual(input, { bonusAccuracy: 5 });
  });
});

describe('PROBE-DEAD-PRECISE-005: library + dc-effects wiring', () => {
  it('dead_precise_kotun library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.dead_precise_kotun;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Dead Precise/i);
  });

  it('Ko-Tun Feralo DC references dead_precise_kotun', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const k = effects.cards?.['Ko-Tun Feralo'];
    assert.ok(k, 'Ko-Tun Feralo DC must exist');
    assert.ok((k.specialAbilityIds || []).includes('dead_precise_kotun'));
  });
});
