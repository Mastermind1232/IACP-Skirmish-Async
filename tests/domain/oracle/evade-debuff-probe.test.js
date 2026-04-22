/**
 * PROBE-EVADE-DEBUFF: two -1 Evade passives sharing math:
 *   - **Disposable** (Hired Gun Regular, defender) — own defense -1 Evade.
 *   - **Conclusion** (HK-47, attacker) — defender defense -1 Evade.
 *
 * Both bumps write to the shared pendingCombat.bonusEvade slot.
 * Pure helpers extracted from combat.js:1880 (Conclusion) and :1893
 * (Disposable).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasDisposableAbility,
  hasConclusionAbility,
  applyEvadeDebuff,
  DISPOSABLE_ABILITY_ID,
  CONCLUSION_ABILITY_ID,
  EVADE_DEBUFF_DELTA,
} from '../../../src/game/evade-debuff-helpers.js';

describe('PROBE-EVADE-DEBUFF-001: constants', () => {
  it('ids', () => {
    assert.equal(DISPOSABLE_ABILITY_ID, 'disposable');
    assert.equal(CONCLUSION_ABILITY_ID, 'conclusion');
  });
  it('delta = -1', () => {
    assert.equal(EVADE_DEBUFF_DELTA, -1);
  });
});

describe('PROBE-EVADE-DEBUFF-002: predicates', () => {
  it('disposable slug → has Disposable only', () => {
    assert.equal(hasDisposableAbility(['disposable']), true);
    assert.equal(hasConclusionAbility(['disposable']), false);
  });
  it('conclusion slug → has Conclusion only', () => {
    assert.equal(hasConclusionAbility(['conclusion']), true);
    assert.equal(hasDisposableAbility(['conclusion']), false);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasDisposableAbility([]), false);
    assert.equal(hasDisposableAbility(null), false);
    assert.equal(hasConclusionAbility('conclusion'), false);
  });
});

describe('PROBE-EVADE-DEBUFF-003: applyEvadeDebuff math', () => {
  it('zero existing → -1', () => {
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: 0 }), {
      applied: true,
      bonusEvade: -1,
    });
  });
  it('stacks on existing (multi-source debuff)', () => {
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: -1 }), {
      applied: true,
      bonusEvade: -2,
    });
  });
  it('cancels positive existing bonus', () => {
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: 2 }), {
      applied: true,
      bonusEvade: 1,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyEvadeDebuff(), { applied: true, bonusEvade: -1 });
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: null }), {
      applied: true,
      bonusEvade: -1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusEvade: 3 };
    applyEvadeDebuff(input);
    assert.deepStrictEqual(input, { bonusEvade: 3 });
  });
});

describe('PROBE-EVADE-DEBUFF-004: library + dc-effects wiring', () => {
  it('disposable library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.disposable;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Disposable/i);
  });
  it('conclusion library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.conclusion;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Conclusion/i);
  });
  it('Hired Gun (Regular) references disposable', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Hired Gun (Regular)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('disposable'));
  });
  it('HK-47 references conclusion', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['HK-47'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('conclusion'));
  });
});
