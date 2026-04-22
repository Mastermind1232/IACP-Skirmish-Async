/**
 * PROBE-TRIPOD-EWEB: E-Web Engineer (Elite/Regular) **Tripod**.
 *
 * Card text: "You cannot attack on the same activation on which
 *  you exited a space."
 *
 * Helper owns slug id and the block predicate (slug present +
 * attacker has moved this activation). Aborting the attack
 * (pendingCombat teardown) stays handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTripodEwebAbility,
  tripodBlocksAttack,
  TRIPOD_EWEB_ABILITY_ID,
} from '../../../src/game/tripod-eweb-helpers.js';

describe('PROBE-TRIPOD-EWEB-001: constants', () => {
  it('ability id', () => {
    assert.equal(TRIPOD_EWEB_ABILITY_ID, 'tripod_eweb');
  });
});

describe('PROBE-TRIPOD-EWEB-002: hasTripodEwebAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasTripodEwebAbility(['tripod_eweb']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasTripodEwebAbility([]), false);
    assert.equal(hasTripodEwebAbility(null), false);
    assert.equal(hasTripodEwebAbility('tripod_eweb'), false);
  });
});

describe('PROBE-TRIPOD-EWEB-003: tripodBlocksAttack', () => {
  it('has slug + moved → true (blocks)', () => {
    assert.equal(
      tripodBlocksAttack({ specialAbilityIds: ['tripod_eweb'], moved: true }),
      true,
    );
  });
  it('has slug + not moved → false', () => {
    assert.equal(
      tripodBlocksAttack({ specialAbilityIds: ['tripod_eweb'], moved: false }),
      false,
    );
    assert.equal(
      tripodBlocksAttack({ specialAbilityIds: ['tripod_eweb'], moved: undefined }),
      false,
    );
  });
  it('no slug + moved → false', () => {
    assert.equal(
      tripodBlocksAttack({ specialAbilityIds: ['other'], moved: true }),
      false,
    );
  });
  it('truthy non-boolean moved → true', () => {
    // game.figureMoved[figureKey] is stored as truthy/falsy; helper
    // must accept a truthy value (timestamp, object, etc.) as "moved".
    assert.equal(
      tripodBlocksAttack({ specialAbilityIds: ['tripod_eweb'], moved: 1 }),
      true,
    );
    assert.equal(
      tripodBlocksAttack({ specialAbilityIds: ['tripod_eweb'], moved: {} }),
      true,
    );
  });
  it('no args → false', () => {
    assert.equal(tripodBlocksAttack(), false);
    assert.equal(tripodBlocksAttack({}), false);
  });
});

describe('PROBE-TRIPOD-EWEB-004: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.tripod_eweb;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references tripod_eweb', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('tripod_eweb'),
    );
    assert.ok(refs.length > 0);
  });
});
