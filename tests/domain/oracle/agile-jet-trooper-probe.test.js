/**
 * PROBE-AGILE-JET-TROOPER: Jet Trooper (Elite/Regular)'s **Agile**.
 *
 * Card text: "While defending, you may convert 1 Block to 1 Evade."
 *
 * Phase 2.2 medium-risk probe grind (2026-04-22). Atom was wired at
 * combat.js:4164 with predicate + conversion math inlined. Pure
 * helpers extracted to src/game/agile-jet-trooper-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAgileAbility,
  applyAgileConversion,
  AGILE_JET_TROOPER_ABILITY_IDS,
} from '../../../src/game/agile-jet-trooper-helpers.js';

describe('PROBE-AGILE-JET-TROOPER-001: ability ID constants', () => {
  it('exports elite + reg slugs', () => {
    assert.deepStrictEqual([...AGILE_JET_TROOPER_ABILITY_IDS].sort(), [
      'agile_jet_trooper_elite',
      'agile_jet_trooper_reg',
    ]);
  });

  it('the list is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(AGILE_JET_TROOPER_ABILITY_IDS));
  });
});

describe('PROBE-AGILE-JET-TROOPER-002: hasAgileAbility predicate', () => {
  it('elite id → true', () => {
    assert.equal(hasAgileAbility(['agile_jet_trooper_elite']), true);
  });
  it('regular id → true', () => {
    assert.equal(hasAgileAbility(['agile_jet_trooper_reg']), true);
  });
  it('mixed with other abilities → true', () => {
    assert.equal(hasAgileAbility(['fallen_master_malicos', 'agile_jet_trooper_reg']), true);
  });
  it('no agile ids → false', () => {
    assert.equal(hasAgileAbility(['fallen_master_malicos']), false);
  });
  it('empty list → false', () => {
    assert.equal(hasAgileAbility([]), false);
  });
  it('non-array input → false', () => {
    assert.equal(hasAgileAbility(null), false);
    assert.equal(hasAgileAbility(undefined), false);
    assert.equal(hasAgileAbility('agile_jet_trooper_elite'), false);
  });
});

describe('PROBE-AGILE-JET-TROOPER-003: applyAgileConversion math', () => {
  it('1 rolled Block, no bonuses → applied, bonusBlock -1, bonusEvade +1', () => {
    const r = applyAgileConversion({ block: 1, bonusBlock: 0, bonusEvade: 0 });
    assert.deepStrictEqual(r, { applied: true, bonusBlock: -1, bonusEvade: 1 });
  });

  it('0 rolled Block, 1 bonusBlock → applied (any Block source triggers)', () => {
    const r = applyAgileConversion({ block: 0, bonusBlock: 1, bonusEvade: 0 });
    assert.deepStrictEqual(r, { applied: true, bonusBlock: 0, bonusEvade: 1 });
  });

  it('2 rolled Block, 3 bonusBlock, 1 existing Evade → only 1 pair converted', () => {
    const r = applyAgileConversion({ block: 2, bonusBlock: 3, bonusEvade: 1 });
    assert.deepStrictEqual(r, { applied: true, bonusBlock: 2, bonusEvade: 2 });
  });

  it('zero Block anywhere → no-op, applied=false', () => {
    const r = applyAgileConversion({ block: 0, bonusBlock: 0, bonusEvade: 2 });
    assert.deepStrictEqual(r, { applied: false, bonusBlock: 0, bonusEvade: 2 });
  });

  it('negative bonusBlock going more negative is legal (net-out pattern)', () => {
    // After a prior defensive conversion, bonusBlock may be < 0 but
    // defenseRoll.block still reflects raw roll, so total Block may be positive.
    const r = applyAgileConversion({ block: 2, bonusBlock: -1, bonusEvade: 0 });
    assert.deepStrictEqual(r, { applied: true, bonusBlock: -2, bonusEvade: 1 });
  });

  it('missing fields default to 0', () => {
    assert.deepStrictEqual(applyAgileConversion({}), { applied: false, bonusBlock: 0, bonusEvade: 0 });
    assert.deepStrictEqual(applyAgileConversion(), { applied: false, bonusBlock: 0, bonusEvade: 0 });
  });

  it('undefined/null fields treated as 0', () => {
    const r = applyAgileConversion({ block: null, bonusBlock: undefined, bonusEvade: 0 });
    assert.deepStrictEqual(r, { applied: false, bonusBlock: 0, bonusEvade: 0 });
  });

  it('pure: does not mutate input', () => {
    const input = { block: 1, bonusBlock: 0, bonusEvade: 0 };
    applyAgileConversion(input);
    assert.deepStrictEqual(input, { block: 1, bonusBlock: 0, bonusEvade: 0 });
  });
});

describe('PROBE-AGILE-JET-TROOPER-004: library + dc-effects wiring', () => {
  it('agile_jet_trooper_elite exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.agile_jet_trooper_elite;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Agile/);
  });

  it('agile_jet_trooper_reg exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.agile_jet_trooper_reg;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });

  it('Jet Trooper (Elite) DC references the elite slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const jt = effects.cards?.['Jet Trooper (Elite)'];
    assert.ok(jt);
    assert.ok(
      (jt.specialAbilityIds || []).includes('agile_jet_trooper_elite'),
      'Jet Trooper (Elite) must reference agile_jet_trooper_elite',
    );
  });

  it('Jet Trooper (Regular) DC references the regular slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const jt = effects.cards?.['Jet Trooper (Regular)'];
    assert.ok(jt);
    assert.ok(
      (jt.specialAbilityIds || []).includes('agile_jet_trooper_reg'),
      'Jet Trooper (Regular) must reference agile_jet_trooper_reg',
    );
  });
});
