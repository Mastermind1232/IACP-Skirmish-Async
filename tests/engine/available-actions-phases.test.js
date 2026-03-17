import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('getAvailableActions — phase gate and round phases', () => {
  const baseGame = {
    gameId: '00005',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
  };

  describe('phase gate', () => {
    it('both players get ready action when neither is ready', () => {
      const game = {
        ...baseGame,
        phase: 'round_active',
        phaseGate: { phase: 'deploy_done', p1Ready: false, p2Ready: false },
      };
      const p1 = getAvailableActions(game, 1);
      const p2 = getAvailableActions(game, 2);
      assert.ok(p1.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
      assert.ok(p2.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
    });

    it('ready player gets unready action', () => {
      const game = {
        ...baseGame,
        phase: 'round_active',
        phaseGate: { phase: 'deploy_done', p1Ready: true, p2Ready: false },
      };
      const p1 = getAvailableActions(game, 1);
      assert.ok(p1.some(a => a.type === ACTION_TYPES.PHASE_GATE_UNREADY));
      assert.ok(!p1.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
    });

    it('phase gate overrides all other phases', () => {
      const game = {
        ...baseGame,
        phase: 'round_active',
        roundPhase: 'activation',
        currentActivationTurnPlayerId: 'p1',
        p1ActivationsRemaining: 2,
        phaseGate: { phase: 'test', p1Ready: false, p2Ready: false },
      };
      const actions = getAvailableActions(game, 1);
      // Should only return phase gate actions, not activation
      assert.ok(actions.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
      assert.ok(!actions.some(a => a.type === ACTION_TYPES.ACTIVATE_DC));
    });
  });

  describe('start of round', () => {
    it('returns end_start_of_round action', () => {
      const game = {
        ...baseGame,
        phase: 'round_active',
        roundPhase: 'start_of_round',
      };
      const actions = getAvailableActions(game, 1);
      assert.ok(actions.some(a => a.type === ACTION_TYPES.END_START_OF_ROUND));
    });
  });

  describe('end of round', () => {
    it('returns end_end_of_round action for whose turn it is', () => {
      const game = {
        ...baseGame,
        phase: 'round_active',
        roundPhase: 'end_of_round',
        endOfRoundWhoseTurn: 'p1',
      };
      const p1 = getAvailableActions(game, 1);
      assert.ok(p1.some(a => a.type === ACTION_TYPES.END_END_OF_ROUND));

      const p2 = getAvailableActions(game, 2);
      assert.strictEqual(p2.length, 0);
    });

    it('returns action only for the player whose turn it is', () => {
      const game1 = {
        ...baseGame,
        phase: 'round_active',
        roundPhase: 'end_of_round',
        endOfRoundWhoseTurn: 'p1',
      };
      const p1 = getAvailableActions(game1, 1);
      assert.ok(p1.some(a => a.type === ACTION_TYPES.END_END_OF_ROUND));

      const game2 = {
        ...baseGame,
        phase: 'round_active',
        roundPhase: 'end_of_round',
        endOfRoundWhoseTurn: 'p2',
      };
      const p2 = getAvailableActions(game2, 2);
      assert.ok(p2.some(a => a.type === ACTION_TYPES.END_END_OF_ROUND));
    });
  });

  describe('negation', () => {
    it('returns negation actions for opponent of card player', () => {
      const game = {
        ...baseGame,
        phase: 'round_active',
        roundPhase: 'activation',
        pendingNegation: { playedBy: 1, cardName: 'Son of Skywalker' },
      };
      // P2 (opponent of player who played the card) gets negation options
      const p2 = getAvailableActions(game, 2);
      assert.ok(p2.some(a => a.type === 'negation_play'));
      assert.ok(p2.some(a => a.type === 'negation_let_resolve'));

      // P1 (who played card) has no actions
      const p1 = getAvailableActions(game, 1);
      assert.strictEqual(p1.length, 0);
    });
  });

  describe('initiative', () => {
    it('returns initiative roll action for both players', () => {
      const game = {
        ...baseGame,
        phase: 'initiative',
      };
      const p1 = getAvailableActions(game, 1);
      assert.ok(p1.some(a => a.type === ACTION_TYPES.DETERMINE_INITIATIVE));

      const p2 = getAvailableActions(game, 2);
      assert.ok(p2.some(a => a.type === ACTION_TYPES.DETERMINE_INITIATIVE));
    });
  });

  describe('map selection', () => {
    it('returns draft_random when map pool exists', () => {
      const game = {
        ...baseGame,
        phase: 'map_selection',
        draftMapPool: ['map_a', 'map_b'],
      };
      const actions = getAvailableActions(game, 1);
      assert.ok(actions.some(a => a.type === ACTION_TYPES.DRAFT_RANDOM));
    });

    it('returns empty when no map pool', () => {
      const game = {
        ...baseGame,
        phase: 'map_selection',
        draftMapPool: [],
      };
      const actions = getAvailableActions(game, 1);
      assert.strictEqual(actions.length, 0);
    });
  });
});
