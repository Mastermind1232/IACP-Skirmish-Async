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
 *   node tests/headless/train.js 200 --mixed           # 80% fixed + 20% pool diversity pilot
 *   node tests/headless/train.js 200 --mixed --pool-ratio=0.3  # Custom pool ratio
 *   node tests/headless/train.js 500 --mixed --pool-ratio=0.4 --balanced  # Tier-matched pool
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { setKryknaPlacementMode, getKryknaPlacementMode } from '../../src/ai/self-play.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects, getCcEffect } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord, normalizeCoord } from '../../src/game/coords.js';
import { getValidKryknaPlacementSpaces } from '../../src/game/mission-rules.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import {
  loadLearnings, saveLearnings, createGameTracer,
  pickSmartAction, abstractActionType, getLearningsStats,
  recordMatchResult, replayUpdate, loadReplayBuffer, saveReplayBuffer,
  recordTrainingCheckpoint, checkDivergence, setWeightDecay, setAlpha, setWgFrozen, setAttackTrace, getEffectiveAlpha, getQValues,
  extractFeatures, setEncoderType, getEncoderType, setWgWeightClamp, setMoveDecisionBonus,
  setMoveQualitySignalFlag, setBoundaryFix, setUseMcReturns,
  getWgAuditCounters, resetWgAuditCounters,
  getAtkAuditCounters, resetAtkAuditCounters, getAtkAuditTotals, resetAtkAuditTotals,
  getCandAudit, resetCandAudit,
  getPremEndAudit, recordPremEnd, resetPremEndAudit,
  getPremEndFrames, recordPremEndFrame, resetPremEndFrames,
  getObjectiveCoords,
  getActOrderAudit, resetActOrderAudit,
  getActShadow, resetActShadow,
  getActOutcome, resetActOutcome,
  markActivationStart, recordActivationAction, finalizeActivationOutcome,
  getDiagTrace, resetDiagTrace,
  setActivateScorerControl,
  OFFENSIVE_CC_TIMINGS,
  COMBAT_CC_TIMINGS,
  ABSTRACT_TYPES,
  extractPassFeatures,
  passTimingShadowEval,
  getPassShadow,
  resetPassShadow,
  PASS_FEATURE_NAMES,
  getAbilityGateAudit, resetAbilityGateAudit,
  getDecisionClassAudit, resetDecisionClassAudit,
} from './learnings.js';
import { buildGraph, graphForwardPass, setAttentionPool, setRichEdges, setMoveQualitySignal } from './graph-encoder.js';
import { unlinkSync } from 'fs';
import { TRAINING_MATCHUPS, TRAINING_WHITELIST_DCS, TRAINING_WHITELIST_CCS, TRAINING_MAPS } from '../../src/ai/training-config.js';
import { assertPreActionInvariants, assertPostActionInvariants, snapshotPreAction } from './rules-invariants.js';
import { distToNearestEnemy } from './analyzer-helpers.js';

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
let mapOverride = null; // --map=<id> locks all games to a single map
let useMixedCurriculum = false; // --mixed: majority fixed, minority pool
let passAbMode = false; // --passab: shadow scorer takes control on pass-legal surface (treatment arm)
let _passAbTreatment = false; // per-game: true = treatment (shadow controls), false = control (DQN controls)
let moveAuditMode = false; // --move-audit: detailed move destination quality diagnostic
let premendProbe = false;  // --premend-probe: rich per-frame capture at premature dc_end_activation
let abilityAudit = false;  // --ability-audit: capture every dc_special play with context for post-fix ability-selection audit
const _abilityPlays = [];
let poolRatio = 0.2; // fraction of games that are random-pool matchups
let useBalancedPool = false; // --balanced: tier-matched pool pairing instead of random

// Deck strength tiers derived from 500-game 60/40 transfer test (learnings-transfer-test.json).
// Pairs within-tier or adjacent-tier to avoid lopsided blowouts.
const DECK_TIERS = {
  strong: ['Assassin Trio', 'Double Lammy', 'SelfAug_MercDroid', 'Imperial Doctrine',
    'Sith Lords', '9act_tokens_HeavyWeapon', 'ATRT_Brawler', 'Jedi_Mara_Saska',
    'RogueOne_2026', 'Rebel Heroes', 'Hybrid VP 8act', 'Imperial_Hunter_Brawler',
    'Scum Raiders', 'Rebel_VP_v3', 'Rebel Swarm', 'Brawler_Bib', 'Scum Firepower',
    'Default Rebels'],
  mid: ['HK_Probes', 'Droid Coalition', 'Scum Heavies', 'Rebel Guerrillas',
    'Draft Tournament', 'Imperial_Hunter_Spies', 'Imperial_Hunters_8act',
    'Chewie Return Fire', 'Imperial Hunters', 'Rebel Alliance', 'RGC_Riots_v2',
    'Rebel Defense', 'Imperial Elite', 'Default Imperial', 'Force Council',
    '3actWampaLiA', 'Default Scum', 'Imperial Armor'],
  weak: ['Scum Muscle', 'Rebel Melee Storm', 'Imperial Line', 'Ugnaught_IG11_Paz',
    'Imperial Combined Arms', 'ATST', 'RebelTroopers_v2', 'Wookies_Luke',
    'Direct Damage', 'Sorin_Bikes_Dewbacks_Hemlock', 'Jedi Council',
    'Bodyguard Formation', 'Mortars_Flame', 'Bikes_Flames', 'VPT_5B'],
};

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
/**
 * Pick a random pool matchup: 2 different decks from the 36-deck test pool.
 * Constraints: no mirror (same deck), no shared DCs between the two decks.
 * Returns { p1Deck, p2Deck, label, isPoolGame: true }.
 */
function pickRandomPoolMatchup() {
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const i = Math.floor(Math.random() * TEST_DECKS.length);
    let j = Math.floor(Math.random() * TEST_DECKS.length);
    if (j === i) continue; // no mirror
    const a = TEST_DECKS[i];
    const b = TEST_DECKS[j];
    // No shared DCs
    const bSet = new Set(b.dcList);
    if (a.dcList.some(dc => bSet.has(dc))) continue;
    return {
      p1Deck: a, p2Deck: b,
      label: `pool:${a.name} vs ${b.name}`,
      isPoolGame: true,
    };
  }
  // Fallback: deterministic non-overlapping pair
  for (let i = 0; i < TEST_DECKS.length; i++) {
    for (let j = i + 1; j < TEST_DECKS.length; j++) {
      const bSet = new Set(TEST_DECKS[j].dcList);
      if (!TEST_DECKS[i].dcList.some(dc => bSet.has(dc))) {
        return {
          p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j],
          label: `pool:${TEST_DECKS[i].name} vs ${TEST_DECKS[j].name}`,
          isPoolGame: true,
        };
      }
    }
  }
  // Last resort: just pick two different decks
  return { p1Deck: TEST_DECKS[0], p2Deck: TEST_DECKS[1], label: 'pool:fallback', isPoolGame: true };
}

/**
 * Pick a balanced pool matchup: pair decks from same or adjacent strength tiers.
 * Tier adjacency: strong↔mid, mid↔weak. Never strong↔weak.
 * Within the tier pair, random selection with no-mirror + no-shared-DC constraints.
 */
function pickBalancedPoolMatchup() {
  const deckByName = {};
  for (const d of TEST_DECKS) deckByName[d.name] = d;

  // Build tier index for decks that exist in TEST_DECKS
  const tierDecks = { strong: [], mid: [], weak: [] };
  for (const [tier, names] of Object.entries(DECK_TIERS)) {
    for (const name of names) {
      if (deckByName[name]) tierDecks[tier].push(deckByName[name]);
    }
  }
  // Decks not in any tier go to mid
  const allTiered = new Set([...DECK_TIERS.strong, ...DECK_TIERS.mid, ...DECK_TIERS.weak]);
  for (const d of TEST_DECKS) {
    if (!allTiered.has(d.name)) tierDecks.mid.push(d);
  }

  // Pick a tier pair: same-tier (60%) or adjacent-tier (40%)
  const tierKeys = ['strong', 'mid', 'weak'];
  const adjacentPairs = [['strong', 'mid'], ['mid', 'weak']];
  let t1, t2;
  if (Math.random() < 0.6) {
    // Same tier
    const t = tierKeys[Math.floor(Math.random() * tierKeys.length)];
    t1 = t; t2 = t;
  } else {
    // Adjacent tiers
    const pair = adjacentPairs[Math.floor(Math.random() * adjacentPairs.length)];
    t1 = pair[0]; t2 = pair[1];
  }

  const pool1 = tierDecks[t1];
  const pool2 = tierDecks[t2];
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const a = pool1[Math.floor(Math.random() * pool1.length)];
    const b = pool2[Math.floor(Math.random() * pool2.length)];
    if (a.name === b.name) continue;
    const bSet = new Set(b.dcList);
    if (a.dcList.some(dc => bSet.has(dc))) continue;
    const tierLabel = t1 === t2 ? t1 : `${t1}/${t2}`;
    return {
      p1Deck: a, p2Deck: b,
      label: `balanced:${a.name} vs ${b.name} [${tierLabel}]`,
      isPoolGame: true,
    };
  }
  // Fallback to random pool if balanced pairing fails
  return pickRandomPoolMatchup();
}

function pickMatchup(gameNum) {
  // Mixed curriculum: majority fixed, minority pool (balanced or random)
  if (useMixedCurriculum && useTrainingMatchups) {
    if (Math.random() < poolRatio) {
      return useBalancedPool ? pickBalancedPoolMatchup() : pickRandomPoolMatchup();
    }
    const matchup = TRAINING_MATCHUPS[gameNum % TRAINING_MATCHUPS.length];
    return { p1Deck: matchup.p1Deck, p2Deck: matchup.p2Deck, label: matchup.label, isPoolGame: false };
  }
  if (useTrainingMatchups) {
    const matchup = TRAINING_MATCHUPS[gameNum % TRAINING_MATCHUPS.length];
    return { p1Deck: matchup.p1Deck, p2Deck: matchup.p2Deck, label: matchup.label, isPoolGame: false };
  }
  const i = gameNum % TEST_DECKS.length;
  // Offset by roughly half the pool + prime step to avoid repeated pairings
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j], isPoolGame: false };
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

// distToNearestEnemy now imported from ./analyzer-helpers.js — unions opponent
// DC figures with live npcKrykna + npcThugs so Atollon / Corellian reports
// match the live ability gate's nearest-enemy view.

async function runOneGame(learnings, gameNum) {
  const { p1Deck, p2Deck, label, isPoolGame } = pickMatchup(gameNum);
  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  // Rotate maps across training set (use TRAINING_MAPS when in training mode)
  // --map= override locks to a single map for focused calibration runs.
  const mapPool = mapOverride ? [mapOverride]
    : (useTrainingMatchups && TRAINING_MAPS?.length > 0) ? TRAINING_MAPS
    : ['mos-eisley-outskirts'];
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

  // Training mode: validate whitelist (hard gate for fixed matchups, soft audit for pool games)
  if (useTrainingMatchups) {
    const wl = validateWhitelist(game);
    if (!wl.valid) {
      if (isPoolGame) {
        // Soft audit: record violations but continue
        wl.violations.forEach(v => {
          if (!learnings.whitelistAudit) learnings.whitelistAudit = { totalHits: 0, hitsByCard: {} };
          learnings.whitelistAudit.totalHits++;
          learnings.whitelistAudit.hitsByCard[v.card] = (learnings.whitelistAudit.hitsByCard[v.card] || 0) + 1;
        });
      } else {
        console.error(`❌ WHITELIST VIOLATION in game ${gameNum}:`, wl.violations);
        return { ended: false, stopReason: 'whitelist_violation', p1VP: 0, p2VP: 0 };
      }
    }
  }

  // Track unique matchup configs (diversity pilot)
  if (isPoolGame) {
    if (!learnings.uniqueConfigs) learnings.uniqueConfigs = [];
    const configKey = [p1Deck.name, p2Deck.name].sort().join(' vs ') + ` @ ${mapId}`;
    if (!learnings.uniqueConfigs.includes(configKey)) {
      learnings.uniqueConfigs.push(configKey);
      if (learnings.uniqueConfigs.length > 500) learnings.uniqueConfigs = learnings.uniqueConfigs.slice(-500);
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
  let doorOpens = 0;          // open_door interacts
  let totalActivations = 0;   // activate_dc (total activation starts)
  let passActivations = 0;    // pass_activation_turn
  let activationsWithAttack = 0;  // activations that included at least one attack_target
  let currentActivationHadAttack = false;
  let npcAttacks = 0;           // attacks targeting NPC figures (Krykna, Thugs)
  let npcDefeats = 0;           // NPC figures defeated
  let npcPushEvents = 0;        // Krykna push movements executed
  let npcEorDamageEvents = 0;   // end-of-round Krykna damage instances
  let npcRespawns = 0;          // Krykna respawned via claimed placement

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

  // ── A/B per-round VP tracking ──────────────────────────────────────────────
  const roundVP = { 1: { p1: 0, p2: 0 }, 2: { p1: 0, p2: 0 }, 3: { p1: 0, p2: 0 }, 4: { p1: 0, p2: 0 } };
  let lastRoundP1VP = 0, lastRoundP2VP = 0;
  let currentRound = 1;
  // Per-activation outcome counters (broader than the shadow-mode tracker)
  let actOutAttack = 0, actOutInteract = 0, actOutMoveOnly = 0, actOutEndOnly = 0, actOutTotal = 0;
  let currentActHadAttack = false, currentActHadInteract = false, currentActHadMove = false;
  // Per-class decision counts for this game
  let classWW = 0, classWP = 0, classPP = 0, classGated = 0;

  // ── Turn-denial diagnostics (Candidate B) ─────────────────────────────────
  // Track attacks where equal-HP targets existed and whether unactivated was preferred.
  let turnDenialOpportunities = 0;    // attacks where ≥2 targets had same HP and ≥1 was unactivated
  let turnDenialChosen = 0;           // of those, chose the unactivated target
  let turnDenialMissed = 0;           // of those, chose the activated target

  // ── Pass-timing audit ────────────────────────────────────────────────────────
  // Per-decision trace: recorded every time pass_activation_turn is legal
  const passAuditTrace = [];        // { round, actIdx, myRem, oppRem, gap, myVP, oppVP, vpDelta, chose, qPass, qActivate, qBest, bestType, activatedDc, activationOutcome, myWounded, oppUnactivated }
  let passLegalTotal = 0;           // total decisions where pass was legal
  let passChosenTotal = 0;          // total times pass was actually chosen
  let passActivatedTotal = 0;       // total times DC was activated instead of passing
  // Track activation outcome when a DC was activated instead of pass
  let _pendingPassAuditIdx = -1;    // index into passAuditTrace for pending activation outcome
  let _pendingAbilityIdx = -1;      // index into _abilityPlays awaiting post-state capture

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
  const moveAuditTrace = [];         // Move-quality diagnostic: per-decision trace with outcome linkage
  let _pendingMoveAuditIdxs = [];    // indices into moveAuditTrace awaiting activation outcome
  const auditAttackDecisions = [];  // Attack target quality audit: per-decision target analysis

  // ── Rules invariant tracking ────────────────────────────────────────────
  const rulesViolations = [];       // all violations across the game
  let handlerErrors = 0;            // count of handler exceptions (upgraded from silent catch)

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
    // Execute Krykna push + end-of-round damage (Chopper Base A)
    if (g.pendingKryknaPushQueue?.length > 0) {
      const _kMapId = g.selectedMap?.id;
      const _kRawMap = deps.getMapData?.(_kMapId) || getMapData(_kMapId);
      const _kMapDef = deps.getMapRegistry?.()?.find?.(m => m.id === _kMapId);
      const _kMapSpaces = deps.filterMapSpacesByBounds?.(_kRawMap, _kMapDef?.gridBounds) || _kRawMap;
      const _kAdj = _kMapSpaces?.adjacency || {};

      // Push each active Krykna toward nearest figure (BFS, up to 3 spaces)
      const _kActive = (g.npcKrykna || []).filter(k => !k.defeated);
      for (const krykna of _kActive) {
        const startCoord = normalizeCoord(krykna.coord);
        const allFigCoords = new Set();
        for (const pn of [1, 2]) {
          for (const coord of Object.values(g.figurePositions?.[pn] || {})) {
            allFigCoords.add(normalizeCoord(coord));
          }
        }
        if (allFigCoords.size === 0) continue;

        // BFS from Krykna to nearest figure
        const visited = new Map([[startCoord, null]]);
        const bfsQueue = [startCoord];
        let bfsTarget = null;
        while (bfsQueue.length > 0 && !bfsTarget) {
          const curr = bfsQueue.shift();
          for (const neighbor of (_kAdj[curr] || [])) {
            const n = normalizeCoord(neighbor);
            if (visited.has(n)) continue;
            visited.set(n, curr);
            if (allFigCoords.has(n)) { bfsTarget = n; break; }
            bfsQueue.push(n);
          }
        }
        if (!bfsTarget) continue;

        // Reconstruct path (spaces from start to target, excluding start)
        const path = [];
        let cur = bfsTarget;
        while (cur && cur !== startCoord) {
          path.unshift(cur);
          cur = visited.get(cur);
        }

        // Move up to 3 steps, stopping 1 space short of figure (adjacent)
        const maxSteps = Math.min(3, Math.max(0, path.length - 1));
        if (maxSteps > 0) {
          krykna.coord = path[maxSteps - 1];
          npcPushEvents++;
        }
      }

      // End-of-round damage: figures adjacent to Krykna take 2 damage
      const { damageEvents: _kDmgEvts, claimedPlacementNeeded: _kClaimed } = deps.runNpcKryknaActivation(g, _kMapId, {
        getMapTokensData: deps.getMapTokensData,
        getMapData: deps.getMapData || getMapData,
        getMapRegistry: deps.getMapRegistry,
        filterMapSpacesByBounds: deps.filterMapSpacesByBounds,
      });
      for (const { figureKey, playerNum, damage } of (_kDmgEvts || [])) {
        await deps.applyNpcDamageToFigure(g, playerNum, figureKey, damage, 'Krykna');
        npcEorDamageEvents++;
      }

      // Build claimed-Krykna placement queue if any kills happened (mirrors index.js:4123-4133)
      if (_kClaimed) {
        const _kInitNum = g.initiativePlayerId === g.player1Id ? 1 : 2;
        const _kOtherNum = _kInitNum === 1 ? 2 : 1;
        const _kQueue = [];
        if ((g.claimedKrykna?.[_kInitNum] || 0) > 0) _kQueue.push(_kInitNum);
        if ((g.claimedKrykna?.[_kOtherNum] || 0) > 0) _kQueue.push(_kOtherNum);
        if (_kQueue.length > 0) g.pendingClaimedKryknaQueue = _kQueue;
      }

      g.pendingKryknaPushQueue = null;
      g.kryknaPushedIds = null;
      continue;
    }
    // Execute claimed Krykna placement (Chopper Base A respawn)
    if (g.pendingClaimedKryknaQueue?.length > 0) {
      const _rMapId = g.selectedMap?.id;
      const _rAdj = (deps.getMapData?.(_rMapId) || getMapData(_rMapId))?.adjacency || {};
      for (const playerNum of g.pendingClaimedKryknaQueue) {
        const claimed = g.claimedKrykna?.[playerNum] || 0;
        if (claimed <= 0) continue;
        const validSpaces = getValidKryknaPlacementSpaces(g, playerNum, _rMapId);
        if (validSpaces.length === 0) continue;

        // Pick a valid space per the active KRYKNA_PLACEMENT_MODE.
        // Authored mission rule (placement must be in opponent's zone) is
        // preserved by validSpaces; we only choose WHICH valid space here.
        //   'min'    — BFS-closest to nearest enemy figure (aggressive, default)
        //   'max'    — BFS-farthest from nearest enemy figure
        //   'random' — uniform random over validSpaces
        const placeMode = getKryknaPlacementMode();
        let bestSpace = validSpaces[0];
        if (placeMode === 'random') {
          bestSpace = validSpaces[Math.floor(Math.random() * validSpaces.length)];
        } else {
          const oppNum = playerNum === 1 ? 2 : 1;
          const enemyCoords = new Set(
            Object.values(g.figurePositions?.[oppNum] || {}).map(c => normalizeCoord(c))
          );
          let bestDist = (placeMode === 'max') ? -Infinity : Infinity;
          for (const space of validSpaces) {
            const visited = new Set([space]);
            const bfsQ = [space];
            let dist = 0;
            let found = false;
            while (bfsQ.length > 0 && !found) {
              const nextQ = [];
              dist++;
              for (const curr of bfsQ) {
                for (const neighbor of (_rAdj[curr] || [])) {
                  const n = normalizeCoord(neighbor);
                  if (visited.has(n)) continue;
                  visited.add(n);
                  if (enemyCoords.has(n)) { found = true; break; }
                  nextQ.push(n);
                }
                if (found) break;
              }
              if (!found) bfsQ.length = 0;
              for (const x of nextQ) bfsQ.push(x);
            }
            if (found) {
              if (placeMode === 'max' && dist > bestDist) { bestDist = dist; bestSpace = space; }
              else if (placeMode === 'min' && dist < bestDist) { bestDist = dist; bestSpace = space; }
            }
          }
        }

        // Place new Krykna at chosen space (mirrors handleKryknaPlacePick)
        const nextId = `krykna-${(g.npcKrykna || []).length + 1}`;
        g.npcKrykna = g.npcKrykna || [];
        g.npcKrykna.push({ id: nextId, coord: normalizeCoord(bestSpace), hp: 8, maxHp: 8, defeated: false });
        g.claimedKrykna[playerNum] = Math.max(0, claimed - 1);
        npcRespawns++;
      }
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
    if (g.pendingCombat
        && (g.pendingCombat.currentStep === 'step1+2-attacker'
            || g.pendingCombat.currentStep === 'step1+2-defender')) {
      const _acked = g.pendingCombat.acked || {};
      const combatReadyId = `combat_ready_${g.gameId}`;
      if (!_acked[1]) {
        try { await harness.submitAction(combatReadyId, g.player1Id); } catch {}
      }
      if (g.pendingCombat && !(g.pendingCombat.acked || {})[2]) {
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

    // ── Pre-action rules invariant check ──────────────────────────────────
    if (auditMode) {
      try {
        const preViolations = assertPreActionInvariants(g, allActions, { dcHealthState, dcMessageMeta });
        for (const v of preViolations) rulesViolations.push(v);
      } catch { /* invariant framework must not break training */ }
    }

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

    // ── Pass-timing audit + shadow scorer ──────────────────────────────────
    {
      const passLegal = playerActions.some(a => a.type === 'pass_activation_turn');
      if (passLegal) {
        passLegalTotal++;
        let chose = action.type === 'pass_activation_turn' ? 'pass' : 'activate';
        if (chose === 'pass') passChosenTotal++;
        else passActivatedTotal++;

        // Extract Q-values from DQN at this decision point
        const Q = pickSmartAction._lastQ;
        const lastAbsTypes = pickSmartAction._lastAbsTypes;
        let qPass = null, qActivate = null, qBest = null, bestType = null;
        if (Q && lastAbsTypes) {
          const passIdx = ABSTRACT_TYPES.indexOf('pass');
          const actIdx = ABSTRACT_TYPES.indexOf('activate');
          if (passIdx >= 0) qPass = Q[passIdx];
          if (actIdx >= 0) qActivate = Q[actIdx];
          let maxQ = -Infinity;
          for (const t of lastAbsTypes) {
            const idx = ABSTRACT_TYPES.indexOf(t);
            if (idx >= 0 && Q[idx] > maxQ) { maxQ = Q[idx]; bestType = t; }
          }
          qBest = maxQ > -Infinity ? maxQ : null;
        }

        // Game state context
        const myVP = actingPN === 1 ? (g.player1VP?.total || 0) : (g.player2VP?.total || 0);
        const oppVP = actingPN === 1 ? (g.player2VP?.total || 0) : (g.player1VP?.total || 0);
        const myRem = actingPN === 1 ? (g.p1ActivationsRemaining ?? 0) : (g.p2ActivationsRemaining ?? 0);
        const oppRem = actingPN === 1 ? (g.p2ActivationsRemaining ?? 0) : (g.p1ActivationsRemaining ?? 0);

        // Board context
        let myWounded = 0, oppUnactivated = 0;
        try {
          const oppPN = actingPN === 1 ? 2 : 1;
          const oppActivated = new Set(oppPN === 1 ? (g.p1ActivatedDcIndices || []) : (g.p2ActivatedDcIndices || []));
          const oppMsgIds = g[`p${oppPN}DcMessageIds`] || [];
          for (const mid of oppMsgIds) {
            const meta = dcMessageMeta.get(mid);
            if (!meta) continue;
            if (!oppActivated.has(meta.dcIndex ?? -1)) oppUnactivated++;
          }
          const myMsgIds = g[`p${actingPN}DcMessageIds`] || [];
          for (const mid of myMsgIds) {
            const h = dcHealthState.get(mid);
            if (h) {
              for (const fig of h) {
                if (fig && fig[0] < fig[1] && fig[0] > 0) { myWounded++; break; }
              }
            }
          }
        } catch { /* best-effort */ }

        // Which DC was activated (if not pass)?
        let activatedDc = null;
        if (chose === 'activate' && action.type === 'activate_dc') {
          try {
            const msgId = action.params?.msgId;
            if (msgId) {
              const meta = dcMessageMeta.get(msgId);
              if (meta) activatedDc = meta.dcName;
            }
          } catch { /* best-effort */ }
        }

        // ── Shadow scorer: extract features and evaluate ──
        let shadowResult = null;
        let bestDcCanAttack = 0;
        const activatableActions = playerActions.filter(a => a.type === 'activate_dc');
        try {
          const passFeatures = extractPassFeatures(g, actingPN, dcHealthState, dcMessageMeta, activatableActions);
          bestDcCanAttack = passFeatures[4]; // binary: any DC in attack range?
          const hasProductive = bestDcCanAttack > 0;
          shadowResult = passTimingShadowEval(passFeatures, chose, {
            mapId: g.selectedMap?.id || mapId,
            round: g.currentRound || currentRound,
            vpDelta: myVP - oppVP,
            gap: oppRem - myRem,
            hasWounded: myWounded > 0,
            hasProductive,
          });
        } catch { /* best-effort */ }

        // ── A/B override: shadow takes control in treatment games ──
        let overridden = false;
        if (_passAbTreatment && shadowResult && !shadowResult.agreed) {
          if (shadowResult.shadowChoice === 'pass' && chose === 'activate') {
            // Shadow says pass, DQN chose activate → override to pass
            const passAction = playerActions.find(a => a.type === 'pass_activation_turn');
            if (passAction) {
              action = passAction;
              chose = 'pass';
              activatedDc = null;
              passChosenTotal++; passActivatedTotal--;
              overridden = true;
            }
          } else if (shadowResult.shadowChoice === 'activate' && chose === 'pass') {
            // Shadow says activate, DQN chose pass → pick best DC to activate
            // Prefer DC in attack range (matches bestDcCanAttack logic), else first available
            let bestAct = null;
            if (activatableActions.length > 0) {
              const oppPN = actingPN === 1 ? 2 : 1;
              const oppFigCoords = Object.values(g.figurePositions?.[oppPN] || {});
              for (const act of activatableActions) {
                const msgId = act.params?.msgId;
                if (!msgId) continue;
                const meta = dcMessageMeta?.get(msgId);
                if (!meta) continue;
                let dcEffectsData;
                try { dcEffectsData = getDcEffects(); } catch { dcEffectsData = {}; }
                const lower = meta.dcName.toLowerCase();
                const ciKey = dcEffectsData ? Object.keys(dcEffectsData).find(k => k.toLowerCase() === lower) : null;
                const eff = dcEffectsData?.[meta.dcName] || (ciKey ? dcEffectsData[ciKey] : null);
                const attackRange = eff?.attack?.type === 'range' ? 12 : 2;
                const myFigKeys = Object.keys(g.figurePositions?.[actingPN] || {})
                  .filter(fk => fk.startsWith(meta.dcName + '-'));
                let inRange = false;
                for (const fk of myFigKeys) {
                  const myPos = g.figurePositions?.[actingPN]?.[fk];
                  if (!myPos) continue;
                  for (const oppPos of oppFigCoords) {
                    if (coordDistance(myPos, oppPos) <= attackRange) { inRange = true; break; }
                  }
                  if (inRange) break;
                }
                if (inRange) { bestAct = act; break; }
              }
              if (!bestAct) bestAct = activatableActions[0]; // fallback: first available
              action = bestAct;
              chose = 'activate';
              try {
                const meta = dcMessageMeta?.get(bestAct.params?.msgId);
                activatedDc = meta?.dcName || null;
              } catch { activatedDc = null; }
              passChosenTotal--; passActivatedTotal++;
              overridden = true;
            }
          }
        }

        const traceEntry = {
          round: g.currentRound || currentRound,
          actIdx: roundActivationIndex,
          myRem, oppRem, gap: oppRem - myRem,
          myVP, oppVP, vpDelta: myVP - oppVP,
          chose,
          qPass: qPass != null ? +qPass.toFixed(3) : null,
          qActivate: qActivate != null ? +qActivate.toFixed(3) : null,
          qBest: qBest != null ? +qBest.toFixed(3) : null,
          bestType,
          activatedDc,
          activationOutcome: null, // filled in when activation ends
          myWounded,
          oppUnactivated,
          bestDcCanAttack: bestDcCanAttack > 0 ? 1 : 0,
          // Shadow scorer data
          shadowChoice: shadowResult?.shadowChoice || null,
          shadowScore: shadowResult?.score != null ? +shadowResult.score.toFixed(3) : null,
          shadowAgreed: shadowResult?.agreed ?? null,
          overridden,
          passAbGroup: _passAbTreatment ? 'treatment' : 'control',
        };
        passAuditTrace.push(traceEntry);
        if (chose === 'activate') _pendingPassAuditIdx = passAuditTrace.length - 1;
      }
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

    // ── Move-quality diagnostic trace ──
    if (moveAuditMode && action.type === 'move_pick_space' && action.params?.coord && !action.params?.done) {
      try {
        const mc = pickSmartAction._lastMoveContrastive;
        if (mc) {
          const gap = (mc.refBestQuality != null && mc.chosenQuality != null)
            ? mc.refBestQuality - mc.chosenQuality : null;
          const chosenF = mc.chosen ? Array.from(mc.chosen) : null;
          const bestF = mc.refBestFeatures ? Array.from(mc.refBestFeatures) : null;
          moveAuditTrace.push({
            round: currentRound,
            chosenQuality: mc.chosenQuality ?? null,
            refBestQuality: mc.refBestQuality ?? null,
            gap,
            candidateCount: mc.candidateCount || 0,
            chosenFeatures: chosenF,
            refBestFeatures: bestF,
            coord: action.params.coord,
            // Outcome linkage: filled at dc_end_activation
            activationOutcome: null,
          });
          _pendingMoveAuditIdxs.push(moveAuditTrace.length - 1);
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

    // ── Shadow-mode activation outcome tracking ──────────────────────────
    // Feed every action to the outcome tracker so it knows what the
    // heuristic's chosen DC actually accomplished during its activation.
    recordActivationAction(action.type);

    // Movement metrics tracking
    if (action.type === 'move_figure') { moveActions++; lastMoveId = action.customId; }
    else if (action.type === 'dc_end_activation') endActivations++;
    else if (action.type === 'attack_target') {
      attackActions++; currentActivationHadAttack = true;
      if (action.params?.targetFigureKey?.startsWith('npc_')) npcAttacks++;
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
      // Shadow-mode: link activation start to outcome tracker
      const sd = pickSmartAction._lastShadowData;
      if (sd) {
        markActivationStart(sd.heuristicPick, !sd.agreed, sd.scorerPick, sd.heuristicPick, sd.traceIdx ?? -1);
      }

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

    // Finalize shadow-mode activation outcome at end of activation or round boundary
    if (action.type === 'dc_end_activation' || action.type === 'end_activation_phase' || action.type === 'end_end_of_round') {
      finalizeActivationOutcome();
    }

    // ── A/B per-activation outcome tracking ─────────────────────────────
    if (action.type === 'dc_end_activation') {
      // Close out the current activation's outcome
      actOutTotal++;
      let actOutcome;
      if (currentActHadAttack) { actOutAttack++; actOutcome = 'attack'; }
      else if (currentActHadInteract) { actOutInteract++; actOutcome = 'interact'; }
      else if (currentActHadMove) { actOutMoveOnly++; actOutcome = 'moveOnly'; }
      else { actOutEndOnly++; actOutcome = 'endOnly'; }
      // Link activation outcome to pass-audit trace entry
      if (_pendingPassAuditIdx >= 0 && _pendingPassAuditIdx < passAuditTrace.length) {
        passAuditTrace[_pendingPassAuditIdx].activationOutcome = actOutcome;
        _pendingPassAuditIdx = -1;
      }
      // Link activation outcome to all move-audit trace entries from this activation
      for (const idx of _pendingMoveAuditIdxs) {
        if (idx >= 0 && idx < moveAuditTrace.length) {
          moveAuditTrace[idx].activationOutcome = actOutcome;
        }
      }
      _pendingMoveAuditIdxs = [];
      currentActHadAttack = false; currentActHadInteract = false; currentActHadMove = false;
    } else if (action.type === 'activate_dc') {
      // Track decision class from shadow data
      const sd = pickSmartAction._lastShadowData;
      if (sd) {
        if (sd.classKey === 'woundedVsWounded') classWW++;
        else if (sd.classKey === 'woundedVsPositional') classWP++;
        else if (sd.classKey === 'positionalVsPositional') classPP++;
      } else {
        // No shadow data = gated out (combat-ready)
        classGated++;
      }
    }
    if (action.type === 'attack_target') currentActHadAttack = true;
    else if (action.type === 'interact') currentActHadInteract = true;
    else if (action.type === 'move_figure' || action.type === 'move_pick_space') currentActHadMove = true;

    // ── Ability-play audit capture ────────────────────────────────────────
    // Records every dc_special action with pre-state context. Post-state
    // correlation (VP / figure-defeat delta) is recorded on the NEXT loop
    // iteration via _pendingAbilityIdx.
    if (abilityAudit && action.type === 'dc_special') {
      const myVP = actingPN === 1 ? (g.player1VP?.total || 0) : (g.player2VP?.total || 0);
      const oppVP = actingPN === 1 ? (g.player2VP?.total || 0) : (g.player1VP?.total || 0);
      // Count wounded on both sides
      let myWounded = 0, oppWounded = 0, myAlive = 0, oppAlive = 0;
      for (const [, healthArr] of dcHealthState) {
        if (!healthArr) continue;
        for (const h of healthArr) {
          if (!h) continue;
          if (h[0] > 0) {
            // This msgId belongs to one side — approximate via iteration
          }
        }
      }
      // Nearest enemy distance from acting figure (if available)
      let distToEnemy = null;
      try {
        const msgId = action.params?.msgId;
        const dcName = action.params?.dcName;
        const actionsData = msgId ? g.dcActionsData?.[msgId] : null;
        const figIdx = actionsData?.selectedFigure ?? 0;
        if (dcName) {
          const dgMatch = (dcMessageMeta.get(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
          const dgIndex = dgMatch ? dgMatch[1] : '1';
          const fk = `${dcName}-${dgIndex}-${figIdx}`;
          const pos = g.figurePositions?.[actingPN]?.[fk];
          if (pos) distToEnemy = distToNearestEnemy(pos, g, actingPN);
        }
      } catch {}
      _abilityPlays.push({
        idx: _abilityPlays.length,
        game: gameNum,
        round: g.currentRound || currentRound,
        side: actingPN,
        dcName: action.params?.dcName || null,
        specialName: action.params?.specialName || null,
        specialId: action.params?.specialId || null,
        myVP,
        oppVP,
        distToEnemy,
        abilityCandidates: (playerActions || []).filter(a => a.type === 'dc_special').length,
        priorAttack: currentActHadAttack,
        priorMove: currentActHadMove,
        // Post-state filled in on the NEXT action by this side in this activation.
        postVP: null,
        postDefeats: null,
      });
      _pendingAbilityIdx = _abilityPlays.length - 1;
    }
    // Fill in post-state on any subsequent action (captures delta from the ability)
    if (abilityAudit && _pendingAbilityIdx >= 0 && action.type !== 'dc_special') {
      const entry = _abilityPlays[_pendingAbilityIdx];
      const myVP = entry.side === 1 ? (g.player1VP?.total || 0) : (g.player2VP?.total || 0);
      const oppVP = entry.side === 1 ? (g.player2VP?.total || 0) : (g.player1VP?.total || 0);
      entry.postVP = myVP;
      entry.postOppVP = oppVP;
      entry.nextActionType = action.type;
      _pendingAbilityIdx = -1;
    }

    // ── A/B per-round VP tracking ───────────────────────────────────────
    if (action.type === 'end_activation_phase' || action.type === 'end_end_of_round') {
      const p1VP = g.player1VP?.total || 0;
      const p2VP = g.player2VP?.total || 0;
      const rd = Math.min(4, Math.max(1, currentRound));
      roundVP[rd].p1 += (p1VP - lastRoundP1VP);
      roundVP[rd].p2 += (p2VP - lastRoundP2VP);
      lastRoundP1VP = p1VP;
      lastRoundP2VP = p2VP;
      currentRound++;
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
      const attackLegal = playerActions.some(a => a.type === 'attack_target');
      // Accept any interact (including use_terminal) to match the original broader detector;
      // use_terminal is load-bearing on missions like Devaron-B where it opens doors.
      const interactLegal = playerActions.some(a => a.type === 'interact');
      const specialLegal = playerActions.some(a => a.type === 'dc_special');
      const moveLegal = playerActions.some(a => a.type === 'move_figure' || a.type === 'move_pick_space');
      const hadProductive = attackLegal || interactLegal || specialLegal || moveLegal;
      if (hadProductive) prematureEndAct++;

      // Forensic classification for Devaron / premature-end diagnostic.
      // Captures priority-bucketed legal-action state, activation history so far,
      // action-economy remaining, and distance-to-nearest-mission-objective.
      try {
        const msgId = action.params?.msgId;
        const actionsData = msgId ? g.dcActionsData?.[msgId] : null;
        const actionsRemaining = actionsData?.remaining ?? 0;
        // Distance from acting figure to nearest objective token (Manhattan).
        // Used to disambiguate "camping on objective" (distToObj ≤ 1) from
        // "giving up" (distToObj > 3).
        let distToObj = null;
        try {
          const objCoords = getObjectiveCoords(g);
          if (objCoords && objCoords.length > 0 && msgId) {
            const dgMatch = (dcMessageMeta.get(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
            const dgIndex = dgMatch ? dgMatch[1] : '1';
            const figIdx = actionsData?.selectedFigure ?? 0;
            const dcName = action.params?.dcName;
            if (dcName) {
              const fk = `${dcName}-${dgIndex}-${figIdx}`;
              const pos = g.figurePositions?.[actingPN]?.[fk];
              if (pos) {
                let best = Infinity;
                for (const oc of objCoords) {
                  try {
                    const pa = parseCoord(pos), pb = parseCoord(oc);
                    const d = Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
                    if (d < best) best = d;
                  } catch {}
                }
                if (best < Infinity) distToObj = best;
              }
            }
          }
        } catch {}
        recordPremEnd({
          isPremature: hadProductive,
          round: g.currentRound || currentRound,
          side: actingPN,
          attackLegal, interactLegal, specialLegal, moveLegal,
          priorAttack: currentActHadAttack,
          priorInteract: currentActHadInteract,
          priorMove: currentActHadMove,
          actionsRemaining,
          distToObj,
        });

        // Rich per-frame capture (only when --premend-probe is set + the end is
        // actually premature). Captures legal specials, move candidate count,
        // Q-values at state, and effectfulness hints so we can answer
        // "why did end beat its alternatives at this exact frame".
        if (premendProbe && hadProductive) {
          const specialActs = playerActions.filter(a => a.type === 'dc_special');
          const moveActs = playerActions.filter(a => a.type === 'move_figure' || a.type === 'move_pick_space');
          const interactActs = playerActions.filter(a => a.type === 'interact');
          const startMoveActs = playerActions.filter(a => a.type === 'start_move');
          // Name-based effectfulness tag. Classifies each special by whether it would
          // change board state (damage, stun, push, pull, free attack, etc.) vs be
          // purely technical (reposition tokens, add strain, etc.).
          const OFFENSIVE_SPECIALS = new Set([
            'pounce', 'slam', 'brutality', 'force choke', 'force lightning',
            'defensive fire', 'dual-wield pistols', 'missile salvo',
            'trample', 'tempt', 'invasive procedure', 'emperor',
          ]);
          const ALLY_SUPPORT_SPECIALS = new Set([
            'battlefield leadership', 'military efficiency', 'survival is strength',
            'calming presence', 'wisdom', 'do or do not', 'force deflection', 'inform',
          ]);
          const effTag = (s) => {
            const n = (s.name || '').toLowerCase();
            if (OFFENSIVE_SPECIALS.has(n)) return 'offensive';
            if (ALLY_SUPPORT_SPECIALS.has(n)) return 'ally-support';
            return 'other';
          };
          const specials = specialActs.map(a => {
            const s = { name: a.params?.specialName || null, id: a.params?.specialId || null, cost: a.params?.cost ?? null };
            s.effect = effTag(s);
            return s;
          });
          const interacts = interactActs.map(a => ({
            label: a.params?.optionLabel || null,
            optionId: a.params?.optionId || null,
          }));
          // Full absTypes list for this frame (from playerActions) — proves planner
          // has no productive priority matching the legal set.
          const absTypeCounts = {};
          try {
            for (const pa of playerActions) {
              const at = abstractActionType(pa, g);
              absTypeCounts[at] = (absTypeCounts[at] || 0) + 1;
            }
          } catch {}
          // Movement-bank state: is moveInProgress active for this activator?
          let mipActive = false;
          let mipMpRemaining = null;
          try {
            if (g.moveInProgress && action.params?.msgId) {
              for (const [k, v] of Object.entries(g.moveInProgress)) {
                if (k.startsWith(action.params.msgId + '_')) {
                  mipActive = true;
                  mipMpRemaining = v?.movementPointsRemaining ?? v?.mp ?? null;
                  break;
                }
              }
            }
          } catch {}
          // Simulated planner priority walk — mirrors oracleActivationPlan()'s
          // attack → interact → move → move_done → end fall-through. Records the
          // priority at which the planner would fire. For premature-end frames
          // this will almost always be 'priority5_end_fallthrough' when the only
          // legal productive abstract is 'ability' (dc_special).
          let plannerPath = 'n/a';
          try {
            const has = (k) => absTypeCounts[k] > 0;
            if (has('attack_close') || has('attack_ranged')) plannerPath = 'priority1_attack';
            else if (has('interact')) {
              const missionI = interactActs.find(a => a.params?.optionId && a.params.optionId !== 'use_terminal');
              plannerPath = missionI ? 'priority2_mission_interact' : 'priority5_end_fallthrough';
            }
            else if (has('start_move')) plannerPath = 'priority3a_start_move';
            else if (has('move_toward') || has('move_away') || has('move_lateral')) plannerPath = 'priority3b_move_space';
            else if (has('move_done')) plannerPath = 'priority4_move_done';
            else plannerPath = 'priority5_end_fallthrough';
          } catch {}
          // Effectfulness hints
          let woundedAllies = 0, allyCount = 0;
          try {
            const myMsgIds = actingPN === 1 ? (g.p1DcMessageIds || []) : (g.p2DcMessageIds || []);
            for (const mid of myMsgIds) {
              const h = dcHealthState.get(mid);
              if (!h) continue;
              for (const fh of h) {
                if (!fh) continue;
                allyCount++;
                if (fh[0] < fh[1]) woundedAllies++;
              }
            }
          } catch {}
          let hasTargetsInRange = null;
          let qValues = null, features = null;
          try {
            features = extractFeatures(g, actingPN, dcHealthState, dcMessageMeta);
            if (features && features.length > 42) hasTargetsInRange = features[42];
            const q = getQValues(learnings, features);
            if (q) {
              qValues = {
                attack_close: q[0] ?? null,
                attack_ranged: q[1] ?? null,
                move_toward: q[2] ?? null,
                move_away: q[3] ?? null,
                move_lateral: q[4] ?? null,
                activate: q[7] ?? null,
                end_activation: q[8] ?? null,
                pass: q[9] ?? null,
                ability: q[10] ?? null,
                interact: q[22] ?? null,
              };
            }
          } catch {}
          recordPremEndFrame({
            gameId: game.gameId || null,
            mapId: g.selectedMap?.id || g.selectedMap?.mapId || null,
            side: actingPN,
            round: g.currentRound || currentRound,
            dcName: action.params?.dcName || null,
            msgId: action.params?.msgId || null,
            actionsRemaining,
            specialCount: specialActs.length,
            specials,
            moveCandidateCount: moveActs.length,
            startMoveCount: startMoveActs.length,
            interactCount: interactActs.length,
            interacts,
            attackLegal, interactLegal, specialLegal, moveLegal,
            absTypeCounts,
            mipActive, mipMpRemaining,
            plannerPath,
            woundedAllies, allyCount,
            hasTargetsInRange,
            distToObj,
            qValues,
            chosen: 'dc_end_activation',
          });
        }
      } catch { /* best-effort */ }
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
          doorOpens++;
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

    // ── Pre-action snapshot for post-action invariant comparison ──────────
    const preSnap = auditMode ? snapshotPreAction(g) : null;

    try {
      await harness.submitAction(action.customId, userId);
      tracer.afterAction(harness.getGame(), action);
    } catch (err) {
      tracer.afterAction(harness.getGame(), action);
      // ── Handler error instrumentation (RT-HE) ────────────────────────
      if (auditMode) {
        handlerErrors++;
        rulesViolations.push({
          id: 'RT-HE',
          severity: 'high',
          domain: 'handler_error',
          message: `Handler threw on ${action.type}: ${(err?.message || String(err)).slice(0, 200)}`,
          phase: g?.phase || '?',
          roundPhase: g?.roundPhase || '?',
          round: g?.currentRound || 0,
          contextType: 'post_action',
          actionType: action.type,
          customId: (action.customId || '').slice(0, 80),
        });
      }
    }

    // ── Post-action rules invariant check ─────────────────────────────────
    if (auditMode) {
      try {
        const postG = harness.getGame();
        const postViolations = assertPostActionInvariants(postG, preSnap, action, { dcHealthState, dcMessageMeta });
        for (const v of postViolations) rulesViolations.push(v);
      } catch { /* invariant framework must not break training */ }
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

  // Count NPC defeats at game end
  for (const npc of (preFinGame.npcKrykna || [])) { if (npc.defeated) npcDefeats++; }
  for (const npc of (preFinGame.npcThugs || [])) { if (npc.defeated) npcDefeats++; }

  // Finalize — both tracers update Q-values
  const finalGame = harness.getGame();
  tracer1.finalize(finalGame, true);  // Only tracer1 updates meta
  tracer2.finalize(finalGame, false);
  replayUpdate(learnings);

  const winnerLabel = finalGame.winnerId === finalGame.player1Id ? 'P1' :
                      finalGame.winnerId === finalGame.player2Id ? 'P2' : null;

  // Track per-DC, per-affiliation, per-deck, and per-map results
  const p1VP = finalGame.player1VP?.total || 0;
  const p2VP = finalGame.player2VP?.total || 0;
  recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStats, getDcEffects, {
    p1DeckName: p1Deck.name, p2DeckName: p2Deck.name, mapId,
    totalVP: p1VP + p2VP, vpDiff: Math.abs(p1VP - p2VP),
  });

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
    doorOpens,
    npcAttacks,
    npcDefeats,
    npcPushEvents,
    npcEorDamageEvents,
    npcRespawns,
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
    auditCcPlays, auditCcOpportunities, auditSurgeEvents, auditCcDecisions, auditMoveDecisions, auditAttackDecisions, moveAuditTrace,
    // Rules invariant data
    rulesViolations, handlerErrors,
    // Diversity pilot
    isPoolGame: isPoolGame || false,
    // A/B per-round VP and per-activation outcome
    roundVP,
    actOutAttack, actOutInteract, actOutMoveOnly, actOutEndOnly, actOutTotal,
    classWW, classWP, classPP, classGated,
    // Pass-timing audit
    passAuditTrace, passLegalTotal, passChosenTotal, passActivatedTotal,
    // Pass-timing A/B
    passAbGroup: _passAbTreatment ? 'treatment' : 'control',
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
  if (args.includes('--no-mc-returns')) {
    setUseMcReturns(false);
    console.log(`  Target mode: n-step returns (override) — bounded n-step + bootstrap, boundary truncation on`);
  } else {
    console.log(`  Target mode: MC returns (default) — pure Monte-Carlo target, no bootstrap, no boundary truncation`);
  }
  const mapArg = args.find(a => a.startsWith('--map='));
  if (mapArg) {
    mapOverride = mapArg.split('=')[1];
    console.log(`  Map override: ${mapOverride} (all games on this map)`);
  }
  if (args.includes('--training')) {
    useTrainingMatchups = true;
    console.log(`  Training mode: LOCKED matchups (${TRAINING_MATCHUPS.length} matchups, ${TRAINING_WHITELIST_DCS.size} DCs, ${TRAINING_WHITELIST_CCS.size} CCs, ${TRAINING_MAPS.length} maps)`);
  }
  if (args.includes('--mixed')) {
    useMixedCurriculum = true;
    useTrainingMatchups = true; // mixed implies training mode
    const prArg = args.find(a => a.startsWith('--pool-ratio='));
    if (prArg) poolRatio = Math.max(0.01, Math.min(0.5, parseFloat(prArg.split('=')[1])));
    if (args.includes('--balanced')) {
      useBalancedPool = true;
      console.log(`  Balanced pool: tier-matched pairing (${DECK_TIERS.strong.length}S/${DECK_TIERS.mid.length}M/${DECK_TIERS.weak.length}W)`);
    }
    console.log(`  Mixed curriculum: ${((1 - poolRatio) * 100).toFixed(0)}% fixed / ${(poolRatio * 100).toFixed(0)}% pool (${TEST_DECKS.length} pool decks${useBalancedPool ? ', balanced' : ', random'})`);
  }
  if (args.includes('--audit')) {
    auditMode = true;
    console.log(`  Audit mode: ENABLED (coverage + surge-accuracy tracking)`);
  }
  if (args.includes('--scorer-control')) {
    setActivateScorerControl(true);
    console.log(`  Activation scorer: CONTROL MODE (scorer decides on gated surface)`);
  }
  if (args.includes('--passab')) {
    passAbMode = true;
    console.log(`  Pass-timing A/B: ENABLED (alternating control/treatment, shadow takes control in treatment)`);
  }
  if (args.includes('--move-audit')) {
    moveAuditMode = true;
    console.log(`  Move-quality audit: ENABLED (destination quality gap + activation outcome linkage)`);
  }
  const diagnosticMode = args.includes('--diagnostic');
  if (diagnosticMode) {
    setAlpha(0);            // freeze main Q-network
    setWgFrozen(true);      // freeze within-group scorer weights
    resetAbilityGateAudit(); // clear ability gate counters for this run
    console.log(`  Diagnostic eval: WEIGHTS FROZEN (alpha=0, WG updates skipped); per-map/matchup/side/stop-reason breakdown will be printed at end of run`);
  }
  if (args.includes('--premend-probe')) {
    premendProbe = true;
    resetPremEndFrames();
    console.log(`  Premature-end forensic probe: ENABLED (captures per-frame Q-values, legal specials, move candidates, objective proximity)`);
  }
  if (args.includes('--ability-audit')) {
    abilityAudit = true;
    _abilityPlays.length = 0;
    console.log(`  Ability-play audit: ENABLED (captures every dc_special action with pre/post state for selection-quality analysis)`);
  }
  if (args.includes('--attack-trace')) {
    setAttackTrace(true);
    console.log(`  Attack trace: ENABLED (every multi-candidate attack decision logged to stderr as ATK_TRACE lines)`);
  }
  const kpArg = args.find(a => a.startsWith('--krykna-placement='));
  if (kpArg) {
    const mode = kpArg.split('=')[1];
    setKryknaPlacementMode(mode);
    console.log(`  Krykna placement mode: ${getKryknaPlacementMode()} (valid: min | max | random; default min)`);
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
  let cpPoolGames = 0, cpPoolCompleted = 0, cpPoolVP = 0, cpWhitelistHits = 0;
  let cpFixedGames = 0, cpFixedVP = 0;
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
    // Pass-timing A/B: alternate control (even) / treatment (odd)
    _passAbTreatment = passAbMode && (i % 2 === 1);
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
      doorOpens: result.doorOpens || 0,
      npcAttacks: result.npcAttacks || 0,
      npcDefeats: result.npcDefeats || 0,
      npcPushEvents: result.npcPushEvents || 0,
      npcEorDamageEvents: result.npcEorDamageEvents || 0,
      npcRespawns: result.npcRespawns || 0,
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
      moveAuditTrace: result.moveAuditTrace || [],
      matchupLabel: result.matchupLabel || 'unknown',
      mapId: result.mapId || 'unknown',
      isPoolGame: result.isPoolGame || false,
      // Pass-timing audit
      passAuditTrace: result.passAuditTrace || [],
      passLegalTotal: result.passLegalTotal || 0,
      passChosenTotal: result.passChosenTotal || 0,
      passActivatedTotal: result.passActivatedTotal || 0,
      passAbGroup: passAbMode ? (result.passAbGroup || 'control') : null,
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

    // Diversity pilot accumulators
    if (result.isPoolGame) {
      cpPoolGames++;
      cpPoolVP += gameVP;
      if (result.ended) cpPoolCompleted++;
    } else {
      cpFixedGames++;
      cpFixedVP += gameVP;
    }

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
      // Diversity pilot checkpoint
      if (useMixedCurriculum) {
        const poolAvg = cpPoolGames > 0 ? (cpPoolVP / cpPoolGames).toFixed(1) : 'n/a';
        const fixedAvg = cpFixedGames > 0 ? (cpFixedVP / cpFixedGames).toFixed(1) : 'n/a';
        const poolCR = cpPoolGames > 0 ? `${cpPoolCompleted}/${cpPoolGames}` : 'n/a';
        const wlHits = learnings.whitelistAudit?.totalHits || 0;
        const uConfigs = learnings.uniqueConfigs?.length || 0;
        console.log(`\n  ── DIVERSITY PILOT ──`);
        console.log(`    Pool: ${cpPoolGames} games, avgVP=${poolAvg}, completion=${poolCR}`);
        console.log(`    Fixed: ${cpFixedGames} games, avgVP=${fixedAvg}`);
        console.log(`    Whitelist audit hits (cumulative): ${wlHits} | Unique pool configs: ${uConfigs}`);
        const deckStatEntries = Object.entries(learnings.deckStats || {}).sort((a, b) => b[1].games - a[1].games).slice(0, 10);
        if (deckStatEntries.length > 0) {
          console.log(`    Top decks: ${deckStatEntries.map(([n, s]) => `${n}(${s.wins}W/${s.games}G)`).join(', ')}`);
        }
      }
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
        'ACTIVATE-LEARNS':     wgAudit.activateUpdates > 0,
      };
      const passCount = Object.values(assertions).filter(Boolean).length;
      const totalAssertions = Object.keys(assertions).length;
      console.log(`\n  ── AUDIT ASSERTIONS: ${passCount}/${totalAssertions} PASS ──`);
      for (const [name, pass] of Object.entries(assertions)) {
        console.log(`    ${pass ? 'PASS' : 'FAIL'} ${name}`);
      }
      console.log(`  WG counters: atk_entries=${wgAudit.attackEntries} atk_updates=${wgAudit.attackUpdates} move_entries=${wgAudit.moveEntries} move_updates=${wgAudit.moveUpdates} surge_entries=${wgAudit.surgeEntries} surge_updates=${wgAudit.surgeUpdates} act_entries=${wgAudit.activateEntries} act_updates=${wgAudit.activateUpdates}`);
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

      // ── Activation-Order Audit ──────────────────────────────────────────
      const aoAudit = getActOrderAudit();
      if (aoAudit.totalDecisions > 0) {
        const multiPct = ((aoAudit.multiChoiceDecisions / aoAudit.totalDecisions) * 100).toFixed(1);
        const trivPct = ((aoAudit.trivialDecisions / aoAudit.totalDecisions) * 100).toFixed(1);
        const avgSpread = aoAudit.positionalSpreadCount > 0 ? (aoAudit.positionalSpreadSum / aoAudit.positionalSpreadCount).toFixed(1) : 'n/a';
        const sameTierPct = aoAudit.multiChoiceDecisions > 0 ? ((aoAudit.sameTierDecisions / aoAudit.multiChoiceDecisions) * 100).toFixed(1) : 'n/a';
        const combatReadyPct = aoAudit.multiChoiceDecisions > 0 ? ((aoAudit.anyCombatReady / aoAudit.multiChoiceDecisions) * 100).toFixed(1) : 'n/a';
        const multiCombatPct = aoAudit.multiChoiceDecisions > 0 ? ((aoAudit.multiCombatReady / aoAudit.multiChoiceDecisions) * 100).toFixed(1) : 'n/a';
        const noCombatPct = aoAudit.multiChoiceDecisions > 0 ? ((aoAudit.noCombatReady / aoAudit.multiChoiceDecisions) * 100).toFixed(1) : 'n/a';
        const woundedPct = aoAudit.multiChoiceDecisions > 0 ? ((aoAudit.anyWounded / aoAudit.multiChoiceDecisions) * 100).toFixed(1) : 'n/a';
        console.log(`\n  ── ACTIVATION-ORDER AUDIT ──`);
        console.log(`    Total decisions: ${aoAudit.totalDecisions} (${multiPct}% multi-choice, ${trivPct}% trivial)`);
        console.log(`    Choice histogram: ${Object.entries(aoAudit.choiceHistogram).filter(([,v]) => v > 0).map(([k,v]) => `${k}dc:${v}`).join(' ')}`);
        console.log(`    Chosen tier: combat=${aoAudit.tierCounts.combat} wounded=${aoAudit.tierCounts.wounded} positional=${aoAudit.tierCounts.positional}`);
        console.log(`    Same-tier #1/#2: ${sameTierPct}% | Avg positional spread: ${avgSpread}`);
        console.log(`    Combat-ready: any=${combatReadyPct}% multi=${multiCombatPct}% none=${noCombatPct}%`);
        console.log(`    Wounded present: ${woundedPct}% | Multi-wounded: ${aoAudit.multiWounded}`);
      }
      resetActOrderAudit();

      // ── Activation-Order Shadow Mode ──────────────────────────────────
      const shadow = getActShadow();
      if (shadow.totalEligible > 0 || shadow.totalGated > 0) {
        const total = shadow.totalEligible;
        const disagPct = total > 0 ? ((shadow.disagreements / total) * 100).toFixed(1) : '0.0';
        console.log(`\n  ── ACTIVATION-ORDER SHADOW MODE ──`);
        console.log(`    Eligible: ${total} | Gated (combat-ready): ${shadow.totalGated}`);
        console.log(`    Agree: ${shadow.agreements} | Disagree: ${shadow.disagreements} (${disagPct}%)`);
        // By decision class
        for (const [cls, data] of Object.entries(shadow.byClass)) {
          if (data.total > 0) {
            const dPct = ((data.disagree / data.total) * 100).toFixed(1);
            console.log(`    ${cls}: ${data.total} decisions, ${dPct}% disagree`);
          }
        }
        // By round
        const roundParts = [];
        for (let r = 1; r <= 4; r++) {
          const rd = shadow.byRound[r];
          if (rd.total > 0) roundParts.push(`R${r}:${((rd.disagree / rd.total) * 100).toFixed(0)}%`);
        }
        if (roundParts.length > 0) console.log(`    By round: ${roundParts.join(' ')}`);
        // By activations-left
        const earlyD = shadow.byActivationsLeft.early;
        const lateD = shadow.byActivationsLeft.late;
        if (earlyD.total > 0 || lateD.total > 0) {
          const ePct = earlyD.total > 0 ? ((earlyD.disagree / earlyD.total) * 100).toFixed(0) : '0';
          const lPct = lateD.total > 0 ? ((lateD.disagree / lateD.total) * 100).toFixed(0) : '0';
          console.log(`    By activation timing: early=${ePct}% late=${lPct}%`);
        }
        // Feature deltas on disagreement
        if (shadow.disagreeCount > 0) {
          const fNames = ['enemyThreat','hpFraction','figureCount','minEnemyNorm','minObjNorm','attackRange','roundFrac','actLeft'];
          const avgDeltas = shadow.disagreeFeatureDeltas.map((d, i) => `${fNames[i]}:${(d / shadow.disagreeCount).toFixed(3)}`);
          console.log(`    Avg feature delta (scorer-heuristic): ${avgDeltas.join(' ')}`);
        }
      }
      // ── Activation Outcome Proxy ──────────────────────────────────────
      const outcome = getActOutcome();
      if (outcome.all.total > 0) {
        const fmtBucket = (b) => {
          if (b.total === 0) return 'n/a';
          const pcts = ['attack','interact','moveOnly','endOnly'].map(k =>
            `${k}:${((b[k] / b.total) * 100).toFixed(0)}%`).join(' ');
          return `${b.total} (${pcts})`;
        };
        console.log(`    Outcome (all eligible): ${fmtBucket(outcome.all)}`);
        console.log(`    Outcome (agree):        ${fmtBucket(outcome.agree)}`);
        console.log(`    Outcome (disagree→heur):${fmtBucket(outcome.disagreeHeuristic)}`);
      }
      resetActShadow();
      resetActOutcome();

      // Persist checkpoint to training history for plateau detection
      const cpPayload = {
        completed: cpCompleted, total: cpGames,
        p1Wins: cpP1, p2Wins: cpP2,
        avgVP: cpGames > 0 ? cpVP / cpGames : 0,
        avgAbsDelta: parseFloat(cp.avgAbsDelta),
        epsilon: parseFloat(cp.epsilon),
        decisionClass: getDecisionClassAudit(),
      };
      if (useMixedCurriculum) {
        cpPayload.poolGames = cpPoolGames;
        cpPayload.fixedGames = cpFixedGames;
        cpPayload.uniqueConfigs = learnings.uniqueConfigs?.length || 0;
        cpPayload.whitelistHits = learnings.whitelistAudit?.totalHits || 0;
        cpPayload.poolAvgVP = cpPoolGames > 0 ? cpPoolVP / cpPoolGames : 0;
        cpPayload.fixedAvgVP = cpFixedGames > 0 ? cpFixedVP / cpFixedGames : 0;
        cpPayload.poolCompletionRate = cpPoolGames > 0 ? cpPoolCompleted / cpPoolGames : 0;
      }
      recordTrainingCheckpoint(learnings, cpPayload);
      // Reset window counters
      cpCompleted = 0; cpP1 = 0; cpP2 = 0; cpVP = 0; cpGames = 0;
      cpPoolGames = 0; cpPoolCompleted = 0; cpPoolVP = 0; cpFixedGames = 0; cpFixedVP = 0;
      cpRunawayGames = 0; cpRunawayWindows = 0; cpTotalIters = 0;
      cpFigureDefeats = 0;
      resetWgAuditCounters();
      resetAtkAuditCounters();
      resetDecisionClassAudit();
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

  // Diversity pilot final summary
  if (useMixedCurriculum) {
    const poolResults = perGameResults.filter(r => r.isPoolGame);
    const fixedResults = perGameResults.filter(r => !r.isPoolGame);
    const poolCompleted = poolResults.filter(r => r.ended);
    const fixedCompleted = fixedResults.filter(r => r.ended);
    const poolTotalVP = poolResults.reduce((s, r) => s + (r.p1VP || 0) + (r.p2VP || 0), 0);
    const fixedTotalVP = fixedResults.reduce((s, r) => s + (r.p1VP || 0) + (r.p2VP || 0), 0);
    const poolDecisive = poolCompleted.filter(r => Math.abs(r.p1VP - r.p2VP) >= 10).length;
    const fixedDecisive = fixedCompleted.filter(r => Math.abs(r.p1VP - r.p2VP) >= 10).length;
    console.log('\n=== DIVERSITY PILOT SUMMARY ===');
    console.log(`Pool games: ${poolResults.length}/${perGameResults.length} (${(poolResults.length/perGameResults.length*100).toFixed(1)}%)`);
    console.log(`  Completion: ${poolCompleted.length}/${poolResults.length} (${poolResults.length > 0 ? (poolCompleted.length/poolResults.length*100).toFixed(1) : 'n/a'}%)`);
    console.log(`  Avg VP: ${poolResults.length > 0 ? (poolTotalVP / poolResults.length).toFixed(1) : 'n/a'}`);
    console.log(`  Decisive: ${poolCompleted.length > 0 ? `${poolDecisive}/${poolCompleted.length} (${(poolDecisive/poolCompleted.length*100).toFixed(0)}%)` : 'n/a'}`);
    console.log(`Fixed games: ${fixedResults.length}/${perGameResults.length}`);
    console.log(`  Completion: ${fixedCompleted.length}/${fixedResults.length} (${fixedResults.length > 0 ? (fixedCompleted.length/fixedResults.length*100).toFixed(1) : 'n/a'}%)`);
    console.log(`  Avg VP: ${fixedResults.length > 0 ? (fixedTotalVP / fixedResults.length).toFixed(1) : 'n/a'}`);
    console.log(`  Decisive: ${fixedCompleted.length > 0 ? `${fixedDecisive}/${fixedCompleted.length} (${(fixedDecisive/fixedCompleted.length*100).toFixed(0)}%)` : 'n/a'}`);
    console.log(`Whitelist audit hits: ${learnings.whitelistAudit?.totalHits || 0}`);
    if (learnings.whitelistAudit?.totalHits > 0) {
      const topCards = Object.entries(learnings.whitelistAudit.hitsByCard).sort((a, b) => b[1] - a[1]).slice(0, 10);
      console.log(`  Top non-whitelist cards: ${topCards.map(([c, n]) => `${c}(${n})`).join(', ')}`);
    }
    console.log(`Unique pool configs: ${learnings.uniqueConfigs?.length || 0}`);
    // Per-deck win rates
    const deckEntries = Object.entries(learnings.deckStats || {}).sort((a, b) => b[1].games - a[1].games);
    if (deckEntries.length > 0) {
      console.log(`\nDeck stats (${deckEntries.length} decks seen):`);
      for (const [name, s] of deckEntries.slice(0, 15)) {
        const wr = s.games > 0 ? ((s.wins / s.games) * 100).toFixed(0) : 'n/a';
        console.log(`  ${name}: ${s.wins}W/${s.losses}L/${s.games}G (${wr}%)`);
      }
    }
    // Per-map stats
    const mapEntries = Object.entries(learnings.mapStats || {}).sort((a, b) => b[1].games - a[1].games);
    if (mapEntries.length > 0) {
      console.log(`\nMap stats:`);
      for (const [mid, ms] of mapEntries) {
        const avgVpMap = ms.games > 0 ? (ms.totalVP / ms.games).toFixed(1) : 'n/a';
        const decRate = ms.games > 0 ? ((ms.decisive / ms.games) * 100).toFixed(0) : 'n/a';
        console.log(`  ${mid}: ${ms.games}G, avgVP=${avgVpMap}, decisive=${decRate}%, P1=${ms.wins.P1} P2=${ms.wins.P2}`);
      }
    }
  }

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

  // ── Diagnostic breakdowns (per-map / per-matchup / per-side / per-stop-reason) ──
  // Only prints when --diagnostic is set, to avoid cluttering normal training runs.
  if (diagnosticMode && perGameResults.length > 0) {
    const fmtPct = (n, d) => d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a';
    const groupBy = (key) => {
      const g = {};
      for (const r of perGameResults) {
        const k = r[key] || 'unknown';
        (g[k] = g[k] || []).push(r);
      }
      return g;
    };
    const summarize = (rows) => {
      const n = rows.length;
      if (n === 0) return null;
      const vp = rows.reduce((s, r) => s + (r.p1VP || 0) + (r.p2VP || 0), 0) / n;
      const vpDiff = rows.reduce((s, r) => s + Math.abs((r.p1VP || 0) - (r.p2VP || 0)), 0) / n;
      const p1VP = rows.reduce((s, r) => s + (r.p1VP || 0), 0) / n;
      const p2VP = rows.reduce((s, r) => s + (r.p2VP || 0), 0) / n;
      const p1Wins = rows.filter(r => r.winner === 'P1').length;
      const p2Wins = rows.filter(r => r.winner === 'P2').length;
      const draws = n - p1Wins - p2Wins;
      const decisive = rows.filter(r => Math.abs((r.p1VP || 0) - (r.p2VP || 0)) >= 10).length;
      const rounds = rows.reduce((s, r) => s + (r.finalRound || 0), 0) / n;
      const ended = rows.filter(r => r.ended).length;
      const stops = rows.reduce((acc, r) => { acc[r.stopReason || 'normal'] = (acc[r.stopReason || 'normal'] || 0) + 1; return acc; }, {});
      return { n, vp, vpDiff, p1VP, p2VP, p1Wins, p2Wins, draws, decisive, rounds, ended, stops };
    };

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║          COMPETITIVE-SET CEILING DIAGNOSTIC                      ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    // Per-map
    console.log('\n=== Per-map breakdown ===');
    const byMap = groupBy('mapId');
    const mapNames = Object.keys(byMap).sort();
    console.log(`  ${'map'.padEnd(26)} ${'N'.padStart(4)} ${'VP/g'.padStart(6)} ${'VPdiff'.padStart(7)} ${'P1 VP'.padStart(6)} ${'P2 VP'.padStart(6)} ${'P1 W'.padStart(5)} ${'P2 W'.padStart(5)} ${'decsv'.padStart(5)} ${'rnds'.padStart(5)}`);
    for (const m of mapNames) {
      const s = summarize(byMap[m]);
      console.log(`  ${m.padEnd(26)} ${String(s.n).padStart(4)} ${s.vp.toFixed(1).padStart(6)} ${s.vpDiff.toFixed(1).padStart(7)} ${s.p1VP.toFixed(1).padStart(6)} ${s.p2VP.toFixed(1).padStart(6)} ${String(s.p1Wins).padStart(5)} ${String(s.p2Wins).padStart(5)} ${fmtPct(s.decisive, s.n).padStart(5)} ${s.rounds.toFixed(1).padStart(5)}`);
    }

    // Per-matchup
    console.log('\n=== Per-matchup breakdown ===');
    const byMatchup = groupBy('matchupLabel');
    const matchupNames = Object.keys(byMatchup).sort();
    console.log(`  ${'matchup'.padEnd(38)} ${'N'.padStart(4)} ${'VP/g'.padStart(6)} ${'VPdiff'.padStart(7)} ${'P1 VP'.padStart(6)} ${'P2 VP'.padStart(6)} ${'P1 W'.padStart(5)} ${'P2 W'.padStart(5)} ${'decsv'.padStart(5)}`);
    for (const mu of matchupNames) {
      const s = summarize(byMatchup[mu]);
      const label = mu.length > 36 ? mu.slice(0, 35) + '…' : mu;
      console.log(`  ${label.padEnd(38)} ${String(s.n).padStart(4)} ${s.vp.toFixed(1).padStart(6)} ${s.vpDiff.toFixed(1).padStart(7)} ${s.p1VP.toFixed(1).padStart(6)} ${s.p2VP.toFixed(1).padStart(6)} ${String(s.p1Wins).padStart(5)} ${String(s.p2Wins).padStart(5)} ${fmtPct(s.decisive, s.n).padStart(5)}`);
    }

    // Per-side (overall)
    console.log('\n=== Side breakdown (overall) ===');
    const sAll = summarize(perGameResults);
    console.log(`  P1 avg VP: ${sAll.p1VP.toFixed(2)}  wins ${sAll.p1Wins}/${sAll.n} (${fmtPct(sAll.p1Wins, sAll.n)})`);
    console.log(`  P2 avg VP: ${sAll.p2VP.toFixed(2)}  wins ${sAll.p2Wins}/${sAll.n} (${fmtPct(sAll.p2Wins, sAll.n)})`);
    console.log(`  Draws: ${sAll.draws}/${sAll.n}`);
    console.log(`  Side asymmetry: P2VP − P1VP = ${(sAll.p2VP - sAll.p1VP).toFixed(2)} VP/game; P2 win advantage = ${sAll.p2Wins - sAll.p1Wins} games`);

    // Per-stop-reason
    console.log('\n=== Stop reasons ===');
    for (const [reason, count] of Object.entries(sAll.stops).sort((a, b) => b[1] - a[1])) {
      const rows = perGameResults.filter(r => (r.stopReason || 'normal') === reason);
      const s = summarize(rows);
      console.log(`  ${reason.padEnd(22)} ${String(count).padStart(4)} (${fmtPct(count, sAll.n)})  VP/g=${s.vp.toFixed(1)}  P1W=${s.p1Wins}  P2W=${s.p2Wins}  rnds=${s.rounds.toFixed(1)}`);
    }

    // Attack-candidate-generation breakdown (accumulated across the full run)
    const ca = getCandAudit();
    console.log('\n=== Attack candidate-generation breakdown ===');
    console.log(`  Total attack decisions: ${ca.totalDecisions}`);
    if (ca.totalDecisions > 0) {
      const pct = (n) => ((n / ca.totalDecisions) * 100).toFixed(1) + '%';
      console.log(`    NPC-only legal:      ${ca.npcOnly} (${pct(ca.npcOnly)})`);
      console.log(`    Figure-only legal:   ${ca.figureOnly} (${pct(ca.figureOnly)})`);
      console.log(`    Mixed (NPC+figure):  ${ca.mixed} (${pct(ca.mixed)})`);
      if (ca.empty > 0) console.log(`    Empty (neither):     ${ca.empty}`);
      const avgNpc = (ca.totalNpcCandidates / ca.totalDecisions).toFixed(2);
      const avgFig = (ca.totalFigureCandidates / ca.totalDecisions).toFixed(2);
      const avgEnPop = (ca.totalEnemyFiguresOnBoard / ca.totalDecisions).toFixed(2);
      console.log(`  Avg candidates per decision: NPC=${avgNpc}, enemy-fig=${avgFig} (total enemy figures on board avg=${avgEnPop})`);
      if (ca.npcOnly > 0 && ca.npcOnlyExcludedFigTotal > 0) {
        const t = ca.npcOnlyExcludedFigTotal;
        const r = ca.npcOnlyExcludedByRange;
        const lOs = ca.npcOnlyExcludedByLos;
        const pd = ca.npcOnlyExcludedByPathDist;
        const fb = ca.npcOnlyExcludedByFigureBlock;
        const ot = ca.npcOnlyExcludedByOther;
        console.log('\n  In NPC-only decisions, excluded enemy-figure reasons (refined):');
        console.log(`    Out of Manhattan range:  ${r} (${((r/t)*100).toFixed(1)}%)`);
        console.log(`    Path-distance > range:   ${pd} (${((pd/t)*100).toFixed(1)}%)   (walls/doors add detour)`);
        console.log(`    Bare-LoS blocked:        ${lOs} (${((lOs/t)*100).toFixed(1)}%)`);
        console.log(`    Figure-blocked LoS:      ${fb} (${((fb/t)*100).toFixed(1)}%)`);
        console.log(`    Other:                   ${ot} (${((ot/t)*100).toFixed(1)}%)`);
        const avgExcluded = (t / ca.npcOnly).toFixed(2);
        console.log(`    Avg excluded enemy-figures per NPC-only decision: ${avgExcluded}`);
      }
      // Spatial distributions + density
      const quant = (arr, q) => { if (arr.length === 0) return 'n/a'; const s = [...arr].sort((a,b) => a-b); return s[Math.max(0, Math.min(s.length - 1, Math.floor(q * s.length)))]; };
      const mean = (arr) => arr.length === 0 ? 'n/a' : (arr.reduce((s,v) => s+v, 0) / arr.length).toFixed(2);
      if (ca.distToNearestEnemyFig.length > 0) {
        const ef = ca.distToNearestEnemyFig;
        console.log('\n  Distance to nearest enemy figure at attack decision time (Manhattan):');
        console.log(`    N=${ef.length}, mean=${mean(ef)}, min=${quant(ef,0)}, q10=${quant(ef,0.1)}, q25=${quant(ef,0.25)}, median=${quant(ef,0.5)}, q75=${quant(ef,0.75)}, q90=${quant(ef,0.9)}, max=${quant(ef,1.0)}`);
      }
      if (ca.distToNearestKrykna.length > 0) {
        const kd = ca.distToNearestKrykna;
        console.log('\n  Distance to nearest active Krykna at attack decision time (Manhattan):');
        console.log(`    N=${kd.length}, mean=${mean(kd)}, min=${quant(kd,0)}, q10=${quant(kd,0.1)}, q25=${quant(kd,0.25)}, median=${quant(kd,0.5)}, q75=${quant(kd,0.75)}, q90=${quant(kd,0.9)}, max=${quant(kd,1.0)}`);
      }
      if (ca.attackerRanges.length > 0) {
        const ar = ca.attackerRanges;
        console.log('\n  Attacker practical range at attack decision time:');
        console.log(`    N=${ar.length}, mean=${mean(ar)}, min=${quant(ar,0)}, median=${quant(ar,0.5)}, q90=${quant(ar,0.9)}, max=${quant(ar,1.0)}`);
      }
      if (ca.totalDecisions > 0) {
        console.log('\n  Density rings around attacker (summed across decisions):');
        console.log(`    within 3 spaces: enemy-fig=${ca.figCountWithin3} (avg ${(ca.figCountWithin3/ca.totalDecisions).toFixed(2)}/dec), Krykna=${ca.kryCountWithin3} (avg ${(ca.kryCountWithin3/ca.totalDecisions).toFixed(2)}/dec)`);
        console.log(`    within 5 spaces: enemy-fig=${ca.figCountWithin5} (avg ${(ca.figCountWithin5/ca.totalDecisions).toFixed(2)}/dec), Krykna=${ca.kryCountWithin5} (avg ${(ca.kryCountWithin5/ca.totalDecisions).toFixed(2)}/dec)`);
        console.log(`    within 7 spaces: enemy-fig=${ca.figCountWithin7} (avg ${(ca.figCountWithin7/ca.totalDecisions).toFixed(2)}/dec), Krykna=${ca.kryCountWithin7} (avg ${(ca.kryCountWithin7/ca.totalDecisions).toFixed(2)}/dec)`);
        console.log(`  Avg active Krykna on board at decision time: ${(ca.totalActiveKryknaSum/ca.totalDecisions).toFixed(2)}`);
        console.log(`  Respawn events observed (population growth between decisions): ${ca.respawnEvents}`);
      }
    }

    // Premature-end-activation breakdown (per-round / per-side / per-bucket / objective-proximity)
    const pe = getPremEndAudit();
    console.log('\n=== Premature end-activation breakdown ===');
    console.log(`  Total dc_end_activation events: ${pe.totalDcEnd}`);
    console.log(`  Premature (productive-action-was-legal): ${pe.premature} (${pe.totalDcEnd > 0 ? ((pe.premature/pe.totalDcEnd)*100).toFixed(1) + '%' : 'n/a'})`);
    if (pe.premature > 0) {
      const pt = pe.premature;
      console.log(`\n  Classification (priority attack > interact > special > move):`);
      console.log(`    attack legal, declined:   ${pe.attackLegalDeclined} (${((pe.attackLegalDeclined/pt)*100).toFixed(1)}%)   P1:${pe.attackLegalDeclinedP1} P2:${pe.attackLegalDeclinedP2}`);
      console.log(`    interact legal, declined: ${pe.interactLegalDeclined} (${((pe.interactLegalDeclined/pt)*100).toFixed(1)}%)   P1:${pe.interactLegalDeclinedP1} P2:${pe.interactLegalDeclinedP2}`);
      console.log(`    special legal, declined:  ${pe.specialLegalDeclined} (${((pe.specialLegalDeclined/pt)*100).toFixed(1)}%)   P1:${pe.specialLegalDeclinedP1} P2:${pe.specialLegalDeclinedP2}`);
      console.log(`    move-only available:      ${pe.moveOnlyAvailable} (${((pe.moveOnlyAvailable/pt)*100).toFixed(1)}%)   P1:${pe.moveOnlyAvailableP1} P2:${pe.moveOnlyAvailableP2}`);
      if (pe.noLegalProductive > 0) console.log(`    no-legal-productive:      ${pe.noLegalProductive}`);
      console.log(`\n  By round: ${pe.byRound.map((n, i) => i === 0 ? null : `R${i}:${n}`).filter(x => x).join(' ')}`);
      console.log(`  By side:  P1:${pe.bySide[1]} P2:${pe.bySide[2]}  (ratio P2/P1 = ${pe.bySide[1] > 0 ? (pe.bySide[2]/pe.bySide[1]).toFixed(2) : 'n/a'})`);
      console.log(`\n  Activation history of the premature activations:`);
      console.log(`    prior attack this act: ${pe.alreadyAttackedThisAct} (${((pe.alreadyAttackedThisAct/pt)*100).toFixed(1)}%)`);
      console.log(`    prior interact this act: ${pe.alreadyInteractedThisAct} (${((pe.alreadyInteractedThisAct/pt)*100).toFixed(1)}%)`);
      console.log(`    prior move this act:   ${pe.alreadyMovedThisAct} (${((pe.alreadyMovedThisAct/pt)*100).toFixed(1)}%)`);
      console.log(`    no prior productive:   ${pe.noPriorProductiveAction} (${((pe.noPriorProductiveAction/pt)*100).toFixed(1)}%)`);
      const avgActRem = (pe.actionsRemainingSum / pt).toFixed(2);
      console.log(`  Avg actions remaining at end: ${avgActRem}`);
      const obj = pe.endedOnObjective + pe.endedAdjacentObjective + pe.endedNearObjective + pe.endedFarFromObjective;
      if (obj > 0) {
        console.log(`\n  Proximity to nearest mission-token/objective at premature-end:`);
        console.log(`    ON objective (dist=0):       ${pe.endedOnObjective} (${((pe.endedOnObjective/obj)*100).toFixed(1)}%)`);
        console.log(`    adjacent (dist ≤ 1):         ${pe.endedAdjacentObjective} (${((pe.endedAdjacentObjective/obj)*100).toFixed(1)}%)`);
        console.log(`    near (dist ≤ 3):             ${pe.endedNearObjective} (${((pe.endedNearObjective/obj)*100).toFixed(1)}%)`);
        console.log(`    far (dist > 3):              ${pe.endedFarFromObjective} (${((pe.endedFarFromObjective/obj)*100).toFixed(1)}%)`);
        console.log(`  "ON objective" by side: P1:${pe.onObjectiveAtEndP1} P2:${pe.onObjectiveAtEndP2}`);
      }
    }

    // VP-distribution / saturation check
    console.log('\n=== VP distribution ===');
    const totals = perGameResults.map(r => (r.p1VP || 0) + (r.p2VP || 0)).sort((a, b) => a - b);
    const quantile = (q) => totals[Math.max(0, Math.min(totals.length - 1, Math.floor(q * totals.length)))];
    console.log(`  min=${totals[0]}  q10=${quantile(0.1)}  q25=${quantile(0.25)}  median=${quantile(0.5)}  q75=${quantile(0.75)}  q90=${quantile(0.9)}  max=${totals[totals.length-1]}`);
    const sameVpBuckets = {};
    for (const t of totals) { const b = Math.floor(t / 10) * 10; sameVpBuckets[b] = (sameVpBuckets[b] || 0) + 1; }
    console.log(`  10-VP buckets: ${Object.entries(sameVpBuckets).sort((a, b) => Number(a[0]) - Number(b[0])).map(([b, c]) => `${b}+:${c}`).join(' ')}`);

    // Save perGameResults for offline analysis
    const dumpPath = savePath.replace(/\.json$/, '-diagnostic-games.json');
    try {
      writeFileSync(dumpPath, JSON.stringify(perGameResults.map(r => ({
        game: r.game, mapId: r.mapId, matchupLabel: r.matchupLabel, winner: r.winner,
        p1VP: r.p1VP, p2VP: r.p2VP, finalRound: r.finalRound, stopReason: r.stopReason,
        ended: r.ended, figureDefeats: r.figureDefeats,
        attackActions: r.attackActions, moveActions: r.moveActions,
        activationsWithAttack: r.activationsWithAttack, totalActivations: r.totalActivations,
        passActivations: r.passActivations, endActivations: r.endActivations,
        doorOpens: r.doorOpens, productiveActions: r.productiveActions,
        prematureEndAct: r.prematureEndAct,
        attackWhenTargetsInRange: r.attackWhenTargetsInRange,
        moveWhenTargetsInRange: r.moveWhenTargetsInRange,
        endWhenTargetsInRange: r.endWhenTargetsInRange,
        decisionsWithTargets: r.decisionsWithTargets,
        decisionsWithoutTargets: r.decisionsWithoutTargets,
        npcAttacks: r.npcAttacks, npcDefeats: r.npcDefeats,
        totalIterations: r.totalIterations,
        runawayWindowCount: r.runawayWindowCount,
        round1DistClosed: r.round1DistClosed,
      })), null, 2));
      console.log(`\nPer-game diagnostic data dumped to ${dumpPath}`);
    } catch (e) { console.log('  (could not dump per-game data: ' + e.message + ')'); }
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
    const totalDoors = perGameResults.reduce((s, r) => s + (r.doorOpens || 0), 0);
    const totalNpcAtk = perGameResults.reduce((s, r) => s + (r.npcAttacks || 0), 0);
    const totalNpcDef = perGameResults.reduce((s, r) => s + (r.npcDefeats || 0), 0);
    console.log(`Avg moves/game: ${(totalMoves / n).toFixed(1)} | Avg attacks/game: ${(totalAttacks / n).toFixed(1)} | Avg door opens/game: ${(totalDoors / n).toFixed(1)}`);
    if (totalNpcAtk > 0 || totalNpcDef > 0) {
      console.log(`Avg NPC attacks/game: ${(totalNpcAtk / n).toFixed(1)} | Avg NPC defeats/game: ${(totalNpcDef / n).toFixed(1)} | NPC attack share: ${totalAttacks > 0 ? ((totalNpcAtk / totalAttacks) * 100).toFixed(1) : 0}%`);
      const totalPush = perGameResults.reduce((s, r) => s + (r.npcPushEvents || 0), 0);
      const totalEorDmg = perGameResults.reduce((s, r) => s + (r.npcEorDamageEvents || 0), 0);
      const totalRespawn = perGameResults.reduce((s, r) => s + (r.npcRespawns || 0), 0);
      if (totalPush > 0 || totalEorDmg > 0 || totalRespawn > 0) {
        console.log(`Avg NPC push/game: ${(totalPush / n).toFixed(1)} | Avg EoR dmg/game: ${(totalEorDmg / n).toFixed(1)} | Avg respawns/game: ${(totalRespawn / n).toFixed(1)}`);
      }
    }
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

  // ── Final activation-order shadow-mode summary ────────────────────────────
  {
    const shadow = getActShadow();
    const outcome = getActOutcome();
    if (shadow.totalEligible > 0) {
      const total = shadow.totalEligible;
      const disagPct = ((shadow.disagreements / total) * 100).toFixed(1);
      console.log('\n=== Activation-Order Shadow Mode (Final) ===');
      console.log(`  Eligible: ${total} | Gated (combat-ready): ${shadow.totalGated}`);
      console.log(`  Agree: ${shadow.agreements} | Disagree: ${shadow.disagreements} (${disagPct}%)`);
      for (const [cls, data] of Object.entries(shadow.byClass)) {
        if (data.total > 0) {
          const dPct = ((data.disagree / data.total) * 100).toFixed(1);
          console.log(`  ${cls}: ${data.total} decisions, ${dPct}% disagree`);
        }
      }
      const roundParts = [];
      for (let r = 1; r <= 4; r++) {
        const rd = shadow.byRound[r];
        if (rd.total > 0) roundParts.push(`R${r}:${((rd.disagree / rd.total) * 100).toFixed(0)}%`);
      }
      if (roundParts.length > 0) console.log(`  By round: ${roundParts.join(' ')}`);
      const earlyD = shadow.byActivationsLeft.early;
      const lateD = shadow.byActivationsLeft.late;
      if (earlyD.total > 0 || lateD.total > 0) {
        const ePct = earlyD.total > 0 ? ((earlyD.disagree / earlyD.total) * 100).toFixed(0) : '0';
        const lPct = lateD.total > 0 ? ((lateD.disagree / lateD.total) * 100).toFixed(0) : '0';
        console.log(`  By activation timing: early=${ePct}% late=${lPct}%`);
      }
      if (shadow.disagreeCount > 0) {
        const fNames = ['enemyThreat','hpFraction','figureCount','minEnemyNorm','minObjNorm','attackRange','roundFrac','actLeft'];
        const avgDeltas = shadow.disagreeFeatureDeltas.map((d, i) => `${fNames[i]}:${(d / shadow.disagreeCount).toFixed(3)}`);
        console.log(`  Avg feature delta (scorer-heuristic): ${avgDeltas.join(' ')}`);
      }
      if (outcome.all.total > 0) {
        const fmtBucket = (b) => {
          if (b.total === 0) return 'n/a';
          const pcts = ['attack','interact','moveOnly','endOnly'].map(k =>
            `${k}:${((b[k] / b.total) * 100).toFixed(0)}%`).join(' ');
          return `${b.total} (${pcts})`;
        };
        console.log(`  Outcome (all eligible): ${fmtBucket(outcome.all)}`);
        console.log(`  Outcome (agree):        ${fmtBucket(outcome.agree)}`);
        console.log(`  Outcome (disagree→heur):${fmtBucket(outcome.disagreeHeuristic)}`);
      }
    }
  }

  // ── Pass-Timing Audit ─────────────────────────────────────────────────────
  {
    const allTraces = perGameResults.flatMap(r => (r.passAuditTrace || []).map(t => ({ ...t, mapId: r.mapId, matchup: r.matchupLabel, gameVP: (r.p1VP || 0) + (r.p2VP || 0) })));
    const totalLegal = perGameResults.reduce((s, r) => s + (r.passLegalTotal || 0), 0);
    const totalChosen = perGameResults.reduce((s, r) => s + (r.passChosenTotal || 0), 0);
    const totalActivated = perGameResults.reduce((s, r) => s + (r.passActivatedTotal || 0), 0);
    const totalAct = perGameResults.reduce((s, r) => s + (r.totalActivations || 0), 0);
    const n = perGameResults.length;

    if (totalLegal > 0) {
      const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : 'N/A';
      const avg = (arr) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

      console.log('\n╔══════════════════════════════════════════════════╗');
      console.log('║           PASS-TIMING AUDIT                      ║');
      console.log('╚══════════════════════════════════════════════════╝');

      // ── Section 1: Pass Opportunity Surface ──
      console.log('\n=== 1. Pass Opportunity Surface ===');
      console.log(`  Total activations: ${totalAct} across ${n} games`);
      console.log(`  Pass-legal decisions: ${totalLegal} (${pct(totalLegal, totalAct)} of activations)`);
      console.log(`  Per-game avg: ${(totalLegal / n).toFixed(1)} pass-legal decisions/game`);
      // By round
      const byRound = {};
      for (const t of allTraces) {
        const r = t.round || 1;
        if (!byRound[r]) byRound[r] = { legal: 0, chosen: 0 };
        byRound[r].legal++;
        if (t.chose === 'pass') byRound[r].chosen++;
      }
      console.log('  By round:');
      for (let r = 1; r <= 4; r++) {
        const d = byRound[r] || { legal: 0, chosen: 0 };
        if (d.legal > 0) console.log(`    R${r}: ${d.legal} opportunities, pass chosen ${pct(d.chosen, d.legal)}`);
      }
      // By activation gap (how many more activations does opponent have?)
      const byGap = {};
      for (const t of allTraces) {
        const g = t.gap || 1;
        if (!byGap[g]) byGap[g] = { legal: 0, chosen: 0 };
        byGap[g].legal++;
        if (t.chose === 'pass') byGap[g].chosen++;
      }
      console.log('  By activation gap (opp-mine):');
      for (const g of Object.keys(byGap).sort((a, b) => +a - +b)) {
        const d = byGap[g];
        console.log(`    Gap ${g}: ${d.legal} opportunities, pass chosen ${pct(d.chosen, d.legal)}`);
      }

      // ── Section 2: Pass Decision Rate ──
      console.log('\n=== 2. Pass Decision Rate ===');
      console.log(`  Pass chosen: ${totalChosen}/${totalLegal} (${pct(totalChosen, totalLegal)})`);
      console.log(`  Activated instead: ${totalActivated}/${totalLegal} (${pct(totalActivated, totalLegal)})`);
      // By VP state
      const vpBuckets = { ahead: { legal: 0, chosen: 0 }, behind: { legal: 0, chosen: 0 }, tied: { legal: 0, chosen: 0 } };
      for (const t of allTraces) {
        const bucket = t.vpDelta > 0 ? 'ahead' : t.vpDelta < 0 ? 'behind' : 'tied';
        vpBuckets[bucket].legal++;
        if (t.chose === 'pass') vpBuckets[bucket].chosen++;
      }
      console.log('  By VP state:');
      for (const [label, d] of Object.entries(vpBuckets)) {
        if (d.legal > 0) console.log(`    ${label}: ${d.chosen}/${d.legal} (${pct(d.chosen, d.legal)})`);
      }

      // ── Section 3: DQN Q-Value Analysis ──
      console.log('\n=== 3. DQN Q-Value Analysis (pass vs activate) ===');
      const withQ = allTraces.filter(t => t.qPass != null && t.qActivate != null);
      if (withQ.length > 0) {
        const qPassAvg = avg(withQ.map(t => t.qPass));
        const qActAvg = avg(withQ.map(t => t.qActivate));
        const qGapAvg = avg(withQ.map(t => t.qPass - t.qActivate));
        console.log(`  Avg Q(pass):     ${qPassAvg.toFixed(3)}`);
        console.log(`  Avg Q(activate): ${qActAvg.toFixed(3)}`);
        console.log(`  Avg gap (pass-activate): ${qGapAvg.toFixed(3)}`);
        // Q-gap when pass was chosen vs when activate was chosen
        const chosenPass = withQ.filter(t => t.chose === 'pass');
        const chosenAct = withQ.filter(t => t.chose === 'activate');
        if (chosenPass.length > 0) {
          console.log(`  When pass chosen (N=${chosenPass.length}):    avg Q-gap = ${avg(chosenPass.map(t => t.qPass - t.qActivate)).toFixed(3)}`);
        }
        if (chosenAct.length > 0) {
          console.log(`  When activate chosen (N=${chosenAct.length}): avg Q-gap = ${avg(chosenAct.map(t => t.qPass - t.qActivate)).toFixed(3)}`);
        }
        // What type did the DQN actually prefer (bestType)?
        const bestTypeCounts = {};
        for (const t of withQ) {
          const bt = t.bestType || 'unknown';
          bestTypeCounts[bt] = (bestTypeCounts[bt] || 0) + 1;
        }
        console.log('  DQN preferred type at pass-legal decisions:');
        for (const [type, count] of Object.entries(bestTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
          console.log(`    ${type}: ${count} (${pct(count, withQ.length)})`);
        }
      } else {
        console.log('  (no Q-value data — epsilon exploration may have dominated)');
      }

      // ── Section 4: Activation Outcomes When Pass Was Available ──
      console.log('\n=== 4. Activation Outcomes (when pass was legal but DC activated) ===');
      const activated = allTraces.filter(t => t.chose === 'activate');
      if (activated.length > 0) {
        const outcomes = { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, null: 0 };
        for (const t of activated) outcomes[t.activationOutcome || 'null']++;
        console.log(`  Total "activated instead of pass": ${activated.length}`);
        console.log(`  Outcomes: attack=${pct(outcomes.attack, activated.length)} interact=${pct(outcomes.interact, activated.length)} moveOnly=${pct(outcomes.moveOnly, activated.length)} endOnly=${pct(outcomes.endOnly + outcomes.null, activated.length)}`);
        console.log(`  WASTED passes (endOnly): ${outcomes.endOnly + outcomes.null}/${activated.length} (${pct(outcomes.endOnly + outcomes.null, activated.length)})`);
        // Wasted by round
        const wastedByRound = {};
        for (const t of activated) {
          if (t.activationOutcome === 'endOnly' || !t.activationOutcome) {
            const r = t.round || 1;
            wastedByRound[r] = (wastedByRound[r] || 0) + 1;
          }
        }
        if (Object.keys(wastedByRound).length > 0) {
          console.log('  Wasted by round:');
          for (let r = 1; r <= 4; r++) {
            if (wastedByRound[r]) {
              const roundAct = activated.filter(t => t.round === r).length;
              console.log(`    R${r}: ${wastedByRound[r]} wasted / ${roundAct} activated (${pct(wastedByRound[r], roundAct)})`);
            }
          }
        }
      } else {
        console.log('  (no activate-instead-of-pass decisions observed)');
      }

      // ── Section 5: Missed Obvious Pass Opportunities ──
      console.log('\n=== 5. Missed Obvious Pass Opportunities ===');
      // "Obvious" = activated a DC that did endOnly, opponent had ≥2 more activations
      const missed = activated.filter(t =>
        (t.activationOutcome === 'endOnly' || !t.activationOutcome) && t.gap >= 2
      );
      console.log(`  Obvious misses (endOnly + gap≥2): ${missed.length}`);
      if (missed.length > 0) {
        const missedDcs = {};
        for (const t of missed) {
          const dc = t.activatedDc || 'unknown';
          missedDcs[dc] = (missedDcs[dc] || 0) + 1;
        }
        console.log('  Top offending DCs:');
        for (const [dc, count] of Object.entries(missedDcs).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
          console.log(`    ${dc}: ${count} missed passes`);
        }
        // Q-values at missed decisions
        const missedWithQ = missed.filter(t => t.qPass != null);
        if (missedWithQ.length > 0) {
          console.log(`  At missed decisions: avg Q(pass)=${avg(missedWithQ.map(t => t.qPass)).toFixed(3)}, avg Q(activate)=${avg(missedWithQ.map(t => t.qActivate)).toFixed(3)}`);
        }
      }

      // ── Section 6: Board Context Analysis ──
      console.log('\n=== 6. Board Context at Pass-Legal Decisions ===');
      console.log(`  Avg wounded DCs (mine): ${avg(allTraces.map(t => t.myWounded)).toFixed(2)}`);
      console.log(`  Avg unactivated DCs (opponent): ${avg(allTraces.map(t => t.oppUnactivated)).toFixed(2)}`);
      // Pass rate when I have wounded DCs vs not
      const withWounded = allTraces.filter(t => t.myWounded > 0);
      const noWounded = allTraces.filter(t => t.myWounded === 0);
      if (withWounded.length > 0) {
        console.log(`  Pass rate when wounded: ${pct(withWounded.filter(t => t.chose === 'pass').length, withWounded.length)} (N=${withWounded.length})`);
      }
      if (noWounded.length > 0) {
        console.log(`  Pass rate when no wounded: ${pct(noWounded.filter(t => t.chose === 'pass').length, noWounded.length)} (N=${noWounded.length})`);
      }
      // Pass rate by opponent unactivated count
      const byOppUnact = {};
      for (const t of allTraces) {
        const bucket = t.oppUnactivated >= 3 ? '3+' : String(t.oppUnactivated);
        if (!byOppUnact[bucket]) byOppUnact[bucket] = { legal: 0, chosen: 0 };
        byOppUnact[bucket].legal++;
        if (t.chose === 'pass') byOppUnact[bucket].chosen++;
      }
      console.log('  Pass rate by opponent unactivated DCs:');
      for (const [bucket, d] of Object.entries(byOppUnact).sort((a, b) => +a - +b)) {
        console.log(`    ${bucket} unactivated: ${pct(d.chosen, d.legal)} (N=${d.legal})`);
      }

      // ── Section 7: Per-Map Breakdown ──
      console.log('\n=== 7. Per-Map Pass Analysis ===');
      const byMap = {};
      for (const t of allTraces) {
        const m = t.mapId || 'unknown';
        if (!byMap[m]) byMap[m] = { legal: 0, chosen: 0, wasted: 0 };
        byMap[m].legal++;
        if (t.chose === 'pass') byMap[m].chosen++;
        if (t.chose === 'activate' && (t.activationOutcome === 'endOnly' || !t.activationOutcome)) byMap[m].wasted++;
      }
      for (const [map, d] of Object.entries(byMap).sort((a, b) => b[1].legal - a[1].legal)) {
        const shortMap = map.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 25);
        console.log(`  ${shortMap}: ${d.legal} opportunities, pass=${pct(d.chosen, d.legal)}, wasted=${pct(d.wasted, d.legal - d.chosen)}`);
      }

      // ── Section 8: Outcome Correlation ──
      console.log('\n=== 8. Pass-Timing Outcome Correlation ===');
      // Group games by pass rate and compare VP
      const gamePassData = perGameResults.map(r => {
        const passRate = (r.passLegalTotal || 0) > 0 ? (r.passChosenTotal || 0) / r.passLegalTotal : null;
        const p1VP = r.p1VP || 0;
        const p2VP = r.p2VP || 0;
        return { passRate, passLegal: r.passLegalTotal || 0, passChosen: r.passChosenTotal || 0, vp: p1VP + p2VP, decisive: Math.abs(p1VP - p2VP) >= 8, mapId: r.mapId };
      }).filter(g => g.passRate !== null);
      if (gamePassData.length > 0) {
        const highPass = gamePassData.filter(g => g.passRate >= 0.5);
        const lowPass = gamePassData.filter(g => g.passRate < 0.5);
        console.log(`  Games with pass data: ${gamePassData.length}`);
        console.log(`  High-pass games (≥50% pass rate): ${highPass.length}`);
        console.log(`  Low-pass games (<50% pass rate):  ${lowPass.length}`);
        if (highPass.length > 0 && lowPass.length > 0) {
          console.log(`  Avg VP (high-pass): ${avg(highPass.map(g => g.vp)).toFixed(1)}`);
          console.log(`  Avg VP (low-pass):  ${avg(lowPass.map(g => g.vp)).toFixed(1)}`);
        }
        // Wasted-pass rate correlation with VP
        const gameWasted = perGameResults.map(r => {
          const trace = r.passAuditTrace || [];
          const activated = trace.filter(t => t.chose === 'activate');
          const wasted = activated.filter(t => t.activationOutcome === 'endOnly' || !t.activationOutcome).length;
          return { wastedRate: activated.length > 0 ? wasted / activated.length : 0, wastedCount: wasted, p1VP: r.p1VP || 0, p2VP: r.p2VP || 0 };
        }).filter(g => g.wastedCount > 0);
        if (gameWasted.length > 0) {
          const highWaste = gameWasted.filter(g => g.wastedRate >= 0.5);
          const lowWaste = gameWasted.filter(g => g.wastedRate < 0.5);
          console.log(`  Games with wasted passes: ${gameWasted.length}`);
          if (highWaste.length > 0) console.log(`  High-waste (≥50%): ${highWaste.length} games, avg total VP=${avg(highWaste.map(g => g.p1VP + g.p2VP)).toFixed(1)}`);
          if (lowWaste.length > 0) console.log(`  Low-waste (<50%):  ${lowWaste.length} games, avg total VP=${avg(lowWaste.map(g => g.p1VP + g.p2VP)).toFixed(1)}`);
        }
      } else {
        console.log('  (no games with pass-legal decisions)');
      }

      // ── Shadow Scorer Report ──────────────────────────────────────────────
      const shadow = getPassShadow();
      if (shadow.total > 0) {
        console.log('\n╔══════════════════════════════════════════════════╗');
        console.log('║       PASS-TIMING SHADOW SCORER                  ║');
        console.log('╚══════════════════════════════════════════════════╝');

        console.log('\n=== Shadow Overview ===');
        console.log(`  Total pass-legal decisions: ${shadow.total}`);
        console.log(`  Shadow says activate: ${shadow.shadowActivate} (${pct(shadow.shadowActivate, shadow.total)})`);
        console.log(`  Shadow says pass:     ${shadow.shadowPass} (${pct(shadow.shadowPass, shadow.total)})`);
        console.log(`  Agree with DQN: ${shadow.agree} (${pct(shadow.agree, shadow.total)})`);
        console.log(`  Disagree:       ${shadow.disagree} (${pct(shadow.disagree, shadow.total)})`);

        console.log('\n=== Disagreement by Map ===');
        for (const [mapKey, d] of Object.entries(shadow.byMap).sort((a, b) => b[1].total - a[1].total)) {
          const shortMap = mapKey.replace(/-/g, ' ').slice(0, 25);
          const disagPct = pct(d.disagree, d.total);
          console.log(`  ${shortMap}: ${d.total} total, ${d.disagree} disagree (${disagPct}) | shadow→act,DQN→pass: ${d.shadowActivateDqnPass} | shadow→pass,DQN→act: ${d.shadowPassDqnActivate}`);
        }

        console.log('\n=== Disagreement by Round ===');
        for (let r = 1; r <= 4; r++) {
          const d = shadow.byRound[r];
          if (d && d.total > 0) {
            console.log(`  R${r}: ${d.total} total, ${d.disagree} disagree (${pct(d.disagree, d.total)})`);
          }
        }

        console.log('\n=== Disagreement by VP State ===');
        for (const [label, d] of Object.entries(shadow.byVP)) {
          if (d.total > 0) console.log(`  ${label}: ${d.total} total, ${d.disagree} disagree (${pct(d.disagree, d.total)})`);
        }

        console.log('\n=== Disagreement by Activation Gap ===');
        for (const [gap, d] of Object.entries(shadow.byGap).sort((a, b) => +a - +b)) {
          console.log(`  Gap ${gap}: ${d.total} total, ${d.disagree} disagree (${pct(d.disagree, d.total)})`);
        }

        console.log('\n=== Disagreement by Wounded State ===');
        for (const [label, d] of Object.entries(shadow.byWounded)) {
          if (d.total > 0) console.log(`  ${label === 'yes' ? 'Has wounded DCs' : 'No wounded DCs'}: ${d.total} total, ${d.disagree} disagree (${pct(d.disagree, d.total)})`);
        }

        console.log('\n=== Disagreement by Productive Availability ===');
        for (const [label, d] of Object.entries(shadow.byProductive)) {
          if (d.total > 0) console.log(`  ${label === 'yes' ? 'Can attack' : 'No attack available'}: ${d.total} total, ${d.disagree} disagree (${pct(d.disagree, d.total)})`);
        }

        console.log('\n=== Feature Averages (Agree vs Disagree) ===');
        if (shadow.agreeCount > 0 && shadow.disagreeCount > 0) {
          for (let i = 0; i < PASS_FEATURE_NAMES.length; i++) {
            const agreeAvg = (shadow.agreeFeatureSum[i] / shadow.agreeCount).toFixed(3);
            const disagreeAvg = (shadow.disagreeFeatureSum[i] / shadow.disagreeCount).toFixed(3);
            const delta = (shadow.disagreeFeatureSum[i] / shadow.disagreeCount - shadow.agreeFeatureSum[i] / shadow.agreeCount).toFixed(3);
            console.log(`  ${PASS_FEATURE_NAMES[i].padEnd(18)} agree=${agreeAvg}  disagree=${disagreeAvg}  delta=${delta}`);
          }
        }

        // Outcome proxy: for traces where shadow and DQN disagreed, what happened?
        console.log('\n=== Outcome Proxy: Shadow-Activate, DQN-Pass ===');
        const shadowActDqnPass = allTraces.filter(t => t.shadowChoice === 'activate' && t.chose === 'pass');
        console.log(`  Count: ${shadowActDqnPass.length}`);
        if (shadowActDqnPass.length > 0) {
          const withAttack = shadowActDqnPass.filter(t => t.myWounded > 0 || t.oppUnactivated <= 1);
          console.log(`  Context: ${withAttack.length} had wounded DCs or few opp unactivated (likely good to activate)`);
          // Can't know outcome since DQN passed — estimate via "was productive activation available"
          // Use shadow features: bestDcCanAttack was set
          const couldAttack = shadowActDqnPass.filter(t => {
            // We stored shadow score — if bestDcCanAttack contributed, score would be higher
            // Rough proxy: shadow score > 0.5 means strong activate signal
            return t.shadowScore != null && t.shadowScore > 0.5;
          });
          console.log(`  Strong activate signal (score>0.5): ${couldAttack.length} (${pct(couldAttack.length, shadowActDqnPass.length)})`);
        }

        console.log('\n=== Outcome Proxy: Shadow-Pass, DQN-Activate ===');
        const shadowPassDqnAct = allTraces.filter(t => t.shadowChoice === 'pass' && t.chose === 'activate');
        console.log(`  Count: ${shadowPassDqnAct.length}`);
        if (shadowPassDqnAct.length > 0) {
          const outcomes = { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, null: 0 };
          for (const t of shadowPassDqnAct) outcomes[t.activationOutcome || 'null']++;
          console.log(`  Activation outcomes: attack=${pct(outcomes.attack, shadowPassDqnAct.length)} interact=${pct(outcomes.interact, shadowPassDqnAct.length)} moveOnly=${pct(outcomes.moveOnly, shadowPassDqnAct.length)} endOnly=${pct(outcomes.endOnly + outcomes.null, shadowPassDqnAct.length)}`);
          console.log(`  Wasted (endOnly): ${outcomes.endOnly + outcomes.null}/${shadowPassDqnAct.length} — shadow was RIGHT to prefer pass`);
        }
      }
    }

    // ── Pass-Timing A/B Report ──────────────────────────────────────────────
    if (passAbMode) {
      const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : 'N/A';
      const controlGames = perGameResults.filter(r => r.passAbGroup === 'control');
      const treatmentGames = perGameResults.filter(r => r.passAbGroup === 'treatment');
      console.log('\n╔══════════════════════════════════════════════════╗');
      console.log('║       PASS-TIMING A/B CONTROL TEST               ║');
      console.log('╚══════════════════════════════════════════════════╝');

      const grpStats = (games, label) => {
        const n = games.length;
        if (n === 0) return null;
        const vps = games.map(g => (g.p1VP || 0) + (g.p2VP || 0));
        const avgVP = vps.reduce((a, b) => a + b, 0) / n;
        const completed = games.filter(g => g.ended).length;
        const decisive = games.filter(g => Math.abs((g.p1VP || 0) - (g.p2VP || 0)) >= 8).length;
        const roundCap = games.filter(g => (g.finalRound || 1) >= 4 && g.ended).length;
        const traces = games.flatMap(g => (g.passAuditTrace || []).map(t => ({ ...t, mapId: g.mapId, gameVP: (g.p1VP || 0) + (g.p2VP || 0) })));
        const passLegal = traces.length;
        const passChosen = traces.filter(t => t.chose === 'pass').length;
        const activated = traces.filter(t => t.chose === 'activate');
        const nonProd = activated.filter(t => t.activationOutcome === 'moveOnly' || t.activationOutcome === 'endOnly' || !t.activationOutcome);
        const attacks = activated.filter(t => t.activationOutcome === 'attack');
        const interacts = activated.filter(t => t.activationOutcome === 'interact');
        const overrideCount = traces.filter(t => t.overridden).length;
        return { label, n, avgVP, completed, decisive, roundCap, passLegal, passChosen, activated: activated.length, nonProd: nonProd.length, attacks: attacks.length, interacts: interacts.length, overrideCount, traces, vps };
      };

      const c = grpStats(controlGames, 'Control');
      const t = grpStats(treatmentGames, 'Treatment');

      if (c && t) {
        console.log('\n=== Aggregate: Control vs Treatment ===');
        console.log(`  ${' '.padEnd(22)} ${'Control'.padEnd(16)} ${'Treatment'.padEnd(16)} Delta`);
        console.log(`  ${'Games'.padEnd(22)} ${String(c.n).padEnd(16)} ${String(t.n).padEnd(16)}`);
        console.log(`  ${'Avg VP/game'.padEnd(22)} ${c.avgVP.toFixed(1).padEnd(16)} ${t.avgVP.toFixed(1).padEnd(16)} ${(t.avgVP - c.avgVP) >= 0 ? '+' : ''}${(t.avgVP - c.avgVP).toFixed(1)}`);
        const cVPperRound = c.avgVP / 4; const tVPperRound = t.avgVP / 4;
        console.log(`  ${'Avg VP/round'.padEnd(22)} ${cVPperRound.toFixed(2).padEnd(16)} ${tVPperRound.toFixed(2).padEnd(16)} ${(tVPperRound - cVPperRound) >= 0 ? '+' : ''}${(tVPperRound - cVPperRound).toFixed(2)}`);
        console.log(`  ${'Completion'.padEnd(22)} ${pct(c.completed, c.n).padEnd(16)} ${pct(t.completed, t.n).padEnd(16)}`);
        console.log(`  ${'Decisive rate'.padEnd(22)} ${pct(c.decisive, c.n).padEnd(16)} ${pct(t.decisive, t.n).padEnd(16)}`);
        console.log(`  ${'Round-cap rate'.padEnd(22)} ${pct(c.roundCap, c.completed).padEnd(16)} ${pct(t.roundCap, t.completed).padEnd(16)}`);
        console.log(`  ${'Pass-legal decisions'.padEnd(22)} ${String(c.passLegal).padEnd(16)} ${String(t.passLegal).padEnd(16)}`);
        console.log(`  ${'Pass rate'.padEnd(22)} ${pct(c.passChosen, c.passLegal).padEnd(16)} ${pct(t.passChosen, t.passLegal).padEnd(16)}`);
        console.log(`  ${'Activated rate'.padEnd(22)} ${pct(c.activated, c.passLegal).padEnd(16)} ${pct(t.activated, t.passLegal).padEnd(16)}`);
        console.log(`  ${'Non-productive rate'.padEnd(22)} ${pct(c.nonProd, c.activated).padEnd(16)} ${pct(t.nonProd, t.activated).padEnd(16)}`);
        console.log(`  ${'Attack rate'.padEnd(22)} ${pct(c.attacks, c.activated).padEnd(16)} ${pct(t.attacks, t.activated).padEnd(16)}`);
        console.log(`  ${'Interact rate'.padEnd(22)} ${pct(c.interacts, c.activated).padEnd(16)} ${pct(t.interacts, t.activated).padEnd(16)}`);
        console.log(`  ${'Overrides'.padEnd(22)} ${String(c.overrideCount).padEnd(16)} ${String(t.overrideCount).padEnd(16)}`);

        // ── bestDcCanAttack validation ──
        console.log('\n=== bestDcCanAttack Validation ===');
        const allT = [...c.traces, ...t.traces];
        const canAtkActivated = allT.filter(tr => tr.bestDcCanAttack && tr.chose === 'activate');
        const cantAtkActivated = allT.filter(tr => !tr.bestDcCanAttack && tr.chose === 'activate');
        if (canAtkActivated.length > 0) {
          const atkWhenCan = canAtkActivated.filter(tr => tr.activationOutcome === 'attack').length;
          console.log(`  bestDcCanAttack=true  → activated ${canAtkActivated.length}, actually attacked: ${atkWhenCan} (${pct(atkWhenCan, canAtkActivated.length)})`);
        }
        if (cantAtkActivated.length > 0) {
          const atkWhenCant = cantAtkActivated.filter(tr => tr.activationOutcome === 'attack').length;
          console.log(`  bestDcCanAttack=false → activated ${cantAtkActivated.length}, actually attacked: ${atkWhenCant} (${pct(atkWhenCant, cantAtkActivated.length)})`);
        }
        // Outcome breakdown for bestDcCanAttack=true activations
        if (canAtkActivated.length > 0) {
          const o = { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, null: 0 };
          for (const tr of canAtkActivated) o[tr.activationOutcome || 'null']++;
          console.log(`  canAttack=true outcomes: attack=${pct(o.attack, canAtkActivated.length)} interact=${pct(o.interact, canAtkActivated.length)} moveOnly=${pct(o.moveOnly, canAtkActivated.length)} endOnly=${pct(o.endOnly + o.null, canAtkActivated.length)}`);
        }

        // ── Breakdown by map ──
        console.log('\n=== Results by Map ===');
        const mapNames = [...new Set(perGameResults.map(r => r.mapId))].sort();
        for (const m of mapNames) {
          const cMap = controlGames.filter(g => g.mapId === m);
          const tMap = treatmentGames.filter(g => g.mapId === m);
          const cVP = cMap.length > 0 ? cMap.reduce((s, g) => s + (g.p1VP || 0) + (g.p2VP || 0), 0) / cMap.length : 0;
          const tVP = tMap.length > 0 ? tMap.reduce((s, g) => s + (g.p1VP || 0) + (g.p2VP || 0), 0) / tMap.length : 0;
          const shortMap = m.replace(/-/g, ' ').slice(0, 22);
          console.log(`  ${shortMap.padEnd(24)} C: ${cMap.length}g, VP=${cVP.toFixed(1)} | T: ${tMap.length}g, VP=${tVP.toFixed(1)} | delta=${(tVP - cVP) >= 0 ? '+' : ''}${(tVP - cVP).toFixed(1)}`);
        }

        // ── Breakdown by round ──
        console.log('\n=== Results by Round ===');
        for (let r = 1; r <= 4; r++) {
          const cRound = c.traces.filter(tr => tr.round === r);
          const tRound = t.traces.filter(tr => tr.round === r);
          const cPassR = cRound.filter(tr => tr.chose === 'pass').length;
          const tPassR = tRound.filter(tr => tr.chose === 'pass').length;
          const cActR = cRound.filter(tr => tr.chose === 'activate');
          const tActR = tRound.filter(tr => tr.chose === 'activate');
          const cNonProdR = cActR.filter(tr => tr.activationOutcome === 'moveOnly' || tr.activationOutcome === 'endOnly' || !tr.activationOutcome).length;
          const tNonProdR = tActR.filter(tr => tr.activationOutcome === 'moveOnly' || tr.activationOutcome === 'endOnly' || !tr.activationOutcome).length;
          console.log(`  R${r}: C pass=${pct(cPassR, cRound.length)} nonProd=${pct(cNonProdR, cActR.length)} (N=${cRound.length}) | T pass=${pct(tPassR, tRound.length)} nonProd=${pct(tNonProdR, tActR.length)} (N=${tRound.length})`);
        }

        // ── Breakdown by VP state ──
        console.log('\n=== Results by VP State ===');
        for (const vpLabel of ['ahead', 'behind', 'tied']) {
          const vpFilter = (tr) => vpLabel === 'ahead' ? tr.vpDelta > 0 : vpLabel === 'behind' ? tr.vpDelta < 0 : tr.vpDelta === 0;
          const cVP2 = c.traces.filter(vpFilter);
          const tVP2 = t.traces.filter(vpFilter);
          const cPassVP = cVP2.filter(tr => tr.chose === 'pass').length;
          const tPassVP = tVP2.filter(tr => tr.chose === 'pass').length;
          console.log(`  ${vpLabel.padEnd(8)} C: pass=${pct(cPassVP, cVP2.length)} (N=${cVP2.length}) | T: pass=${pct(tPassVP, tVP2.length)} (N=${tVP2.length})`);
        }

        // ── Breakdown by wounded state ──
        console.log('\n=== Results by Wounded State ===');
        for (const wLabel of ['wounded', 'not_wounded']) {
          const wFilter = (tr) => wLabel === 'wounded' ? tr.myWounded > 0 : tr.myWounded === 0;
          const cW = c.traces.filter(wFilter);
          const tW = t.traces.filter(wFilter);
          const cPassW = cW.filter(tr => tr.chose === 'pass').length;
          const tPassW = tW.filter(tr => tr.chose === 'pass').length;
          const cActW = cW.filter(tr => tr.chose === 'activate');
          const tActW = tW.filter(tr => tr.chose === 'activate');
          const cAtkW = cActW.filter(tr => tr.activationOutcome === 'attack').length;
          const tAtkW = tActW.filter(tr => tr.activationOutcome === 'attack').length;
          console.log(`  ${wLabel.padEnd(14)} C: pass=${pct(cPassW, cW.length)}, atk=${pct(cAtkW, cActW.length)} (N=${cW.length}) | T: pass=${pct(tPassW, tW.length)}, atk=${pct(tAtkW, tActW.length)} (N=${tW.length})`);
        }

        // ── Breakdown by bestDcCanAttack ──
        console.log('\n=== Results by Attack Readiness ===');
        for (const atkLabel of ['can_attack', 'no_attack']) {
          const aFilter = (tr) => atkLabel === 'can_attack' ? tr.bestDcCanAttack : !tr.bestDcCanAttack;
          const cA = c.traces.filter(aFilter);
          const tA = t.traces.filter(aFilter);
          const cPassA = cA.filter(tr => tr.chose === 'pass').length;
          const tPassA = tA.filter(tr => tr.chose === 'pass').length;
          const cActA = cA.filter(tr => tr.chose === 'activate');
          const tActA = tA.filter(tr => tr.chose === 'activate');
          const cAtkA = cActA.filter(tr => tr.activationOutcome === 'attack').length;
          const tAtkA = tActA.filter(tr => tr.activationOutcome === 'attack').length;
          const cNProdA = cActA.filter(tr => tr.activationOutcome === 'moveOnly' || tr.activationOutcome === 'endOnly' || !tr.activationOutcome).length;
          const tNProdA = tActA.filter(tr => tr.activationOutcome === 'moveOnly' || tr.activationOutcome === 'endOnly' || !tr.activationOutcome).length;
          console.log(`  ${atkLabel.padEnd(14)} C: pass=${pct(cPassA, cA.length)}, act=${cActA.length}, atk=${pct(cAtkA, cActA.length)}, nonProd=${pct(cNProdA, cActA.length)} (N=${cA.length}) | T: pass=${pct(tPassA, tA.length)}, act=${tActA.length}, atk=${pct(tAtkA, tActA.length)}, nonProd=${pct(tNProdA, tActA.length)} (N=${tA.length})`);
        }

        // ── Statistical significance hint ──
        console.log('\n=== Statistical Significance ===');
        const cMean = c.avgVP, tMean = t.avgVP;
        const cVar = c.vps.reduce((s, v) => s + (v - cMean) ** 2, 0) / (c.n - 1);
        const tVar = t.vps.reduce((s, v) => s + (v - tMean) ** 2, 0) / (t.n - 1);
        const pooledSE = Math.sqrt(cVar / c.n + tVar / t.n);
        const tStat = pooledSE > 0 ? (tMean - cMean) / pooledSE : 0;
        console.log(`  VP difference: ${(tMean - cMean).toFixed(1)} (treatment - control)`);
        console.log(`  Control: mean=${cMean.toFixed(1)}, std=${Math.sqrt(cVar).toFixed(1)}, N=${c.n}`);
        console.log(`  Treatment: mean=${tMean.toFixed(1)}, std=${Math.sqrt(tVar).toFixed(1)}, N=${t.n}`);
        console.log(`  t-statistic: ${tStat.toFixed(2)} (pooled SE=${pooledSE.toFixed(2)})`);
        console.log(`  |t| > 1.96 → p < 0.05: ${Math.abs(tStat) > 1.96 ? 'YES' : 'NO'}`);
      }
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
        const featureNames = ['distToNearestEnemy', 'threatAtDest', 'objectiveProximity', 'allySupport', 'mpEfficiency', 'bias', 'destInEnemyRange', 'destOnObjective', 'destAdjacentToAlly', 'canAttackFromDest', 'bestReachableKillFraction', 'reachableUnactivatedFraction', 'netDamageDelta', 'attackActionFeasibleAfterMove', 'losTargetCountNorm'];
        const qualityW = [0.40, 0.10, 0.25, -0.05, 0.10, 0.0, 0.10, 0.30, -0.10, 0.20, 0.30, 0.10, 0.20, 0.15, 0.10];
        console.log(`\n  Per-feature gap breakdown (${suboptimal.length} suboptimal moves):`);
        console.log(`  ${'Feature'.padEnd(22)} ${'AvgChosen'.padStart(10)} ${'AvgRefBest'.padStart(10)} ${'AvgDiff'.padStart(10)} ${'QualW'.padStart(7)} ${'WtdGap'.padStart(10)}`);
        console.log(`  ${'─'.repeat(22)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(7)} ${'─'.repeat(10)}`);
        for (let i = 0; i < 15; i++) {
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

    // ── RULES INVARIANT VIOLATIONS ──────────────────────────────────────
    const allRulesViolations = [];
    let totalHandlerErrors = 0;
    for (const r of perGameResults) {
      allRulesViolations.push(...(r.rulesViolations || []));
      totalHandlerErrors += r.handlerErrors || 0;
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log('  RULES INVARIANT VIOLATIONS');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Total violations: ${allRulesViolations.length}`);
    console.log(`  Handler errors (RT-HE): ${totalHandlerErrors}`);
    console.log(`  Games with violations: ${perGameResults.filter(r => (r.rulesViolations || []).length > 0).length}/${perGameResults.length}`);

    if (allRulesViolations.length > 0) {
      // By invariant ID
      const byId = {};
      for (const v of allRulesViolations) {
        byId[v.id] = (byId[v.id] || 0) + 1;
      }
      console.log('\n  By invariant ID:');
      for (const [id, cnt] of Object.entries(byId).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${id}: ${cnt}`);
      }

      // By severity
      const bySev = {};
      for (const v of allRulesViolations) {
        bySev[v.severity] = (bySev[v.severity] || 0) + 1;
      }
      console.log('\n  By severity:');
      for (const sev of ['critical', 'high', 'medium', 'low']) {
        if (bySev[sev]) console.log(`    ${sev}: ${bySev[sev]}`);
      }

      // By domain
      const byDomain = {};
      for (const v of allRulesViolations) {
        byDomain[v.domain] = (byDomain[v.domain] || 0) + 1;
      }
      console.log('\n  By domain:');
      for (const [domain, cnt] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${domain}: ${cnt}`);
      }

      // Pre-action vs post-action
      const preCount = allRulesViolations.filter(v => v.contextType === 'pre_action').length;
      const postCount = allRulesViolations.filter(v => v.contextType === 'post_action').length;
      console.log(`\n  Pre-action violations: ${preCount}`);
      console.log(`  Post-action violations: ${postCount}`);

      // First occurrence context for each ID
      console.log('\n  First occurrence per invariant ID:');
      const seen = new Set();
      for (const v of allRulesViolations) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        const ctx = [
          `R${v.round}`,
          v.phase,
          v.roundPhase !== '?' ? v.roundPhase : null,
          v.contextType,
          v.actionType ? `action=${v.actionType}` : null,
          v.figureKey ? `fig=${v.figureKey}` : null,
          v.playerNum ? `P${v.playerNum}` : null,
        ].filter(Boolean).join(', ');
        console.log(`    ${v.id} [${v.severity}] ${v.domain}`);
        console.log(`      ${v.message}`);
        console.log(`      context: ${ctx}`);
      }
    } else {
      console.log('  No rules violations detected.');
    }
  }

  // ── Move-Quality Diagnostic Report ──────────────────────────────────────────
  if (moveAuditMode) {
    const allMoves = perGameResults.flatMap(r => (r.moveAuditTrace || []).map(t => ({ ...t, mapId: r.mapId, gameVP: (r.p1VP || 0) + (r.p2VP || 0) })));
    const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : 'N/A';
    const avg = (arr) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const FEAT_NAMES = ['distToNearestEnemy', 'threatAtDest', 'objectiveProximity', 'allySupport', 'mpEfficiency', 'bias', 'destInEnemyRange', 'destOnObjective', 'destAdjacentToAlly', 'canAttackFromDest', 'bestReachableKillFraction', 'reachableUnactivatedFraction', 'netDamageDelta', 'attackActionFeasibleAfterMove', 'losTargetCountNorm'];
    const QUALITY_W = [0.40, 0.10, 0.25, -0.05, 0.10, 0.0, 0.10, 0.30, -0.10, 0.20, 0.30, 0.10, 0.20, 0.15, 0.10];

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║              MOVE-QUALITY DIAGNOSTIC AUDIT                       ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    // ── Section 1: Why move quality is now the highest-ROI lane ──
    console.log('\n=== 1. Move Decision Surface ===');
    console.log(`  Total move decisions traced: ${allMoves.length} across ${perGameResults.length} games`);
    console.log(`  Avg moves/game: ${(allMoves.length / Math.max(1, perGameResults.length)).toFixed(1)}`);
    const withGap = allMoves.filter(m => m.gap != null);
    const withOutcome = allMoves.filter(m => m.activationOutcome != null);
    console.log(`  With quality gap data: ${withGap.length} (${pct(withGap.length, allMoves.length)})`);
    console.log(`  With activation outcome: ${withOutcome.length} (${pct(withOutcome.length, allMoves.length)})`);
    const avgCandidates = avg(allMoves.map(m => m.candidateCount));
    console.log(`  Avg candidate spaces/decision: ${avgCandidates.toFixed(1)}`);

    // ── Section 2: Current move-scorer state ──
    console.log('\n=== 2. Current Move-Scorer Weights ===');
    try {
      // Read from the active run's checkpoint (savePath), not the live file, so
      // the displayed weights match the audit the report is summarizing.
      const mw = JSON.parse(readFileSync(savePath, 'utf8')).withinGroupWeights?.move;
      if (mw) {
        for (let i = 0; i < FEAT_NAMES.length; i++) {
          const w = mw[i] ?? 0;
          const saturated = Math.abs(w) >= 9.5 ? ' *** SATURATED ***' : '';
          const dead = Math.abs(w) < 0.1 ? ' (dead)' : '';
          console.log(`    ${FEAT_NAMES[i].padEnd(22)} w=${w.toFixed(4).padStart(8)}  qualityW=${QUALITY_W[i].toFixed(2).padStart(6)}${saturated}${dead}`);
        }
      }
    } catch { console.log('  (could not load weights)'); }

    // ── Section 3: Quality-gap results ──
    console.log('\n=== 3. Quality-Gap Distribution ===');
    if (withGap.length > 0) {
      const gaps = withGap.map(m => m.gap);
      const optimal = withGap.filter(m => m.gap < 0.001);
      const nearZero = gaps.filter(g => g >= 0 && g < 0.01);
      const small = gaps.filter(g => g >= 0.01 && g < 0.05);
      const moderate = gaps.filter(g => g >= 0.05 && g < 0.15);
      const large = gaps.filter(g => g >= 0.15);
      console.log(`  Chose reference-optimal destination: ${optimal.length}/${withGap.length} (${pct(optimal.length, withGap.length)})`);
      console.log(`  Quality-gap buckets:`);
      console.log(`    Near-zero (<0.01):   ${nearZero.length} (${pct(nearZero.length, withGap.length)})`);
      console.log(`    Small (0.01-0.05):   ${small.length} (${pct(small.length, withGap.length)})`);
      console.log(`    Moderate (0.05-0.15): ${moderate.length} (${pct(moderate.length, withGap.length)})`);
      console.log(`    Large (>0.15):       ${large.length} (${pct(large.length, withGap.length)})`);
      console.log(`  Avg gap: ${avg(gaps).toFixed(4)}  Median gap: ${gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)].toFixed(4)}  Max gap: ${Math.max(...gaps).toFixed(4)}`);

      // Quality gap by round
      console.log('\n  Quality gap by round:');
      for (let r = 1; r <= 4; r++) {
        const rMoves = withGap.filter(m => m.round === r);
        if (rMoves.length === 0) continue;
        const rGaps = rMoves.map(m => m.gap);
        const rOptimal = rMoves.filter(m => m.gap < 0.001);
        console.log(`    R${r}: ${rMoves.length} moves, avg gap=${avg(rGaps).toFixed(4)}, optimal=${pct(rOptimal.length, rMoves.length)} (N=${rMoves.length})`);
      }

      // Per-feature gap breakdown (suboptimal moves only)
      const subopt = withGap.filter(m => m.gap >= 0.01 && m.chosenFeatures && m.refBestFeatures);
      if (subopt.length > 0) {
        console.log(`\n  Per-feature gap (${subopt.length} suboptimal moves):`);
        console.log(`  ${'Feature'.padEnd(22)} ${'AvgChosen'.padStart(10)} ${'AvgRefBest'.padStart(10)} ${'Diff'.padStart(10)} ${'QualW'.padStart(7)} ${'WtdGap'.padStart(10)}`);
        const contribs = [];
        for (let i = 0; i < 15; i++) {
          const ac = avg(subopt.map(m => m.chosenFeatures[i] || 0));
          const ab = avg(subopt.map(m => m.refBestFeatures[i] || 0));
          const diff = ab - ac;
          const wtd = diff * QUALITY_W[i];
          contribs.push({ name: FEAT_NAMES[i], absWtd: Math.abs(wtd) });
          console.log(`  ${FEAT_NAMES[i].padEnd(22)} ${ac.toFixed(4).padStart(10)} ${ab.toFixed(4).padStart(10)} ${(diff >= 0 ? '+' : '') + diff.toFixed(4).padStart(9)} ${QUALITY_W[i].toFixed(2).padStart(7)} ${(wtd >= 0 ? '+' : '') + wtd.toFixed(4).padStart(9)}`);
        }
        contribs.sort((a, b) => b.absWtd - a.absWtd);
        console.log(`\n  Top gap contributors: ${contribs.slice(0, 3).map(c => `${c.name}(${c.absWtd.toFixed(4)})`).join(', ')}`);
      }
    } else {
      console.log('  No quality-gap data available.');
    }

    // ── Section 4: Action-conversion results ──
    console.log('\n=== 4. Action Conversion After Move ===');
    if (withOutcome.length > 0) {
      const atkAfter = withOutcome.filter(m => m.activationOutcome === 'attack');
      const intAfter = withOutcome.filter(m => m.activationOutcome === 'interact');
      const moveOnlyAfter = withOutcome.filter(m => m.activationOutcome === 'moveOnly');
      const endOnlyAfter = withOutcome.filter(m => m.activationOutcome === 'endOnly');
      console.log(`  Activation outcomes for moves with traces:`);
      console.log(`    attack:    ${atkAfter.length} (${pct(atkAfter.length, withOutcome.length)})`);
      console.log(`    interact:  ${intAfter.length} (${pct(intAfter.length, withOutcome.length)})`);
      console.log(`    moveOnly:  ${moveOnlyAfter.length} (${pct(moveOnlyAfter.length, withOutcome.length)})`);
      console.log(`    endOnly:   ${endOnlyAfter.length} (${pct(endOnlyAfter.length, withOutcome.length)})`);
      const productive = atkAfter.length + intAfter.length;
      console.log(`  Productive conversion rate (attack+interact): ${pct(productive, withOutcome.length)}`);

      // Quality gap correlated with outcome
      const withGapAndOutcome = withOutcome.filter(m => m.gap != null);
      if (withGapAndOutcome.length > 0) {
        console.log('\n  Avg quality gap by outcome:');
        for (const outcome of ['attack', 'interact', 'moveOnly', 'endOnly']) {
          const subset = withGapAndOutcome.filter(m => m.activationOutcome === outcome);
          if (subset.length > 0) {
            console.log(`    ${outcome.padEnd(12)} avg gap=${avg(subset.map(m => m.gap)).toFixed(4)}, avg chosenQ=${avg(subset.map(m => m.chosenQuality)).toFixed(4)}, avg refBestQ=${avg(subset.map(m => m.refBestQuality)).toFixed(4)} (N=${subset.length})`);
          }
        }
      }

      // Conversion rate by round
      console.log('\n  Conversion rate by round:');
      for (let r = 1; r <= 4; r++) {
        const rMoves = withOutcome.filter(m => m.round === r);
        if (rMoves.length === 0) continue;
        const rAtk = rMoves.filter(m => m.activationOutcome === 'attack').length;
        const rInt = rMoves.filter(m => m.activationOutcome === 'interact').length;
        const rProd = rAtk + rInt;
        console.log(`    R${r}: ${pct(rProd, rMoves.length)} productive (atk=${pct(rAtk, rMoves.length)}, int=${pct(rInt, rMoves.length)}) N=${rMoves.length}`);
      }
    } else {
      console.log('  No outcome data available.');
    }

    // ── Section 5: Saturation/pathology slices ──
    console.log('\n=== 5. Saturation & Pathology Slices ===');
    const withFeatsAndOutcome = allMoves.filter(m => m.chosenFeatures && m.activationOutcome);
    if (withFeatsAndOutcome.length > 0) {
      // destOnObjective=1 slice
      const onObj = withFeatsAndOutcome.filter(m => m.chosenFeatures[7] >= 0.5);
      const offObj = withFeatsAndOutcome.filter(m => m.chosenFeatures[7] < 0.5);
      console.log(`\n  destOnObjective=1 (${onObj.length} moves):`);
      if (onObj.length > 0) {
        const onObjAtk = onObj.filter(m => m.activationOutcome === 'attack').length;
        const onObjInt = onObj.filter(m => m.activationOutcome === 'interact').length;
        const onObjProd = onObjAtk + onObjInt;
        console.log(`    Conversion: ${pct(onObjProd, onObj.length)} productive (atk=${pct(onObjAtk, onObj.length)}, int=${pct(onObjInt, onObj.length)})`);
        const onObjGaps = onObj.filter(m => m.gap != null);
        if (onObjGaps.length > 0) console.log(`    Avg gap: ${avg(onObjGaps.map(m => m.gap)).toFixed(4)}`);
      }
      console.log(`  destOnObjective=0 (${offObj.length} moves):`);
      if (offObj.length > 0) {
        const offObjAtk = offObj.filter(m => m.activationOutcome === 'attack').length;
        const offObjInt = offObj.filter(m => m.activationOutcome === 'interact').length;
        const offObjProd = offObjAtk + offObjInt;
        console.log(`    Conversion: ${pct(offObjProd, offObj.length)} productive (atk=${pct(offObjAtk, offObj.length)}, int=${pct(offObjInt, offObj.length)})`);
        const offObjGaps = offObj.filter(m => m.gap != null);
        if (offObjGaps.length > 0) console.log(`    Avg gap: ${avg(offObjGaps.map(m => m.gap)).toFixed(4)}`);
      }

      // destInEnemyRange slice
      const inRange = withFeatsAndOutcome.filter(m => m.chosenFeatures[6] > 0);
      const notInRange = withFeatsAndOutcome.filter(m => m.chosenFeatures[6] === 0);
      console.log(`\n  destInEnemyRange>0 (${inRange.length} moves):`);
      if (inRange.length > 0) {
        const irAtk = inRange.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(irAtk, inRange.length)}`);
      }
      console.log(`  destInEnemyRange=0 (${notInRange.length} moves):`);
      if (notInRange.length > 0) {
        const nirAtk = notInRange.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(nirAtk, notInRange.length)}`);
      }

      // threatAtDest slice
      const highThreat = withFeatsAndOutcome.filter(m => m.chosenFeatures[1] > 0.1);
      const lowThreat = withFeatsAndOutcome.filter(m => m.chosenFeatures[1] <= 0.1);
      console.log(`\n  threatAtDest>0.1 (${highThreat.length} moves):`);
      if (highThreat.length > 0) {
        const htAtk = highThreat.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(htAtk, highThreat.length)}`);
      }
      console.log(`  threatAtDest<=0.1 (${lowThreat.length} moves):`);
      if (lowThreat.length > 0) {
        const ltAtk = lowThreat.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(ltAtk, lowThreat.length)}`);
      }

      // allySupport slice
      const hasAlly = withFeatsAndOutcome.filter(m => m.chosenFeatures[8] >= 0.5);
      const noAlly = withFeatsAndOutcome.filter(m => m.chosenFeatures[8] < 0.5);
      console.log(`\n  destAdjacentToAlly=1 (${hasAlly.length} moves):`);
      if (hasAlly.length > 0) {
        const allyAtk = hasAlly.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(allyAtk, hasAlly.length)}`);
      }
      console.log(`  destAdjacentToAlly=0 (${noAlly.length} moves):`);
      if (noAlly.length > 0) {
        const noAllyAtk = noAlly.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(noAllyAtk, noAlly.length)}`);
      }

      // distToNearestEnemy high vs low
      const closeEnemy = withFeatsAndOutcome.filter(m => m.chosenFeatures[0] >= 0.7);
      const farEnemy = withFeatsAndOutcome.filter(m => m.chosenFeatures[0] < 0.3);
      console.log(`\n  distToNearestEnemy>=0.7 (close, ${closeEnemy.length} moves):`);
      if (closeEnemy.length > 0) {
        const ceAtk = closeEnemy.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(ceAtk, closeEnemy.length)}`);
      }
      console.log(`  distToNearestEnemy<0.3 (far, ${farEnemy.length} moves):`);
      if (farEnemy.length > 0) {
        const feAtk = farEnemy.filter(m => m.activationOutcome === 'attack').length;
        console.log(`    Attack conversion: ${pct(feAtk, farEnemy.length)}`);
      }

      // Per-map breakdown
      const mapNames = [...new Set(allMoves.map(m => m.mapId))].sort();
      if (mapNames.length > 1) {
        console.log('\n  Per-map move quality:');
        for (const m of mapNames) {
          const mm = withFeatsAndOutcome.filter(t => t.mapId === m);
          const mmGap = mm.filter(t => t.gap != null);
          const mmAtk = mm.filter(t => t.activationOutcome === 'attack').length;
          const shortMap = m.replace(/-/g, ' ').slice(0, 22);
          console.log(`    ${shortMap.padEnd(24)} N=${mm.length}, avgGap=${mmGap.length > 0 ? avg(mmGap.map(t => t.gap)).toFixed(4) : 'N/A'}, atkConv=${pct(mmAtk, mm.length)}`);
        }
      }
    } else {
      console.log('  No feature+outcome data available.');
    }

    // ── Section 6: Where the scorer is clearly misbehaving ──
    console.log('\n=== 6. Scorer Pathology Analysis ===');
    if (withGap.length > 0) {
      // Large-gap analysis: what features distinguish large-gap decisions?
      const largeGap = withGap.filter(m => m.gap >= 0.15 && m.chosenFeatures && m.refBestFeatures);
      const smallGap = withGap.filter(m => m.gap < 0.01 && m.chosenFeatures);
      if (largeGap.length > 0 && smallGap.length > 0) {
        console.log(`  Comparing large-gap (${largeGap.length}) vs optimal (${smallGap.length}) moves:`);
        console.log(`  ${'Feature'.padEnd(22)} ${'Optimal(avg)'.padStart(12)} ${'LargeGap(avg)'.padStart(14)} ${'Delta'.padStart(10)}`);
        for (let i = 0; i < 15; i++) {
          const optAvg = avg(smallGap.map(m => m.chosenFeatures[i] || 0));
          const lgAvg = avg(largeGap.map(m => m.chosenFeatures[i] || 0));
          const delta = lgAvg - optAvg;
          const flag = Math.abs(delta) > 0.1 ? ' ←' : '';
          console.log(`  ${FEAT_NAMES[i].padEnd(22)} ${optAvg.toFixed(4).padStart(12)} ${lgAvg.toFixed(4).padStart(14)} ${(delta >= 0 ? '+' : '') + delta.toFixed(4).padStart(9)}${flag}`);
        }
      }

      // Saturation diagnostic: when destOnObjective=1 in chosen but not in refBest
      const objOverride = withGap.filter(m =>
        m.chosenFeatures && m.refBestFeatures &&
        m.chosenFeatures[7] >= 0.5 && m.refBestFeatures[7] < 0.5 && m.gap >= 0.01
      );
      const objMissed = withGap.filter(m =>
        m.chosenFeatures && m.refBestFeatures &&
        m.chosenFeatures[7] < 0.5 && m.refBestFeatures[7] >= 0.5 && m.gap >= 0.01
      );
      console.log(`\n  destOnObjective saturation check:`);
      console.log(`    Scorer chose obj dest when oracle didn't: ${objOverride.length} (scorer over-routes to objectives)`);
      console.log(`    Scorer missed obj dest when oracle wanted it: ${objMissed.length} (scorer under-routes)`);
      if (objOverride.length > 0) {
        const orOutcomes = objOverride.filter(m => m.activationOutcome);
        if (orOutcomes.length > 0) {
          const orAtk = orOutcomes.filter(m => m.activationOutcome === 'attack').length;
          console.log(`    Over-routed moves → attack conversion: ${pct(orAtk, orOutcomes.length)} (N=${orOutcomes.length})`);
        }
      }
    }

    // ── Section 7: Oracle sanity check ──
    console.log('\n=== 7. Oracle Sanity Check: Is the Learner Wrong or the Oracle Wrong? ===');
    if (withGap.length > 0 && withOutcome.length > 0) {
      const withAll = allMoves.filter(m => m.gap != null && m.activationOutcome && m.refBestQuality != null);
      // Key question: when the learner picks the oracle-best destination, does it convert?
      const oracleChosen = withAll.filter(m => m.gap < 0.001);
      const oracleNotChosen = withAll.filter(m => m.gap >= 0.01);

      console.log(`  Oracle-optimal moves (gap<0.001): ${oracleChosen.length}`);
      if (oracleChosen.length > 0) {
        const ocAtk = oracleChosen.filter(m => m.activationOutcome === 'attack').length;
        const ocInt = oracleChosen.filter(m => m.activationOutcome === 'interact').length;
        const ocProd = ocAtk + ocInt;
        console.log(`    Productive conversion: ${pct(ocProd, oracleChosen.length)} (atk=${pct(ocAtk, oracleChosen.length)}, int=${pct(ocInt, oracleChosen.length)})`);
        console.log(`    moveOnly: ${pct(oracleChosen.filter(m => m.activationOutcome === 'moveOnly').length, oracleChosen.length)}`);
      }

      console.log(`  Learner-suboptimal moves (gap>=0.01): ${oracleNotChosen.length}`);
      if (oracleNotChosen.length > 0) {
        const ncAtk = oracleNotChosen.filter(m => m.activationOutcome === 'attack').length;
        const ncInt = oracleNotChosen.filter(m => m.activationOutcome === 'interact').length;
        const ncProd = ncAtk + ncInt;
        console.log(`    Productive conversion: ${pct(ncProd, oracleNotChosen.length)} (atk=${pct(ncAtk, oracleNotChosen.length)}, int=${pct(ncInt, oracleNotChosen.length)})`);
        console.log(`    moveOnly: ${pct(oracleNotChosen.filter(m => m.activationOutcome === 'moveOnly').length, oracleNotChosen.length)}`);
      }

      // Verdict
      const oracleConv = oracleChosen.length > 0
        ? (oracleChosen.filter(m => m.activationOutcome === 'attack' || m.activationOutcome === 'interact').length / oracleChosen.length) : 0;
      const learnerConv = oracleNotChosen.length > 0
        ? (oracleNotChosen.filter(m => m.activationOutcome === 'attack' || m.activationOutcome === 'interact').length / oracleNotChosen.length) : 0;
      const convDelta = oracleConv - learnerConv;
      console.log(`\n  Oracle productive conversion: ${(oracleConv * 100).toFixed(1)}%`);
      console.log(`  Learner-miss productive conversion: ${(learnerConv * 100).toFixed(1)}%`);
      console.log(`  Delta: ${(convDelta >= 0 ? '+' : '')}${(convDelta * 100).toFixed(1)}pp`);
      if (oracleConv < 0.30) {
        console.log(`  ⚠ ORACLE SUSPECT: Even oracle-best destinations convert to attack <30% of the time.`);
        console.log(`    The reference oracle (MOVE_QUALITY_WEIGHTS) may be miscalibrated.`);
      } else if (convDelta > 0.05) {
        console.log(`  → LEARNER IS THE BOTTLENECK: Oracle-best destinations convert ${(convDelta * 100).toFixed(1)}pp better.`);
        console.log(`    Fixing learner training (weight saturation, decay) should recover VP.`);
      } else {
        console.log(`  → ORACLE AND LEARNER SIMILAR: Both have similar conversion rates.`);
        console.log(`    The quality weights themselves may need recalibration, or destination features need expansion.`);
      }

      // Reference-best feature profile when it DOES convert vs when it doesn't
      const refBestConverted = withAll.filter(m => m.gap < 0.001 && (m.activationOutcome === 'attack' || m.activationOutcome === 'interact') && m.chosenFeatures);
      const refBestNotConverted = withAll.filter(m => m.gap < 0.001 && m.activationOutcome === 'moveOnly' && m.chosenFeatures);
      if (refBestConverted.length > 10 && refBestNotConverted.length > 10) {
        console.log(`\n  Oracle-optimal feature profile: converted (${refBestConverted.length}) vs not (${refBestNotConverted.length}):`);
        console.log(`  ${'Feature'.padEnd(22)} ${'Converted'.padStart(10)} ${'NotConvert'.padStart(10)} ${'Delta'.padStart(10)}`);
        for (let i = 0; i < 15; i++) {
          const cAvg = avg(refBestConverted.map(m => m.chosenFeatures[i] || 0));
          const nAvg = avg(refBestNotConverted.map(m => m.chosenFeatures[i] || 0));
          const d = cAvg - nAvg;
          const flag = Math.abs(d) > 0.1 ? ' ←' : '';
          console.log(`  ${FEAT_NAMES[i].padEnd(22)} ${cAvg.toFixed(4).padStart(10)} ${nAvg.toFixed(4).padStart(10)} ${(d >= 0 ? '+' : '') + d.toFixed(4).padStart(9)}${flag}`);
        }
      }
    } else {
      console.log('  Insufficient data for oracle sanity check.');
    }

    // ── Section 8: Summary statistics ──
    console.log('\n=== 8. Summary ===');
    if (withGap.length > 0 && withOutcome.length > 0) {
      const optRate = withGap.filter(m => m.gap < 0.001).length / withGap.length;
      const avgGapVal = avg(withGap.map(m => m.gap));
      const convAll = withOutcome.filter(m => m.activationOutcome === 'attack' || m.activationOutcome === 'interact').length / withOutcome.length;
      console.log(`  Optimal destination rate: ${(optRate * 100).toFixed(1)}%`);
      console.log(`  Avg quality gap: ${avgGapVal.toFixed(4)}`);
      console.log(`  Overall productive conversion: ${(convAll * 100).toFixed(1)}%`);
      console.log(`  Total moves traced: ${allMoves.length} across ${perGameResults.length} games`);
    }
  }

  console.log(`\nLearnings saved to ${savePath}`);

  // Save diagnostic trace if non-empty (for map-specific regression diagnosis)
  const diagTrace = getDiagTrace();
  if (diagTrace.length > 0) {
    const tracePath = savePath.replace(/\.json$/, '-diag-trace.json');
    writeFileSync(tracePath, JSON.stringify(diagTrace));
    console.log(`Diagnostic trace saved to ${tracePath} (${diagTrace.length} disagreements)`);
  }

  // Save premature-end forensic frames if any were captured
  const premFrames = getPremEndFrames();
  if (premFrames.length > 0) {
    const framesPath = savePath.replace(/\.json$/, '-premend-frames.json');
    writeFileSync(framesPath, JSON.stringify(premFrames));
    console.log(`Premature-end forensic frames saved to ${framesPath} (${premFrames.length} frames)`);
  }

  // Save ability-play audit frames if any were captured
  if (abilityAudit && _abilityPlays.length > 0) {
    const abilityPath = savePath.replace(/\.json$/, '-ability-plays.json');
    writeFileSync(abilityPath, JSON.stringify(_abilityPlays));
    console.log(`Ability-play audit saved to ${abilityPath} (${_abilityPlays.length} plays)`);
  }

  // Ability distance-gate audit (always printed in diagnostic mode)
  if (diagnosticMode) {
    const ga = getAbilityGateAudit();
    const decisions = ga.gateHit + ga.gatePass;
    if (decisions > 0) {
      const gateHitPct = (ga.gateHit / decisions * 100).toFixed(1);
      console.log(`\n=== Ability distance-gate audit ===`);
      console.log(`  Decisions: ${decisions} (gate-hit ${ga.gateHit} [${gateHitPct}%] / gate-pass ${ga.gatePass})`);
      console.log(`  Skipped by category: offensive=${ga.skippedByCat.offensive} off_move=${ga.skippedByCat.off_move} defense=${ga.skippedByCat.defense} support=${ga.skippedByCat.support} other=${ga.skippedByCat.other}`);
      console.log(`  Played  by category: offensive=${ga.playedByCat.offensive}  off_move=${ga.playedByCat.off_move}  defense=${ga.playedByCat.defense}  support=${ga.playedByCat.support}  other=${ga.playedByCat.other}`);
    }
  }
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
