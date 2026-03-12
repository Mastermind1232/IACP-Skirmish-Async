import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createGameEngine } from '../../src/engine/game-engine.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('createGameEngine', () => {
  const baseGame = {
    gameId: '00010',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
    p1ActivationsRemaining: 1,
    p2ActivationsRemaining: 1,
    figurePositions: { 1: { 'IG-88-1-0': 'e5' }, 2: { 'Luke Skywalker-1-0': 'j5' } },
    dcActionsData: {},
  };

  it('creates engine and returns state', () => {
    const engine = createGameEngine(baseGame);
    assert.strictEqual(engine.getState().gameId, '00010');
  });

  it('returns available actions for players', () => {
    const dcMessageMeta = new Map([
      ['msg1', { gameId: '00010', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88' }],
    ]);
    const engine = createGameEngine(baseGame, null, { dcMessageMeta, dcExhaustedState: new Map() });

    const p1Actions = engine.getAvailableActions(1);
    assert.ok(p1Actions.length > 0);

    const p2Actions = engine.getAvailableActions(2);
    assert.strictEqual(p2Actions.length, 0); // Not P2's turn
  });

  it('returns visible state with hidden opponent hand', () => {
    const game = {
      ...baseGame,
      player1CcHand: ['card1', 'card2'],
      player2CcHand: ['card3'],
      player1CcDeck: ['card4'],
      player2CcDeck: ['card5'],
    };
    const engine = createGameEngine(game);

    const p1View = engine.getVisibleState(1);
    assert.deepStrictEqual(p1View.player1CcHand, ['card1', 'card2']);
    assert.strictEqual(p1View.player2CcHand, undefined);
    assert.strictEqual(p1View.player2CcDeck, undefined);

    const p2View = engine.getVisibleState(2);
    assert.deepStrictEqual(p2View.player2CcHand, ['card3']);
    assert.strictEqual(p2View.player1CcHand, undefined);
  });

  it('getWaitingPlayers returns correct info', () => {
    const engine = createGameEngine(baseGame);
    const waiting = engine.getWaitingPlayers();
    assert.strictEqual(waiting.waitType, 'activation');
    assert.deepStrictEqual(waiting.playerNums, [1]);
  });

  it('getWaitingPlayers detects phase gate', () => {
    const game = {
      ...baseGame,
      phaseGate: { phase: 'deploy_done', p1Ready: false, p2Ready: true },
    };
    const engine = createGameEngine(game);
    const waiting = engine.getWaitingPlayers();
    assert.strictEqual(waiting.waitType, 'phaseGate');
    assert.deepStrictEqual(waiting.playerNums, [1]);
  });

  it('throws when submitAction called without harness', async () => {
    const engine = createGameEngine(baseGame);
    await assert.rejects(
      () => engine.submitAction('some_id', 'p1'),
      /requires a harness/
    );
  });
});
