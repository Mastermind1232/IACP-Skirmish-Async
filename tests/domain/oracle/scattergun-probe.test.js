/**
 * PROBE-SCATTERGUN: ACP Scattergun (Trandoshan Hunter Elite) +
 *  Scattergun (Trandoshan Hunter Regular).
 *
 * Card text (Elite): "When attacking an adjacent hostile figure,
 *  apply +2 Hits to the attack results."
 * Card text (Regular): "When attacking an adjacent hostile figure,
 *  apply +1 Hit to the attack results."
 *
 * Helper owns slug ids, adjacency predicate (distance ≤ 1), and hit
 * deltas (elite=+2, regular=+1). Distance lookup + message render
 * stay handler-owned. Elite branch takes precedence if both slugs
 * somehow appear (mirrors combat.js if/else-if).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAcpScattergun,
  hasScattergun,
  scattergunInRange,
  applyScattergunHits,
  ACP_SCATTERGUN_ABILITY_ID,
  SCATTERGUN_ABILITY_ID,
  ACP_SCATTERGUN_HIT_DELTA,
  SCATTERGUN_HIT_DELTA,
  SCATTERGUN_MAX_DISTANCE,
} from '../../../src/game/scattergun-helpers.js';

describe('PROBE-SCATTERGUN-001: constants', () => {
  it('elite slug = acp_scattergun', () => {
    assert.equal(ACP_SCATTERGUN_ABILITY_ID, 'acp_scattergun');
  });
  it('regular slug = scattergun', () => {
    assert.equal(SCATTERGUN_ABILITY_ID, 'scattergun');
  });
  it('elite hit delta = +2', () => {
    assert.equal(ACP_SCATTERGUN_HIT_DELTA, 2);
  });
  it('regular hit delta = +1', () => {
    assert.equal(SCATTERGUN_HIT_DELTA, 1);
  });
  it('max distance = 1 (adjacent)', () => {
    assert.equal(SCATTERGUN_MAX_DISTANCE, 1);
  });
});

describe('PROBE-SCATTERGUN-002: predicates', () => {
  it('hasAcpScattergun: slug present → true', () => {
    assert.equal(hasAcpScattergun(['acp_scattergun']), true);
  });
  it('hasAcpScattergun: regular slug → false', () => {
    assert.equal(hasAcpScattergun(['scattergun']), false);
  });
  it('hasAcpScattergun: missing / non-array → false', () => {
    assert.equal(hasAcpScattergun([]), false);
    assert.equal(hasAcpScattergun(null), false);
    assert.equal(hasAcpScattergun('acp_scattergun'), false);
  });
  it('hasScattergun: slug present → true', () => {
    assert.equal(hasScattergun(['scattergun']), true);
  });
  it('hasScattergun: elite slug → false', () => {
    assert.equal(hasScattergun(['acp_scattergun']), false);
  });
  it('hasScattergun: missing / non-array → false', () => {
    assert.equal(hasScattergun([]), false);
    assert.equal(hasScattergun(null), false);
  });
});

describe('PROBE-SCATTERGUN-003: scattergunInRange (adjacency gate)', () => {
  it('distance 0-1 → true', () => {
    assert.equal(scattergunInRange(0), true);
    assert.equal(scattergunInRange(1), true);
  });
  it('distance > 1 → false', () => {
    assert.equal(scattergunInRange(2), false);
    assert.equal(scattergunInRange(10), false);
  });
  it('non-finite → false', () => {
    assert.equal(scattergunInRange(NaN), false);
    assert.equal(scattergunInRange(Infinity), false);
    assert.equal(scattergunInRange(undefined), false);
  });
});

describe('PROBE-SCATTERGUN-004: applyScattergunHits math', () => {
  it('elite delta: zero existing → +2', () => {
    assert.deepStrictEqual(applyScattergunHits({ bonusHits: 0 }, ACP_SCATTERGUN_HIT_DELTA), {
      applied: true,
      bonusHits: 2,
    });
  });
  it('regular delta: zero existing → +1', () => {
    assert.deepStrictEqual(applyScattergunHits({ bonusHits: 0 }, SCATTERGUN_HIT_DELTA), {
      applied: true,
      bonusHits: 1,
    });
  });
  it('stacks on prior bonus hits', () => {
    assert.deepStrictEqual(applyScattergunHits({ bonusHits: 3 }, ACP_SCATTERGUN_HIT_DELTA), {
      applied: true,
      bonusHits: 5,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyScattergunHits(undefined, 1), { applied: true, bonusHits: 1 });
    assert.deepStrictEqual(applyScattergunHits({ bonusHits: null }, 2), {
      applied: true,
      bonusHits: 2,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusHits: 1 };
    applyScattergunHits(input, 2);
    assert.deepStrictEqual(input, { bonusHits: 1 });
  });
});

describe('PROBE-SCATTERGUN-005: library + DC wiring', () => {
  it('both slugs wired in ability-library.json', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    for (const id of [ACP_SCATTERGUN_ABILITY_ID, SCATTERGUN_ABILITY_ID]) {
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
    for (const id of [ACP_SCATTERGUN_ABILITY_ID, SCATTERGUN_ABILITY_ID]) {
      const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
        (dc.specialAbilityIds || []).includes(id),
      );
      assert.ok(refs.length > 0, `${id} has no DC reference`);
    }
  });
});
