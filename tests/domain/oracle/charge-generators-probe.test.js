/**
 * PROBE-CHARGE-GENERATORS: AT-DP's **Charge Generators**.
 *
 * Card text: "While attacking, if you have suffered fewer than 9
 *  Damage, apply +1 Hit to the attack results and you may reroll 1
 *  attack die."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasChargeGeneratorsAbility,
  chargeGeneratorsApplies,
  applyChargeGeneratorsBonus,
  CHARGE_GENERATORS_ABILITY_ID,
  CHARGE_GENERATORS_DAMAGE_CAP,
  CHARGE_GENERATORS_BONUS_HITS,
  CHARGE_GENERATORS_REROLL,
} from '../../../src/game/charge-generators-helpers.js';

describe('PROBE-CHARGE-001: constants', () => {
  it('ability id', () => {
    assert.equal(CHARGE_GENERATORS_ABILITY_ID, 'charge_generators');
  });
  it('damage cap = 9 (strict <)', () => {
    assert.equal(CHARGE_GENERATORS_DAMAGE_CAP, 9);
  });
  it('bonuses', () => {
    assert.equal(CHARGE_GENERATORS_BONUS_HITS, 1);
    assert.equal(CHARGE_GENERATORS_REROLL, 1);
  });
});

describe('PROBE-CHARGE-002: hasChargeGeneratorsAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasChargeGeneratorsAbility(['charge_generators']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasChargeGeneratorsAbility([]), false);
    assert.equal(hasChargeGeneratorsAbility(null), false);
    assert.equal(hasChargeGeneratorsAbility('charge_generators'), false);
  });
});

describe('PROBE-CHARGE-003: damage-suffered gate', () => {
  it('0 damage → applies', () => {
    assert.equal(chargeGeneratorsApplies(0), true);
  });
  it('8 damage → applies (strict < 9)', () => {
    assert.equal(chargeGeneratorsApplies(8), true);
  });
  it('9 damage → does NOT apply (strict <)', () => {
    assert.equal(chargeGeneratorsApplies(9), false);
  });
  it('>9 damage → does NOT apply', () => {
    assert.equal(chargeGeneratorsApplies(100), false);
  });
  it('non-number → does NOT apply (safe default)', () => {
    assert.equal(chargeGeneratorsApplies(null), false);
    assert.equal(chargeGeneratorsApplies(undefined), false);
    assert.equal(chargeGeneratorsApplies('0'), false);
  });
});

describe('PROBE-CHARGE-004: applyChargeGeneratorsBonus math', () => {
  it('zero existing → +1 Hit +1 reroll', () => {
    assert.deepStrictEqual(applyChargeGeneratorsBonus({ bonusHits: 0 }, 0), {
      applied: true,
      bonusHits: 1,
      atkSpecialReroll: 1,
    });
  });
  it('stacks on existing bonuses', () => {
    assert.deepStrictEqual(applyChargeGeneratorsBonus({ bonusHits: 2 }, 3), {
      applied: true,
      bonusHits: 3,
      atkSpecialReroll: 4,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyChargeGeneratorsBonus(), {
      applied: true,
      bonusHits: 1,
      atkSpecialReroll: 1,
    });
    assert.deepStrictEqual(applyChargeGeneratorsBonus({ bonusHits: null }, null), {
      applied: true,
      bonusHits: 1,
      atkSpecialReroll: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusHits: 5 };
    applyChargeGeneratorsBonus(input, 7);
    assert.deepStrictEqual(input, { bonusHits: 5 });
  });
});

describe('PROBE-CHARGE-005: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.charge_generators;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Charge Generators/i);
  });
  it('AT-DP references charge_generators', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['AT-DP'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('charge_generators'));
  });
});
