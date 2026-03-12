/**
 * Game Engine API: orchestrates available actions + handler execution.
 * Provides a clean interface for headless testing and AI players.
 */

import { getAvailableActions } from './available-actions.js';
import { getPlayerId } from '../game/player-helpers.js';

/**
 * Create a game engine instance wrapping a game state.
 * The engine provides:
 * - getAvailableActions(playerNum) — list legal actions
 * - getState() — current game state
 * - getVisibleState(playerNum) — state with opponent's hand hidden
 *
 * If a harness is provided, the engine also supports:
 * - submitAction(customId, userId) — execute an action through the handler pipeline
 *
 * @param {object} game - The game state object
 * @param {object} [harness] - Optional game harness for action submission
 * @param {object} [deps] - Optional dependencies for available-actions queries
 * @returns {object} Game engine instance
 */
export function createGameEngine(game, harness = null, deps = {}) {
  return {
    /**
     * Get all available actions for a player.
     * @param {number} playerNum - 1 or 2
     * @returns {Array<{ type: string, customId: string, description: string }>}
     */
    getAvailableActions(playerNum) {
      const currentGame = harness ? harness.getGame() : game;
      return getAvailableActions(currentGame, playerNum, deps);
    },

    /**
     * Submit an action (requires harness).
     * @param {string} customId - The customId of the action to execute
     * @param {string} userId - The Discord user ID submitting the action
     * @returns {Promise<{ game: object, messages: Array }>}
     */
    async submitAction(customId, userId) {
      if (!harness) throw new Error('submitAction requires a harness');
      return harness.submitAction(customId, userId);
    },

    /**
     * Get the current game state.
     * @returns {object}
     */
    getState() {
      return harness ? harness.getGame() : game;
    },

    /**
     * Get game state visible to a specific player (opponent's hand hidden).
     * @param {number} playerNum - 1 or 2
     * @returns {object}
     */
    getVisibleState(playerNum) {
      const g = structuredClone(harness ? harness.getGame() : game);
      const otherPN = playerNum === 1 ? 2 : 1;
      delete g[`player${otherPN}CcHand`];
      delete g[`player${otherPN}CcDeck`];
      return g;
    },

    /**
     * Get which players the game is waiting on.
     * @returns {{ waitType: string, description: string, playerNums: number[] }}
     */
    getWaitingPlayers() {
      // Import dynamically to avoid circular deps
      const currentGame = harness ? harness.getGame() : game;
      return getWaitingPlayersFromGame(currentGame);
    },
  };
}

// Inline to avoid circular import with phase-gate.js
function getWaitingPlayersFromGame(game) {
  try {
    // Dynamic import won't work synchronously, so use inline logic
    if (game.phaseGate) {
      const gate = game.phaseGate;
      const waiting = [];
      if (!gate.p1Ready) waiting.push(1);
      if (!gate.p2Ready) waiting.push(2);
      return { waitType: 'phaseGate', description: `Phase gate: ${gate.phase}`, playerNums: waiting };
    }

    if (game.pendingCombat) {
      const combat = game.pendingCombat;
      if (!combat.p1Ready || !combat.p2Ready) {
        const waiting = [];
        if (!combat.p1Ready) waiting.push(1);
        if (!combat.p2Ready) waiting.push(2);
        return { waitType: 'combatReady', description: 'Combat ready', playerNums: waiting };
      }
      return { waitType: 'combat', description: 'Combat in progress', playerNums: [1, 2] };
    }

    if (game.currentActivationTurnPlayerId) {
      const pn = game.currentActivationTurnPlayerId === game.player1Id ? 1 : 2;
      return { waitType: 'activation', description: 'Activation turn', playerNums: [pn] };
    }

    return { waitType: 'unknown', description: 'Game active', playerNums: [1, 2] };
  } catch {
    return { waitType: 'error', description: 'Error reading state', playerNums: [1, 2] };
  }
}
