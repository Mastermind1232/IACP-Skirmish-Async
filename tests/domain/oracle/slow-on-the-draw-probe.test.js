/**
 * PROBE-SLOW-ON-THE-DRAW: Greedo's **Slow on the Draw**.
 *
 * Card text: "When Greedo declares an attack, the targeted figure's
 *  owner may interrupt to perform an attack targeting Greedo first."
 *
 * Helper owns slug id + predicate. Pending-state wiring, button row,
 * and async prompt stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSlowOnTheDrawAbility,
  SLOW_ON_THE_DRAW_ABILITY_ID,
} from '../../../src/game/slow-on-the-draw-helpers.js';

describe('PROBE-SLOW-ON-THE-DRAW-001: constants', () => {
  it('ability id', () => {
    assert.equal(SLOW_ON_THE_DRAW_ABILITY_ID, 'slow_on_the_draw_greedo');
  });
});

describe('PROBE-SLOW-ON-THE-DRAW-002: hasSlowOnTheDrawAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasSlowOnTheDrawAbility(['slow_on_the_draw_greedo']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasSlowOnTheDrawAbility([]), false);
    assert.equal(hasSlowOnTheDrawAbility(['full_of_rage']), false);
    assert.equal(hasSlowOnTheDrawAbility(null), false);
    assert.equal(hasSlowOnTheDrawAbility('slow_on_the_draw_greedo'), false);
  });
});

describe('PROBE-SLOW-ON-THE-DRAW-003: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.slow_on_the_draw_greedo;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references slow_on_the_draw_greedo', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('slow_on_the_draw_greedo'),
    );
    assert.ok(refs.length > 0);
  });
});
