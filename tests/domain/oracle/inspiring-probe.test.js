/**
 * PROBE-INSPIRING: Luke Skywalker's **Inspiring**.
 *
 * Card text: "While another friendly figure within 3 spaces is
 *  attacking, it may reroll 1 die."
 *
 * Helper covers predicate + range constant + reroll math.
 * Adjacency/spatial lookup stays handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasInspiringAbility,
  applyInspiringReroll,
  INSPIRING_ABILITY_ID,
  INSPIRING_RANGE,
  INSPIRING_REROLLS,
} from '../../../src/game/inspiring-helpers.js';

describe('PROBE-INSPIRING-001: constants', () => {
  it('ability id', () => {
    assert.equal(INSPIRING_ABILITY_ID, 'inspiring');
  });
  it('range = 3', () => {
    assert.equal(INSPIRING_RANGE, 3);
  });
  it('rerolls = 1', () => {
    assert.equal(INSPIRING_REROLLS, 1);
  });
});

describe('PROBE-INSPIRING-002: hasInspiringAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasInspiringAbility(['inspiring']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasInspiringAbility([]), false);
    assert.equal(hasInspiringAbility(null), false);
    assert.equal(hasInspiringAbility('inspiring'), false);
  });
});

describe('PROBE-INSPIRING-003: applyInspiringReroll math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyInspiringReroll({ atkSpecialReroll: 0 }), {
      applied: true,
      atkSpecialReroll: 1,
    });
  });
  it('stacks on prior rerolls', () => {
    assert.deepStrictEqual(applyInspiringReroll({ atkSpecialReroll: 2 }), {
      applied: true,
      atkSpecialReroll: 3,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyInspiringReroll(), { applied: true, atkSpecialReroll: 1 });
    assert.deepStrictEqual(applyInspiringReroll({ atkSpecialReroll: null }), {
      applied: true,
      atkSpecialReroll: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { atkSpecialReroll: 4 };
    applyInspiringReroll(input);
    assert.deepStrictEqual(input, { atkSpecialReroll: 4 });
  });
});

describe('PROBE-INSPIRING-004: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.inspiring;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Inspiring/i);
  });
  it('at least one DC references inspiring', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('inspiring'),
    );
    assert.ok(refs.length > 0, 'expected at least one DC to reference inspiring');
  });
});
