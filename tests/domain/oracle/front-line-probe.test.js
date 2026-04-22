/**
 * PROBE-FRONT-LINE: Echo Base Trooper's **Front Line**.
 *
 * Card text: "While attacking within 3 spaces, replace 1 blue die
 *  with 1 red die."
 *
 * Helper owns predicate + range gate + die-swap. Distance and
 * attack-die pool are engine-owned inputs; the helper is pure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFrontLineAbility,
  frontLineInRange,
  applyFrontLineDieSwap,
  FRONT_LINE_ABILITY_ID,
  FRONT_LINE_MAX_DISTANCE,
} from '../../../src/game/front-line-helpers.js';

describe('PROBE-FRONT-LINE-001: constants', () => {
  it('ability id', () => {
    assert.equal(FRONT_LINE_ABILITY_ID, 'front_line');
  });
  it('max distance = 3', () => {
    assert.equal(FRONT_LINE_MAX_DISTANCE, 3);
  });
});

describe('PROBE-FRONT-LINE-002: hasFrontLineAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasFrontLineAbility(['front_line']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasFrontLineAbility([]), false);
    assert.equal(hasFrontLineAbility(null), false);
    assert.equal(hasFrontLineAbility('front_line'), false);
  });
});

describe('PROBE-FRONT-LINE-003: frontLineInRange', () => {
  it('distances 0..3 → in range', () => {
    for (const d of [0, 1, 2, 3]) {
      assert.equal(frontLineInRange(d), true, `d=${d}`);
    }
  });
  it('distance 4+ → out of range', () => {
    assert.equal(frontLineInRange(4), false);
    assert.equal(frontLineInRange(10), false);
  });
  it('non-number → false', () => {
    assert.equal(frontLineInRange(null), false);
    assert.equal(frontLineInRange(undefined), false);
    assert.equal(frontLineInRange('2'), false);
  });
});

describe('PROBE-FRONT-LINE-004: applyFrontLineDieSwap math', () => {
  it('first blue swapped to red, rest untouched', () => {
    const r = applyFrontLineDieSwap(['blue', 'blue', 'green']);
    assert.deepStrictEqual(r, { applied: true, dice: ['red', 'blue', 'green'] });
  });
  it('only first blue swapped (left-to-right precedence)', () => {
    const r = applyFrontLineDieSwap(['green', 'blue', 'blue']);
    assert.deepStrictEqual(r, { applied: true, dice: ['green', 'red', 'blue'] });
  });
  it('no blue → no-op, applied=false', () => {
    const input = ['red', 'red', 'green'];
    const r = applyFrontLineDieSwap(input);
    assert.equal(r.applied, false);
    assert.strictEqual(r.dice, input);
  });
  it('empty pool → no-op', () => {
    const input = [];
    const r = applyFrontLineDieSwap(input);
    assert.equal(r.applied, false);
    assert.strictEqual(r.dice, input);
  });
  it('non-array → no-op, empty dice', () => {
    const r = applyFrontLineDieSwap(null);
    assert.deepStrictEqual(r, { applied: false, dice: [] });
  });
  it('pure: does not mutate input', () => {
    const input = ['blue', 'green'];
    applyFrontLineDieSwap(input);
    assert.deepStrictEqual(input, ['blue', 'green']);
  });
});

describe('PROBE-FRONT-LINE-005: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.front_line;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Front Line/i);
  });
  it('at least one DC references front_line', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('front_line'),
    );
    assert.ok(refs.length > 0, 'expected at least one DC to reference front_line');
  });
});
