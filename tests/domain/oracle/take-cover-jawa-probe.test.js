/**
 * PROBE-TAKE-COVER-JAWA: Jawa Scavenger (Elite/Regular)'s **Take Cover**.
 *
 * Card text: "While defending, apply +1 Block and -1 Evade to your
 *  defense results."
 *
 * Phase 2.2 medium-risk probe grind (2026-04-22). Atom wired at
 * combat.js:2099 with predicate + bonus inlined. Pure helpers
 * extracted to src/game/take-cover-jawa-helpers.js. Covers two atoms:
 * take_cover_jawa_elite + take_cover_jawa_reg.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTakeCoverAbility,
  applyTakeCoverBonus,
  TAKE_COVER_JAWA_ABILITY_IDS,
  TAKE_COVER_BONUS_BLOCK,
  TAKE_COVER_BONUS_EVADE,
} from '../../../src/game/take-cover-jawa-helpers.js';

describe('PROBE-TAKE-COVER-001: constants', () => {
  it('both slugs exported, frozen', () => {
    assert.deepStrictEqual([...TAKE_COVER_JAWA_ABILITY_IDS].sort(), [
      'take_cover_jawa_elite',
      'take_cover_jawa_reg',
    ]);
    assert.ok(Object.isFrozen(TAKE_COVER_JAWA_ABILITY_IDS));
  });

  it('bonus constants (+1 Block, -1 Evade)', () => {
    assert.equal(TAKE_COVER_BONUS_BLOCK, 1);
    assert.equal(TAKE_COVER_BONUS_EVADE, -1);
  });
});

describe('PROBE-TAKE-COVER-002: hasTakeCoverAbility', () => {
  it('elite slug → true', () => {
    assert.equal(hasTakeCoverAbility(['take_cover_jawa_elite']), true);
  });
  it('reg slug → true', () => {
    assert.equal(hasTakeCoverAbility(['take_cover_jawa_reg']), true);
  });
  it('mixed → true', () => {
    assert.equal(hasTakeCoverAbility(['focus', 'take_cover_jawa_elite']), true);
  });
  it('unrelated ids → false', () => {
    assert.equal(hasTakeCoverAbility(['aim_rebel_trooper_reg']), false);
  });
  it('non-array → false', () => {
    assert.equal(hasTakeCoverAbility(null), false);
    assert.equal(hasTakeCoverAbility(undefined), false);
    assert.equal(hasTakeCoverAbility('take_cover_jawa_elite'), false);
  });
});

describe('PROBE-TAKE-COVER-003: applyTakeCoverBonus', () => {
  it('zero existing → +1 Block, -1 Evade', () => {
    assert.deepStrictEqual(applyTakeCoverBonus({ bonusBlock: 0, bonusEvade: 0 }), {
      applied: true,
      bonusBlock: 1,
      bonusEvade: -1,
    });
  });

  it('stacks on existing bonuses', () => {
    assert.deepStrictEqual(applyTakeCoverBonus({ bonusBlock: 2, bonusEvade: 3 }), {
      applied: true,
      bonusBlock: 3,
      bonusEvade: 2,
    });
  });

  it('can drive bonusEvade negative', () => {
    const r = applyTakeCoverBonus({ bonusBlock: 0, bonusEvade: 0 });
    assert.equal(r.bonusEvade, -1);
  });

  it('missing / null / undefined fields default to 0', () => {
    assert.deepStrictEqual(applyTakeCoverBonus(), { applied: true, bonusBlock: 1, bonusEvade: -1 });
    assert.deepStrictEqual(applyTakeCoverBonus({}), { applied: true, bonusBlock: 1, bonusEvade: -1 });
    assert.deepStrictEqual(applyTakeCoverBonus({ bonusBlock: null, bonusEvade: undefined }), {
      applied: true,
      bonusBlock: 1,
      bonusEvade: -1,
    });
  });

  it('pure: no mutation', () => {
    const input = { bonusBlock: 5, bonusEvade: 5 };
    applyTakeCoverBonus(input);
    assert.deepStrictEqual(input, { bonusBlock: 5, bonusEvade: 5 });
  });
});

describe('PROBE-TAKE-COVER-004: library + dc-effects wiring', () => {
  it('elite library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.take_cover_jawa_elite;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Take Cover/i);
  });

  it('reg library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.take_cover_jawa_reg;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });

  it('Jawa Scavenger (Elite) references elite slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const j = effects.cards?.['Jawa Scavenger (Elite)'];
    assert.ok(j);
    assert.ok((j.specialAbilityIds || []).includes('take_cover_jawa_elite'));
  });

  it('Jawa Scavenger (Regular) references reg slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const j = effects.cards?.['Jawa Scavenger (Regular)'];
    assert.ok(j);
    assert.ok((j.specialAbilityIds || []).includes('take_cover_jawa_reg'));
  });
});
