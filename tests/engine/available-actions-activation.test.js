import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('getAvailableActions — activation phase', () => {
  const baseGame = {
    gameId: '00002',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
    p1ActivationsRemaining: 2,
    p2ActivationsRemaining: 2,
    figurePositions: { 1: { 'Stormtrooper (Regular)-1-0': 'e5' }, 2: { 'Rebel Trooper-1-0': 'j5' } },
    dcActionsData: {},
  };

  it('returns activation actions for current turn player', () => {
    const dcMessageMeta = new Map([
      ['msg1', { gameId: '00002', playerNum: 1, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper [Group 1]' }],
      ['msg2', { gameId: '00002', playerNum: 2, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 1]' }],
    ]);
    const dcExhaustedState = new Map();

    const deps = { dcMessageMeta, dcExhaustedState };
    const p1Actions = getAvailableActions(baseGame, 1, deps);

    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.ACTIVATE_DC));
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.PASS_ACTIVATION_TURN));
  });

  it('returns no activation actions for non-turn player', () => {
    const deps = { dcMessageMeta: new Map(), dcExhaustedState: new Map() };
    const p2Actions = getAvailableActions(baseGame, 2, deps);
    assert.strictEqual(p2Actions.length, 0);
  });

  it('returns move/attack/end-activation for activated DC with actions', () => {
    const game = {
      ...baseGame,
      p1ActivationsRemaining: 0,
      dcActionsData: {
        'msg1': { remaining: 2, total: 2 },
      },
    };
    const dcMessageMeta = new Map([
      ['msg1', { gameId: '00002', playerNum: 1, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper [Group 1]' }],
    ]);
    const dcExhaustedState = new Map([['msg1', true]]);
    const deps = { dcMessageMeta, dcExhaustedState };

    const actions = getAvailableActions(game, 1, deps);
    assert.ok(actions.some(a => a.type === ACTION_TYPES.MOVE_FIGURE));
    assert.ok(actions.some(a => a.type === ACTION_TYPES.ATTACK_TARGET));
    assert.ok(actions.some(a => a.type === ACTION_TYPES.DC_END_ACTIVATION));
  });

  it('returns end activation phase when both players have 0 activations', () => {
    const game = {
      ...baseGame,
      p1ActivationsRemaining: 0,
      p2ActivationsRemaining: 0,
    };
    const deps = { dcMessageMeta: new Map(), dcExhaustedState: new Map() };
    const actions = getAvailableActions(game, 1, deps);
    assert.ok(actions.some(a => a.type === ACTION_TYPES.END_ACTIVATION_PHASE));
  });

  it('skips exhausted DCs in activation list', () => {
    const dcMessageMeta = new Map([
      ['msg1', { gameId: '00002', playerNum: 1, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper [Group 1]' }],
    ]);
    const dcExhaustedState = new Map([['msg1', true]]);
    const deps = { dcMessageMeta, dcExhaustedState };

    const actions = getAvailableActions(baseGame, 1, deps);
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.ACTIVATE_DC));
  });
});
