/**
 * PROBE-MODULAR-HSE: Heavy Stormtrooper (Elite)'s **Modular**.
 *
 * Card text: "You may include an attachment at -1 cost."
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom was structural-only
 * with the discount math inlined in validation.js. Pure helper
 * extracted to src/game/modular-hse-helpers.js; validateDeckLegal now
 * delegates via modularDiscountDelta.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  modularDiscountApplies,
  modularDiscountDelta,
  MODULAR_HSE_NAME,
  MODULAR_DISCOUNT,
} from '../../../src/game/modular-hse-helpers.js';
import { validateDeckLegal, validateArmyAffiliation } from '../../../src/game/validation.js';
import { getDcEffects } from '../../../src/data-loader.js';

let DC_EFFECTS;
before(() => {
  DC_EFFECTS = getDcEffects();
});

describe('PROBE-MODULAR-HSE-001: discount predicate', () => {
  it('HSE + attachment → applies', () => {
    const list = ['Heavy Stormtrooper (Elite)', '[Cross Training]'];
    assert.equal(modularDiscountApplies(list, DC_EFFECTS), true);
  });

  it('HSE without any attachment → does NOT apply', () => {
    const list = ['Heavy Stormtrooper (Elite)', 'Stormtrooper (Regular)'];
    assert.equal(modularDiscountApplies(list, DC_EFFECTS), false);
  });

  it('attachment without HSE → does NOT apply', () => {
    const list = ['Stormtrooper (Regular)', '[Cross Training]'];
    assert.equal(modularDiscountApplies(list, DC_EFFECTS), false);
  });

  it('empty army → does NOT apply', () => {
    assert.equal(modularDiscountApplies([], DC_EFFECTS), false);
    assert.equal(modularDiscountApplies(null, DC_EFFECTS), false);
  });

  it('object form DC entries resolved via dcName/displayName', () => {
    const list = [{ dcName: 'Heavy Stormtrooper (Elite)' }, { dcName: '[Cross Training]' }];
    assert.equal(modularDiscountApplies(list, DC_EFFECTS), true);
  });
});

describe('PROBE-MODULAR-HSE-002: discount delta', () => {
  it('applies → delta = MODULAR_DISCOUNT (1)', () => {
    const list = ['Heavy Stormtrooper (Elite)', '[Cross Training]'];
    assert.equal(modularDiscountDelta(list, DC_EFFECTS), MODULAR_DISCOUNT);
    assert.equal(MODULAR_DISCOUNT, 1);
  });

  it('does not apply → delta = 0', () => {
    const list = ['Stormtrooper (Regular)'];
    assert.equal(modularDiscountDelta(list, DC_EFFECTS), 0);
  });

  it('multiple attachments do NOT double the discount (rule text says "an attachment")', () => {
    const list = ['Heavy Stormtrooper (Elite)', '[Cross Training]', '[Combat Suit]'];
    // Modular grants -1 once regardless of attachment count.
    assert.equal(modularDiscountDelta(list, DC_EFFECTS), MODULAR_DISCOUNT);
  });

  it('exported HSE name constant is canonical key', () => {
    assert.equal(MODULAR_HSE_NAME, 'Heavy Stormtrooper (Elite)');
  });
});

describe('PROBE-MODULAR-HSE-003: library entry wired', () => {
  it('modular_heavy_stormtrooper entry exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.modular_heavy_stormtrooper;
    assert.ok(entry);
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Modular');
  });

  it('dc-effects.json wires HSE to modular_heavy_stormtrooper', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'));
    const hse = effects.cards?.['Heavy Stormtrooper (Elite)'];
    assert.ok(hse);
    assert.ok(
      (hse.specialAbilityIds || []).includes('modular_heavy_stormtrooper'),
      'HSE must reference modular_heavy_stormtrooper',
    );
  });
});

describe('PROBE-MODULAR-HSE-004: validateDeckLegal applies the discount', () => {
  // Baseline: same army without HSE or attachment; observe dcTotal. With HSE +
  // attachment, dcTotal should drop by exactly 1.

  it('HSE + Cross Training reduces dcTotal by 1 vs. non-HSE-attached equivalent', () => {
    const withHSE = validateDeckLegal({
      dcList: ['Heavy Stormtrooper (Elite)', '[Cross Training]'],
      ccList: [],
    });
    const withoutHSE = validateDeckLegal({
      dcList: ['Stormtrooper (Regular)', '[Cross Training]'],
      ccList: [],
    });
    // HSE(8) + Cross Training(1) - 1 = 8 vs. Stormtrooper Reg(6) + Cross Training(1) = 7.
    // Adding HSE subtracts exactly 1 from the otherwise-raw sum.
    assert.equal(withHSE.dcTotal, 8);
    assert.equal(withoutHSE.dcTotal, 7);
  });

  it('HSE without any attachment: no discount applied (dcTotal = raw HSE cost)', () => {
    const r = validateDeckLegal({
      dcList: ['Heavy Stormtrooper (Elite)'],
      ccList: [],
    });
    assert.equal(r.dcTotal, 8);
  });
});

describe('PROBE-MODULAR-HSE-005: validateArmyAffiliation emits a warning naming the discounted attachment', () => {
  it('Modular warning is present when HSE + attachment', () => {
    const { warnings } = validateArmyAffiliation({
      dcList: ['Heavy Stormtrooper (Elite)', '[Cross Training]', 'Stormtrooper (Regular)'],
    });
    const modWarn = warnings.find((w) => /Modular/.test(w) && /Cross Training/.test(w));
    assert.ok(modWarn, `expected Modular/Cross Training warning; got: ${JSON.stringify(warnings)}`);
  });

  it('no warning without attachment', () => {
    const { warnings } = validateArmyAffiliation({
      dcList: ['Heavy Stormtrooper (Elite)', 'Stormtrooper (Regular)'],
    });
    const modWarn = warnings.find((w) => /Modular/.test(w));
    assert.equal(modWarn, undefined);
  });
});
