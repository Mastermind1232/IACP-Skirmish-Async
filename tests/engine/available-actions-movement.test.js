import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('getAvailableActions — movement flow', () => {
  const baseGame = {
    gameId: '00004',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
  };

  it('returns movement pick space when move is in progress', () => {
    const game = {
      ...baseGame,
      moveInProgress: {
        'move_key_1': { playerNum: 1, phase: 'pick_space', figureKey: 'IG-88-1-0' },
      },
    };

    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.MOVE_PICK_SPACE),
      'Should have move_pick_space action');
  });

  it('returns no movement actions for wrong player', () => {
    const game = {
      ...baseGame,
      moveInProgress: {
        'move_key_1': { playerNum: 1, phase: 'pick_space', figureKey: 'IG-88-1-0' },
      },
    };

    const p2Actions = getAvailableActions(game, 2);
    assert.strictEqual(p2Actions.length, 0, 'P2 should have no actions during P1 move');
  });

  it('returns movement actions when no explicit phase set', () => {
    const game = {
      ...baseGame,
      moveInProgress: {
        'move_key_2': { playerNum: 1, figureKey: 'Stormtrooper-1-0' },
      },
    };

    const actions = getAvailableActions(game, 1);
    assert.ok(actions.some(a => a.type === ACTION_TYPES.MOVE_PICK_SPACE));
  });

  it('handles empty moveInProgress gracefully', () => {
    const game = {
      ...baseGame,
      moveInProgress: {},
    };

    // Should fall through to normal activation actions
    const actions = getAvailableActions(game, 1);
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.MOVE_PICK_SPACE));
  });

  it('movement takes priority over activation actions', () => {
    const game = {
      ...baseGame,
      p1ActivationsRemaining: 1,
      moveInProgress: {
        'move_key_3': { playerNum: 1, phase: 'pick_space', figureKey: 'IG-88-1-0' },
      },
    };

    const actions = getAvailableActions(game, 1);
    // Should only have movement actions, not activation
    assert.ok(actions.some(a => a.type === ACTION_TYPES.MOVE_PICK_SPACE));
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.ACTIVATE_DC));
  });
});
