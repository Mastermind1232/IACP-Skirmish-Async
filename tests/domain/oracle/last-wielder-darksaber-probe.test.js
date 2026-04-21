/**
 * PROBE-LAST-WIELDER-DARKSABER: Bo-Katan's **Last Wielder of the Darksaber**.
 *
 * Card text: "You may include 'The Darksaber' in your army. At the
 *  start of the round, you may attach it to this group."
 *
 * Mechanical effect at army-building time: bypasses the Darksaber's
 * printed "MAUL OR SABINE WREN ONLY" restriction, granting Bo-Katan
 * (and her group) eligibility for the attachment.
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom already had a pure
 * helper (`findEligibilityExtender` in src/game/validation.js) — this
 * probe adds direct helper coverage and end-to-end verification via
 * validateDeckLegal's attachment-warning path.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  findEligibilityExtender,
  validateDeckLegal,
} from '../../../src/game/validation.js';
import { getDcEffects } from '../../../src/data-loader.js';

let DC_EFFECTS;
before(() => {
  DC_EFFECTS = getDcEffects();
});

describe('PROBE-LAST-WIELDER-001: findEligibilityExtender resolves Darksaber for Bo-Katan', () => {
  it('Bo-Katan in the army → returns "Bo-Katan"', () => {
    const out = findEligibilityExtender('The Darksaber', ['Bo-Katan Kryze', 'Rebel Trooper'], DC_EFFECTS);
    assert.equal(out, 'Bo-Katan Kryze');
  });

  it('Bo-Katan NOT in the army → returns null', () => {
    const out = findEligibilityExtender('The Darksaber', ['Luke Skywalker', 'Rebel Trooper'], DC_EFFECTS);
    assert.equal(out, null);
  });

  it('non-matching attachment card → returns null (extender does not apply)', () => {
    const out = findEligibilityExtender('Vibrosword', ['Bo-Katan Kryze'], DC_EFFECTS);
    assert.equal(out, null);
  });

  it('empty / missing inputs handled safely', () => {
    assert.equal(findEligibilityExtender('', ['Bo-Katan Kryze'], DC_EFFECTS), null);
    assert.equal(findEligibilityExtender('The Darksaber', [], DC_EFFECTS), null);
    assert.equal(findEligibilityExtender('The Darksaber', null, DC_EFFECTS), null);
  });

  it('bracketed attachment form "[The Darksaber]" is also accepted', () => {
    const out = findEligibilityExtender('[The Darksaber]', ['Bo-Katan Kryze'], DC_EFFECTS);
    assert.equal(out, 'Bo-Katan Kryze');
  });
});

describe('PROBE-LAST-WIELDER-002: library entry metadata', () => {
  it('last_wielder_darksaber_bokatan lists The Darksaber + [The Darksaber] in extendsAttachmentEligibility', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.last_wielder_darksaber_bokatan;
    assert.ok(entry, 'last_wielder_darksaber_bokatan must exist');
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.type, 'dcPassive');
    assert.deepStrictEqual(entry.extendsAttachmentEligibility, ['The Darksaber', '[The Darksaber]']);
  });

  it('dc-effects.json wires Bo-Katan to last_wielder_darksaber_bokatan', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'));
    const boKatan = effects.cards?.['Bo-Katan Kryze'];
    assert.ok(boKatan, 'Bo-Katan DC must exist');
    assert.ok(
      (boKatan.specialAbilityIds || []).includes('last_wielder_darksaber_bokatan'),
      'Bo-Katan must reference last_wielder_darksaber_bokatan in specialAbilityIds',
    );
  });
});

describe('PROBE-LAST-WIELDER-003: validateDeckLegal attachment-warning integration', () => {
  // Minimal Scum army: Bo-Katan (12) + The Darksaber (1) + filler DCs totaling 40.
  // The goal is only to drive validateDeckLegal past attachment checks — we
  // grep the returned `warnings` / `errors` arrays for Darksaber-specific strings.

  it('Darksaber with Bo-Katan → NOT an error; emitted as a warning (eligibility extended)', () => {
    const squad = {
      dcList: ['Bo-Katan Kryze', '[The Darksaber]', 'IG-88', '4-LOM', 'HK-47'],
      ccList: [],
    };
    const result = validateDeckLegal(squad);
    const dsError = result.errors.find((e) => /Darksaber/i.test(e));
    assert.equal(dsError, undefined, `Darksaber should not produce a hard error with Bo-Katan; errors: ${JSON.stringify(result.errors)}`);
    const dsWarn = result.warnings.find((w) => /Darksaber/i.test(w));
    assert.ok(dsWarn, `expected Darksaber warning, got: ${JSON.stringify(result.warnings)}`);
  });

  it('Darksaber WITHOUT Bo-Katan (or Maul/Sabine) → hard error', () => {
    const squad = {
      dcList: ['Luke Skywalker', '[The Darksaber]', 'Rebel Trooper'],
      ccList: [],
    };
    const result = validateDeckLegal(squad);
    const dsError = result.errors.find((e) => /Darksaber/i.test(e));
    assert.ok(dsError, `expected a Darksaber hard error; errors: ${JSON.stringify(result.errors)}`);
  });
});
