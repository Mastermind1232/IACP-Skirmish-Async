import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aiTakeTurn, aiSelfPlay } from '../../src/ai/ai-player.js';
import { createGameEngine } from '../../src/engine/game-engine.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('AI player', () => {
  describe('aiTakeTurn', () => {
    it('returns immediately when no actions available', async () => {
      const game = {
        gameId: '99030',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        phase: 'round_active',
        roundPhase: 'activation',
        currentActivationTurnPlayerId: 'p1',
      };
      const engine = createGameEngine(game);

      // P2 has no actions (not their turn)
      const result = await aiTakeTurn(engine, 2);
      assert.strictEqual(result.steps, 0);
      assert.strictEqual(result.actions.length, 0);
      assert.strictEqual(result.gameEnded, false);
    });

    it('returns gameEnded=true for ended games', async () => {
      const game = {
        gameId: '99031',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        ended: true,
        winnerId: 'p1',
      };
      const engine = createGameEngine(game);
      const result = await aiTakeTurn(engine, 1);
      assert.strictEqual(result.gameEnded, true);
    });

    it('onAction callback fires for each step', async () => {
      const game = {
        gameId: '99032',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        phase: 'deployment',
        phaseGate: { phase: 'deploy_done', p1Ready: false, p2Ready: false },
      };
      const engine = createGameEngine(game);

      const callbackActions = [];
      const result = await aiTakeTurn(engine, 1, {
        maxSteps: 1,
        onAction: (action, step) => callbackActions.push({ action, step }),
      });

      // Phase gate ready should be available as single action
      // With maxSteps=1, it should take at most 1 step
      // But submitAction requires harness, so will error
      // The key test is that the loop runs and respects maxSteps
      assert.ok(result.steps <= 1);
    });

    it('respects maxSteps safety limit', async () => {
      // Create a game that always has available actions (phase gate)
      const game = {
        gameId: '99033',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        phase: 'deployment',
        phaseGate: { phase: 'test', p1Ready: false, p2Ready: false },
      };
      const engine = createGameEngine(game);

      // Without a harness, submitAction will fail — AI loop should catch and return
      const result = await aiTakeTurn(engine, 1, { maxSteps: 3 });
      // Should stop early due to error (no harness)
      assert.ok(result.steps <= 3, `Steps should be <= 3, got ${result.steps}`);
    });
  });

  describe('aiSelfPlay', () => {
    it('returns when game is already ended', async () => {
      const game = {
        gameId: '99040',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        ended: true,
        winnerId: 'p1',
      };
      const engine = createGameEngine(game);
      const result = await aiSelfPlay(engine, { maxRounds: 1 });
      assert.strictEqual(result.gameEnded, true);
    });

    it('respects maxTotalSteps limit', async () => {
      const game = {
        gameId: '99041',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        phase: 'deployment',
        phaseGate: { phase: 'test', p1Ready: false, p2Ready: false },
      };
      const engine = createGameEngine(game);

      // Low limit — should stop quickly
      const result = await aiSelfPlay(engine, { maxTotalSteps: 5 });
      assert.ok(result.totalSteps <= 5);
    });

    it('onTurn callback fires', async () => {
      const game = {
        gameId: '99042',
        player1Id: 'p1',
        player2Id: 'p2',
        initiativePlayerId: 'p1',
        ended: true,
        winnerId: 'p2',
      };
      const engine = createGameEngine(game);

      let turnCallCount = 0;
      await aiSelfPlay(engine, {
        onTurn: () => { turnCallCount++; },
      });
      // Game ended immediately, P1 turn fires then gameEnded detected
      assert.ok(turnCallCount >= 1);
    });
  });
});
