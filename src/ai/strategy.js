/**
 * AI strategy: selects the best action using the trained dueling neural network
 * from the headless Q-learning system (Branch C, Phase 5 brain).
 * Falls back to pickSmartAction's built-in heuristic during epsilon-greedy exploration.
 */

import { pickSmartAction, loadLearnings, setGreedyMode, setEncoderType, getEncoderType } from '../../tests/headless/learnings.js';
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
    // Activate graph encoder if the checkpoint contains a trained graph network.
    // The graph GNN provides spatial/relational awareness that the flat DQN lacks.
    if (_learnings.graphNetwork) {
      setEncoderType('graph');
      console.log(`[AI] Graph encoder ACTIVE — checkpoint has graphNetwork`);
    } else {
      console.log(`[AI] Graph encoder not available — using flat DQN`);
    }
    const encoder = getEncoderType();
    console.log(`[AI] Loaded Q-learning model (${_learnings.meta.totalGames} training games, phase ${_learnings.brainPhase}, encoder=${encoder}, greedy)`);
  }
  return _learnings;
}

/**
 * Return the loaded checkpoint's totalGames count (e.g. 13862).
 * Returns null if the model hasn't been loaded yet.
 */
export function getCheckpointVersion() {
  return _learnings?.meta?.totalGames ?? null;
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

// ── Per-game runtime instrumentation ────────────────────────────────────────
// Tracks graph vs flat decisions, heuristic overrides, and fallbacks.
// Reset at the start of each self-play game for clean per-game accounting.
let _graphDecisions = 0;
let _flatDecisions = 0;
let _heuristicOverrides = 0;
let _heuristicCalls = 0;
let _singleActionSkips = 0; // actions with only 1 viable option (no DQN call)

export function resetRuntimeStats() {
  _graphDecisions = 0;
  _flatDecisions = 0;
  _heuristicOverrides = 0;
  _heuristicCalls = 0;
  _singleActionSkips = 0;
}

export function getRuntimeStats() {
  return {
    graphDecisions: _graphDecisions,
    flatDecisions: _flatDecisions,
    heuristicOverrides: _heuristicOverrides,
    heuristicCalls: _heuristicCalls,
    singleActionSkips: _singleActionSkips,
    encoder: _learnings ? getEncoderType() : 'not_loaded',
  };
}

// Legacy export for backward compat
export function getHeuristicStats() { return { overrides: _heuristicOverrides, calls: _heuristicCalls }; }

function applyActivationHeuristic(actions) {
  _heuristicCalls++;
  const hasProductive = actions.some(a => PRODUCTIVE_TYPES.has(a.type));
  if (!hasProductive) return actions;
  const hasIdle = actions.some(a => IDLE_TYPES.has(a.type));
  if (hasIdle) _heuristicOverrides++;
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

  if (viable.length === 1) {
    _singleActionSkips++;
    return { action: viable[0], score: 0 };
  }

  const game = engine.getState();
  const learnings = getLearnings();
  const dcHealthState = deps.dcHealthState || new Map();
  const dcMessageMeta = deps.dcMessageMeta || new Map();

  // Track whether graph or flat encoder is used for this decision
  const encoderNow = getEncoderType();
  if (encoderNow === 'graph' && learnings.graphNetwork) {
    _graphDecisions++;
  } else {
    _flatDecisions++;
  }

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
