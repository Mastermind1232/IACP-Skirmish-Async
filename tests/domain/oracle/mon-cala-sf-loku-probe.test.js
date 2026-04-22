/**
 * PROBE-MON-CALA-SF-LOKU: **Mon Cala Special Forces** (Loku).
 *
 * Card text: "While Loku attacks a figure with a Recon Token, Loku
 *  becomes Focused."
 *
 * Helper owns slug id + Focus condition. The recon-token gate
 * (game.reconToken.figureKey === target.figureKey && same player)
 * and the applyCondition engine call stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasMonCalaSfLokuAbility,
  MON_CALA_SF_LOKU_ABILITY_ID,
  MON_CALA_SF_LOKU_CONDITION,
} from '../../../src/game/mon-cala-sf-loku-helpers.js';

describe('PROBE-MON-CALA-SF-LOKU-001: constants', () => {
  it('ability id', () => {
    assert.equal(MON_CALA_SF_LOKU_ABILITY_ID, 'mon_cala_sf_loku');
  });
  it('condition = Focus', () => {
    assert.equal(MON_CALA_SF_LOKU_CONDITION, 'Focus');
  });
});

describe('PROBE-MON-CALA-SF-LOKU-002: hasMonCalaSfLokuAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasMonCalaSfLokuAbility(['mon_cala_sf_loku']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasMonCalaSfLokuAbility([]), false);
    assert.equal(hasMonCalaSfLokuAbility(['full_of_rage']), false);
    assert.equal(hasMonCalaSfLokuAbility(null), false);
    assert.equal(hasMonCalaSfLokuAbility('mon_cala_sf_loku'), false);
  });
});

describe('PROBE-MON-CALA-SF-LOKU-003: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.mon_cala_sf_loku;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references mon_cala_sf_loku', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('mon_cala_sf_loku'),
    );
    assert.ok(refs.length > 0);
  });
});
