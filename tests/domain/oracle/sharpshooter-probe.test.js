/**
 * PROBE-SHARPSHOOTER: Fennec Shand's **Sharpshooter**.
 *
 * Card text: "While attacking, if the target is 5 or more spaces
 *  away, become Focused."
 *
 * Helper owns slug id, range predicate (distance ≥ 5), and the
 * Focus-with-green-die parameters. Focus application itself uses
 * the shared applyConditionWithDie engine (handler-owned).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSharpshooterAbility,
  sharpshooterInRange,
  SHARPSHOOTER_ABILITY_ID,
  SHARPSHOOTER_MIN_DISTANCE,
  SHARPSHOOTER_CONDITION,
  SHARPSHOOTER_BONUS_DIE,
} from '../../../src/game/sharpshooter-helpers.js';

describe('PROBE-SHARPSHOOTER-001: constants', () => {
  it('ability id', () => {
    assert.equal(SHARPSHOOTER_ABILITY_ID, 'sharpshooter');
  });
  it('min distance = 5', () => {
    assert.equal(SHARPSHOOTER_MIN_DISTANCE, 5);
  });
  it('condition = Focus', () => {
    assert.equal(SHARPSHOOTER_CONDITION, 'Focus');
  });
  it('bonus die = green', () => {
    assert.equal(SHARPSHOOTER_BONUS_DIE, 'green');
  });
});

describe('PROBE-SHARPSHOOTER-002: hasSharpshooterAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasSharpshooterAbility(['sharpshooter']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasSharpshooterAbility([]), false);
    assert.equal(hasSharpshooterAbility(null), false);
    assert.equal(hasSharpshooterAbility('sharpshooter'), false);
  });
});

describe('PROBE-SHARPSHOOTER-003: sharpshooterInRange (range gate, ≥ 5)', () => {
  it('distance ≥ 5 → true', () => {
    for (const d of [5, 6, 10, 100]) {
      assert.equal(sharpshooterInRange(d), true, `d=${d}`);
    }
  });
  it('distance < 5 → false', () => {
    for (const d of [0, 1, 2, 3, 4]) {
      assert.equal(sharpshooterInRange(d), false, `d=${d}`);
    }
  });
  it('non-finite → false', () => {
    assert.equal(sharpshooterInRange(NaN), false);
    assert.equal(sharpshooterInRange(Infinity), false);
    assert.equal(sharpshooterInRange(undefined), false);
  });
});

describe('PROBE-SHARPSHOOTER-004: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.sharpshooter;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references sharpshooter', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('sharpshooter'),
    );
    assert.ok(refs.length > 0);
  });
});
