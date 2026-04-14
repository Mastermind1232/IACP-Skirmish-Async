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
import { getDcStats, getMapData, getDcEffects, getCcEffect } from '../../src/data-loader.js';
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
  getWgAuditCounters, resetWgAuditCounters,
  getAtkAuditCounters, resetAtkAuditCounters, getAtkAuditTotals, resetAtkAuditTotals,
  OFFENSIVE_CC_TIMINGS,
  COMBAT_CC_TIMINGS,
} from './learnings.js';
import { buildGraph, graphForwardPass, setAttentionPool, setRichEdges, setMoveQualitySignal } from './graph-encoder.js';
import { unlinkSync } from 'fs';
import { TRAINING_MATCHUPS, TRAINING_WHITELIST_DCS, TRAINING_WHITELIST_CCS, TRAINING_MAPS } from '../../src/ai/training-config.js';

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
let auditMode = false;

// ── CC Reference Standard ──────────────────────────────────────────────────
// Static card-quality tiers for same-cost same-class tiebreak (1-5, higher = better).
// Only matters when cost and offensive class are identical.
const CC_CARD_QUALITY = {
  'Take Initiative': 5,
  'Element of Surprise': 4, 'Concentrated Fire': 4, 'Covering Fire': 4,
  'Deflection': 3, 'Blitz': 3, 'Battlefield Awareness': 3, 'Brace Yourself': 3, 'Deadeye': 3,
  'Lock On': 2, 'Parry': 2, 'Call the Vanguard': 2, 'Marksman': 2, 'Heart of Freedom': 2, 'Deadly Precision': 2,
  'Focus': 1, 'Urgency': 1, 'Planning': 1, 'Fleet Footed': 1, 'Wookiee Rage': 1,
  'Ready Weapons': 1, 'Expose Weakness': 1, 'Bodyguard': 1,
};

// Reference score for a CC option: combatTiming > offensive > cost > cardQuality
function ccRefScore(cardName, inCombat) {
  const ccData = getCcEffect(cardName);
  const timing = (ccData?.timing || '').toLowerCase();
  const isOffensive = OFFENSIVE_CC_TIMINGS.has(timing);
  const isCombatTimed = COMBAT_CC_TIMINGS.has(timing);
  const cost = ccData?.cost || 0;
  let score = 0;
  if (inCombat && isCombatTimed) score += 100;
  if (isOffensive) score += 50;
  score += (cost / 4) * 10;
  score += (CC_CARD_QUALITY[cardName] || 0);
  return score;
}

/**
 * Pick a random matchup: two different decks from the test deck pool.
 * Returns { p1Deck, p2Deck } each with { name, dcList, ccList }.
 */
function pickMatchup(gameNum) {
  if (useTrainingMatchups) {
    const matchup = TRAINING_MATCHUPS[gameNum % TRAINING_MATCHUPS.length];
    return { p1Deck: matchup.p1Deck, p2Deck: matchup.p2Deck, label: matchup.label };
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
  const { p1Deck, p2Deck, label } = pickMatchup(gameNum);
  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  // Rotate maps across training set (use TRAINING_MAPS when in training mode)
  const mapPool = (useTrainingMatchups && TRAINING_MAPS?.length > 0)
    ? TRAINING_MAPS : ['mos-eisley-outskirts'];
  const mapId = mapPool[gameNum % mapPool.length];

  const builder = createTestGame()
    .lightweight()
    .withMap(mapId)
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
  let activationsWithAttack = 0;  // activations that included at least one attack_target
  let currentActivationHadAttack = false;

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

  // ── Activation-order diagnostics ──────────────────────────────────────────
  let roundActivationIndex = 0;       // position within current round (0-based)
  let roundTotalExpected = 0;         // total DCs at round start (both sides)
  let woundedActivatedEarly = 0;      // wounded DC activated in first half of round
  let woundedActivatedLate = 0;       // wounded DC activated in second half
  let adjKillableActivatedEarly = 0;  // DC adjacent to killable enemy, activated early
  let adjKillableActivatedLate = 0;   // same, activated late
  let passWhenAhead = 0;              // pass_activation when own VP > opponent VP
  let passWhenBehind = 0;             // pass_activation when own VP < opponent VP
  let passWhenTied = 0;               // pass_activation when VP tied
  let totalWoundedActivations = 0;    // total activations of wounded DCs
  let totalAdjKillableActivations = 0; // total activations adjacent to killable enemy
  // Artifact-corrected wound tracking: snapshot which msgIds are wounded at round
  // boundary, so mid-round damage doesn't inflate "wounded activated early" counts.
  const woundedAtRoundStart = new Set(); // msgIds wounded before round began

  // ── Turn-denial diagnostics (Candidate B) ─────────────────────────────────
  // Track attacks where equal-HP targets existed and whether unactivated was preferred.
  let turnDenialOpportunities = 0;    // attacks where ≥2 targets had same HP and ≥1 was unactivated
  let turnDenialChosen = 0;           // of those, chose the unactivated target
  let turnDenialMissed = 0;           // of those, chose the activated target

  // ── Audit counters (coverage + surge accuracy) ──────────────────────────────
  const auditDcAppearances = {};    // dcName → count (games appeared)
  const auditDcActivations = {};    // dcName → count
  const auditDcAttacks = {};        // dcName → count (attacks performed)
  const auditDcDefeats = {};        // dcName → count (figures defeated from this DC)
  const auditCcPlays = {};          // ccName → count
  const auditCcOpportunities = {};  // ccName → count (offered but not necessarily chosen)
  const auditSurgeEvents = [];      // detailed surge decision log
  const auditCcDecisions = [];      // CC choice audit: mixed-choice + offensive tracking
  const auditMoveDecisions = [];    // Move quality audit: chosen vs reference-best destination
  const auditAttackDecisions = [];  // Attack target quality audit: per-decision target analysis

  // Record DC appearances for this game (must be after auditDcAppearances decl)
  if (auditMode) {
    for (const msgId of [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])]) {
      const meta = dcMessageMeta.get(msgId);
      if (meta?.dcName) auditDcAppearances[meta.dcName] = (auditDcAppearances[meta.dcName] || 0) + 1;
    }
  }

  // ── Audit instrumentation ────────────────────────────────────────────────
  let figureDefeats = 0;         // opponent figures that disappeared
  let lastP1FigCount = Object.keys(game.figurePositions?.[1] || {}).length;
  let lastP2FigCount = Object.keys(game.figurePositions?.[2] || {}).length;

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
  let lastChosenMoveKey = null; // for fingerprint-based move failure detection
  let stopReason = 'normal'; // track how the game ended

  function boardFingerprint(g) {
    const p1hp = dcHealthState ? [...dcHealthState.values()].reduce((s, arr) => {
      for (const fig of arr) if (fig) s += fig[0]; return s;
    }, 0) : 0;
    const p1figs = Object.keys(g.figurePositions?.[1] || {}).length;
    const p2figs = Object.keys(g.figurePositions?.[2] || {}).length;
    const p1vp = g.player1VP?.total || 0;
    const p2vp = g.player2VP?.total || 0;
    const round = g.currentRound || 1;
    const phase = g.roundPhase || '?';
    const pending = g.pendingCombat ? 'C' : g.moveInProgress ? 'M' : g.phaseGate ? 'G' : '';
    // Activation progression: remaining activations + actions within current activation
    const p1rem = g.p1ActivationsRemaining ?? 0;
    const p2rem = g.p2ActivationsRemaining ?? 0;
    const actIdx = (g.p1ActivatedDcIndices?.length ?? 0) + (g.p2ActivatedDcIndices?.length ?? 0);
    let actionsRem = 0;
    for (const v of Object.values(g.dcActionsData || {})) actionsRem += (v?.remaining ?? 0);
    // Include figure positions so movement changes the fingerprint
    const posHash = [1, 2].map(pn =>
      Object.entries(g.figurePositions?.[pn] || {}).sort().map(([k, v]) => `${k}@${v}`).join(',')
    ).join('|');
    return `${round}:${phase}:${p1vp}:${p2vp}:${p1figs}:${p2figs}:${p1hp}:${p1rem}+${p2rem}:${actIdx}:${actionsRem}:${pending}:${posHash}`;
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
    // Auto-resolve mission SOR token reveal (Chopper Base B "Powered Perimeter")
    if (g.pendingMissionSorReveal) {
      try { await harness.submitAction(`sor_mission_reveal_${g.gameId}`, g.player1Id); } catch {}
      continue;
    }
    // Auto-skip Krykna push queue (Chopper Base A end-of-round interactive phase)
    if (g.pendingKryknaPushQueue?.length > 0) {
      g.pendingKryknaPushQueue = null;
      g.kryknaPushedIds = null;
      continue;
    }
    // Auto-skip claimed Krykna placement (Chopper Base A post-push interactive phase)
    if (g.pendingClaimedKryknaQueue?.length > 0) {
      g.pendingClaimedKryknaQueue = null;
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

    // Fingerprint-based move failure detection: if fingerprint unchanged and last
    // action was move_pick_space, mark that coord as failed (catches silent failures)
    if (noProgressCount > 0 && lastChosenMoveKey) {
      failedMoves.add(lastChosenMoveKey);
      lastChosenMoveKey = null;
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

    // Stall-escape: after 15 consecutive unchanged fingerprints, override AI
    // to pick progression actions instead of stalling on movement/CC
    const STALL_ESCAPE_THRESHOLD = 15;
    if (noProgressCount >= STALL_ESCAPE_THRESHOLD) {
      const escape =
        playerActions.find(a => a.type === 'move_pick_space' && a.params?.done) ||
        playerActions.find(a => a.type === 'dc_end_activation') ||
        playerActions.find(a => a.type === 'end_activation') ||
        playerActions.find(a => a.type === 'pass_activation_turn') ||
        playerActions.find(a => a.type === 'end_round_phase') ||
        playerActions.find(a => a.type === 'combat_gate' || a.type === 'combat_ready') ||
        playerActions.find(a => a.type === 'combat_roll') ||
        playerActions.find(a => !a.type.startsWith('play_cc') && !a.type.startsWith('move_'));
      if (escape) action = escape;
    }

    // Track move_pick_space coord for fingerprint-based failure detection
    lastChosenMoveKey = (action.type === 'move_pick_space' && action.params?.coord)
      ? `${action.params.moveKey}_${action.params.coord}` : null;

    // ── Audit: move quality tracking ──
    if (auditMode && action.type === 'move_pick_space' && action.params?.coord && !action.params?.done) {
      try {
        const mc = pickSmartAction._lastMoveContrastive;
        if (mc && mc.refBestQuality != null) {
          const gap = mc.refBestQuality - mc.chosenQuality;
          const chosenF = mc.chosen ? Array.from(mc.chosen) : null;
          const bestF = mc.refBestFeatures ? Array.from(mc.refBestFeatures) : null;
          auditMoveDecisions.push({
            chosenQuality: mc.chosenQuality,
            refBestQuality: mc.refBestQuality,
            gap,
            candidateCount: mc.candidateCount || 0,
            chosenFeatures: chosenF,
            refBestFeatures: bestF,
          });
        }
      } catch { /* best-effort */ }
    }

    // ── Audit: track CC opportunities (any time play_cc is in available actions) ──
    if (auditMode) {
      for (const a of playerActions) {
        if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
          if (a.params?.cardName) auditCcOpportunities[a.params.cardName] = (auditCcOpportunities[a.params.cardName] || 0) + 1;
        }
      }
      // ── CC decision audit: enhanced per-decision quality tracking ──
      if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
        try {
          const ccActions = playerActions.filter(a =>
            (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') && a.params?.cardName
          );
          if (ccActions.length >= 1) {
            const inCombat = !!(g.pendingCombat || g.combat);
            const chosenCard = action.params?.cardName;

            // Build full option profile for all available CCs
            const options = ccActions.map(a => {
              const name = a.params.cardName;
              const ccData = getCcEffect(name);
              const timing = (ccData?.timing || '').toLowerCase();
              const isOffensive = OFFENSIVE_CC_TIMINGS.has(timing);
              const isCombatTimed = COMBAT_CC_TIMINGS.has(timing);
              const cost = ccData?.cost || 0;
              return { name, isOffensive, isCombatTimed, cost, refScore: ccRefScore(name, inCombat) };
            });

            const chosenOpt = options.find(o => o.name === chosenCard) || options[0];
            const hasOffensive = options.some(o => o.isOffensive);
            const hasNonOffensive = options.some(o => !o.isOffensive);

            // Reference preferred: highest refScore
            const refSorted = [...options].sort((a, b) => b.refScore - a.refScore);
            const refPreferred = refSorted[0].name;
            const matchesRef = chosenCard === refPreferred;

            // Same-feature-vector detection: CCs with identical (cost, isOffensive, isCombatTimed) as chosen
            const sameFeatureCount = options.filter(o =>
              o.cost === chosenOpt.cost && o.isOffensive === chosenOpt.isOffensive && o.isCombatTimed === chosenOpt.isCombatTimed
            ).length;

            const ccPickPath = pickSmartAction._lastCcPickPath || 'unknown';
            const hasFocusOption = options.some(o => o.name === 'Focus');

            auditCcDecisions.push({
              chosenCard,
              chosenClass: chosenOpt.isOffensive ? 'offensive' : 'non-offensive',
              chosenCost: chosenOpt.cost,
              chosenIsCombatTimed: chosenOpt.isCombatTimed,
              chosenRefScore: chosenOpt.refScore,
              optionCount: ccActions.length,
              isMixedChoice: hasOffensive && hasNonOffensive,
              hasOffensive,
              hasNonOffensive,
              inCombat,
              refPreferred,
              refPreferredScore: refSorted[0].refScore,
              matchesRef,
              sameFeatureCount,
              ccPickPath,
              hasFocusOption,
              options: options.map(o => ({ name: o.name, isOffensive: o.isOffensive, isCombatTimed: o.isCombatTimed, cost: o.cost, refScore: o.refScore })),
            });
          }
        } catch { /* best-effort */ }
      }
    }

    // Movement metrics tracking
    if (action.type === 'move_figure') { moveActions++; lastMoveId = action.customId; }
    else if (action.type === 'dc_end_activation') endActivations++;
    else if (action.type === 'attack_target') {
      attackActions++; currentActivationHadAttack = true;
      if (auditMode && action.params?.dcName) auditDcAttacks[action.params.dcName] = (auditDcAttacks[action.params.dcName] || 0) + 1;

      // ── Enhanced attack target quality audit ──────────────────────────────
      // Captures per-decision data: all targets' HP + activation status,
      // focus-fire vs turn-denial tradeoffs, HP gap analysis.
      try {
        const targetFk = action.params?.targetFigureKey;
        if (targetFk && !targetFk.startsWith('npc_')) {
          const oppPN = actingPN === 1 ? 2 : 1;
          const oppActivated = new Set(oppPN === 1 ? (g.p1ActivatedDcIndices || []) : (g.p2ActivatedDcIndices || []));
          const oppMsgIds = oppPN === 1 ? (g.p1DcMessageIds || []) : (g.p2DcMessageIds || []);
          const atkActions = playerActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey && !a.params.targetFigureKey.startsWith('npc_'));

          // Build full target profile for all available targets
          const targetInfo = atkActions.map(a => {
            const fk = a.params.targetFigureKey;
            let hp = null;
            const _dcN = fk.replace(/-\d+-\d+$/, '');
            const _fi = parseInt(fk.split('-').pop(), 10) || 0;
            for (const [_mid, _harr] of dcHealthState) {
              const _m = dcMessageMeta.get(_mid);
              if (_m && _m.playerNum === oppPN && _m.dcName === _dcN && _harr?.[_fi]) {
                hp = { current: _harr[_fi][0], max: _harr[_fi][1] }; break;
              }
            }
            let activated = false;
            for (let i = 0; i < oppMsgIds.length; i++) {
              const meta = dcMessageMeta.get(oppMsgIds[i]);
              if (meta && meta.dcName === _dcN) { activated = oppActivated.has(i); break; }
            }
            return { fk, dcName: _dcN, currentHp: hp?.current ?? 99, maxHp: hp?.max ?? 99, activated };
          });

          const chosenInfo = targetInfo.find(f => f.fk === targetFk);
          if (chosenInfo) {
            // Existing turn-denial tracking
            if (atkActions.length >= 2) {
              const sameHp = targetInfo.filter(f => f.currentHp === chosenInfo.currentHp && f.fk !== targetFk);
              const hasUnactivated = sameHp.some(f => !f.activated) || !chosenInfo.activated;
              const hasActivated = sameHp.some(f => f.activated) || chosenInfo.activated;
              if (sameHp.length > 0 && hasUnactivated && hasActivated) {
                turnDenialOpportunities++;
                if (!chosenInfo.activated) turnDenialChosen++;
                else turnDenialMissed++;
              }
            }

            // Enhanced per-decision audit
            if (auditMode) {
              const sortedByHp = [...targetInfo].sort((a, b) => a.currentHp - b.currentHp);
              const lowestHp = sortedByHp[0].currentHp;
              const secondHp = sortedByHp.length > 1 ? sortedByHp[1].currentHp : null;
              const unactivatedTargets = targetInfo.filter(t => !t.activated);
              const bestUnactivated = unactivatedTargets.length > 0
                ? unactivatedTargets.sort((a, b) => a.currentHp - b.currentHp)[0] : null;

              // Key question: focus-fire chose lowest HP, but was there an unactivated target close in HP?
              // "Close" = within 2× the lowest HP (e.g., lowest=3, unactivated at 5 is "close")
              const turnDenialTradeoff = (bestUnactivated && chosenInfo.activated && bestUnactivated.currentHp <= lowestHp * 2)
                ? { unactivatedHp: bestUnactivated.currentHp, chosenHp: chosenInfo.currentHp, hpCost: bestUnactivated.currentHp - chosenInfo.currentHp }
                : null;

              auditAttackDecisions.push({
                targetCount: atkActions.length,
                chosenHp: chosenInfo.currentHp,
                chosenMaxHp: chosenInfo.maxHp,
                chosenActivated: chosenInfo.activated,
                chosenDamaged: chosenInfo.currentHp < chosenInfo.maxHp,
                lowestHp,
                secondHp,
                hpGapToSecond: secondHp != null ? secondHp - lowestHp : 0,
                unactivatedCount: unactivatedTargets.length,
                chosenIsLowestHp: chosenInfo.currentHp === lowestHp,
                turnDenialTradeoff,
              });
            }
          }
        }
      } catch { /* best-effort */ }
    }
    else if (action.type === 'activate_dc') {
      // Close out previous activation before starting new one
      if (totalActivations > 0 && currentActivationHadAttack) activationsWithAttack++;
      totalActivations++;
      currentActivationHadAttack = false;
      if (auditMode && action.params?.dcName) auditDcActivations[action.params.dcName] = (auditDcActivations[action.params.dcName] || 0) + 1;

      // ── Activation-order diagnostics ──────────────────────────────────
      try {
        // Count DCs per side for expected activations this round
        const p1DcCount = (g.p1DcMessageIds || []).length;
        const p2DcCount = (g.p2DcMessageIds || []).length;
        if (p1DcCount + p2DcCount > roundTotalExpected || roundTotalExpected === 0) {
          roundTotalExpected = p1DcCount + p2DcCount;
        }
        roundActivationIndex++;
        const isEarly = roundActivationIndex <= Math.ceil(roundTotalExpected / 2);

        // Get msgId for the activated DC (params.msgId = "hl1dc0" etc.)
        const msgId = action.params?.msgId;
        const dcPN = actingPN;
        if (msgId && dcPN) {

          // Check if activated DC was wounded at round start (artifact-corrected).
          // Uses snapshot taken at round boundary, not live HP, so mid-round
          // damage doesn't inflate "wounded activated early" counts.
          const wasWoundedAtRoundStart = woundedAtRoundStart.has(msgId);
          if (wasWoundedAtRoundStart) {
            totalWoundedActivations++;
            if (isEarly) woundedActivatedEarly++;
            else woundedActivatedLate++;
          }

          // Check if activated DC is adjacent to a killable enemy
          const meta = dcMessageMeta.get(msgId);
          if (meta) {
            // Find this DC's figure positions
            const myFigKeys = Object.keys(g.figurePositions?.[dcPN] || {})
              .filter(fk => fk.startsWith(meta.dcName + '-'));
            const oppPN = dcPN === 1 ? 2 : 1;
            const oppMsgIds = g[`p${oppPN}DcMessageIds`] || [];

            for (const myFk of myFigKeys) {
              const myPos = g.figurePositions?.[dcPN]?.[myFk];
              if (!myPos) continue;
              const myCoord = parseCoord(myPos);
              if (!myCoord) continue;

              // Check all enemy figures
              for (const oppMsgId of oppMsgIds) {
                const oppHealth = dcHealthState.get(oppMsgId);
                const oppMeta = dcMessageMeta.get(oppMsgId);
                if (!oppHealth || !oppMeta) continue;
                // Check if any enemy figure is killable (<=3 HP) and adjacent (dist <=2)
                const oppFigKeys = Object.keys(g.figurePositions?.[oppPN] || {})
                  .filter(fk => fk.startsWith(oppMeta.dcName + '-'));
                for (let fi = 0; fi < oppFigKeys.length; fi++) {
                  const oPos = g.figurePositions?.[oppPN]?.[oppFigKeys[fi]];
                  if (!oPos) continue;
                  const oCoord = parseCoord(oPos);
                  if (!oCoord) continue;
                  const dist = Math.abs(myCoord.row - oCoord.row) + Math.abs(myCoord.col - oCoord.col);
                  if (dist <= 2 && oppHealth[fi] && oppHealth[fi][0] <= 3 && oppHealth[fi][0] > 0) {
                    totalAdjKillableActivations++;
                    if (isEarly) adjKillableActivatedEarly++;
                    else adjKillableActivatedLate++;
                    // Break out of both inner loops
                    fi = oppFigKeys.length;
                    break;
                  }
                }
              }
              break; // Only check first figure of the DC
            }
          }
        }
      } catch { /* activation-order diagnostics are best-effort */ }
    }
    else if (action.type === 'pass_activation_turn') {
      passActivations++;
      // Track pass usage relative to VP state
      try {
        const myVP = actingPN === 1 ? (g.player1VP?.total || 0) : (g.player2VP?.total || 0);
        const oppVP = actingPN === 1 ? (g.player2VP?.total || 0) : (g.player1VP?.total || 0);
        if (myVP > oppVP) passWhenAhead++;
        else if (myVP < oppVP) passWhenBehind++;
        else passWhenTied++;
      } catch { /* best-effort */ }
    }

    // Reset round activation index on round boundary + snapshot wound state
    if (action.type === 'end_activation_phase' || action.type === 'end_end_of_round') {
      roundActivationIndex = 0;
      // Snapshot which DCs are wounded at the START of the new round
      // so mid-round damage doesn't inflate activation-order metrics
      woundedAtRoundStart.clear();
      for (const [msgId, healthArr] of dcHealthState) {
        if (healthArr && healthArr.some(h => h && h[0] < h[1])) {
          woundedAtRoundStart.add(msgId);
        }
      }
    }

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
          const edgeKeys = optionId.replace('open_door_', '').split(',');
          g.openedDoors = g.openedDoors || [];
          for (const ek of edgeKeys) {
            if (!g.openedDoors.includes(ek)) g.openedDoors.push(ek);
          }
        }
        // use_terminal: no game state mutation needed (just costs an action)
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    // Intercept CC plays — resolve directly via headless path
    if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
      if (auditMode && action.params?.cardName) auditCcPlays[action.params.cardName] = (auditCcPlays[action.params.cardName] || 0) + 1;
      try {
        // Deduct activation actions for special-action CCs (matching Discord dc-play-area.js:801-808)
        if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[action.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (action.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0; // doubleActionSpecial consumes all actions
          }
        }
        const ccResult = await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
        if (ccResult?.played === false) {
          // Card stayed in hand (cost>0 resolve failed) — count as failure for retry guard
          const ccKey = `P${action.actingPlayer}:${action.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
          const count = (ccFailureCounts.get(ccKey) || 0) + 1;
          ccFailureCounts.set(ccKey, count);
        }
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

    // ── Audit: surge-accuracy tracking ────────────────────────────────────
    if (auditMode && action.type === 'combat_surge' && action.params?.surgeKey) {
      try {
        const combat = g.pendingCombat;
        if (combat?.isRanged && combat.distanceToTarget != null) {
          const rolledAcc = combat.attackRoll?.acc || 0;
          const bonusAcc = combat.bonusAccuracy || 0;
          const surgeAccSoFar = combat.surgeAccuracy || 0;
          const totalAccBefore = rolledAcc + bonusAcc + surgeAccSoFar;
          const needed = combat.distanceToTarget;
          const isAccSurge = /^accuracy\s+(-?\d+)$/i.test(action.params.surgeKey);
          const accGain = isAccSurge ? parseInt(action.params.surgeKey.match(/(-?\d+)/)?.[1] || '0') : 0;
          const excess = Math.max(0, totalAccBefore - needed);
          // Capture alternative surge options available at this decision
          const altSurges = playerActions
            .filter(a => a.type === 'combat_surge' && a.params?.surgeKey && a.params.surgeKey !== action.params.surgeKey)
            .map(a => {
              const isAcc = /^accuracy\s+(-?\d+)$/i.test(a.params.surgeKey);
              return { surgeKey: a.params.surgeKey, isAccSurge: isAcc };
            });
          const hadNonAccAlt = altSurges.some(a => !a.isAccSurge);
          auditSurgeEvents.push({
            isAccSurge,
            surgeKey: action.params.surgeKey,
            distance: needed,
            rolledAcc,
            bonusAcc,
            surgeAccSoFar,
            totalAccBefore,
            alreadyEnough: totalAccBefore >= needed,
            accGain,
            excess,
            hadNonAccAlt,
            altCount: altSurges.length,
          });
        }
      } catch { /* best-effort */ }
    }

    // ── Audit: snapshot figure counts before action for defeat tracking ────
    const preP1fc = auditMode ? Object.keys(g.figurePositions?.[1] || {}).length : 0;
    const preP2fc = auditMode ? Object.keys(g.figurePositions?.[2] || {}).length : 0;

    try {
      await harness.submitAction(action.customId, userId);
      tracer.afterAction(harness.getGame(), action);
    } catch {
      tracer.afterAction(harness.getGame(), action);
    }

    // ── Audit: detect defeats by figure count delta ───────────────────────
    // figureKey format: "dcName-dgIndex-figureIndex" — dcName may contain hyphens,
    // so strip the last two segments to recover it.
    if (auditMode) {
      const postG = harness.getGame();
      const postP1fc = Object.keys(postG.figurePositions?.[1] || {}).length;
      const postP2fc = Object.keys(postG.figurePositions?.[2] || {}).length;
      const extractDcName = (fk) => fk.replace(/-\d+-\d+$/, '');
      if (postP1fc < preP1fc) {
        for (const [fk] of Object.entries(g.figurePositions?.[1] || {})) {
          if (!postG.figurePositions?.[1]?.[fk]) {
            const dcN = extractDcName(fk);
            auditDcDefeats[dcN] = (auditDcDefeats[dcN] || 0) + 1;
          }
        }
      }
      if (postP2fc < preP2fc) {
        for (const [fk] of Object.entries(g.figurePositions?.[2] || {})) {
          if (!postG.figurePositions?.[2]?.[fk]) {
            const dcN = extractDcName(fk);
            auditDcDefeats[dcN] = (auditDcDefeats[dcN] || 0) + 1;
          }
        }
      }
    }

    // ── Figure defeat tracking ─────────────────────────────────────────────
    const curG = harness.getGame();
    const p1fc = Object.keys(curG.figurePositions?.[1] || {}).length;
    const p2fc = Object.keys(curG.figurePositions?.[2] || {}).length;
    if (p1fc < lastP1FigCount) figureDefeats += lastP1FigCount - p1fc;
    if (p2fc < lastP2FigCount) figureDefeats += lastP2FigCount - p2fc;
    lastP1FigCount = p1fc;
    lastP2FigCount = p2fc;
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

  // Close out final activation for per-activation attack tracking
  if (totalActivations > 0 && currentActivationHadAttack) activationsWithAttack++;

  return {
    ended: finalGame.ended || false,
    winnerId: finalGame.winnerId,
    winnerLabel,
    p1Army: p1Deck.name,
    p2Army: p2Deck.name,
    matchupLabel: label || `${p1Deck.name} vs ${p2Deck.name}`,
    mapId,
    p1VP: finalGame.player1VP?.total || 0,
    p2VP: finalGame.player2VP?.total || 0,
    finalRound,
    // Movement metrics
    moveActions,
    attackActions,
    endActivations,
    totalActivations,
    activationsWithAttack,
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
    // Audit instrumentation
    figureDefeats,
    // Activation-order diagnostics
    woundedActivatedEarly, woundedActivatedLate, totalWoundedActivations,
    adjKillableActivatedEarly, adjKillableActivatedLate, totalAdjKillableActivations,
    passWhenAhead, passWhenBehind, passWhenTied,
    // Turn-denial diagnostics
    turnDenialOpportunities, turnDenialChosen, turnDenialMissed,
    // Audit data
    auditDcAppearances, auditDcActivations, auditDcAttacks, auditDcDefeats,
    auditCcPlays, auditCcOpportunities, auditSurgeEvents, auditCcDecisions, auditMoveDecisions, auditAttackDecisions,
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
    console.log(`  Training mode: LOCKED matchups (${TRAINING_MATCHUPS.length} matchups, ${TRAINING_WHITELIST_DCS.size} DCs, ${TRAINING_WHITELIST_CCS.size} CCs, ${TRAINING_MAPS.length} maps)`);
  }
  if (args.includes('--audit')) {
    auditMode = true;
    console.log(`  Audit mode: ENABLED (coverage + surge-accuracy tracking)`);
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
  let cpFigureDefeats = 0; // figure defeats in checkpoint window
  // Audit: snapshot attack weights at start for delta tracking
  const attackWeightsStart = learnings.withinGroupWeights?.attack ? learnings.withinGroupWeights.attack.map(w => w) : null;
  resetWgAuditCounters();
  resetAtkAuditTotals();
  resetAtkAuditCounters();
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
      activationsWithAttack: result.activationsWithAttack || 0,
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
      // Audit
      figureDefeats: result.figureDefeats || 0,
      // Activation-order diagnostics
      woundedActivatedEarly: result.woundedActivatedEarly || 0,
      woundedActivatedLate: result.woundedActivatedLate || 0,
      totalWoundedActivations: result.totalWoundedActivations || 0,
      adjKillableActivatedEarly: result.adjKillableActivatedEarly || 0,
      adjKillableActivatedLate: result.adjKillableActivatedLate || 0,
      totalAdjKillableActivations: result.totalAdjKillableActivations || 0,
      passWhenAhead: result.passWhenAhead || 0,
      passWhenBehind: result.passWhenBehind || 0,
      passWhenTied: result.passWhenTied || 0,
      turnDenialOpportunities: result.turnDenialOpportunities || 0,
      turnDenialChosen: result.turnDenialChosen || 0,
      turnDenialMissed: result.turnDenialMissed || 0,
      // Audit data (only populated with --audit)
      auditDcAppearances: result.auditDcAppearances || {},
      auditDcActivations: result.auditDcActivations || {},
      auditDcAttacks: result.auditDcAttacks || {},
      auditDcDefeats: result.auditDcDefeats || {},
      auditCcPlays: result.auditCcPlays || {},
      auditCcOpportunities: result.auditCcOpportunities || {},
      auditSurgeEvents: result.auditSurgeEvents || [],
      auditCcDecisions: result.auditCcDecisions || [],
      auditMoveDecisions: result.auditMoveDecisions || [],
      auditAttackDecisions: result.auditAttackDecisions || [],
      matchupLabel: result.matchupLabel || 'unknown',
      mapId: result.mapId || 'unknown',
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
    cpFigureDefeats += result.figureDefeats || 0;
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
      // ── Audit Assertions ──────────────────────────────────────────────────
      const wgAudit = getWgAuditCounters();
      const atkW = learnings.withinGroupWeights?.attack;
      const atkWeightMoved = atkW && attackWeightsStart
        ? atkW.some((w, idx) => Math.abs(w - attackWeightsStart[idx]) > 1e-8)
        : false;
      const atkWeightDelta = atkW && attackWeightsStart
        ? atkW.map((w, idx) => w - attackWeightsStart[idx])
        : null;
      const replayBuf = learnings.replayBuffer;
      const replayFresh = replayBuf ? replayBuf.transitions.length > 0 : false;
      const assertions = {
        'ATTACK-FEAT-NONZERO': wgAudit.attackEntries > 0,
        'ATTACK-WEIGHT-MOVED': atkWeightMoved,
        'SURGE-FEAT-NONZERO':  wgAudit.surgeEntries > 0,
        'MOVE-FEAT-NONZERO':   wgAudit.moveEntries > 0,
        'REWARD-VP-FLOW':      cpVP > 0,
        'REWARD-DMG-FLOW':     cpFigureDefeats > 0,
        'REPLAY-FRESH':        replayFresh,
        'WG-UPDATE-FIRES':     wgAudit.attackUpdates > 0,
        'MOVE-CONTRASTIVE':    wgAudit.moveUpdates > 0,
      };
      const passCount = Object.values(assertions).filter(Boolean).length;
      const totalAssertions = Object.keys(assertions).length;
      console.log(`\n  ── AUDIT ASSERTIONS: ${passCount}/${totalAssertions} PASS ──`);
      for (const [name, pass] of Object.entries(assertions)) {
        console.log(`    ${pass ? 'PASS' : 'FAIL'} ${name}`);
      }
      console.log(`  WG counters: atk_entries=${wgAudit.attackEntries} atk_updates=${wgAudit.attackUpdates} move_entries=${wgAudit.moveEntries} move_updates=${wgAudit.moveUpdates} surge_entries=${wgAudit.surgeEntries} surge_updates=${wgAudit.surgeUpdates}`);
      console.log(`  Figure defeats this window: ${cpFigureDefeats}`);
      if (atkWeightDelta) console.log(`  Attack weight delta: [${atkWeightDelta.map(d => d.toFixed(4)).join(', ')}]`);

      // ── Attack Target Quality Audit ─────────────────────────────────────
      const atkAudit = getAtkAuditCounters();
      if (atkAudit.totalDecisions > 0) {
        const multiPct = ((atkAudit.multiTargetDecisions / atkAudit.totalDecisions) * 100).toFixed(1);
        const avgTargets = (atkAudit.totalTargets / atkAudit.totalDecisions).toFixed(1);
        const avgChosenHp = (atkAudit.chosenHpSum / atkAudit.totalDecisions).toFixed(1);
        const avgAltHp = atkAudit.multiTargetDecisions > 0 ? (atkAudit.altHpSum / atkAudit.multiTargetDecisions).toFixed(1) : 'n/a';
        const reliablePct = ((atkAudit.reliableHits / atkAudit.totalDecisions) * 100).toFixed(1);
        const tdRate = atkAudit.turnDenialRelevant > 0 ? ((atkAudit.turnDenialChosen / atkAudit.turnDenialRelevant) * 100).toFixed(1) : 'n/a';
        console.log(`\n  ── ATTACK TARGET QUALITY ──`);
        console.log(`    Total decisions: ${atkAudit.totalDecisions} (${multiPct}% multi-target, avg ${avgTargets} targets/decision)`);
        console.log(`    Avg chosen HP: ${avgChosenHp}  Avg alt HP: ${avgAltHp} (lower chosen = better focus fire)`);
        console.log(`    Hit reliability: ${reliablePct}% in-range (${atkAudit.reliableHits} reliable, ${atkAudit.marginalHits} marginal)`);
        console.log(`    Turn-denial: ${atkAudit.turnDenialRelevant} opportunities, ${tdRate}% chose unactivated`);
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
      cpFigureDefeats = 0;
      resetWgAuditCounters();
      resetAtkAuditCounters();
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
    const totalDefeats = completedGames.reduce((s, r) => s + (r.figureDefeats || 0), 0);
    console.log(`Avg figure defeats/game: ${(totalDefeats / completedGames.length).toFixed(1)}`);
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
    const cN = ['ccCost', 'isOffensive', 'inCombat', 'bias', 'isCombatTimed'];
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

    const totalActWithAtk = perGameResults.reduce((s, r) => s + r.activationsWithAttack, 0);

    console.log('\n=== Phase 2: Activation Quality ===');
    console.log(`  Avg productive actions/game: ${(totalProductive / n).toFixed(1)}`);
    console.log(`  Avg productive/activation: ${totalAct > 0 ? (totalProductive / totalAct).toFixed(2) : 'N/A'}`);
    console.log(`  Activations with attack: ${totalActWithAtk}/${totalAct} (${totalAct > 0 ? (totalActWithAtk/totalAct*100).toFixed(1) : 'N/A'}%) — per-activation attack rate`);
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
    console.log(`  (per-decision rate — denominator includes move_pick_space steps; see per-activation rate above for attack frequency)`);
    if (totWithTargets > 0) {
      console.log(`  When targets IN range (${totWithTargets} decisions):`);
      console.log(`    attack: ${(totAtkInRange/totWithTargets*100).toFixed(1)}% | move: ${(totMoveInRange/totWithTargets*100).toFixed(1)}% | end: ${(totEndInRange/totWithTargets*100).toFixed(1)}%`);
    }
    if (totNoTargets > 0) {
      console.log(`  When targets NOT in range (${totNoTargets} decisions):`);
      console.log(`    move: ${(totMoveNoTgt/totNoTargets*100).toFixed(1)}% | end: ${(totEndNoTgt/totNoTargets*100).toFixed(1)}%`);
    }

    // Activation-order diagnostics
    const totWoundedEarly = perGameResults.reduce((s, r) => s + r.woundedActivatedEarly, 0);
    const totWoundedLate = perGameResults.reduce((s, r) => s + r.woundedActivatedLate, 0);
    const totWoundedAct = perGameResults.reduce((s, r) => s + r.totalWoundedActivations, 0);
    const totAdjKillEarly = perGameResults.reduce((s, r) => s + r.adjKillableActivatedEarly, 0);
    const totAdjKillLate = perGameResults.reduce((s, r) => s + r.adjKillableActivatedLate, 0);
    const totAdjKillAct = perGameResults.reduce((s, r) => s + r.totalAdjKillableActivations, 0);
    const totPassAhead = perGameResults.reduce((s, r) => s + r.passWhenAhead, 0);
    const totPassBehind = perGameResults.reduce((s, r) => s + r.passWhenBehind, 0);
    const totPassTied = perGameResults.reduce((s, r) => s + r.passWhenTied, 0);
    const totPasses = totPassAhead + totPassBehind + totPassTied;

    console.log('\n=== Activation-Order Strategy ===');
    if (totWoundedAct > 0) {
      console.log(`  Wounded figures activated early: ${totWoundedEarly}/${totWoundedAct} (${(totWoundedEarly/totWoundedAct*100).toFixed(1)}%)`);
      console.log(`  Wounded figures activated late:  ${totWoundedLate}/${totWoundedAct} (${(totWoundedLate/totWoundedAct*100).toFixed(1)}%)`);
      console.log(`  (Smart play: activate wounded early to get value before they die)`);
    } else {
      console.log(`  Wounded activations: none observed`);
    }
    if (totAdjKillAct > 0) {
      console.log(`  Adj-to-killable activated early: ${totAdjKillEarly}/${totAdjKillAct} (${(totAdjKillEarly/totAdjKillAct*100).toFixed(1)}%)`);
      console.log(`  Adj-to-killable activated late:  ${totAdjKillLate}/${totAdjKillAct} (${(totAdjKillLate/totAdjKillAct*100).toFixed(1)}%)`);
      console.log(`  (Smart play: activate near killable targets early to secure the kill)`);
    } else {
      console.log(`  Adj-to-killable activations: none observed`);
    }
    if (totPasses > 0) {
      console.log(`  Pass when ahead on VP:  ${totPassAhead}/${totPasses} (${(totPassAhead/totPasses*100).toFixed(1)}%)`);
      console.log(`  Pass when behind on VP: ${totPassBehind}/${totPasses} (${(totPassBehind/totPasses*100).toFixed(1)}%)`);
      console.log(`  Pass when tied on VP:   ${totPassTied}/${totPasses} (${(totPassTied/totPasses*100).toFixed(1)}%)`);
      console.log(`  (Smart play: pass more when ahead to force opponent to commit first)`);
    } else {
      console.log(`  Pass activations: none observed`);
    }

    // Turn-denial diagnostics (Candidate B)
    const totTdOpp = perGameResults.reduce((s, r) => s + r.turnDenialOpportunities, 0);
    const totTdChosen = perGameResults.reduce((s, r) => s + r.turnDenialChosen, 0);
    const totTdMissed = perGameResults.reduce((s, r) => s + r.turnDenialMissed, 0);
    console.log('\n=== Turn-Denial Targeting (Candidate B) ===');
    if (totTdOpp > 0) {
      console.log(`  Equal-HP tiebreak opportunities: ${totTdOpp}`);
      console.log(`  Chose unactivated target (turn denial): ${totTdChosen}/${totTdOpp} (${(totTdChosen/totTdOpp*100).toFixed(1)}%)`);
      console.log(`  Chose activated target (missed denial): ${totTdMissed}/${totTdOpp} (${(totTdMissed/totTdOpp*100).toFixed(1)}%)`);
    } else {
      console.log(`  No equal-HP tiebreak situations observed`);
    }
  }

  // ── Audit report ────────────────────────────────────────────────────────────
  if (auditMode && perGameResults.length > 0) {
    // ── Curriculum coverage ──────────────────────────────────────────────────
    const matchupCounts = {}, mapCounts = {};
    for (const r of perGameResults) {
      const ml = r.matchupLabel || 'unknown';
      matchupCounts[ml] = (matchupCounts[ml] || 0) + 1;
      const mi = r.mapId || 'unknown';
      mapCounts[mi] = (mapCounts[mi] || 0) + 1;
    }
    console.log('\n══════════════════════════════════════════════════');
    console.log('  CURRICULUM COVERAGE');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Matchup distribution (${Object.keys(matchupCounts).length} matchups):`);
    for (const [ml, cnt] of Object.entries(matchupCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${ml.padEnd(40)} ${cnt}`);
    }
    console.log(`\n  Map distribution (${Object.keys(mapCounts).length} maps):`);
    for (const [mi, cnt] of Object.entries(mapCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${mi.padEnd(40)} ${cnt}`);
    }

    // Aggregate DC coverage
    const dcApp = {}, dcAct = {}, dcAtk = {}, dcDef = {};
    const ccPlays = {}, ccOps = {};
    const allSurges = [];
    for (const r of perGameResults) {
      for (const [k, v] of Object.entries(r.auditDcAppearances || {})) dcApp[k] = (dcApp[k] || 0) + v;
      for (const [k, v] of Object.entries(r.auditDcActivations || {})) dcAct[k] = (dcAct[k] || 0) + v;
      for (const [k, v] of Object.entries(r.auditDcAttacks || {})) dcAtk[k] = (dcAtk[k] || 0) + v;
      for (const [k, v] of Object.entries(r.auditDcDefeats || {})) dcDef[k] = (dcDef[k] || 0) + v;
      for (const [k, v] of Object.entries(r.auditCcPlays || {})) ccPlays[k] = (ccPlays[k] || 0) + v;
      for (const [k, v] of Object.entries(r.auditCcOpportunities || {})) ccOps[k] = (ccOps[k] || 0) + v;
      allSurges.push(...(r.auditSurgeEvents || []));
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log('  AUDIT: DC COVERAGE');
    console.log('══════════════════════════════════════════════════');
    const dcNames = [...new Set([...Object.keys(dcApp), ...Object.keys(dcAct)])].sort();
    console.log(`  Total unique DCs seen: ${dcNames.length}`);
    console.log(`  ${'DC Name'.padEnd(35)} ${'Apps'.padStart(5)} ${'Activ'.padStart(6)} ${'Atks'.padStart(6)} ${'Defs'.padStart(6)}`);
    console.log(`  ${'─'.repeat(35)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)}`);
    for (const dc of dcNames) {
      const app = dcApp[dc] || 0;
      const act = dcAct[dc] || 0;
      const atk = dcAtk[dc] || 0;
      const def = dcDef[dc] || 0;
      console.log(`  ${dc.padEnd(35)} ${String(app).padStart(5)} ${String(act).padStart(6)} ${String(atk).padStart(6)} ${String(def).padStart(6)}`);
    }
    const zeroDcAct = dcNames.filter(dc => !(dcAct[dc] > 0));
    if (zeroDcAct.length > 0) {
      console.log(`\n  ⚠ DCs with 0 activations: ${zeroDcAct.join(', ')}`);
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log('  AUDIT: CC COVERAGE');
    console.log('══════════════════════════════════════════════════');
    const ccNames = [...new Set([...Object.keys(ccPlays), ...Object.keys(ccOps)])].sort();
    console.log(`  Total unique CCs seen: ${ccNames.length}`);
    console.log(`  ${'CC Name'.padEnd(40)} ${'Plays'.padStart(6)} ${'Opps'.padStart(7)} ${'Play%'.padStart(7)}`);
    console.log(`  ${'─'.repeat(40)} ${'─'.repeat(6)} ${'─'.repeat(7)} ${'─'.repeat(7)}`);
    for (const cc of ccNames) {
      const plays = ccPlays[cc] || 0;
      const ops = ccOps[cc] || 0;
      const pct = ops > 0 ? (plays / ops * 100).toFixed(1) + '%' : 'N/A';
      console.log(`  ${cc.padEnd(40)} ${String(plays).padStart(6)} ${String(ops).padStart(7)} ${pct.padStart(7)}`);
    }
    const zeroCcPlays = ccNames.filter(cc => !(ccPlays[cc] > 0));
    if (zeroCcPlays.length > 0) {
      console.log(`\n  ⚠ CCs with 0 plays: ${zeroCcPlays.join(', ')}`);
    }

    // ── CC Quality: enhanced per-decision quality audit ────────────────
    const allCcDecisions = [];
    for (const r of perGameResults) allCcDecisions.push(...(r.auditCcDecisions || []));

    console.log('\n══════════════════════════════════════════════════');
    console.log('  AUDIT: CC PLAY QUALITY');
    console.log('══════════════════════════════════════════════════');
    const pct = (n, t) => t > 0 ? (n/t*100).toFixed(1) + '%' : 'N/A';
    console.log(`  Total CC play decisions: ${allCcDecisions.length}`);

    if (allCcDecisions.length > 0) {
      const n = allCcDecisions.length;

      // ── Broad class breakdown ────────────────────────────────────────
      const offensivePlays = allCcDecisions.filter(d => d.chosenClass === 'offensive');
      const nonOffensivePlays = allCcDecisions.filter(d => d.chosenClass === 'non-offensive');
      const inCombatPlays = allCcDecisions.filter(d => d.inCombat);
      console.log(`  Chose offensive CC: ${offensivePlays.length} (${pct(offensivePlays.length, n)})`);
      console.log(`  Chose non-offensive CC: ${nonOffensivePlays.length} (${pct(nonOffensivePlays.length, n)})`);
      console.log(`  During active combat: ${inCombatPlays.length} (${pct(inCombatPlays.length, n)})`);

      // ── Mixed-choice metric (offensive vs non-offensive) ─────────────
      const mixedChoices = allCcDecisions.filter(d => d.isMixedChoice);
      const mixedChoseOffensive = mixedChoices.filter(d => d.chosenClass === 'offensive');
      console.log(`\n  Mixed-choice opportunities (had both offensive + non-offensive):`);
      console.log(`    Total: ${mixedChoices.length}`);
      console.log(`    Chose offensive: ${mixedChoseOffensive.length} (${pct(mixedChoseOffensive.length, mixedChoices.length)})`);
      console.log(`    Chose non-offensive: ${mixedChoices.length - mixedChoseOffensive.length} (${pct(mixedChoices.length - mixedChoseOffensive.length, mixedChoices.length)})`);

      // ── Decision surface breakdown ───────────────────────────────────
      const multiOptCc = allCcDecisions.filter(d => d.optionCount > 1);
      const homoOff = multiOptCc.filter(d => d.hasOffensive && !d.hasNonOffensive);
      const homoNonOff = multiOptCc.filter(d => !d.hasOffensive && d.hasNonOffensive);
      const mixedMulti = multiOptCc.filter(d => d.isMixedChoice);
      console.log(`\n  Decision surface (optionCount > 1):`);
      console.log(`    Total multi-option CC decisions: ${multiOptCc.length}`);
      console.log(`    Homogeneous offensive only:      ${homoOff.length} (${pct(homoOff.length, multiOptCc.length)})`);
      console.log(`    Homogeneous non-offensive only:  ${homoNonOff.length} (${pct(homoNonOff.length, multiOptCc.length)})`);
      console.log(`    Mixed (feature discriminative):  ${mixedMulti.length} (${pct(mixedMulti.length, multiOptCc.length)})`);
      console.log(`    Multi-option + in-combat:        ${multiOptCc.filter(d => d.inCombat).length} (${pct(multiOptCc.filter(d => d.inCombat).length, multiOptCc.length)})`);

      // ── REFERENCE AGREEMENT (the key new metric) ─────────────────────
      const withRef = allCcDecisions.filter(d => d.refPreferred != null);
      const multiWithRef = withRef.filter(d => d.optionCount > 1);
      const multiRefMatch = multiWithRef.filter(d => d.matchesRef);
      console.log(`\n  ── REFERENCE AGREEMENT ──`);
      console.log(`  Multi-option decisions: ${multiWithRef.length}`);
      console.log(`  Matches reference: ${multiRefMatch.length}/${multiWithRef.length} (${pct(multiRefMatch.length, multiWithRef.length)})`);
      const multiRefMismatch = multiWithRef.filter(d => !d.matchesRef);
      console.log(`  Disagrees with reference: ${multiRefMismatch.length}/${multiWithRef.length} (${pct(multiRefMismatch.length, multiWithRef.length)})`);

      // Disagreement breakdown by context
      if (multiRefMismatch.length > 0) {
        const mismatchCombat = multiRefMismatch.filter(d => d.inCombat);
        const mismatchNonCombat = multiRefMismatch.filter(d => !d.inCombat);
        const mismatchMixed = multiRefMismatch.filter(d => d.isMixedChoice);
        const mismatchHomoOff = multiRefMismatch.filter(d => d.hasOffensive && !d.hasNonOffensive);
        const mismatchHomoNonOff = multiRefMismatch.filter(d => !d.hasOffensive && d.hasNonOffensive);
        console.log(`\n  Disagreement breakdown:`);
        console.log(`    During combat: ${mismatchCombat.length}  Non-combat: ${mismatchNonCombat.length}`);
        console.log(`    In mixed choices: ${mismatchMixed.length}  In homo-offensive: ${mismatchHomoOff.length}  In homo-non-offensive: ${mismatchHomoNonOff.length}`);

        // Avg reference score gap on mismatches (how costly are the errors?)
        const refGaps = multiRefMismatch.map(d => d.refPreferredScore - d.chosenRefScore);
        const avgGap = (refGaps.reduce((s, g) => s + g, 0) / refGaps.length).toFixed(1);
        const smallGap = refGaps.filter(g => g <= 3).length;
        const mediumGap = refGaps.filter(g => g > 3 && g <= 10).length;
        const largeGap = refGaps.filter(g => g > 10).length;
        console.log(`\n  Disagreement severity (ref score gap):`);
        console.log(`    Avg gap: ${avgGap}`);
        console.log(`    Small (≤3, tiebreak-level): ${smallGap} (${pct(smallGap, multiRefMismatch.length)})`);
        console.log(`    Medium (4-10, cost/class): ${mediumGap} (${pct(mediumGap, multiRefMismatch.length)})`);
        console.log(`    Large (>10, combat timing): ${largeGap} (${pct(largeGap, multiRefMismatch.length)})`);

        // Top disagreement pairs (chosen → ref-preferred)
        const pairCounts = {};
        for (const d of multiRefMismatch) {
          const key = `${d.chosenCard} → ${d.refPreferred}`;
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
        const topPairs = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
        console.log(`\n  Top disagreement pairs (scorer chose → ref preferred):`);
        for (const [pair, cnt] of topPairs) {
          console.log(`    ${pair}: ${cnt}`);
        }
      }

      // ── SAME-FEATURE-VECTOR COMPETITION ──────────────────────────────
      const sameFeatureDecisions = multiOptCc.filter(d => d.sameFeatureCount > 1);
      console.log(`\n  ── SAME-FEATURE-VECTOR COMPETITION ──`);
      console.log(`  Decisions where scorer CANNOT distinguish options: ${sameFeatureDecisions.length}/${multiOptCc.length} (${pct(sameFeatureDecisions.length, multiOptCc.length)})`);
      if (sameFeatureDecisions.length > 0) {
        const sfRefMatch = sameFeatureDecisions.filter(d => d.matchesRef);
        console.log(`  Of those, matches reference anyway (lucky pick): ${sfRefMatch.length}/${sameFeatureDecisions.length} (${pct(sfRefMatch.length, sameFeatureDecisions.length)})`);
        const sfAvgOptions = (sameFeatureDecisions.reduce((s, d) => s + d.sameFeatureCount, 0) / sameFeatureDecisions.length).toFixed(1);
        console.log(`  Avg same-feature options per decision: ${sfAvgOptions}`);

        // What cards compete in same-feature groups?
        const sfCardPairs = {};
        for (const d of sameFeatureDecisions) {
          const sameGroup = d.options.filter(o => o.cost === d.chosenCost && o.isOffensive === (d.chosenClass === 'offensive') && o.isCombatTimed === d.chosenIsCombatTimed);
          const names = sameGroup.map(o => o.name).sort().join(' vs ');
          sfCardPairs[names] = (sfCardPairs[names] || 0) + 1;
        }
        const topSfPairs = Object.entries(sfCardPairs).sort((a, b) => b[1] - a[1]).slice(0, 10);
        console.log(`\n  Top same-feature competition groups:`);
        for (const [group, cnt] of topSfPairs) {
          console.log(`    ${group}: ${cnt} decisions`);
        }
      }

      // ── PER-CARD QUALITY PROFILE ─────────────────────────────────────
      const cardProfile = {};
      for (const d of allCcDecisions) {
        if (!cardProfile[d.chosenCard]) cardProfile[d.chosenCard] = { chosen: 0, refPreferred: 0, available: 0 };
        cardProfile[d.chosenCard].chosen++;
        // Count how often each card was available and ref-preferred
        if (d.options) {
          for (const o of d.options) {
            if (!cardProfile[o.name]) cardProfile[o.name] = { chosen: 0, refPreferred: 0, available: 0 };
            cardProfile[o.name].available++;
          }
        }
        if (d.refPreferred && d.optionCount > 1) {
          if (!cardProfile[d.refPreferred]) cardProfile[d.refPreferred] = { chosen: 0, refPreferred: 0, available: 0 };
          cardProfile[d.refPreferred].refPreferred++;
        }
      }
      const profileCards = Object.entries(cardProfile)
        .filter(([, v]) => v.available > 0 || v.chosen > 0)
        .sort((a, b) => b[1].available - a[1].available);
      console.log(`\n  ── PER-CARD QUALITY PROFILE ──`);
      console.log(`  ${'Card'.padEnd(30)} ${'Chosen'.padStart(7)} ${'Avail'.padStart(7)} ${'RefPref'.padStart(8)} ${'ChRate'.padStart(7)} ${'RefRate'.padStart(8)}`);
      console.log(`  ${'─'.repeat(30)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(8)} ${'─'.repeat(7)} ${'─'.repeat(8)}`);
      for (const [card, v] of profileCards) {
        const chRate = v.available > 0 ? (v.chosen / v.available * 100).toFixed(0) + '%' : 'N/A';
        const refRate = v.available > 0 ? (v.refPreferred / v.available * 100).toFixed(0) + '%' : 'N/A';
        console.log(`  ${card.padEnd(30)} ${String(v.chosen).padStart(7)} ${String(v.available).padStart(7)} ${String(v.refPreferred).padStart(8)} ${chRate.padStart(7)} ${refRate.padStart(8)}`);
      }

      // ── CC PICK PATH ANALYSIS ──────────────────────────────────────────
      console.log(`\n  ── CC PICK PATH ANALYSIS ──`);

      // Distribution across all CC decisions
      const pathCounts = {};
      for (const d of allCcDecisions) {
        pathCounts[d.ccPickPath] = (pathCounts[d.ccPickPath] || 0) + 1;
      }
      console.log(`\n  All CC decisions by pick path:`);
      for (const [path, cnt] of Object.entries(pathCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${path.padEnd(16)} ${String(cnt).padStart(5)}  (${pct(cnt, allCcDecisions.length)})`);
      }

      // Distribution across multi-option CC decisions only
      const multiOptAll = allCcDecisions.filter(d => d.optionCount > 1);
      const multiPathCounts = {};
      for (const d of multiOptAll) {
        multiPathCounts[d.ccPickPath] = (multiPathCounts[d.ccPickPath] || 0) + 1;
      }
      console.log(`\n  Multi-option CC decisions by pick path:`);
      for (const [path, cnt] of Object.entries(multiPathCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${path.padEnd(16)} ${String(cnt).padStart(5)}  (${pct(cnt, multiOptAll.length)})`);
      }

      // Reference agreement by path
      console.log(`\n  Reference agreement by pick path (multi-option only):`);
      const paths = Object.keys(multiPathCounts).sort();
      console.log(`  ${'Path'.padEnd(16)} ${'Total'.padStart(6)} ${'Match'.padStart(6)} ${'Agree%'.padStart(8)} ${'SameFV'.padStart(7)} ${'SFV%'.padStart(7)}`);
      console.log(`  ${'─'.repeat(16)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(7)} ${'─'.repeat(7)}`);
      for (const path of paths) {
        const pathDecs = multiOptAll.filter(d => d.ccPickPath === path);
        const pathMatch = pathDecs.filter(d => d.matchesRef).length;
        const pathSFV = pathDecs.filter(d => d.sameFeatureCount > 1).length;
        console.log(`  ${path.padEnd(16)} ${String(pathDecs.length).padStart(6)} ${String(pathMatch).padStart(6)} ${pct(pathMatch, pathDecs.length).padStart(8)} ${String(pathSFV).padStart(7)} ${pct(pathSFV, pathDecs.length).padStart(7)}`);
      }

      // Focus anomaly decomposition by path
      const focusDecisions = multiOptAll.filter(d => d.hasFocusOption);
      const focusRefPreferred = focusDecisions.filter(d => d.refPreferred === 'Focus');
      console.log(`\n  ── FOCUS ANOMALY DECOMPOSITION ──`);
      console.log(`  Multi-option decisions with Focus available: ${focusDecisions.length}`);
      console.log(`  Decisions where Focus is reference-preferred: ${focusRefPreferred.length}`);

      if (focusRefPreferred.length > 0) {
        const focusRefWon = focusRefPreferred.filter(d => d.matchesRef);
        const focusRefLost = focusRefPreferred.filter(d => !d.matchesRef);
        console.log(`  Focus ref-preferred AND chosen (correct): ${focusRefWon.length} (${pct(focusRefWon.length, focusRefPreferred.length)})`);
        console.log(`  Focus ref-preferred but NOT chosen (loss): ${focusRefLost.length} (${pct(focusRefLost.length, focusRefPreferred.length)})`);

        if (focusRefLost.length > 0) {
          console.log(`\n  Focus losses by pick path:`);
          const focusLossPath = {};
          for (const d of focusRefLost) {
            focusLossPath[d.ccPickPath] = (focusLossPath[d.ccPickPath] || 0) + 1;
          }
          for (const [path, cnt] of Object.entries(focusLossPath).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${path.padEnd(16)} ${cnt} losses`);
          }

          // What was chosen instead of Focus, by path
          console.log(`\n  What was chosen instead of Focus (by path):`);
          for (const d of focusRefLost) {
            console.log(`    [${d.ccPickPath}] chose ${d.chosenCard} over Focus (${d.optionCount} options, combat=${d.inCombat})`);
          }
        }
      }

      // Decisions where Focus is available but NOT ref-preferred (another card is better)
      const focusAvailNotRef = focusDecisions.filter(d => d.refPreferred !== 'Focus');
      if (focusAvailNotRef.length > 0) {
        console.log(`\n  Decisions where Focus is available but NOT ref-preferred: ${focusAvailNotRef.length}`);
        const focusPickedAnyway = focusAvailNotRef.filter(d => d.chosenCard === 'Focus');
        console.log(`  Of those, Focus was picked anyway (over-selection): ${focusPickedAnyway.length} (${pct(focusPickedAnyway.length, focusAvailNotRef.length)})`);
        if (focusPickedAnyway.length > 0) {
          console.log(`\n  Focus over-selection by pick path:`);
          const overSelPath = {};
          for (const d of focusPickedAnyway) {
            overSelPath[d.ccPickPath] = (overSelPath[d.ccPickPath] || 0) + 1;
          }
          for (const [path, cnt] of Object.entries(overSelPath).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${path.padEnd(16)} ${cnt} over-selections (ref wanted: ${focusPickedAnyway.filter(d => d.ccPickPath === path).map(d => d.refPreferred).join(', ')})`);
          }
        }
      }
    }

    // ── Attack Target Quality Audit (enhanced, per-decision) ────────────
    const allAtkDecisions = [];
    for (const r of perGameResults) allAtkDecisions.push(...(r.auditAttackDecisions || []));

    // Also flush module-level counters for basic stats
    resetAtkAuditCounters();
    const atkFinal = getAtkAuditTotals();

    console.log('\n══════════════════════════════════════════════════');
    console.log('  AUDIT: ATTACK TARGET QUALITY');
    console.log('══════════════════════════════════════════════════');

    if (allAtkDecisions.length > 0) {
      const n = allAtkDecisions.length;
      const multi = allAtkDecisions.filter(d => d.targetCount > 1);
      const multiPct = ((multi.length / n) * 100).toFixed(1);
      const avgTargets = (allAtkDecisions.reduce((s, d) => s + d.targetCount, 0) / n).toFixed(1);

      console.log(`  Total attack decisions (with target data): ${n}`);
      console.log(`  Multi-target decisions: ${multi.length}/${n} (${multiPct}%)`);
      console.log(`  Avg targets per decision: ${avgTargets}`);

      // ── Focus-fire analysis ─────────────────────────────────────────────
      const lowestHpAlways = allAtkDecisions.filter(d => d.chosenIsLowestHp).length;
      console.log(`\n  Focus-fire discipline:`);
      console.log(`    Chose lowest-HP target: ${lowestHpAlways}/${n} (${((lowestHpAlways / n) * 100).toFixed(1)}%)`);

      // HP bucket distribution of chosen targets
      const hpBuckets = { '1-3': 0, '4-6': 0, '7-10': 0, '11-15': 0, '16+': 0 };
      for (const d of allAtkDecisions) {
        if (d.chosenHp <= 3) hpBuckets['1-3']++;
        else if (d.chosenHp <= 6) hpBuckets['4-6']++;
        else if (d.chosenHp <= 10) hpBuckets['7-10']++;
        else if (d.chosenHp <= 15) hpBuckets['11-15']++;
        else hpBuckets['16+']++;
      }
      console.log(`    Chosen target HP distribution:`);
      for (const [bucket, cnt] of Object.entries(hpBuckets)) {
        if (cnt > 0) console.log(`      HP ${bucket}: ${cnt} (${((cnt / n) * 100).toFixed(1)}%)`);
      }

      // Already-damaged analysis
      const damaged = allAtkDecisions.filter(d => d.chosenDamaged).length;
      console.log(`    Attacking already-damaged target: ${damaged}/${n} (${((damaged / n) * 100).toFixed(1)}%)`);

      // ── Multi-target HP gap analysis ────────────────────────────────────
      if (multi.length > 0) {
        const avgGap = (multi.reduce((s, d) => s + d.hpGapToSecond, 0) / multi.length).toFixed(1);
        const gapBuckets = { '0 (tied)': 0, '1-2': 0, '3-5': 0, '6-10': 0, '11+': 0 };
        for (const d of multi) {
          const g = d.hpGapToSecond;
          if (g === 0) gapBuckets['0 (tied)']++;
          else if (g <= 2) gapBuckets['1-2']++;
          else if (g <= 5) gapBuckets['3-5']++;
          else if (g <= 10) gapBuckets['6-10']++;
          else gapBuckets['11+']++;
        }
        console.log(`\n  HP gap analysis (multi-target only, ${multi.length} decisions):`);
        console.log(`    Avg HP gap (chosen vs 2nd-best): ${avgGap}`);
        console.log(`    Gap distribution:`);
        for (const [bucket, cnt] of Object.entries(gapBuckets)) {
          if (cnt > 0) console.log(`      ${bucket} HP: ${cnt} (${((cnt / multi.length) * 100).toFixed(1)}%)`);
        }
      }

      // ── Turn-denial tradeoff analysis (the key question) ───────────────
      const tradeoffs = allAtkDecisions.filter(d => d.turnDenialTradeoff != null);
      const unactivatedAvail = allAtkDecisions.filter(d => d.unactivatedCount > 0);
      console.log(`\n  Turn-denial analysis:`);
      console.log(`    Decisions with unactivated targets available: ${unactivatedAvail.length}/${n} (${((unactivatedAvail.length / n) * 100).toFixed(1)}%)`);
      console.log(`    Chosen target was unactivated: ${allAtkDecisions.filter(d => !d.chosenActivated).length}/${n}`);

      if (tradeoffs.length > 0) {
        const avgHpCost = (tradeoffs.reduce((s, d) => s + d.turnDenialTradeoff.hpCost, 0) / tradeoffs.length).toFixed(1);
        console.log(`\n  FOCUS-FIRE vs TURN-DENIAL TRADEOFFS:`);
        console.log(`    Cases where focus-fire chose an ACTIVATED target over`);
        console.log(`    a close-HP UNACTIVATED target (within 2x HP): ${tradeoffs.length}`);
        console.log(`    Avg HP cost of switching to unactivated: ${avgHpCost}`);
        const costBuckets = { '1-2': 0, '3-5': 0, '6-10': 0, '11+': 0 };
        for (const d of tradeoffs) {
          const c = d.turnDenialTradeoff.hpCost;
          if (c <= 2) costBuckets['1-2']++;
          else if (c <= 5) costBuckets['3-5']++;
          else if (c <= 10) costBuckets['6-10']++;
          else costBuckets['11+']++;
        }
        console.log(`    HP cost distribution:`);
        for (const [bucket, cnt] of Object.entries(costBuckets)) {
          if (cnt > 0) console.log(`      ${bucket} HP: ${cnt}`);
        }
        console.log(`    (These are potential training opportunities — cases where`);
        console.log(`     denying a turn might be worth the HP cost)`);
      } else {
        console.log(`    Focus-fire vs turn-denial tradeoffs: 0 (focus-fire target was always unactivated or no close-HP alternative)`);
      }

      // ── Kill efficiency (from per-game data) ───────────────────────────
      const totalAtks = perGameResults.reduce((s, r) => s + r.attackActions, 0);
      const totalKills = perGameResults.reduce((s, r) => s + r.figureDefeats, 0);
      if (totalAtks > 0) {
        console.log(`\n  Kill efficiency:`);
        console.log(`    Total attacks: ${totalAtks}  Total figure defeats: ${totalKills}`);
        console.log(`    Attacks per kill: ${(totalAtks / Math.max(totalKills, 1)).toFixed(1)}`);
        console.log(`    Kill rate: ${((totalKills / totalAtks) * 100).toFixed(1)}% of attacks result in a defeat`);

        // Per-game damage spread: how many unique DCs attacked per game
        const spreads = perGameResults.map(r => {
          const dcs = Object.keys(r.auditDcAttacks || {});
          return dcs.length;
        }).filter(s => s > 0);
        if (spreads.length > 0) {
          const avgSpread = (spreads.reduce((s, v) => s + v, 0) / spreads.length).toFixed(1);
          console.log(`    Avg unique DCs attacked per game: ${avgSpread} (lower = more focused)`);
        }
      }
    } else if (atkFinal.totalDecisions > 0) {
      // Fallback to module-level counters if per-decision data not available
      console.log(`  Total attack target decisions: ${atkFinal.totalDecisions} (module-level counters only)`);
      console.log(`  Multi-target: ${atkFinal.multiTargetDecisions}/${atkFinal.totalDecisions}`);
      console.log(`  Hit reliability: ${((atkFinal.reliableHits / atkFinal.totalDecisions) * 100).toFixed(1)}%`);
    } else {
      console.log('  No attack target decisions recorded.');
    }

    // ── Move Quality Audit ──────────────────────────────────────────────
    const allMoveDecisions = [];
    for (const r of perGameResults) allMoveDecisions.push(...(r.auditMoveDecisions || []));

    console.log('\n══════════════════════════════════════════════════');
    console.log('  AUDIT: MOVE DESTINATION QUALITY');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Total scored move decisions: ${allMoveDecisions.length}`);
    if (allMoveDecisions.length > 0) {
      const avgCandidates = (allMoveDecisions.reduce((s, d) => s + d.candidateCount, 0) / allMoveDecisions.length).toFixed(1);
      console.log(`  Avg candidate hexes/decision: ${avgCandidates}`);

      // Quality-gap distribution
      const gaps = allMoveDecisions.map(d => d.gap);
      const nearZero = gaps.filter(g => g < 0.01);
      const small = gaps.filter(g => g >= 0.01 && g < 0.05);
      const moderate = gaps.filter(g => g >= 0.05 && g < 0.15);
      const large = gaps.filter(g => g >= 0.15);
      const optimal = allMoveDecisions.filter(d => d.gap < 0.001);
      const fp = (n, t) => t > 0 ? (n/t*100).toFixed(1) + '%' : 'N/A';
      console.log(`  Chose reference-optimal destination: ${optimal.length}/${allMoveDecisions.length} (${fp(optimal.length, allMoveDecisions.length)})`);
      console.log(`\n  Quality-gap distribution (gap = refBest - chosen):`);
      console.log(`    Near-zero (<0.01):  ${nearZero.length} (${fp(nearZero.length, allMoveDecisions.length)})`);
      console.log(`    Small (0.01-0.05):  ${small.length} (${fp(small.length, allMoveDecisions.length)})`);
      console.log(`    Moderate (0.05-0.15): ${moderate.length} (${fp(moderate.length, allMoveDecisions.length)})`);
      console.log(`    Large (>0.15):      ${large.length} (${fp(large.length, allMoveDecisions.length)})`);
      const avgGap = (gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(4);
      const maxGap = Math.max(...gaps).toFixed(4);
      console.log(`  Avg gap: ${avgGap}  Max gap: ${maxGap}`);

      // Per-feature gap breakdown (only for suboptimal moves with features available)
      const suboptimal = allMoveDecisions.filter(d => d.gap >= 0.01 && d.chosenFeatures && d.refBestFeatures);
      if (suboptimal.length > 0) {
        const featureNames = ['distToNearestEnemy', 'threatAtDest', 'objectiveProximity', 'allySupport', 'mpEfficiency', 'bias', 'destInEnemyRange', 'destOnObjective', 'destAdjacentToAlly'];
        const qualityW = [0.40, -0.15, 0.25, 0.10, 0.10, 0.0, -0.15, 0.30, 0.15];
        console.log(`\n  Per-feature gap breakdown (${suboptimal.length} suboptimal moves):`);
        console.log(`  ${'Feature'.padEnd(22)} ${'AvgChosen'.padStart(10)} ${'AvgRefBest'.padStart(10)} ${'AvgDiff'.padStart(10)} ${'QualW'.padStart(7)} ${'WtdGap'.padStart(10)}`);
        console.log(`  ${'─'.repeat(22)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(7)} ${'─'.repeat(10)}`);
        for (let i = 0; i < 9; i++) {
          const avgChosen = suboptimal.reduce((s, d) => s + (d.chosenFeatures[i] || 0), 0) / suboptimal.length;
          const avgBest = suboptimal.reduce((s, d) => s + (d.refBestFeatures[i] || 0), 0) / suboptimal.length;
          const diff = avgBest - avgChosen;
          const wtdGap = diff * qualityW[i];
          console.log(`  ${featureNames[i].padEnd(22)} ${avgChosen.toFixed(4).padStart(10)} ${avgBest.toFixed(4).padStart(10)} ${(diff >= 0 ? '+' : '') + diff.toFixed(4).padStart(9)} ${qualityW[i].toFixed(2).padStart(7)} ${(wtdGap >= 0 ? '+' : '') + wtdGap.toFixed(4).padStart(9)}`);
        }
        // Which features contribute most to the gap
        const contributions = featureNames.map((name, i) => {
          const diff = suboptimal.reduce((s, d) => s + ((d.refBestFeatures[i] || 0) - (d.chosenFeatures[i] || 0)), 0) / suboptimal.length;
          return { name, contribution: Math.abs(diff * qualityW[i]) };
        });
        contributions.sort((a, b) => b.contribution - a.contribution);
        console.log(`\n  Top gap contributors (|weighted diff|):`);
        for (const c of contributions.slice(0, 5)) {
          console.log(`    ${c.name}: ${c.contribution.toFixed(4)}`);
        }
      }
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log('  AUDIT: SURGE-ACCURACY');
    console.log('══════════════════════════════════════════════════');
    const accSurges = allSurges.filter(s => s.isAccSurge);
    const nonAccSurges = allSurges.filter(s => !s.isAccSurge);
    const accNeeded = accSurges.filter(s => !s.alreadyEnough);
    const accWasted = accSurges.filter(s => s.alreadyEnough);
    console.log(`  Total ranged surge decisions: ${allSurges.length}`);
    console.log(`  Accuracy surges spent: ${accSurges.length}`);
    console.log(`  Non-accuracy surges spent: ${nonAccSurges.length}`);
    console.log(`  Accuracy spent when NEEDED: ${accNeeded.length}/${accSurges.length} (${accSurges.length > 0 ? (accNeeded.length/accSurges.length*100).toFixed(1) : 'N/A'}%)`);
    console.log(`  Accuracy spent when WASTED: ${accWasted.length}/${accSurges.length} (${accSurges.length > 0 ? (accWasted.length/accSurges.length*100).toFixed(1) : 'N/A'}%)`);
    if (accWasted.length > 0) {
      console.log(`\n  Examples of accuracy waste (up to 10):`);
      for (const s of accWasted.slice(0, 10)) {
        console.log(`    dist=${s.distance} rolled=${s.rolledAcc} bonus=${s.bonusAcc} surgeAcc=${s.surgeAccSoFar} total=${s.totalAccBefore} (needed ${s.distance}) → spent "${s.surgeKey}" (+${s.accGain} acc, excess=${s.totalAccBefore - s.distance})`);
      }
    }
    if (accNeeded.length > 0) {
      console.log(`\n  Examples of accuracy correctly spent (up to 5):`);
      for (const s of accNeeded.slice(0, 5)) {
        console.log(`    dist=${s.distance} rolled=${s.rolledAcc} bonus=${s.bonusAcc} surgeAcc=${s.surgeAccSoFar} total=${s.totalAccBefore} (needed ${s.distance}) → spent "${s.surgeKey}" (+${s.accGain} acc, deficit=${s.distance - s.totalAccBefore})`);
      }
    }

    // ── Residual-waste breakdown ──────────────────────────────────────────
    if (accWasted.length > 0) {
      console.log('\n══════════════════════════════════════════════════');
      console.log('  RESIDUAL-WASTE BREAKDOWN');
      console.log('══════════════════════════════════════════════════');

      // Distance buckets
      const buckets = { '1': [], '2-3': [], '4-5': [], '6+': [] };
      for (const s of accWasted) {
        if (s.distance <= 1) buckets['1'].push(s);
        else if (s.distance <= 3) buckets['2-3'].push(s);
        else if (s.distance <= 5) buckets['4-5'].push(s);
        else buckets['6+'].push(s);
      }
      console.log('\n  By distance bucket:');
      for (const [bucket, items] of Object.entries(buckets)) {
        const pct = accWasted.length > 0 ? (items.length / accWasted.length * 100).toFixed(1) : '0.0';
        console.log(`    dist=${bucket}: ${items.length}/${accWasted.length} (${pct}% of waste)`);
      }

      // Overkill severity: excess accuracy after surge
      const tinyOverkill = accWasted.filter(s => (s.excess || 0) <= 2);
      const midOverkill = accWasted.filter(s => (s.excess || 0) >= 3 && (s.excess || 0) <= 4);
      const majorOverkill = accWasted.filter(s => (s.excess || 0) >= 5);
      console.log('\n  Overkill severity (pre-surge excess over distance):');
      console.log(`    Tiny (excess 0-2):  ${tinyOverkill.length}/${accWasted.length} (${(tinyOverkill.length/accWasted.length*100).toFixed(1)}%)`);
      console.log(`    Mid (excess 3-4):   ${midOverkill.length}/${accWasted.length} (${(midOverkill.length/accWasted.length*100).toFixed(1)}%)`);
      console.log(`    Major (excess 5+):  ${majorOverkill.length}/${accWasted.length} (${(majorOverkill.length/accWasted.length*100).toFixed(1)}%)`);

      // Shot guaranteed before surge? (totalAccBefore already >= distance)
      const guaranteedBefore = accWasted.filter(s => s.totalAccBefore >= s.distance);
      const notGuaranteed = accWasted.filter(s => s.totalAccBefore < s.distance);
      console.log('\n  Shot already guaranteed before this surge?');
      console.log(`    Yes (already hit): ${guaranteedBefore.length}/${accWasted.length} (${(guaranteedBefore.length/accWasted.length*100).toFixed(1)}%)`);
      console.log(`    No (still short):  ${notGuaranteed.length}/${accWasted.length} (${(notGuaranteed.length/accWasted.length*100).toFixed(1)}%)`);

      // Non-accuracy alternative existed?
      const withAlt = accWasted.filter(s => s.hadNonAccAlt);
      const noAlt = accWasted.filter(s => !s.hadNonAccAlt);
      console.log('\n  Non-accuracy surge alternative existed?');
      console.log(`    Yes (had damage/other option): ${withAlt.length}/${accWasted.length} (${(withAlt.length/accWasted.length*100).toFixed(1)}%)`);
      console.log(`    No (accuracy was only option):  ${noAlt.length}/${accWasted.length} (${(noAlt.length/accWasted.length*100).toFixed(1)}%)`);

      // Classification summary
      const structuralNoise = accWasted.filter(s => !s.hadNonAccAlt);
      const scorerMistake = accWasted.filter(s => s.hadNonAccAlt && s.totalAccBefore >= s.distance);
      const edgeCase = accWasted.filter(s => s.hadNonAccAlt && s.totalAccBefore < s.distance);
      console.log('\n  Classification:');
      console.log(`    A) Structural noise (no alternative):   ${structuralNoise.length}/${accWasted.length} (${(structuralNoise.length/accWasted.length*100).toFixed(1)}%)`);
      console.log(`    B) Scorer mistake (had alt, was safe):  ${scorerMistake.length}/${accWasted.length} (${(scorerMistake.length/accWasted.length*100).toFixed(1)}%)`);
      console.log(`    C) Edge case (had alt, wasn't safe):    ${edgeCase.length}/${accWasted.length} (${(edgeCase.length/accWasted.length*100).toFixed(1)}%)`);
    }
  }

  console.log(`\nLearnings saved to ${savePath}`);
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
