/**
 * readyDeploymentCard — the single way to ready a Deployment card.
 *
 * alexanbv 2026-08-11: "SoS Blaze Furious charge etc should ready cards in the
 * same way. It sounds like they are different." They were — five call sites,
 * five different subsets of the work:
 *
 *   Son of Skywalker  removed the activation index, never un-exhausted
 *   Blaze of Glory    un-exhausted, never removed the activation index
 *   Furious Charge    both, but raw-wrote the array and never recomputed counts
 *   un-activate/toggle  the only complete ones
 *
 * Readying is four pieces of state that must move together. These tests pin
 * that, so a future call site can't quietly implement a sixth variant.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readyDeploymentCard } from '../game/card-state-helpers.js';

const makeGame = () => ({
  p1DcMessageIds: ['m0', 'm1'],
  p1DcList: [{ dcName: 'Luke Skywalker', exhausted: true }, { dcName: 'Han Solo', exhausted: false }],
  p1ActivatedDcIndices: [0],
  p2DcMessageIds: ['n0'],
  p2DcList: [{ dcName: 'Vader', exhausted: true }],
  p2ActivatedDcIndices: [0],
});

describe('readyDeploymentCard', () => {
  test('moves all four pieces of ready-state together', () => {
    const game = makeGame();
    const store = new Map([['m0', true]]);
    let recomputed = 0;

    const res = readyDeploymentCard(game, 1, 'm0', {
      dcExhaustedState: store,
      recomputeActivationCounts: () => { recomputed++; },
    });

    assert.equal(res.changed, true);
    assert.equal(res.dcIndex, 0);
    assert.equal(store.get('m0'), false, '1. derived exhaust store cleared');
    assert.equal(game.p1DcList[0].exhausted, false, '2. persisted blob cleared');
    assert.deepEqual(game.p1ActivatedDcIndices, [], '3. activation actually given back');
    assert.equal(recomputed, 1, '4. activation counts recomputed');
  });

  test('does not disturb the other player or other cards', () => {
    const game = makeGame();
    readyDeploymentCard(game, 1, 'm0', {});
    assert.equal(game.p1DcList[1].exhausted, false, 'sibling card untouched');
    assert.deepEqual(game.p2ActivatedDcIndices, [0], 'opponent untouched');
    assert.equal(game.p2DcList[0].exhausted, true, 'opponent card untouched');
  });

  test('works without optional deps — still updates blob and activation', () => {
    // resolveAbility is sync and has no access to the derived store; the
    // persisted state must still move so the ready survives a reload.
    const game = makeGame();
    const res = readyDeploymentCard(game, 1, 'm0');
    assert.equal(res.changed, true);
    assert.equal(game.p1DcList[0].exhausted, false);
    assert.deepEqual(game.p1ActivatedDcIndices, []);
  });

  test('reports changed:false when the card was not activated', () => {
    // Guards the caller: Son of Skywalker only logs "Readied" when something
    // actually changed, so a no-op must not claim otherwise.
    const game = makeGame();
    const res = readyDeploymentCard(game, 1, 'm1');
    assert.equal(res.changed, false, 'm1 was never in the activated list');
    assert.equal(res.dcIndex, 1);
  });

  test('does not recompute counts when nothing changed', () => {
    const game = makeGame();
    let recomputed = 0;
    readyDeploymentCard(game, 1, 'm1', { recomputeActivationCounts: () => { recomputed++; } });
    assert.equal(recomputed, 0);
  });

  test('is idempotent', () => {
    const game = makeGame();
    readyDeploymentCard(game, 1, 'm0', {});
    const after = JSON.parse(JSON.stringify(game));
    readyDeploymentCard(game, 1, 'm0', {});
    assert.deepEqual(game, after);
  });

  test('tolerates bad input without throwing', () => {
    assert.doesNotThrow(() => readyDeploymentCard(null, 1, 'm0'));
    assert.doesNotThrow(() => readyDeploymentCard(makeGame(), 3, 'm0'));
    assert.doesNotThrow(() => readyDeploymentCard(makeGame(), 1, null));
    assert.equal(readyDeploymentCard(makeGame(), 1, 'nope').dcIndex, -1, 'unknown msgId');
  });
});
