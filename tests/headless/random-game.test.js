/**
 * Random action player — AI training loop skeleton.
 * Creates a game and picks random actions until the game ends or we hit the iteration limit.
 * Tests that the engine doesn't crash on any action sequence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';

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
});
