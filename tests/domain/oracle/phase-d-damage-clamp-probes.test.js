/**
 * Phase-D probes: damage-clamping invariants.
 *
 * PROBE-PD-DMG-007: A figure cannot suffer damage in excess of its Health;
 *   damage over this amount has no effect. (CRR DAMAGE)
 *   reduceHp (src/game/damage-helpers.js) clamps newHp to max(0, prev-dmg);
 *   totalDamageReceived is incremented by actualDamage = prevHp - newHp,
 *   not by the raw damage argument, so excess damage is discarded without
 *   side effects.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reduceHp } from '../../../src/game/damage-helpers.js';

function makeHealthState(hp, max = hp) {
  const state = [[hp, max]];
  const map = new Map();
  map.set('dcMsg', state);
  return map;
}

describe('PROBE-PD-DMG-007: damage in excess of Health has no effect', () => {
  it('007: reduceHp clamps newHp to 0 when damage > prevHp', () => {
    const dcHealthState = makeHealthState(3, 5);
    const game = { totalDamageReceived: { 1: 0, 2: 0 } };
    const { newHp, maxHp, prevHp, wasDefeated } = reduceHp(dcHealthState, game, 'dcMsg', 0, 99, 2);
    assert.equal(newHp, 0,
      `newHp must clamp at 0; 3 HP − 99 dmg must not produce negative HP — CRR-DMG-007. Got ${newHp}`);
    assert.equal(prevHp, 3, 'prevHp preserved');
    assert.equal(maxHp, 5, 'maxHp unchanged');
    assert.equal(wasDefeated, true, 'figure defeated when HP reaches 0');
  });

  it('007b: only actual damage (prevHp) is attributed to totalDamageReceived, excess discarded', () => {
    const dcHealthState = makeHealthState(2, 4);
    const game = { totalDamageReceived: { 1: 0, 2: 0 } };
    reduceHp(dcHealthState, game, 'dcMsg', 0, 50, 2);
    assert.equal(game.totalDamageReceived[2], 2,
      `totalDamageReceived must be the actual damage absorbed (2), NOT the raw damage argument (50); excess damage is discarded per CRR-DMG-007. Got ${game.totalDamageReceived[2]}`);
  });
});
