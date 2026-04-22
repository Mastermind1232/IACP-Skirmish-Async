/**
 * PROBE-HUNKER-DOWN: Cara Dune's **Hunker Down**.
 *
 * Card text: "While defending, if you share a corner or edge with
 *  a space containing blocking, impassable, or difficult terrain,
 *  apply +1 Evade to the defense results."
 *
 * Helper covers predicate, terrain classifier, and evade math.
 * Adjacency lookup + effective-terrain composition stay handler-
 * owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasHunkerDownAbility,
  hasQualifyingTerrainAdjacent,
  applyHunkerDownEvade,
  HUNKER_DOWN_ABILITY_ID,
  HUNKER_DOWN_EVADE_DELTA,
  HUNKER_DOWN_TERRAIN,
} from '../../../src/game/hunker-down-helpers.js';

describe('PROBE-HUNKER-DOWN-001: constants', () => {
  it('ability id', () => {
    assert.equal(HUNKER_DOWN_ABILITY_ID, 'hunker_down');
  });
  it('evade delta = +1', () => {
    assert.equal(HUNKER_DOWN_EVADE_DELTA, 1);
  });
  it('terrain list exactly [blocking, impassable, difficult] (frozen)', () => {
    assert.deepStrictEqual([...HUNKER_DOWN_TERRAIN].sort(), [
      'blocking',
      'difficult',
      'impassable',
    ]);
    assert.ok(Object.isFrozen(HUNKER_DOWN_TERRAIN));
  });
});

describe('PROBE-HUNKER-DOWN-002: hasHunkerDownAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasHunkerDownAbility(['hunker_down']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasHunkerDownAbility([]), false);
    assert.equal(hasHunkerDownAbility(null), false);
    assert.equal(hasHunkerDownAbility('hunker_down'), false);
  });
});

describe('PROBE-HUNKER-DOWN-003: hasQualifyingTerrainAdjacent', () => {
  it('adj to blocking → true', () => {
    const t = { a1: 'blocking', a2: 'normal' };
    assert.equal(hasQualifyingTerrainAdjacent(['a1', 'a2'], t), true);
  });
  it('adj to impassable → true', () => {
    assert.equal(hasQualifyingTerrainAdjacent(['x'], { x: 'impassable' }), true);
  });
  it('adj to difficult → true', () => {
    assert.equal(hasQualifyingTerrainAdjacent(['y'], { y: 'difficult' }), true);
  });
  it('case-insensitive terrain match', () => {
    assert.equal(hasQualifyingTerrainAdjacent(['p'], { p: 'BLOCKING' }), true);
  });
  it('only normal / missing terrain → false', () => {
    assert.equal(hasQualifyingTerrainAdjacent(['a', 'b'], { a: 'normal' }), false);
    assert.equal(hasQualifyingTerrainAdjacent(['a'], {}), false);
  });
  it('Set input works (real handler passes Set)', () => {
    const s = new Set(['a', 'b']);
    assert.equal(hasQualifyingTerrainAdjacent(s, { b: 'blocking' }), true);
  });
  it('empty / non-iterable → false', () => {
    assert.equal(hasQualifyingTerrainAdjacent([], {}), false);
    assert.equal(hasQualifyingTerrainAdjacent(null, { a: 'blocking' }), false);
  });
});

describe('PROBE-HUNKER-DOWN-004: applyHunkerDownEvade math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyHunkerDownEvade({ bonusEvade: 0 }), {
      applied: true,
      bonusEvade: 1,
    });
  });
  it('stacks on prior bonus evade', () => {
    assert.deepStrictEqual(applyHunkerDownEvade({ bonusEvade: 2 }), {
      applied: true,
      bonusEvade: 3,
    });
  });
  it('cancels negative bonus evade', () => {
    assert.deepStrictEqual(applyHunkerDownEvade({ bonusEvade: -1 }), {
      applied: true,
      bonusEvade: 0,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyHunkerDownEvade(), { applied: true, bonusEvade: 1 });
    assert.deepStrictEqual(applyHunkerDownEvade({ bonusEvade: null }), {
      applied: true,
      bonusEvade: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusEvade: 3 };
    applyHunkerDownEvade(input);
    assert.deepStrictEqual(input, { bonusEvade: 3 });
  });
});

describe('PROBE-HUNKER-DOWN-005: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.hunker_down;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Hunker Down/i);
  });
  it('at least one DC references hunker_down', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('hunker_down'),
    );
    assert.ok(refs.length > 0);
  });
});
