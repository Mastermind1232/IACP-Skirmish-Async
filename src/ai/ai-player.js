/**
 * AI Player: main loop that takes turns using the game engine API.
 * Selects actions from available options using the strategy module.
 */

import { pickBestAction, pickRandomAction } from './strategy.js';

/**
 * Have the AI take a turn (or multiple actions until it's not the AI's turn anymore).
 * Stops when:
 * - No available actions for the AI
 * - Safety limit reached (prevents infinite loops)
 * - Game ended
 *
 * @param {object} engine - Game engine instance with submitAction capability
 * @param {number} playerNum - Which player the AI controls (1 or 2)
 * @param {object} [options]
 * @param {number} [options.maxSteps=200] - Safety limit
 * @param {string} [options.strategy='greedy'] - 'greedy' or 'random'
 * @param {function} [options.onAction] - Callback after each action: (action, step) => void
 * @returns {Promise<{ steps: number, actions: object[], gameEnded: boolean }>}
 */
export async function aiTakeTurn(engine, playerNum, options = {}) {
  const maxSteps = options.maxSteps || 200;
  const strategy = options.strategy || 'greedy';
  const onAction = options.onAction || null;
  const userId = `ai_p${playerNum}`;
  const actionLog = [];

  for (let step = 0; step < maxSteps; step++) {
    const game = engine.getState();
    if (game.ended) {
      return { steps: step, actions: actionLog, gameEnded: true };
    }

    const actions = engine.getAvailableActions(playerNum);
    if (!actions || actions.length === 0) {
      return { steps: step, actions: actionLog, gameEnded: false };
    }

    // Pick an action
    let chosen;
    if (strategy === 'random') {
      chosen = pickRandomAction(actions);
    } else {
      const result = pickBestAction(engine, actions, playerNum);
      chosen = result?.action || actions[0];
    }

    if (!chosen) {
      return { steps: step, actions: actionLog, gameEnded: false };
    }

    // Execute the action
    try {
      await engine.submitAction(chosen.customId, userId);
      actionLog.push(chosen);
      if (onAction) onAction(chosen, step);
    } catch (err) {
      console.error(`[AI] Step ${step} failed:`, err.message);
      // Don't loop on errors — return what we have
      return { steps: step, actions: actionLog, gameEnded: false, error: err.message };
    }
  }

  console.warn(`[AI] Reached safety limit of ${maxSteps} steps`);
  return { steps: maxSteps, actions: actionLog, gameEnded: false };
}

/**
 * Have two AIs play a full game against each other.
 * Alternates turns until the game ends or max rounds reached.
 *
 * @param {object} engine - Game engine instance
 * @param {object} [options]
 * @param {number} [options.maxRounds=20] - Maximum rounds before forcing a stop
 * @param {number} [options.maxTotalSteps=2000] - Total action limit across all turns
 * @param {function} [options.onTurn] - Callback: (playerNum, actions, round) => void
 * @returns {Promise<{ rounds: number, totalSteps: number, gameEnded: boolean, winner: string|null }>}
 */
export async function aiSelfPlay(engine, options = {}) {
  const maxRounds = options.maxRounds || 20;
  const maxTotalSteps = options.maxTotalSteps || 2000;
  const onTurn = options.onTurn || null;
  let totalSteps = 0;

  for (let round = 0; round < maxRounds * 4; round++) {
    // Let each player take actions in turn
    for (const playerNum of [1, 2]) {
      const result = await aiTakeTurn(engine, playerNum, {
        maxSteps: Math.min(100, maxTotalSteps - totalSteps),
        strategy: 'greedy',
      });

      totalSteps += result.steps;
      if (onTurn) onTurn(playerNum, result.actions, round);

      if (result.gameEnded) {
        const game = engine.getState();
        return {
          rounds: game.currentRound || round,
          totalSteps,
          gameEnded: true,
          winner: game.winnerId || null,
        };
      }

      if (totalSteps >= maxTotalSteps) {
        return {
          rounds: round,
          totalSteps,
          gameEnded: false,
          winner: null,
        };
      }
    }
  }

  return {
    rounds: maxRounds,
    totalSteps,
    gameEnded: false,
    winner: null,
  };
}
