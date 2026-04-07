/**
 * Multi-game training loop — runs N headless games with Q-learning.
 * Both players use pickSmartAction and learn from every game.
 *
 * Usage:
 *   node tests/headless/train.js [numGames] [--reset]
 *   node tests/headless/train.js 100        # Train 100 games
 *   node tests/headless/train.js 50 --reset   # Wipe learnings and train 50
 *   node tests/headless/train.js 50 --encoder=graph  # Train with graph encoder
 *   node tests/headless/train.js 5 --training --reset  # Locked whitelist matchups only
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import {
  loadLearnings, saveLearnings, createGameTracer,
  pickSmartAction, abstractActionType, getLearningsStats,
  recordMatchResult, replayUpdate, loadReplayBuffer, saveReplayBuffer,
  recordTrainingCheckpoint, checkDivergence, setWeightDecay, setAlpha, getEffectiveAlpha, getQValues,
  extractFeatures, setEncoderType, getEncoderType, setWgWeightClamp, setMoveDecisionBonus,
  setMoveQualitySignalFlag, setBoundaryFix,
} from './learnings.js';
import { buildGraph, graphForwardPass, setAttentionPool, setRichEdges, setMoveQualitySignal } from './graph-encoder.js';
import { unlinkSync } from 'fs';
import { TRAINING_MATCHUPS, TRAINING_WHITELIST_DCS, TRAINING_WHITELIST_CCS } from '../../src/ai/training-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEARNINGS_PATH = join(__dirname, 'learnings-data.json');
const REPLAY_BUFFER_PATH = join(__dirname, 'replay-buffer.json');
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

// Load Destruct test decks — 36 competitive decks with full DC + CC lists
const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const TEST_DECKS = JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));

// Global flag: when true, use locked training matchups + whitelist validation
let useTrainingMatchups = false;

/**
 * Pick a random matchup: two different decks from the test deck pool.
 * Returns { p1Deck, p2Deck } each with { name, dcList, ccList }.
 */
function pickMatchup(gameNum) {
  if (useTrainingMatchups) {
    const matchup = TRAINING_MATCHUPS[gameNum % TRAINING_MATCHUPS.length];
    return { p1Deck: matchup.p1Deck, p2Deck: matchup.p2Deck };
  }
  const i = gameNum % TEST_DECKS.length;
  // Offset by roughly half the pool + prime step to avoid repeated pairings
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

/**
 * Validate all DCs + CCs in a game against the training whitelist.
 * Returns { valid, violations } where violations lists offending cards.
 */
function validateWhitelist(game) {
  const violations = [];
  for (const pn of [1, 2]) {
    const dcList = game[`p${pn}DcList`] || [];
    for (const dc of dcList) {
      if (!TRAINING_WHITELIST_DCS.has(dc.dcName)) {
        violations.push({ zone: `p${pn}DcList`, card: dc.dcName });
      }
    }
    for (const zone of ['CcHand', 'CcDeck', 'CcDiscard']) {
      const arr = game[`player${pn}${zone}`] || [];
      for (const cc of arr) {
        if (!TRAINING_WHITELIST_CCS.has(cc)) {
          violations.push({ zone: `player${pn}${zone}`, card: cc });
        }
      }
    }
    const attachments = game[`p${pn}CcAttachments`] || {};
    for (const ccs of Object.values(attachments)) {
      for (const cc of ccs) {
        if (!TRAINING_WHITELIST_CCS.has(cc)) {
          violations.push({ zone: `p${pn}CcAttachments`, card: cc });
        }
      }
    }
  }
  for (const cc of (game.gameBox || [])) {
    if (!TRAINING_WHITELIST_CCS.has(cc)) {
      violations.push({ zone: 'gameBox', card: cc });
    }
  }
  return { valid: violations.length === 0, violations };
}

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function distToNearestEnemy(coord, game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const oppFigs = game.figurePositions?.[oppNum] || {};
  let minDist = Infinity;
  for (const pos of Object.values(oppFigs)) {
    const d = coordDistance(coord, pos);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

async function runOneGame(learnings, gameNum) {
  const { p1Deck, p2Deck } = pickMatchup(gameNum);
  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  const builder = createTestGame()
    .lightweight()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army);

  // Include CC decks for command card play training
  if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
  if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
    .inRound(1)
    .build();

  // Training mode: validate whitelist before first action
  if (useTrainingMatchups) {
    const wl = validateWhitelist(game);
    if (!wl.valid) {
      console.error(`❌ WHITELIST VIOLATION in game ${gameNum}:`, wl.violations);
      return { ended: false, stopReason: 'whitelist_violation', p1VP: 0, p2VP: 0 };
    }
  }

  const hDeps = harness.getDeps();

  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  const tracer1 = createGameTracer(learnings, 1, dcHealthState, dcMessageMeta);
  const tracer2 = createGameTracer(learnings, 2, dcHealthState, dcMessageMeta);

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;

  // Movement metrics — track how often the AI moves vs ends activation idle
  let moveActions = 0;        // start_move, move_toward, move_away, move_lateral
  let endActivations = 0;     // dc_end_activation (how often AI ends without doing anything)
  let attackActions = 0;      // attack_target
  let totalActivations = 0;   // activate_dc (total activation starts)
  let passActivations = 0;    // pass_activation_turn

  // ── Runaway-loop diagnostics ────────────────────────────────────────────
  // Track per-game action type histogram + detect runaway windows (>200 iterations
  // with >50% of actions being the same type in a 50-action window).
  const actionTypeHist = {};  // absType → count
  let totalIterations = 0;
  let runawayWindowCount = 0; // windows where same type dominates
  let runawayDominantType = null; // most common type in runaway windows
  const RUNAWAY_WINDOW = 50;
  const RUNAWAY_THRESHOLD = 0.5; // >50% same type in window = runaway
  const recentActions = [];   // ring buffer of last RUNAWAY_WINDOW action types

  // Phase 2 metrics — richer activation quality tracking
  let productiveActions = 0;  // move, attack, ability, interact (not end/pass)
  let round1DistStart = null; // average distance at start of round 1
  let round1DistEnd = null;   // average distance at end of round 1
  let prematureEndAct = 0;    // end_activation when a productive action was available
  let attackWhenTargetsInRange = 0;   // chose attack when hasTargetsInRange=1
  let moveWhenTargetsInRange = 0;     // chose move when hasTargetsInRange=1
  let endWhenTargetsInRange = 0;      // chose end_activation when hasTargetsInRange=1
  let moveWhenNoTargets = 0;          // chose move when hasTargetsInRange=0
  let endWhenNoTargets = 0;           // chose end_activation when hasTargetsInRange=0
  let decisionsWithTargets = 0;       // total decisions where hasTargetsInRange=1
  let decisionsWithoutTargets = 0;    // total decisions where hasTargetsInRange=0

  // CC failure retry guard: track failures scoped to game context
  // Key: "P{n}:{cardName}:R{round}:{roundPhase}:{activatingDcIdx}"
  const ccFailureCounts = new Map();  // key → count
  const CC_MAX_RETRIES = 3;

  // ── No-progress loop breaker ──────────────────────────────────────────────
  // Track a lightweight board state fingerprint. If the fingerprint doesn't
  // change for NO_PROGRESS_LIMIT consecutive iterations, force progress.
  let lastFingerprint = '';
  let noProgressCount = 0;
  const NO_PROGRESS_LIMIT = 40; // 40 iterations with zero state change = stuck
  let stopReason = 'normal'; // track how the game ended

  function boardFingerprint(g) {
    // Lightweight hash: round, VP, phase, figure count, total HP, active DC
    const p1hp = dcHealthState ? [...dcHealthState.values()].reduce((s, arr) => {
      for (const fig of arr) if (fig) s += fig[0]; return s;
    }, 0) : 0;
    const p1figs = Object.keys(g.figurePositions?.[1] || {}).length;
    const p2figs = Object.keys(g.figurePositions?.[2] || {}).length;
    const p1vp = g.player1VP?.total || 0;
    const p2vp = g.player2VP?.total || 0;
    const activeDc = g.currentActivatingDcIndex ?? -1;
    const round = g.currentRound || 1;
    const phase = g.roundPhase || '?';
    const pending = g.pendingCombat ? 'C' : g.moveInProgress ? 'M' : g.phaseGate ? 'G' : '';
    return `${round}:${phase}:${p1vp}:${p2vp}:${p1figs}:${p2figs}:${p1hp}:${activeDc}:${pending}`;
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    // Round cap: force game end — higher VP wins, ties go to elimination count
    if ((g.currentRound || 1) > MAX_ROUNDS) {
      const p1vp = g.player1VP?.total || 0;
      const p2vp = g.player2VP?.total || 0;
      g.ended = true;
      stopReason = 'round_cap';
      if (p1vp > p2vp) g.winnerId = g.player1Id;
      else if (p2vp > p1vp) g.winnerId = g.player2Id;
      else {
        // Tiebreak: more surviving figures wins
        const p1Figs = Object.keys(g.figurePositions?.[1] || {}).length;
        const p2Figs = Object.keys(g.figurePositions?.[2] || {}).length;
        if (p1Figs > p2Figs) g.winnerId = g.player1Id;
        else if (p2Figs > p1Figs) g.winnerId = g.player2Id;
        else g.winnerId = null; // true draw
      }
      break;
    }

    // ── Auto-resolve mandatory two-player confirmations (zero learning value) ──
    // Phase gates: both players must "ready" — no decision involved.
    // Submit for each player sequentially; the handler sets ready flags internally.
    // After both submit, bothReady triggers dispatchPhaseAdvance which clears the gate.
    if (g.phaseGate) {
      const gateId = `phase_gate_ready_${g.gameId}`;
      try { await harness.submitAction(gateId, g.player1Id); } catch {}
      if (g.phaseGate) {
        try { await harness.submitAction(gateId, g.player2Id); } catch {}
      }
      continue; // Re-enter loop to process new state
    }
    // Auto-skip Krykna push queue (Chopper Base A end-of-round interactive phase)
    if (g.pendingKryknaPushQueue?.length > 0) {
      g.pendingKryknaPushQueue = null;
      g.kryknaPushedIds = null;
      continue;
    }
    // Auto-skip fluctuation swap (Lothal Wastes B end-of-round interactive phase)
    if (g.pendingFluctuationSwapQueue?.length > 0) {
      const pn = g.pendingFluctuationSwapQueue[0];
      const userId = pn === 1 ? g.player1Id : g.player2Id;
      try { await harness.submitAction(`fluctuation_skip_${g.gameId}`, userId); } catch {}
      continue;
    }
    // Combat ready: both players must confirm — no decision involved.
    // Submit for each player sequentially so the handler sets ready flags.
    if (g.pendingCombat && (!g.pendingCombat.p1Ready || !g.pendingCombat.p2Ready)) {
      const combatReadyId = `combat_ready_${g.gameId}`;
      if (!g.pendingCombat.p1Ready) {
        try { await harness.submitAction(combatReadyId, g.player1Id); } catch {}
      }
      if (g.pendingCombat && !g.pendingCombat.p2Ready) {
        try { await harness.submitAction(combatReadyId, g.player2Id); } catch {}
      }
      continue;
    }
    // ── No-progress loop detection ─────────────────────────────────────────
    const fp = boardFingerprint(g);
    if (fp === lastFingerprint) {
      noProgressCount++;
      if (noProgressCount >= NO_PROGRESS_LIMIT) {
        // Force end the game — award winner by VP, tiebreak by figures
        const p1vp = g.player1VP?.total || 0;
        const p2vp = g.player2VP?.total || 0;
        g.ended = true;
        stopReason = 'no_progress';
        if (p1vp > p2vp) g.winnerId = g.player1Id;
        else if (p2vp > p1vp) g.winnerId = g.player2Id;
        else {
          const p1F = Object.keys(g.figurePositions?.[1] || {}).length;
          const p2F = Object.keys(g.figurePositions?.[2] || {}).length;
          g.winnerId = p1F > p2F ? g.player1Id : p1F < p2F ? g.player2Id : null;
        }
        break;
      }
    } else {
      noProgressCount = 0;
      lastFingerprint = fp;
    }

    // Prevent OOM: clear accumulated state every 200 iterations
    if (i > 0 && i % 200 === 0) {
      if (g.undoStack) g.undoStack = [];
      if (g.eventLog) g.eventLog = [];
      if (g.actionHistory) g.actionHistory = [];
      // Clear fake client accumulated messages, action log, and channel caches
      if (hDeps._actionLog) hDeps._actionLog.length = 0;
      if (hDeps._client?._sentMessages) hDeps._client._sentMessages.length = 0;
      if (hDeps._client?._channelCache) {
        for (const ch of hDeps._client._channelCache.values()) {
          if (ch._sentMessages) ch._sentMessages.length = 0;
          if (ch._messageStore) ch._messageStore.clear();
        }
      }
      // Clear harness message accumulation
      const hMessages = harness.getMessages();
      if (hMessages) hMessages.length = 0;
    }

    const p1Actions = getAvailableActions(g, 1, actionDeps);
    const p2Actions = getAvailableActions(g, 2, actionDeps);
    let allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      // Never unready a phase gate — wastes iterations in a ready/unready loop
      if (a.type === 'phase_gate_unready') return false;
      // use_terminal costs an action with no mechanical effect — terminal CC bonus is passive
      if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
      // Filter CC plays by deep precondition check + retry guard
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) return false;
        const ccKey = `P${a.actingPlayer}:${a.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
        if ((ccFailureCounts.get(ccKey) || 0) >= CC_MAX_RETRIES) return false;
        return true;
      }
      return true;
    });

    if (allActions.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty > 10) {
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
        } else break;
        consecutiveEmpty = 0;
      }
      continue;
    }
    consecutiveEmpty = 0;

    // Stuck-state detection: if the same action type is picked 30+ times in a row,
    // the game is likely in an unresolvable pending state. Force progress by clearing
    // pending states and applying damage.
    if (allActions.length > 0 && allActions.every(a => a.type === lastActionType)) {
      sameTypeCount++;
      if (sameTypeCount > 30) {
        // Clear all pending sub-states that might be causing the loop
        for (const key of Object.keys(g)) {
          if (key.startsWith('pending') && g[key] != null && key !== 'pendingCombat') {
            g[key] = key.endsWith('Choice') ? {} : null;
          }
        }
        // Apply damage to break out
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Stuck-state breaker');
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Stuck-state breaker');
        }
        sameTypeCount = 0;
        lastActionType = null;
        continue;
      }
    } else {
      sameTypeCount = 0;
      lastActionType = allActions[0]?.type;
    }

    // Track failed moves
    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) {
      failedMoves.clear();
    }

    // Filter out failed moves
    const filteredActions = allActions.filter(a => {
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      return true;
    });
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    // Pick the best action across all available — pickSmartAction handles priorities
    // Determine acting player: prefer turn player, fall back to whoever has actions
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);

    let action;
    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      // Both have actions — pick from turn player, but if other player has mandatory
      // actions (combat_ready, phase_gate) and turn player doesn't, use other player
      const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
      if (otherMandatory && !turnMandatory) {
        actingPN = otherPlayer;
      } else {
        actingPN = turnPlayer;
      }
    } else {
      actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
    }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const tracer = actingPN === 1 ? tracer1 : tracer2;
    tracer.beforeAction(g, playerActions);
    action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);

    if (!action) continue;

    // Movement metrics tracking
    if (action.type === 'move_figure') { moveActions++; lastMoveId = action.customId; }
    else if (action.type === 'dc_end_activation') endActivations++;
    else if (action.type === 'attack_target') attackActions++;
    else if (action.type === 'activate_dc') totalActivations++;
    else if (action.type === 'pass_activation_turn') passActivations++;

    // Runaway-loop diagnostics — track action type histogram + sliding window
    totalIterations++;
    const absT = abstractActionType(action, g);
    actionTypeHist[absT] = (actionTypeHist[absT] || 0) + 1;
    recentActions.push(absT);
    if (recentActions.length > RUNAWAY_WINDOW) recentActions.shift();
    if (recentActions.length === RUNAWAY_WINDOW && totalIterations > 200) {
      const freq = {};
      for (const t of recentActions) freq[t] = (freq[t] || 0) + 1;
      const topEntry = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (topEntry && topEntry[1] / RUNAWAY_WINDOW > RUNAWAY_THRESHOLD) {
        runawayWindowCount++;
        runawayDominantType = topEntry[0];
      }
    }

    // Phase 2 metrics: productive actions and target-in-range conditioning
    const PRODUCTIVE_TYPES = new Set(['move_figure', 'move_pick_space', 'attack_target', 'dc_special', 'interact']);
    if (PRODUCTIVE_TYPES.has(action.type)) productiveActions++;

    // Round 1 distance tracking
    if ((g.currentRound || 1) === 1 && round1DistStart === null) {
      round1DistStart = distToNearestEnemy(
        Object.values(g.figurePositions?.[actingPN] || {})[0] || 'a1', g, actingPN);
    }

    // Premature end-activation detection: ended when productive actions existed
    if (action.type === 'dc_end_activation') {
      const hadProductive = playerActions.some(a =>
        a.type === 'move_figure' || a.type === 'attack_target' || a.type === 'dc_special' || a.type === 'interact');
      if (hadProductive) prematureEndAct++;
    }

    // Conditioning on activeDcHasTargetsInRange (feature index 42)
    if (action.type === 'activate_dc' || action.type === 'move_figure' ||
        action.type === 'attack_target' || action.type === 'dc_end_activation' ||
        action.type === 'move_pick_space') {
      try {
        const feats = extractFeatures(g, actingPN, dcHealthState, dcMessageMeta);
        const hasTargets = feats[42]; // activeDcHasTargetsInRange
        if (hasTargets > 0.5) {
          decisionsWithTargets++;
          if (action.type === 'attack_target') attackWhenTargetsInRange++;
          else if (action.type === 'move_figure' || action.type === 'move_pick_space') moveWhenTargetsInRange++;
          else if (action.type === 'dc_end_activation') endWhenTargetsInRange++;
        } else {
          decisionsWithoutTargets++;
          if (action.type === 'move_figure' || action.type === 'move_pick_space') moveWhenNoTargets++;
          else if (action.type === 'dc_end_activation') endWhenNoTargets++;
        }
      } catch { /* feature extraction can fail in edge states */ }
    }

    // Intercept interact actions — resolve directly (bypass Discord UI)
    if (action.type === 'interact') {
      const p = action.params;
      const actionsData = g.dcActionsData?.[p.msgId];
      if (actionsData && actionsData.remaining > 0) {
        actionsData.remaining = Math.max(0, actionsData.remaining - 1);
        const optionId = p.optionId;
        if (optionId === 'retrieve_contraband') {
          g.figureContraband = g.figureContraband || {};
          g.figureContraband[p.figureKey] = true;
        } else if (optionId?.startsWith('launch_panel_')) {
          const parts = optionId.replace('launch_panel_', '').split('_');
          const coord = parts[0];
          const side = parts[1];
          g.launchPanelState = g.launchPanelState || {};
          g.launchPanelState[coord.toLowerCase()] = side;
          if (action.actingPlayer === 1) g.p1LaunchPanelFlippedThisRound = true;
          else g.p2LaunchPanelFlippedThisRound = true;
        } else if (optionId?.startsWith('open_door_')) {
          const ek = optionId.replace('open_door_', '');
          g.openedDoors = g.openedDoors || [];
          if (!g.openedDoors.includes(ek)) g.openedDoors.push(ek);
        }
        // use_terminal: no game state mutation needed (just costs an action)
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    // Intercept CC plays — resolve directly via headless path
    if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
      try {
        // Deduct activation actions for special-action CCs (matching Discord dc-play-area.js:801-808)
        if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[action.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (action.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0; // doubleActionSpecial consumes all actions
          }
        }
        await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
      } catch (err) {
        const ccKey = `P${action.actingPlayer}:${action.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
        const count = (ccFailureCounts.get(ccKey) || 0) + 1;
        ccFailureCounts.set(ccKey, count);
        if (count === 1) {
          console.error(`  [CC FAIL] game=${game.gameId} P${action.actingPlayer} "${action.params.cardName}" R${g.currentRound || 1} phase=${g.roundPhase} dcIdx=${g.currentActivatingDcIndex ?? 'none'} err=${err.message || err}`);
        }
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    // Intercept strain_choice_discard (multi-step: pick count → pick specific CCs)
    if (action.type === 'strain_choice_discard') {
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
      try {
        await harness.submitAction(action.customId, userId);
      } catch { /* fallthrough */ }
      let g2 = harness.getGame();
      let safetyLimit = 30;
      while (g2.pendingStrainChoice?.discardTarget > 0 &&
             (g2.pendingStrainChoice.discardedCount || 0) < g2.pendingStrainChoice.discardTarget &&
             safetyLimit-- > 0) {
        const hand = getCcHand(g2, g2.pendingStrainChoice.playerNum) || [];
        if (hand.length === 0) break;
        try {
          await harness.submitAction(
            `strain_cc_pick_${g2.gameId}_${encodeURIComponent(hand[0])}`, userId,
          );
        } catch { break; }
        g2 = harness.getGame();
      }
      if (g2.pendingStrainChoice) delete g2.pendingStrainChoice;
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;

    try {
      await harness.submitAction(action.customId, userId);
      tracer.afterAction(harness.getGame(), action);
    } catch {
      tracer.afterAction(harness.getGame(), action);
    }
  }

  // Set stopReason for MAX_ITERATIONS case (loop exhausted without game ending)
  if (!harness.getGame().ended && stopReason === 'normal') {
    stopReason = 'max_iterations';
  }

  // Capture round-1 distance end before finalize
  const preFinGame = harness.getGame();
  if (round1DistStart !== null && round1DistEnd === null) {
    const figs1 = Object.values(preFinGame.figurePositions?.[1] || {});
    const figs2 = Object.values(preFinGame.figurePositions?.[2] || {});
    if (figs1.length > 0 && figs2.length > 0) {
      round1DistEnd = distToNearestEnemy(figs1[0], preFinGame, 1);
    }
  }

  // Finalize — both tracers update Q-values
  const finalGame = harness.getGame();
  tracer1.finalize(finalGame, true);  // Only tracer1 updates meta
  tracer2.finalize(finalGame, false);
  replayUpdate(learnings);

  const winnerLabel = finalGame.winnerId === finalGame.player1Id ? 'P1' :
                      finalGame.winnerId === finalGame.player2Id ? 'P2' : null;

  // Track per-DC and per-affiliation results
  recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStats, getDcEffects);

  // Count iterations used (for efficiency metrics)
  const finalG = harness.getGame();
  let iterationsUsed = MAX_ITERATIONS;
  // Re-derive from game state: if ended, the loop broke early
  // Use the round as a proxy — more precise iteration tracking below
  const finalRound = finalG.currentRound || 1;

  return {
    ended: finalGame.ended || false,
    winnerId: finalGame.winnerId,
    winnerLabel,
    p1Army: p1Deck.name,
    p2Army: p2Deck.name,
    p1VP: finalGame.player1VP?.total || 0,
    p2VP: finalGame.player2VP?.total || 0,
    finalRound,
    // Movement metrics
    moveActions,
    attackActions,
    endActivations,
    totalActivations,
    passActivations,
    // Phase 2 metrics
    productiveActions,
    round1DistClosed: (round1DistStart !== null && round1DistEnd !== null)
      ? round1DistStart - round1DistEnd : null,
    prematureEndAct,
    attackWhenTargetsInRange,
    moveWhenTargetsInRange,
    endWhenTargetsInRange,
    moveWhenNoTargets,
    endWhenNoTargets,
    decisionsWithTargets,
    decisionsWithoutTargets,
    // Runaway-loop diagnostics
    totalIterations,
    runawayWindowCount,
    runawayDominantType,
    actionTypeHist,
    stopReason,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const numGames = parseInt(args.find(a => !a.startsWith('-')) || '50', 10);
  const reset = args.includes('--reset');

  const noReplay = args.includes('--no-replay');
  const wdArg = args.find(a => a.startsWith('--weight-decay='));
  if (wdArg) {
    const wdVal = parseFloat(wdArg.split('=')[1]);
    if (isNaN(wdVal) || wdVal < 0) { console.error('Invalid --weight-decay value'); process.exit(1); }
    setWeightDecay(wdVal);
    console.log(`  Weight decay override: ${wdVal}`);
  }
  const alphaArg = args.find(a => a.startsWith('--alpha='));
  if (alphaArg) {
    const alphaVal = parseFloat(alphaArg.split('=')[1]);
    if (isNaN(alphaVal) || alphaVal <= 0) { console.error('Invalid --alpha value'); process.exit(1); }
    setAlpha(alphaVal);
    console.log(`  Alpha (learning rate) override: ${alphaVal}`);
  }
  const encoderArg = args.find(a => a.startsWith('--encoder='));
  if (encoderArg) {
    const encVal = encoderArg.split('=')[1];
    if (encVal !== 'flat' && encVal !== 'graph') { console.error('Invalid --encoder value (flat|graph)'); process.exit(1); }
    setEncoderType(encVal);
    console.log(`  Encoder type: ${encVal}`);
  }
  const wgClampArg = args.find(a => a.startsWith('--wg-clamp='));
  if (wgClampArg) {
    const wgVal = parseFloat(wgClampArg.split('=')[1]);
    if (isNaN(wgVal) || wgVal <= 0) { console.error('Invalid --wg-clamp value'); process.exit(1); }
    setWgWeightClamp(wgVal);
    console.log(`  WG weight clamp override: ${wgVal}`);
  }
  const moveDecBonusArg = args.find(a => a.startsWith('--move-decision-bonus='));
  if (moveDecBonusArg) {
    const mdVal = parseFloat(moveDecBonusArg.split('=')[1]);
    if (isNaN(mdVal) || mdVal < 0) { console.error('Invalid --move-decision-bonus value'); process.exit(1); }
    setMoveDecisionBonus(mdVal);
    console.log(`  Move decision bonus: ${mdVal}`);
  }
  if (args.includes('--attention-pool')) {
    setAttentionPool(true);
    console.log(`  Attention pooling: ENABLED`);
  }
  if (args.includes('--rich-edges')) {
    setRichEdges(true);
    console.log(`  Rich edge features: ENABLED (dstCanAttackSrc, srcCanMoveToDst)`);
  }
  if (args.includes('--move-quality-signal')) {
    setMoveQualitySignal(true);
    setMoveQualitySignalFlag(true);
    console.log(`  Move quality signal: ENABLED (WG-scored move opportunity → DQN input)`);
  }
  if (args.includes('--no-boundary-fix')) {
    setBoundaryFix(false);
    console.log(`  Boundary fix: DISABLED (A/B control arm)`);
  }
  if (args.includes('--training')) {
    useTrainingMatchups = true;
    console.log(`  Training mode: LOCKED matchups (${TRAINING_MATCHUPS.length} matchups, ${TRAINING_WHITELIST_DCS.size} DCs, ${TRAINING_WHITELIST_CCS.size} CCs)`);
  }

  // A/B experiment: custom checkpoint load / save paths
  const checkpointArg = args.find(a => a.startsWith('--checkpoint='));
  const outputArg = args.find(a => a.startsWith('--output='));
  const loadPath = checkpointArg ? join(__dirname, checkpointArg.split('=')[1]) : LEARNINGS_PATH;
  const savePath = outputArg ? join(__dirname, outputArg.split('=')[1]) : LEARNINGS_PATH;

  const learnings = reset ? loadLearnings('/dev/null') // fresh default
                          : loadLearnings(loadPath);

  if (reset) {
    try { unlinkSync(REPLAY_BUFFER_PATH); } catch {}
  } else if (!noReplay) {
    loadReplayBuffer(learnings, REPLAY_BUFFER_PATH);
  }
  if (noReplay) {
    learnings.replayBuffer = null; // disable buffer storage + replay updates
  }

  const uniqueDcs = new Set();
  if (useTrainingMatchups) {
    TRAINING_MATCHUPS.forEach(m => { m.p1Deck.dcList.forEach(dc => uniqueDcs.add(dc)); m.p2Deck.dcList.forEach(dc => uniqueDcs.add(dc)); });
  } else {
    TEST_DECKS.forEach(d => d.dcList.forEach(dc => uniqueDcs.add(dc)));
  }
  console.log(`Training ${numGames} games (starting from ${learnings.meta.totalGames} prior games)`);
  console.log(`  Deck pool: ${useTrainingMatchups ? TRAINING_MATCHUPS.length + ' locked matchups' : TEST_DECKS.length + ' decks'}, ${uniqueDcs.size} unique DCs`);
  if (checkpointArg) console.log(`  Load checkpoint: ${loadPath}`);
  if (outputArg) console.log(`  Save output: ${savePath}`);
  if (reset) console.log('  (learnings reset)');

  let completed = 0;
  let p1Wins = 0;
  let p2Wins = 0;
  let totalVP = 0;
  let vpCount = 0;
  const perGameResults = [];
  const checkpoints = [];
  let cpCompleted = 0, cpP1 = 0, cpP2 = 0, cpVP = 0, cpGames = 0;
  let cpRunawayGames = 0, cpRunawayWindows = 0, cpTotalIters = 0; // runaway accumulators
  const cpStopReasons = {}; // stopReason → count per checkpoint window
  const startTime = Date.now();
  const updatesBefore = learnings.trainingStats?.totalUpdates || 0;
  let lastCheckpointUpdates = updatesBefore;

  for (let i = 0; i < numGames; i++) {
    const gameNum = learnings.meta.totalGames; // Use total for army rotation
    const updatesBeforeGame = learnings.trainingStats?.totalUpdates || 0;
    const result = await runOneGame(learnings, gameNum);
    const updatesAfterGame = learnings.trainingStats?.totalUpdates || 0;

    const gameVP = (result.p1VP || 0) + (result.p2VP || 0);
    totalVP += gameVP;
    vpCount++;

    perGameResults.push({
      game: i + 1,
      ended: result.ended,
      winner: result.winnerLabel || 'none',
      p1VP: result.p1VP || 0,
      p2VP: result.p2VP || 0,
      updates: updatesAfterGame - updatesBeforeGame,
      finalRound: result.finalRound || 1,
      moveActions: result.moveActions || 0,
      attackActions: result.attackActions || 0,
      endActivations: result.endActivations || 0,
      totalActivations: result.totalActivations || 0,
      passActivations: result.passActivations || 0,
      // Phase 2
      productiveActions: result.productiveActions || 0,
      round1DistClosed: result.round1DistClosed,
      prematureEndAct: result.prematureEndAct || 0,
      attackWhenTargetsInRange: result.attackWhenTargetsInRange || 0,
      moveWhenTargetsInRange: result.moveWhenTargetsInRange || 0,
      endWhenTargetsInRange: result.endWhenTargetsInRange || 0,
      moveWhenNoTargets: result.moveWhenNoTargets || 0,
      endWhenNoTargets: result.endWhenNoTargets || 0,
      decisionsWithTargets: result.decisionsWithTargets || 0,
      decisionsWithoutTargets: result.decisionsWithoutTargets || 0,
      // Runaway diagnostics
      totalIterations: result.totalIterations || 0,
      runawayWindowCount: result.runawayWindowCount || 0,
      runawayDominantType: result.runawayDominantType || null,
      stopReason: result.stopReason || 'normal',
    });

    // Log runaway games immediately
    if (result.runawayWindowCount > 0) {
      const topTypes = Object.entries(result.actionTypeHist || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      console.log(`  ⚠ RUNAWAY game ${i + 1}: ${result.runawayWindowCount} windows, dominant=${result.runawayDominantType}, iters=${result.totalIterations}, top: ${topTypes.map(([t,c]) => `${t}:${c}`).join(' ')}`);
    }

    cpGames++;
    cpVP += gameVP;
    if (result.ended) {
      completed++;
      cpCompleted++;
      if (result.winnerLabel === 'P1') { p1Wins++; cpP1++; }
      if (result.winnerLabel === 'P2') { p2Wins++; cpP2++; }
    }
    // Accumulate runaway stats
    cpTotalIters += result.totalIterations || 0;
    cpRunawayWindows += result.runawayWindowCount || 0;
    if (result.runawayWindowCount > 0) cpRunawayGames++;
    cpStopReasons[result.stopReason || 'normal'] = (cpStopReasons[result.stopReason || 'normal'] || 0) + 1;

    // 50-game checkpoint
    if ((i + 1) % 50 === 0) {
      const cpElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const cpStats = getLearningsStats(learnings);
      const cpUpdatesNow = cpStats.totalUpdates || 0;
      const cpUpdatesWindow = cpUpdatesNow - lastCheckpointUpdates;
      const cp = {
        games: `${i + 1 - 49}-${i + 1}`,
        completionRate: `${cpCompleted}/${cpGames} (${(cpCompleted/cpGames*100).toFixed(1)}%)`,
        winRate: `${cpCompleted}/${cpGames}`,
        p1p2: `${cpP1}/${cpP2}`,
        avgVP: cpGames > 0 ? (cpVP / cpGames).toFixed(1) : '0',
        avgAbsDelta: cpStats.avgAbsDelta.toFixed(4),
        replayBufSize: cpStats.replayBufferSize || 0,
        replayTotalStored: cpStats.replayTotalStored || 0,
        updatesThisWindow: cpUpdatesWindow,
        totalUpdates: cpUpdatesNow,
        nanResets: cpStats.nanResets,
        wallTime: cpElapsed,
        epsilon: cpStats.epsilon.toFixed(3),
        avgAbsWeight: cpStats.avgAbsWeight.toFixed(4),
      };
      checkpoints.push(cp);
      console.log(`\n=== CHECKPOINT: Games ${cp.games} ===`);
      console.log(`  Completion: ${cp.completionRate} | Wins P1/P2: ${cp.p1p2} | Avg VP: ${cp.avgVP}`);
      console.log(`  Avg |delta|: ${cp.avgAbsDelta} | Avg |w|: ${cp.avgAbsWeight} | epsilon: ${cp.epsilon} | effAlpha: ${getEffectiveAlpha(learnings.meta?.totalGames).toFixed(6)}`);
      console.log(`  Updates this window: ${cp.updatesThisWindow} | Total: ${cp.totalUpdates}`);
      console.log(`  Replay buf: ${cp.replayBufSize} | Total stored: ${cp.replayTotalStored}`);
      console.log(`  NaN resets: ${cp.nanResets} | Wall: ${cp.wallTime}s`);
      // WG scorer diagnostics
      if (learnings.withinGroupWeights) {
        const wg = learnings.withinGroupWeights;
        const fmtW = (arr) => arr.map(w => w.toFixed(2)).join(', ');
        const maxAbs = (arr) => Math.max(...arr.map(Math.abs)).toFixed(2);
        const saturated = (arr, clamp) => arr.filter(w => Math.abs(w) >= clamp * 0.95).length;
        const clamp = 10.0; // current WG_WEIGHT_CLAMP
        if (wg.attack) console.log(`  WG attack: [${fmtW(wg.attack)}] max|w|=${maxAbs(wg.attack)} sat=${saturated(wg.attack, clamp)}/6`);
        if (wg.move) console.log(`  WG move:   [${fmtW(wg.move)}] max|w|=${maxAbs(wg.move)} sat=${saturated(wg.move, clamp)}/9`);
        if (wg.surge) console.log(`  WG surge:  [${fmtW(wg.surge)}] max|w|=${maxAbs(wg.surge)} sat=${saturated(wg.surge, clamp)}/4`);
        if (wg.cc) console.log(`  WG cc:     [${fmtW(wg.cc)}] max|w|=${maxAbs(wg.cc)} sat=${saturated(wg.cc, clamp)}/4`);
      }
      // Runaway-loop checkpoint summary
      const avgIters = cpGames > 0 ? (cpTotalIters / cpGames).toFixed(0) : 0;
      console.log(`  Runaway: ${cpRunawayGames}/${cpGames} games, ${cpRunawayWindows} total windows, avg iters/game: ${avgIters}`);
      const srStr = Object.entries(cpStopReasons).map(([r,c]) => `${r}:${c}`).join(' ');
      console.log(`  StopReason: ${srStr}`);
      // Boundary + chain-type diagnostics
      const ts = learnings.trainingStats;
      if (ts.lastBoundaryTruncRate != null) {
        console.log(`  Boundary: truncRate=${ts.lastBoundaryTruncRate} effN=${ts.lastEffectiveNStep}`);
        console.log(`    Glue(≤2): ${ts.lastGlueEntryCount} entries, truncRate=${ts.lastGlueBoundaryTruncRate}, effN=${ts.lastGlueEffectiveNStep}, avg|r|=${ts.lastAvgGlueReward}`);
        console.log(`    Real(>2): ${ts.lastRealEntryCount} entries, truncRate=${ts.lastRealBoundaryTruncRate}, effN=${ts.lastRealEffectiveNStep}, avg|r|=${ts.lastAvgRealReward}`);
        if (ts.lastChainLengthHist) {
          const h = ts.lastChainLengthHist;
          console.log(`    ChainHist: 1:${h['1']} 2:${h['2']} 3-5:${h['3-5']} 6-10:${h['6-10']} 11-20:${h['11-20']} 21+:${h['21+']}`);
        }
      }
      // Persist checkpoint to training history for plateau detection
      recordTrainingCheckpoint(learnings, {
        completed: cpCompleted, total: cpGames,
        p1Wins: cpP1, p2Wins: cpP2,
        avgVP: cpGames > 0 ? cpVP / cpGames : 0,
        avgAbsDelta: parseFloat(cp.avgAbsDelta),
        epsilon: parseFloat(cp.epsilon),
      });
      // Reset window counters
      cpCompleted = 0; cpP1 = 0; cpP2 = 0; cpVP = 0; cpGames = 0;
      cpRunawayGames = 0; cpRunawayWindows = 0; cpTotalIters = 0;
      for (const k of Object.keys(cpStopReasons)) delete cpStopReasons[k];
      lastCheckpointUpdates = cpUpdatesNow;
    }

    // Progress every 10 games
    if ((i + 1) % 10 === 0 || i === numGames - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const stats = getLearningsStats(learnings);
      console.log(
        `  [${i + 1}/${numGames}] ${elapsed}s | ` +
        `completed: ${completed}/${i + 1} | ` +
        `P1: ${p1Wins} P2: ${p2Wins} | ` +
        `weights: ${stats.weightCount} | ` +
        `avgW: ${stats.avgAbsWeight.toFixed(4)} | ` +
        `epsilon: ${stats.epsilon.toFixed(3)}`
      );
      // Save periodically
      saveLearnings(learnings, savePath);
      if (!noReplay) saveReplayBuffer(learnings, REPLAY_BUFFER_PATH);

      // Divergence guardrail — check every 10 games, abort if V(s) or norms explode
      const divCheck = checkDivergence(learnings);
      if (!divCheck.ok) {
        console.error(`\n!!! DIVERGENCE DETECTED at game ${i + 1} !!!`);
        divCheck.reasons.forEach(r => console.error(`  - ${r}`));
        console.log('Signals:', JSON.stringify(divCheck.signals, null, 2));
        // Save checkpoint before aborting so we don't lose partial progress
        const abortTag = `${learnings.meta.totalGames}_diverged`;
        const abortPath = savePath.replace('.json', `-${abortTag}.json`);
        saveLearnings(learnings, abortPath);
        console.log(`Saved divergence checkpoint: ${abortPath}`);
        process.exit(2);
      }
    }
  }

  saveLearnings(learnings, savePath);
  if (!noReplay) saveReplayBuffer(learnings, REPLAY_BUFFER_PATH);

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = getLearningsStats(learnings);
  const totalUpdatesThisBatch = (stats.totalUpdates || 0) - updatesBefore;

  console.log('\n=== Training Complete ===');
  console.log(`Mode: ${noReplay ? 'NO REPLAY (baseline)' : 'WITH REPLAY (Phase 4)'}`);
  console.log(`Total games trained: ${stats.totalGames}`);
  console.log(`Wall time: ${totalElapsed}s`);
  console.log(`Weights: ${stats.weightCount} | Avg |w|: ${stats.avgAbsWeight.toFixed(4)}`);
  console.log(`Total updates: ${stats.totalUpdates} | This batch: ${totalUpdatesThisBatch}`);
  console.log(`Avg |delta|: ${stats.avgAbsDelta.toFixed(4)}`);
  console.log(`NaN resets: ${stats.nanResets}`);
  console.log(`This batch — completed: ${completed}/${numGames} (${(completed/numGames*100).toFixed(1)}%)`);
  console.log(`Win split — P1: ${p1Wins}, P2: ${p2Wins}`);
  console.log(`Avg total VP per game: ${vpCount > 0 ? (totalVP / vpCount).toFixed(2) : 'N/A'}`);
  console.log(`Exploration rate: ${(stats.epsilon * 100).toFixed(1)}%`);
  console.log(`Replay buffer size: ${stats.replayBufferSize || 0}`);
  console.log(`Replay total stored: ${stats.replayTotalStored || 0}`);

  // Quality metrics
  const completedGames = perGameResults.filter(r => r.ended);
  if (completedGames.length > 0) {
    const vpDiffs = completedGames.map(r => Math.abs(r.p1VP - r.p2VP));
    const avgVpDiff = vpDiffs.reduce((s, v) => s + v, 0) / vpDiffs.length;
    const avgRound = completedGames.reduce((s, r) => s + (r.finalRound || 1), 0) / completedGames.length;
    const avgUpdates = completedGames.reduce((s, r) => s + r.updates, 0) / completedGames.length;
    const decisive = completedGames.filter(r => Math.abs(r.p1VP - r.p2VP) >= 10).length;
    console.log('\n=== Quality Metrics ===');
    console.log(`Avg VP differential: ${avgVpDiff.toFixed(1)} (higher = more decisive wins)`);
    console.log(`Avg rounds to finish: ${avgRound.toFixed(1)} (lower = faster resolution)`);
    console.log(`Avg updates per game: ${avgUpdates.toFixed(0)} (lower = fewer iterations)`);
    console.log(`Decisive wins (VP diff >= 10): ${decisive}/${completedGames.length} (${(decisive/completedGames.length*100).toFixed(0)}%)`);
  }

  // Movement metrics
  if (perGameResults.length > 0) {
    const totalMoves = perGameResults.reduce((s, r) => s + r.moveActions, 0);
    const totalAttacks = perGameResults.reduce((s, r) => s + r.attackActions, 0);
    const totalEndAct = perGameResults.reduce((s, r) => s + r.endActivations, 0);
    const totalAct = perGameResults.reduce((s, r) => s + r.totalActivations, 0);
    const totalPass = perGameResults.reduce((s, r) => s + r.passActivations, 0);
    const n = perGameResults.length;
    console.log('\n=== Movement Metrics ===');
    console.log(`Avg moves/game: ${(totalMoves / n).toFixed(1)} | Avg attacks/game: ${(totalAttacks / n).toFixed(1)}`);
    console.log(`Avg activations/game: ${(totalAct / n).toFixed(1)} | Avg end_activation/game: ${(totalEndAct / n).toFixed(1)} | Avg pass/game: ${(totalPass / n).toFixed(1)}`);
    const moveRatio = totalAct > 0 ? (totalMoves / totalAct * 100).toFixed(1) : 'N/A';
    const idleRatio = totalAct > 0 ? ((totalEndAct + totalPass) / totalAct * 100).toFixed(1) : 'N/A';
    console.log(`Move-to-activation ratio: ${moveRatio}% | Idle ratio (end+pass)/activations: ${idleRatio}%`);

    // Per-window movement (10-game windows)
    console.log('\n=== Movement Per Window (10-game) ===');
    for (let w = 0; w < n; w += 10) {
      const window = perGameResults.slice(w, w + 10);
      const wMoves = window.reduce((s, r) => s + r.moveActions, 0) / window.length;
      const wAtk = window.reduce((s, r) => s + r.attackActions, 0) / window.length;
      const wEnd = window.reduce((s, r) => s + r.endActivations, 0) / window.length;
      const wAct = window.reduce((s, r) => s + r.totalActivations, 0) / window.length;
      console.log(`  Games ${w + 1}-${w + window.length}: moves=${wMoves.toFixed(1)} attacks=${wAtk.toFixed(1)} end_act=${wEnd.toFixed(1)} activations=${wAct.toFixed(1)}`);
    }
  }

  // Q-value diagnostic: show Q-values for key action types
  const absTypes = [
    'attack_close', 'attack_ranged', 'move_toward', 'move_away', 'move_lateral',
    'move_done', 'start_move', 'activate', 'end_activation', 'pass',
    'ability', 'spend_surge', 'skip_surges', 'reroll', 'other',
    'play_cc', 'react_use', 'react_skip', 'surge_damage', 'surge_special',
    'token_offense', 'token_defense', 'interact',
  ];
  const keyTypes = ['start_move', 'move_toward', 'end_activation', 'pass', 'attack_close', 'attack_ranged', 'activate', 'play_cc', 'ability', 'interact'];

  if (getEncoderType() === 'graph' && learnings.graphNetwork) {
    // Graph mode: build a synthetic 4-node graph for diagnostic
    const synthNodes = [
      { features: [1, 1.0, 0.5, 0.54, 0.08, 1, 0, 0, 1.0] },  // ally active melee, full HP, bias=1
      { features: [1, 0.8, 0.4, 0.40, 0.16, 0, 0, 0, 1.0] },  // ally passive ranged
      { features: [0, 1.0, 0.5, 0.54, 0.08, 0, 0, 0, 1.0] },  // enemy full HP melee
      { features: [0, 0.7, 0.4, 0.40, 0.16, 0, 0, 0, 1.0] },  // enemy damaged ranged
    ];
    // Features: team, hpRatio, speed, attackPower, normRange, isActive, isStunned, bias, distToNearestEnemy
    // Build fully-connected edges: [normDist, inAttackRange, sameTeam]
    const synthEdges = [];
    for (let i = 0; i < synthNodes.length; i++) {
      for (let j = 0; j < synthNodes.length; j++) {
        if (i === j) continue;
        const sameTeam = synthNodes[i].features[0] === synthNodes[j].features[0] ? 1.0 : 0.0;
        synthEdges.push({ src: i, dst: j, features: [0.5, 0.0, sameTeam] }); // normDist=0.5, not in range
      }
    }
    const synthGraph = { nodes: synthNodes, edges: synthEdges, numNodes: synthNodes.length };
    const result = graphForwardPass(learnings.graphNetwork, synthGraph);
    if (result && result.Q) {
      console.log('\n=== Q-Value Diagnostic [GRAPH] (synthetic round-1 state) ===');
      for (const t of keyTypes) {
        const idx = absTypes.indexOf(t);
        if (idx >= 0 && idx < result.Q.length) {
          console.log(`  Q(${t}) = ${result.Q[idx].toFixed(3)}`);
        }
      }
    }
  } else if (learnings.network) {
    // Flat mode: use representative feature vector
    const numFeatures = learnings.network.W1[0]?.length || 46;
    const diagFeatures = new Array(numFeatures).fill(0);
    diagFeatures[0] = 0;    // vpAdv = 0
    diagFeatures[1] = 1.0;  // myHpRatio = full HP
    diagFeatures[2] = 1.0;  // oppHpRatio = full HP
    diagFeatures[3] = 0;    // hpAdv = 0
    diagFeatures[8] = 8;    // avgDist = 8 (typical start-of-game)
    // Phase 2 active-DC: healthy melee figure, enemies far
    if (numFeatures >= 46) {
      diagFeatures[36] = 1.0; // activeDcHpRatio
      diagFeatures[37] = 0.5; // activeDcSpeed
      diagFeatures[38] = 0.54; // activeDcAttackPower
      diagFeatures[39] = 0.08; // activeDcAttackRange (melee)
      diagFeatures[40] = 0.2; // activeDcDistToNearestEnemy (far)
      diagFeatures[45] = 1.0; // activeDcActionsLeft (full)
    }
    const diagQ = getQValues(learnings, diagFeatures);
    if (diagQ) {
      console.log('\n=== Q-Value Diagnostic (round 1 start state) ===');
      for (const t of keyTypes) {
        const idx = absTypes.indexOf(t);
        if (idx >= 0 && idx < diagQ.length) {
          console.log(`  Q(${t}) = ${diagQ[idx].toFixed(3)}`);
        }
      }
    }
  }

  // Within-group scorer weights (Phase 5)
  const wg = learnings.withinGroupWeights;
  if (wg) {
    console.log('\n=== Within-Group Scorer Weights ===');
    const fmtW = (names, weights) => names.map((n, i) => `${n}=${(weights[i] || 0).toFixed(3)}`).join(', ');
    const aN = ['targetHpRatio', 'targetDistNorm', 'targetIsolated', 'targetThreat', 'killPotential', 'bias'];
    const mN = ['distToNearestEnemy', 'threatAtDest', 'objectiveProximity', 'allySupport', 'mpEfficiency', 'bias'];
    const sN = ['damageValue', 'isAccuracy', 'isRecover', 'bias'];
    const cN = ['ccCost', 'isAttachment', 'inCombat', 'bias'];
    if (wg.attack) console.log(`  attack: ${fmtW(aN, wg.attack)}`);
    if (wg.move) console.log(`  move:   ${fmtW(mN, wg.move)}`);
    if (wg.surge) console.log(`  surge:  ${fmtW(sN, wg.surge)}`);
    if (wg.cc) console.log(`  cc:     ${fmtW(cN, wg.cc)}`);
  }

  // Per-10-game completion windows
  console.log('\n=== Per-Window Completion (10-game windows) ===');
  for (let w = 0; w < numGames; w += 10) {
    const window = perGameResults.slice(w, w + 10);
    const wCompleted = window.filter(r => r.ended).length;
    const wVP = window.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / window.length;
    const wUpdates = window.reduce((s, r) => s + r.updates, 0);
    console.log(`  Games ${w + 1}-${w + window.length}: ${wCompleted}/${window.length} completed, avgVP: ${wVP.toFixed(1)}, updates: ${wUpdates}`);
  }

  // Phase 2 metrics: activation quality and target conditioning
  if (perGameResults.length > 0) {
    const n = perGameResults.length;
    const totalAct = perGameResults.reduce((s, r) => s + r.totalActivations, 0);
    const totalProductive = perGameResults.reduce((s, r) => s + r.productiveActions, 0);
    const totalPremature = perGameResults.reduce((s, r) => s + r.prematureEndAct, 0);
    const r1Closed = perGameResults.filter(r => r.round1DistClosed !== null);
    const avgR1Closed = r1Closed.length > 0
      ? r1Closed.reduce((s, r) => s + r.round1DistClosed, 0) / r1Closed.length : null;

    console.log('\n=== Phase 2: Activation Quality ===');
    console.log(`  Avg productive actions/game: ${(totalProductive / n).toFixed(1)}`);
    console.log(`  Avg productive/activation: ${totalAct > 0 ? (totalProductive / totalAct).toFixed(2) : 'N/A'}`);
    console.log(`  Premature end_activation/game: ${(totalPremature / n).toFixed(2)} (ended with productive actions available)`);
    if (avgR1Closed !== null) {
      console.log(`  Round-1 distance closed (avg): ${avgR1Closed.toFixed(1)} spaces`);
    }

    // Target conditioning: how behavior changes based on activeDcHasTargetsInRange
    const totWithTargets = perGameResults.reduce((s, r) => s + r.decisionsWithTargets, 0);
    const totNoTargets = perGameResults.reduce((s, r) => s + r.decisionsWithoutTargets, 0);
    const totAtkInRange = perGameResults.reduce((s, r) => s + r.attackWhenTargetsInRange, 0);
    const totMoveInRange = perGameResults.reduce((s, r) => s + r.moveWhenTargetsInRange, 0);
    const totEndInRange = perGameResults.reduce((s, r) => s + r.endWhenTargetsInRange, 0);
    const totMoveNoTgt = perGameResults.reduce((s, r) => s + r.moveWhenNoTargets, 0);
    const totEndNoTgt = perGameResults.reduce((s, r) => s + r.endWhenNoTargets, 0);

    console.log('\n=== Phase 2: Action Conditioning on hasTargetsInRange ===');
    if (totWithTargets > 0) {
      console.log(`  When targets IN range (${totWithTargets} decisions):`);
      console.log(`    attack: ${(totAtkInRange/totWithTargets*100).toFixed(1)}% | move: ${(totMoveInRange/totWithTargets*100).toFixed(1)}% | end: ${(totEndInRange/totWithTargets*100).toFixed(1)}%`);
    }
    if (totNoTargets > 0) {
      console.log(`  When targets NOT in range (${totNoTargets} decisions):`);
      console.log(`    move: ${(totMoveNoTgt/totNoTargets*100).toFixed(1)}% | end: ${(totEndNoTgt/totNoTargets*100).toFixed(1)}%`);
    }
  }

  console.log(`\nLearnings saved to ${savePath}`);
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
