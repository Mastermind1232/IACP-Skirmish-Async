import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createGameEngine } from '../../src/engine/game-engine.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('full activation cycle via engine API', () => {
  const dcMsgId = 'dc-msg-fc1';
  const baseGame = {
    gameId: '99010',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
    p1ActivationsRemaining: 1,
    p2ActivationsRemaining: 1,
    figurePositions: {
      1: { 'IG-88-1-0': 'e5' },
      2: { 'Luke Skywalker-1-0': 'j5' },
    },
    dcActionsData: {},
  };

  const deps = {
    dcMessageMeta: new Map([
      [dcMsgId, { gameId: '99010', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88' }],
      ['dc-msg-fc2', { gameId: '99010', playerNum: 2, dcName: 'Luke Skywalker', displayName: 'Luke Skywalker' }],
    ]),
    dcExhaustedState: new Map(),
  };

  it('P1 can see activate DC and pass turn actions', () => {
    const engine = createGameEngine(baseGame, null, deps);
    const actions = engine.getAvailableActions(1);

    assert.ok(actions.some(a => a.type === ACTION_TYPES.ACTIVATE_DC),
      'Should have ACTIVATE_DC action');
    assert.ok(actions.some(a => a.type === ACTION_TYPES.PASS_ACTIVATION_TURN),
      'Should have PASS_ACTIVATION_TURN action');
  });

  it('P2 has no actions when it is P1 turn', () => {
    const engine = createGameEngine(baseGame, null, deps);
    const actions = engine.getAvailableActions(2);
    assert.strictEqual(actions.length, 0);
  });

  it('engine shows end activation phase when no activations left', () => {
    const game = {
      ...baseGame,
      p1ActivationsRemaining: 0,
      p2ActivationsRemaining: 0,
    };
    const engine = createGameEngine(game, null, deps);
    const actions = engine.getAvailableActions(1);
    assert.ok(actions.some(a => a.type === ACTION_TYPES.END_ACTIVATION_PHASE));
  });

  it('phase gate actions take priority', () => {
    const game = {
      ...baseGame,
      phaseGate: { phase: 'activation_done', p1Ready: false, p2Ready: false },
    };
    const engine = createGameEngine(game, null, deps);
    const p1 = engine.getAvailableActions(1);
    const p2 = engine.getAvailableActions(2);

    assert.ok(p1.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
    assert.ok(p2.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
    assert.ok(!p1.some(a => a.type === ACTION_TYPES.ACTIVATE_DC));
  });

  it('shows move/attack/end-activation for DC with remaining actions', () => {
    const game = {
      ...baseGame,
      p1ActivationsRemaining: 0,
      dcActionsData: { [dcMsgId]: { remaining: 2, total: 2 } },
    };
    const depsWithExhausted = {
      ...deps,
      dcExhaustedState: new Map([[dcMsgId, true]]),
    };
    const engine = createGameEngine(game, null, depsWithExhausted);
    const actions = engine.getAvailableActions(1);

    assert.ok(actions.some(a => a.type === ACTION_TYPES.MOVE_FIGURE),
      'Should have MOVE_FIGURE');
    assert.ok(actions.some(a => a.type === ACTION_TYPES.ATTACK_TARGET),
      'Should have ATTACK_TARGET');
    assert.ok(actions.some(a => a.type === ACTION_TYPES.DC_END_ACTIVATION),
      'Should have DC_END_ACTIVATION');
  });
});
