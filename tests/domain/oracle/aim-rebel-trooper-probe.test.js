/**
 * PROBE-AIM-REBEL-TROOPER: Rebel Trooper (Elite/Regular)'s **Aim**.
 *
 * Card text: "If you have not exited a space during this activation,
 *  apply +1 Hit and +2 Accuracy to your attack results."
 *
 * Phase 2.2 medium-risk probe grind (2026-04-22). Atom was wired at
 * combat.js:2107 with the predicate + bonus math inlined. Pure
 * helpers extracted to src/game/aim-rebel-trooper-helpers.js. Covers
 * two CRR atoms: aim_rebel_trooper_elite and aim_rebel_trooper_reg.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAimAbility,
  aimBonusApplies,
  applyAimBonus,
  AIM_REBEL_TROOPER_ABILITY_IDS,
  AIM_BONUS_HITS,
  AIM_BONUS_ACCURACY,
} from '../../../src/game/aim-rebel-trooper-helpers.js';

describe('PROBE-AIM-REBEL-TROOPER-001: ability ID constants', () => {
  it('exports both slugs', () => {
    assert.deepStrictEqual([...AIM_REBEL_TROOPER_ABILITY_IDS].sort(), [
      'aim_rebel_trooper_elite',
      'aim_rebel_trooper_reg',
    ]);
  });

  it('bonus constants match card text (+1 Hit, +2 Accuracy)', () => {
    assert.equal(AIM_BONUS_HITS, 1);
    assert.equal(AIM_BONUS_ACCURACY, 2);
  });

  it('ID list is frozen', () => {
    assert.ok(Object.isFrozen(AIM_REBEL_TROOPER_ABILITY_IDS));
  });
});

describe('PROBE-AIM-REBEL-TROOPER-002: hasAimAbility predicate', () => {
  it('elite slug → true', () => {
    assert.equal(hasAimAbility(['aim_rebel_trooper_elite']), true);
  });
  it('regular slug → true', () => {
    assert.equal(hasAimAbility(['aim_rebel_trooper_reg']), true);
  });
  it('mixed with other abilities → true', () => {
    assert.equal(hasAimAbility(['focus', 'aim_rebel_trooper_elite', 'stealth']), true);
  });
  it('no aim ids → false', () => {
    assert.equal(hasAimAbility(['focus', 'stealth']), false);
  });
  it('empty / non-array → false', () => {
    assert.equal(hasAimAbility([]), false);
    assert.equal(hasAimAbility(null), false);
    assert.equal(hasAimAbility(undefined), false);
    assert.equal(hasAimAbility('aim_rebel_trooper_elite'), false);
  });
});

describe('PROBE-AIM-REBEL-TROOPER-003: aimBonusApplies (move gate)', () => {
  it('figure has NOT moved → true', () => {
    assert.equal(aimBonusApplies('Rebel Trooper-1-0', {}), true);
    assert.equal(aimBonusApplies('Rebel Trooper-1-0', { 'other-1-0': true }), true);
  });

  it('figure HAS moved → false', () => {
    assert.equal(
      aimBonusApplies('Rebel Trooper-1-0', { 'Rebel Trooper-1-0': true }),
      false,
    );
  });

  it('figureMoved map missing entirely → treats as not-moved', () => {
    assert.equal(aimBonusApplies('Rebel Trooper-1-0'), true);
    assert.equal(aimBonusApplies('Rebel Trooper-1-0', null), true);
  });

  it('empty / missing figureKey → false (no figure to bonus)', () => {
    assert.equal(aimBonusApplies(null, {}), false);
    assert.equal(aimBonusApplies('', {}), false);
    assert.equal(aimBonusApplies(undefined, {}), false);
  });

  it('other figure moved should not block this one', () => {
    const moved = { 'Stormtrooper-1-0': true, 'Rebel Trooper-2-0': true };
    assert.equal(aimBonusApplies('Rebel Trooper-1-0', moved), true);
  });
});

describe('PROBE-AIM-REBEL-TROOPER-004: applyAimBonus math', () => {
  it('zero existing bonuses → +1 Hit, +2 Accuracy', () => {
    const r = applyAimBonus({ bonusHits: 0, bonusAccuracy: 0 });
    assert.deepStrictEqual(r, { applied: true, bonusHits: 1, bonusAccuracy: 2 });
  });

  it('stacks on top of existing bonuses', () => {
    const r = applyAimBonus({ bonusHits: 3, bonusAccuracy: 1 });
    assert.deepStrictEqual(r, { applied: true, bonusHits: 4, bonusAccuracy: 3 });
  });

  it('handles missing fields (default to 0)', () => {
    assert.deepStrictEqual(applyAimBonus({}), {
      applied: true,
      bonusHits: 1,
      bonusAccuracy: 2,
    });
    assert.deepStrictEqual(applyAimBonus(), {
      applied: true,
      bonusHits: 1,
      bonusAccuracy: 2,
    });
  });

  it('handles null / undefined fields', () => {
    const r = applyAimBonus({ bonusHits: null, bonusAccuracy: undefined });
    assert.deepStrictEqual(r, { applied: true, bonusHits: 1, bonusAccuracy: 2 });
  });

  it('pure: does not mutate input', () => {
    const input = { bonusHits: 2, bonusAccuracy: 0 };
    applyAimBonus(input);
    assert.deepStrictEqual(input, { bonusHits: 2, bonusAccuracy: 0 });
  });

  it('calling applyAimBonus twice does NOT represent double-firing; caller must guard via predicate', () => {
    // Documents that the pure helper is unconditional. The combat handler
    // is responsible for checking hasAimAbility + aimBonusApplies first.
    // If this ever changes (e.g., per-attack-roll firing), this test will
    // need to be updated — good; the drift is loud.
    const once = applyAimBonus({ bonusHits: 0, bonusAccuracy: 0 });
    const twice = applyAimBonus(once);
    assert.deepStrictEqual(twice, { applied: true, bonusHits: 2, bonusAccuracy: 4 });
  });
});

describe('PROBE-AIM-REBEL-TROOPER-005: library + dc-effects wiring', () => {
  it('aim_rebel_trooper_elite library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.aim_rebel_trooper_elite;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Aim/);
  });

  it('aim_rebel_trooper_reg library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.aim_rebel_trooper_reg;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });

  it('AIM-ELITE-PARITY: elite library entry now MATCHES reg (post-destruct 2026-05-08 revert)', async () => {
    // Per destruct 2026-05-08: Elite Rebel Trooper's Aim was reverted
    // to be the same as Regular's — "If you have not exited a space
    // during this activation, apply +1 Hit and +2 Accuracy." Both
    // library entries now share the same movement-gate description.
    // Earlier note about "target has suffered damage" was the OLD
    // pre-revert text and no longer applies.
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const elite = lib.abilities?.aim_rebel_trooper_elite;
    const reg = lib.abilities?.aim_rebel_trooper_reg;
    assert.match(elite?.description || '', /have not exited/i);
    assert.match(reg?.description || '', /have not exited/i);
    assert.equal(elite?.description, reg?.description);
  });

  it('AIM-ELITE-WIRED: Rebel Trooper (Elite) DC references aim_rebel_trooper_elite (post-revert 2026-05-08)', async () => {
    // Per destruct 2026-05-08: Elite's Aim was reverted to match Regular's
    // movement-gate version, and the DC now references the elite slug.
    // Both slugs share the same predicate via hasAimAbility() so semantics
    // are identical — earlier "no DC references elite" probe stale.
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const elite = effects.cards?.['Rebel Trooper (Elite)'];
    assert.ok(elite);
    assert.ok(
      (elite.specialAbilityIds || []).includes('aim_rebel_trooper_elite'),
      'Rebel Trooper (Elite) must reference aim_rebel_trooper_elite',
    );
  });

  it('Rebel Trooper (Regular) DC references regular slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const rt = effects.cards?.['Rebel Trooper (Regular)'];
    assert.ok(rt);
    assert.ok(
      (rt.specialAbilityIds || []).includes('aim_rebel_trooper_reg'),
      'Rebel Trooper (Regular) must reference aim_rebel_trooper_reg',
    );
  });
});
