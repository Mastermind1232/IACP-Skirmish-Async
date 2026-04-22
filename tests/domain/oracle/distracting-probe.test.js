/**
 * PROBE-DISTRACTING: Han Solo's and C-3PO's **Distracting**.
 *
 * Card text: "While a friendly figure is defending, and you are
 *  adjacent to the targeted space, apply +1 Evade to the defense
 *  results."
 *
 * Shared +1 Evade across both slugs. Adjacency + Rogue Smuggler
 * negation stay handler-owned (they need map + attachment lookup).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasDistractingAbility,
  applyDistractingEvade,
  DISTRACTING_ABILITY_IDS,
  DISTRACTING_EVADE_DELTA,
} from '../../../src/game/distracting-helpers.js';

describe('PROBE-DISTRACTING-001: constants', () => {
  it('exports both slugs', () => {
    assert.deepStrictEqual([...DISTRACTING_ABILITY_IDS].sort(), [
      'distracting_c3po',
      'distracting_han',
    ]);
  });
  it('slug list is frozen', () => {
    assert.ok(Object.isFrozen(DISTRACTING_ABILITY_IDS));
  });
  it('evade delta = +1', () => {
    assert.equal(DISTRACTING_EVADE_DELTA, 1);
  });
});

describe('PROBE-DISTRACTING-002: hasDistractingAbility', () => {
  it('han slug → true', () => {
    assert.equal(hasDistractingAbility(['distracting_han']), true);
  });
  it('c3po slug → true', () => {
    assert.equal(hasDistractingAbility(['distracting_c3po']), true);
  });
  it('other slug only → false', () => {
    assert.equal(hasDistractingAbility(['cunning_han']), false);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasDistractingAbility([]), false);
    assert.equal(hasDistractingAbility(null), false);
    assert.equal(hasDistractingAbility('distracting_han'), false);
  });
});

describe('PROBE-DISTRACTING-003: applyDistractingEvade math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyDistractingEvade({ bonusEvade: 0 }), {
      applied: true,
      bonusEvade: 1,
    });
  });
  it('stacks on existing bonus evade', () => {
    assert.deepStrictEqual(applyDistractingEvade({ bonusEvade: 2 }), {
      applied: true,
      bonusEvade: 3,
    });
  });
  it('cancels negative existing bonus evade', () => {
    assert.deepStrictEqual(applyDistractingEvade({ bonusEvade: -1 }), {
      applied: true,
      bonusEvade: 0,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyDistractingEvade(), { applied: true, bonusEvade: 1 });
    assert.deepStrictEqual(applyDistractingEvade({ bonusEvade: null }), {
      applied: true,
      bonusEvade: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusEvade: 3 };
    applyDistractingEvade(input);
    assert.deepStrictEqual(input, { bonusEvade: 3 });
  });
});

describe('PROBE-DISTRACTING-004: library + dc-effects wiring', () => {
  for (const slug of ['distracting_han', 'distracting_c3po']) {
    it(`${slug} library entry wired`, async () => {
      const { readFile } = await import('node:fs/promises');
      const lib = JSON.parse(
        await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
      );
      const e = lib.abilities?.[slug];
      assert.ok(e);
      assert.equal(e.wiredStatus, 'wired');
      assert.match(e.label || '', /Distracting/i);
    });
  }
  it('Han Solo references distracting_han', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Han Solo'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('distracting_han'));
  });
  it('C-3P0 references distracting_c3po', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    // DC name uses a zero ('0'), not letter 'O' — pinned here.
    const dc = effects.cards?.['C-3P0'];
    assert.ok(dc, 'expected DC "C-3P0" (zero) to exist');
    assert.ok((dc.specialAbilityIds || []).includes('distracting_c3po'));
  });
});
