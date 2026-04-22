/**
 * PROBE-ADV-TARGETING-COMPUTER: Dark Trooper Mk III's **Advanced
 * Targeting Computer**.
 *
 * Card text: "While attacking, become Focused. If you resolve an
 *  attack die reroll that results in fewer Hits on that die, apply
 *  +1 Hit to the attack results."
 *
 * Helper owns slug, Focus/green-die parameters, reroll-hit
 * comparison, and +1 Hit delta. The once-per-attack latch
 * (advTcBonusApplied) and the applyConditionWithDie engine call
 * stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAdvTargetingComputerAbility,
  advTcRerollLostHits,
  applyAdvTcHitBonus,
  ADV_TARGETING_COMPUTER_ABILITY_ID,
  ADV_TARGETING_COMPUTER_CONDITION,
  ADV_TARGETING_COMPUTER_BONUS_DIE,
  ADV_TARGETING_COMPUTER_HIT_DELTA,
} from '../../../src/game/adv-targeting-computer-helpers.js';

describe('PROBE-ATC-001: constants', () => {
  it('ability id', () => {
    assert.equal(ADV_TARGETING_COMPUTER_ABILITY_ID, 'adv_targeting_computer_dark_trooper');
  });
  it('condition = Focus', () => {
    assert.equal(ADV_TARGETING_COMPUTER_CONDITION, 'Focus');
  });
  it('bonus die = green', () => {
    assert.equal(ADV_TARGETING_COMPUTER_BONUS_DIE, 'green');
  });
  it('hit delta = +1', () => {
    assert.equal(ADV_TARGETING_COMPUTER_HIT_DELTA, 1);
  });
});

describe('PROBE-ATC-002: hasAdvTargetingComputerAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasAdvTargetingComputerAbility(['adv_targeting_computer_dark_trooper']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasAdvTargetingComputerAbility([]), false);
    assert.equal(hasAdvTargetingComputerAbility(null), false);
    assert.equal(hasAdvTargetingComputerAbility('adv_targeting_computer_dark_trooper'), false);
  });
});

describe('PROBE-ATC-003: advTcRerollLostHits', () => {
  it('newDmg < oldDmg → true (hits lost on reroll)', () => {
    assert.equal(advTcRerollLostHits({ dmg: 3 }, { dmg: 1 }), true);
    assert.equal(advTcRerollLostHits({ dmg: 1 }, { dmg: 0 }), true);
  });
  it('newDmg == oldDmg → false (strict less-than)', () => {
    assert.equal(advTcRerollLostHits({ dmg: 2 }, { dmg: 2 }), false);
    assert.equal(advTcRerollLostHits({ dmg: 0 }, { dmg: 0 }), false);
  });
  it('newDmg > oldDmg → false (more hits on reroll)', () => {
    assert.equal(advTcRerollLostHits({ dmg: 1 }, { dmg: 2 }), false);
  });
  it('missing dmg fields treated as 0', () => {
    assert.equal(advTcRerollLostHits({}, {}), false);
    assert.equal(advTcRerollLostHits({ dmg: 2 }, {}), true);
    assert.equal(advTcRerollLostHits(null, { dmg: 1 }), false);
  });
});

describe('PROBE-ATC-004: applyAdvTcHitBonus math', () => {
  it('zero existing → +1', () => {
    assert.deepStrictEqual(applyAdvTcHitBonus({ bonusHits: 0 }), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('stacks on prior bonus hits', () => {
    assert.deepStrictEqual(applyAdvTcHitBonus({ bonusHits: 4 }), {
      applied: true,
      bonusHits: 5,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyAdvTcHitBonus(), { applied: true, bonusHits: 1 });
    assert.deepStrictEqual(applyAdvTcHitBonus({ bonusHits: null }), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusHits: 1 };
    applyAdvTcHitBonus(input);
    assert.deepStrictEqual(input, { bonusHits: 1 });
  });
});

describe('PROBE-ATC-005: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.adv_targeting_computer_dark_trooper;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least one DC references adv_targeting_computer_dark_trooper', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('adv_targeting_computer_dark_trooper'),
    );
    assert.ok(refs.length > 0);
  });
});
