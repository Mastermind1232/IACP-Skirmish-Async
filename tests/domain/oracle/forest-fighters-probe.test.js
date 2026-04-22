/**
 * PROBE-FOREST-FIGHTERS: Ewok Warrior Elite's **Forest Fighters**.
 *
 * Card text: "While performing a melee attack, if you are Hidden,
 *  apply +1 Hit to the attack results."
 *
 * Helper owns slug, required condition ('Hide'), hit delta (+1),
 * and the melee+Hidden qualification predicate. Condition lookup
 * + isRanged flag stay handler-owned inputs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasForestFightersAbility,
  forestFightersQualifies,
  applyForestFightersHit,
  FOREST_FIGHTERS_ABILITY_ID,
  FOREST_FIGHTERS_HIT_DELTA,
  FOREST_FIGHTERS_REQUIRED_CONDITION,
} from '../../../src/game/forest-fighters-helpers.js';

describe('PROBE-FOREST-FIGHTERS-001: constants', () => {
  it('ability id', () => {
    assert.equal(FOREST_FIGHTERS_ABILITY_ID, 'forest_fighters');
  });
  it('hit delta = +1', () => {
    assert.equal(FOREST_FIGHTERS_HIT_DELTA, 1);
  });
  it('required condition = Hide', () => {
    assert.equal(FOREST_FIGHTERS_REQUIRED_CONDITION, 'Hide');
  });
});

describe('PROBE-FOREST-FIGHTERS-002: hasForestFightersAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasForestFightersAbility(['forest_fighters']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasForestFightersAbility([]), false);
    assert.equal(hasForestFightersAbility(null), false);
    assert.equal(hasForestFightersAbility('forest_fighters'), false);
  });
});

describe('PROBE-FOREST-FIGHTERS-003: forestFightersQualifies', () => {
  it('melee + Hidden → true', () => {
    assert.equal(
      forestFightersQualifies({ isRanged: false, attackerConditions: ['Hide'] }),
      true,
    );
  });
  it('ranged + Hidden → false (melee required)', () => {
    assert.equal(
      forestFightersQualifies({ isRanged: true, attackerConditions: ['Hide'] }),
      false,
    );
  });
  it('melee + not Hidden → false', () => {
    assert.equal(
      forestFightersQualifies({ isRanged: false, attackerConditions: ['Focus'] }),
      false,
    );
    assert.equal(
      forestFightersQualifies({ isRanged: false, attackerConditions: [] }),
      false,
    );
  });
  it('missing / non-array conditions → false', () => {
    assert.equal(forestFightersQualifies({ isRanged: false }), false);
    assert.equal(forestFightersQualifies({ isRanged: false, attackerConditions: null }), false);
  });
  it('no args → false', () => {
    assert.equal(forestFightersQualifies(), false);
  });
});

describe('PROBE-FOREST-FIGHTERS-004: applyForestFightersHit math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyForestFightersHit({ bonusHits: 0 }), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('stacks on prior bonus hits', () => {
    assert.deepStrictEqual(applyForestFightersHit({ bonusHits: 3 }), {
      applied: true,
      bonusHits: 4,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyForestFightersHit(), { applied: true, bonusHits: 1 });
    assert.deepStrictEqual(applyForestFightersHit({ bonusHits: null }), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusHits: 2 };
    applyForestFightersHit(input);
    assert.deepStrictEqual(input, { bonusHits: 2 });
  });
});

describe('PROBE-FOREST-FIGHTERS-005: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.forest_fighters;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references forest_fighters', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('forest_fighters'),
    );
    assert.ok(refs.length > 0);
  });
});
