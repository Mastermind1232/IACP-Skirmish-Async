import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('getAvailableActions — combat flow', () => {
  const baseGame = {
    gameId: '00003',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
  };

  it('returns combat gate action for the currently-active gate player only', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        currentStep: 'step1+2-defender',
        combatGate: { phase: 'on_declare', acked: { 1: true }, activePlayer: 2 },
      },
    };

    const p1Actions = getAvailableActions(game, 1);
    assert.strictEqual(p1Actions.length, 0); // P1 already acked

    const p2Actions = getAvailableActions(game, 2);
    assert.ok(p2Actions.some(a => a.type === ACTION_TYPES.COMBAT_GATE));
  });

  it('returns roll dice when both ready but no rolls', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: true,
        attackRoll: null,
        defenseRoll: null,
      },
    };

    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.COMBAT_ROLL));
  });

  it('returns reroll actions during reroll phase', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: true,
        attackRoll: [1, 2, 3],
        defenseRoll: [1, 2],
        rerollPhase: 'attacker',
        attackerRerollsRemaining: 1,
        attackDiceResults: [
          { color: 'blue', accuracy: 2, damage: 1, surge: 0 },
          { color: 'green', accuracy: 0, damage: 2, surge: 1 },
          { color: 'red', accuracy: 0, damage: 3, surge: 0 },
        ],
        attackerRerolledIndices: [],
      },
    };

    const p1Actions = getAvailableActions(game, 1); // attacker
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.COMBAT_REROLL));

    const p2Actions = getAvailableActions(game, 2); // defender, not their turn
    assert.strictEqual(p2Actions.length, 0);
  });

  it('returns no combat actions when no pending combat', () => {
    const actions = getAvailableActions(baseGame, 1);
    // Should get activation actions instead, not combat
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.COMBAT_GATE));
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.COMBAT_ROLL));
  });
});
