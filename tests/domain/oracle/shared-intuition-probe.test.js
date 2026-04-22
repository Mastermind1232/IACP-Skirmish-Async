/**
 * PROBE-SHARED-INTUITION: Tress Hacnua's **Shared Intuition**.
 *
 * Card text: "While attacking, if another friendly HUNTER is
 *  within 3 spaces of you and has LOS to the target, apply +1 Hit
 *  to the attack results."
 *
 * Helper owns slug, range (≤3), required keyword (HUNTER), hit
 * delta (+1), and the isHunterFriendly DC-shape predicate.
 * Position iteration + distance counting + LOS check stay
 * handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSharedIntuitionAbility,
  sharedIntuitionInRange,
  isHunterFriendly,
  applySharedIntuitionHit,
  SHARED_INTUITION_ABILITY_ID,
  SHARED_INTUITION_MAX_DISTANCE,
  SHARED_INTUITION_REQUIRED_KEYWORD,
  SHARED_INTUITION_HIT_DELTA,
} from '../../../src/game/shared-intuition-helpers.js';

describe('PROBE-SHARED-INTUITION-001: constants', () => {
  it('ability id', () => {
    assert.equal(SHARED_INTUITION_ABILITY_ID, 'shared_intuition');
  });
  it('max distance = 3', () => {
    assert.equal(SHARED_INTUITION_MAX_DISTANCE, 3);
  });
  it('required keyword = HUNTER (upper)', () => {
    assert.equal(SHARED_INTUITION_REQUIRED_KEYWORD, 'HUNTER');
  });
  it('hit delta = +1', () => {
    assert.equal(SHARED_INTUITION_HIT_DELTA, 1);
  });
});

describe('PROBE-SHARED-INTUITION-002: hasSharedIntuitionAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasSharedIntuitionAbility(['shared_intuition']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasSharedIntuitionAbility([]), false);
    assert.equal(hasSharedIntuitionAbility(null), false);
    assert.equal(hasSharedIntuitionAbility('shared_intuition'), false);
  });
});

describe('PROBE-SHARED-INTUITION-003: sharedIntuitionInRange', () => {
  it('distance ≤ 3 → true', () => {
    for (const d of [0, 1, 2, 3]) assert.equal(sharedIntuitionInRange(d), true, `d=${d}`);
  });
  it('distance > 3 → false', () => {
    assert.equal(sharedIntuitionInRange(4), false);
    assert.equal(sharedIntuitionInRange(10), false);
  });
  it('non-finite → false', () => {
    assert.equal(sharedIntuitionInRange(NaN), false);
    assert.equal(sharedIntuitionInRange(Infinity), false);
    assert.equal(sharedIntuitionInRange(undefined), false);
  });
});

describe('PROBE-SHARED-INTUITION-004: isHunterFriendly', () => {
  it('HUNTER keyword present → true', () => {
    assert.equal(isHunterFriendly({ keywords: ['HUNTER'] }), true);
  });
  it('case-insensitive', () => {
    assert.equal(isHunterFriendly({ keywords: ['hunter'] }), true);
    assert.equal(isHunterFriendly({ keywords: ['Hunter'] }), true);
  });
  it('missing keyword → false', () => {
    assert.equal(isHunterFriendly({ keywords: ['SPY'] }), false);
    assert.equal(isHunterFriendly({ keywords: [] }), false);
    assert.equal(isHunterFriendly({}), false);
    assert.equal(isHunterFriendly(null), false);
  });
});

describe('PROBE-SHARED-INTUITION-005: applySharedIntuitionHit math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applySharedIntuitionHit({ bonusHits: 0 }), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('stacks on prior bonus hits', () => {
    assert.deepStrictEqual(applySharedIntuitionHit({ bonusHits: 2 }), {
      applied: true,
      bonusHits: 3,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applySharedIntuitionHit(), { applied: true, bonusHits: 1 });
    assert.deepStrictEqual(applySharedIntuitionHit({ bonusHits: null }), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusHits: 3 };
    applySharedIntuitionHit(input);
    assert.deepStrictEqual(input, { bonusHits: 3 });
  });
});

describe('PROBE-SHARED-INTUITION-006: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.shared_intuition;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references shared_intuition', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('shared_intuition'),
    );
    assert.ok(refs.length > 0);
  });
});
