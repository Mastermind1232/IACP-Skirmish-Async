/**
 * PROBE-ADAPT-BLAISE: Agent Blaise's **Adapt**.
 *
 * Card text: "The first time your opponent plays a Command card each
 *  round, choose 1 SPY or TROOPER. That figure becomes Hidden"
 *
 * Reminder-only wiring. This probe pins the slug contract, the DC
 * reference, and carries a LATENT tripwire for the library/DC text
 * mismatch (library says "choose a trait", DC says SPY/TROOPER →
 * Hidden). Cross-ref: memory/project_latent_bugs_probe_grind.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAdaptBlaiseAbility,
  ADAPT_BLAISE_ABILITY_ID,
} from '../../../src/game/adapt-blaise-helpers.js';

describe('PROBE-ADAPT-BLAISE-001: constants', () => {
  it('ability id = adapt_blaise', () => {
    assert.equal(ADAPT_BLAISE_ABILITY_ID, 'adapt_blaise');
  });
});

describe('PROBE-ADAPT-BLAISE-002: hasAdaptBlaiseAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasAdaptBlaiseAbility(['adapt_blaise']), true);
  });
  it('slug missing → false', () => {
    assert.equal(hasAdaptBlaiseAbility(['focus']), false);
    assert.equal(hasAdaptBlaiseAbility([]), false);
  });
  it('non-array → false', () => {
    assert.equal(hasAdaptBlaiseAbility(null), false);
    assert.equal(hasAdaptBlaiseAbility('adapt_blaise'), false);
  });
});

describe('PROBE-ADAPT-BLAISE-003: library + dc-effects wiring', () => {
  it('adapt_blaise library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.adapt_blaise;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Adapt/i);
  });

  it('Agent Blaise DC references adapt_blaise', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Agent Blaise'];
    assert.ok(dc, 'Agent Blaise DC must exist');
    assert.ok((dc.specialAbilityIds || []).includes('adapt_blaise'));
  });
});

describe('PROBE-ADAPT-BLAISE-004: reminder-only wiring', () => {
  it('activation-setup emits a reminder when slug present', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/engine/activation-setup.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /adapt_blaise/);
    assert.match(src, /\*\*Adapt\*\*/);
  });
});

describe('LATENT-ADAPT-BLAISE: library/DC-text mismatch', () => {
  it('LATENT: library description says "trait" but DC text says SPY/TROOPER + Hidden', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const libDesc = (lib.abilities?.adapt_blaise?.description || '').toLowerCase();
    const dcText = (effects.cards?.['Agent Blaise']?.abilityText || '').toLowerCase();

    // Library: generic Adapt (trait grant). DC: Blaise-specific (SPY/TROOPER → Hidden).
    // These describe fundamentally different rules. Tripwire fails the moment
    // anyone rewrites one to match the other, forcing conscious alignment.
    assert.match(libDesc, /trait/, 'library still describes generic trait-grant');
    assert.match(dcText, /spy or trooper/, 'DC text still says SPY or TROOPER');
    assert.match(dcText, /hidden/, 'DC text still says Hidden');
    assert.ok(
      !libDesc.includes('spy or trooper') && !libDesc.includes('hidden'),
      'library description still does not reflect Blaise-specific rules',
    );
  });
});
