/**
 * Force Surge resolves at end of activation, with or without a live activation.
 *
 * alexanbv 2026-08-12, correcting me:
 *
 *   "immediate spends do NOT require an activation. For example, an eOfficer
 *    can order a move that another figure spends immediately. Jundland Terror
 *    is an EOR effect with immediate spend.
 *    Both Force surge and Diplo SHOULD have same timing as rebel graffiti and
 *    STRICTLY End of Act. This DOES NOT preclude immediate spend of MP"
 *
 * So the defect was never "the activation must still exist". It was that the
 * resolver looked its actor up with findActiveActivationMsgId, which needs a
 * live activation, and refused to resolve at all once the activation had been
 * torn down. addMovementPoints already handles out-of-activation grants by
 * tagging them must-spend-immediately, the same path Order uses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveAbility } from './abilities.js';

const GAME_ID = 'g-fs';

/** Luke's activation has resolved and been cleaned up. An enemy is adjacent. */
const makeGame = () => ({
  gameId: GAME_ID,
  p1DcMessageIds: ['m-luke'],
  p1DcList: [{ dcName: 'Luke Skywalker', displayName: 'Luke Skywalker' }],
  p1ActivatedDcIndices: [0],
  figurePositions: {
    1: { 'Luke Skywalker-1-0': 'c5' },
    2: { 'Stormtrooper-1-0': 'c6' },
  },
  dcActionsData: {},                            // cleanupActivation already ran
  lastActivationMsgIdByPlayer: { 1: 'm-luke' },
});

const META = () => new Map([
  ['m-luke', { gameId: GAME_ID, playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke Skywalker' }],
]);

const play = (game, meta = META()) =>
  resolveAbility('Force Surge', { game, playerNum: 1, dcMessageMeta: meta, cardName: 'Force Surge' });

describe('Force Surge at end of activation', () => {
  test('resolves after the activation has been torn down', () => {
    const game = makeGame();
    const result = play(game);

    assert.equal(result.applied, true, 'must not bail with "no activation in progress"');
    assert.ok(game.pendingMoveX?.['m-luke'], 'the move was granted');
  });

  test('grants a SPACE move, not terrain-costed MP', () => {
    // alexanbv: "Force Surge is move spaces". Diplomatic Mission's +2 MP is the
    // one that pays terrain; this does not.
    const game = makeGame();
    play(game);

    const pmx = game.pendingMoveX['m-luke'];
    assert.equal(pmx.remaining, 1, 'up to 1 space');
    assert.equal(pmx.bypassCosts, true, 'spaces, so terrain cost is bypassed');
  });

  test('targets the playing figure, not whoever activated last', () => {
    const game = makeGame();
    play(game);

    assert.equal(game.pendingMoveX['m-luke'].figureKey, 'Luke Skywalker-1-0');
    assert.equal(game.pendingMoveX['m-luke'].playerNum, 1);
  });

  test("does NOT resolve off the opponent's activation", () => {
    // The scope hazard. Blaze and Son of Skywalker fire off any activation, so
    // the shared helper can scan both players. Force Surge must not: 'any'
    // would resolve against the opponent's last activation and grant them the
    // move. Only P2 has activated here.
    const game = makeGame();
    game.lastActivationMsgIdByPlayer = { 2: 'm-opp' };
    const meta = META();
    meta.set('m-opp', { gameId: GAME_ID, playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 1]' });

    const result = play(game, meta);

    assert.equal(result.applied, false, "the opponent's activation must not open it");
    assert.equal(game.pendingMoveX?.['m-opp'], undefined, 'and must never grant them the move');
  });

  test('still resolves during the activation, the path that always worked', () => {
    const game = makeGame();
    delete game.lastActivationMsgIdByPlayer;
    game.dcActionsData = { 'm-luke': { selectedFigure: 0 } };

    assert.equal(play(game).applied, true);
  });
});
