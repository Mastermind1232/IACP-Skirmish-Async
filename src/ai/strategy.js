/**
 * AI strategy: selects the best action from available options.
 * Uses greedy one-ply evaluation by default.
 */

import { evaluateState } from './evaluator.js';

/**
 * Pick the best action from a list of available actions using greedy evaluation.
 * For simple actions (phase gate, end turn), just scores the current state.
 * For complex actions (attacks, moves), would ideally simulate the outcome.
 *
 * @param {object} engine - Game engine instance
 * @param {Array} actions - Available actions from getAvailableActions
 * @param {number} playerNum - 1 or 2
 * @returns {{ action: object, score: number }}
 */
export function pickBestAction(engine, actions, playerNum) {
  if (!actions || actions.length === 0) return null;
  if (actions.length === 1) return { action: actions[0], score: 0 };

  // Score each action using heuristics
  let best = { action: actions[0], score: -Infinity };

  for (const action of actions) {
    const score = scoreAction(action, engine.getState(), playerNum);
    if (score > best.score) {
      best = { action, score };
    }
  }

  return best;
}

/**
 * Score an action using heuristics (without simulation).
 * This is a fast approximation — full simulation would clone the game
 * and execute the action to see the resulting state.
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

  // Movement: moderate priority
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
