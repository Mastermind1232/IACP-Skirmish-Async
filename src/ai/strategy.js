/**
 * AI strategy: selects the best action using the trained dueling neural network
 * from the headless Q-learning system (853 training games, Phase 5 brain).
 * Falls back to pickSmartAction's built-in heuristic during epsilon-greedy exploration.
 */

import { pickSmartAction, loadLearnings } from '../../tests/headless/learnings.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Actions the AI can't complete (multi-step flows requiring dropdowns/modals).
 * Filtered out before scoring to prevent infinite loops.
 */
const AI_UNSUPPORTED_TYPES = new Set(['play_cc']);

// Lazy-loaded singleton — initialized on first use
let _learnings = null;
function getLearnings() {
  if (!_learnings) {
    const learningsPath = join(__dirname, '..', '..', 'tests', 'headless', 'learnings-data.json');
    _learnings = loadLearnings(learningsPath);
    console.log(`[AI] Loaded Q-learning model (${_learnings.meta.totalGames} training games, phase ${_learnings.brainPhase})`);
  }
  return _learnings;
}

/**
 * Pick the best action using the trained neural network.
 * Filters unsupported actions, then delegates to pickSmartAction which uses
 * the dueling DQN for action group selection and within-group linear scorers
 * for tactical choices.
 *
 * @param {object} engine - { getState() }
 * @param {Array} actions - Available actions from getAvailableActions
 * @param {number} playerNum - 1 or 2
 * @param {object} [deps] - { dcHealthState, dcMessageMeta } for feature extraction
 * @returns {{ action: object, score: number } | null}
 */
export function pickBestAction(engine, actions, playerNum, deps = {}) {
  if (!actions || actions.length === 0) return null;

  // Filter out multi-step flows the AI can't complete
  const viable = actions.filter(a => !AI_UNSUPPORTED_TYPES.has(a.type));
  if (viable.length === 0) return null;
  if (viable.length === 1) return { action: viable[0], score: 0 };

  const game = engine.getState();
  const learnings = getLearnings();
  const dcHealthState = deps.dcHealthState || new Map();
  const dcMessageMeta = deps.dcMessageMeta || new Map();

  const picked = pickSmartAction(viable, game, learnings, playerNum, dcHealthState, dcMessageMeta);
  if (picked) return { action: picked, score: 0 };

  // Should never reach here, but safety fallback
  return { action: viable[0], score: 0 };
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
