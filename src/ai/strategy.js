/**
 * AI strategy: selects the best action using the trained dueling neural network
 * from the headless Q-learning system (Branch C, Phase 5 brain).
 * Falls back to pickSmartAction's built-in heuristic during epsilon-greedy exploration.
 */

import { pickSmartAction, loadLearnings, setGreedyMode, setEncoderType, getEncoderType } from '../../tests/headless/learnings.js';
import { isCcAttachment } from '../data-loader.js';
import { getRange } from '../game/spatial.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy-loaded singleton — initialized on first use
let _learnings = null;
let _learningsFile = null;
function getLearnings() {
  if (!_learnings) {
    const learningsPath = join(__dirname, '..', '..', 'tests', 'headless', 'learnings-data.json');
    _learningsFile = 'learnings-data.json';
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

export function getCheckpointFile() {
  return _learningsFile;
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
/**
 * Action types considered "productive" for idle-suppression decisions.
 * Run 74 proved narrowing to move-only collapsed combat (7 attacks in 9 rounds).
 * The graph undervalues ALL non-attack actions, not just movement. Broad
 * suppression of idle when ANY productive action exists is required.
 */
const COMBAT_ACTIONS = new Set([
  'attack_target', 'dc_special',
  'play_cc_special', 'play_cc_double', 'interact',
]);
const COMBAT_PRODUCTIVE_TYPES = new Set([...COMBAT_ACTIONS, 'move_figure']);
const IDLE_TYPES = new Set(['dc_end_activation', 'pass_activation_turn']);

// ── Per-game runtime instrumentation ────────────────────────────────────────
// Tracks graph vs flat decisions, heuristic overrides, and fallbacks.
// Reset at the start of each self-play game for clean per-game accounting.
let _graphDecisions = 0;
let _flatDecisions = 0;
let _heuristicOverrides = 0;
let _heuristicOverridesAttackLegal = 0;
let _heuristicOverridesMoveOnly = 0;    // suppression fired with move_figure as sole productive type
let _heuristicCalls = 0;
let _singleActionSkips = 0;
let _endActSuppressed = 0;              // end_activation/pass actually removed from pool
// Context breakdown: times idle suppression was skipped (from narrowing experiment, now unused)
let _idleSupSkippedAttack = 0;
let _idleSupSkippedSpecial = 0;
// Per-class breakdown: which productive types were available when idle suppression fired (overlapping)
let _idleSupWithAttack = 0;             // attack_target was in pool
let _idleSupWithDcSpecial = 0;          // dc_special was in pool
let _idleSupWithPlayCc = 0;             // play_cc_special or play_cc_double was in pool
let _idleSupWithInteract = 0;           // interact was in pool
let _idleSupWithMove = 0;              // move_figure was in pool

// Shadow evaluation: measures organic preference at the two key decision nodes.
// 1. Force-attack node: when attack is available, would graph have picked attack?
let _activationEntryWithAttack = 0;     // decisions where attack_target was available
let _graphWouldAttack = 0;              // shadow: graph would have picked attack organically
let _graphWouldNotAttack = 0;           // shadow: graph preferred non-attack action
// 2. Idle-suppression node: when end_act/pass is removed, what did graph prefer?
let _idleSupFired = 0;                  // idle suppression decisions (reached shadow eval)
let _idleSupForcedSingle = 0;           // suppression left only 1 action (no graph choice)
let _idleSupGraphWouldIdle = 0;         // shadow: graph preferred end_act/pass (overridden)
let _idleSupGraphWouldAttack = 0;       // shadow: graph preferred attack
let _idleSupGraphWouldMove = 0;         // shadow: graph preferred move_figure
let _idleSupGraphWouldOther = 0;        // shadow: graph preferred interact/cc/etc. (legacy aggregate)
// Refined "other" breakdown: which specific non-attack class did the graph prefer?
let _idleSupGraphWouldDcSpecial = 0;
let _idleSupGraphWouldInteract = 0;
let _idleSupGraphWouldPlayCc = 0;

export function resetRuntimeStats() {
  _graphDecisions = 0;
  _flatDecisions = 0;
  _heuristicOverrides = 0;
  _heuristicOverridesAttackLegal = 0;
  _heuristicOverridesMoveOnly = 0;
  _heuristicCalls = 0;
  _singleActionSkips = 0;
  _endActSuppressed = 0;
  _idleSupSkippedAttack = 0;
  _idleSupSkippedSpecial = 0;
  _idleSupWithAttack = 0;
  _idleSupWithDcSpecial = 0;
  _idleSupWithPlayCc = 0;
  _idleSupWithInteract = 0;
  _idleSupWithMove = 0;
  _activationEntryWithAttack = 0;
  _graphWouldAttack = 0;
  _graphWouldNotAttack = 0;
  _idleSupFired = 0;
  _idleSupForcedSingle = 0;
  _idleSupGraphWouldIdle = 0;
  _idleSupGraphWouldAttack = 0;
  _idleSupGraphWouldMove = 0;
  _idleSupGraphWouldOther = 0;
  _idleSupGraphWouldDcSpecial = 0;
  _idleSupGraphWouldInteract = 0;
  _idleSupGraphWouldPlayCc = 0;
}

export function getRuntimeStats() {
  return {
    graphDecisions: _graphDecisions,
    flatDecisions: _flatDecisions,
    heuristicOverrides: _heuristicOverrides,
    heuristicOverridesAttackLegal: _heuristicOverridesAttackLegal,
    heuristicOverridesMoveOnly: _heuristicOverridesMoveOnly,
    heuristicCalls: _heuristicCalls,
    singleActionSkips: _singleActionSkips,
    endActSuppressed: _endActSuppressed,
    idleSupSkippedAttack: _idleSupSkippedAttack,
    idleSupSkippedSpecial: _idleSupSkippedSpecial,
    idleSupWithAttack: _idleSupWithAttack,
    idleSupWithDcSpecial: _idleSupWithDcSpecial,
    idleSupWithPlayCc: _idleSupWithPlayCc,
    idleSupWithInteract: _idleSupWithInteract,
    idleSupWithMove: _idleSupWithMove,
    activationEntryWithAttack: _activationEntryWithAttack,
    graphWouldAttack: _graphWouldAttack,
    graphWouldNotAttack: _graphWouldNotAttack,
    idleSupFired: _idleSupFired,
    idleSupForcedSingle: _idleSupForcedSingle,
    idleSupGraphWouldIdle: _idleSupGraphWouldIdle,
    idleSupGraphWouldAttack: _idleSupGraphWouldAttack,
    idleSupGraphWouldMove: _idleSupGraphWouldMove,
    idleSupGraphWouldOther: _idleSupGraphWouldOther,
    idleSupGraphWouldDcSpecial: _idleSupGraphWouldDcSpecial,
    idleSupGraphWouldInteract: _idleSupGraphWouldInteract,
    idleSupGraphWouldPlayCc: _idleSupGraphWouldPlayCc,
    encoder: _learnings ? getEncoderType() : 'not_loaded',
  };
}

// Legacy export for backward compat
export function getHeuristicStats() { return { overrides: _heuristicOverrides, calls: _heuristicCalls }; }

function applyActivationHeuristic(actions) {
  _heuristicCalls++;
  const hasIdle = actions.some(a => IDLE_TYPES.has(a.type));
  if (!hasIdle) return actions; // nothing to suppress

  const hasCombatProductive = actions.some(a => COMBAT_PRODUCTIVE_TYPES.has(a.type));
  if (!hasCombatProductive) return actions; // no productive actions, let graph pick

  // Broad suppression: remove idle when ANY productive action exists.
  // Run 74 proved narrowing to move-only collapsed combat — the graph undervalues
  // all non-attack actions (specials, CC, interact), not just movement.
  _heuristicOverrides++;
  // Context-breakdown counters for attribution (per-class, overlapping)
  const hasAttack = actions.some(a => a.type === 'attack_target');
  const hasDcSpecial = actions.some(a => a.type === 'dc_special');
  const hasPlayCc = actions.some(a => a.type === 'play_cc_special' || a.type === 'play_cc_double');
  const hasInteract = actions.some(a => a.type === 'interact');
  const hasMove = actions.some(a => a.type === 'move_figure');
  if (hasAttack) { _heuristicOverridesAttackLegal++; _idleSupWithAttack++; }
  if (hasDcSpecial) _idleSupWithDcSpecial++;
  if (hasPlayCc) _idleSupWithPlayCc++;
  if (hasInteract) _idleSupWithInteract++;
  if (hasMove) _idleSupWithMove++;
  if (hasMove && !hasAttack && !hasDcSpecial && !hasPlayCc && !hasInteract) _heuristicOverridesMoveOnly++;
  const filtered = actions.filter(a => {
    if (IDLE_TYPES.has(a.type)) { _endActSuppressed++; return false; }
    return true;
  });
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
  const preIdleViable = viable.some(a => IDLE_TYPES.has(a.type)) ? [...viable] : null;
  viable = applyActivationHeuristic(viable);
  const idleWasSuppressed = preIdleViable !== null && viable.length < preIdleViable.length;

  // Move-toward-enemies heuristic: when picking movement spaces, suppress "done"
  // and pick the space that minimizes distance to the nearest enemy figure.
  // The DQN's within-group scorer produces random walks on the Discord map.
  const moveDone = viable.filter(a => a.type === 'move_pick_space' && a.params?.done);
  const moveSpaces = viable.filter(a => a.type === 'move_pick_space' && !a.params?.done && a.params?.coord);
  if (moveSpaces.length > 0) {
    const game = engine.getState();
    const actingPn = moveSpaces[0].actingPlayer || moveSpaces[0]._playerNum;
    const enemyPn = actingPn === 1 ? 2 : 1;
    const enemyPositions = Object.values(game.figurePositions?.[enemyPn] || {}).filter(Boolean);
    if (enemyPositions.length > 0) {
      // Compute current distance from figure's position to nearest enemy
      const moveEntry = Object.values(game.moveInProgress || {})[0];
      const curPos = moveEntry?.currentPosition || moveEntry?.startCoord;
      let currentDist = Infinity;
      if (curPos) {
        const cp = String(curPos).toLowerCase();
        for (const ePos of enemyPositions) {
          const d = getRange(cp, String(ePos).toLowerCase());
          if (d < currentDist) currentDist = d;
        }
      }

      // Pick spaces that STRICTLY improve distance to nearest enemy
      const bestSpaces = [];
      let bestDist = Infinity;
      for (const a of moveSpaces) {
        const coord = String(a.params.coord).toLowerCase();
        let minEnemyDist = Infinity;
        for (const ePos of enemyPositions) {
          const d = getRange(coord, String(ePos).toLowerCase());
          if (d < minEnemyDist) minEnemyDist = d;
        }
        if (minEnemyDist < bestDist) {
          bestDist = minEnemyDist;
          bestSpaces.length = 0;
          bestSpaces.push(a);
        } else if (minEnemyDist === bestDist) {
          bestSpaces.push(a);
        }
      }

      // Only move if it strictly improves distance; otherwise stop to save MP
      if (bestDist < currentDist) {
        const bestAction = bestSpaces[Math.floor(Math.random() * bestSpaces.length)];
        return { action: bestAction, score: 0 };
      }
      // No improvement possible — pick "done" if available, else pick randomly
      if (moveDone.length > 0) {
        return { action: moveDone[0], score: 0 };
      }
      return { action: bestSpaces[Math.floor(Math.random() * bestSpaces.length)], score: 0 };
    }
    // No enemy positions found — just suppress done and let DQN pick
    if (moveDone.length > 0) {
      viable = viable.filter(a => !(a.type === 'move_pick_space' && a.params?.done));
    }
  }

  if (viable.length === 1) {
    _singleActionSkips++;
    if (idleWasSuppressed) _idleSupForcedSingle++;
    return { action: viable[0], score: 0 };
  }

  const game = engine.getState();
  const learnings = getLearnings();
  const dcHealthState = deps.dcHealthState || new Map();
  const dcMessageMeta = deps.dcMessageMeta || new Map();

  // Idle-suppression shadow eval: what did graph prefer BEFORE idle was removed?
  if (idleWasSuppressed && preIdleViable) {
    _idleSupFired++;
    try {
      const shadowPick = pickSmartAction(preIdleViable, game, learnings, playerNum, dcHealthState, dcMessageMeta);
      if (shadowPick) {
        if (IDLE_TYPES.has(shadowPick.type)) _idleSupGraphWouldIdle++;
        else if (shadowPick.type === 'attack_target') _idleSupGraphWouldAttack++;
        else if (shadowPick.type === 'move_figure') _idleSupGraphWouldMove++;
        else {
          _idleSupGraphWouldOther++;
          if (shadowPick.type === 'dc_special') _idleSupGraphWouldDcSpecial++;
          else if (shadowPick.type === 'interact') _idleSupGraphWouldInteract++;
          else if (shadowPick.type === 'play_cc_special' || shadowPick.type === 'play_cc_double') _idleSupGraphWouldPlayCc++;
        }
      }
    } catch { /* shadow eval failed */ }
  }

  // Force-attack heuristic: DISABLED — shadow eval in run 67 proved 100% redundant
  // (graph chose attack organically in 36/36 cases). Counters kept for validation.
  // To restore: set FORCE_ATTACK_ENABLED = true.
  const FORCE_ATTACK_ENABLED = false;
  const attackActions = viable.filter(a => a.type === 'attack_target');
  if (attackActions.length > 0) {
    _activationEntryWithAttack++;

    // Shadow evaluation: track what graph picks when attack is available.
    // With force-attack disabled, this measures live organic attack rate.
    try {
      const shadowPick = pickSmartAction(viable, game, learnings, playerNum, dcHealthState, dcMessageMeta);
      if (shadowPick && shadowPick.type === 'attack_target') {
        _graphWouldAttack++;
      } else {
        _graphWouldNotAttack++;
      }
    } catch {
      _graphWouldNotAttack++;
    }

    if (FORCE_ATTACK_ENABLED) {
      _heuristicOverrides++;
      _heuristicOverridesAttackLegal++;
      return { action: attackActions[Math.floor(Math.random() * attackActions.length)], score: 0 };
    }
    // Fall through to graph DQN — let it pick organically
  }

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
