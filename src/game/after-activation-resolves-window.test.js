/**
 * `afterActivationResolves` CCs must resolve in the window they are offered in.
 *
 * Blaze of Glory (IG-88) and Son of Skywalker (Luke) both read "after an
 * activation resolves, ready your Deployment card". The prompt that offers
 * them fires at the END of handleDcEndActivation — by which point
 * cleanupActivation has already deleted dcActionsData[msgId]. Both resolvers
 * looked the target up with findActiveActivationMsgId, which needs that entry,
 * so both bailed with "no activation in progress" for the entire window they
 * were legal in: the player paid the card and got nothing.
 *
 * handleDcEndActivation now records lastActivationMsgIdByPlayer before
 * cleanup, and the two resolvers fall back to it. These tests pin the window,
 * the precedence, and the staleness guard. alexanbv 2026-08-11.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveAbility } from './abilities.js';

const GAME_ID = 'g1';

/** A game whose activation of 'm0' has already been cleaned up. */
const makeResolvedGame = () => ({
  gameId: GAME_ID,
  p1DcMessageIds: ['m0', 'm1'],
  p1DcList: [{ dcName: 'IG-88', exhausted: true }, { dcName: 'Han Solo', exhausted: false }],
  p1ActivatedDcIndices: [0],
  // cleanupActivation already ran — this is the state the window opens in.
  dcActionsData: {},
  lastActivationMsgIdByPlayer: { 1: 'm0' },
});

const makeMeta = (overrides = {}) => new Map([
  ['m0', { gameId: GAME_ID, playerNum: 1, dcName: 'IG-88', displayName: 'IG-88', ...overrides }],
  ['m1', { gameId: GAME_ID, playerNum: 1, dcName: 'Han Solo', displayName: 'Han Solo' }],
]);

describe('afterActivationResolves window', () => {
  for (const cardName of ['Blaze of Glory', 'Son of Skywalker']) {
    test(`${cardName} resolves after cleanup, not only during the activation`, () => {
      const game = makeResolvedGame();
      const result = resolveAbility(cardName, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, true, 'must not bail with "no activation in progress"');
      assert.deepEqual(result.readyDcMsgIds, ['m0'], 'readies the DC that just activated');
      assert.equal(game.p1DcList[0].exhausted, false, 'persisted blob readied');
      assert.deepEqual(game.p1ActivatedDcIndices, [], 'activation actually given back');
    });

    test(`${cardName} still bails when the player never activated`, () => {
      const game = makeResolvedGame();
      delete game.lastActivationMsgIdByPlayer;
      const result = resolveAbility(cardName, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, false);
      assert.match(result.manualMessage, /no .*activation in progress/i);
      assert.deepEqual(game.p1ActivatedDcIndices, [0], 'nothing readied');
    });

    test(`${cardName} ignores a pointer belonging to another game`, () => {
      const game = makeResolvedGame();
      const result = resolveAbility(cardName, {
        game,
        playerNum: 1,
        dcMessageMeta: makeMeta({ gameId: 'some-other-game' }),
      });

      assert.equal(result.applied, false, 'a stale cross-game pointer must not resolve');
      assert.deepEqual(game.p1ActivatedDcIndices, [0], 'nothing readied');
    });

    test(`${cardName} prefers a live activation over the recorded pointer`, () => {
      // Played mid-activation (the path that always worked): the DC currently
      // activating wins, even when the pointer still names an earlier one.
      const game = makeResolvedGame();
      game.dcActionsData = { m1: {} };
      game.p1ActivatedDcIndices = [0, 1];
      game.p1DcList[1].exhausted = true;

      const result = resolveAbility(cardName, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, true);
      assert.deepEqual(result.readyDcMsgIds, ['m1'], 'live activation wins over the pointer');
      assert.equal(game.p1DcList[0].exhausted, true, 'the older DC is left alone');
    });
  }

  test('Blaze of Glory books its end-of-round damage against the DC it readied', () => {
    const game = makeResolvedGame();
    resolveAbility('Blaze of Glory', { game, playerNum: 1, dcMessageMeta: makeMeta() });

    assert.deepEqual(game.endOfRoundSelfDamage[1], { damage: 3, msgId: 'm0' });
  });
});
