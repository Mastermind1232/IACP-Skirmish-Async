/**
 * PROBE-FIND-WEAKNESS: Scout Trooper (Elite)'s **Find Weakness**.
 *
 * Card text: "While attacking, apply +3 Accuracy and -1 Evade to
 *  the results."
 *
 * LATENT — handler currently only applies the -1 Evade portion.
 * The +3 Accuracy is unwired (handler comment says "accuracy
 * handled via passives" but no such passive exists). Tracked via
 * LATENT-FIND-WEAKNESS-ACC tripwire below.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFindWeaknessAbility,
  applyFindWeaknessEvade,
  FIND_WEAKNESS_ABILITY_ID,
  FIND_WEAKNESS_EVADE_DELTA,
} from '../../../src/game/find-weakness-helpers.js';

describe('PROBE-FIND-WEAKNESS-001: constants', () => {
  it('ability id', () => {
    assert.equal(FIND_WEAKNESS_ABILITY_ID, 'find_weakness');
  });
  it('evade delta = -1 (acc portion unwired — see LATENT)', () => {
    assert.equal(FIND_WEAKNESS_EVADE_DELTA, -1);
  });
});

describe('PROBE-FIND-WEAKNESS-002: hasFindWeaknessAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasFindWeaknessAbility(['find_weakness']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasFindWeaknessAbility([]), false);
    assert.equal(hasFindWeaknessAbility(null), false);
    assert.equal(hasFindWeaknessAbility('find_weakness'), false);
  });
});

describe('PROBE-FIND-WEAKNESS-003: applyFindWeaknessEvade math', () => {
  it('zero existing → -1', () => {
    assert.deepStrictEqual(applyFindWeaknessEvade({ bonusEvade: 0 }), {
      applied: true,
      bonusEvade: -1,
    });
  });
  it('stacks past -1', () => {
    assert.deepStrictEqual(applyFindWeaknessEvade({ bonusEvade: -2 }), {
      applied: true,
      bonusEvade: -3,
    });
  });
  it('cancels positive bonus evade', () => {
    assert.deepStrictEqual(applyFindWeaknessEvade({ bonusEvade: 3 }), {
      applied: true,
      bonusEvade: 2,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyFindWeaknessEvade(), { applied: true, bonusEvade: -1 });
    assert.deepStrictEqual(applyFindWeaknessEvade({ bonusEvade: null }), {
      applied: true,
      bonusEvade: -1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusEvade: 2 };
    applyFindWeaknessEvade(input);
    assert.deepStrictEqual(input, { bonusEvade: 2 });
  });
});

describe('PROBE-FIND-WEAKNESS-004: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.find_weakness;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Find Weakness/i);
  });
  it('Scout Trooper (Elite) references find_weakness', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Scout Trooper (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('find_weakness'));
  });
  it('LATENT-FIND-WEAKNESS-ACC: abilityText promises +3 Accuracy that handler does not apply', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Scout Trooper (Elite)'];
    assert.ok(dc);
    // Pin the +3 Accuracy wording so a future fix / text change forces
    // the tripwire to be re-evaluated. When the handler finally wires
    // the accuracy portion, this assertion still passes (wording is
    // preserved) and the LATENT can be promoted to a behavioral test.
    assert.match(dc.abilityText || '', /\+3 Accuracy/i);
    assert.match(dc.abilityText || '', /-1 Evade/i);
  });
});
