/**
 * PROBE-FULL-OF-RAGE: Krrsantan's **Full of Rage**.
 *
 * Card text: "While attacking, if you have suffered 3 or more
 *  damage, become Focused."
 *
 * Helper owns slug id, Focus + green-die parameters, the damage
 * gate (≥ 3), and the damage-trigger predicate. The
 * applyConditionWithDie engine call and the early-site "!Focus
 * already" refinement stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFullOfRageAbility,
  fullOfRageDamageTriggered,
  FULL_OF_RAGE_ABILITY_ID,
  FULL_OF_RAGE_CONDITION,
  FULL_OF_RAGE_BONUS_DIE,
  FULL_OF_RAGE_MIN_DAMAGE,
} from '../../../src/game/full-of-rage-helpers.js';

describe('PROBE-FULL-OF-RAGE-001: constants', () => {
  it('ability id', () => {
    assert.equal(FULL_OF_RAGE_ABILITY_ID, 'full_of_rage');
  });
  it('condition = Focus', () => {
    assert.equal(FULL_OF_RAGE_CONDITION, 'Focus');
  });
  it('bonus die = green', () => {
    assert.equal(FULL_OF_RAGE_BONUS_DIE, 'green');
  });
  it('min damage = 3', () => {
    assert.equal(FULL_OF_RAGE_MIN_DAMAGE, 3);
  });
});

describe('PROBE-FULL-OF-RAGE-002: hasFullOfRageAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasFullOfRageAbility(['full_of_rage']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasFullOfRageAbility([]), false);
    assert.equal(hasFullOfRageAbility(null), false);
    assert.equal(hasFullOfRageAbility('full_of_rage'), false);
  });
});

describe('PROBE-FULL-OF-RAGE-003: fullOfRageDamageTriggered', () => {
  it('damage ≥ 3 → true', () => {
    for (const d of [3, 4, 7, 15]) {
      assert.equal(fullOfRageDamageTriggered(d), true, `d=${d}`);
    }
  });
  it('damage < 3 → false', () => {
    for (const d of [0, 1, 2]) {
      assert.equal(fullOfRageDamageTriggered(d), false, `d=${d}`);
    }
  });
  it('non-finite → false', () => {
    assert.equal(fullOfRageDamageTriggered(NaN), false);
    assert.equal(fullOfRageDamageTriggered(Infinity), false);
    assert.equal(fullOfRageDamageTriggered(undefined), false);
    assert.equal(fullOfRageDamageTriggered(null), false);
  });
});

describe('PROBE-FULL-OF-RAGE-004: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.full_of_rage;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references full_of_rage', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('full_of_rage'),
    );
    assert.ok(refs.length > 0);
  });
});
