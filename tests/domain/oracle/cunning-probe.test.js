/**
 * PROBE-CUNNING: Han Solo / Jyn Odan / Nexu E+R shared **Cunning**.
 *
 * Card text: "While defending, apply +1 Block per Evade result."
 *
 * Cluster of 4 slugs flips a single hasCunning flag. The
 * Block-per-Evade conversion itself lives elsewhere in the combat
 * pipeline (out of scope here).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCunningAbility,
  applyCunningFlag,
  CUNNING_ABILITY_IDS,
} from '../../../src/game/cunning-helpers.js';

describe('PROBE-CUNNING-001: constants', () => {
  it('exports all 4 slugs (frozen)', () => {
    assert.deepStrictEqual([...CUNNING_ABILITY_IDS].sort(), [
      'cunning_han',
      'cunning_jyn',
      'cunning_nexu_elite',
      'cunning_nexu_reg',
    ]);
    assert.ok(Object.isFrozen(CUNNING_ABILITY_IDS));
  });
});

describe('PROBE-CUNNING-002: hasCunningAbility', () => {
  for (const slug of ['cunning_han', 'cunning_jyn', 'cunning_nexu_elite', 'cunning_nexu_reg']) {
    it(`${slug} → true`, () => {
      assert.equal(hasCunningAbility([slug]), true);
    });
  }
  it('non-cunning slug → false', () => {
    assert.equal(hasCunningAbility(['distracting_han']), false);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasCunningAbility([]), false);
    assert.equal(hasCunningAbility(null), false);
    assert.equal(hasCunningAbility('cunning_han'), false);
  });
});

describe('PROBE-CUNNING-003: applyCunningFlag', () => {
  it('flip from false → hasCunning=true, previouslySet=false', () => {
    assert.deepStrictEqual(applyCunningFlag({ hasCunning: false }), {
      applied: true,
      hasCunning: true,
      previouslySet: false,
    });
  });
  it('idempotent when already true', () => {
    assert.deepStrictEqual(applyCunningFlag({ hasCunning: true }), {
      applied: true,
      hasCunning: true,
      previouslySet: true,
    });
  });
  it('defaults → hasCunning=true', () => {
    assert.deepStrictEqual(applyCunningFlag(), {
      applied: true,
      hasCunning: true,
      previouslySet: false,
    });
  });
  it('pure: no mutation', () => {
    const input = { hasCunning: false };
    applyCunningFlag(input);
    assert.deepStrictEqual(input, { hasCunning: false });
  });
});

describe('PROBE-CUNNING-004: library + dc-effects wiring', () => {
  for (const slug of CUNNING_ABILITY_IDS) {
    it(`${slug} library entry wired`, async () => {
      const { readFile } = await import('node:fs/promises');
      const lib = JSON.parse(
        await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
      );
      const e = lib.abilities?.[slug];
      assert.ok(e, `expected library entry for ${slug}`);
      assert.equal(e.wiredStatus, 'wired');
      assert.match(e.label || '', /Cunning/i);
    });
  }
  it('each slug has at least one DC owner', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    for (const slug of CUNNING_ABILITY_IDS) {
      const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
        (dc.specialAbilityIds || []).includes(slug),
      );
      assert.ok(refs.length > 0, `expected at least one DC owner for ${slug}`);
    }
  });
});
