/**
 * `afterActivationResolves` CCs: the window they resolve in, and the card they
 * resolve against. Two separate things, both of which were wrong.
 *
 * THE WINDOW. Blaze of Glory (IG-88) and Son of Skywalker (Luke) are offered at
 * the end of handleDcEndActivation, by which point cleanupActivation has
 * deleted dcActionsData[msgId]. Both resolvers looked their target up with
 * findActiveActivationMsgId, which needs that entry, so both bailed with "no
 * activation in progress" for the entire window they were legal in and the
 * player paid the card for nothing.
 *
 * THE TARGET. Both then readied whichever card had just activated. alexanbv
 * 2026-08-12: "they should not just ready whatever DC went, they should ready
 * the named DC." Play Son of Skywalker after your Stormtroopers resolve and it
 * readied the Stormtroopers.
 *
 * ONE TIME. Son of Skywalker also set a standing flag that re-readied the card
 * after every later activation that round ("they should not repeatedly ready,
 * it is a one time ability"). That is pinned in end-activation-parity.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveAbility } from './abilities.js';

const GAME_ID = 'g1';

const CARDS = [
  { card: 'Blaze of Glory', figure: 'IG-88', msgId: 'm-ig', index: 1, figureKey: 'IG-88-1-0' },
  { card: 'Son of Skywalker', figure: 'Luke Skywalker', msgId: 'm-luke', index: 2, figureKey: 'Luke Skywalker-1-0' },
];

/**
 * Stormtroopers have just finished activating. IG-88 and Luke are both in play
 * and both exhausted, so "readied the wrong card" is observable.
 */
const makeGame = () => ({
  gameId: GAME_ID,
  p1DcMessageIds: ['m-st', 'm-ig', 'm-luke'],
  p1DcList: [
    { dcName: 'Stormtrooper', exhausted: true },
    { dcName: 'IG-88', exhausted: true },
    { dcName: 'Luke Skywalker', exhausted: true },
  ],
  p1ActivatedDcIndices: [0, 1, 2],
  figurePositions: {
    1: { 'Stormtrooper-1-0': 'a1', 'IG-88-1-0': 'b1', 'Luke Skywalker-1-0': 'c1' },
  },
  dcActionsData: {},                              // cleanupActivation already ran
  lastActivationMsgIdByPlayer: { 1: 'm-st' },     // Stormtroopers were last
});

const makeMeta = (overrides = {}) => new Map([
  ['m-st', { gameId: GAME_ID, playerNum: 1, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 1]' }],
  ['m-ig', { gameId: GAME_ID, playerNum: 1, dcName: 'IG-88', displayName: 'IG-88', ...overrides }],
  ['m-luke', { gameId: GAME_ID, playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke Skywalker', ...overrides }],
]);

describe('afterActivationResolves window', () => {
  for (const { card, figure, msgId, index, figureKey } of CARDS) {
    test(`${card} resolves after cleanup, not only during the activation`, () => {
      const game = makeGame();
      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, true, 'must not bail with "no activation in progress"');
      assert.equal(game.p1DcList[index].exhausted, false, `${figure} readied in the persisted blob`);
      assert.ok(!game.p1ActivatedDcIndices.includes(index), 'activation actually given back');
    });

    test(`${card} readies ${figure}'s card, not the one that just activated`, () => {
      const game = makeGame();
      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.deepEqual(result.readyDcMsgIds, [msgId], `targets ${figure}`);
      assert.equal(game.p1DcList[0].exhausted, true, 'the Stormtroopers stay exhausted');
      assert.ok(game.p1ActivatedDcIndices.includes(0), 'the Stormtroopers keep their activation spent');
    });

    test(`${card} bails when ${figure} is not on the board`, () => {
      const game = makeGame();
      delete game.figurePositions[1][figureKey];
      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, false);
      assert.deepEqual(game.p1ActivatedDcIndices, [0, 1, 2], 'nothing readied');
    });

    test(`${card} resolves off a HOSTILE activation too`, () => {
      // alexanbv 2026-08-12: "Sos and blaze can be played after any activation,
      // friendly or hostile." Only the opponent has activated.
      const game = makeGame();
      game.lastActivationMsgIdByPlayer = { 2: 'm-opp' };
      const meta = makeMeta();
      meta.set('m-opp', { gameId: GAME_ID, playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 1]' });

      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: meta });

      assert.equal(result.applied, true, 'a hostile activation opens the window');
      assert.deepEqual(result.readyDcMsgIds, [msgId], `and still readies ${figure}`);
    });

    test(`${card} bails when no activation has resolved yet`, () => {
      const game = makeGame();
      delete game.lastActivationMsgIdByPlayer;
      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, false, 'the timing gate still has to hold');
      assert.match(result.manualMessage, /no activation has resolved/i);
      assert.deepEqual(game.p1ActivatedDcIndices, [0, 1, 2], 'nothing readied');
    });

    test(`${card} ignores a pointer belonging to another game`, () => {
      const game = makeGame();
      const meta = makeMeta();
      meta.set('m-st', { gameId: 'some-other-game', playerNum: 1, dcName: 'Stormtrooper' });
      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: meta });

      assert.equal(result.applied, false, 'a stale cross-game pointer must not open the window');
      assert.deepEqual(game.p1ActivatedDcIndices, [0, 1, 2], 'nothing readied');
    });

    test(`${card} also resolves while an activation is still live`, () => {
      // The path that always worked: the gate accepts a live activation too.
      const game = makeGame();
      delete game.lastActivationMsgIdByPlayer;
      game.dcActionsData = { 'm-st': {} };

      const result = resolveAbility(card, { game, playerNum: 1, dcMessageMeta: makeMeta() });

      assert.equal(result.applied, true);
      assert.deepEqual(result.readyDcMsgIds, [msgId], `still targets ${figure}`);
    });
  }

  test('Blaze of Glory books its end-of-round damage against IG-88, not the last activation', () => {
    const game = makeGame();
    resolveAbility('Blaze of Glory', { game, playerNum: 1, dcMessageMeta: makeMeta() });

    assert.deepEqual(game.endOfRoundSelfDamage[1], { damage: 3, msgId: 'm-ig' });
  });

  test('Son of Skywalker leaves no standing re-ready flag', () => {
    const game = makeGame();
    resolveAbility('Son of Skywalker', { game, playerNum: 1, dcMessageMeta: makeMeta() });

    assert.equal(game.sonOfSkywalkerActive, undefined, 'one-time ability, not a round-long effect');
  });
});
