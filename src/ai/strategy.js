/**
 * AI strategy: selects the best action using the trained dueling neural network
 * from the headless Q-learning system (Branch C, Phase 5 brain).
 * Falls back to pickSmartAction's built-in heuristic during epsilon-greedy exploration.
 */

import { pickSmartAction, loadLearnings, setGreedyMode, setEncoderType, getEncoderType } from '../../tests/headless/learnings.js';
import { isCcAttachment, getMapTokensData, getDeploymentZones, getMissionCardsData } from '../data-loader.js';
import { getRange } from '../game/spatial.js';
import { parseCoord } from '../game/coords.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Movement Strategy Configuration ─────────────────────────────────────────
// 'greedy'  — always use legacy "walk toward nearest enemy" heuristic
// 'learned' — always use WG move scorer from training (skip greedy heuristic)
// 'auto'    — use WG scorer if weights are strong enough, else fall back to greedy
const MOVEMENT_STRATEGY = 'auto';
const MOVEMENT_TRUST_THRESHOLD = 0.05; // min max|weight| to trust WG move scorer

// ── Endgame Closeout Configuration ─────────────────────────────────────────
// When max(p1VP, p2VP) reaches this threshold, the AI enters endgame mode:
// - Activation ordering prioritizes DCs closest to scoring positions
// - Movement routing switches to objective-only (ignores enemy approach)
const VP_ENDGAME_THRESHOLD = 24;
// At this higher threshold, attacks are suppressed when movement toward objectives is available
const VP_CLOSEOUT_THRESHOLD = 32;

/**
 * Decide whether the greedy movement heuristic should run.
 * In 'auto' mode, trusts the learned scorer only when WG move weights have
 * grown past MOVEMENT_TRUST_THRESHOLD — indicating the model has learned
 * something beyond noise.
 */
function shouldUseGreedyMovement(learnings) {
  if (MOVEMENT_STRATEGY === 'greedy') return true;
  if (MOVEMENT_STRATEGY === 'learned') return false;
  // 'auto': trust learned scorer only if weights are strong enough
  const moveWeights = learnings?.withinGroupWeights?.move;
  if (!moveWeights) return true; // no weights → fall back to greedy
  const maxMag = Math.max(...moveWeights.map(Math.abs));
  return maxMag < MOVEMENT_TRUST_THRESHOLD;
}

/**
 * Extract all mission-relevant objective coordinates from map token data.
 * Includes mission token positions (panels, contraband) and named areas (Cantina, etc.).
 * Ported from the validated diagnostic planner (learnings.js getObjectiveCoords).
 */
function getObjectiveCoords(game) {
  const mapId = game.selectedMap?.id;
  if (!mapId) return [];
  let mapData;
  try { mapData = getMapTokensData()?.[mapId]; } catch { return []; }
  if (!mapData) return [];
  const coords = new Set();
  const variant = game.selectedMission?.variant;
  const missionSide = variant === 'a' ? 'missionA' : variant === 'b' ? 'missionB' : null;
  // Krykna missions: use CURRENT alive Krykna positions instead of static starts
  if (Array.isArray(game.npcKrykna)) {
    for (const k of game.npcKrykna) {
      if (!k.defeated && k.coord) coords.add(String(k.coord).toLowerCase());
    }
  } else if (missionSide && mapData[missionSide]?.positions) {
    for (const posArr of Object.values(mapData[missionSide].positions)) {
      for (const c of posArr) coords.add(String(c).toLowerCase());
    }
  }
  for (const area of mapData.namedAreas || []) {
    for (const c of area.cells || []) coords.add(String(c).toLowerCase());
  }
  // Deployment zone centroids when mission awards VP for zone control
  _addDeploymentZoneCentroids(game, mapId, variant, coords);
  return [...coords];
}

function _addDeploymentZoneCentroids(game, mapId, variant, coords) {
  try {
    const missionCards = getMissionCardsData();
    const rules = missionCards?.[mapId]?.[variant]?.rules?.endOfRound;
    if (!rules?.vpPerControlledDeploymentZone && !rules?.vpPerContrabandInOpponentDeploymentZone) return;
    const zones = getDeploymentZones()?.[mapId];
    if (!zones) return;
    for (const color of ['red', 'blue']) {
      const cells = zones[color];
      if (!cells?.length) continue;
      let sumCol = 0, sumRow = 0;
      for (const c of cells) {
        const p = parseCoord(c);
        sumCol += p.col;
        sumRow += p.row;
      }
      const avgCol = Math.round(sumCol / cells.length);
      const avgRow = Math.round(sumRow / cells.length);
      coords.add(String.fromCharCode(97 + avgCol) + String(avgRow + 1));
    }
  } catch { /* data not available */ }
}

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
// Movement strategy tracking
let _moveGreedyUsed = 0;          // greedy heuristic picked the space
let _moveLearnedUsed = 0;         // WG scorer picked the space (fell through to pickSmartAction)
let _moveGreedyMaxWgMag = 0;      // snapshot of max|wgWeight.move| at decision time
// Endgame closeout tracking
let _endgameActivations = 0;      // activate_dc decisions overridden by endgame ordering
let _endgameObjOnlyMoves = 0;     // movement decisions routed to objectives-only in endgame
let _endgameAttacksSuppressed = 0; // attacks suppressed in closeout mode

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
  _moveGreedyUsed = 0;
  _moveLearnedUsed = 0;
  _moveGreedyMaxWgMag = 0;
  _endgameActivations = 0;
  _endgameObjOnlyMoves = 0;
  _endgameAttacksSuppressed = 0;
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
    moveStrategy: MOVEMENT_STRATEGY,
    moveGreedyUsed: _moveGreedyUsed,
    moveLearnedUsed: _moveLearnedUsed,
    moveGreedyMaxWgMag: _moveGreedyMaxWgMag,
    endgameActivations: _endgameActivations,
    endgameObjOnlyMoves: _endgameObjOnlyMoves,
    endgameAttacksSuppressed: _endgameAttacksSuppressed,
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

  // Carry-mission heuristic: activate carrier first, pickup, then carry toward delivery zone.
  // Step 0: If activate_dc choices include a DC with a carrying figure, activate it first.
  // Step 1: If a retrieve_contraband interact is available, force it (pickup before move).
  // Step 2: If a carrier has move_figure, force starting movement toward delivery zone.
  {
    const game = engine.getState();
    try {
      const mapId = game.selectedMap?.id;
      const variant = game.selectedMission?.variant;
      const mCards = getMissionCardsData();
      const eorRules = mCards?.[mapId]?.[variant]?.rules?.endOfRound;
      if (eorRules?.vpPerContrabandInOpponentDeploymentZone) {
        // Step 0: Activate carrier DC first
        const activateActions = viable.filter(a => a.type === 'activate_dc');
        if (activateActions.length > 1 && game.figureContraband) {
          const carrierActivate = activateActions.find(a => {
            const dcName = a.params?.dcName;
            return dcName && Object.keys(game.figureContraband).some(
              fk => fk.startsWith(dcName + '-') && game.figureContraband[fk]
            );
          });
          if (carrierActivate) {
            return { action: carrierActivate, score: 0 };
          }
        }
        // Step 1: Force pickup if available
        const pickupAction = viable.find(a =>
          a.type === 'interact' && a.params?.optionId === 'retrieve_contraband'
        );
        if (pickupAction) {
          return { action: pickupAction, score: 0 };
        }
        // Step 2: Force carrier movement
        const moveFigActions = viable.filter(a => a.type === 'move_figure');
        if (moveFigActions.length > 0 && game.figureContraband) {
          for (const mf of moveFigActions) {
            const dcName = mf.params?.dcName;
            if (!dcName) continue;
            const hasCargo = Object.keys(game.figureContraband).some(
              fk => fk.startsWith(dcName + '-') && game.figureContraband[fk]
            );
            if (hasCargo) {
              return { action: mf, score: 0 };
            }
          }
        }
      }
    } catch { /* data not available */ }
  }

  // ── Endgame Closeout Heuristic ────────────────────────────────────────────
  // When max(p1VP, p2VP) >= VP_ENDGAME_THRESHOLD, shift priorities toward
  // objective-scoring positions to convert accumulated VP into a natural win.
  // Two tiers: ENDGAME (24+) biases activation ordering and movement toward
  // objectives; CLOSEOUT (32+) additionally suppresses attacks on point-control
  // missions in favor of objective positioning.
  let _inEndgame = false;
  let _inCloseout = false;
  {
    const game = engine.getState();
    const p1vp = game.player1VP?.total || 0;
    const p2vp = game.player2VP?.total || 0;
    const maxVP = Math.max(p1vp, p2vp);
    _inEndgame = maxVP >= VP_ENDGAME_THRESHOLD;
    _inCloseout = maxVP >= VP_CLOSEOUT_THRESHOLD;

    if (_inEndgame) {
      // Endgame activation ordering: when choosing which DC to activate,
      // prefer the one closest to any objective/scoring position.
      const activateActions = viable.filter(a => a.type === 'activate_dc');
      if (activateActions.length > 1) {
        const objCoords = getObjectiveCoords(game);
        if (objCoords.length > 0) {
          let bestActivate = null;
          let bestDist = Infinity;
          for (const act of activateActions) {
            const dcName = act.params?.dcName;
            if (!dcName) continue;
            // Find closest figure of this DC to any objective
            const myFigs = Object.entries(game.figurePositions?.[playerNum] || {})
              .filter(([fk]) => fk.startsWith(dcName + '-'));
            for (const [, pos] of myFigs) {
              if (!pos) continue;
              const pc = String(pos).toLowerCase();
              for (const oc of objCoords) {
                const d = getRange(pc, oc);
                if (d < bestDist) {
                  bestDist = d;
                  bestActivate = act;
                }
              }
            }
          }
          if (bestActivate) {
            _endgameActivations++;
            return { action: bestActivate, score: 0 };
          }
        }
      }

      // Closeout attack suppression: at VP_CLOSEOUT_THRESHOLD+, suppress attacks
      // when movement toward objectives is available — reaching scoring positions
      // beats chasing kills. Only for point-control missions (fluctuations,
      // critical positions) where being ON the space is what matters. Zone-control
      // and kill-based missions are excluded (kills help maintain majority there).
      if (_inCloseout) {
        let _suppressAttacks = false;
        try {
          const mapId = game.selectedMap?.id;
          const variant = game.selectedMission?.variant;
          const mCards = getMissionCardsData();
          const eorRules = mCards?.[mapId]?.[variant]?.rules?.endOfRound;
          // Point-control missions: being on the space IS the scoring mechanism
          if (eorRules?.vpPerControlledFluctuation) _suppressAttacks = true;
          if (eorRules?.vpPerControlledSpaceInList) _suppressAttacks = true;
        } catch { /* data not available */ }
        if (_suppressAttacks) {
          const hasAttack = viable.some(a => a.type === 'attack_target');
          const hasMoveFig = viable.some(a => a.type === 'move_figure');
          if (hasAttack && hasMoveFig) {
            viable = viable.filter(a => a.type !== 'attack_target');
            _endgameAttacksSuppressed++;
          }
        }
      }
    }
  }

  // Move-toward-enemies-or-objectives heuristic: pick the space that minimizes
  // distance to the nearest enemy OR nearest objective, whichever is closer.
  // Ported from validated diagnostic planner (min(distEnemy, distObj) blending).
  // Gated by MOVEMENT_STRATEGY — in 'auto' mode, falls through to learned WG
  // scorer once WG move weights exceed MOVEMENT_TRUST_THRESHOLD.
  const moveDone = viable.filter(a => a.type === 'move_pick_space' && a.params?.done);
  const moveSpaces = viable.filter(a => a.type === 'move_pick_space' && !a.params?.done && a.params?.coord);
  if (moveSpaces.length > 0) {
    // Snapshot WG weight magnitude for instrumentation
    const _wgMoveW = getLearnings()?.withinGroupWeights?.move;
    if (_wgMoveW) _moveGreedyMaxWgMag = Math.max(..._wgMoveW.map(Math.abs));

    // Carry-aware movement: carriers on carry missions ALWAYS use greedy targeting
    // toward the opponent's deployment zone, regardless of WG scorer state.
    // This must run before the useGreedy gate since the WG scorer has no carry signal.
    const game = engine.getState();
    const actingPn = moveSpaces[0].actingPlayer || moveSpaces[0]._playerNum;
    const moveEntry = Object.values(game.moveInProgress || {})[0];
    const movingFigKey = moveEntry?.figureKey;
    let carryOverride = false;
    if (movingFigKey && game.figureContraband?.[movingFigKey]) {
      try {
        const mapId = game.selectedMap?.id;
        const variant = game.selectedMission?.variant;
        const missionCards = getMissionCardsData();
        const rules = missionCards?.[mapId]?.[variant]?.rules?.endOfRound;
        if (rules?.vpPerContrabandInOpponentDeploymentZone) {
          const zones = getDeploymentZones()?.[mapId];
          if (zones) {
            const initPn = game.initiativePlayerId === game.player1Id ? 1 : 2;
            const chosenColor = game.deploymentZoneChosen || 'red';
            const oppColor = actingPn === initPn
              ? (chosenColor === 'red' ? 'blue' : 'red')
              : chosenColor;
            const oppZoneCells = zones[oppColor] || [];
            if (oppZoneCells.length > 0) {
              carryOverride = true;
              // Greedy: move carrier toward delivery zone, using all MP
              const objPositions = oppZoneCells.map(c => String(c).toLowerCase());
              const curPos = moveEntry.startCoord;
              let currentDist = Infinity;
              if (curPos) {
                const cp = String(curPos).toLowerCase();
                for (const oPos of objPositions) {
                  const d = getRange(cp, oPos);
                  if (d < currentDist) currentDist = d;
                }
              }
              const bestSpaces = [];
              let bestDist = Infinity;
              for (const a of moveSpaces) {
                const coord = String(a.params.coord).toLowerCase();
                let minDist = Infinity;
                for (const oPos of objPositions) {
                  const d = getRange(coord, oPos);
                  if (d < minDist) minDist = d;
                }
                if (minDist < bestDist) {
                  bestDist = minDist;
                  bestSpaces.length = 0;
                  bestSpaces.push(a);
                } else if (minDist === bestDist) {
                  bestSpaces.push(a);
                }
              }
              if (bestDist < currentDist) {
                _moveGreedyUsed++;
                return { action: bestSpaces[Math.floor(Math.random() * bestSpaces.length)], score: 0 };
              }
              // No improvement — stop and save remaining MP
              if (moveDone.length > 0) {
                _moveGreedyUsed++;
                return { action: moveDone[0], score: 0 };
              }
            }
          }
        }
      } catch { /* data not available */ }
    }

    // Endgame objective-only movement: when VP is near threshold, route purely
    // toward objectives regardless of WG scorer. Must fire before useGreedy gate
    // since the learned scorer has no VP-awareness.
    // Skip for strain-based missions (Powered Perimeter) — existing strain-aware
    // routing inside the greedy block handles those more precisely.
    const _hasStrainMission = !!game.signalMarkerStrain;
    if (_inEndgame && !carryOverride && !_hasStrainMission) {
      const objPositions = getObjectiveCoords(game);
      if (objPositions.length > 0) {
        // Already ON an objective — stop to hold position
        if (moveDone.length > 0 && moveEntry?.startCoord) {
          const _cp = String(moveEntry.startCoord).toLowerCase();
          const _atObj = objPositions.some(c => getRange(_cp, String(c).toLowerCase()) === 0);
          if (_atObj) {
            _moveGreedyUsed++;
            _endgameObjOnlyMoves++;
            return { action: moveDone[0], score: 0 };
          }
        }
        // Route toward nearest objective
        const curPos = moveEntry?.startCoord;
        let currentDist = Infinity;
        if (curPos) {
          const cp = String(curPos).toLowerCase();
          for (const oPos of objPositions) {
            const d = getRange(cp, oPos);
            if (d < currentDist) currentDist = d;
          }
        }
        const bestSpaces = [];
        let bestDist = Infinity;
        for (const a of moveSpaces) {
          const coord = String(a.params.coord).toLowerCase();
          let minDist = Infinity;
          for (const oPos of objPositions) {
            const d = getRange(coord, oPos);
            if (d < minDist) minDist = d;
          }
          if (minDist < bestDist) {
            bestDist = minDist;
            bestSpaces.length = 0;
            bestSpaces.push(a);
          } else if (minDist === bestDist) {
            bestSpaces.push(a);
          }
        }
        if (bestDist < currentDist) {
          _moveGreedyUsed++;
          _endgameObjOnlyMoves++;
          return { action: bestSpaces[Math.floor(Math.random() * bestSpaces.length)], score: 0 };
        }
        // No closer space — stop
        if (moveDone.length > 0) {
          _moveGreedyUsed++;
          _endgameObjOnlyMoves++;
          return { action: moveDone[0], score: 0 };
        }
      }
    }

    const useGreedy = shouldUseGreedyMovement(getLearnings());
    if (useGreedy) {
      const enemyPn = actingPn === 1 ? 2 : 1;
      const enemyPositions = Object.values(game.figurePositions?.[enemyPn] || {}).filter(Boolean);
      const objPositions = getObjectiveCoords(game);

      // Positional-VP missions (Powered Perimeter): route toward strained markers
      const _strainMap = game.signalMarkerStrain;
      const _strainedObj = (_strainMap && objPositions.length > 0)
        ? objPositions.filter(c => (_strainMap[c] || 0) > 0)
        : [];
      // Prefer objectives when: strained markers exist (Powered Perimeter)
      // OR endgame mode is active (route toward scoring positions, not enemies)
      const _preferObj = _strainedObj.length > 0 || (_inEndgame && objPositions.length > 0);
      if (_inEndgame && _preferObj && !_strainedObj.length) _endgameObjOnlyMoves++;
      // Already at/adjacent to a scoring position — stop moving to hold position.
      // Applies to: Powered Perimeter strained markers, and endgame objective spaces.
      if (_preferObj && moveDone.length > 0 && moveEntry?.startCoord) {
        const _cp = String(moveEntry.startCoord).toLowerCase();
        const _atStrained = _strainedObj.some(c => getRange(_cp, String(c).toLowerCase()) <= 1);
        const _atObjective = _inEndgame && objPositions.some(c => getRange(_cp, String(c).toLowerCase()) === 0);
        if (_atStrained || _atObjective) {
          _moveGreedyUsed++;
          return { action: moveDone[0], score: 0 };
        }
      }
      const targetEnemies = enemyPositions;
      const hasTargets = targetEnemies.length > 0 || objPositions.length > 0;
      if (hasTargets) {
        const curPos = moveEntry?.startCoord;
        let currentDist = Infinity;
        if (curPos) {
          const cp = String(curPos).toLowerCase();
          if (!_preferObj) {
            for (const ePos of targetEnemies) {
              const d = getRange(cp, String(ePos).toLowerCase());
              if (d < currentDist) currentDist = d;
            }
          }
          const _objTargets = _strainedObj.length > 0 ? _strainedObj : objPositions;
          for (const oPos of _objTargets) {
            const d = getRange(cp, String(oPos).toLowerCase());
            if (d < currentDist) currentDist = d;
          }
        }

        const bestSpaces = [];
        let bestDist = Infinity;
        for (const a of moveSpaces) {
          const coord = String(a.params.coord).toLowerCase();
          let minDist = Infinity;
          if (!_preferObj) {
            for (const ePos of targetEnemies) {
              const d = getRange(coord, String(ePos).toLowerCase());
              if (d < minDist) minDist = d;
            }
          }
          const _objTargets = _strainedObj.length > 0 ? _strainedObj : objPositions;
          for (const oPos of _objTargets) {
            const d = getRange(coord, String(oPos).toLowerCase());
            if (d < minDist) minDist = d;
          }
          if (minDist < bestDist) {
            bestDist = minDist;
            bestSpaces.length = 0;
            bestSpaces.push(a);
          } else if (minDist === bestDist) {
            bestSpaces.push(a);
          }
        }

        if (bestDist < currentDist) {
          _moveGreedyUsed++;
          const bestAction = bestSpaces[Math.floor(Math.random() * bestSpaces.length)];
          return { action: bestAction, score: 0 };
        }
        if (moveDone.length > 0) {
          _moveGreedyUsed++;
          return { action: moveDone[0], score: 0 };
        }
        _moveGreedyUsed++;
        return { action: bestSpaces[Math.floor(Math.random() * bestSpaces.length)], score: 0 };
      }
      // No targets found — just suppress done and let DQN pick
      if (moveDone.length > 0) {
        viable = viable.filter(a => !(a.type === 'move_pick_space' && a.params?.done));
      }
    } else {
      // Learned movement: fall through to pickSmartAction / WG move scorer
      _moveLearnedUsed++;
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
