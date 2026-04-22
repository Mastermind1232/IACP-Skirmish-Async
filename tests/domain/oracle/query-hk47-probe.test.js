/**
 * PROBE-QUERY-HK47: HK-47's **Query**.
 *
 * Card text: "When declaring an attack, apply +1 Hit unless the
 *  defender becomes Bleeding."
 *
 * Helper covers the declare-time bonus + tracking flag. The
 * remove-on-Bleeding reversal lives in the surge pipeline and is
 * out of scope.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasQueryAbility,
  applyQueryBonus,
  QUERY_HK47_ABILITY_ID,
  QUERY_BONUS_HITS,
} from '../../../src/game/query-hk47-helpers.js';

describe('PROBE-QUERY-001: constants', () => {
  it('ability id', () => {
    assert.equal(QUERY_HK47_ABILITY_ID, 'query_hk47');
  });
  it('bonus = +1 Hit', () => {
    assert.equal(QUERY_BONUS_HITS, 1);
  });
});

describe('PROBE-QUERY-002: hasQueryAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasQueryAbility(['query_hk47']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasQueryAbility([]), false);
    assert.equal(hasQueryAbility(null), false);
    assert.equal(hasQueryAbility('query_hk47'), false);
  });
});

describe('PROBE-QUERY-003: applyQueryBonus math', () => {
  it('zero existing → +1 Hit, flag true', () => {
    assert.deepStrictEqual(applyQueryBonus({ bonusHits: 0 }), {
      applied: true,
      bonusHits: 1,
      queryBonusHitApplied: true,
    });
  });
  it('stacks on existing bonusHits', () => {
    assert.deepStrictEqual(applyQueryBonus({ bonusHits: 3 }), {
      applied: true,
      bonusHits: 4,
      queryBonusHitApplied: true,
    });
  });
  it('defaults / null → treated as 0, flag still true', () => {
    assert.deepStrictEqual(applyQueryBonus(), {
      applied: true,
      bonusHits: 1,
      queryBonusHitApplied: true,
    });
    assert.deepStrictEqual(applyQueryBonus({ bonusHits: null }), {
      applied: true,
      bonusHits: 1,
      queryBonusHitApplied: true,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusHits: 2 };
    applyQueryBonus(input);
    assert.deepStrictEqual(input, { bonusHits: 2 });
  });
});

describe('PROBE-QUERY-004: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.query_hk47;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Query/i);
  });
  it('HK-47 references query_hk47', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['HK-47'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('query_hk47'));
  });
});
