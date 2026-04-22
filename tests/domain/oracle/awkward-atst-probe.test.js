/**
 * PROBE-AWKWARD-ATST: AT-ST's **Awkward**.
 *
 * Card text: "You cannot attack adjacent figures."
 *
 * Predicate-only attacker gate. If attacker has the slug and target
 * distance ≤ 1, attack cancels. Pure helpers extracted from
 * src/handlers/combat.js:2083.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAwkwardAbility,
  awkwardBlocks,
  AWKWARD_ATST_ABILITY_ID,
  AWKWARD_ADJACENT_DISTANCE,
} from '../../../src/game/awkward-atst-helpers.js';

describe('PROBE-AWKWARD-001: constants', () => {
  it('ability id = awkward_atst', () => {
    assert.equal(AWKWARD_ATST_ABILITY_ID, 'awkward_atst');
  });
  it('adjacent distance = 1', () => {
    assert.equal(AWKWARD_ADJACENT_DISTANCE, 1);
  });
});

describe('PROBE-AWKWARD-002: hasAwkwardAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasAwkwardAbility(['awkward_atst']), true);
  });
  it('slug missing → false', () => {
    assert.equal(hasAwkwardAbility(['focus']), false);
    assert.equal(hasAwkwardAbility([]), false);
  });
  it('non-array → false', () => {
    assert.equal(hasAwkwardAbility(null), false);
    assert.equal(hasAwkwardAbility('awkward_atst'), false);
  });
});

describe('PROBE-AWKWARD-003: awkwardBlocks predicate', () => {
  it('distance 0 (same square) → blocked', () => {
    assert.equal(awkwardBlocks(0), true);
  });
  it('distance 1 (adjacent) → blocked', () => {
    assert.equal(awkwardBlocks(1), true);
  });
  it('distance 2+ → not blocked', () => {
    assert.equal(awkwardBlocks(2), false);
    assert.equal(awkwardBlocks(5), false);
    assert.equal(awkwardBlocks(100), false);
  });
  it('non-number → not blocked (safe default)', () => {
    assert.equal(awkwardBlocks(null), false);
    assert.equal(awkwardBlocks(undefined), false);
    assert.equal(awkwardBlocks('1'), false);
  });
});

describe('PROBE-AWKWARD-004: library + dc-effects wiring', () => {
  it('awkward_atst library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.awkward_atst;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Awkward/i);
  });

  it('AT-ST DC references awkward_atst', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['AT-ST'];
    assert.ok(dc, 'AT-ST DC must exist');
    assert.ok((dc.specialAbilityIds || []).includes('awkward_atst'));
  });
});
