/**
 * AI strategy: selects the best action from available options.
 * Uses greedy one-ply evaluation with spatial awareness for movement.
 */

import { getRange } from '../game/spatial.js';

/**
 * Actions the AI can't complete (multi-step flows requiring dropdowns/modals).
 * Filtered out before scoring to prevent infinite loops.
 */
const AI_UNSUPPORTED_TYPES = new Set(['play_cc']);

/**
 * Pick the best action from a list of available actions using greedy evaluation.
 * Filters out actions the AI can't handle, then scores the rest.
 *
 * @param {object} engine - Game engine instance
 * @param {Array} actions - Available actions from getAvailableActions
 * @param {number} playerNum - 1 or 2
 * @returns {{ action: object, score: number }}
 */
export function pickBestAction(engine, actions, playerNum) {
  if (!actions || actions.length === 0) return null;

  // Filter out multi-step flows the AI can't complete
  const viable = actions.filter(a => !AI_UNSUPPORTED_TYPES.has(a.type));
  if (viable.length === 0) {
    // All actions are unsupported (e.g., only CC plays during combat window).
    // Return null so the self-play loop can re-check with a different player.
    return null;
  }
  if (viable.length === 1) return { action: viable[0], score: 0 };

  const game = engine.getState();
  let best = { action: viable[0], score: -Infinity };

  for (const action of viable) {
    const score = scoreAction(action, game, playerNum);
    if (score > best.score) {
      best = { action, score };
    }
  }

  return best;
}

/**
 * Find the distance from a coord to the nearest enemy figure.
 * Returns 999 if no enemies found.
 */
function distToNearestEnemy(coord, game, playerNum) {
  const opponentNum = playerNum === 1 ? 2 : 1;
  const enemyPositions = game.figurePositions?.[opponentNum];
  if (!enemyPositions || !coord) return 999;
  let minDist = 999;
  for (const enemyCoord of Object.values(enemyPositions)) {
    if (!enemyCoord) continue;
    const d = getRange(coord, enemyCoord);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Score an action using heuristics with spatial awareness.
 * Movement actions are scored by how much closer they move toward enemies.
 *
 * @param {object} action - Action descriptor
 * @param {object} game - Current game state
 * @param {number} playerNum
 * @returns {number}
 */
export function scoreAction(action, game, playerNum) {
  const type = action.type;

  // Phase gate: always ready up
  if (type === 'phase_gate_ready') return 100;
  if (type === 'phase_gate_unready') return -100;

  // Combat: prefer attacking over other actions
  if (type === 'attack_target' || type === 'dc_attack') return 80;
  if (type === 'combat_roll') return 90;
  if (type === 'combat_ready') return 85;
  if (type === 'combat_resolve') return 70;

  // Movement: score by proximity to nearest enemy
  if (type === 'move_pick_space') {
    const { moveKey, coord } = action.params || {};
    if (!coord || !moveKey) return 20;

    // "Finish movement" — only pick this if no better moves exist
    if (action.params?.done || coord === 'done' || action.customId?.endsWith('_done')) return 5;

    const moveState = game.moveInProgress?.[moveKey];
    const currentPos = moveState?.currentPosition || moveState?.startCoord;
    const currentDistToEnemy = distToNearestEnemy(currentPos, game, playerNum);
    const newDistToEnemy = distToNearestEnemy(coord, game, playerNum);

    // Score: base 50 + bonus for closing distance (up to +40 per space closer)
    // Moving 3 spaces closer = 50 + 120 = 170
    // Staying same distance = 50
    // Moving away = 50 - penalty
    const improvement = currentDistToEnemy - newDistToEnemy;
    return 50 + (improvement * 40);
  }

  // Start movement: prefer moving when far from enemies
  if (type === 'move_figure' || type === 'dc_move') return 50;

  // Activation: prefer activating DCs over passing
  if (type === 'activate_dc') return 60;
  if (type === 'pass_activation_turn') return 10;

  // End turn: low priority (use actions first)
  if (type === 'end_turn') return 5;
  if (type === 'dc_end_activation') return 5;

  // End phase: lowest priority
  if (type === 'end_activation_phase') return 1;
  if (type === 'end_end_of_round') return 30;
  if (type === 'end_start_of_round') return 30;

  // Setup: moderate
  if (type === 'auto_deploy') return 70;
  if (type === 'deployment_done') return 65;
  if (type === 'deploy_figure') return 55;
  if (type === 'draft_random') return 50;
  if (type === 'determine_initiative') return 50;
  if (type === 'pick_zone') return 50;
  if (type === 'draw_cc') return 60;

  // Default
  return 20;
}

/**
 * Pick a random action (for testing/fallback).
 * @param {Array} actions
 * @returns {object}
 */
export function pickRandomAction(actions) {
  if (!actions || actions.length === 0) return null;
  return actions[Math.floor(Math.random() * actions.length)];
}
