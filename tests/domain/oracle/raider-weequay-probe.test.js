/**
 * PROBE-RAIDER-WEEQUAY: Weequay Pirate (Elite/Regular)'s **Raider**.
 *
 * Card text: "While attacking, you may choose 1 die. The player that
 *  rolled that die must reroll that die."
 *
 * Two atoms (elite + reg) share identical behavior. Attacker-
 * controlled forced reroll on ANY pool (attack or defense).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRaiderAbility,
  buildRaiderForcedReroll,
  RAIDER_WEEQUAY_ABILITY_IDS,
  RAIDER_FORCED_REROLL_POOL,
  RAIDER_FORCED_REROLL_COUNT,
  RAIDER_SOURCE_LABEL,
} from '../../../src/game/raider-weequay-helpers.js';

describe('PROBE-RAIDER-001: constants', () => {
  it('frozen id set', () => {
    assert.deepStrictEqual([...RAIDER_WEEQUAY_ABILITY_IDS].sort(), [
      'raider_weequay_elite',
      'raider_weequay_reg',
    ]);
    assert.ok(Object.isFrozen(RAIDER_WEEQUAY_ABILITY_IDS));
  });
  it('pool = any, count = 1, source = Raider', () => {
    assert.equal(RAIDER_FORCED_REROLL_POOL, 'any');
    assert.equal(RAIDER_FORCED_REROLL_COUNT, 1);
    assert.equal(RAIDER_SOURCE_LABEL, 'Raider');
  });
});

describe('PROBE-RAIDER-002: hasRaiderAbility', () => {
  it('elite slug → true', () => {
    assert.equal(hasRaiderAbility(['raider_weequay_elite']), true);
  });
  it('reg slug → true', () => {
    assert.equal(hasRaiderAbility(['raider_weequay_reg']), true);
  });
  it('unrelated ids → false', () => {
    assert.equal(hasRaiderAbility(['focus']), false);
  });
  it('non-array → false', () => {
    assert.equal(hasRaiderAbility(null), false);
    assert.equal(hasRaiderAbility('raider_weequay_elite'), false);
  });
});

describe('PROBE-RAIDER-003: buildRaiderForcedReroll', () => {
  it('builds queue entry with attacker as control player', () => {
    assert.deepStrictEqual(buildRaiderForcedReroll(1), {
      controlPlayer: 1,
      pool: 'any',
      remaining: 1,
      source: 'Raider',
    });
  });
  it('respects different attacker player numbers', () => {
    assert.deepStrictEqual(buildRaiderForcedReroll(2), {
      controlPlayer: 2,
      pool: 'any',
      remaining: 1,
      source: 'Raider',
    });
  });
  it('each call returns fresh object (no shared reference)', () => {
    const a = buildRaiderForcedReroll(1);
    const b = buildRaiderForcedReroll(1);
    assert.notStrictEqual(a, b);
    a.remaining = 99;
    assert.equal(b.remaining, 1);
  });
});

describe('PROBE-RAIDER-004: library + dc-effects wiring', () => {
  it('elite library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.raider_weequay_elite;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Raider/i);
  });
  it('reg library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.raider_weequay_reg;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('Weequay Pirate (Elite) references elite slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Weequay Pirate (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('raider_weequay_elite'));
  });
  it('Weequay Pirate (Regular) references reg slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Weequay Pirate (Regular)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('raider_weequay_reg'));
  });
});
