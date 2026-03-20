/**
 * AI strategy: selects the best action using the trained dueling neural network
 * from the headless Q-learning system (Branch C, Phase 5 brain).
 * Falls back to pickSmartAction's built-in heuristic during epsilon-greedy exploration.
 */

import { pickSmartAction, loadLearnings, setGreedyMode } from '../../tests/headless/learnings.js';
import { isCcAttachment } from '../data-loader.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy-loaded singleton — initialized on first use
let _learnings = null;
function getLearnings() {
  if (!_learnings) {
    const learningsPath = join(__dirname, '..', '..', 'tests', 'headless', 'learnings-data.json');
    _learnings = loadLearnings(learningsPath);
    // Discord uses greedy mode (no epsilon exploration / forced CC+surge exploration).
    // Exploration is for training only — production should use pure exploitation.
    setGreedyMode(true);
    console.log(`[AI] Loaded Q-learning model (${_learnings.meta.totalGames} training games, phase ${_learnings.brainPhase}, greedy)`);
  }
  return _learnings;
}

/**
 * CCs that have dedicated pending-state action paths (celebration_play_, etc.)
 * and must NOT be played through the generic cc_confirm_play_ bridge.
 * Playing them via the bridge bypasses precondition checks (e.g. "was a unique
 * hostile actually defeated?") and wastes the card without the intended effect.
 */
const CC_HAS_DEDICATED_HANDLER = new Set(['Celebration']);

/**
 * Filter out CC actions the AI can't complete in Discord.
 * - play_cc_special / play_cc_double: single-step button, always allowed
 * - play_cc: blocked if attachment CC (requires DC-selection dropdown)
 * - play_cc: blocked if card has a dedicated pending-state handler path
 */
function isAiViable(action) {
  if (action.type === 'play_cc' && action.params?.cardName) {
    if (isCcAttachment(action.params.cardName)) return false;
    if (CC_HAS_DEDICATED_HANDLER.has(action.params.cardName)) return false;
  }
  return true;
}

/**
 * Activation-phase heuristic: suppress premature end_activation when the DC
 * still has productive options (move/attack/ability).
 *
 * The DQN assigns Q(end_activation) ≈ 5.89 vs Q(start_move) ≈ 5.48, because
 * movement initiation has low immediate reward (payoff comes from subsequent
 * move_toward steps, discounted by gamma). This causes the AI to end every
 * activation without doing anything. Override by removing end_activation from
 * the pool when productive actions exist.
 *
 * Also suppress pass_activation_turn when the player has activatable DCs,
 * for the same reason — the model undervalues activating when no attacks
 * are in range.
 */
const PRODUCTIVE_TYPES = new Set([
  'move_figure', 'attack_target', 'dc_special',
  'play_cc_special', 'play_cc_double', 'interact',
]);
const IDLE_TYPES = new Set(['dc_end_activation', 'pass_activation_turn']);

function applyActivationHeuristic(actions) {
  const hasProductive = actions.some(a => PRODUCTIVE_TYPES.has(a.type));
  if (!hasProductive) return actions;
  const filtered = actions.filter(a => !IDLE_TYPES.has(a.type));
  // Safety: if filtering removed everything, return original
  return filtered.length > 0 ? filtered : actions;
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

  // Filter out actions the AI can't complete in Discord
  let viable = actions.filter(isAiViable);
  if (viable.length === 0) return null;

  // Suppress premature end_activation / pass when productive actions exist
  viable = applyActivationHeuristic(viable);

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
