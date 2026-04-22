/**
 * PROBE-ILLICIT-ARMS: Bib Fortuna's **Illicit Arms**.
 *
 * Card text: "While a friendly figure is attacking, if army
 *  affiliation is Scum, you may discard 1 Command card from your
 *  hand to apply +1 Hit to the attack (once per attack)."
 *
 * Helper owns slug id, required-affiliation, +1 Hit bonus, and the
 * per-figure eligibility predicate. Friendly-scan, hand lookup,
 * state write, and button UI stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasIllicitArmsAbility,
  isIllicitArmsEligibleFigure,
  ILLICIT_ARMS_ABILITY_ID,
  ILLICIT_ARMS_REQUIRED_AFFILIATION,
  ILLICIT_ARMS_HIT_BONUS,
} from '../../../src/game/illicit-arms-helpers.js';

describe('PROBE-ILLICIT-ARMS-001: constants', () => {
  it('ability id', () => {
    assert.equal(ILLICIT_ARMS_ABILITY_ID, 'illicit_arms_bib');
  });
  it('required affiliation = scum', () => {
    assert.equal(ILLICIT_ARMS_REQUIRED_AFFILIATION, 'scum');
  });
  it('hit bonus = 1', () => {
    assert.equal(ILLICIT_ARMS_HIT_BONUS, 1);
  });
});

describe('PROBE-ILLICIT-ARMS-002: hasIllicitArmsAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasIllicitArmsAbility(['illicit_arms_bib']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasIllicitArmsAbility([]), false);
    assert.equal(hasIllicitArmsAbility(['full_of_rage']), false);
    assert.equal(hasIllicitArmsAbility(null), false);
    assert.equal(hasIllicitArmsAbility('illicit_arms_bib'), false);
  });
});

describe('PROBE-ILLICIT-ARMS-003: isIllicitArmsEligibleFigure', () => {
  it('Scum figure with slug → true', () => {
    assert.equal(
      isIllicitArmsEligibleFigure({
        specialAbilityIds: ['illicit_arms_bib'],
        affiliation: 'Scum',
      }),
      true,
    );
  });
  it('affiliation case-insensitive', () => {
    for (const aff of ['scum', 'SCUM', 'Scum', 'sCuM']) {
      assert.equal(
        isIllicitArmsEligibleFigure({
          specialAbilityIds: ['illicit_arms_bib'],
          affiliation: aff,
        }),
        true,
        `aff=${aff}`,
      );
    }
  });
  it('non-Scum affiliation → false', () => {
    for (const aff of ['Rebel', 'Imperial', 'Mercenary', 'Merc', '']) {
      assert.equal(
        isIllicitArmsEligibleFigure({
          specialAbilityIds: ['illicit_arms_bib'],
          affiliation: aff,
        }),
        false,
        `aff=${aff}`,
      );
    }
  });
  it('missing slug → false even if Scum', () => {
    assert.equal(
      isIllicitArmsEligibleFigure({
        specialAbilityIds: ['full_of_rage'],
        affiliation: 'Scum',
      }),
      false,
    );
  });
  it('null / undefined effects → false', () => {
    assert.equal(isIllicitArmsEligibleFigure(null), false);
    assert.equal(isIllicitArmsEligibleFigure(undefined), false);
  });
});

describe('PROBE-ILLICIT-ARMS-004: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.illicit_arms_bib;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references illicit_arms_bib', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('illicit_arms_bib'),
    );
    assert.ok(refs.length > 0);
  });
});
