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

/**
 * Cross-system invariant: readying must withdraw the card from the
 * "exhausted or defeated groups" tally that Lie in Ambush counts.
 *
 * alexanbv 2026-08-11: "you also need to track the time at which the LiA figure
 * deploys, which also depends on number of exhausted and defeated cards. A
 * re-readied card would no longer count to that total."
 *
 * checkLieInAmbushTrigger (handlers/activation.js ~310) derives its tally from
 * getActivatedDcIndices at check time — it is NOT a stored counter. So the
 * invariant holds automatically PROVIDED every ready effect actually removes
 * the index. Before the primitive, Blaze of Glory / Change of Plans / Rancor /
 * Scrap Battalion did not: a readied card still counted as exhausted, so LiA
 * could reach its 3-group threshold EARLY.
 *
 * This pins the linkage rather than the trigger itself.
 */
describe('readyDeploymentCard — Lie in Ambush tally linkage', () => {
  test('a readied card leaves the activated set LiA counts', () => {
    const game = {
      p1DcMessageIds: ['m0', 'm1', 'm2'],
      p1DcList: [
        { dcName: 'Luke Skywalker', exhausted: true },
        { dcName: 'Han Solo', exhausted: true },
        { dcName: 'Chewbacca', exhausted: true },
      ],
      // Three exhausted groups: exactly LiA's threshold.
      p1ActivatedDcIndices: [0, 1, 2],
    };
    const tally = () => game.p1ActivatedDcIndices.length;
    assert.equal(tally(), 3, 'threshold met before the ready');

    readyDeploymentCard(game, 1, 'm1', {});

    assert.equal(tally(), 2, 'readied card no longer counts as exhausted');
    assert.deepEqual(game.p1ActivatedDcIndices, [0, 2], 'only that card withdrawn');
  });

  test('readying a never-activated card does not change the tally', () => {
    const game = {
      p1DcMessageIds: ['m0', 'm1'],
      p1DcList: [{ dcName: 'Luke Skywalker' }, { dcName: 'Han Solo' }],
      p1ActivatedDcIndices: [0],
    };
    readyDeploymentCard(game, 1, 'm1', {});
    assert.deepEqual(game.p1ActivatedDcIndices, [0], 'tally untouched');
  });
});

/**
 * Once-per-ACTIVATION counters reset on ready; once-per-ROUND ones do not.
 *
 * alexanbv 2026-08-11: the unified ready "should ready the card, remove it from
 * the exhausted list, and reset any once/activation (not once/round) counters."
 * A readied card gets a NEW activation, so Heroic / Bo-Rifle / the Wookiee
 * Avenger slam / special-action-used / attack-performed must be available
 * again. Round-scoped limits are not refreshed — a ready is not a new round.
 */
describe('readyDeploymentCard — once-per-activation counters', () => {
  const activatedGame = (extra = {}) => ({
    p1DcMessageIds: ['m0'],
    p1DcList: [{ dcName: 'Luke Skywalker' }],
    p1ActivatedDcIndices: [0],
    dcActionsData: {},
    heroicUsedThisActivation: { 'Luke Skywalker-1-0': true, 'Han Solo-1-0': true },
    attackPerformedThisActivation: { 'Luke Skywalker-1-0': true },
    specialActionUsedThisActivation: { 'Luke Skywalker-1-0': 1 },
    // Once-per-ROUND — must survive a ready.
    roundFigureAbilityUsed: { 'trustBothWays_m0': true },
    ...extra,
  });

  test('clears once-per-activation flags for the readied card only', () => {
    const game = activatedGame();
    readyDeploymentCard(game, 1, 'm0', {});
    assert.equal(game.heroicUsedThisActivation['Luke Skywalker-1-0'], undefined, 'Heroic available again');
    assert.equal(game.attackPerformedThisActivation['Luke Skywalker-1-0'], undefined, 'may attack again');
    assert.equal(game.specialActionUsedThisActivation['Luke Skywalker-1-0'], undefined, 'special action available');
    assert.equal(game.heroicUsedThisActivation['Han Solo-1-0'], true, 'other figure untouched');
  });

  test('does NOT reset once-per-round state', () => {
    const game = activatedGame();
    readyDeploymentCard(game, 1, 'm0', {});
    assert.equal(game.roundFigureAbilityUsed['trustBothWays_m0'], true, 'round limit still spent');
  });

  test('preserves spent abilities while the card is MID-activation', () => {
    // Blaze of Glory readies IG-88's own card during its activation. The
    // current activation must keep its spent flags — otherwise Heroic could be
    // used twice in one activation. cleanupActivation clears them at the end.
    const game = activatedGame({ dcActionsData: { m0: { perFigureRemaining: { 0: 1 } } } });
    readyDeploymentCard(game, 1, 'm0', {});
    assert.equal(game.heroicUsedThisActivation['Luke Skywalker-1-0'], true, 'still spent this activation');
    assert.equal(game.attackPerformedThisActivation['Luke Skywalker-1-0'], true, 'still spent this activation');
    assert.deepEqual(game.p1ActivatedDcIndices, [], 'but the card is still readied');
  });

  test('distinguishes same-named groups by dgIndex', () => {
    const game = {
      p1DcMessageIds: ['m0', 'm1'],
      p1DcList: [{ dcName: 'Stormtrooper' }, { dcName: 'Stormtrooper' }],
      p1ActivatedDcIndices: [0, 1],
      dcActionsData: {},
      attackPerformedThisActivation: { 'Stormtrooper-1-0': true, 'Stormtrooper-2-0': true },
    };
    readyDeploymentCard(game, 1, 'm1', {}); // second group
    assert.equal(game.attackPerformedThisActivation['Stormtrooper-2-0'], undefined, 'group 2 reset');
    assert.equal(game.attackPerformedThisActivation['Stormtrooper-1-0'], true, 'group 1 untouched');
  });
});
