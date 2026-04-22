/**
 * PROBE-MUCH-TO-LEARN: Ezra Bridger's **Much to Learn**.
 *
 * Card text: "While attacking, if a friendly Unique figure is
 *  within 3 spaces of you, you may reroll 1 attack die. If that
 *  friendly Unique is a Force User, you may choose a side instead."
 *
 * Helper owns slug, range predicate, reroll delta, FORCE USER
 * keyword, and DC-effect-shape predicates (unique/Force User).
 * Iteration over friendly positions stays handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasMuchToLearnAbility,
  muchToLearnInRange,
  isUniqueFriendly,
  isForceUserFriendly,
  applyMuchToLearnReroll,
  MUCH_TO_LEARN_ABILITY_ID,
  MUCH_TO_LEARN_MAX_DISTANCE,
  MUCH_TO_LEARN_REROLL_DELTA,
  MUCH_TO_LEARN_FORCE_USER_KEYWORD,
} from '../../../src/game/much-to-learn-helpers.js';

describe('PROBE-MUCH-TO-LEARN-001: constants', () => {
  it('ability id', () => {
    assert.equal(MUCH_TO_LEARN_ABILITY_ID, 'much_to_learn');
  });
  it('max distance = 3', () => {
    assert.equal(MUCH_TO_LEARN_MAX_DISTANCE, 3);
  });
  it('reroll delta = +1', () => {
    assert.equal(MUCH_TO_LEARN_REROLL_DELTA, 1);
  });
  it('force user keyword = FORCE USER (upper)', () => {
    assert.equal(MUCH_TO_LEARN_FORCE_USER_KEYWORD, 'FORCE USER');
  });
});

describe('PROBE-MUCH-TO-LEARN-002: hasMuchToLearnAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasMuchToLearnAbility(['much_to_learn']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasMuchToLearnAbility([]), false);
    assert.equal(hasMuchToLearnAbility(null), false);
    assert.equal(hasMuchToLearnAbility('much_to_learn'), false);
  });
});

describe('PROBE-MUCH-TO-LEARN-003: muchToLearnInRange', () => {
  it('distance ≤ 3 → true', () => {
    for (const d of [0, 1, 2, 3]) assert.equal(muchToLearnInRange(d), true, `d=${d}`);
  });
  it('distance > 3 → false', () => {
    assert.equal(muchToLearnInRange(4), false);
    assert.equal(muchToLearnInRange(10), false);
  });
  it('non-finite → false', () => {
    assert.equal(muchToLearnInRange(NaN), false);
    assert.equal(muchToLearnInRange(Infinity), false);
    assert.equal(muchToLearnInRange(undefined), false);
  });
});

describe('PROBE-MUCH-TO-LEARN-004: isUniqueFriendly', () => {
  it('unique: true → true', () => {
    assert.equal(isUniqueFriendly({ unique: true }), true);
  });
  it('unique: false / missing → false', () => {
    assert.equal(isUniqueFriendly({ unique: false }), false);
    assert.equal(isUniqueFriendly({}), false);
    assert.equal(isUniqueFriendly(null), false);
    assert.equal(isUniqueFriendly(undefined), false);
  });
});

describe('PROBE-MUCH-TO-LEARN-005: isForceUserFriendly', () => {
  it('FORCE USER keyword present → true', () => {
    assert.equal(isForceUserFriendly({ keywords: ['FORCE USER'] }), true);
  });
  it('case-insensitive', () => {
    assert.equal(isForceUserFriendly({ keywords: ['force user'] }), true);
    assert.equal(isForceUserFriendly({ keywords: ['Force User'] }), true);
  });
  it('missing keyword → false', () => {
    assert.equal(isForceUserFriendly({ keywords: ['HUNTER'] }), false);
    assert.equal(isForceUserFriendly({ keywords: [] }), false);
    assert.equal(isForceUserFriendly({}), false);
    assert.equal(isForceUserFriendly(null), false);
  });
});

describe('PROBE-MUCH-TO-LEARN-006: applyMuchToLearnReroll math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyMuchToLearnReroll({ rerollOneAttackDie: 0 }), {
      applied: true,
      rerollOneAttackDie: 1,
    });
  });
  it('stacks on prior rerolls', () => {
    assert.deepStrictEqual(applyMuchToLearnReroll({ rerollOneAttackDie: 2 }), {
      applied: true,
      rerollOneAttackDie: 3,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyMuchToLearnReroll(), { applied: true, rerollOneAttackDie: 1 });
    assert.deepStrictEqual(applyMuchToLearnReroll({ rerollOneAttackDie: null }), {
      applied: true,
      rerollOneAttackDie: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { rerollOneAttackDie: 2 };
    applyMuchToLearnReroll(input);
    assert.deepStrictEqual(input, { rerollOneAttackDie: 2 });
  });
});

describe('PROBE-MUCH-TO-LEARN-007: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.much_to_learn;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references much_to_learn', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('much_to_learn'),
    );
    assert.ok(refs.length > 0);
  });
});
