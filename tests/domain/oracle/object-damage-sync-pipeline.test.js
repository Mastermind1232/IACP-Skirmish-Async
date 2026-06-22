/**
 * applyObjectDamageSync — the sync object-damage entry point (alexanbv 2026-06-22).
 * Sync resolvers (Set the Charges, Collateral Damage, Durasteel Fist, IG-11
 * Self-Destruct, …) route object damage through it so HP, position removal and
 * vpOnDefeat are handled uniformly instead of hardcoded inline.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyObjectDamageSync } from '../../../src/game/object-damage-pipeline.js';

function makeGame(objHp, meta = {}) {
  return {
    objectHealth: { crate_1: [...objHp] },
    objectPositions: { crate_1: 'd4' },
    objectMeta: { crate_1: { name: 'Crate', ...meta } },
  };
}

describe('applyObjectDamageSync', () => {
  it('decrements HP and reports prev/new without defeat', () => {
    const game = makeGame([5, 5]);
    const r = applyObjectDamageSync(game, 'crate_1', 2, {});
    assert.equal(r.applied, true);
    assert.equal(r.prevHp, 5);
    assert.equal(r.newHp, 3);
    assert.equal(r.defeated, false);
    assert.deepEqual(game.objectHealth.crate_1, [3, 5]);
    assert.equal(game.objectPositions.crate_1, 'd4', 'survivor stays on the board');
  });

  it('on lethal damage: removes the object from the board and reports defeat', () => {
    const game = makeGame([2, 5]);
    const r = applyObjectDamageSync(game, 'crate_1', 3, {});
    assert.equal(r.defeated, true);
    assert.equal(r.newHp, 0);
    assert.equal(game.objectPositions.crate_1, undefined, 'destroyed object removed from positions');
  });

  it('awards vpOnDefeat to the attacker on destroy', () => {
    const game = makeGame([1, 5], { vpOnDefeat: { playerNum: 'attacker', amount: 2 } });
    let awarded = null;
    const awardObjectiveVp = (g, pn, amt) => { awarded = { pn, amt }; };
    const r = applyObjectDamageSync(game, 'crate_1', 1, { attackerPlayerNum: 1, awardObjectiveVp });
    assert.equal(r.defeated, true);
    assert.equal(r.vp, 2);
    assert.deepEqual(awarded, { pn: 1, amt: 2 }, 'attacker (P1) got the 2 VP');
  });

  it('surfaces splashOnDefeat for the caller (needs the async figure pipeline)', () => {
    const game = makeGame([1, 5], { splashOnDefeat: { amount: 1, radius: 1 } });
    const r = applyObjectDamageSync(game, 'crate_1', 1, {});
    assert.deepEqual(r.splashPending, { amount: 1, radius: 1 });
  });

  it('is a no-op on a missing / already-destroyed object', () => {
    const game = makeGame([0, 5]);
    const r = applyObjectDamageSync(game, 'crate_1', 1, {});
    assert.equal(r.applied, false);
    const r2 = applyObjectDamageSync({ objectHealth: {}, objectMeta: {} }, 'nope', 1, {});
    assert.equal(r2.applied, false);
  });
});
