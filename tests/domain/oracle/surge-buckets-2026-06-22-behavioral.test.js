/**
 * Surge buckets are the single source of truth for surge-on-miss gating
 * (alexanbv 2026-06-22). The bucket of a condition surge must be read from
 * SURGE_BUCKET and route parseSurgeEffect to the damage-gated vs not-miss list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SURGE_BUCKET, getSurgeBucket } from '../../../src/game/surge-buckets.js';
import { parseSurgeEffect } from '../../../src/game/combat.js';

describe('SURGE_BUCKET — single source of truth', () => {
  it('classifies the three buckets correctly', () => {
    // requires_damage
    for (const k of ['stun', 'weaken', 'bleed', 'focus', 'hide', 'blast', 'cleave']) {
      assert.equal(getSurgeBucket(k), 'requires_damage', k);
    }
    // did_not_miss
    for (const k of ['stun_net', 'harass', 'suppression', 'concussive_bolt', 'spread_the_pain']) {
      assert.equal(getSurgeBucket(k), 'did_not_miss', k);
    }
    // no_restriction
    for (const k of ['fell_swoop', 'squad_command', 'shocking_palm', 'fighting_knife', 'recover', 'hit token', 'power token']) {
      assert.equal(getSurgeBucket(k), 'no_restriction', k);
    }
  });

  it('normalizes double:/parenthetical prefixes and defaults unknown keys to no_restriction', () => {
    assert.equal(getSurgeBucket('double:stun'), 'requires_damage');
    assert.equal(getSurgeBucket('blast 3 (2 surges)'), 'requires_damage');
    assert.equal(getSurgeBucket('totally unknown surge'), 'no_restriction');
  });

  it('parseSurgeEffect routes condition surges by their bucket', () => {
    // requires_damage → damage-gated conditions list
    const stun = parseSurgeEffect('stun');
    assert.deepEqual(stun.conditions, ['Stun']);
    assert.ok(!stun.noMissConditions || stun.noMissConditions.length === 0);
    // did_not_miss → not-miss bucket, NOT the damage-gated list
    const net = parseSurgeEffect('stun_net');
    assert.deepEqual(net.noMissConditions, ['Stun']);
    assert.equal(net.conditions.length, 0);
    // combo: "damage 1, weaken" — weaken is requires_damage
    const combo = parseSurgeEffect('damage 1, weaken');
    assert.deepEqual(combo.conditions, ['Weaken']);
    assert.equal(combo.damage, 1);
  });

  it('SURGE_BUCKET is frozen (single source, not mutated at runtime)', () => {
    assert.ok(Object.isFrozen(SURGE_BUCKET));
  });
});
