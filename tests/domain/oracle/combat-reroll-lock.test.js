/**
 * Combined reroll lock (alexanbv 2026-06-15): "Once a die is rerolled, it may
 * not be further rerolled by anybody (exception: Zeb / Rapid Recalibration,
 * which TURN rather than reroll, in their special window)." Single source of
 * truth for the gate rebuild — one lock for both sides, keyed by die identity.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dieId, isDieRerolled, canRerollDie, markDieRerolled,
  rerollableIndices, resetRerollLock, serializeRerollLock,
} from '../../../src/engine/combat-reroll-lock.js';

describe('combat-reroll-lock', () => {
  it('locks a die for EVERYONE once rerolled (attacker reroll blocks defender)', () => {
    const combat = {};
    const id = dieId('attack', 0);
    assert.equal(canRerollDie(combat, id), true, 'fresh die is rerollable');
    assert.equal(markDieRerolled(combat, id), true, 'first mark locks it');
    assert.equal(markDieRerolled(combat, id), false, 'second mark is a no-op');
    assert.equal(isDieRerolled(combat, id), true);
    // The defender now cannot reroll the same die — combined lock, not per-side.
    assert.equal(canRerollDie(combat, id), false, 'rerolled die is locked for the other side too');
  });

  it('namespaces by pool so attack #0 and defense #0 do not collide', () => {
    const combat = {};
    markDieRerolled(combat, dieId('attack', 0));
    assert.equal(canRerollDie(combat, dieId('attack', 0)), false);
    assert.equal(canRerollDie(combat, dieId('defense', 0)), true, 'defense die #0 is independent');
  });

  it('special-turn abilities (Zeb / Rapid Recalibration) bypass the lock', () => {
    const combat = {};
    const id = dieId('attack', 1);
    markDieRerolled(combat, id);
    assert.equal(canRerollDie(combat, id), false, 'ordinary reroll blocked');
    assert.equal(canRerollDie(combat, id, { specialTurn: true }), true, 'Zeb/Rapid Recal may still turn it');
  });

  it('rerollableIndices filters out locked dice', () => {
    const combat = {};
    markDieRerolled(combat, dieId('attack', 1));
    assert.deepEqual(rerollableIndices(combat, 'attack', [0, 1, 2]), [0, 2]);
    assert.deepEqual(rerollableIndices(combat, 'attack', [0, 1, 2], { specialTurn: true }), [0, 1, 2]);
  });

  it('reset clears the lock; serialize round-trips', () => {
    const combat = {};
    markDieRerolled(combat, dieId('attack', 0));
    assert.deepEqual(serializeRerollLock(combat), ['attack:0']);
    // rehydrate from a persisted array
    const reloaded = { _rerolledDieIds: ['attack:0'] };
    assert.equal(canRerollDie(reloaded, dieId('attack', 0)), false, 'rehydrates from array');
    resetRerollLock(combat);
    assert.equal(canRerollDie(combat, dieId('attack', 0)), true, 'reset clears');
  });
});
