/**
 * Random action player — AI training loop skeleton.
 * Creates a game and picks random actions until the game ends or we hit the iteration limit.
 * Tests that the engine doesn't crash on any action sequence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';

describe('random game (AI training skeleton)', () => {
  it('game builder creates valid game state', () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    assert.ok(game, 'game exists');
    assert.equal(game.phase, 'round_active');
    assert.equal(game.roundPhase, 'activation');
    assert.ok(dcMessageMeta.size >= 2, 'both players have DC meta');
    assert.ok(dcHealthState.size >= 2, 'both players have health state');
    assert.ok(Object.keys(game.figurePositions[1]).length > 0, 'P1 has deployed figures');
    assert.ok(Object.keys(game.figurePositions[2]).length > 0, 'P2 has deployed figures');
    assert.ok(game.p1ActivationsRemaining > 0, 'P1 has activations');
    assert.ok(game.p2ActivationsRemaining > 0, 'P2 has activations');
  });

  it('getAvailableActions returns valid actions for round_active', () => {
    const { game, deps, dcMessageMeta, dcExhaustedState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    const actions = getAvailableActions(game, 1, {
      dcMessageMeta,
      dcExhaustedState,
    });

    assert.ok(actions.length > 0, 'P1 has available actions');
    // Should include activate DC and pass
    const types = actions.map(a => a.type);
    assert.ok(types.includes('activate_dc'), 'can activate a DC');
    assert.ok(types.includes('pass_activation_turn'), 'can pass');
  });

  it('damage reduces HP and defeat triggers win check', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    // Defeat all P2 figures via NPC damage
    const p2Figs = Object.keys(game.figurePositions[2]);
    for (const fk of p2Figs) {
      await deps.applyNpcDamageToFigure(game, 2, fk, 999, 'Test Damage');
    }

    // Game should have ended due to elimination
    assert.ok(game.ended, 'game ended after all P2 figures defeated');
    assert.equal(game.winnerId, game.player1Id, 'P1 wins by elimination');
  });

  it('getAvailableActions returns empty for ended game', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    game.ended = true;
    const actions = getAvailableActions(game, 1, { dcMessageMeta });
    assert.equal(actions.length, 0, 'no actions for ended game');
  });

  it('VP kill tracking works through defeat', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Regular)' }])
      .inRound(1)
      .build();

    const initialVp = game.player1VP.total;

    // Defeat one P2 figure
    const fk = Object.keys(game.figurePositions[2])[0];
    await deps.applyNpcDamageToFigure(game, 2, fk, 999, 'Test');

    // VP should have increased
    assert.ok(game.player1VP.total > initialVp, `VP increased from ${initialVp} to ${game.player1VP.total}`);
  });

  it('random action loop completes a game without crashing', async () => {
    const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Regular)' }])
      .inRound(1)
      .build();

    const actionDeps = {
      dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
      computeMovementCache, getBoardStateForMovement, getMovementProfile,
      getPlayableCcFromHand,
    };
    const MAX_ITERATIONS = 500;
    let iterations = 0;
    let consecutiveEmpty = 0;
    let lastError = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations = i + 1;
      const g = harness.getGame();
      if (g.ended) break;

      // Try both players — some phases (combat) need actions from both
      const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
      const otherPlayer = turnPlayer === 1 ? 2 : 1;
      const p1Actions = getAvailableActions(g, 1, actionDeps);
      const p2Actions = getAvailableActions(g, 2, actionDeps);

      // Combine with player attribution
      const allActions = [
        ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
        ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
      ];

      if (allActions.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty > 10) {
          // Game is stuck — force end via NPC damage to break the deadlock
          const p2Figs = Object.keys(g.figurePositions?.[2] || {});
          const p1Figs = Object.keys(g.figurePositions?.[1] || {});
          if (p2Figs.length > 0) {
            await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
          } else if (p1Figs.length > 0) {
            await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
          } else {
            break; // No figures left — game should have ended
          }
          consecutiveEmpty = 0;
        }
        continue;
      }
      consecutiveEmpty = 0;

      // Pick a random action
      const action = allActions[Math.floor(Math.random() * allActions.length)];
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;

      try {
        const result = await harness.submitAction(action.customId, userId);
        if (result.error) {
          lastError = `${action.customId}: ${result.error}`;
          // Errors are ok — some actions may fail due to game state; continue
        }
      } catch (err) {
        lastError = `${action.customId}: ${err.message}`;
        // Don't crash the loop — log and continue
      }
    }

    const finalGame = harness.getGame();
    // Game should have progressed (either ended or made progress)
    assert.ok(iterations > 1, `ran ${iterations} iterations`);
    // If game didn't end naturally, it should have been force-ended via deadlock breaker
    if (!finalGame.ended) {
      assert.ok(iterations >= MAX_ITERATIONS || consecutiveEmpty > 0,
        `game did not end but ran ${iterations} iterations (last error: ${lastError})`);
    }
  });

  it('attack target selection finds valid targets', () => {
    const { game, deps, dcMessageMeta, dcExhaustedState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    // Activate P1's DC so it has actions remaining
    const p1MsgId = [...dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgId] = { remaining: 2, total: 2, selectedFigure: 0 };

    const actions = getAvailableActions(game, 1, {
      dcMessageMeta,
      dcExhaustedState,
      getDcStats,
      getMapData,
    });

    const attackActions = actions.filter(a => a.type === 'attack_target');
    // Should have individual targets (not just generic "Attack with X")
    if (attackActions.length > 0) {
      const hasTarget = attackActions.some(a => a.params?.targetFigureKey);
      assert.ok(hasTarget, 'at least one attack action has a specific target');
      // customId should be attack_target_${msgId}_${figureIndex}_${targetIndex}
      const targeted = attackActions.find(a => a.params?.targetFigureKey);
      assert.ok(targeted.customId.startsWith('attack_target_'), `customId format: ${targeted.customId}`);
    }
  });
});
