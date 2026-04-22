/**
 * PROBE-FURY: Wookiee Warrior **Fury** (Elite + Regular).
 *
 * Card text: "While attacking, if you have suffered 5 or more
 *  damage, apply +1 Surge to the attack results (Furious)."
 *
 * Helper owns the 2-slug family, damage gate (≥ 5), and the
 * +1 Surge bonus constant. State write (pendingCombat.furyBonus)
 * and display-line composition stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFuryAbility,
  furyDamageTriggered,
  FURY_ABILITY_IDS,
  FURY_MIN_DAMAGE,
  FURY_SURGE_BONUS,
} from '../../../src/game/fury-helpers.js';

describe('PROBE-FURY-001: constants', () => {
  it('ability id family = elite + regular', () => {
    assert.deepEqual([...FURY_ABILITY_IDS].sort(), [
      'fury_wookiee_elite',
      'fury_wookiee_reg',
    ]);
  });
  it('min damage = 5', () => {
    assert.equal(FURY_MIN_DAMAGE, 5);
  });
  it('surge bonus = 1', () => {
    assert.equal(FURY_SURGE_BONUS, 1);
  });
  it('ability id list is frozen', () => {
    assert.ok(Object.isFrozen(FURY_ABILITY_IDS));
  });
});

describe('PROBE-FURY-002: hasFuryAbility', () => {
  it('elite slug → true', () => {
    assert.equal(hasFuryAbility(['fury_wookiee_elite']), true);
  });
  it('regular slug → true', () => {
    assert.equal(hasFuryAbility(['fury_wookiee_reg']), true);
  });
  it('both slugs → true', () => {
    assert.equal(hasFuryAbility(['fury_wookiee_elite', 'fury_wookiee_reg']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasFuryAbility([]), false);
    assert.equal(hasFuryAbility(['full_of_rage']), false);
    assert.equal(hasFuryAbility(null), false);
    assert.equal(hasFuryAbility('fury_wookiee_elite'), false);
  });
});

describe('PROBE-FURY-003: furyDamageTriggered', () => {
  it('damage ≥ 5 → true', () => {
    for (const d of [5, 6, 10, 20]) {
      assert.equal(furyDamageTriggered(d), true, `d=${d}`);
    }
  });
  it('damage < 5 → false', () => {
    for (const d of [0, 1, 2, 3, 4]) {
      assert.equal(furyDamageTriggered(d), false, `d=${d}`);
    }
  });
  it('non-finite → false', () => {
    assert.equal(furyDamageTriggered(NaN), false);
    assert.equal(furyDamageTriggered(Infinity), false);
    assert.equal(furyDamageTriggered(undefined), false);
    assert.equal(furyDamageTriggered(null), false);
  });
});

describe('PROBE-FURY-004: library + DC wiring', () => {
  it('both library entries wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    for (const slug of FURY_ABILITY_IDS) {
      const e = lib.abilities?.[slug];
      assert.ok(e, `library entry missing: ${slug}`);
      assert.equal(e.wiredStatus, 'wired', `not wired: ${slug}`);
    }
  });
  it('at least one DC references the fury family', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).some(id => FURY_ABILITY_IDS.includes(id)),
    );
    assert.ok(refs.length > 0, 'no DC references any fury slug');
  });
});
