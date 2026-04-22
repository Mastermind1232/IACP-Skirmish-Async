/**
 * PROBE-CORTOSIS-WEAVE: Echo Base Trooper (Elite)'s **Cortosis Weave**.
 *
 * Card text: "While defending, reduce Pierce by 2."
 *
 * Modeled as bonusPierce -= 2 on pendingCombat. The engine clamps
 * effective Pierce at min 0 elsewhere; this helper owns only the raw
 * subtraction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCortosisWeaveAbility,
  applyCortosisWeave,
  CORTOSIS_WEAVE_ABILITY_ID,
  CORTOSIS_WEAVE_PIERCE_DELTA,
} from '../../../src/game/cortosis-weave-helpers.js';

describe('PROBE-CORTOSIS-WEAVE-001: constants', () => {
  it('ability id', () => {
    assert.equal(CORTOSIS_WEAVE_ABILITY_ID, 'cortosis_weave');
  });
  it('pierce delta = -2', () => {
    assert.equal(CORTOSIS_WEAVE_PIERCE_DELTA, -2);
  });
});

describe('PROBE-CORTOSIS-WEAVE-002: hasCortosisWeaveAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasCortosisWeaveAbility(['cortosis_weave']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasCortosisWeaveAbility([]), false);
    assert.equal(hasCortosisWeaveAbility(null), false);
    assert.equal(hasCortosisWeaveAbility('cortosis_weave'), false);
  });
});

describe('PROBE-CORTOSIS-WEAVE-003: applyCortosisWeave math', () => {
  it('zero existing → -2', () => {
    assert.deepStrictEqual(applyCortosisWeave({ bonusPierce: 0 }), {
      applied: true,
      bonusPierce: -2,
    });
  });
  it('cancels +2 Pierce fully', () => {
    assert.deepStrictEqual(applyCortosisWeave({ bonusPierce: 2 }), {
      applied: true,
      bonusPierce: 0,
    });
  });
  it('partially cancels +5 Pierce', () => {
    assert.deepStrictEqual(applyCortosisWeave({ bonusPierce: 5 }), {
      applied: true,
      bonusPierce: 3,
    });
  });
  it('stacks past -2 when already negative', () => {
    assert.deepStrictEqual(applyCortosisWeave({ bonusPierce: -1 }), {
      applied: true,
      bonusPierce: -3,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyCortosisWeave(), { applied: true, bonusPierce: -2 });
    assert.deepStrictEqual(applyCortosisWeave({ bonusPierce: null }), {
      applied: true,
      bonusPierce: -2,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusPierce: 4 };
    applyCortosisWeave(input);
    assert.deepStrictEqual(input, { bonusPierce: 4 });
  });
});

describe('PROBE-CORTOSIS-WEAVE-004: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.cortosis_weave;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Cortosis Weave/i);
  });
  it('Echo Base Trooper (Elite) references cortosis_weave', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Echo Base Trooper (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('cortosis_weave'));
  });
});
