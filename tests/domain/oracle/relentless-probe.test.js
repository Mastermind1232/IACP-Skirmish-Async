/**
 * PROBE-RELENTLESS: **Relentless** — Trandoshan Hunter (Elite/Reg),
 *  IG-88, Fifth Brother.
 *
 * Card text: "When you attack a hostile figure within 3 spaces, that
 *  figure suffers 1 Strain."
 *
 * Helper owns slug list, range predicate, strain amount. Target
 * resolution + strain application stay handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRelentlessAbility,
  relentlessInRange,
  RELENTLESS_ABILITY_IDS,
  RELENTLESS_MAX_DISTANCE,
  RELENTLESS_STRAIN_AMOUNT,
} from '../../../src/game/relentless-helpers.js';

describe('PROBE-RELENTLESS-001: constants', () => {
  it('slug list exactly [trandoshan elite/reg, ig88, fifth brother]', () => {
    assert.deepStrictEqual([...RELENTLESS_ABILITY_IDS].sort(), [
      'fifth_brother_relentless',
      'relentless_ig88',
      'relentless_trandoshan_elite',
      'relentless_trandoshan_reg',
    ]);
    assert.ok(Object.isFrozen(RELENTLESS_ABILITY_IDS));
  });
  it('range = 3', () => {
    assert.equal(RELENTLESS_MAX_DISTANCE, 3);
  });
  it('strain = 1', () => {
    assert.equal(RELENTLESS_STRAIN_AMOUNT, 1);
  });
});

describe('PROBE-RELENTLESS-002: hasRelentlessAbility', () => {
  it('each individual slug → true', () => {
    for (const id of RELENTLESS_ABILITY_IDS) {
      assert.equal(hasRelentlessAbility([id]), true, id);
    }
  });
  it('unrelated slug → false', () => {
    assert.equal(hasRelentlessAbility(['hunker_down']), false);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasRelentlessAbility([]), false);
    assert.equal(hasRelentlessAbility(null), false);
    assert.equal(hasRelentlessAbility('relentless_ig88'), false);
  });
});

describe('PROBE-RELENTLESS-003: relentlessInRange', () => {
  it('distance ≤ 3 → true (range-restricted ids, no ids passed)', () => {
    for (const d of [0, 1, 2, 3]) assert.equal(relentlessInRange(d), true, `d=${d}`);
  });
  it('distance > 3 → false (range-restricted ids, no ids passed)', () => {
    assert.equal(relentlessInRange(4), false);
    assert.equal(relentlessInRange(10), false);
  });
  it('non-finite → false (range-restricted ids, no ids passed)', () => {
    assert.equal(relentlessInRange(NaN), false);
    assert.equal(relentlessInRange(Infinity), false);
    assert.equal(relentlessInRange(undefined), false);
  });
  it('Fifth Brother (fifth_brother_relentless) — no range gate, any distance → true', () => {
    for (const d of [0, 1, 5, 99, Infinity, NaN]) {
      assert.equal(relentlessInRange(d, ['fifth_brother_relentless']), true, `d=${d}`);
    }
  });
  it('Trandoshan / IG-88 still range-3 gated when ids are passed', () => {
    assert.equal(relentlessInRange(3, ['relentless_ig88']), true);
    assert.equal(relentlessInRange(4, ['relentless_ig88']), false);
    assert.equal(relentlessInRange(3, ['relentless_trandoshan_elite']), true);
    assert.equal(relentlessInRange(4, ['relentless_trandoshan_reg']), false);
  });
  it('mixed ids — if ANY id is unrestricted, fire at any distance', () => {
    assert.equal(relentlessInRange(99, ['relentless_ig88', 'fifth_brother_relentless']), true);
  });
});

describe('PROBE-RELENTLESS-004: library + DC wiring', () => {
  it('each slug is wired in ability-library.json', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    for (const id of RELENTLESS_ABILITY_IDS) {
      const e = lib.abilities?.[id];
      assert.ok(e, `${id} missing from library`);
      assert.equal(e.wiredStatus, 'wired', `${id} not wired`);
    }
  });
  it('at least one DC references each slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    for (const id of RELENTLESS_ABILITY_IDS) {
      const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
        (dc.specialAbilityIds || []).includes(id),
      );
      assert.ok(refs.length > 0, `${id} has no DC reference`);
    }
  });
});
