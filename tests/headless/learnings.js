/**
 * Strategy learning module — Dueling Neural Network (Brain Phase 3).
 * Hidden layer captures feature interactions. Separate value/advantage heads.
 * Target network + gradient clipping for stable learning.
 * Q(s,a) = V(s) + (A(s,a) - mean(A(s,*)))
 */
import { parseCoord } from '../../src/game/coords.js';
import { getDcEffects, getMapTokensData, getMapData, getCcEffect, getDeploymentZones, getMissionCardsData } from '../../src/data-loader.js';
import { hasLineOfSight, countSpaces } from '../../src/game/spatial.js';
import { parseSurgeEffect } from '../../src/game/combat.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  buildGraph, initGraphNetwork, graphForwardPass, graphBackpropUpdate,
  getGraphMaskedBestQ, deepCopyGraphNetwork, sanitizeGraphNetwork,
  serializeGraphNetwork, getGraphNetworkStats, deepCopyGraph, migrateGraphNetwork,
} from './graph-encoder.js';

// ── Constants ───────────────────────────────────────────────────────────────

const GAMMA = 0.95;          // Discount factor
let ALPHA = 0.001;           // Base learning rate (scheduled — see getEffectiveAlpha)
const ALPHA_TAU = 3000;      // Inverse-sqrt half-life in games
const ALPHA_FLOOR = 0.0001;  // Minimum LR (10% of base)
const HIDDEN_SIZE = 64;      // Hidden layer width (Phase 2: 32→64)
const DELTA_CLAMP = 1.0;     // Clips TD error magnitude
const TARGET_UPDATE_INTERVAL = 500; // Sync target net every N updates
const N_STEP = 4;            // N-step returns — multi-step credit assignment (was 1)
let WEIGHT_DECAY = 1e-5;          // L2 regularization — gentle pull toward zero to prevent Q-value spiral
const WEIGHT_CLAMP_EMERGENCY = 50.0; // Hard safety net — should never trigger with decay active
const BIAS_CLAMP = 20.0;          // Cap biases to prevent unbounded accumulation

// ── Encoder Type Switch ──────────────────────────────────────────────────────
// 'flat' = original 49-dim scalar features (production default)
// 'graph' = GNN-based relational state encoder (experimental)
let ENCODER_TYPE = 'flat';
/** Switch encoder type. Call before training/eval. */
export function setEncoderType(type) { ENCODER_TYPE = type; }
export function getEncoderType() { return ENCODER_TYPE; }

/** Override weight decay for controlled experiments. Call before training. */
export function setWeightDecay(v) { WEIGHT_DECAY = v; }
/** Override base learning rate for controlled experiments. Call before training. */
export function setAlpha(v) { ALPHA = v; }

// Diagnostic-eval flag: when true, the per-game WG update block in
// updateTraceNeural short-circuits so all WG weights stay frozen at their
// loaded values for the duration of the run. Complements setAlpha(0), which
// only freezes the main Q-network.
let WG_FROZEN = false;
export function setWgFrozen(v) { WG_FROZEN = !!v; }
export function getWgFrozen() { return WG_FROZEN; }

// Forensic attack-target trace. When true, every multi-candidate attack decision
// in pickWithinGroup prints a candidate breakdown to stderr. Designed for short
// trace runs (1–5 games); noise level scales with attack frequency.
let ATTACK_TRACE = false;
export function setAttackTrace(v) { ATTACK_TRACE = !!v; }

// Shared attack-target comparator. Used by both oracleActivationPlan and
// pickWithinGroup so the ranking can't silently drift between them.
//
// Tier order (lower value → preferred):
//   1. hitViability             — reliable hits beat marginal hits
//   2. currentHp                — focus-fire: finish weakest first (permanent kill priority)
//   3. maxHp                    — smaller baseline beats larger baseline at equal current HP
//   4. targetActivated          — turn-denial: prefer unactivated
//   5. missionTargetPriority    — mission-VP tiebreaker (Krykna on Krykna Infestation)
//   6. dist                     — proximity (final tiebreaker)
//
// Earlier versions placed missionTargetPriority as tier-1, which caused the
// Krykna-beats-every-enemy-figure failure mode on Chopper. The mission term now
// participates only after hit viability, focus-fire HP, and turn-denial — which
// preserves the "Krykna are valuable" intent as a late tiebreaker without
// overriding any of the signals we know matter more.
export function compareAttackTargets(a, b) {
  if (a.hitViability !== b.hitViability) return a.hitViability - b.hitViability;
  if (a.currentHp !== b.currentHp) return a.currentHp - b.currentHp;
  if (a.maxHp !== b.maxHp) return a.maxHp - b.maxHp;
  if (a.targetActivated !== b.targetActivated) return a.targetActivated - b.targetActivated;
  if (a.missionTargetPriority !== b.missionTargetPriority) return a.missionTargetPriority - b.missionTargetPriority;
  return a.dist - b.dist;
}
/** Inverse-sqrt LR schedule: ALPHA / sqrt(1 + totalGames/TAU), floored. */
export function getEffectiveAlpha(totalGames) {
  return Math.max(ALPHA_FLOOR, ALPHA / Math.sqrt(1 + (totalGames || 0) / ALPHA_TAU));
}

const REPLAY_BUFFER_SIZE = 10000;   // Max transitions in ring buffer
const REPLAY_BATCH_SIZE = 32;       // Transitions per mini-batch
const REPLAY_UPDATES_PER_GAME = 4;  // Mini-batch updates after each game
const REPLAY_MIN_SIZE = 256;        // Min buffer fill before replay starts
// REPLAY_ALPHA: computed as half of scheduled ALPHA (see replayUpdate)

// ── Within-Group Scorer (Phase 5) ───────────────────────────────────────────
const ALPHA_WG = 0.01;           // Learning rate for within-group scorers (5x main)
const ALPHA_WG_SURGE = 0.002;   // Surge scorer LR: 5x lower — prevent re-collapse after reset
const ALPHA_WG_MOVE = 0.005;    // Move scorer LR: uses contrastive signal, not TD delta
let WG_WEIGHT_CLAMP = 10.0;     // Max absolute weight value (moderate: 5→25 overshot, 10 preserves learning room without saturation)
const WG_EPSILON_START = 0.10;   // Within-group exploration rate (start)
const WG_EPSILON_MIN = 0.02;     // Within-group exploration rate (floor)
const WG_EPSILON_DECAY = 3000;   // Games to decay within-group epsilon

// ── WG-Specific Weight Decay ────────────────────────────────────────────────
// WG scorers had NO L2 regularization — weights drifted to clamp boundary.
// Per-scorer decay pulls weights back toward zero each update step.
// Attack scorer saturated fastest (all 6 weights at ±25), so gets strongest decay.
// Move scorer saturated 4/9 weights; gets moderate decay.
// Surge/CC are healthy — light decay as preventive measure.
const WG_DECAY_ATTACK = 0.0001;  // Matched to surge/CC — attack weights no longer saturated (max|w|=0.33 vs clamp=10)
const WG_DECAY_MOVE = 0.0005;    // Moderate: 4/9 saturated, some features still learning
const WG_DECAY_SURGE = 0.0001;   // Light: preventive only — not currently saturated
const WG_DECAY_CC = 0.0001;      // Light: preventive only — not currently saturated
const WG_DECAY_ACTIVATE = 0.0001; // Light: new scorer, same baseline as attack/surge/CC

/** Override WG weight clamp for experiments. */
export function setWgWeightClamp(v) { WG_WEIGHT_CLAMP = v; }

// ── Move Quality Signal ──────────────────────────────────────────────────────
// When enabled, estimates the best available move destination quality using
// current WG move weights and injects it as a 33rd dimension into the graph
// state embedding. This tells the DQN "good moves are available" at the
// start_move vs end_activation decision point.
let USE_MOVE_QUALITY_SIGNAL = false;
export function setMoveQualitySignalFlag(v) { USE_MOVE_QUALITY_SIGNAL = v; }

// ── Figure-Boundary N-Step Truncation ────────────────────────────────────────
// When enabled, N-step returns stop at figure activation boundaries (pseudo-terminal).
// Disable with --no-boundary-fix for A/B control arm.
let BOUNDARY_FIX_ENABLED = true;
export function setBoundaryFix(v) { BOUNDARY_FIX_ENABLED = !!v; }

// ── WG Move Decay Fix (permanent) ────────────────────────────────────────────
// Fixed: contrastive move update was applying L2 decay once PER ALTERNATIVE
// (3x per update). Attack/surge/CC apply L2 once per update. Fix: L2 is now
// applied once before the alternatives loop, matching all other scorers.

// ── WG Audit Counters (per-checkpoint instrumentation) ──────────────────────
let _wgAudit = { attackEntries: 0, attackUpdates: 0, moveEntries: 0, moveUpdates: 0, surgeEntries: 0, surgeUpdates: 0, activateEntries: 0, activateUpdates: 0 };
export function getWgAuditCounters() { return { ..._wgAudit }; }
export function resetWgAuditCounters() { _wgAudit = { attackEntries: 0, attackUpdates: 0, moveEntries: 0, moveUpdates: 0, surgeEntries: 0, surgeUpdates: 0, activateEntries: 0, activateUpdates: 0 }; }

// ── Attack Target Quality Audit ─────────────────────────────────────────────
// Tracks attack situation quality: multi-target decisions, HP profiles,
// hit viability, and turn-denial opportunities.
let _atkAudit = {
  totalDecisions: 0,       // All attack target decisions
  multiTargetDecisions: 0, // Decisions with >1 valid target
  totalTargets: 0,         // Sum of targets across all decisions (for avg)
  chosenHpSum: 0,          // Sum of chosen target's current HP
  altHpSum: 0,             // Sum of second-best target's HP (when multi-target)
  reliableHits: 0,         // Attacks within reliable accuracy range
  marginalHits: 0,         // Attacks beyond reliable accuracy range
  turnDenialRelevant: 0,   // Cases where equal-HP targets had different activation status
  turnDenialChosen: 0,     // Of those, unactivated target was chosen (always, by sort)
};
let _atkAuditTotal = { totalDecisions: 0, multiTargetDecisions: 0, totalTargets: 0,
  chosenHpSum: 0, altHpSum: 0, reliableHits: 0, marginalHits: 0,
  turnDenialRelevant: 0, turnDenialChosen: 0 };
export function getAtkAuditCounters() { return { ..._atkAudit }; }
export function getAtkAuditTotals() { return { ..._atkAuditTotal }; }
export function resetAtkAuditCounters() {
  // Accumulate into totals before resetting window
  for (const k of Object.keys(_atkAudit)) _atkAuditTotal[k] += _atkAudit[k];
  _atkAudit = { totalDecisions: 0, multiTargetDecisions: 0, totalTargets: 0,
    chosenHpSum: 0, altHpSum: 0, reliableHits: 0, marginalHits: 0,
    turnDenialRelevant: 0, turnDenialChosen: 0 };
}
export function resetAtkAuditTotals() {
  _atkAuditTotal = { totalDecisions: 0, multiTargetDecisions: 0, totalTargets: 0,
    chosenHpSum: 0, altHpSum: 0, reliableHits: 0, marginalHits: 0,
    turnDenialRelevant: 0, turnDenialChosen: 0 };
}

// ── Attack-candidate-generation audit ───────────────────────────────────────
// Classifies each attack decision's legal candidate set: npc-only,
// figure-only, mixed, or empty. For npc-only decisions, further classifies
// why each enemy figure was excluded from the candidate list (range gate,
// LoS gate, or other). This is the diagnostic primitive for the Chopper
// NPC-geometry question — post-scorer-fix, the remaining Chopper VP gap is
// driven by candidate generation rather than ranking.
let _candAudit = {
  totalDecisions: 0,
  npcOnly: 0,
  figureOnly: 0,
  mixed: 0,
  empty: 0,
  // Refined excluded-figure reasons for npc-only decisions:
  npcOnlyExcludedFigTotal: 0,
  npcOnlyExcludedByRange: 0,        // Manhattan dist > attackerRange
  npcOnlyExcludedByLos: 0,          // in range, bare LoS fails
  npcOnlyExcludedByPathDist: 0,     // Manhattan ≤ range but path distance (around walls/doors) > range
  npcOnlyExcludedByFigureBlock: 0,  // bare LoS passes; figure-blocking LoS fails
  npcOnlyExcludedByOther: 0,        // residual (missing positions, exotic filters)
  // Global aggregates (for context):
  totalNpcCandidates: 0,
  totalFigureCandidates: 0,
  totalEnemyFiguresOnBoard: 0,
  // Spatial distribution samples (pushed per decision):
  distToNearestEnemyFig: [],        // Manhattan dist from attacker to nearest enemy figure
  distToNearestKrykna: [],          // Manhattan dist from attacker to nearest active Krykna
  attackerRanges: [],               // attacker's practical range at decision time
  // Density counts at concentric radii (per decision):
  figCountWithin3: 0, figCountWithin5: 0, figCountWithin7: 0,
  kryCountWithin3: 0, kryCountWithin5: 0, kryCountWithin7: 0,
  // Total active Krykna at each decision (for population tracking):
  totalActiveKryknaSum: 0,
  // Respawn tracking (population changes decision-to-decision):
  respawnEvents: 0,                 // count of times Krykna population grew between decisions
  lastKryknaPop: 0,
};
export function getCandAudit() {
  // Return a reference to the arrays so caller can quantile without copying huge arrays.
  return { ..._candAudit };
}
export function resetCandAudit() {
  _candAudit = {
    totalDecisions: 0, npcOnly: 0, figureOnly: 0, mixed: 0, empty: 0,
    npcOnlyExcludedFigTotal: 0,
    npcOnlyExcludedByRange: 0, npcOnlyExcludedByLos: 0,
    npcOnlyExcludedByPathDist: 0, npcOnlyExcludedByFigureBlock: 0, npcOnlyExcludedByOther: 0,
    totalNpcCandidates: 0, totalFigureCandidates: 0, totalEnemyFiguresOnBoard: 0,
    distToNearestEnemyFig: [], distToNearestKrykna: [], attackerRanges: [],
    figCountWithin3: 0, figCountWithin5: 0, figCountWithin7: 0,
    kryCountWithin3: 0, kryCountWithin5: 0, kryCountWithin7: 0,
    totalActiveKryknaSum: 0,
    respawnEvents: 0, lastKryknaPop: 0,
  };
}

// ── Premature-end-activation audit ──────────────────────────────────────────
// Classifies every dc_end_activation event: was a "productive" action legal
// at end time? If so, what type (attack / interact / move-only / special)?
// Breaks down by round + side. Optional crate-proximity context: at each
// premature end, records whether the acting figure is on/adjacent to a
// crate/objective — for disambiguating "correct camping" from "scorer gives up".
let _premEndAudit = {
  totalDcEnd: 0,
  premature: 0,
  byRound: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],   // index 0 unused; rounds 1..11 covered
  bySide: { 1: 0, 2: 0 },
  // Classification of premature subset (priority: attack > interact > special > move):
  attackLegalDeclined: 0,    attackLegalDeclinedP1: 0, attackLegalDeclinedP2: 0,
  interactLegalDeclined: 0,  interactLegalDeclinedP1: 0, interactLegalDeclinedP2: 0,
  specialLegalDeclined: 0,   specialLegalDeclinedP1: 0, specialLegalDeclinedP2: 0,
  moveOnlyAvailable: 0,      moveOnlyAvailableP1: 0, moveOnlyAvailableP2: 0,
  noLegalProductive: 0,      // shouldn't be flagged premature but count defensively
  // Activation-state context for premature events:
  alreadyAttackedThisAct: 0,
  alreadyInteractedThisAct: 0,
  alreadyMovedThisAct: 0,
  noPriorProductiveAction: 0,
  // Action-economy state at time of end:
  actionsRemainingSum: 0,    // cumulative "remaining" field of dcActionsData[msgId]
  // Crate/objective proximity (for zone-control missions):
  endedOnObjective: 0,       // acting figure was on-objective (dist=0 to mission token)
  endedAdjacentObjective: 0, // on-or-adjacent (dist ≤ 1)
  endedNearObjective: 0,     // within 3
  endedFarFromObjective: 0,  // > 3
  // Baseline total counts (for normalization):
  onObjectiveAtEndP1: 0, onObjectiveAtEndP2: 0,
};
export function getPremEndAudit() { return { ..._premEndAudit, byRound: [..._premEndAudit.byRound], bySide: { ..._premEndAudit.bySide } }; }
export function recordPremEnd(fields) {
  // Update counters from an object captured at dc_end_activation time.
  _premEndAudit.totalDcEnd++;
  if (!fields.isPremature) return;
  _premEndAudit.premature++;
  const r = Math.max(1, Math.min(11, fields.round || 1));
  _premEndAudit.byRound[r]++;
  const side = fields.side === 1 ? 1 : 2;
  _premEndAudit.bySide[side]++;
  // Classify the "available-but-declined" bucket
  if (fields.attackLegal) {
    _premEndAudit.attackLegalDeclined++;
    if (side === 1) _premEndAudit.attackLegalDeclinedP1++;
    else _premEndAudit.attackLegalDeclinedP2++;
  } else if (fields.interactLegal) {
    _premEndAudit.interactLegalDeclined++;
    if (side === 1) _premEndAudit.interactLegalDeclinedP1++;
    else _premEndAudit.interactLegalDeclinedP2++;
  } else if (fields.specialLegal) {
    _premEndAudit.specialLegalDeclined++;
    if (side === 1) _premEndAudit.specialLegalDeclinedP1++;
    else _premEndAudit.specialLegalDeclinedP2++;
  } else if (fields.moveLegal) {
    _premEndAudit.moveOnlyAvailable++;
    if (side === 1) _premEndAudit.moveOnlyAvailableP1++;
    else _premEndAudit.moveOnlyAvailableP2++;
  } else {
    _premEndAudit.noLegalProductive++;
  }
  // Activation-history context
  const hadAtk = !!fields.priorAttack, hadInt = !!fields.priorInteract, hadMov = !!fields.priorMove;
  if (hadAtk) _premEndAudit.alreadyAttackedThisAct++;
  if (hadInt) _premEndAudit.alreadyInteractedThisAct++;
  if (hadMov) _premEndAudit.alreadyMovedThisAct++;
  if (!hadAtk && !hadInt && !hadMov) _premEndAudit.noPriorProductiveAction++;
  // Action economy
  _premEndAudit.actionsRemainingSum += (fields.actionsRemaining || 0);
  // Objective proximity (fields.distToObj provided if caller computed it)
  const d = fields.distToObj;
  if (d != null) {
    if (d === 0) _premEndAudit.endedOnObjective++;
    if (d <= 1) _premEndAudit.endedAdjacentObjective++;
    if (d <= 3) _premEndAudit.endedNearObjective++;
    if (d > 3) _premEndAudit.endedFarFromObjective++;
    if (d === 0) {
      if (side === 1) _premEndAudit.onObjectiveAtEndP1++;
      else _premEndAudit.onObjectiveAtEndP2++;
    }
  }
}
export function resetPremEndAudit() {
  _premEndAudit = {
    totalDcEnd: 0, premature: 0,
    byRound: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bySide: { 1: 0, 2: 0 },
    attackLegalDeclined: 0, attackLegalDeclinedP1: 0, attackLegalDeclinedP2: 0,
    interactLegalDeclined: 0, interactLegalDeclinedP1: 0, interactLegalDeclinedP2: 0,
    specialLegalDeclined: 0, specialLegalDeclinedP1: 0, specialLegalDeclinedP2: 0,
    moveOnlyAvailable: 0, moveOnlyAvailableP1: 0, moveOnlyAvailableP2: 0,
    noLegalProductive: 0,
    alreadyAttackedThisAct: 0, alreadyInteractedThisAct: 0, alreadyMovedThisAct: 0,
    noPriorProductiveAction: 0,
    actionsRemainingSum: 0,
    endedOnObjective: 0, endedAdjacentObjective: 0, endedNearObjective: 0, endedFarFromObjective: 0,
    onObjectiveAtEndP1: 0, onObjectiveAtEndP2: 0,
  };
}

// ── Premature-end forensic frames ───────────────────────────────────────────
// Rich per-frame capture for premature dc_end_activation decisions.
// Used by the Devaron forensic probe to answer "why did end_activation beat
// dc_special / movement at this exact state". Capped to keep memory bounded.
const _PREM_END_FRAMES_CAP = 5000;
let _premEndFrames = [];
export function recordPremEndFrame(frame) {
  if (_premEndFrames.length >= _PREM_END_FRAMES_CAP) return;
  _premEndFrames.push(frame);
}
export function getPremEndFrames() { return _premEndFrames.slice(); }
export function resetPremEndFrames() { _premEndFrames = []; }

// ── Ability-selection heuristic (2026-04-16) ────────────────────────────────
// After the priority-2.5 ability clause was added, 50g audit showed 58% of
// offensive and 80% of support abilities firing at d≥7 from any enemy, with
// only 1.4% of offensive plays followed by an attack — random selection was
// burning action-economy on out-of-range triggers.
//
// Heuristic (narrow, deterministic, reversible):
//   1) Distance gate: if acting figure > ABILITY_DIST_GATE (Manhattan) from
//      nearest enemy, skip the ability branch → fall through to start_move.
//   2) Category order within gate-passing set: offensive > off+move > defense
//      > support > other, random tie-break within the winning category.
const ABILITY_DIST_GATE = 6;
const ABILITY_CAT_PRIORITY = { offensive: 0, off_move: 1, defense: 2, support: 3, other: 4 };
// Category map built from 30 unique abilities seen in the 50g Devaron audit.
// Unknown names default to 'other'. Add entries only when probed in a real run.
const ABILITY_CATEGORY = {
  // Offensive (direct damage / bonus-to-attack / reroll triggers)
  'Force Choke': 'offensive',
  'Brutality': 'offensive',
  'Defensive Fire': 'offensive',
  'Dual-Wield Pistols': 'offensive',
  'Saber Strike': 'offensive',
  'Invasive Procedure': 'offensive',
  'Missile Salvo': 'offensive',
  'Slam': 'offensive',
  'Force Lightning': 'offensive',
  'Emperor': 'offensive',
  'Tempt': 'offensive',
  'Wrist Cord': 'offensive',
  'Wrist Flamethrower': 'offensive',
  'Brutal Cleave': 'offensive',
  'Barrage': 'offensive',
  // Offensive + movement (close distance while dealing damage — important
  // edge case: these are valuable even at d>6 because they shrink the gap)
  'Trample': 'off_move',
  'Pounce': 'off_move',
  'Charge': 'off_move',
  // Defense (heals, shields, evasion)
  'Survival is Strength': 'defense',
  'Calming Presence': 'defense',
  'Force Deflection': 'defense',
  // Support (ally buffs, rerolls, planning)
  'Military Efficiency': 'support',
  'Battlefield Leadership': 'support',
  'Long-Laid Plans': 'support',
  'Strategize': 'support',
  'Wisdom': 'support',
  'Do or Do Not': 'support',
  'Inform': 'support',
  'On My Mark': 'support',
  'Tactical Maneuver': 'support',
};
export function abilityCategory(name) {
  if (!name) return 'other';
  return ABILITY_CATEGORY[name] || 'other';
}
// Gate-hit audit — counts each ability's category at the moment the gate fires,
// so the off+move suppression rate is visible. Reset per diagnostic run.
let _abilityGateAudit = {
  gateHit: 0,      // decisions where distToEnemy > ABILITY_DIST_GATE
  gatePass: 0,     // decisions where distToEnemy ≤ gate (or null)
  skippedByCat: { offensive: 0, off_move: 0, defense: 0, support: 0, other: 0 },
  playedByCat:  { offensive: 0, off_move: 0, defense: 0, support: 0, other: 0 },
};
export function getAbilityGateAudit() { return JSON.parse(JSON.stringify(_abilityGateAudit)); }
export function resetAbilityGateAudit() {
  _abilityGateAudit = {
    gateHit: 0,
    gatePass: 0,
    skippedByCat: { offensive: 0, off_move: 0, defense: 0, support: 0, other: 0 },
    playedByCat:  { offensive: 0, off_move: 0, defense: 0, support: 0, other: 0 },
  };
}

// ── Activation-Order Audit ──────────────────────────────────────────────────
const _actOrderAuditInit = () => ({
  totalDecisions: 0,
  multiChoiceDecisions: 0,
  trivialDecisions: 0,
  choiceHistogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  tierCounts: { combat: 0, wounded: 0, positional: 0 },
  sameTierDecisions: 0,
  anyCombatReady: 0,
  multiCombatReady: 0,
  noCombatReady: 0,
  anyWounded: 0,
  multiWounded: 0,
  positionalSpreadSum: 0,
  positionalSpreadCount: 0,
});
let _actOrderAudit = _actOrderAuditInit();
export function getActOrderAudit() { return { ..._actOrderAudit, choiceHistogram: { ..._actOrderAudit.choiceHistogram }, tierCounts: { ..._actOrderAudit.tierCounts } }; }
export function resetActOrderAudit() { _actOrderAudit = _actOrderAuditInit(); }

// ── Activation-Order Shadow Mode ───────────────────────────────────────────
// Tracks scorer-vs-heuristic disagreement without handing over control.
const _actShadowInit = () => ({
  totalEligible: 0,       // decisions where gate allows learned scorer
  totalGated: 0,          // decisions blocked by combat-ready gate
  agreements: 0,
  disagreements: 0,
  // Disagreement by decision class (tier of #1 vs #2 in heuristic ranking)
  byClass: {
    woundedVsWounded:      { total: 0, agree: 0, disagree: 0 },
    woundedVsPositional:   { total: 0, agree: 0, disagree: 0 },
    positionalVsPositional:{ total: 0, agree: 0, disagree: 0 },
  },
  // Disagreement by round
  byRound: { 1: { total: 0, agree: 0, disagree: 0 }, 2: { total: 0, agree: 0, disagree: 0 },
             3: { total: 0, agree: 0, disagree: 0 }, 4: { total: 0, agree: 0, disagree: 0 } },
  // Disagreement by activations-left bucket
  byActivationsLeft: { early: { total: 0, agree: 0, disagree: 0 }, late: { total: 0, agree: 0, disagree: 0 } },
  // Feature deltas on disagreement (for understanding WHAT the scorer sees differently)
  disagreeFeatureDeltas: new Float64Array(8), // sum of (scorer_pick_features - heuristic_pick_features)
  disagreeCount: 0,
});
let _actShadow = _actShadowInit();
export function getActShadow() {
  return {
    ..._actShadow,
    byClass: { woundedVsWounded: { ..._actShadow.byClass.woundedVsWounded },
               woundedVsPositional: { ..._actShadow.byClass.woundedVsPositional },
               positionalVsPositional: { ..._actShadow.byClass.positionalVsPositional } },
    byRound: { 1: { ..._actShadow.byRound[1] }, 2: { ..._actShadow.byRound[2] },
               3: { ..._actShadow.byRound[3] }, 4: { ..._actShadow.byRound[4] } },
    byActivationsLeft: { early: { ..._actShadow.byActivationsLeft.early },
                         late: { ..._actShadow.byActivationsLeft.late } },
    disagreeFeatureDeltas: Array.from(_actShadow.disagreeFeatureDeltas),
  };
}
export function resetActShadow() { _actShadow = _actShadowInit(); }

// ── Activation Outcome Tracker ─────────────────────────────────────────────
// Tracks what the heuristic's chosen DC actually did during its activation.
// When shadow mode disagreed, links the outcome to the disagreement record.
let _pendingActOutcome = null; // { dcName, shadowDisagreed, scorerPick, heuristicPick }
const _actOutcomeInit = () => ({
  // All activations (on eligible surface)
  all: { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, total: 0 },
  // Activations where scorer agreed with heuristic
  agree: { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, total: 0 },
  // Activations where scorer disagreed — what did the HEURISTIC's pick produce?
  disagreeHeuristic: { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, total: 0 },
});
let _actOutcome = _actOutcomeInit();
export function getActOutcome() {
  return { all: { ..._actOutcome.all }, agree: { ..._actOutcome.agree },
           disagreeHeuristic: { ..._actOutcome.disagreeHeuristic } };
}
export function resetActOutcome() { _actOutcome = _actOutcomeInit(); _pendingActOutcome = null; }

// Called from train.js when an activate_dc is chosen on the eligible surface
export function markActivationStart(dcName, shadowDisagreed, scorerPick, heuristicPick, traceIdx) {
  // Finalize any previous pending activation first
  finalizeActivationOutcome('endOnly');
  _pendingActOutcome = { dcName, shadowDisagreed, scorerPick, heuristicPick, bestOutcome: 'endOnly', traceIdx: traceIdx ?? -1 };
}

// Called from train.js for each action during the activation
export function recordActivationAction(actionType) {
  if (!_pendingActOutcome) return;
  if (actionType === 'attack_target') _pendingActOutcome.bestOutcome = 'attack';
  else if (actionType === 'interact' && _pendingActOutcome.bestOutcome !== 'attack') _pendingActOutcome.bestOutcome = 'interact';
  else if ((actionType === 'move_figure' || actionType === 'move_pick_space') &&
           _pendingActOutcome.bestOutcome === 'endOnly') _pendingActOutcome.bestOutcome = 'moveOnly';
}

// Called from train.js at end of activation or next activate_dc
export function finalizeActivationOutcome(fallbackOutcome) {
  if (!_pendingActOutcome) return;
  const outcome = _pendingActOutcome.bestOutcome || fallbackOutcome || 'endOnly';
  _actOutcome.all[outcome]++;
  _actOutcome.all.total++;
  if (_pendingActOutcome.shadowDisagreed) {
    _actOutcome.disagreeHeuristic[outcome]++;
    _actOutcome.disagreeHeuristic.total++;
  } else {
    _actOutcome.agree[outcome]++;
    _actOutcome.agree.total++;
  }
  // Link outcome back to diagnostic trace entry
  if (_pendingActOutcome.traceIdx >= 0 && _pendingActOutcome.traceIdx < _diagTrace.length) {
    _diagTrace[_pendingActOutcome.traceIdx].outcome = outcome;
  }
  _pendingActOutcome = null;
}

// ── Diagnostic Trace (per-disagreement detail) ─────────────────────────────
// Captures full context for each disagreement decision — used for map-specific
// regression diagnosis (e.g., why does the scorer hurt Devaron?).
const _diagTrace = [];
export function getDiagTrace() { return _diagTrace; }
export function resetDiagTrace() { _diagTrace.length = 0; }

// ── Pass-Timing Shadow Scorer ───────────────────────────────────────────────
// Linear scorer for the pass-vs-activate decision on the pass-legal surface.
// Shadow mode only: computes a recommendation, compares to the DQN's live
// decision, and logs disagreements by context bucket. No control handoff.
//
// Features (7):
//   0: gapNorm        — (oppRem-myRem)/max(total,1)   how asymmetric activations are
//   1: vpDeltaNorm    — (myVP-oppVP)/40               am I ahead or behind?
//   2: roundFraction  — round/4                        how late in the game
//   3: myWoundedRatio — wounded/totalMyDcs             urgency to use fragile pieces
//   4: bestDcCanAttack— 1 if any activatable DC has enemy in attack range
//   5: bestDcNearObj  — 1 - min(nearestObjDist,10)/10  objective urgency
//   6: oppUnactRatio  — oppUnactivated/totalOppDcs     info gain from forcing opponent
const PASS_FEATURE_NAMES = [
  'gapNorm', 'vpDeltaNorm', 'roundFraction', 'myWoundedRatio',
  'bestDcCanAttack', 'bestDcNearObj', 'myExhaustedFrac',
];
const PASS_NUM_FEATURES = PASS_FEATURE_NAMES.length;

// Initial weights: hand-tuned prior expressing "pass when gap is large, activate
// when wounded or can attack". Shadow mode only — weights are fixed, not learned.
// Positive weight = favors ACTIVATE. Negative weight = favors PASS.
// Score > 0 → shadow says activate. Score ≤ 0 → shadow says pass.
const PASS_SHADOW_WEIGHTS = [
  -0.5,   // gapNorm: bigger gap → favor pass (let opponent burn activations)
   0.3,   // vpDeltaNorm: ahead → slightly favor activate (close out), behind → pass
  -0.1,   // roundFraction: later rounds → slightly favor pass (let opp commit first)
   0.8,   // myWoundedRatio: wounded DCs → strongly favor activate (use them or lose them)
   1.2,   // bestDcCanAttack: can attack → strongly favor activate (don't waste the opening)
   0.4,   // bestDcNearObj: near objective → favor activate (interact/score)
   0.3,   // myExhaustedFrac: deep into round → favor activate (last chance to salvage value)
];
const PASS_SHADOW_BIAS = -0.2; // slight bias toward pass (the DQN's 86% rate suggests pass-heavy is correct)

// Disagreement tracker
const _passShadow = {
  total: 0, agree: 0, disagree: 0,
  shadowActivate: 0, shadowPass: 0,
  // By context bucket
  byMap: {},        // mapId → { total, disagree, shadowActivateDqnPass, shadowPassDqnActivate }
  byRound: {},      // round → { total, disagree }
  byVP: { ahead: { total: 0, disagree: 0 }, behind: { total: 0, disagree: 0 }, tied: { total: 0, disagree: 0 } },
  byGap: {},        // gap → { total, disagree }
  byWounded: { yes: { total: 0, disagree: 0 }, no: { total: 0, disagree: 0 } },
  byProductive: { yes: { total: 0, disagree: 0 }, no: { total: 0, disagree: 0 } },
  // Feature averages for disagree vs agree
  agreeFeatureSum: new Float64Array(PASS_NUM_FEATURES),
  disagreeFeatureSum: new Float64Array(PASS_NUM_FEATURES),
  agreeCount: 0, disagreeCount: 0,
};
export function getPassShadow() { return _passShadow; }
export function resetPassShadow() {
  _passShadow.total = 0; _passShadow.agree = 0; _passShadow.disagree = 0;
  _passShadow.shadowActivate = 0; _passShadow.shadowPass = 0;
  _passShadow.byMap = {}; _passShadow.byRound = {};
  _passShadow.byVP = { ahead: { total: 0, disagree: 0 }, behind: { total: 0, disagree: 0 }, tied: { total: 0, disagree: 0 } };
  _passShadow.byGap = {}; _passShadow.byWounded = { yes: { total: 0, disagree: 0 }, no: { total: 0, disagree: 0 } };
  _passShadow.byProductive = { yes: { total: 0, disagree: 0 }, no: { total: 0, disagree: 0 } };
  _passShadow.agreeFeatureSum = new Float64Array(PASS_NUM_FEATURES);
  _passShadow.disagreeFeatureSum = new Float64Array(PASS_NUM_FEATURES);
  _passShadow.agreeCount = 0; _passShadow.disagreeCount = 0;
}

/**
 * Extract pass-timing features for a pass-legal decision.
 * @param {object} game - current game state
 * @param {number} playerNum - acting player
 * @param {Map} dcHealthState - DC health data
 * @param {Map} dcMessageMeta - DC metadata
 * @param {Array} activatableActions - the activate_dc actions available
 * @returns {Float64Array} 7 features
 */
export function extractPassFeatures(game, playerNum, dcHealthState, dcMessageMeta, activatableActions) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myRem = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const oppRem = oppNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const totalRem = myRem + oppRem;

  // Feature 0: gapNorm
  const gapNorm = totalRem > 0 ? (oppRem - myRem) / totalRem : 0;

  // Feature 1: vpDeltaNorm
  const myVP = (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const oppVP = (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const vpDeltaNorm = (myVP - oppVP) / 40;

  // Feature 2: roundFraction
  const round = game.currentRound || 1;
  const roundFraction = Math.min(round, 4) / 4;

  // Feature 3: myWoundedRatio — count DCs with any wounded figure
  let myWounded = 0, myTotalDcs = 0;
  const myMsgIds = game[`p${playerNum}DcMessageIds`] || [];
  for (const mid of myMsgIds) {
    const h = dcHealthState?.get(mid);
    if (!h) continue;
    myTotalDcs++;
    for (const fig of h) {
      if (fig && fig[0] < fig[1] && fig[0] > 0) { myWounded++; break; }
    }
  }
  const myWoundedRatio = myTotalDcs > 0 ? myWounded / myTotalDcs : 0;

  // Feature 4: bestDcCanAttack — can any activatable DC attack an enemy?
  let bestDcCanAttack = 0;
  const oppFigPositions = game.figurePositions?.[oppNum] || {};
  const oppFigCoords = Object.values(oppFigPositions);
  if (oppFigCoords.length > 0 && activatableActions) {
    for (const act of activatableActions) {
      const msgId = act.params?.msgId;
      if (!msgId) continue;
      const meta = dcMessageMeta?.get(msgId);
      if (!meta) continue;
      // Get attack range for this DC
      let dcEffectsData;
      try { dcEffectsData = getDcEffects(); } catch { dcEffectsData = {}; }
      const lower = meta.dcName.toLowerCase();
      const ciKey = dcEffectsData ? Object.keys(dcEffectsData).find(k => k.toLowerCase() === lower) : null;
      const eff = dcEffectsData?.[meta.dcName] || (ciKey ? dcEffectsData[ciKey] : null);
      const attackRange = eff?.attack?.type === 'range' ? 12 : 2; // ranged≈12, melee≈2 (adjacent)
      // Check if any figure of this DC is within attack range of an enemy
      const myFigKeys = Object.keys(game.figurePositions?.[playerNum] || {})
        .filter(fk => fk.startsWith(meta.dcName + '-'));
      for (const fk of myFigKeys) {
        const myPos = game.figurePositions?.[playerNum]?.[fk];
        if (!myPos) continue;
        for (const oppPos of oppFigCoords) {
          if (coordDistance(myPos, oppPos) <= attackRange) {
            bestDcCanAttack = 1;
            break;
          }
        }
        if (bestDcCanAttack) break;
      }
      if (bestDcCanAttack) break;
    }
  }

  // Feature 5: bestDcNearObj — proximity of activatable DCs to objectives
  // Use objectivePotential as proxy (already computed in extractFeatures)
  const bestDcNearObj = getObjectivePotential(game, playerNum);

  // Feature 6: myExhaustedFrac — fraction of my DCs already activated this round
  let myActivated = 0;
  const myActivatedSet = new Set(playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []));
  for (const mid of myMsgIds) {
    const meta = dcMessageMeta?.get(mid);
    if (!meta) continue;
    const idx = meta.dcIndex ?? -1;
    if (myActivatedSet.has(idx)) myActivated++;
  }
  const myExhaustedFrac = myTotalDcs > 0 ? myActivated / myTotalDcs : 0;

  const features = new Float64Array(PASS_NUM_FEATURES);
  features[0] = gapNorm;
  features[1] = vpDeltaNorm;
  features[2] = roundFraction;
  features[3] = myWoundedRatio;
  features[4] = bestDcCanAttack;
  features[5] = bestDcNearObj;
  features[6] = myExhaustedFrac;
  return features;
}

/**
 * Run pass-timing shadow scorer. Computes score, compares to DQN decision,
 * records disagreement. Call this at every pass-legal decision point.
 *
 * @param {Float64Array} features - from extractPassFeatures
 * @param {string} dqnChoice - 'pass' or 'activate' (what the DQN actually chose)
 * @param {object} context - { mapId, round, vpDelta, gap, hasWounded, hasProductive }
 */
export function passTimingShadowEval(features, dqnChoice, context) {
  // Compute shadow score: positive → activate, non-positive → pass
  let score = PASS_SHADOW_BIAS;
  for (let i = 0; i < PASS_NUM_FEATURES; i++) {
    score += PASS_SHADOW_WEIGHTS[i] * features[i];
  }
  const shadowChoice = score > 0 ? 'activate' : 'pass';
  const agreed = shadowChoice === dqnChoice;

  _passShadow.total++;
  if (agreed) _passShadow.agree++;
  else _passShadow.disagree++;
  if (shadowChoice === 'activate') _passShadow.shadowActivate++;
  else _passShadow.shadowPass++;

  // Feature averages
  const sumArr = agreed ? _passShadow.agreeFeatureSum : _passShadow.disagreeFeatureSum;
  for (let i = 0; i < PASS_NUM_FEATURES; i++) sumArr[i] += features[i];
  if (agreed) _passShadow.agreeCount++;
  else _passShadow.disagreeCount++;

  // Context buckets
  const mapId = context.mapId || 'unknown';
  if (!_passShadow.byMap[mapId]) _passShadow.byMap[mapId] = { total: 0, disagree: 0, shadowActivateDqnPass: 0, shadowPassDqnActivate: 0 };
  _passShadow.byMap[mapId].total++;
  if (!agreed) {
    _passShadow.byMap[mapId].disagree++;
    if (shadowChoice === 'activate') _passShadow.byMap[mapId].shadowActivateDqnPass++;
    else _passShadow.byMap[mapId].shadowPassDqnActivate++;
  }

  const r = context.round || 1;
  if (!_passShadow.byRound[r]) _passShadow.byRound[r] = { total: 0, disagree: 0 };
  _passShadow.byRound[r].total++;
  if (!agreed) _passShadow.byRound[r].disagree++;

  const vpBucket = context.vpDelta > 0 ? 'ahead' : context.vpDelta < 0 ? 'behind' : 'tied';
  _passShadow.byVP[vpBucket].total++;
  if (!agreed) _passShadow.byVP[vpBucket].disagree++;

  const gap = context.gap || 1;
  if (!_passShadow.byGap[gap]) _passShadow.byGap[gap] = { total: 0, disagree: 0 };
  _passShadow.byGap[gap].total++;
  if (!agreed) _passShadow.byGap[gap].disagree++;

  const wBucket = context.hasWounded ? 'yes' : 'no';
  _passShadow.byWounded[wBucket].total++;
  if (!agreed) _passShadow.byWounded[wBucket].disagree++;

  const pBucket = context.hasProductive ? 'yes' : 'no';
  _passShadow.byProductive[pBucket].total++;
  if (!agreed) _passShadow.byProductive[pBucket].disagree++;

  return { score, shadowChoice, agreed };
}

// ── Activate Scorer Control Mode ───────────────────────────────────────────
// When true, the gated learned scorer CONTROLS activation order on the
// eligible surface (no combat-ready DC, no pre-filter). When false (default),
// the heuristic controls and the scorer runs in shadow mode only.
let _activateScorerControl = false;
export function setActivateScorerControl(v) { _activateScorerControl = !!v; }

function getWgDecay(wgType) {
  switch (wgType) {
    case 'attack': return WG_DECAY_ATTACK;
    case 'move': return WG_DECAY_MOVE;
    case 'surge': return WG_DECAY_SURGE;
    case 'cc': return WG_DECAY_CC;
    case 'activate': return WG_DECAY_ACTIVATE;
    default: return 0;
  }
}

// ── Contrastive Move Scorer ──────────────────────────────────────────────────
// The TD-delta-based WG update doesn't teach the move scorer which SPACE is
// good — it only says whether "move_toward" was a good category. Fix: compute
// a direct quality score for each candidate destination and do a contrastive
// update that pushes the scorer toward better destinations.
//
// Quality score for a destination (0-1 features, higher = better):
//   Q_dest = w_enemy * distToNearestEnemy     (closer to enemy = higher)
//          - w_threat * threatAtDest           (less threat = higher)
//          + w_obj * objectiveProximity        (closer to objective = higher)
//          + w_ally * allySupport              (more allies nearby = higher)
//          + w_eff * mpEfficiency              (cheaper step = higher)
//          - w_exposed * destInEnemyRange      (fewer enemies can hit = better)
//          + w_onObj * destOnObjective         (on/adjacent to objective = better)
//          + w_adjAlly * destAdjacentToAlly    (adjacent to friendly = better)
//
// These are the TRUE domain-aligned quality weights, not learned — they define
// what a "good destination" means. The learned WG weights should converge toward
// something like these if learning works.
//                                              enemy  threat  obj   ally   eff   bias  exposed  onObj  adjAlly  canAtk  killFrac  unactFrac  netDmg  actFeas  losCnt
const MOVE_QUALITY_WEIGHTS = [                  0.40,  0.10,  0.25,-0.05,  0.10, 0.0,  0.10,   0.30, -0.10,   0.20,    0.30,     0.10,      0.20,   0.15,    0.10];
// Number of random alternatives to sample for contrastive comparison.
const MOVE_CONTRASTIVE_SAMPLES = 3;
// Per-feature learning-rate boost for sparse binary features in the move scorer.
// destOnObjective (index 7) fires in ~5-10% of candidate sets — its gradient
// accumulates too slowly relative to frequent features like destAdjacentToAlly.
// 3× boost breaks the attractor basin without overshooting.
const MOVE_FEATURE_LR_BOOST_IDX = 7; // destOnObjective
const MOVE_FEATURE_LR_BOOST = 3.0;

const ATTACK_FEATURE_NAMES = [
  'targetHpRatio', 'targetDistNorm', 'targetIsolated',
  'targetThreat', 'killPotential', 'bias',
];

export const MOVE_FEATURE_NAMES = [
  'distToNearestEnemy', 'threatAtDest', 'objectiveProximity',
  'allySupport', 'mpEfficiency', 'bias',
  'destInEnemyRange', 'destOnObjective', 'destAdjacentToAlly',
  'canAttackFromDest', 'bestReachableKillFraction', 'reachableUnactivatedFraction',
  'netDamageDelta', 'attackActionFeasibleAfterMove', 'losTargetCountNorm',
];

const SURGE_FEATURE_NAMES = ['damageValue', 'isAccuracy', 'isRecover', 'bias', 'accuracyNeeded', 'accuracySurplusIfAcc'];

const CC_FEATURE_NAMES = ['ccCost', 'ccIsOffensive', 'inCombat', 'bias', 'isCombatTimed'];

function getGroupCategory(absType) {
  if (absType === 'attack_close' || absType === 'attack_ranged') return 'attack';
  if (absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral') return 'move';
  if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') return 'surge';
  if (absType === 'play_cc') return 'cc';
  return null;
}

function getWgEpsilon(totalGames) {
  if (_greedyMode) return 0;
  return Math.max(WG_EPSILON_MIN, WG_EPSILON_START * Math.exp(-totalGames / WG_EPSILON_DECAY));
}

const REWARD_WEIGHTS = {
  vp: 10.0,               // VP gained (primary win condition)
  dmg: 0.5,               // Enemy HP removed
  hp: -0.5,               // Own HP lost (negative = penalty)
  dist: 0.4,              // Distance reduction to enemies (was 0.1 — raised to make movement visible to DQN)
  terminal: 50.0,         // Win/loss bonus at game end
  step: -0.005,           // Per-action cost (was -0.02 — lowered so step penalty doesn't drown out dist signal)
  activationAction: 0.15, // Bonus for productive actions during activation (move, attack, ability, interact)
};
export function setVpWeight(v) { REWARD_WEIGHTS.vp = v; }

const NUM_FEATURES = 50;

const FEATURE_NAMES = [
  // Original 16 (indices 0-15 preserved for weight compatibility)
  'vpAdv', 'myHpRatio', 'oppHpRatio', 'hpAdv',
  'myFigsRatio', 'figsAdv', 'closeness', 'nearestEnemy',
  'roundProgress', 'activationsRatio', 'inCombat', 'inMovement',
  'attackPower', 'bias',
  'enemyThreat', 'objectivePotential',
  // Batch 2: per-DC health (indices 16-17)
  'myLowestFigHp', 'oppLowestFigHp',
  // Batch 2: typed power tokens (indices 18-21, replaces lumped count)
  'myOffensiveTokens', 'myDefensiveTokens',
  'oppOffensiveTokens', 'oppDefensiveTokens',
  // Batch 2: CC hand (indices 22-25)
  'myCcHandSize', 'oppCcHandSize',
  'myAvgCcCost', 'oppAvgCcCost',
  // Batch 2: activation order (indices 26-28)
  'myExhaustedRatio', 'oppExhaustedRatio',
  'activationCountAdv',
  // Batch 2: conditions — total + stun separated (indices 29-32)
  'myConditions', 'oppConditions',
  'myStunnedRatio', 'oppStunnedRatio',
  // Batch 2: initiative + VP urgency (indices 33-35)
  'hasInitiative',
  'vpUrgency', 'oppVpUrgency',
  // Phase 2: active-DC context (indices 36-45) — who is currently acting
  'activeDcHpRatio',            // HP ratio of the currently activating figure
  'activeDcSpeed',              // Speed stat normalized /8
  'activeDcAttackPower',        // Expected damage from this DC's dice /8
  'activeDcAttackRange',        // Attack range normalized /12
  'activeDcDistToNearestEnemy', // Distance from active figure to nearest enemy /10
  'activeDcIsStunned',          // 1 if active figure has Stun condition
  'activeDcHasTargetsInRange',  // 1 if any enemy is within attack range + LOS approximation
  'activeDcFigureCount',        // Surviving figures in this group /3
  'activeDcDepletion',          // Fraction of group already defeated (0 = full, 1 = all dead)
  'activeDcActionsLeft',        // Remaining actions this activation /2
  // Phase 5: positional-awareness (indices 46-48) — help DQN value movement
  'fractionInRange',            // Fraction of my figures with ≥1 enemy in attack range
  'objectivesContested',        // Fraction of objectives with a friendly figure within 2 spaces
  'avgAllyDistToObjective',     // 1 - avg distance from all allies to nearest objective /10
  // Phase 6: dc_special visibility (index 49)
  'activeDcHasSpecial',         // 1 if active DC has at least one usable special ability
];

// Offensive (attacker-side) CC timings — used by ccIsOffensive feature in WG CC scorer.
export const OFFENSIVE_CC_TIMINGS = new Set([
  'whenyoudeclareattack', 'beforeyoudeclareattack', 'beforedeclaringrangedattack',
  'duringattack', 'afterattack',
  'afteryouresolveattackthatdidnotmissduetoaccuracy',
  'afteryouresolveattacktargetingfigure',
]);

// Combat-phase CC timings — these CCs are free interrupts during combat resolution.
// Lowercased to match the convention in canResolveCcHeadless.
export const COMBAT_CC_TIMINGS = new Set([
  // Attacker timings
  'whenyoudeclareattack', 'beforeyoudeclareattack', 'beforedeclaringrangedattack',
  'duringattack', 'afterattack',
  'afteryouresolveattackthatdidnotmissduetoaccuracy',
  'afteryouresolveattacktargetingfigure',
  'whileattackingbeforedefenderrerolls',
  'whenyoudeclareattacktargetinghostilewithhighestfigurecost',
  'whenyoudeclareclosequarters', 'whenyoudeclareindiscriminatefire',
  'whenyouperformrapidfire',
  // Defender timings
  'whenattackdeclaredonyou', 'whiledefending',
  'afterattacktargetingyouresolved',
  // Combat-any timings
  'afterattackdice', 'afterdamage',
  'whenfigurewithin3spacesdefending',
  'whileadjacentfriendlyfiguredefending',
  'whenfriendlyrebelforceuserwithin4spacesrollsdice',
  'whenanotherfriendlytrooperdeclaresattacktargetinginyourlineofsight',
]);

const ABSTRACT_TYPES = [
  // Original 15 (indices 0-14 preserved for network weight compatibility)
  'attack_close', 'attack_ranged', 'move_toward', 'move_away', 'move_lateral',
  'move_done', 'start_move', 'activate', 'end_activation', 'pass',
  'ability', 'spend_surge', 'skip_surges', 'reroll', 'other',
  // A2 splits — dedicated types for high-frequency tactical decisions
  'play_cc', 'react_use', 'react_skip', 'surge_damage', 'surge_special',
  'token_offense', 'token_defense',
  // A3 — interact (mission objectives, terminals, doors)
  'interact',
];

const NUM_ACTIONS = ABSTRACT_TYPES.length;

// Expected damage per attack die (from dice.json face averages)
const EXPECTED_DMG_PER_DIE = { red: 2.17, blue: 1.17, green: 1.33, yellow: 0.67 };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Box-Muller transform for standard normal random numbers. */
function randn() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function getHpTotals(dcHealthState, dcMessageMeta, playerNum) {
  let current = 0, max = 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    for (const [cur, mx] of healthArr) {
      current += cur;
      max += mx;
    }
  }
  return { current, max };
}

function lookupFigureHp(figureKey, playerNum, dcHealthState, dcMessageMeta) {
  if (!figureKey || !dcHealthState || !dcMessageMeta) return null;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const parts = figureKey.split('-');
  const figureIndex = parseInt(parts[parts.length - 1], 10) || 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    if (meta.dcName !== dcName && meta.dcName?.toLowerCase() !== dcName.toLowerCase()) continue;
    if (healthArr && healthArr[figureIndex]) {
      return { current: healthArr[figureIndex][0], max: healthArr[figureIndex][1] };
    }
  }
  return null;
}

function getAttackerPosition(action, game, dcMessageMeta) {
  const msgId = action.params?.msgId;
  const actingPN = action.actingPlayer;
  if (!msgId || !game.dcActionsData?.[msgId]) return null;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) return null;
  const actionsData = game.dcActionsData[msgId];
  const figureIndex = actionsData.selectedFigure ?? 0;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  return game.figurePositions?.[actingPN]?.[figureKey] || null;
}

function extractAttackFeatures(action, game, dcHealthState, dcMessageMeta) {
  const features = new Float64Array(6);
  features[5] = 1.0; // bias
  const targetFk = action.params?.targetFigureKey;
  if (!targetFk) return features;
  const actingPN = action.actingPlayer;
  const oppNum = actingPN === 1 ? 2 : 1;

  // [0] targetHpRatio — how wounded the target is (lower = more wounded)
  // NPC targets (Krykna, Thugs) aren't in dcHealthState — look up from game state
  let hp = null;
  let targetPos = null;
  if (targetFk.startsWith('npc_')) {
    const parts = targetFk.split('_');
    const npcType = parts[1];
    const npcIndex = parseInt(parts[2], 10);
    const npcArr = npcType === 'krykna' ? game.npcKrykna : game.npcThugs;
    const npc = npcArr?.[npcIndex];
    if (npc) { hp = { current: npc.hp, max: npc.maxHp }; targetPos = npc.coord; }
  } else {
    hp = lookupFigureHp(targetFk, oppNum, dcHealthState, dcMessageMeta);
    targetPos = game.figurePositions?.[oppNum]?.[targetFk];
  }
  if (hp && hp.max > 0) features[0] = hp.current / hp.max;
  const attackerPos = getAttackerPosition(action, game, dcMessageMeta);
  if (targetPos && attackerPos) {
    const dist = coordDistance(attackerPos, targetPos);
    features[1] = 1 - Math.min(dist, 10) / 10;
  }

  // [2] targetIsolated — fewer adjacent enemy allies = more isolated
  if (targetPos) {
    const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
    let adjacentAllies = 0;
    for (const [fk, pos] of oppFigs) {
      if (fk === targetFk) continue;
      if (coordDistance(pos, targetPos) <= 2) adjacentAllies++;
    }
    features[2] = 1 - Math.min(adjacentAllies, 3) / 3;
  }

  // [3] targetThreat — how dangerous the target DC is
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
  if (dcEffects) {
    const targetDcName = targetFk.replace(/-\d+-\d+$/, '');
    features[3] = Math.min(1, getExpectedDamage(dcEffects, targetDcName) / 8);
  }

  // [4] killPotential — can THIS attacker finish it off?
  if (hp && dcEffects) {
    const myDcName = action.params?.dcName;
    const myExpDmg = myDcName ? getExpectedDamage(dcEffects, myDcName) : 0;
    features[4] = hp.current <= myExpDmg ? 1.0 : 0.0;
  }

  return features;
}

/**
 * Extract per-space features for move scoring (Phase 5 Slice 2).
 * Precomputes shared data (enemy positions, objectives) once, then scores each coord.
 */
export function extractMoveFeatures(action, game, playerNum, dcHealthState = null, dcMessageMeta = null) {
  const features = new Float64Array(15);
  features[5] = 1.0; // bias

  const coord = action.params?.coord;
  if (!coord || action.params?.done) return features;

  const oppNum = playerNum === 1 ? 2 : 1;
  const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});

  // [0] distToNearestEnemy — closer to enemy = higher (aggression)
  let minEnemyDist = 10;
  for (const [, pos] of oppFigs) {
    const d = coordDistance(coord, pos);
    if (d < minEnemyDist) minEnemyDist = d;
  }
  features[0] = 1 - Math.min(minEnemyDist, 10) / 10;

  // [1] threatAtDest — sum of expected damage from enemies that can attack this coord
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
  if (dcEffects && oppFigs.length > 0) {
    let threat = 0;
    for (const [fk, pos] of oppFigs) {
      const dcName = fk.replace(/-\d+-\d+$/, '');
      const range = getAttackRange(dcEffects, dcName);
      const dist = coordDistance(pos, coord);
      if (dist <= range) {
        threat += getExpectedDamage(dcEffects, dcName);
      }
    }
    features[1] = Math.min(1, threat / 10);
  }

  // Gather objective coords once for [2] and [7]
  // Uses getObjectiveCoords() — the same source as the distance-greedy heuristic —
  // so WG move features see named areas (Command Center), deployment zone centroids,
  // and mission tokens, not just terminals.
  const objCoords = getObjectiveCoords(game);

  // [2] objectiveProximity — distance to nearest objective
  if (objCoords.length > 0) {
    let minObjDist = 10;
    for (const oc of objCoords) {
      try {
        const d = coordDistance(coord, oc);
        if (d < minObjDist) minObjDist = d;
      } catch { /* skip invalid */ }
    }
    features[2] = 1 - Math.min(minObjDist, 10) / 10;
  }

  // [3] allySupport — friendly figures within 3 spaces of destination
  let nearbyAllies = 0;
  for (const pos of myFigs) {
    if (coordDistance(coord, pos) <= 3) nearbyAllies++;
  }
  features[3] = Math.min(nearbyAllies, 4) / 4;

  // [4] mpEfficiency — movement cost relative to total MP (lower cost = higher efficiency)
  const moveKey = action.params?.moveKey;
  const moveState = moveKey ? game.moveInProgress?.[moveKey] : null;
  const totalMp = moveState?.totalMp || moveState?.mpRemaining || 4;
  const cost = action.params?.cost || 1;
  features[4] = 1 - Math.min(cost, totalMp) / totalMp;

  // [6] destInEnemyRange — fraction of enemy figures that can attack this destination
  if (dcEffects && oppFigs.length > 0) {
    let inRange = 0;
    for (const [fk, pos] of oppFigs) {
      const dcName = fk.replace(/-\d+-\d+$/, '');
      const range = getAttackRange(dcEffects, dcName);
      if (coordDistance(pos, coord) <= range) inRange++;
    }
    features[6] = Math.min(inRange, 4) / 4;
  }

  // [7] destOnObjective — 1 if destination is within 1 space of an objective/terminal
  for (const oc of objCoords) {
    try {
      if (coordDistance(coord, oc) <= 1) { features[7] = 1.0; break; }
    } catch { /* skip invalid */ }
  }

  // [8] destAdjacentToAlly — 1 if destination is adjacent (dist ≤ 1) to a friendly figure
  for (const pos of myFigs) {
    if (coordDistance(coord, pos) <= 1) { features[8] = 1.0; break; }
  }

  // ── Representation expansion (Option 1 features 9–14) ─────────────────────
  // Resolve actor context; features 9–13 need to know WHICH figure is moving
  // to compute my-attack-reachability, not just destination exposure.
  // Reuse `moveKey` and `moveState` declared above for feature [4].
  const myFigureKey = moveState?.figureKey || null;
  const myDcName = myFigureKey ? myFigureKey.replace(/-\d+-\d+$/, '') : null;
  // Use practical (accuracy-ceiling) range for MY attack surface in the new features —
  // matches src/engine/available-actions.js:computeAttackTargets. Enemy ranges below
  // still use getAttackRange() for backward compat of features [1]/[6].
  const myRange = (myDcName && dcEffects) ? getPracticalAttackRange(dcEffects, myDcName) : 0;
  const myExpDmg = (myDcName && dcEffects) ? getExpectedDamage(dcEffects, myDcName) : 0;

  // Resolve map spaces for LoS (fail-open: if unavailable, skip LoS gate).
  const mapId = game.selectedMap?.id;
  let mapSpaces = null;
  if (mapId) {
    try {
      const md = getMapData(mapId);
      if (md) mapSpaces = { blocking: md.blocking, impassableEdges: md.impassableEdges };
    } catch { /* fail open */ }
  }

  // Reachable-from-dest: Manhattan range gate + LoS gate (LoS skipped if mapSpaces null).
  // Builds [{ fk, pos }] so downstream features (10, 11) don't re-scan.
  const reachable = [];
  if (myRange > 0 && oppFigs.length > 0) {
    for (const [fk, pos] of oppFigs) {
      if (coordDistance(coord, pos) > myRange) continue;
      if (mapSpaces && !hasLineOfSight(coord, pos, mapSpaces)) continue;
      reachable.push({ fk, pos });
    }
  }

  // [9] canAttackFromDest — binary: at least one reachable target
  features[9] = reachable.length > 0 ? 1.0 : 0.0;

  // [10] bestReachableKillFraction — max(myExpDmg / targetHp), clipped at 1, over reachable
  if (reachable.length > 0 && myExpDmg > 0 && dcHealthState && dcMessageMeta) {
    let best = 0;
    for (const { fk } of reachable) {
      const hp = lookupFigureHp(fk, oppNum, dcHealthState, dcMessageMeta);
      if (!hp || hp.current <= 0) continue;
      const frac = Math.min(1, myExpDmg / hp.current);
      if (frac > best) best = frac;
    }
    features[10] = best;
  }

  // [11] reachableUnactivatedFraction — fraction of reachable targets whose DC has not yet
  // activated this round. Fail-open: missing activated-index state treats all as unactivated.
  if (reachable.length > 0) {
    const oppDcList = oppNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const activatedIdx = oppNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
    const activatedSet = new Set(activatedIdx);
    let unactivated = 0;
    for (const { fk } of reachable) {
      const enemyDcName = fk.replace(/-\d+-\d+$/, '');
      const idx = oppDcList.indexOf(enemyDcName);
      // idx < 0 (not found) → treat as unactivated (fail-open); matches user spec.
      if (idx < 0 || !activatedSet.has(idx)) unactivated++;
    }
    features[11] = unactivated / reachable.length;
  }

  // [12] netDamageDelta — (my expected outgoing this turn − sum of incoming expected damage)/10,
  // clipped to [-1, 1]. Matches feature [1]'s denominator so the scale is comparable.
  // Outgoing = myExpDmg if any reachable target exists (one attack/activation), else 0.
  // Incoming = sum over enemies that can hit `coord` (range-only, no LoS filter — matches [1]).
  if (dcEffects && oppFigs.length > 0) {
    const outDmg = (reachable.length > 0) ? myExpDmg : 0;
    let inDmg = 0;
    for (const [fk, pos] of oppFigs) {
      const eDc = fk.replace(/-\d+-\d+$/, '');
      const eRange = getAttackRange(dcEffects, eDc);
      if (coordDistance(pos, coord) <= eRange) inDmg += getExpectedDamage(dcEffects, eDc);
    }
    features[12] = Math.max(-1, Math.min(1, (outDmg - inDmg) / 10));
  }

  // [13] attackActionFeasibleAfterMove — 1 if the acting figure still has actions AND hasn't
  // attacked yet this activation. Largely activation-scoped (same value across candidate dests
  // within one activation); varies across activations.
  if (moveKey) {
    const msgId = String(moveKey).split('_')[0];
    const actionsData = game.dcActionsData?.[msgId];
    const actionsRemaining = actionsData?.remaining ?? 2;
    const alreadyAttacked = !!game.attackPerformedThisActivation?.[msgId];
    features[13] = (actionsRemaining >= 1 && !alreadyAttacked) ? 1.0 : 0.0;
  }

  // [14] losTargetCountNorm — count of enemies with LoS from this destination (no range gate),
  // normalized by 4 (same denominator as [3], [6]).
  if (oppFigs.length > 0) {
    let losCount = 0;
    if (mapSpaces) {
      for (const [, pos] of oppFigs) {
        if (hasLineOfSight(coord, pos, mapSpaces)) losCount++;
      }
    } else {
      losCount = oppFigs.length; // fail-open
    }
    features[14] = Math.min(1, losCount / 4);
  }

  return features;
}

/**
 * Estimate the quality of the best available move for the active figure.
 * Uses WG move weights to score approximate post-move destination features.
 * Returns a scalar in [0,1]: higher = better moves available.
 * Returns 0 if targets are already in range (should attack, not move).
 */
function estimateMoveQuality(game, playerNum, dcHealthState, dcMessageMeta, wgMoveWeights) {
  if (!wgMoveWeights || wgMoveWeights.length < 9) return 0;

  const active = findActiveDcMsgId(game, playerNum, dcMessageMeta);
  if (!active) return 0;

  const { msgId, meta, dcName } = active;
  const oppNum = playerNum === 1 ? 2 : 1;

  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
  const lower = dcName.toLowerCase();
  const ciKey = dcEffects ? Object.keys(dcEffects).find(k => k.toLowerCase() === lower) : null;
  const eff = dcEffects?.[dcName] || (ciKey ? dcEffects[ciKey] : null);
  const speed = eff?.speed || 4;
  const attackRange = eff?.attack?.range || 1;

  // Find active figure position
  const actionsData = game.dcActionsData?.[msgId];
  const figureIndex = actionsData?.selectedFigure ?? 0;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${dcName}-${dgIndex}-${figureIndex}`;
  let pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos && game.moveInProgress) {
    for (const ms of Object.values(game.moveInProgress)) {
      if (ms?.currentPosition) { pos = ms.currentPosition; break; }
    }
  }
  if (!pos) return 0;

  const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});

  // If targets already in range, move quality is 0 (should attack instead)
  for (const [, oPos] of oppFigs) {
    if (coordDistance(pos, oPos) <= attackRange) return 0;
  }

  // [0] distToNearestEnemy — after optimal move, min dist reduced by speed
  let minEnemyDist = 10;
  for (const [, oPos] of oppFigs) {
    const d = coordDistance(pos, oPos);
    if (d < minEnemyDist) minEnemyDist = d;
  }
  const f0 = 1 - Math.min(Math.max(0, minEnemyDist - speed), 10) / 10;

  // [1] threatAtDest — unknown, conservative estimate: 0
  const f1 = 0;

  // [2] objectiveProximity — after move, distance to nearest objective reduced by speed
  let minObjDist = 10;
  let mapTokens;
  try { mapTokens = getMapTokensData(); } catch { mapTokens = null; }
  const mapId = game.selectedMap?.id;
  const objCoords = [];
  if (mapTokens && mapId && mapTokens[mapId]) {
    const mapData = mapTokens[mapId];
    if (Array.isArray(mapData.terminals)) objCoords.push(...mapData.terminals);
    const variant = game.selectedMission?.variant;
    const missionKey = variant ? `mission${variant.toUpperCase()}` : null;
    if (missionKey && mapData[missionKey]?.positions) {
      for (const coords of Object.values(mapData[missionKey].positions)) {
        if (Array.isArray(coords)) objCoords.push(...coords);
      }
    }
  }
  for (const oc of objCoords) {
    try {
      const d = coordDistance(pos, oc);
      if (d < minObjDist) minObjDist = d;
    } catch { /* skip invalid */ }
  }
  const f2 = 1 - Math.min(Math.max(0, minObjDist - speed), 10) / 10;

  // [3] allySupport — allies within (speed + 3) range of current position
  let nearbyAllies = 0;
  for (const aPos of myFigs) {
    if (coordDistance(pos, aPos) <= speed + 3) nearbyAllies++;
  }
  const f3 = Math.min(nearbyAllies, 4) / 4;

  // [4] mpEfficiency — assume efficient full-speed use
  const f4 = 1.0;

  // [5] bias — 0
  // [6] destInEnemyRange — optimistic: assume we find a safe hex
  const f6 = 0;

  // [7] destOnObjective — can reach an objective within speed?
  const f7 = minObjDist <= speed ? 1.0 : 0;

  // [8] destAdjacentToAlly — can reach adjacent to any ally?
  let f8 = 0;
  for (const aPos of myFigs) {
    if (coordDistance(pos, aPos) <= speed + 1) { f8 = 1.0; break; }
  }

  // Score with WG move weights
  const approx = [f0, f1, f2, f3, f4, 0, f6, f7, f8];
  let score = 0;
  for (let i = 0; i < 9; i++) {
    score += wgMoveWeights[i] * approx[i];
  }

  // Normalize to [0,1] — 15.0 is approximate max achievable score
  return Math.max(0, Math.min(1, score / 15.0));
}

/**
 * Candidate D helper: is this surge pure accuracy with no other payload?
 * Returns true only for surges that add accuracy and nothing else —
 * no damage, pierce, blast, cleave, recover, conditions, or special effects.
 */
function _isPureAccuracySurge(surgeKey) {
  const p = parseSurgeEffect(surgeKey);
  if ((p.accuracy || 0) <= 0) return false;
  if ((p.damage || 0) + (p.pierce || 0) + (p.blast || 0) + (p.cleave || 0) + (p.recover || 0) > 0) return false;
  if (p.conditions?.length > 0) return false;
  const stdKeys = new Set(['damage', 'pierce', 'accuracy', 'conditions', 'blast', 'recover', 'cleave']);
  for (const k of Object.keys(p)) {
    if (!stdKeys.has(k) && p[k]) return false;
  }
  return true;
}

/**
 * Extract per-surge features for surge scoring (Phase 5 Slice 3).
 * Scores each surge option by its combat value.
 */
function extractSurgeFeatures(action, game) {
  const features = new Float64Array(6);
  features[3] = 1.0; // bias

  const surgeKey = action.params?.surgeKey;
  if (!surgeKey) return features;

  const parsed = parseSurgeEffect(surgeKey);

  // [0] damageValue — total offensive output (damage + pierce + blast + cleave), normalized
  const totalDmg = (parsed.damage || 0) + (parsed.pierce || 0) + (parsed.blast || 0) + (parsed.cleave || 0);
  features[0] = Math.min(totalDmg, 8) / 8;

  // [1] isAccuracy — does this surge add accuracy (needed for ranged attacks)
  features[1] = (parsed.accuracy || 0) > 0 ? 1.0 : 0.0;

  // [2] isRecover — does this surge recover health
  features[2] = (parsed.recover || 0) > 0 ? 1.0 : 0.0;

  const cbt = game?.pendingCombat || game?.combat;
  if (cbt && cbt.isRanged) {
    const dist = cbt.distanceToTarget || 0;
    const rolledAcc = cbt.attackRoll?.acc || 0;
    const bonusAcc = cbt.bonusAccuracy || 0;
    const surgeAcc = cbt.surgeAccuracy || 0;
    const totalAcc = rolledAcc + bonusAcc + surgeAcc;

    // [4] accuracyNeeded — how much the attack needs more accuracy to hit.
    // 1.0 = severe deficit (≥5 short), 0.0 = already sufficient or melee.
    const deficit = Math.max(0, dist - totalAcc);
    features[4] = Math.min(deficit / 5, 1.0);

    // [5] accuracySurplusIfAcc — interaction: surplus × isAccuracy.
    // Non-zero only for accuracy surges when accuracy is already sufficient.
    // Discriminative: damage surges get 0, accuracy surges get normalized surplus.
    // Expected learned weight: negative (penalize redundant accuracy surges).
    const surplus = Math.max(0, totalAcc - dist);
    features[5] = features[1] * Math.min(surplus / 5, 1.0);
  }

  return features;
}

/**
 * Extract per-CC features for command card scoring (Phase 5 Slice 4).
 * Scores each playable CC by cost, type, and game context.
 */
function extractCcFeatures(action, game) {
  const features = new Float64Array(5);
  features[3] = 1.0; // bias

  const cardName = action.params?.cardName;
  if (!cardName) return features;

  const ccData = getCcEffect(cardName);

  // [0] ccCost — higher cost CCs tend to be more impactful, normalized to 0-1
  features[0] = ccData ? Math.min(ccData.cost || 0, 4) / 4 : 0;

  // [1] ccIsOffensive — attacker-side combat timing CCs are high-value free interrupts
  const timing = (ccData?.timing || '').toLowerCase();
  features[1] = OFFENSIVE_CC_TIMINGS.has(timing) ? 1.0 : 0.0;

  // [2] inCombat — is there an active combat? Combat-timed CCs are more valuable then
  features[2] = game.pendingCombat ? 1.0 : 0.0;

  // [4] isCombatTimed — is this CC's timing a combat interrupt (attacker or defender)?
  // Separates combat-timed CCs (free interrupts) from non-combat-timed CCs.
  features[4] = COMBAT_CC_TIMINGS.has(timing) ? 1.0 : 0.0;

  return features;
}

/**
 * Extract per-DC features for activation-order scoring (gated learned surface).
 * Only called when no strategic prefilter fires and no combat-ready DC exists.
 * 8 features: enemyThreat, hpFraction, figureCount, minEnemyNorm, minObjNorm,
 *             attackRange, roundFraction, activationsLeft.
 */
function extractActivateFeatures(action, game, dcHealthState, dcMessageMeta) {
  const features = new Float64Array(8);
  features[7] = 1.0; // bias (activationsLeft slot doubles as bias when data unavailable)
  const dcName = action.params?.dcName;
  const msgId = action.params?.msgId;
  if (!dcName) return features;
  const playerNum = action.actingPlayer;
  const oppNum = playerNum === 1 ? 2 : 1;

  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }

  // Gather this DC's figures
  const myFigs = Object.entries(game.figurePositions?.[playerNum] || {})
    .filter(([fk]) => fk.startsWith(dcName + '-'));
  const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
  const objCoords = getObjectiveCoords(game);

  // [0] enemyThreat — how many enemy figures can attack this DC (defensive urgency)
  // Counts enemies whose attack range covers any of this DC's figures, normalized
  if (dcEffects && myFigs.length > 0) {
    let threatCount = 0;
    for (const [, myPos] of myFigs) {
      for (const [oppFk, oppPos] of oppFigs) {
        const oppDcName = oppFk.replace(/-\d+-\d+$/, '');
        const oppRange = getAttackRange(dcEffects, oppDcName);
        if (coordDistance(myPos, oppPos) <= oppRange) threatCount++;
      }
    }
    features[0] = Math.min(1, threatCount / 4);
  }

  // [1] hpFraction — avg(currentHP / maxHP) across DC figures (wounded magnitude)
  if (msgId && dcHealthState) {
    const healthArr = dcHealthState.get(msgId);
    if (healthArr) {
      let hpSum = 0, hpCount = 0;
      for (const h of healthArr) {
        if (h && h[1] > 0) { hpSum += h[0] / h[1]; hpCount++; }
      }
      features[1] = hpCount > 0 ? hpSum / hpCount : 1.0;
    } else {
      features[1] = 1.0; // assume full HP if no data
    }
  } else {
    features[1] = 1.0;
  }

  // [2] figureCount — nFigures / max(nFigures across all candidates), normalized 0-1
  // Using raw count / 3 as normalization (most DCs have 1-3 figures)
  features[2] = Math.min(1, myFigs.length / 3);

  // [3] minEnemyNorm — min distance to nearest enemy, normalized (closer = higher)
  let minEnemy = 10;
  for (const [, myPos] of myFigs) {
    for (const [, oppPos] of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < minEnemy) minEnemy = d;
    }
  }
  features[3] = 1 - Math.min(minEnemy, 10) / 10;

  // [4] minObjNorm — min distance to nearest objective, normalized (closer = higher)
  let minObj = 10;
  for (const [, myPos] of myFigs) {
    for (const oc of objCoords) {
      try {
        const d = coordDistance(myPos, oc);
        if (d < minObj) minObj = d;
      } catch { /* skip invalid coords */ }
    }
  }
  features[4] = objCoords.length > 0 ? 1 - Math.min(minObj, 10) / 10 : 0;

  // [5] attackRange — ranged (1) vs melee (0)
  if (dcEffects) {
    const range = getAttackRange(dcEffects, dcName);
    features[5] = range > 1 ? 1.0 : 0.0;
  }

  // [6] roundFraction — currentRound / 4 (late-round = higher)
  features[6] = Math.min(1, (game.currentRound || 1) / 4);

  // [7] activationsLeft — remaining activations / total DCs
  const myMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const myActivated = playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
  const totalDcs = myMsgIds.length;
  const remaining = totalDcs - myActivated.length;
  features[7] = totalDcs > 0 ? remaining / totalDcs : 0.5;

  return features;
}

function getAvgDistToEnemy(game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
  if (myFigs.length === 0 || oppFigs.length === 0) return 8;
  let totalDist = 0;
  for (const myPos of myFigs) {
    let minD = Infinity;
    for (const oppPos of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < minD) minD = d;
    }
    totalDist += minD;
  }
  return totalDist / myFigs.length;
}

function getMinDistToEnemy(game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
  if (myFigs.length === 0 || oppFigs.length === 0) return 10;
  let globalMin = Infinity;
  for (const myPos of myFigs) {
    for (const oppPos of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < globalMin) globalMin = d;
    }
  }
  return globalMin;
}

function getArmyAttackPower(game, playerNum) {
  const figs = game.figurePositions?.[playerNum] || {};
  const figKeys = Object.keys(figs);
  if (figKeys.length === 0) return 0;
  let totalDmg = 0;
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { return 0; }
  for (const figKey of figKeys) {
    const dcName = figKey.replace(/-\d+-\d+$/, '');
    const lower = dcName.toLowerCase();
    const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
    const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
    if (eff?.attack?.dice) {
      for (const die of eff.attack.dice) {
        totalDmg += EXPECTED_DMG_PER_DIE[die] || 0;
      }
    }
  }
  return Math.min(1, totalDmg / 15);
}

function getExpectedDamage(dcEffects, dcName) {
  const lower = dcName.toLowerCase();
  const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
  const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
  if (!eff?.attack?.dice) return 0;
  let dmg = 0;
  for (const die of eff.attack.dice) {
    dmg += EXPECTED_DMG_PER_DIE[die] || 0;
  }
  return dmg;
}

function getAttackRange(dcEffects, dcName) {
  const lower = dcName.toLowerCase();
  const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
  const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
  if (!eff?.attack) return 1; // default melee
  return eff.attack.range || 1;
}

// Practical range used by the new move features [9–12, 14]. Mirrors the accuracy-ceiling
// logic in computeAttackTargets (src/engine/available-actions.js:2128–2142): for ranged
// attacks lacking an explicit `attack.range`, use the max accuracy the dice pool could roll.
// For melee, range is 1. Kept separate from getAttackRange() so existing feature semantics
// (features [1] threatAtDest, [6] destInEnemyRange) remain comparable across audit baselines.
const MAX_ACC_PER_DIE = { blue: 5, green: 3, yellow: 2, red: 0 };
export function getPracticalAttackRange(dcEffects, dcName) {
  const lower = dcName.toLowerCase();
  const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
  const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
  if (!eff?.attack) return 1;
  const atk = eff.attack;
  if (Array.isArray(atk.range)) return atk.range[1] || 1;
  if (typeof atk.range === 'number') return atk.range;
  if (atk.type === 'range' && Array.isArray(atk.dice)) {
    let acc = 0;
    for (const die of atk.dice) acc += (MAX_ACC_PER_DIE[die] || 0);
    for (const sa of (eff.surgeAbilities || [])) {
      const m = String(sa).match(/^accuracy\s+(\d+)$/i);
      if (m) acc += parseInt(m[1], 10);
    }
    return Math.max(1, acc);
  }
  return 1; // melee / unknown
}

// ── New Feature Helpers ─────────────────────────────────────────────────────

/**
 * enemyThreat — Approximate incoming danger to the currently acting figure.
 * Counts enemy figures within their attack range of the active figure,
 * weighted by expected damage. Normalizes to [0, 1].
 */
function getEnemyThreat(game, playerNum, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  let activeFigPos = null;

  // Try to find the currently activated figure from dcActionsData
  if (game.dcActionsData && dcMessageMeta) {
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta?.playerNum === playerNum && game.dcActionsData?.[msgId]) {
        const actionsData = game.dcActionsData[msgId];
        const figureIndex = actionsData.selectedFigure ?? 0;
        const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
        activeFigPos = game.figurePositions?.[playerNum]?.[figureKey];
        if (activeFigPos) break;
      }
    }
  }

  // Fallback: check moveInProgress for a moving figure
  if (!activeFigPos && game.moveInProgress) {
    for (const moveState of Object.values(game.moveInProgress)) {
      if (moveState?.currentPosition) {
        activeFigPos = moveState.currentPosition;
        break;
      }
    }
  }

  // No active figure found — return 0
  if (!activeFigPos) return 0;

  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { return 0; }

  const oppFigs = game.figurePositions?.[oppNum] || {};
  let threat = 0;

  for (const [figKey, pos] of Object.entries(oppFigs)) {
    const dcName = figKey.replace(/-\d+-\d+$/, '');
    const attackRange = getAttackRange(dcEffects, dcName);
    const dist = coordDistance(pos, activeFigPos);
    if (dist <= attackRange) {
      threat += getExpectedDamage(dcEffects, dcName);
    }
  }

  return Math.min(1, threat / 15);
}

/**
 * objectivePotential — How close the closest friendly figure is to any
 * map objective (terminals + mission tokens). Inversely normalized like closeness.
 */
function getObjectivePotential(game, playerNum) {
  let mapTokens;
  try { mapTokens = getMapTokensData(); } catch { return 0; }

  const mapId = game.selectedMap?.id;
  if (!mapId || !mapTokens?.[mapId]) return 0;

  const mapData = mapTokens[mapId];
  const objectiveCoords = [];

  // Add terminal positions
  if (Array.isArray(mapData.terminals)) {
    for (const coord of mapData.terminals) {
      objectiveCoords.push(coord);
    }
  }

  // Add mission variant positions
  const variant = game.selectedMission?.variant;
  const missionKey = variant ? `mission${variant.toUpperCase()}` : null;
  if (missionKey && mapData[missionKey]?.positions) {
    for (const coords of Object.values(mapData[missionKey].positions)) {
      if (Array.isArray(coords)) {
        for (const coord of coords) {
          objectiveCoords.push(coord);
        }
      }
    }
  }

  if (objectiveCoords.length === 0) return 0;

  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  if (myFigs.length === 0) return 0;

  let globalMinDist = Infinity;
  for (const figPos of myFigs) {
    for (const objCoord of objectiveCoords) {
      try {
        const d = coordDistance(figPos, objCoord);
        if (d < globalMinDist) globalMinDist = d;
      } catch { /* skip invalid coords */ }
    }
  }

  if (!isFinite(globalMinDist)) return 0;
  return 1 - Math.min(globalMinDist, 10) / 10;
}

// ── Positional Awareness (Phase 5) ──────────────────────────────────────────

/**
 * Compute 3 army-level positional features to help the DQN value movement.
 * Returns [fractionInRange, objectivesContested, avgAllyDistToObjective].
 */
function getPositionalAwarenessFeatures(game, playerNum) {
  const result = new Float64Array(3);
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigEntries = Object.entries(game.figurePositions?.[playerNum] || {});
  const oppFigEntries = Object.entries(game.figurePositions?.[oppNum] || {});
  if (myFigEntries.length === 0) return result;

  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }

  // [0] fractionInRange — fraction of my figures with ≥1 enemy in attack range
  if (dcEffects && oppFigEntries.length > 0) {
    let inRange = 0;
    for (const [fk, pos] of myFigEntries) {
      const dcName = fk.replace(/-\d+-\d+$/, '');
      const range = getAttackRange(dcEffects, dcName);
      for (const [, ePos] of oppFigEntries) {
        if (coordDistance(pos, ePos) <= range) { inRange++; break; }
      }
    }
    result[0] = inRange / myFigEntries.length;
  }

  // Gather objective coords for [1] and [2]
  let mapTokens;
  try { mapTokens = getMapTokensData(); } catch { mapTokens = null; }
  const mapId = game.selectedMap?.id;
  const objCoords = [];
  if (mapTokens && mapId && mapTokens[mapId]) {
    const mapData = mapTokens[mapId];
    if (Array.isArray(mapData.terminals)) objCoords.push(...mapData.terminals);
    const variant = game.selectedMission?.variant;
    const missionKey = variant ? `mission${variant.toUpperCase()}` : null;
    if (missionKey && mapData[missionKey]?.positions) {
      for (const coords of Object.values(mapData[missionKey].positions)) {
        if (Array.isArray(coords)) objCoords.push(...coords);
      }
    }
  }

  if (objCoords.length > 0) {
    // [1] objectivesContested — fraction of objectives with a friendly within 2 spaces
    let contested = 0;
    for (const oc of objCoords) {
      try {
        for (const [, pos] of myFigEntries) {
          if (coordDistance(pos, oc) <= 2) { contested++; break; }
        }
      } catch { /* skip */ }
    }
    result[1] = contested / objCoords.length;

    // [2] avgAllyDistToObjective — avg of each ally's min distance to any objective
    let totalDist = 0;
    for (const [, pos] of myFigEntries) {
      let minD = 10;
      for (const oc of objCoords) {
        try {
          const d = coordDistance(pos, oc);
          if (d < minD) minD = d;
        } catch { /* skip */ }
      }
      totalDist += minD;
    }
    result[2] = 1 - Math.min(totalDist / myFigEntries.length, 10) / 10;
  }

  return result;
}

// ── Active-DC Feature Helpers (Phase 2) ──────────────────────────────────────

/**
 * Find the currently activating DC's msgId for this player.
 * Returns { msgId, meta, dcName } or null if no activation is in progress.
 */
function findActiveDcMsgId(game, playerNum, dcMessageMeta) {
  // Primary: use currentActivatingDcIndex to look up the DC by position
  const dcIdx = game.currentActivatingDcIndex;
  const dcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
  if (dcIdx != null && dcMsgIds && dcMsgIds[dcIdx]) {
    const msgId = dcMsgIds[dcIdx];
    const meta = dcMessageMeta?.get(msgId);
    if (meta && meta.playerNum === playerNum) {
      return { msgId, meta, dcName: meta.dcName };
    }
  }
  // Fallback: scan dcActionsData for an entry belonging to this player
  if (game.dcActionsData && dcMessageMeta) {
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta?.playerNum === playerNum && game.dcActionsData?.[msgId]) {
        return { msgId, meta, dcName: meta.dcName };
      }
    }
  }
  return null;
}

/**
 * Extract active-DC context features for the currently activating figure.
 * Returns a 10-element array (indices 36-45 of the feature vector).
 * Returns all zeros when no activation is in progress (combat, gates, etc.).
 */
function getActiveDcFeatures(game, playerNum, dcHealthState, dcMessageMeta) {
  const result = new Float64Array(10); // all zeros by default

  const active = findActiveDcMsgId(game, playerNum, dcMessageMeta);
  if (!active) return result;

  const { msgId, meta, dcName } = active;
  const oppNum = playerNum === 1 ? 2 : 1;

  // Load DC stats from effects data
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
  const lower = dcName.toLowerCase();
  const ciKey = dcEffects ? Object.keys(dcEffects).find(k => k.toLowerCase() === lower) : null;
  const eff = dcEffects?.[dcName] || (ciKey ? dcEffects[ciKey] : null);

  // [0] activeDcHpRatio — HP of the active DC group
  const healthArr = dcHealthState?.get(msgId);
  if (healthArr) {
    let cur = 0, max = 0;
    for (const [c, m] of healthArr) { cur += c; max += m; }
    result[0] = max > 0 ? cur / max : 0;

    // [7] activeDcFigureCount — surviving figures in this group /3
    let alive = 0;
    for (const [c] of healthArr) { if (c > 0) alive++; }
    result[7] = Math.min(alive, 3) / 3;

    // [8] activeDcDepletion — fraction of group already dead
    const total = healthArr.length;
    result[8] = total > 0 ? (total - alive) / total : 0;
  }

  // [1] activeDcSpeed
  if (eff?.speed) result[1] = Math.min(eff.speed, 8) / 8;

  // [2] activeDcAttackPower — expected damage from this DC's dice
  if (eff?.attack?.dice) {
    let dmg = 0;
    for (const die of eff.attack.dice) dmg += EXPECTED_DMG_PER_DIE[die] || 0;
    result[2] = Math.min(dmg, 8) / 8;
  }

  // [3] activeDcAttackRange — derive from attack type (no numeric range in data)
  const isRangedDc = eff?.attack?.type === 'range';
  const range = isRangedDc ? 20 : 1;
  result[3] = isRangedDc ? 1.0 : 1 / 12;

  // Find the active figure's position
  let activeFigPos = null;
  const actionsData = game.dcActionsData?.[msgId];
  const figureIndex = actionsData?.selectedFigure ?? 0;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${dcName}-${dgIndex}-${figureIndex}`;
  activeFigPos = game.figurePositions?.[playerNum]?.[figureKey];

  // Fallback: try moveInProgress
  if (!activeFigPos && game.moveInProgress) {
    for (const moveState of Object.values(game.moveInProgress)) {
      if (moveState?.currentPosition) { activeFigPos = moveState.currentPosition; break; }
    }
  }

  if (activeFigPos) {
    // [4] activeDcDistToNearestEnemy
    const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
    let minDist = Infinity;
    for (const [, pos] of oppFigs) {
      const d = coordDistance(activeFigPos, pos);
      if (d < minDist) minDist = d;
    }
    result[4] = isFinite(minDist) ? 1 - Math.min(minDist, 10) / 10 : 0;

    // [6] activeDcHasTargetsInRange — any enemy within attack range?
    if (oppFigs.length > 0) {
      for (const [, pos] of oppFigs) {
        if (coordDistance(activeFigPos, pos) <= range) {
          result[6] = 1;
          break;
        }
      }
    }
  }

  // [5] activeDcIsStunned
  if (game.figureConditions?.[figureKey]?.includes('Stun')) {
    result[5] = 1;
  }

  // [9] activeDcActionsLeft — remaining actions this activation /2
  if (actionsData && typeof actionsData.remaining === 'number') {
    result[9] = Math.min(actionsData.remaining, 2) / 2;
  } else {
    result[9] = 1; // Default: assume 2 actions at start
  }

  return result;
}

/**
 * Binary feature: does the active DC have at least one usable special ability?
 * Returns 1 if yes, 0 otherwise. Checks: not stunned, actions remaining, not already used.
 */
function getActiveDcHasSpecial(game, playerNum, dcMessageMeta) {
  const active = findActiveDcMsgId(game, playerNum, dcMessageMeta);
  if (!active) return 0;

  const { msgId, dcName } = active;
  const actionsData = game.dcActionsData?.[msgId];
  const remaining = actionsData?.remaining ?? 2;
  if (remaining < 1) return 0;

  // Stun check
  const figureIndex = actionsData?.selectedFigure ?? 0;
  const dgMatch = (active.meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${dcName}-${dgIndex}-${figureIndex}`;
  if ((game.figureConditions?.[figureKey] || []).includes('Stun')) return 0;

  // Check specials from dc-effects data
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { return 0; }
  const lower = dcName.toLowerCase();
  const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
  const eff = dcEffects?.[dcName] || (ciKey ? dcEffects[ciKey] : null);
  const specials = eff?.specials || [];
  if (specials.length === 0) return 0;

  const specialsUsed = actionsData?.specialsUsed || [];
  for (let si = 0; si < specials.length; si++) {
    if (!specialsUsed.includes(si) && remaining >= 1) return 1;
  }
  return 0;
}

// ── Per-DC / Per-Figure Feature Helpers ──────────────────────────────────────

/**
 * Lowest surviving figure HP ratio for a player (0 = near death, 1 = full health).
 * Tells the AI which side has a vulnerable figure.
 */
function getLowestFigHpRatio(dcHealthState, dcMessageMeta, playerNum) {
  let lowest = 1;
  let found = false;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    for (const [cur, mx] of healthArr) {
      if (mx <= 0 || cur <= 0) continue; // dead or invalid
      found = true;
      const ratio = cur / mx;
      if (ratio < lowest) lowest = ratio;
    }
  }
  return found ? lowest : 1;
}

/**
 * Power token counts by type for a player.
 * Returns { offensive, defensive } normalized to /4 each.
 * Offensive = Hit + Surge tokens, Defensive = Block + Evade tokens.
 */
function getPowerTokensByType(game, playerNum) {
  const tokens = game.figurePowerTokens;
  if (!tokens) return { offensive: 0, defensive: 0 };
  const myFigKeys = Object.keys(game.figurePositions?.[playerNum] || {});
  let off = 0, def = 0;
  for (const fk of myFigKeys) {
    const ft = tokens[fk];
    if (!Array.isArray(ft)) continue;
    for (const t of ft) {
      const tl = String(t).toLowerCase();
      if (tl === 'hit' || tl === 'surge') off++;
      else if (tl === 'block' || tl === 'evade') def++;
    }
  }
  return { offensive: Math.min(off, 4) / 4, defensive: Math.min(def, 4) / 4 };
}

/**
 * CC hand size for a player, normalized (starting hand 3, max ~6).
 */
function getCcHandSizeNorm(game, playerNum) {
  const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
  if (!Array.isArray(hand)) return 0;
  return Math.min(hand.length, 6) / 6;
}

/**
 * Fraction of DCs exhausted (activated) this round.
 * 1 = all activated, 0 = none activated.
 */
function getExhaustedRatio(game, playerNum) {
  const activated = playerNum === 1 ? game.p1ActivatedDcIndices : game.p2ActivatedDcIndices;
  const total = playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
  if (!total || total <= 0) return 0;
  const numActivated = Array.isArray(activated) ? activated.length : 0;
  return Math.min(numActivated / total, 1);
}

/**
 * Condition counts for a player's figures.
 * Returns { total, stunned } — total conditions normalized /8,
 * stunned figures as fraction of alive figures.
 * Stun is separated because it blocks ALL actions (most impactful condition).
 */
function getConditionCounts(game, playerNum) {
  const conditions = game.figureConditions;
  const myFigKeys = Object.keys(game.figurePositions?.[playerNum] || {});
  if (!conditions || myFigKeys.length === 0) return { total: 0, stunned: 0 };
  let total = 0, stunned = 0;
  for (const fk of myFigKeys) {
    const fc = conditions[fk];
    if (!Array.isArray(fc)) continue;
    total += fc.length;
    if (fc.some(c => String(c).toLowerCase() === 'stun')) stunned++;
  }
  return {
    total: Math.min(total, 8) / 8,
    stunned: stunned / myFigKeys.length,
  };
}

/**
 * Average CC cost in a player's hand, normalized.
 * Higher avg cost = more powerful but harder to play.
 */
function getAvgCcCost(game, playerNum) {
  const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
  if (!Array.isArray(hand) || hand.length === 0) return 0;
  let totalCost = 0;
  for (const cardName of hand) {
    try {
      const effect = getCcEffect(cardName);
      totalCost += typeof effect?.cost === 'number' ? effect.cost : 0;
    } catch { /* unknown card */ }
  }
  return Math.min(totalCost / hand.length, 3) / 3; // Normalize: avg cost 0-3 → 0-1
}

// ── Feature Extraction ──────────────────────────────────────────────────────

export function extractFeatures(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myVP = (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const oppVP = (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);
  const myFigs = Object.keys(game.figurePositions?.[playerNum] || {}).length;
  const oppFigs = Object.keys(game.figurePositions?.[oppNum] || {}).length;
  const avgDist = getAvgDistToEnemy(game, playerNum);
  const minDist = getMinDistToEnemy(game, playerNum);
  const round = game.currentRound || game.round || 1;
  const myActs = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const oppActs = oppNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);

  const myHpRatio = myHp.max > 0 ? myHp.current / myHp.max : 0;
  const oppHpRatio = oppHp.max > 0 ? oppHp.current / oppHp.max : 0;
  const totalFigs = myFigs + oppFigs;
  const totalActs = myActs + oppActs;

  // Typed power tokens
  const myTokens = getPowerTokensByType(game, playerNum);
  const oppTokens = getPowerTokensByType(game, oppNum);

  // Conditions with Stun separated
  const myCond = getConditionCounts(game, playerNum);
  const oppCond = getConditionCounts(game, oppNum);

  return [
    /* 0  vpAdv             */ (myVP - oppVP) / 40,
    /* 1  myHpRatio         */ myHpRatio,
    /* 2  oppHpRatio        */ oppHpRatio,
    /* 3  hpAdv             */ myHpRatio - oppHpRatio,
    /* 4  myFigsRatio       */ totalFigs > 0 ? myFigs / totalFigs : 0.5,
    /* 5  figsAdv           */ totalFigs > 0 ? (myFigs - oppFigs) / totalFigs : 0,
    /* 6  closeness         */ 1 - Math.min(avgDist, 10) / 10,
    /* 7  nearestEnemy      */ 1 - Math.min(minDist, 10) / 10,
    /* 8  roundProgress     */ Math.min(round, 5) / 5,
    /* 9  activationsRatio  */ totalActs > 0 ? myActs / totalActs : 0.5,
    /* 10 inCombat          */ game.pendingCombat ? 1 : 0,
    /* 11 inMovement        */ game.moveInProgress && Object.keys(game.moveInProgress).length > 0 ? 1 : 0,
    /* 12 attackPower       */ getArmyAttackPower(game, playerNum),
    /* 13 bias              */ 1.0,
    /* 14 enemyThreat       */ getEnemyThreat(game, playerNum, dcMessageMeta),
    /* 15 objectivePotential */ getObjectivePotential(game, playerNum),
    // Per-DC health (16-17)
    /* 16 myLowestFigHp     */ getLowestFigHpRatio(dcHealthState, dcMessageMeta, playerNum),
    /* 17 oppLowestFigHp    */ getLowestFigHpRatio(dcHealthState, dcMessageMeta, oppNum),
    // Typed power tokens (18-21)
    /* 18 myOffensiveTokens */ myTokens.offensive,
    /* 19 myDefensiveTokens */ myTokens.defensive,
    /* 20 oppOffensiveTokens*/ oppTokens.offensive,
    /* 21 oppDefensiveTokens*/ oppTokens.defensive,
    // CC hand (22-25)
    /* 22 myCcHandSize      */ getCcHandSizeNorm(game, playerNum),
    /* 23 oppCcHandSize     */ getCcHandSizeNorm(game, oppNum),
    /* 24 myAvgCcCost       */ getAvgCcCost(game, playerNum),
    /* 25 oppAvgCcCost      */ getAvgCcCost(game, oppNum),
    // Activation order (26-28)
    /* 26 myExhaustedRatio  */ getExhaustedRatio(game, playerNum),
    /* 27 oppExhaustedRatio */ getExhaustedRatio(game, oppNum),
    /* 28 activationCountAdv*/ totalActs > 0 ? (myActs - oppActs) / Math.max(totalActs, 1) : 0,
    // Conditions — total + stun (29-32)
    /* 29 myConditions      */ myCond.total,
    /* 30 oppConditions     */ oppCond.total,
    /* 31 myStunnedRatio    */ myCond.stunned,
    /* 32 oppStunnedRatio   */ oppCond.stunned,
    // Initiative + VP urgency (33-35)
    /* 33 hasInitiative     */ game.initiativePlayerNum === playerNum ? 1 : 0,
    /* 34 vpUrgency         */ 1 - Math.min(myVP, 40) / 40,
    /* 35 oppVpUrgency      */ 1 - Math.min(oppVP, 40) / 40,
    // Phase 2: active-DC context (indices 36-45)
    ...getActiveDcFeatures(game, playerNum, dcHealthState, dcMessageMeta),
    // Phase 5: positional-awareness (indices 46-48)
    ...getPositionalAwarenessFeatures(game, playerNum),
    // Phase 6: dc_special visibility (index 49)
    /* 49 activeDcHasSpecial */ getActiveDcHasSpecial(game, playerNum, dcMessageMeta),
  ];
}

// ── Network Initialization ──────────────────────────────────────────────────

/** Initialize dueling network with He/Xavier init. */
export function initializeNetwork() {
  // W1: [HIDDEN_SIZE][NUM_FEATURES] — He init
  const heStd = Math.sqrt(2 / NUM_FEATURES);
  const W1 = [];
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    const row = [];
    for (let i = 0; i < NUM_FEATURES; i++) {
      row.push(randn() * heStd);
    }
    W1.push(row);
  }
  const b1 = new Array(HIDDEN_SIZE).fill(0);

  // Wv: [HIDDEN_SIZE] — Xavier init
  const xavierV = Math.sqrt(2 / (HIDDEN_SIZE + 1));
  const Wv = [];
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    Wv.push(randn() * xavierV);
  }
  const bv = 0;

  // Wa: [NUM_ACTIONS][HIDDEN_SIZE] — Xavier init
  const xavierA = Math.sqrt(2 / (HIDDEN_SIZE + NUM_ACTIONS));
  const Wa = [];
  for (let k = 0; k < NUM_ACTIONS; k++) {
    const row = [];
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      row.push(randn() * xavierA);
    }
    Wa.push(row);
  }
  const ba = new Array(NUM_ACTIONS).fill(0);

  return { W1, b1, Wv, bv, Wa, ba };
}

/** Deep-copy all 6 parameter arrays of a network. */
function deepCopyNetwork(network) {
  return {
    W1: network.W1.map(row => [...row]),
    b1: [...network.b1],
    Wv: [...network.Wv],
    bv: network.bv,
    Wa: network.Wa.map(row => [...row]),
    ba: [...network.ba],
  };
}

// ── Forward Pass ────────────────────────────────────────────────────────────

/**
 * Dueling forward pass.
 * Returns { Q: [NUM_ACTIONS], V, A: [NUM_ACTIONS], h_pre: [HIDDEN_SIZE], h: [HIDDEN_SIZE] }
 */
function forwardPass(network, features) {
  const { W1, b1, Wv, bv, Wa, ba } = network;

  // Shared hidden layer: h_pre = W1 * features + b1, h = ReLU(h_pre)
  const h_pre = new Array(HIDDEN_SIZE);
  const h = new Array(HIDDEN_SIZE);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let sum = b1[j];
    for (let i = 0; i < NUM_FEATURES; i++) {
      sum += W1[j][i] * (features[i] || 0);
    }
    h_pre[j] = sum;
    h[j] = sum > 0 ? sum : 0; // ReLU
  }

  // Value head: V = Wv · h + bv
  let V = bv;
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    V += Wv[j] * h[j];
  }

  // Advantage head: A[k] = Wa[k] · h + ba[k]
  const nActions = Wa.length; // Use actual network size
  const A = new Array(nActions);
  let meanA = 0;
  for (let k = 0; k < nActions; k++) {
    let sum = ba[k];
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      sum += Wa[k][j] * h[j];
    }
    A[k] = sum;
    meanA += sum;
  }
  meanA /= nActions;

  // Combine: Q[k] = V + A[k] - mean(A)
  const Q = new Array(nActions);
  for (let k = 0; k < nActions; k++) {
    Q[k] = V + A[k] - meanA;
  }

  return { Q, V, A, h_pre, h };
}

// ── NaN Safety ──────────────────────────────────────────────────────────────

function sanitizeParam(value) {
  return isFinite(value) ? value : 0;
}

function sanitizeNetwork(network, stats) {
  let resets = 0;
  const nHidden = network.b1.length;
  const nActions = network.Wa.length;

  for (let j = 0; j < nHidden; j++) {
    for (let i = 0; i < network.W1[j].length; i++) {
      if (!isFinite(network.W1[j][i])) { network.W1[j][i] = 0; resets++; }
    }
    if (!isFinite(network.b1[j])) { network.b1[j] = 0; resets++; }
    if (!isFinite(network.Wv[j])) { network.Wv[j] = 0; resets++; }
  }
  if (!isFinite(network.bv)) { network.bv = 0; resets++; }

  for (let k = 0; k < nActions; k++) {
    for (let j = 0; j < network.Wa[k].length; j++) {
      if (!isFinite(network.Wa[k][j])) { network.Wa[k][j] = 0; resets++; }
    }
    if (!isFinite(network.ba[k])) { network.ba[k] = 0; resets++; }
  }

  if (resets > 0 && stats) {
    stats.nanResets = (stats.nanResets || 0) + resets;
  }
  return resets;
}

// ── Backpropagation ─────────────────────────────────────────────────────────

/**
 * Manual backprop through dueling architecture with SGD + L2 weight decay.
 * Weight decay gently pulls weights toward zero (prevents explosion without hard caps).
 * Emergency clamp at ±50 as a safety net that should never trigger with decay active.
 */
function backpropUpdate(network, actionIdx, delta, alpha, h_pre, h, features) {
  const { W1, b1, Wv, Wa, ba } = network;
  const nActions = Wa.length; // Use actual network size, not constant
  const dAChosen = delta * ((nActions - 1) / nActions);
  const dAOther = delta * (-1 / nActions);
  const decay = 1 - WEIGHT_DECAY;
  const clamp = WEIGHT_CLAMP_EMERGENCY;

  // Advantage head gradients + decay
  for (let m = 0; m < nActions; m++) {
    const dA = (m === actionIdx) ? dAChosen : dAOther;
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      Wa[m][j] = Math.max(-clamp, Math.min(clamp, Wa[m][j] * decay + alpha * dA * h[j]));
    }
    ba[m] = Math.max(-BIAS_CLAMP, Math.min(BIAS_CLAMP, ba[m] + alpha * dA));
  }

  // Value head gradients + decay
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    Wv[j] = Math.max(-clamp, Math.min(clamp, Wv[j] * decay + alpha * delta * h[j]));
  }
  network.bv = Math.max(-BIAS_CLAMP, Math.min(BIAS_CLAMP, network.bv + alpha * delta));

  // Hidden layer gradients (sum V + A head contributions, gate through ReLU)
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let grad_h = delta * Wv[j];
    for (let m = 0; m < nActions; m++) {
      const dA = (m === actionIdx) ? dAChosen : dAOther;
      grad_h += dA * Wa[m][j];
    }
    const grad_pre = h_pre[j] > 0 ? grad_h : 0; // ReLU gate

    // Input layer gradients + decay
    for (let i = 0; i < NUM_FEATURES; i++) {
      W1[j][i] = Math.max(-clamp, Math.min(clamp, W1[j][i] * decay + alpha * grad_pre * (features[i] || 0)));
    }
    b1[j] = Math.max(-BIAS_CLAMP, Math.min(BIAS_CLAMP, b1[j] + alpha * grad_pre));
  }
}

// ── Masked Q ────────────────────────────────────────────────────────────────

/**
 * Compute max Q over only legal action indices.
 * Returns 0 for terminal states (null/empty nextActionIdxs).
 */
function getMaskedBestQ(network, features, nextActionIdxs) {
  if (!nextActionIdxs || nextActionIdxs.length === 0) return 0;
  const { Q } = forwardPass(network, features);
  let maxQ = -Infinity;
  for (const idx of nextActionIdxs) {
    if (idx >= 0 && idx < Q.length && Q[idx] > maxQ) {
      maxQ = Q[idx];
    }
  }
  return maxQ === -Infinity ? 0 : maxQ;
}

// ── Training Update (Neural) ────────────────────────────────────────────────

function updateTraceNeural(learnings, trace) {
  if (!learnings.network) learnings.network = initializeNetwork();
  if (!learnings.targetNetwork) learnings.targetNetwork = deepCopyNetwork(learnings.network);
  if (!learnings.trainingStats) {
    learnings.trainingStats = {
      totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES,
      hiddenSize: HIDDEN_SIZE, lastTargetSync: 0, targetSyncs: 0,
      nanResets: 0, tdErrorHistory: [],
    };
  }

  const useGraph = ENCODER_TYPE === 'graph' && learnings.graphNetwork;
  const network = useGraph ? null : learnings.network;
  const targetNetwork = useGraph ? learnings.graphTargetNetwork : learnings.targetNetwork;
  const gNet = useGraph ? learnings.graphNetwork : null;
  const stats = learnings.trainingStats;
  const effectiveAlpha = getEffectiveAlpha(learnings.meta?.totalGames);
  let deltaSum = 0;
  let count = 0;
  let boundaryTruncations = 0;
  let nStepLengthSum = 0;

  // Build valid-entry index (skip entries without features)
  const validIdxs = [];
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].features) validIdxs.push(i);
  }

  // ── Pre-pass: compute same-figure chain length for each valid entry ────────
  // Groups consecutive valid entries by activeDcMsgId. Chain length = number of
  // entries sharing the same figure identity in an unbroken run.
  const chainLenByVi = new Int16Array(validIdxs.length);
  {
    let chainStart = 0;
    for (let vi = 1; vi <= validIdxs.length; vi++) {
      const prevMsgId = trace[validIdxs[vi - 1]].activeDcMsgId;
      const curMsgId = vi < validIdxs.length ? trace[validIdxs[vi]].activeDcMsgId : null;
      if (curMsgId !== prevMsgId) {
        const len = vi - chainStart;
        for (let j = chainStart; j < vi; j++) chainLenByVi[j] = len;
        chainStart = vi;
      }
    }
  }

  // Per-chain-type instrumentation counters
  let glueEntryCount = 0, realEntryCount = 0;
  let glueBoundaryTrunc = 0, realBoundaryTrunc = 0;
  let glueNStepSum = 0, realNStepSum = 0;
  let glueRewardSum = 0, realRewardSum = 0;
  const chainHist = [0, 0, 0, 0, 0, 0]; // [1, 2, 3-5, 6-10, 11-20, 21+]

  // Forward sweep: compute n-step returns for each valid entry.
  // For entry at position p in validIdxs:
  //   G_n = r_p + γ*r_{p+1} + ... + γ^(n-1)*r_{p+n-1} + γ^n * maxQ(s_{p+n})
  // If a terminal (done) is hit within n steps, truncate there.
  for (let vi = 0; vi < validIdxs.length; vi++) {
    const i = validIdxs[vi];
    const entry = trace[i];
    const { features, actionIdx } = entry;

    // Forward pass on online network
    let Q, h_pre, h, graphCache;
    if (useGraph) {
      const result = graphForwardPass(gNet, features); // features is a graph object in graph mode
      Q = result.Q;
      graphCache = result.cache;
    } else {
      const result = forwardPass(network, features);
      Q = result.Q;
      h_pre = result.h_pre;
      h = result.h;
    }

    // Compute n-step return with figure-boundary awareness
    let nStepReturn = 0;
    let gammaK = 1.0;
    let bootstrapFeatures = null;
    let bootstrapActionIdxs = null;
    let hitTerminal = false;
    let hitBoundary = false;
    let effectiveSteps = 0;
    const stepsToUse = Math.min(N_STEP, validIdxs.length - vi);

    for (let k = 0; k < stepsToUse; k++) {
      const futureEntry = trace[validIdxs[vi + k]];
      // ── Figure-boundary truncation ────────────────────────────────
      // Treat as pseudo-terminal: accumulate same-figure rewards only,
      // then STOP with no bootstrap. prevEntry.nextFeatures is unsafe
      // because end_activation dispatch deletes dcActionsData before
      // afterAction captures nextFeatures — graph active-figure readout
      // would be null/wrong.
      if (BOUNDARY_FIX_ENABLED && k > 0 && futureEntry.activeDcMsgId !== entry.activeDcMsgId) {
        hitBoundary = true;
        boundaryTruncations++;
        break;
      }
      nStepReturn += gammaK * futureEntry.reward;
      gammaK *= GAMMA;
      effectiveSteps++;
      if (futureEntry.done) {
        hitTerminal = true;
        break;
      }
      // The bootstrap state is the nextFeatures of the last step we accumulated
      if (k === stepsToUse - 1) {
        bootstrapFeatures = futureEntry.nextFeatures;
        bootstrapActionIdxs = futureEntry.nextActionIdxs;
      }
    }
    nStepLengthSum += effectiveSteps;

    // ── Per-chain-type tracking ──────────────────────────────────────
    const chainLen = chainLenByVi[vi] || 1;
    const isGlue = chainLen <= 2;
    if (isGlue) {
      glueEntryCount++;
      glueNStepSum += effectiveSteps;
      glueRewardSum += Math.abs(entry.reward);
      if (hitBoundary) glueBoundaryTrunc++;
    } else {
      realEntryCount++;
      realNStepSum += effectiveSteps;
      realRewardSum += Math.abs(entry.reward);
      if (hitBoundary) realBoundaryTrunc++;
    }
    const bucket = chainLen <= 1 ? 0 : chainLen <= 2 ? 1 : chainLen <= 5 ? 2
                 : chainLen <= 10 ? 3 : chainLen <= 20 ? 4 : 5;
    chainHist[bucket]++;

    let target;
    if (hitTerminal || hitBoundary || !bootstrapFeatures) {
      target = nStepReturn;
    } else {
      const maxQNext = useGraph
        ? getGraphMaskedBestQ(targetNetwork, bootstrapFeatures, bootstrapActionIdxs)
        : getMaskedBestQ(targetNetwork, bootstrapFeatures, bootstrapActionIdxs);
      target = nStepReturn + gammaK * maxQNext;
    }

    // Clip TD error
    const rawDelta = target - Q[actionIdx];
    const delta = Math.max(-DELTA_CLAMP, Math.min(DELTA_CLAMP, rawDelta));

    // Backprop update (scheduled LR)
    if (useGraph) {
      graphBackpropUpdate(gNet, graphCache, actionIdx, delta, effectiveAlpha, WEIGHT_DECAY);
      sanitizeGraphNetwork(gNet, stats);
    } else {
      backpropUpdate(network, actionIdx, delta, effectiveAlpha, h_pre, h, features);
      sanitizeNetwork(network, stats);
    }

    // Within-group scorer update (Phase 5) — now with per-scorer L2 decay
    // Skip entirely in frozen-eval mode so diagnostic runs don't drift WG weights.
    if (!WG_FROZEN && entry.wgFeatures && entry.wgType && learnings.withinGroupWeights) {
      // Audit: count WG entries by type
      if (entry.wgType === 'attack') _wgAudit.attackEntries++;
      else if (entry.wgType === 'move') _wgAudit.moveEntries++;
      else if (entry.wgType === 'surge') _wgAudit.surgeEntries++;
      else if (entry.wgType === 'activate') _wgAudit.activateEntries++;

      const wgW = learnings.withinGroupWeights[entry.wgType];
      if (wgW) {
        const wgDecay = getWgDecay(entry.wgType);
        if (entry.wgType === 'move' && entry.moveContrastive) {
          // ── Contrastive move scorer update ──────────────────────────────
          _wgAudit.moveUpdates++;
          const mc = entry.moveContrastive;
          const chosenQ = mc.chosenQuality;
          // L2 decay: apply once per update (matches attack/surge/CC scorers)
          for (let fi = 0; fi < wgW.length; fi++) {
            wgW[fi] *= (1 - wgDecay);
          }
          for (const alt of mc.alternatives) {
            const altQ = alt.qualityScore;
            if (Math.abs(chosenQ - altQ) < 0.01) continue;
            const advantage = chosenQ - altQ;
            const clampedAdv = Math.max(-1, Math.min(1, advantage));
            for (let fi = 0; fi < wgW.length; fi++) {
              const featDiff = (mc.chosen[fi] || 0) - (alt.features[fi] || 0);
              const lr = fi === MOVE_FEATURE_LR_BOOST_IDX ? ALPHA_WG_MOVE * MOVE_FEATURE_LR_BOOST : ALPHA_WG_MOVE;
              wgW[fi] += lr * clampedAdv * featDiff;
              wgW[fi] = Math.max(-WG_WEIGHT_CLAMP, Math.min(WG_WEIGHT_CLAMP, wgW[fi]));
              if (!isFinite(wgW[fi])) wgW[fi] = 0;
            }
          }
        } else {
          // Standard TD-delta-based WG update (attack, surge, CC)
          if (entry.wgType === 'attack') _wgAudit.attackUpdates++;
          else if (entry.wgType === 'surge') _wgAudit.surgeUpdates++;
          else if (entry.wgType === 'activate') _wgAudit.activateUpdates++;
          const alpha = entry.wgType === 'surge' ? ALPHA_WG_SURGE : ALPHA_WG;
          for (let fi = 0; fi < wgW.length; fi++) {
            wgW[fi] *= (1 - wgDecay); // L2 decay before gradient step
            wgW[fi] += alpha * delta * (entry.wgFeatures[fi] || 0);
            wgW[fi] = Math.max(-WG_WEIGHT_CLAMP, Math.min(WG_WEIGHT_CLAMP, wgW[fi]));
            if (!isFinite(wgW[fi])) wgW[fi] = 0;
          }
        }
      }
    }

    deltaSum += Math.abs(rawDelta);
    count++;
    stats.totalUpdates++;

    // TD error history (sample every 100 updates)
    if (stats.totalUpdates % 100 === 0) {
      const meanAbsTD = count > 0 ? deltaSum / count : 0;
      if (!stats.tdErrorHistory) stats.tdErrorHistory = [];
      stats.tdErrorHistory.push({ updates: stats.totalUpdates, meanAbsTD });
      if (stats.tdErrorHistory.length > 500) stats.tdErrorHistory.shift();
    }

    // Target network sync
    if (stats.totalUpdates > 0 && stats.totalUpdates % TARGET_UPDATE_INTERVAL === 0) {
      if (useGraph) {
        learnings.graphTargetNetwork = deepCopyGraphNetwork(gNet);
      } else {
        learnings.targetNetwork = deepCopyNetwork(network);
      }
      stats.lastTargetSync = stats.totalUpdates;
      stats.targetSyncs = (stats.targetSyncs || 0) + 1;
    }

    // Store n-step transition in replay buffer
    // Uses the n-step return and the n-step-ahead state for bootstrap
    if (learnings.replayBuffer) {
      const buf = learnings.replayBuffer;
      const transition = {
        features: useGraph ? deepCopyGraph(features) : features.slice(),
        actionIdx,
        reward: nStepReturn,    // n-step cumulative reward (not single-step)
        nextFeatures: bootstrapFeatures
          ? (useGraph ? deepCopyGraph(bootstrapFeatures) : bootstrapFeatures.slice())
          : null,
        nextActionIdxs: bootstrapActionIdxs ? bootstrapActionIdxs.slice() : null,
        done: hitTerminal,
        nStepGamma: gammaK,     // γ^n for this transition's bootstrap discount
      };
      if (buf.transitions.length < REPLAY_BUFFER_SIZE) {
        buf.transitions.push(transition);
      } else {
        buf.transitions[buf.writeIdx] = transition;
      }
      buf.writeIdx = (buf.writeIdx + 1) % REPLAY_BUFFER_SIZE;
      buf.count++;
    }
  }

  if (count > 0) {
    const prevAvg = stats.avgAbsDelta || 0;
    stats.avgAbsDelta = prevAvg * 0.95 + (deltaSum / count) * 0.05;
  }
  // ── Boundary truncation diagnostics ──────────────────────────────
  stats.boundaryTruncations = (stats.boundaryTruncations || 0) + boundaryTruncations;
  stats.lastBoundaryTruncRate = count > 0 ? +(boundaryTruncations / count).toFixed(4) : 0;
  stats.lastEffectiveNStep = count > 0 ? +(nStepLengthSum / count).toFixed(2) : 0;

  // ── Per-chain-type diagnostics (glue ≤2 vs real >2) ───────────────
  stats.lastGlueEntryCount = glueEntryCount;
  stats.lastRealEntryCount = realEntryCount;
  stats.lastGlueBoundaryTruncRate = glueEntryCount > 0 ? +(glueBoundaryTrunc / glueEntryCount).toFixed(4) : 0;
  stats.lastRealBoundaryTruncRate = realEntryCount > 0 ? +(realBoundaryTrunc / realEntryCount).toFixed(4) : 0;
  stats.lastGlueEffectiveNStep = glueEntryCount > 0 ? +(glueNStepSum / glueEntryCount).toFixed(2) : 0;
  stats.lastRealEffectiveNStep = realEntryCount > 0 ? +(realNStepSum / realEntryCount).toFixed(2) : 0;
  stats.lastAvgGlueReward = glueEntryCount > 0 ? +(glueRewardSum / glueEntryCount).toFixed(4) : 0;
  stats.lastAvgRealReward = realEntryCount > 0 ? +(realRewardSum / realEntryCount).toFixed(4) : 0;
  stats.lastChainLengthHist = {
    '1': chainHist[0], '2': chainHist[1], '3-5': chainHist[2],
    '6-10': chainHist[3], '11-20': chainHist[4], '21+': chainHist[5],
  };
}

// ── Experience Replay ────────────────────────────────────────────────────

export function replayUpdate(learnings) {
  const buf = learnings.replayBuffer;
  if (!buf || buf.transitions.length < REPLAY_MIN_SIZE) return;

  const useGraph = ENCODER_TYPE === 'graph' && learnings.graphNetwork;
  const network = useGraph ? null : learnings.network;
  const targetNetwork = useGraph ? learnings.graphTargetNetwork : learnings.targetNetwork;
  const gNet = useGraph ? learnings.graphNetwork : null;
  const stats = learnings.trainingStats;
  if (!useGraph && (!network || !targetNetwork)) return;
  if (useGraph && (!gNet || !targetNetwork)) return;

  const bufLen = buf.transitions.length;
  const replayAlpha = getEffectiveAlpha(learnings.meta?.totalGames) * 0.5; // Half of scheduled online alpha

  for (let batch = 0; batch < REPLAY_UPDATES_PER_GAME; batch++) {
    let deltaSum = 0;
    for (let b = 0; b < REPLAY_BATCH_SIZE; b++) {
      const idx = Math.floor(Math.random() * bufLen);
      const t = buf.transitions[idx];
      if (!t || !t.features) continue;

      const { features, actionIdx, reward, nextFeatures, nextActionIdxs, done } = t;
      let Q, h_pre, h, graphCache;
      if (useGraph) {
        const result = graphForwardPass(gNet, features);
        Q = result.Q;
        graphCache = result.cache;
      } else {
        const result = forwardPass(network, features);
        Q = result.Q; h_pre = result.h_pre; h = result.h;
      }

      // Use stored n-step gamma if available (new transitions), fall back to GAMMA (legacy 1-step)
      const bootstrapGamma = t.nStepGamma ?? GAMMA;
      let target;
      if (done || !nextFeatures) {
        target = reward;
      } else {
        const maxQNext = useGraph
          ? getGraphMaskedBestQ(targetNetwork, nextFeatures, nextActionIdxs)
          : getMaskedBestQ(targetNetwork, nextFeatures, nextActionIdxs);
        target = reward + bootstrapGamma * maxQNext;
      }

      const rawDelta = target - Q[actionIdx];
      const delta = Math.max(-DELTA_CLAMP, Math.min(DELTA_CLAMP, rawDelta));
      if (useGraph) {
        graphBackpropUpdate(gNet, graphCache, actionIdx, delta, replayAlpha, WEIGHT_DECAY);
        sanitizeGraphNetwork(gNet, stats);
      } else {
        backpropUpdate(network, actionIdx, delta, replayAlpha, h_pre, h, features);
        sanitizeNetwork(network, stats);
      }

      deltaSum += Math.abs(rawDelta);
      stats.totalUpdates++;

      if (stats.totalUpdates > 0 && stats.totalUpdates % TARGET_UPDATE_INTERVAL === 0) {
        if (useGraph) {
          learnings.graphTargetNetwork = deepCopyGraphNetwork(gNet);
        } else {
          learnings.targetNetwork = deepCopyNetwork(network);
        }
        stats.lastTargetSync = stats.totalUpdates;
        stats.targetSyncs = (stats.targetSyncs || 0) + 1;
      }
    }
    const batchAvg = deltaSum / REPLAY_BATCH_SIZE;
    stats.avgAbsDelta = (stats.avgAbsDelta || 0) * 0.95 + batchAvg * 0.05;
  }
}

// ── Action Abstraction ──────────────────────────────────────────────────────

/**
 * Classify a surge key as damage-increasing or utility/special.
 * Damage: +damage, pierce, blast, cleave, and named damage specials.
 * Special: accuracy, recover, conditions, tokens, and everything else.
 */
function classifySurge(surgeKey) {
  if (!surgeKey) return 'spend_surge'; // fallback for missing key
  const k = String(surgeKey).replace(/^double:/, '').replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
  // Direct damage effects
  if (/^damage\s+\d+$/.test(k) || /^\+\d+\s+hits?$/.test(k)) return 'surge_damage';
  if (/^pierce\s+\d+$/.test(k)) return 'surge_damage';
  if (/^blast\s+\d+$/.test(k)) return 'surge_damage';
  if (/^cleave\s+\d+$/.test(k)) return 'surge_damage';
  if (k === 'critical_hit' || k === 'deadly_spin' || k === 'shrapnel' || k === 'deadly') return 'surge_damage';
  // Multi-part combos containing damage/pierce/blast/cleave
  if (/damage|pierce|blast|cleave/.test(k)) return 'surge_damage';
  // Everything else: accuracy, recover, conditions, tokens, specials
  return 'surge_special';
}

export function abstractActionType(action, game) {
  const t = action.type;
  // Mandatory flow actions
  if (t === 'phase_gate_ready' || t === 'end_start_of_round' ||
      t === 'end_end_of_round' || t === 'end_activation_phase') return 'gate';
  if (t === 'combat_ready' || t === 'combat_roll') return 'combat_flow';
  // Strategic combat actions
  if (t === 'combat_resolve' || t === 'combat_skip_surges') return 'skip_surges';
  if (t?.startsWith('combat_reroll')) return 'reroll';
  if (t?.startsWith('combat_surge')) return classifySurge(action.params?.surgeKey);
  // DC specials
  if (t === 'dc_special') return 'ability';
  // CC play (dedicated type — hand management decision)
  if (t === 'play_cc' || t === 'play_cc_special' || t === 'play_cc_double') return 'play_cc';
  // Attacks
  if (t === 'attack_target') {
    if (action.params?.targetFigureKey && game) {
      const oppNum = action.actingPlayer === 1 ? 2 : 1;
      const tPos = game.figurePositions?.[oppNum]?.[action.params.targetFigureKey];
      const myFigs = game.figurePositions?.[action.actingPlayer] || {};
      if (tPos) {
        let minD = Infinity;
        for (const pos of Object.values(myFigs)) {
          const d = coordDistance(pos, tPos);
          if (d < minD) minD = d;
        }
        return minD <= 2 ? 'attack_close' : 'attack_ranged';
      }
    }
    return 'attack_close';
  }
  // Movement
  if (t === 'move_pick_space') {
    if (action.params?.done) return 'move_done';
    if (action.params?.coord && game) {
      const pn = action.actingPlayer;
      const oppNum = pn === 1 ? 2 : 1;
      const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
      if (oppFigs.length > 0) {
        const moveKey = action.params.moveKey;
        const moveState = game.moveInProgress?.[moveKey];
        const curPos = moveState?.currentPosition || moveState?.startCoord;
        if (curPos) {
          const curDist = Math.min(...oppFigs.map(p => coordDistance(curPos, p)));
          const newDist = Math.min(...oppFigs.map(p => coordDistance(action.params.coord, p)));
          if (newDist < curDist) return 'move_toward';
          if (newDist > curDist) return 'move_away';
          return 'move_lateral';
        }
      }
    }
    return 'move_toward';
  }
  if (t === 'move_figure') return 'start_move';
  // Activation
  if (t === 'activate_dc') return 'activate';
  if (t === 'dc_end_activation') return 'end_activation';
  if (t === 'pass_activation_turn') return 'pass';
  // Interact (mission objectives, terminals, doors)
  if (t === 'interact') return 'interact';
  // Reactive counterplay — use vs skip (learned binary decision)
  if (t === 'negation_play' || t === 'celebration_play' || t === 'cover_fire_block') return 'react_use';
  if (t === 'negation_let_resolve' || t === 'celebration_pass' || t === 'cover_fire_skip') return 'react_skip';
  // Strain choice — discard CCs (react_use) vs take all damage (react_skip)
  if (t === 'strain_choice_discard') return 'react_use';
  if (t === 'strain_choice_alldmg') return 'react_skip';
  // Interrupt use/skip decisions (reuse react_use/react_skip from A2)
  if (t === 'still_faster_use' || t === 'hunter_protocol_trigger' || t === 'last_resort_use' || t === 'executor_use') return 'react_use';
  if (t === 'still_faster_skip' || t === 'hunter_protocol_skip' || t === 'last_resort_skip' || t === 'executor_skip') return 'react_skip';
  if (t === 'still_faster_dc_pick') return 'ability';
  // Combat-reaction defensive abilities — use vs skip (learned binary decision)
  if (t === 'strike_me_down_yes' || t === 'slow_on_draw_yes' || t === 'force_exhaustion_yes' ||
      t === 'tough_luck_remove' || t === 'power_converter_approve' ||
      t === 'illicit_arms_pick' || t === 'there_is_no_try_die') return 'react_use';
  if (t === 'strike_me_down_no' || t === 'slow_on_draw_no' || t === 'force_exhaustion_no' ||
      t === 'tough_luck_skip' || t === 'power_converter_skip' ||
      t === 'illicit_arms_skip' || t === 'there_is_no_try_skip') return 'react_skip';
  // Multi-step sub-actions for defensive abilities (stay in ability bucket)
  if (t === 'there_is_no_try_face' || t === 'illicit_arms_use' ||
      t === 'power_converter_die' || t === 'power_converter_color') return 'ability';
  // Power token choice — offensive vs defensive (learned)
  if (t === 'power_token_choice') {
    const tt = action.params?.tokenType;
    return (tt === 'hit' || tt === 'surge') ? 'token_offense' : 'token_defense';
  }
  // Force Vision pick (Kanan Jarrus) — choosing which group activates next
  if (t === 'force_vision_pick') return 'ability';
  // Remaining pending sub-state actions (DC-specific, stay in ability bucket)
  if (t === 'dc_ability_choice' || t === 'pounce_space' ||
      t === 'missile_salvo_die' || t === 'missile_salvo_done' ||
      t === 'spread_pain_cond') return 'ability';
  // Fallback
  return 'other';
}

// ── Surge Shaping Reward ────────────────────────────────────────────────────
// Spending surges modifies pendingCombat but doesn't change HP/VP until
// combat_resolve. Without shaping, surge-spend actions get reward ≈ step cost
// (-0.02), making skip_surges artificially attractive. This gives proportional
// immediate credit so the model learns that surges have tactical value.

// Surge shaping rewards — must exceed (1-γ)*V(s) step cost to beat skip.
// At γ=0.95, step cost = 0.05*V(s). Even at V(s)=20, step cost = 1.0.
// V-scaling created a feedback loop (higher reward → higher V → higher step cost).
// Instead: use large fixed constants that dominate step cost at any realistic V(s).
// V(s) is bounded by ±50 terminal / ~50 steps → max ~14.  Step cost max ~0.70.
// Constants at 1.5 per point give 6x–12x headroom over worst-case step cost.
const SURGE_SHAPE_OFFENSE = 1.50;  // Per point of damage/pierce/blast/cleave
const SURGE_SHAPE_ACCURACY = 1.50; // Flat bonus for accuracy surges
const SURGE_SHAPE_RECOVER = 1.00;  // Per point of recover
const SURGE_SHAPE_UTILITY = 1.00;  // Flat bonus for conditions/tokens/specials

// Skip penalty when beneficial surge was available.
// Fixed constant — large enough to make skip always worse than spending.
// At 1.5, skip penalty is 6x worst-case step cost of 0.25.
const SURGE_SKIP_PENALTY = 1.50;

// CC shaping reward — playing a CC has no immediate HP/VP delta, so the model
// never learns to prefer it over pass/activate. Same structural problem as
// pre-fix surges. Flat bonus per CC play gives immediate credit.
// CONSTRAINT: Combat Resupply (0-cost, always available) can be spammed
// infinitely. Even a small per-play bonus causes V(s) explosion when the model
// discovers this exploit (0.25 × 600 plays/game = +150 vs ±50 terminal).
// Fix: cap reward to first CC_REWARD_CAP plays per game. 5 plays = ~1 per round
// in a 5-round game. Total injection bounded at 5 × 0.25 = 1.25 (2.5% of terminal).
const CC_SHAPE_REWARD = 0.25;
const CC_REWARD_CAP = 5;

// ── DC Special (ability) Reward Shaping ──────────────────────────────────────
// Problem: dc_special maps to abstract type 'ability' but has no dedicated reward
// signal. Discord shadow eval (runs 75-76) showed 0% organic pick rate across
// 178 decisions where dc_special was available. The DQN cannot distinguish
// "use ability" from "end activation" because both produce the same +0.15 bonus.
// Fix: flat bonus per dc_special use, capped per game (same pattern as CC shaping).
const DC_SPECIAL_REWARD = 1.0;
const DC_SPECIAL_CAP = 8;  // ~1-2 per DC per game for a 4-DC army

// ── Attack-Specific Reward Shaping ───────────────────────────────────────────
// Problem: movement gets 3 dedicated shaping terms (closing, engage, decision)
// totaling up to ~1.35/action, while attacks get only the shared 0.15
// activationAction bonus plus noisy dmg:0.5×damage (zero on a miss).
// Greedy argmax therefore always prefers move over attack.
// Fix: flat bonus per attack action, regardless of hit/miss outcome.
const ATTACK_SHAPE_REWARD = 0.50;  // matches MOVE_ENGAGE_BONUS magnitude

// ── Movement-Specific Reward Shaping ─────────────────────────────────────────
// Problem: movement payoff is delayed (positioning → future attack), but TD
// updates only see the immediate near-zero reward. The global dist:0.4 in
// computeReward uses army-average distance, which dilutes single-figure moves.
//
// Fix: reward the ACTIVE FIGURE's positioning improvement on move actions.
// Three targeted terms:
//   1. MOVE_CLOSING_REWARD — per-space closing toward nearest enemy (only when
//      the active figure was out of attack range before the move).
//   2. MOVE_ENGAGE_BONUS — one-time bonus for transitioning from "no targets in
//      range" to "targets in range" (the whole point of moving).
//   3. Cap per-activation to prevent pacing exploit (walk back/forth).
const MOVE_CLOSING_REWARD = 0.075;  // halved (was 0.15) — reduce proxy dominance over VP signal
const MOVE_ENGAGE_BONUS = 0.25;    // halved (was 0.50) — reduce proxy dominance over VP signal
const MOVE_REWARD_CAP_PER_ACT = 1.5; // max movement shaping per activation

// ── start_move decision bonus (permanent, Phase 4 validated) ───────────────
// The graph encoder suppresses Q(start_move) relative to Q(end_activation)
// by ~0.45 due to bootstrap values, overriding the +0.15 activation bonus.
// This bonus directly rewards the TYPE-LEVEL decision to begin movement when
// the active figure has no targets in attack range (i.e., movement is the
// only way to reach combat). Validated in Phase 4 A/B: flipped Q-gap from
// -0.37 to +0.04, increased movement 75-109%, no quality/stability harm.
// Override via --move-decision-bonus= CLI arg (0 to disable for experiments).
let MOVE_DECISION_BONUS = 0.15;  // halved (was 0.30) — reduce proxy dominance over VP signal
/** Override move-decision bonus for controlled experiments. */
export function setMoveDecisionBonus(v) { MOVE_DECISION_BONUS = v; }

function surgeShapingReward(action) {
  if (!action?.type?.startsWith('combat_surge')) return 0;
  const surgeKey = action.params?.surgeKey;
  if (!surgeKey) return 0;
  const parsed = parseSurgeEffect(surgeKey);
  let bonus = 0;
  // Offensive value: damage, pierce, blast, cleave
  const offenseTotal = (parsed.damage || 0) + (parsed.pierce || 0)
    + (parsed.blast || 0) + (parsed.cleave || 0);
  bonus += SURGE_SHAPE_OFFENSE * offenseTotal;
  // Accuracy
  if ((parsed.accuracy || 0) > 0) bonus += SURGE_SHAPE_ACCURACY;
  // Recovery
  bonus += SURGE_SHAPE_RECOVER * (parsed.recover || 0);
  // Utility: conditions, tokens, specials (any named flag)
  if ((parsed.conditions?.length > 0) || parsed.surgeSelfFocus || parsed.surgeSelfHide
    || parsed.surgeGrantHitToken || parsed.surgeGrantBlockToken || parsed.surgeGrantPowerToken
    || parsed.surgeGrantEvade || parsed.surgeGrantExtraSurge || parsed.surgeStalkPrey
    || parsed.surgeSquadCommand || parsed.surgeCancelDodge || parsed.surgeSpreadThePain
    || parsed.surgeFellSwoop || parsed.surgeMastery || parsed.surgeInterrogate
    || parsed.surgeHarass || parsed.surgeSuppressionStrain || parsed.surgeConcussiveBolt
    || parsed.surgeAgitate || parsed.surgeFightingKnife || parsed.surgeBargain) {
    bonus += SURGE_SHAPE_UTILITY;
  }
  return bonus;
}

// ── Snapshots & Rewards ─────────────────────────────────────────────────────

export function captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);

  // Active-figure positioning for movement shaping
  let activeFigDist = null;   // distance from active figure to nearest enemy
  let activeFigHasTargets = false; // can the active figure attack anyone right now?
  const active = findActiveDcMsgId(game, playerNum, dcMessageMeta);
  if (active) {
    const { msgId, meta } = active;
    const dcName = active.dcName;
    let dcEffects; try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
    const eff = dcEffects?.[dcName];
    // Derive effective attack range from attack type (matches available-actions.js logic).
    // getDcEffects has attack.type ("melee"/"range") but no numeric range field.
    // Ranged figures can attack any target in LOS (accuracy checked at roll time) → use 20.
    // Melee figures attack adjacent → use 1.
    const isRanged = eff?.attack?.type === 'range';
    const range = isRanged ? 20 : 1;
    const actionsData = game.dcActionsData?.[msgId];
    const figureIndex = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const figureKey = `${dcName}-${dgIndex}-${figureIndex}`;
    let pos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!pos && game.moveInProgress) {
      for (const ms of Object.values(game.moveInProgress)) {
        if (ms?.currentPosition) { pos = ms.currentPosition; break; }
      }
    }
    if (pos) {
      const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
      let minD = Infinity;
      for (const oPos of oppFigs) {
        const d = coordDistance(pos, oPos);
        if (d < minD) minD = d;
      }
      activeFigDist = isFinite(minD) ? minD : null;
      if (oppFigs.length > 0) {
        for (const oPos of oppFigs) {
          if (coordDistance(pos, oPos) <= range) { activeFigHasTargets = true; break; }
        }
      }
    }
  }

  return {
    myVP: (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0,
    oppVP: (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0,
    myHpCurrent: myHp.current,
    myHpMax: myHp.max,
    oppHpCurrent: oppHp.current,
    oppHpMax: oppHp.max,
    avgDist: getAvgDistToEnemy(game, playerNum),
    myFigs: Object.keys(game.figurePositions?.[playerNum] || {}).length,
    oppFigs: Object.keys(game.figurePositions?.[oppNum] || {}).length,
    activeFigDist,
    activeFigHasTargets,
  };
}

export function computeReward(before, after, isTerminal, didWin) {
  const w = REWARD_WEIGHTS;
  const deltaVP = (after.myVP - before.myVP) - (after.oppVP - before.oppVP);
  const oppDmgBefore = before.oppHpMax - before.oppHpCurrent;
  const oppDmgAfter = after.oppHpMax - after.oppHpCurrent;
  const deltaEnemyDmg = oppDmgAfter - oppDmgBefore;
  const deltaMyHP = after.myHpCurrent - before.myHpCurrent;
  const deltaDist = before.avgDist - after.avgDist;

  let reward = w.vp * deltaVP + w.dmg * deltaEnemyDmg + w.hp * deltaMyHP + w.dist * deltaDist + (w.step || 0);
  if (isTerminal) {
    reward += didWin ? w.terminal : -w.terminal;
  }
  return reward;
}

// ── Action Selection ────────────────────────────────────────────────────────

let _greedyMode = false;
/** Set greedy mode: when true, both DQN epsilon and WG epsilon are forced to 0. */
export function setGreedyMode(v) { _greedyMode = !!v; }

// ── Diagnostic counters for end_activation-over-attack leak ─────────────────
const _diag = { endActOverAttack: 0, totalDecisions: 0, endActTotal: 0, attackAvailTotal: 0 };
export function getDiagnostics() { return { ..._diag }; }
export function resetDiagnostics() { _diag.endActOverAttack = 0; _diag.totalDecisions = 0; _diag.endActTotal = 0; _diag.attackAvailTotal = 0; }

// ── Softmax (Boltzmann) action selection for greedy eval ─────────────────────
// When enabled, greedy eval uses softmax(Q/τ) instead of argmax(Q).
// This allows near-tied Q-values (e.g. attack vs move) to both be selected
// proportionally, rather than argmax deterministically picking the slightly
// higher one every time. Only applies in greedy mode (_greedyMode=true).
// τ=0.3 chosen because Q-values are in the 1-5 range:
//   gap=0.5 → 15.8% for lower action (meaningful randomization)
//   gap=1.0 → 3.6% for lower action (effectively still argmax)
let _softmaxEvalEnabled = false;
let _softmaxTau = 0.3;
export function setSoftmaxEval(enabled, tau) {
  _softmaxEvalEnabled = !!enabled;
  if (tau !== undefined) _softmaxTau = tau;
}

function getEpsilon(totalGames) {
  if (_greedyMode) return 0;
  return Math.max(0.05, 0.3 * Math.exp(-totalGames / 5000));
}

// ── Within-activation planner (always-on) ─────────────────────────────────────
// Deterministic within-activation sequencing. Replaces per-action DQN choices
// during a DC's turn with oracle-style priority: attack weakest > move toward
// nearest enemy > end activation. The DQN handles between-activation decisions
// (which DC to activate, CC play, surge spending, reactive abilities).
// Always-on (train + eval) so the DQN learns between-activation Q-values from
// planner-quality game states, aligning the train/eval distribution.
// Proven by ceiling test: VP/round 14.26 vs DQN-only 8.13, beats oracle 13.19.
const _WITHIN_ACT_TYPES = new Set([
  'attack_close', 'attack_ranged', 'interact', 'start_move',
  'move_toward', 'move_away', 'move_lateral', 'move_done',
  'end_activation',
]);

/** Extract all mission-relevant objective coordinates from map/mission data. */
export function getObjectiveCoords(game) {
  const mapId = game.selectedMap?.id;
  if (!mapId) return [];
  const mapData = getMapTokensData()?.[mapId];
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
    // Mission token positions (panels, contraband, critical positions)
    for (const posArr of Object.values(mapData[missionSide].positions)) {
      for (const c of posArr) coords.add(String(c).toLowerCase());
    }
  }
  // Named areas (Cantina, Command Center, etc.)
  for (const area of mapData.namedAreas || []) {
    for (const c of area.cells || []) coords.add(String(c).toLowerCase());
  }
  // Deployment zone centroids when mission awards VP for zone control
  _addDeploymentZoneCentroids(game, mapId, variant, coords);
  return [...coords];
}


// Add deployment zone centroids when mission scores VP for zone control.
// Without these, the AI has no signal to stay in zones — it evacuates both
// and neither player scores the 3 VP/zone that drives natural completion.
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

function oracleActivationPlan(absTypes, groups, game, dcHealthState, dcMessageMeta, wgMoveWeights) {
  // Only fire for within-activation decisions (not between-activation)
  if (absTypes.includes('activate')) return null;
  const hasWithinAct = absTypes.some(t => _WITHIN_ACT_TYPES.has(t));
  if (!hasWithinAct) return null;

  // ── Carrier priority override ──────────────────────────────────────────────
  // Figures carrying contraband on delivery missions must prioritize movement
  // toward the opponent deployment zone over attacking. Without this, carriers
  // sit at pickup spots attacking nearby enemies and never deliver.
  let isCarrier = false;
  if (game.figureContraband) {
    const anyAction = Object.values(groups).flat()[0];
    const msgId = anyAction?.params?.msgId;
    if (msgId && dcMessageMeta) {
      const meta = dcMessageMeta.get(msgId);
      if (meta) {
        const figureIndex = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
        isCarrier = !!game.figureContraband[figureKey];
        if (!oracleActivationPlan._debugged) {
          const contKeys = Object.keys(game.figureContraband).filter(k => game.figureContraband[k]);
          if (contKeys.length > 0) {
            console.log(`[CARRIER-DEBUG] figureKey=${figureKey}, contraband=${JSON.stringify(contKeys)}, match=${isCarrier}`);
            oracleActivationPlan._debugged = true;
          }
        }
      }
    }
  }

  // ── Zone-control door override ─────────────────────────────────────────────
  // On zone-control / named-area-control missions, force opening doors ahead of
  // the normal attack-first priority.  Mirrors strategy.js:548-558.
  // Without this, figures reach door cells but spend their first action attacking
  // nearby enemies, delaying CC entry by one activation per door.
  if (groups['interact']?.length > 0) {
    try {
      const mapId = game.selectedMap?.id;
      const variant = game.selectedMission?.variant;
      const rules = getMissionCardsData()?.[mapId]?.[variant]?.rules?.endOfRound;
      if (rules?.vpPerControlledDeploymentZone || rules?.vpForControllingNamedArea) {
        const doorAct = groups['interact'].find(
          a => a.params?.optionId?.startsWith('open_door_')
        );
        if (doorAct) return doorAct;
      }
    } catch { /* mission data unavailable — fall through to normal priority */ }
  }

  // Priority 1: Attack weakest target (focus-fire) — skip if carrying contraband
  // Turn-denial tiebreaker: among equal-HP targets, prefer unactivated ones
  // to remove an opponent activation from the round.
  if (!isCarrier) for (const at of ['attack_close', 'attack_ranged']) {
    const actions = groups[at];
    if (!actions || actions.length === 0) continue;
    const oppNum = actions[0].actingPlayer === 1 ? 2 : 1;
    const oppActivated = new Set(oppNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []));
    const oppMsgIds = oppNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);

    // ── Candidate-generation + spatial audit ──────────────────────────────
    // Classifies this attack decision's legal set and measures spatial
    // distributions (nearest-enemy, nearest-Krykna, density rings, refined
    // exclusion reasons). Safe no-op when not in diagnostic mode (just updates
    // counters). Wrapped in try/catch so never breaks gameplay.
    try {
      const candNpcCount = actions.filter(a => a.params?.targetFigureKey?.startsWith('npc_')).length;
      const candFigCount = actions.length - candNpcCount;
      const enemyPop = Object.entries(game.figurePositions?.[oppNum] || {});
      const activeKrykna = (game.npcKrykna || []).filter(k => !k.defeated);

      // Shared spatial context for this decision:
      const attackerPos = getAttackerPosition(actions[0], game, dcMessageMeta);
      const attackerDcName = actions[0].params?.dcName;
      let dcEff; try { dcEff = getDcEffects(); } catch { dcEff = null; }
      const attackerRange = (dcEff && attackerDcName) ? getPracticalAttackRange(dcEff, attackerDcName) : 1;
      const mapId = game.selectedMap?.id;
      let mapSpaces = null;
      let mapAdjacency = null;
      if (mapId) {
        try {
          const md = getMapData(mapId);
          if (md) {
            mapSpaces = { blocking: md.blocking, impassableEdges: md.impassableEdges };
            mapAdjacency = md;
          }
        } catch {}
      }

      _candAudit.totalDecisions++;
      _candAudit.totalNpcCandidates += candNpcCount;
      _candAudit.totalFigureCandidates += candFigCount;
      _candAudit.totalEnemyFiguresOnBoard += enemyPop.length;
      _candAudit.totalActiveKryknaSum += activeKrykna.length;
      // Respawn tracking (population increased since last decision)
      if (activeKrykna.length > _candAudit.lastKryknaPop) _candAudit.respawnEvents += (activeKrykna.length - _candAudit.lastKryknaPop);
      _candAudit.lastKryknaPop = activeKrykna.length;

      // Spatial distributions (only if we can compute distances)
      if (attackerPos) {
        _candAudit.attackerRanges.push(attackerRange);
        // Nearest enemy figure
        let minEnemyDist = Infinity;
        for (const [, figPos] of enemyPop) {
          if (!figPos) continue;
          const d = coordDistance(attackerPos, figPos);
          if (d < minEnemyDist) minEnemyDist = d;
          if (d <= 3) _candAudit.figCountWithin3++;
          if (d <= 5) _candAudit.figCountWithin5++;
          if (d <= 7) _candAudit.figCountWithin7++;
        }
        if (minEnemyDist < Infinity) _candAudit.distToNearestEnemyFig.push(minEnemyDist);
        // Nearest Krykna
        let minKryDist = Infinity;
        for (const k of activeKrykna) {
          if (!k.coord) continue;
          const d = coordDistance(attackerPos, k.coord);
          if (d < minKryDist) minKryDist = d;
          if (d <= 3) _candAudit.kryCountWithin3++;
          if (d <= 5) _candAudit.kryCountWithin5++;
          if (d <= 7) _candAudit.kryCountWithin7++;
        }
        if (minKryDist < Infinity) _candAudit.distToNearestKrykna.push(minKryDist);
      }

      // Decision classification
      if (candNpcCount === 0 && candFigCount === 0) {
        _candAudit.empty++;
      } else if (candNpcCount > 0 && candFigCount === 0) {
        _candAudit.npcOnly++;
        // Refined excluded-enemy-figure classification
        for (const [, figPos] of enemyPop) {
          if (!attackerPos || !figPos) { _candAudit.npcOnlyExcludedByOther++; _candAudit.npcOnlyExcludedFigTotal++; continue; }
          _candAudit.npcOnlyExcludedFigTotal++;
          const manDist = coordDistance(attackerPos, figPos);
          if (manDist > attackerRange) {
            _candAudit.npcOnlyExcludedByRange++;
            continue;
          }
          // In Manhattan range. Check bare LoS.
          if (mapSpaces && !hasLineOfSight(attackerPos, figPos, mapSpaces)) {
            _candAudit.npcOnlyExcludedByLos++;
            continue;
          }
          // In range AND bare-LoS passes. Try to distinguish path-distance vs figure-block vs other.
          // Path-distance: countSpaces (BFS through adjacency, respecting impassable edges) > range
          if (mapAdjacency) {
            try {
              const pathDist = countSpaces(mapAdjacency, attackerPos, figPos, null, Math.max(20, attackerRange * 3));
              if (pathDist > attackerRange) {
                _candAudit.npcOnlyExcludedByPathDist++;
                continue;
              }
            } catch {}
          }
          // Figure-blocking LoS: include all figures as blockers (simplified)
          if (mapSpaces) {
            const figureBlockingCoords = new Set();
            for (const pn of [1, 2]) {
              for (const [, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
                if (pos && String(pos).toLowerCase() !== String(attackerPos).toLowerCase() && String(pos).toLowerCase() !== String(figPos).toLowerCase()) {
                  figureBlockingCoords.add(String(pos).toLowerCase());
                }
              }
              for (const k of (game.npcKrykna || [])) {
                if (k.coord && !k.defeated && String(k.coord).toLowerCase() !== String(figPos).toLowerCase()) {
                  figureBlockingCoords.add(String(k.coord).toLowerCase());
                }
              }
            }
            if (!hasLineOfSight(attackerPos, figPos, mapSpaces, figureBlockingCoords)) {
              _candAudit.npcOnlyExcludedByFigureBlock++;
              continue;
            }
          }
          // Residual
          _candAudit.npcOnlyExcludedByOther++;
        }
      } else if (candNpcCount === 0 && candFigCount > 0) {
        _candAudit.figureOnly++;
      } else {
        _candAudit.mixed++;
      }
    } catch { /* best-effort — never break gameplay */ }

    const scored = actions.map(a => {
      const targetFk = a.params?.targetFigureKey;
      // NPC targets (Krykna, Thugs) aren't in dcHealthState — read from game state
      let hp = null;
      let targetPos = null;
      if (targetFk?.startsWith('npc_')) {
        const parts = targetFk.split('_');
        const npcType = parts[1];
        const npcIndex = parseInt(parts[2], 10);
        const npcArr = npcType === 'krykna' ? game.npcKrykna : game.npcThugs;
        const npc = npcArr?.[npcIndex];
        if (npc) { hp = { current: npc.hp, max: npc.maxHp }; targetPos = npc.coord; }
      } else {
        hp = targetFk ? lookupFigureHp(targetFk, oppNum, dcHealthState, dcMessageMeta) : null;
        targetPos = game.figurePositions?.[oppNum]?.[targetFk];
      }
      const attackerPos = getAttackerPosition(a, game, dcMessageMeta);
      const dist = (targetPos && attackerPos) ? coordDistance(attackerPos, targetPos) : 99;
      // Mission-target priority: Krykna kills are worth 2 VP each — prefer over player figures
      const isKryknaTarget = targetFk?.startsWith('npc_krykna_');
      const missionTargetPriority = (game.npcKrykna && isKryknaTarget) ? 0 : 1;
      let targetActivated = 0;
      if (targetFk && !targetFk.startsWith('npc_')) {
        const targetDcName = targetFk.replace(/-\d+-\d+$/, '');
        for (let i = 0; i < oppMsgIds.length; i++) {
          const meta = dcMessageMeta?.get(oppMsgIds[i]);
          if (meta && meta.dcName === targetDcName) {
            targetActivated = oppActivated.has(i) ? 1 : 0;
            break;
          }
        }
      }
      // hitViability defaults to 0 (reliable) on the oracle path — the planner
      // only fires attacks against in-range targets, so viability is implicit.
      return { action: a, missionTargetPriority, hitViability: 0, currentHp: hp?.current ?? 99, maxHp: hp?.max ?? 99, targetActivated, dist };
    });
    scored.sort(compareAttackTargets);

    // ── Forensic attack-target trace (oracle path) ────────────────────────
    // Mirrors the pickWithinGroup trace so decisions routed through the planner
    // (the majority of non-exploration attacks) are also captured.
    if (ATTACK_TRACE && scored.length > 1) {
      const acting = actions[0].actingPlayer;
      const round = game.currentRound ?? '?';
      const npcCount = scored.filter(s => s.action.params?.targetFigureKey?.startsWith('npc_')).length;
      const figCount = scored.length - npcCount;
      const chosenKey = scored[0].action.params?.targetFigureKey;
      const chosenType = chosenKey?.startsWith('npc_') ? 'NPC' : 'FIG';
      const actingDc = actions[0].params?.dcName || '?';
      const fmtCand = (s) => {
        const fk = s.action.params?.targetFigureKey || '?';
        const type = fk.startsWith('npc_') ? 'NPC' : 'FIG';
        return `${type}:${fk}|hp=${s.currentHp}/${s.maxHp}|mtp=${s.missionTargetPriority}|act=${s.targetActivated}|d=${s.dist}`;
      };
      process.stderr.write(
        `ATK_TRACE_ORACLE P${acting} dc=${actingDc} r=${round} nCand=${scored.length} nNPC=${npcCount} nFIG=${figCount} `
        + `chosen=${chosenType}:${chosenKey} hp=${scored[0].currentHp}/${scored[0].maxHp} mtp=${scored[0].missionTargetPriority} `
        + `| ${scored.map(fmtCand).join(' ; ')}\n`
      );
    }

    // ── Attack target quality audit (oracle path) ─────────────────────────
    _atkAudit.totalDecisions++;
    _atkAudit.totalTargets += scored.length;
    _atkAudit.chosenHpSum += scored[0].currentHp;
    _atkAudit.reliableHits++; // Oracle attacks are always in-range (oracle picks attack only when adjacent/in-range)
    if (scored.length > 1) {
      _atkAudit.multiTargetDecisions++;
      _atkAudit.altHpSum += scored[1].currentHp;
      const equalHpTargets = scored.filter(s => s.currentHp === scored[0].currentHp && s.maxHp === scored[0].maxHp);
      if (equalHpTargets.length > 1) {
        const hasUnactivated = equalHpTargets.some(s => s.targetActivated === 0);
        const hasActivated = equalHpTargets.some(s => s.targetActivated === 1);
        if (hasUnactivated && hasActivated) {
          _atkAudit.turnDenialRelevant++;
          if (scored[0].targetActivated === 0) _atkAudit.turnDenialChosen++;
        }
      }
    }

    return scored[0].action;
  }

  // Priority 2: Interact with mission token (if adjacent and available)
  // Only mission-scoring interacts (launch_panel, open_door, retrieve_contraband),
  // not use_terminal which has no VP value.
  if (groups['interact']?.length > 0) {
    const missionInteracts = groups['interact'].filter(
      a => a.params?.optionId && a.params.optionId !== 'use_terminal'
    );
    if (missionInteracts.length > 0) return missionInteracts[0];
  }

  // Priority 2.5: Play a dc_special (ability) when no higher-priority productive
  // type fires. Without this branch, the chain fell through to end_activation
  // (priority 5) whenever 'ability' was the only productive legal type. Devaron
  // 50g forensic probe (2026-04-16): 321/330 premature-ends matched exactly
  // this pattern; Q(ability) − Q(end) median +1.78 across all 330 frames.
  //
  // Selection heuristic (2026-04-16):
  //   1) Distance gate — if the acting figure is >ABILITY_DIST_GATE (Manhattan)
  //      from every enemy (DC figure + live NPC), the ability is almost certainly
  //      firing out-of-range. Skip and fall through to start_move. Audit counts
  //      the category of each skipped ability so over-gating of off+move is
  //      visible.
  //   2) Category order — rank the gate-passing abilities by
  //      offensive > off+move > defense > support > other; random tie-break
  //      within the winning category.
  if (groups['ability']?.length > 0) {
    const abilities = groups['ability'];
    let distToNearestEnemy = Infinity;
    const actingPN = abilities[0].actingPlayer;
    const oppNum = actingPN === 1 ? 2 : 1;
    const actorPos = getAttackerPosition(abilities[0], game, dcMessageMeta);
    if (actorPos) {
      const oppFigs = game.figurePositions?.[oppNum] || {};
      for (const pos of Object.values(oppFigs)) {
        if (!pos) continue;
        const d = coordDistance(actorPos, pos);
        if (d < distToNearestEnemy) distToNearestEnemy = d;
      }
      for (const k of (game.npcKrykna || [])) {
        if (!k?.coord || k.defeated) continue;
        const d = coordDistance(actorPos, k.coord);
        if (d < distToNearestEnemy) distToNearestEnemy = d;
      }
      for (const t of (game.npcThugs || [])) {
        if (!t?.coord || t.defeated) continue;
        const d = coordDistance(actorPos, t.coord);
        if (d < distToNearestEnemy) distToNearestEnemy = d;
      }
    }

    // Distance gate — actor is too far to use abilities productively
    if (actorPos && distToNearestEnemy > ABILITY_DIST_GATE) {
      _abilityGateAudit.gateHit++;
      for (const a of abilities) {
        const cat = abilityCategory(a.params?.specialName);
        _abilityGateAudit.skippedByCat[cat] = (_abilityGateAudit.skippedByCat[cat] || 0) + 1;
      }
      // fall through to movement
    } else {
      _abilityGateAudit.gatePass++;
      // Category-ranked within-group pick
      let bestRank = Infinity;
      const byRank = [];
      for (const a of abilities) {
        const cat = abilityCategory(a.params?.specialName);
        const rank = ABILITY_CAT_PRIORITY[cat] ?? 4;
        if (rank < bestRank) {
          bestRank = rank;
          byRank.length = 0;
          byRank.push(a);
        } else if (rank === bestRank) {
          byRank.push(a);
        }
      }
      const chosen = byRank[Math.floor(Math.random() * byRank.length)];
      const chosenCat = abilityCategory(chosen.params?.specialName);
      _abilityGateAudit.playedByCat[chosenCat] = (_abilityGateAudit.playedByCat[chosenCat] || 0) + 1;
      return chosen;
    }
  }

  // Priority 3: Start movement if haven't started yet
  if (groups['start_move']?.length > 0) {
    return groups['start_move'][0];
  }

  // Priority 3: Pick movement space closest to nearest enemy OR nearest objective
  const allMoveActions = [];
  for (const mt of ['move_toward', 'move_away', 'move_lateral']) {
    if (groups[mt]) allMoveActions.push(...groups[mt]);
  }
  const spaceActions = allMoveActions.filter(a => a.params?.coord && !a.params?.done);
  if (spaceActions.length > 0) {
    const playerNum = spaceActions[0].actingPlayer;
    const oppNum = playerNum === 1 ? 2 : 1;

    // ── Carrier delivery routing ───────────────────────────────────────────
    // Carriers route toward the opponent's deployment zone for end-of-round VP.
    if (isCarrier) {
      try {
        const mapId = game.selectedMap?.id;
        const zones = getDeploymentZones()?.[mapId];
        if (zones) {
          const initPn = game.initiativePlayerId === game.player1Id ? 1 : 2;
          const chosenColor = game.deploymentZoneChosen || 'red';
          const oppColor = playerNum === initPn
            ? (chosenColor === 'red' ? 'blue' : 'red')
            : chosenColor;
          const oppZoneCells = (zones[oppColor] || []).map(c => String(c).toLowerCase());
          if (oppZoneCells.length > 0) {
            const _mip = game.moveInProgress ? Object.values(game.moveInProgress)[0] : null;
            const curPos = _mip?.startCoord || _mip?.currentCoord;
            let currentDist = Infinity;
            if (curPos) {
              const cp = String(curPos).toLowerCase();
              for (const z of oppZoneCells) {
                const d = coordDistance(cp, z);
                if (d < currentDist) currentDist = d;
              }
            }
            let bestDist = Infinity;
            const bestSpaces = [];
            for (const a of spaceActions) {
              const coord = String(a.params.coord).toLowerCase();
              let minDist = Infinity;
              for (const z of oppZoneCells) {
                const d = coordDistance(coord, z);
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
              return bestSpaces[Math.floor(Math.random() * bestSpaces.length)];
            }
            // No improvement — stop moving
            const doneActs = allMoveActions.filter(a => a.params?.done);
            if (doneActs.length > 0) return doneActs[0];
            if (groups['move_done']?.length > 0) return groups['move_done'][0];
          }
        }
      } catch { /* data not available — fall through to normal routing */ }
    }

    const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
    const objCoords = getObjectiveCoords(game);
    // Positional-VP missions (Powered Perimeter): route toward strained markers
    const _strainMap = game.signalMarkerStrain;
    const _strainedObj = (_strainMap && objCoords.length > 0)
      ? objCoords.filter(c => (_strainMap[String(c).toLowerCase()] || 0) > 0)
      : [];
    const _preferObj = _strainedObj.length > 0;
    // Already adjacent to a strained marker — stop moving to hold position
    if (_preferObj) {
      const _mip = game.moveInProgress ? Object.values(game.moveInProgress)[0] : null;
      const _figPos = _mip?.startCoord || _mip?.currentCoord;
      if (_figPos) {
        const _fp = String(_figPos).toLowerCase();
        const _atMarker = _strainedObj.some(c => coordDistance(_fp, String(c).toLowerCase()) <= 1);
        if (_atMarker) {
          const _doneActs = allMoveActions.filter(a => a.params?.done);
          if (_doneActs.length > 0) return _doneActs[0];
          if (groups['move_done']?.length > 0) return groups['move_done'][0];
        }
      }
    }
    // ── WG move scorer routing (replaces distance-greedy) ─────────────────
    // Use learned within-group move weights when available. These weights
    // encode objective proximity, ally adjacency, enemy proximity, and
    // movement efficiency — strictly superior to min-distance heuristic.
    if (wgMoveWeights && wgMoveWeights.length >= 9) {
      let bestScore = -Infinity, bestAction = null;
      for (const a of spaceActions) {
        const f = extractMoveFeatures(a, game, playerNum, dcHealthState, dcMessageMeta);
        const score = dotProductWg(wgMoveWeights, f);
        if (score > bestScore) { bestScore = score; bestAction = a; }
      }
      if (bestAction) return bestAction;
    }
    // Fallback: distance-greedy (no learned weights available)
    if (oppFigs.length > 0 || objCoords.length > 0) {
      const scored = spaceActions.map(a => {
        const distEnemy = (!_preferObj && oppFigs.length > 0)
          ? Math.min(...oppFigs.map(p => coordDistance(a.params.coord, p)))
          : Infinity;
        const _objTargets = _preferObj ? _strainedObj : objCoords;
        const distObj = _objTargets.length > 0
          ? Math.min(..._objTargets.map(c => coordDistance(a.params.coord, c)))
          : Infinity;
        return { action: a, dist: Math.min(distEnemy, distObj) };
      });
      scored.sort((a, b) => a.dist - b.dist);
      return scored[0].action;
    }
    return spaceActions[0];
  }

  // Priority 4: End movement (done action)
  const doneActions = allMoveActions.filter(a => a.params?.done);
  if (doneActions.length > 0) return doneActions[0];
  if (groups['move_done']?.length > 0) return groups['move_done'][0];

  // Priority 5: End activation
  if (groups['end_activation']?.length > 0) {
    return groups['end_activation'][0];
  }

  return null; // not a within-activation context — let DQN handle
}

export function pickSmartAction(allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  pickSmartAction._lastWgFeatures = null;
  pickSmartAction._lastWgType = null;
  pickSmartAction._lastMoveContrastive = null;
  pickSmartAction._lastCcPickPath = null;
  pickSmartAction._lastShadowData = null;
  pickSmartAction._lastQ = null;
  pickSmartAction._lastAbsTypes = null;
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Group actions by abstract type
  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  // Mandatory actions — always use heuristic (no strategic choice)
  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pick(mandatoryActions);
  if (mandatoryActions.length > 0) return pick(mandatoryActions);

  // Strategic actions only from here
  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pick(allActions);

  // Epsilon-greedy exploration
  const epsilon = getEpsilon(learnings.meta.totalGames);
  if (Math.random() < epsilon) {
    const hAction = heuristicPick(strategicActions, game, learnings.withinGroupWeights?.cc);
    // Extract WG features for the SPECIFIC action the heuristic chose.
    if (hAction) {
      const hAbsType = abstractActionType(hAction, game);
      if (hAbsType === 'play_cc') {
        const ccOpts = groups['play_cc'] || [];
        pickSmartAction._lastCcPickPath = ccOpts.length > 1 ? 'heuristic_scored' : 'heuristic';
      }
      const hGroup = groups[hAbsType];
      if (hGroup && hGroup.length > 1) {
        if (hAbsType === 'attack_close' || hAbsType === 'attack_ranged') {
          pickSmartAction._lastWgFeatures = extractAttackFeatures(hAction, game, dcHealthState, dcMessageMeta);
          pickSmartAction._lastWgType = 'attack';
          pickSmartAction._lastMoveContrastive = null;
        } else if (hAbsType === 'move_toward' || hAbsType === 'move_away' || hAbsType === 'move_lateral') {
          const feats = extractMoveFeatures(hAction, game, playerNum, dcHealthState, dcMessageMeta);
          pickSmartAction._lastWgFeatures = feats;
          pickSmartAction._lastWgType = 'move';
          const hChosenQ = dotProductWg(MOVE_QUALITY_WEIGHTS, feats);
          const hAllSpaces = hGroup.filter(a => a.params?.coord && !a.params?.done);
          // Find reference-best by quality weights
          let hRefBestQ = hChosenQ, hRefBestF = feats;
          for (const a of hAllSpaces) {
            if (a === hAction) continue;
            const af = extractMoveFeatures(a, game, playerNum, dcHealthState, dcMessageMeta);
            const q = dotProductWg(MOVE_QUALITY_WEIGHTS, af);
            if (q > hRefBestQ) { hRefBestQ = q; hRefBestF = af; }
          }
          const hSpaceAlts = hAllSpaces.filter(a => a !== hAction);
          const hSampled = hSpaceAlts.length > MOVE_CONTRASTIVE_SAMPLES
            ? Array.from({ length: MOVE_CONTRASTIVE_SAMPLES }, () => hSpaceAlts.splice(Math.floor(Math.random() * hSpaceAlts.length), 1)[0])
            : hSpaceAlts;
          const hAlternatives = hSampled.map(a => {
            const af = extractMoveFeatures(a, game, playerNum, dcHealthState, dcMessageMeta);
            return { features: af, qualityScore: dotProductWg(MOVE_QUALITY_WEIGHTS, af) };
          });
          pickSmartAction._lastMoveContrastive = hAlternatives.length > 0 ? {
            chosen: feats, chosenQuality: hChosenQ, alternatives: hAlternatives,
            refBestQuality: hRefBestQ, refBestFeatures: hRefBestF, candidateCount: hAllSpaces.length,
          } : null;
        } else {
          pickSmartAction._lastWgFeatures = null;
          pickSmartAction._lastWgType = null;
          pickSmartAction._lastMoveContrastive = null;
        }
      }
    }
    return hAction;
  }

  // Exploitation: compute Q via neural network (flat or graph encoder)
  let Q;
  if (ENCODER_TYPE === 'graph' && learnings.graphNetwork) {
    const graph = buildGraph(game, playerNum, dcHealthState, dcMessageMeta);
    if (USE_MOVE_QUALITY_SIGNAL && learnings.withinGroupWeights?.move) {
      graph.moveQualitySignal = estimateMoveQuality(game, playerNum, dcHealthState, dcMessageMeta, learnings.withinGroupWeights.move);
    }
    const result = graphForwardPass(learnings.graphNetwork, graph);
    Q = result.Q;
  } else {
    const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
    const network = learnings.network;
    if (!network) return heuristicPick(strategicActions, game, learnings.withinGroupWeights?.cc);
    Q = forwardPass(network, features).Q;
  }
  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game, learnings.withinGroupWeights?.cc);

  // Expose Q-values and available abstract types for pass-timing audit
  pickSmartAction._lastQ = Q;
  pickSmartAction._lastAbsTypes = absTypes;

  // ── Within-activation planner (always-on) ──────────────────────────────────
  // Deterministic sequencing replaces per-action DQN during a DC's turn.
  // Active during both training and eval so the DQN trains on planner-quality
  // game states — aligning train/eval distributions for between-activation
  // decisions (which DC, CC, surges, reactive abilities).
  {
    const planResult = oracleActivationPlan(absTypes, groups, game, dcHealthState, dcMessageMeta, learnings.withinGroupWeights?.move);
    if (planResult) {
      // Extract within-group features for the SPECIFIC action the planner chose.
      // Must match features to the executed action — calling pickWithinGroup would
      // return features for whatever target IT prefers, creating a mismatch.
      const planAbsType = abstractActionType(planResult, game);
      const planGroup = groups[planAbsType];
      if (planGroup && planGroup.length > 1) {
        if (planAbsType === 'attack_close' || planAbsType === 'attack_ranged') {
          const feats = extractAttackFeatures(planResult, game, dcHealthState, dcMessageMeta);
          pickSmartAction._lastWgFeatures = feats;
          pickSmartAction._lastWgType = 'attack';
        } else if (planAbsType === 'move_toward' || planAbsType === 'move_away' || planAbsType === 'move_lateral') {
          const feats = extractMoveFeatures(planResult, game, playerNum, dcHealthState, dcMessageMeta);
          pickSmartAction._lastWgFeatures = feats;
          pickSmartAction._lastWgType = 'move';
          // Build contrastive data with real quality scores (MOVE_QUALITY_WEIGHTS)
          // so the contrastive update has a non-zero gradient signal.
          const chosenQ = dotProductWg(MOVE_QUALITY_WEIGHTS, feats);
          const allSpaces = planGroup.filter(a => a.params?.coord && !a.params?.done);
          // Find reference-best by quality weights (independent of learned scorer)
          let refBestQ = chosenQ, refBestF = feats;
          for (const a of allSpaces) {
            if (a === planResult) continue;
            const af = extractMoveFeatures(a, game, playerNum, dcHealthState, dcMessageMeta);
            const q = dotProductWg(MOVE_QUALITY_WEIGHTS, af);
            if (q > refBestQ) { refBestQ = q; refBestF = af; }
          }
          const spaceAlts = allSpaces.filter(a => a !== planResult);
          const sampled = spaceAlts.length > MOVE_CONTRASTIVE_SAMPLES
            ? Array.from({ length: MOVE_CONTRASTIVE_SAMPLES }, () => spaceAlts.splice(Math.floor(Math.random() * spaceAlts.length), 1)[0])
            : spaceAlts;
          const alternatives = sampled.map(a => {
            const af = extractMoveFeatures(a, game, playerNum, dcHealthState, dcMessageMeta);
            return { features: af, qualityScore: dotProductWg(MOVE_QUALITY_WEIGHTS, af) };
          });
          pickSmartAction._lastMoveContrastive = alternatives.length > 0 ? {
            chosen: feats, chosenQuality: chosenQ, alternatives,
            refBestQuality: refBestQ, refBestFeatures: refBestF, candidateCount: allSpaces.length,
          } : null;
        } else {
          pickSmartAction._lastWgFeatures = null;
          pickSmartAction._lastWgType = null;
          pickSmartAction._lastMoveContrastive = null;
        }
      } else {
        pickSmartAction._lastWgFeatures = null;
        pickSmartAction._lastWgType = null;
        pickSmartAction._lastMoveContrastive = null;
      }
      return planResult;
    }
  }

  let bestType = null;
  let ccForceReason = null;
  if (_greedyMode && _softmaxEvalEnabled && absTypes.length > 1) {
    // Softmax (Boltzmann) selection: sample proportionally to exp(Q/τ)
    const tau = _softmaxTau;
    const qVals = absTypes.map(t => {
      const idx = ABSTRACT_TYPES.indexOf(t);
      return idx >= 0 ? Q[idx] / tau : -Infinity;
    });
    const maxQ = Math.max(...qVals);
    const expQ = qVals.map(q => Math.exp(q - maxQ)); // numerically stable
    const sumExp = expQ.reduce((s, e) => s + e, 0);
    const r = Math.random() * sumExp;
    let cumSum = 0;
    for (let i = 0; i < absTypes.length; i++) {
      cumSum += expQ[i];
      if (r <= cumSum) { bestType = absTypes[i]; break; }
    }
    if (!bestType) bestType = absTypes[absTypes.length - 1];
  } else {
    // Argmax selection (training exploitation + non-softmax greedy)
    let bestQ = -Infinity;
    for (const absType of absTypes) {
      const idx = ABSTRACT_TYPES.indexOf(absType);
      if (idx < 0) continue;
      if (Q[idx] > bestQ) {
        bestQ = Q[idx];
        bestType = absType;
      }
    }
  }

  // Domain rule: always spend surges when beneficial surge options exist.
  // Surge spending is a dominated strategy (always better than skipping).
  // Bypass learned Q-values entirely — the within-group scorer picks which surge.
  {
    const surgeSpendTypes = absTypes.filter(t =>
      t === 'surge_damage' || t === 'surge_special' || t === 'spend_surge');
    if (surgeSpendTypes.length > 0 && absTypes.includes('skip_surges')) {
      // Candidate E: prefer surge_damage over surge_special so the within-group
      // scorer sees damage options first. Without this, surge_special can win
      // the [0] slot by filter order, funneling into accuracy-only groups where
      // Candidate D's redundant-accuracy override has no non-accuracy fallback.
      bestType = surgeSpendTypes.includes('surge_damage')
        ? 'surge_damage'
        : surgeSpendTypes[0];
    }
  }

  // Domain rule: prefer attack over movement when attack targets are available.
  // Same dominated-strategy pattern as surges — when the active figure already
  // has targets in attack range, attacking almost always dominates further
  // movement. The Q-value network overvalues move types due to higher shaping
  // rewards during training (~1.5 move vs ~0.65 attack). Bypass the learned
  // Q-values for this decision; the within-group attack scorer still picks
  // which specific target.
  {
    const attackTypes = absTypes.filter(t => t === 'attack_close' || t === 'attack_ranged');
    const moveTypes = new Set(['move_toward', 'move_away', 'move_lateral', 'start_move']);
    if (attackTypes.length > 0 && moveTypes.has(bestType)) {
      bestType = attackTypes[0]; // within-group scorer picks which target
    }
  }

  // Domain rule: play combat CCs during combat resolution.
  // Combat CCs are free interrupts that enhance damage/defense without consuming
  // the figure's actions. Not playing them wastes the timing window — dominated
  // strategy. The within-group CC scorer picks which specific combat CC to play.
  {
    const cbt = game.combat || game.pendingCombat;
    if (cbt && absTypes.includes('play_cc')) {
      const hasCombatCc = strategicActions.some(a => {
        if (abstractActionType(a, game) !== 'play_cc') return false;
        const timing = (getCcEffect(a.params?.cardName)?.timing || '').toLowerCase();
        return COMBAT_CC_TIMINGS.has(timing);
      });
      if (hasCombatCc && bestType !== 'play_cc') {
        bestType = 'play_cc';
        ccForceReason = 'combat_rule';
        _diag.combatCcOverrides = (_diag.combatCcOverrides || 0) + 1;
      }
    }
  }

  if (!_greedyMode && epsilon > 0) {
    // Targeted CC exploration: force play_cc 15% of the time when available.
    // Same rationale as surge exploration — overcome replay buffer distribution
    // dominated by non-CC actions. Rate is lower than surge (15% vs 50%) because
    // CC is available at ~20-40% of decisions (vs ~3% for surges).
    // NOTE: Extended training (500+ games) with this + CC reward causes V(s)
    // inflation. Keep training tranches to ~300 games for stability.
    if (absTypes.includes('play_cc')) {
      if (Math.random() < 0.15) {
        if (bestType !== 'play_cc') ccForceReason = 'cc_explore';
        bestType = 'play_cc';
      }
    }
  }

  // ── Diagnostic: count end_activation chosen when attacks are available ──
  if (_greedyMode) {
    _diag.totalDecisions++;
    const hasAttackTypes = absTypes.some(t => t === 'attack_close' || t === 'attack_ranged');
    if (hasAttackTypes) _diag.attackAvailTotal++;
    if (bestType === 'end_activation') _diag.endActTotal++;
    if (bestType === 'end_activation' && hasAttackTypes) _diag.endActOverAttack++;
  }

  if (bestType === null) {
    const fallback = heuristicPick(strategicActions, game, learnings.withinGroupWeights?.cc);
    if (fallback) {
      const fbType = abstractActionType(fallback, game);
      if (fbType === 'play_cc') {
        const fbCcOpts = groups['play_cc'] || [];
        pickSmartAction._lastCcPickPath = fbCcOpts.length > 1 ? 'heuristic_scored' : 'heuristic';
      }
    }
    return fallback;
  }
  const wgResult = pickWithinGroup(groups[bestType], bestType, game,
    learnings.withinGroupWeights, dcHealthState, dcMessageMeta, learnings.meta.totalGames);
  pickSmartAction._lastWgFeatures = wgResult.wgFeatures;
  pickSmartAction._lastWgType = wgResult.wgType;
  pickSmartAction._lastMoveContrastive = wgResult.moveContrastive || null;
  pickSmartAction._lastShadowData = pickWithinGroup._lastShadowData || null;

  // CC pick path instrumentation: label how this CC decision was routed
  if (bestType === 'play_cc') {
    if (wgResult.wgType === null && groups[bestType].length > 1) {
      pickSmartAction._lastCcPickPath = 'wg_epsilon';
    } else if (ccForceReason) {
      pickSmartAction._lastCcPickPath = ccForceReason;
    } else {
      pickSmartAction._lastCcPickPath = 'trained';
    }
  }

  return wgResult.action;
}

function dotProductWg(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length && i < features.length; i++) {
    sum += weights[i] * features[i];
  }
  return sum;
}

function pickWithinGroup(actions, absType, game, wgWeights, dcHealthState, dcMessageMeta, totalGames) {
  pickWithinGroup._lastShadowData = null; // reset per call
  if (actions.length <= 1) return { action: actions[0], wgFeatures: null, wgType: null };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Attack scorer — domain-rule focus-fire override (EVAL ONLY).
  // Same dominated-strategy pattern as surges and attack-over-move: always
  // prefer the weakest target (lowest current HP → lowest max HP → nearest).
  // The learned scorer spreads damage across figures instead of finishing kills,
  // resulting in 1.9x worse attack-to-kill ratio than the oracle.
  // Gated on _greedyMode to preserve training exploration diversity — applying
  // both focus-fire and activation-order overrides during training degrades
  // the Q-network through reduced within-group exploration.
  // Attack scorer — domain-rule focus-fire override (always-on).
  // Prefer weakest target (lowest current HP → lowest max HP → nearest).
  // Must stay active during training: focus-fire produces more kills,
  // which gives the Q-network stronger VP reward signal for Q(attack).
  // Without it during training, Q(attack) stays weak → end_activation dominates.
  if (absType === 'attack_close' || absType === 'attack_ranged') {
    const group = 'attack';
    const oppNum = actions[0].actingPlayer === 1 ? 2 : 1;

    // Compute expected accuracy for the attacker's dice pool to prioritize
    // targets within reliable hit range. Rule of thumb: distance ≤ expectedAccuracy
    // gives >50% hit rate; beyond that, hits become increasingly unlikely.
    const EXPECTED_ACC_PER_DIE = { blue: 3.17, green: 1.67, yellow: 1.17, red: 0 };
    let attackerExpAcc = 0;
    let isRangedAttack = false;
    const dcName = actions[0]?.params?.dcName;
    let dcEffects;
    try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
    if (dcEffects && dcName) {
      const eff = dcEffects[dcName] || dcEffects[dcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (eff?.attack?.type === 'range') {
        isRangedAttack = true;
        for (const die of eff.attack.dice || []) attackerExpAcc += EXPECTED_ACC_PER_DIE[die] || 0;
        // Add expected surge accuracy: surges rolled × probability of spending on accuracy
        // Simplified: count surge faces across pool, multiply by max surge accuracy available
        let maxSurgeAcc = 0;
        for (const sa of eff.surgeAbilities || []) {
          const m = sa.match(/^accuracy\s+(\d+)$/i);
          if (m) maxSurgeAcc = Math.max(maxSurgeAcc, parseInt(m[1], 10));
        }
        // Expected surge count ≈ 0.5 per die on average; conservatively add half
        // the best surge accuracy as a bonus (player would spend surge on acc if needed)
        if (maxSurgeAcc > 0) attackerExpAcc += maxSurgeAcc * 0.5;
      }
    }

    // Build set of activated DC indices for the opponent to check turn-denial
    const oppActivated = new Set(oppNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []));
    const oppMsgIds = oppNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);

    const scored = actions.map(a => {
      const f = extractAttackFeatures(a, game, dcHealthState, dcMessageMeta);
      const targetFk = a.params?.targetFigureKey;
      // NPC targets (Krykna, Thugs) aren't in dcHealthState — look up from game state
      let hp = null;
      let targetPos = null;
      if (targetFk?.startsWith('npc_')) {
        const parts = targetFk.split('_');
        const npcType = parts[1];
        const npcIndex = parseInt(parts[2], 10);
        const npcArr = npcType === 'krykna' ? game.npcKrykna : game.npcThugs;
        const npc = npcArr?.[npcIndex];
        if (npc) { hp = { current: npc.hp, max: npc.maxHp }; targetPos = npc.coord; }
      } else {
        hp = targetFk ? lookupFigureHp(targetFk, oppNum, dcHealthState, dcMessageMeta) : null;
        targetPos = game.figurePositions?.[oppNum]?.[targetFk];
      }
      const attackerPos = getAttackerPosition(a, game, dcMessageMeta);
      const dist = (targetPos && attackerPos) ? coordDistance(attackerPos, targetPos) : 99;
      // Mission-target priority: on Krykna Infestation (Chopper A), Krykna kills
      // are worth 2 VP each — prefer them over player figures. Without this,
      // Krykna (8 HP) always sort below player figures (3-6 HP) in focus-fire.
      const isKryknaTarget = targetFk?.startsWith('npc_krykna_');
      const missionTargetPriority = (game.npcKrykna && isKryknaTarget) ? 0 : 1;
      // Hit viability: 0 = reliable (dist ≤ expected accuracy), 1 = marginal (beyond expected)
      // Melee always reliable (accuracy not checked). This ensures the AI prefers
      // targets it can actually hit over far-away targets, even if far target has lower HP.
      const hitViability = (isRangedAttack && attackerExpAcc > 0 && dist > attackerExpAcc) ? 1 : 0;
      // Turn-denial tiebreaker: prefer unactivated targets (0) over already-activated (1).
      // Killing an unactivated enemy removes an opponent turn this round.
      // Map figureKey → dcName → msgId → index in DcMessageIds → check ActivatedDcIndices.
      let targetActivated = 0; // default: unactivated (NPC/unknown)
      if (targetFk && !targetFk.startsWith('npc_')) {
        const targetDcName = targetFk.replace(/-\d+-\d+$/, '');
        for (let i = 0; i < oppMsgIds.length; i++) {
          const meta = dcMessageMeta?.get(oppMsgIds[i]);
          if (meta && meta.dcName === targetDcName) {
            targetActivated = oppActivated.has(i) ? 1 : 0;
            break;
          }
        }
      }
      return {
        action: a, features: f,
        missionTargetPriority,
        hitViability,
        currentHp: hp?.current ?? 99,
        maxHp: hp?.max ?? 99,
        targetActivated,
        dist,
      };
    });
    scored.sort(compareAttackTargets);
    const best = scored[0];

    // ── Forensic attack-target trace ──────────────────────────────────────
    // Emits one structured line per multi-candidate attack decision.
    // Fields: side, dc, round, #cand, #npc, #enemyFig, chosenKey, chosenHp,
    //         chosenMTP, chosenViab, candidates=[(type,fk,hp,mtp,viab,act,dist)...]
    if (ATTACK_TRACE && scored.length > 1) {
      const acting = actions[0].actingPlayer;
      const round = game.currentRound ?? '?';
      const npcCount = scored.filter(s => s.action.params?.targetFigureKey?.startsWith('npc_')).length;
      const figCount = scored.length - npcCount;
      const chosenKey = best.action.params?.targetFigureKey;
      const chosenType = chosenKey?.startsWith('npc_') ? 'NPC' : 'FIG';
      const fmtCand = (s) => {
        const fk = s.action.params?.targetFigureKey || '?';
        const type = fk.startsWith('npc_') ? 'NPC' : 'FIG';
        return `${type}:${fk}|hp=${s.currentHp}/${s.maxHp}|mtp=${s.missionTargetPriority}|viab=${s.hitViability}|act=${s.targetActivated}|d=${s.dist}`;
      };
      const cands = scored.map(fmtCand).join(' ; ');
      process.stderr.write(
        `ATK_TRACE P${acting} dc=${dcName} r=${round} nCand=${scored.length} nNPC=${npcCount} nFIG=${figCount} `
        + `chosen=${chosenType}:${chosenKey} hp=${best.currentHp}/${best.maxHp} mtp=${best.missionTargetPriority} `
        + `viab=${best.hitViability} | ${cands}\n`
      );
    }

    // ── Attack target quality audit ───────────────────────────────────────
    _atkAudit.totalDecisions++;
    _atkAudit.totalTargets += scored.length;
    _atkAudit.chosenHpSum += best.currentHp;
    if (best.hitViability === 0) _atkAudit.reliableHits++;
    else _atkAudit.marginalHits++;
    if (scored.length > 1) {
      _atkAudit.multiTargetDecisions++;
      _atkAudit.altHpSum += scored[1].currentHp;
      // Turn-denial: was there an equal-HP pair with different activation status?
      const equalHpTargets = scored.filter(s => s.currentHp === best.currentHp && s.maxHp === best.maxHp);
      if (equalHpTargets.length > 1) {
        const hasUnactivated = equalHpTargets.some(s => s.targetActivated === 0);
        const hasActivated = equalHpTargets.some(s => s.targetActivated === 1);
        if (hasUnactivated && hasActivated) {
          _atkAudit.turnDenialRelevant++;
          if (best.targetActivated === 0) _atkAudit.turnDenialChosen++;
        }
      }
    }

    return { action: best.action, wgFeatures: best.features, wgType: group };
  }

  // Activation order — HP-aware, combat-ready, objective-aware.
  // Heuristic sort is always-on; gated learned scorer runs in shadow mode
  // on the non-combat-ready surface (wounded/positional decisions).
  // Sort priority:
  //   1. Combat-ready (enemy within attack range) — HARD OVERRIDE, not learned
  //   2. Wounded (any figure below max HP) — act before they die
  //   3. Nearest to enemy or objective — positional tiebreaker
  if (absType === 'activate') {
    let dcEffects;
    try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
    const playerNum = actions[0].actingPlayer;
    const oppNum = playerNum === 1 ? 2 : 1;
    const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
    const objCoords = getObjectiveCoords(game);
    const scored = actions.map(a => {
      const dcName = a.params?.dcName;
      const msgId = a.params?.msgId;
      if (!dcName) return { action: a, dcName: '?', combatReady: false, wounded: false, minEnemy: 99, minCombined: 99 };
      const atkRange = dcEffects ? getAttackRange(dcEffects, dcName) : 1;
      const myFigs = Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk]) => fk.startsWith(dcName + '-'));
      let minEnemy = 99, minObj = 99;
      let combatReady = false;
      for (const [, myPos] of myFigs) {
        for (const oppPos of oppFigs) {
          const d = coordDistance(myPos, oppPos);
          if (d < minEnemy) minEnemy = d;
          if (d <= atkRange) combatReady = true;
        }
        for (const oc of objCoords) {
          const d = coordDistance(myPos, oc);
          if (d < minObj) minObj = d;
        }
      }
      let wounded = false;
      if (msgId && dcHealthState) {
        const healthArr = dcHealthState.get(msgId);
        if (healthArr) wounded = healthArr.some(h => h && h[0] < h[1]);
      }
      return { action: a, dcName, combatReady, wounded, minEnemy, minCombined: Math.min(minEnemy, minObj) };
    });
    scored.sort((a, b) => {
      if (a.combatReady !== b.combatReady) return a.combatReady ? -1 : 1;
      if (a.wounded !== b.wounded) return a.wounded ? -1 : 1;
      return a.minCombined - b.minCombined;
    });

    // ── Activation-order audit (unchanged) ──────────────────────────────
    _actOrderAudit.totalDecisions++;
    _actOrderAudit.choiceHistogram[Math.min(actions.length, 6)]++;
    if (actions.length >= 2) {
      _actOrderAudit.multiChoiceDecisions++;
      const chosen = scored[0];
      const runner = scored[1];
      const chosenTier = chosen.combatReady ? 'combat' : chosen.wounded ? 'wounded' : 'positional';
      const runnerTier = runner.combatReady ? 'combat' : runner.wounded ? 'wounded' : 'positional';
      _actOrderAudit.tierCounts[chosenTier]++;
      if (chosenTier === runnerTier) _actOrderAudit.sameTierDecisions++;
      const nCombatReady = scored.filter(s => s.combatReady).length;
      if (nCombatReady > 0) _actOrderAudit.anyCombatReady++;
      if (nCombatReady >= 2) _actOrderAudit.multiCombatReady++;
      if (nCombatReady === 0) _actOrderAudit.noCombatReady++;
      const nWounded = scored.filter(s => s.wounded).length;
      if (nWounded > 0) _actOrderAudit.anyWounded++;
      if (nWounded >= 2) _actOrderAudit.multiWounded++;
      const distSpread = scored[scored.length - 1].minCombined - scored[0].minCombined;
      if (distSpread > 0) _actOrderAudit.positionalSpreadSum += distSpread;
      _actOrderAudit.positionalSpreadCount++;
    } else {
      _actOrderAudit.trivialDecisions++;
    }

    // ── Gated learned activation scorer ────────────────────────────────
    // Gate: only eligible when NO combat-ready DC exists among candidates.
    // When gated out, combat-ready hard override is correct; nothing to learn.
    const anyCombatReady = scored.some(s => s.combatReady);
    let _scorerChoiceIdx = 0; // default to heuristic's choice (scored[0])
    let _scorerEligible = false;
    let featuresByIdx = null; // hoisted for TD learning — null when gated out
    if (anyCombatReady) {
      _actShadow.totalGated++;
    } else if (actions.length >= 2 && wgWeights) {
      _actShadow.totalEligible++;
      featuresByIdx = scored.map(s =>
        extractActivateFeatures(s.action, game, dcHealthState, dcMessageMeta));
      const activateW = wgWeights.activate;
      if (activateW) {
        _scorerEligible = true;
        let bestScore = -Infinity;
        for (let i = 0; i < featuresByIdx.length; i++) {
          const s = dotProductWg(activateW, featuresByIdx[i]);
          if (s > bestScore) { bestScore = s; _scorerChoiceIdx = i; }
        }
        const heuristicPick = scored[0].dcName;
        const scorerPick = scored[_scorerChoiceIdx].dcName;
        const agreed = heuristicPick === scorerPick;

        // Classify the decision surface
        const h1Tier = scored[0].wounded ? 'wounded' : 'positional';
        const h2Tier = scored[1].wounded ? 'wounded' : 'positional';
        let classKey;
        if (h1Tier === 'wounded' && h2Tier === 'wounded') classKey = 'woundedVsWounded';
        else if (h1Tier === 'wounded' || h2Tier === 'wounded') classKey = 'woundedVsPositional';
        else classKey = 'positionalVsPositional';

        const round = Math.min(4, Math.max(1, game.currentRound || 1));
        const myMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
        const myActivated = playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
        const actLeft = myMsgIds.length - myActivated.length;
        const actBucket = actLeft > myMsgIds.length / 2 ? 'early' : 'late';

        if (agreed) {
          _actShadow.agreements++;
          _actShadow.byClass[classKey].agree++;
          _actShadow.byRound[round].agree++;
          _actShadow.byActivationsLeft[actBucket].agree++;
        } else {
          _actShadow.disagreements++;
          _actShadow.byClass[classKey].disagree++;
          _actShadow.byRound[round].disagree++;
          _actShadow.byActivationsLeft[actBucket].disagree++;
          for (let fi = 0; fi < 8; fi++) {
            _actShadow.disagreeFeatureDeltas[fi] += (featuresByIdx[_scorerChoiceIdx][fi] || 0) - (featuresByIdx[0][fi] || 0);
          }
          _actShadow.disagreeCount++;
          // Diagnostic trace: record full context for each disagreement
          _diagTrace.push({
            round, classKey, actBucket,
            heurPick: scored[0].dcName,
            scorerPick: scored[_scorerChoiceIdx].dcName,
            heurObjNorm: featuresByIdx[0][4],     // minObjNorm of heuristic's pick
            scorerObjNorm: featuresByIdx[_scorerChoiceIdx][4], // minObjNorm of scorer's pick
            heurEnemyNorm: featuresByIdx[0][3],
            scorerEnemyNorm: featuresByIdx[_scorerChoiceIdx][3],
            heurRoundFrac: featuresByIdx[0][6],
            scorerRoundFrac: featuresByIdx[_scorerChoiceIdx][6],
            heurScore: dotProductWg(activateW, featuresByIdx[0]),
            scorerScore: dotProductWg(activateW, featuresByIdx[_scorerChoiceIdx]),
            controlled: _activateScorerControl ? 'scorer' : 'heuristic',
            outcome: null, // filled by finalizeActivationOutcome
          });
        }
        _actShadow.byClass[classKey].total++;
        _actShadow.byRound[round].total++;
        _actShadow.byActivationsLeft[actBucket].total++;

        const traceIdx = agreed ? -1 : _diagTrace.length - 1;
        pickWithinGroup._lastShadowData = { heuristicPick, scorerPick, agreed, classKey, traceIdx };
      }
    }

    // Control mode: scorer controls when eligible; otherwise heuristic controls
    const chosenIdx = (_activateScorerControl && _scorerEligible) ? _scorerChoiceIdx : 0;
    // Return features of the actually-chosen DC for TD learning (null when gated out)
    const chosenFeatures = featuresByIdx ? featuresByIdx[chosenIdx] : null;
    return { action: scored[chosenIdx].action, wgFeatures: chosenFeatures, wgType: 'activate' };
  }

  // Move scorer (Phase 5 Slice 2 — learned with contrastive signal)
  if (absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral') {
    const group = 'move';
    const weights = wgWeights?.[group];
    const playerNum = actions[0].actingPlayer;
    // Filter out "done" actions for scoring — they have no coord to evaluate
    const spaceActions = actions.filter(a => a.params?.coord && !a.params?.done);
    if (weights && spaceActions.length > 0 && Math.random() >= getWgEpsilon(totalGames || 0)) {
      // Score all candidates with both learned weights and quality weights
      const allCandidates = spaceActions.map(a => {
        const f = extractMoveFeatures(a, game, playerNum, dcHealthState, dcMessageMeta);
        return { action: a, features: f, learnedScore: dotProductWg(weights, f), qualityScore: dotProductWg(MOVE_QUALITY_WEIGHTS, f) };
      });
      allCandidates.sort((a, b) => b.learnedScore - a.learnedScore);
      const chosen = allCandidates[0];
      // Find reference-best destination (by quality weights, independent of learned scorer)
      const byQuality = [...allCandidates].sort((a, b) => b.qualityScore - a.qualityScore);
      const refBest = byQuality[0];
      // Sample alternatives for contrastive update (up to MOVE_CONTRASTIVE_SAMPLES)
      const others = allCandidates.slice(1);
      const sampled = [];
      for (let i = 0; i < Math.min(MOVE_CONTRASTIVE_SAMPLES, others.length); i++) {
        const idx = Math.floor(Math.random() * others.length);
        sampled.push(others.splice(idx, 1)[0]);
      }
      return {
        action: chosen.action, wgFeatures: chosen.features, wgType: group,
        moveContrastive: {
          chosenQuality: chosen.qualityScore, chosen: chosen.features, alternatives: sampled,
          refBestQuality: refBest.qualityScore, refBestFeatures: refBest.features,
          candidateCount: allCandidates.length,
        },
      };
    }
    // Fallback: heuristic (nearest enemy)
    if (spaceActions.length > 0) {
      const oppNum = playerNum === 1 ? 2 : 1;
      const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
      if (oppFigs.length > 0) {
        const scored = spaceActions.map(a => {
          const dist = Math.min(...oppFigs.map(p => coordDistance(a.params.coord, p)));
          return { action: a, dist };
        });
        scored.sort((a, b) => a.dist - b.dist);
        const best = scored[0].dist;
        const tied = scored.filter(s => s.dist === best);
        return { action: pick(tied).action, wgFeatures: null, wgType: null };
      }
    }
  }

  // Surge scorer (Phase 5 Slice 3 — learned)
  if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') {
    const group = 'surge';
    const weights = wgWeights?.[group];
    if (weights && Math.random() >= getWgEpsilon(totalGames || 0)) {
      // Score all options
      const scored = [];
      for (const a of actions) {
        const f = extractSurgeFeatures(a, game);
        const score = dotProductWg(weights, f);
        scored.push({ action: a, features: f, score });
      }
      scored.sort((a, b) => b.score - a.score);

      // Candidate D: deterministic override for pure redundant accuracy.
      // If shot is guaranteed to hit and the scorer picked a pure-accuracy surge
      // (no damage/pierce/condition/etc.), override with the best scorer-ranked
      // alternative that has actual payload. Preserves scorer ranking among
      // non-pure-accuracy options.
      const cbt = game?.pendingCombat || game?.combat;
      if (cbt?.isRanged && cbt.distanceToTarget != null && scored.length > 1) {
        const dist = cbt.distanceToTarget;
        const totalAcc = (cbt.attackRoll?.acc || 0) + (cbt.bonusAccuracy || 0) + (cbt.surgeAccuracy || 0);
        if (totalAcc >= dist && _isPureAccuracySurge(scored[0].action.params?.surgeKey)) {
          for (let i = 1; i < scored.length; i++) {
            if (!_isPureAccuracySurge(scored[i].action.params?.surgeKey)) {
              return { action: scored[i].action, wgFeatures: scored[i].features, wgType: group };
            }
          }
          // All options are pure accuracy — keep scorer's pick
        }
      }

      return { action: scored[0].action, wgFeatures: scored[0].features, wgType: group };
    }
    return { action: pick(actions), wgFeatures: null, wgType: null };
  }

  // CC scorer (Phase 5 Slice 4 — learned)
  if (absType === 'play_cc') {
    const group = 'cc';
    const weights = wgWeights?.[group];
    if (weights && actions.length > 1 && Math.random() >= getWgEpsilon(totalGames || 0)) {
      let bestScore = -Infinity, bestAction = null, bestFeatures = null;
      for (const a of actions) {
        const f = extractCcFeatures(a, game);
        const score = dotProductWg(weights, f);
        if (score > bestScore) { bestScore = score; bestAction = a; bestFeatures = f; }
      }
      return { action: bestAction, wgFeatures: bestFeatures, wgType: group };
    }
    return { action: pick(actions), wgFeatures: null, wgType: null };
  }

  return { action: pick(actions), wgFeatures: null, wgType: null };
}

function heuristicPick(allActions, game, ccWeights) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);
  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' || a.type === 'end_activation_phase');
  if (transitions.length > 0) return pick(transitions);

  // Reactive counterplay, interrupts & defensive abilities — respond to pending states
  const reactiveTypes = ['negation_play', 'negation_let_resolve',
    'celebration_play', 'celebration_pass',
    'cover_fire_block', 'cover_fire_skip',
    'still_faster_use', 'still_faster_skip', 'still_faster_dc_pick',
    'hunter_protocol_trigger', 'hunter_protocol_skip',
    'last_resort_use', 'last_resort_skip',
    'strike_me_down_yes', 'strike_me_down_no',
    'slow_on_draw_yes', 'slow_on_draw_no',
    'force_exhaustion_yes', 'force_exhaustion_no',
    'illicit_arms_pick', 'illicit_arms_skip', 'illicit_arms_use',
    'tough_luck_remove', 'tough_luck_skip',
    'power_converter_approve', 'power_converter_skip',
    'power_converter_die', 'power_converter_color',
    'there_is_no_try_die', 'there_is_no_try_face', 'there_is_no_try_skip',
    'strain_choice_alldmg', 'strain_choice_discard',
    'force_vision_pick'];
  const reactive = allActions.filter(a => reactiveTypes.includes(a.type));
  if (reactive.length > 0) return pick(reactive);

  // Other pending sub-states
  const pendingTypes = ['dc_ability_choice', 'pounce_space',
    'missile_salvo_die', 'missile_salvo_done',
    'power_token_choice', 'spread_pain_cond'];
  const pending = allActions.filter(a => pendingTypes.includes(a.type));
  if (pending.length > 0) return pick(pending);

  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) return pick(combat);

  const attacks = allActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
  if (attacks.length > 0) return pickWithinGroup(attacks, 'attack_close', game, null, null, null, 0).action;

  // CC play — try before movement/activation
  const ccPlay = allActions.filter(a => a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double');
  if (ccPlay.length > 0) {
    // Route multi-CC decisions through scorer instead of random pick
    if (ccPlay.length > 1 && ccWeights) {
      let bestScore = -Infinity, bestAction = null;
      for (const a of ccPlay) {
        const score = dotProductWg(ccWeights, extractCcFeatures(a, game));
        if (score > bestScore) { bestScore = score; bestAction = a; }
      }
      return bestAction;
    }
    return pick(ccPlay);
  }

  const specials = allActions.filter(a => a.type === 'dc_special');
  if (specials.length > 0) return pick(specials);

  const moveSpaces = allActions.filter(a => a.type === 'move_pick_space' && !a.params?.done);
  if (moveSpaces.length > 0) return pickWithinGroup(moveSpaces, 'move_toward', game, null, null, null, 0).action;

  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) return pick(moveStart);

  const moveFinish = allActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
  if (moveFinish.length > 0) return pick(moveFinish);

  const endAct = allActions.filter(a => a.type === 'dc_end_activation');
  if (endAct.length > 0) return pick(endAct);
  const activate = allActions.filter(a => a.type === 'activate_dc');
  if (activate.length > 0) return pick(activate);

  return pick(allActions);
}

// ── Game Loop Integration ───────────────────────────────────────────────────

/**
 * Compute unique abstract action type indices from a set of game actions.
 * Excludes mandatory (gate, combat_flow) types.
 */
function getAbstractTypeIdxs(actions, game) {
  const idxSet = new Set();
  const mandatoryTypes = ['gate', 'combat_flow'];
  for (const action of actions) {
    const abs = abstractActionType(action, game);
    if (mandatoryTypes.includes(abs)) continue;
    const idx = ABSTRACT_TYPES.indexOf(abs);
    if (idx >= 0) idxSet.add(idx);
  }
  return idxSet.size > 0 ? [...idxSet] : null;
}

export function createGameTracer(learnings, playerNum, dcHealthState, dcMessageMeta) {
  const trace = [];
  let lastSnapshot = null;
  let lastFeatures = null;
  let _hasBeneficialSurge = false; // True when beneficial surge spend was available at decision time
  let _ccPlaysThisGame = 0; // Per-game CC play counter for reward cap
  let _dcSpecialPlaysThisGame = 0; // Per-game dc_special counter for reward cap
  let _moveShapingThisActivation = 0; // Accumulated movement shaping in current activation
  let lastActiveDcMsgId = null;       // Frozen pre-action figure identity (boundary key)
  let lastActiveFigIdx = null;        // Frozen pre-action subfigure index (v2 / diagnostics)

  return {
    beforeAction(game, playerActions) {
      // Fill in previous entry's nextActionIdxs from current available actions
      if (playerActions && trace.length > 0) {
        const prev = trace[trace.length - 1];
        if (prev.nextActionIdxs === null && !prev.done) {
          prev.nextActionIdxs = getAbstractTypeIdxs(playerActions, game);
        }
      }

      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      if (ENCODER_TYPE === 'graph') {
        lastFeatures = buildGraph(game, playerNum, dcHealthState, dcMessageMeta);
        if (USE_MOVE_QUALITY_SIGNAL && learnings.withinGroupWeights?.move) {
          lastFeatures.moveQualitySignal = estimateMoveQuality(game, playerNum, dcHealthState, dcMessageMeta, learnings.withinGroupWeights.move);
        }
      } else {
        lastFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      }

      // ── Freeze figure identity from PRE-ACTION state ──────────────────
      // MUST capture here, not in afterAction. During end_activation dispatch,
      // cleanupActivation() deletes dcActionsData[msgId] before submitAction
      // returns — post-dispatch reads would get null.
      const activeDc = findActiveDcMsgId(game, playerNum, dcMessageMeta);
      lastActiveDcMsgId = activeDc ? activeDc.msgId : null;
      lastActiveFigIdx = activeDc
        ? (game.dcActionsData?.[activeDc.msgId]?.selectedFigure ?? 0)
        : null;

      // Detect whether any beneficial surge spend is available at this decision point.
      // Used to penalize skip_surges when the agent had a positive-value option.
      _hasBeneficialSurge = false;
      if (playerActions) {
        for (const a of playerActions) {
          if (surgeShapingReward(a) > 0) {
            _hasBeneficialSurge = true;
            break;
          }
        }
      }
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastFeatures) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastFeatures = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      let nextFeatures;
      if (ENCODER_TYPE === 'graph') {
        nextFeatures = buildGraph(game, playerNum, dcHealthState, dcMessageMeta);
        if (USE_MOVE_QUALITY_SIGNAL && learnings.withinGroupWeights?.move) {
          nextFeatures.moveQualitySignal = estimateMoveQuality(game, playerNum, dcHealthState, dcMessageMeta, learnings.withinGroupWeights.move);
        }
      } else {
        nextFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      }

      // ── Surge-aware reward shaping ──────────────────────────────────────────
      // Large fixed constants dominate (1-γ)*V(s) step cost at any realistic V(s).
      // No V-scaling — avoids feedback loop where higher rewards inflate V(s).
      let surgeBonus = 0;
      const isSurgeSpend = absType === 'spend_surge' || absType === 'surge_damage' || absType === 'surge_special';
      const isSurgeSkip = absType === 'skip_surges';

      if (isSurgeSpend) {
        surgeBonus = surgeShapingReward(action);
      } else if (isSurgeSkip && _hasBeneficialSurge) {
        surgeBonus = -SURGE_SKIP_PENALTY;
      }

      // CC shaping: flat bonus for playing a CC (no immediate HP/VP delta otherwise)
      // Capped per game to prevent unbounded reward from repeated 0-cost CCs.
      let ccBonus = 0;
      if (absType === 'play_cc') {
        _ccPlaysThisGame++;
        if (_ccPlaysThisGame <= CC_REWARD_CAP) ccBonus = CC_SHAPE_REWARD;
      }

      // DC Special shaping: flat bonus for using a dc_special ability.
      // Capped per game to prevent spam (same pattern as CC shaping).
      let dcSpecialBonus = 0;
      if (absType === 'ability') {
        _dcSpecialPlaysThisGame++;
        if (_dcSpecialPlaysThisGame <= DC_SPECIAL_CAP) dcSpecialBonus = DC_SPECIAL_REWARD;
      }

      // ── Movement-specific reward shaping ─────────────────────────────────────
      // Targets the core failure mode: movement has delayed payoff but near-zero
      // immediate reward. We give the ACTIVE FIGURE credit for closing distance
      // or entering attack range, but ONLY when it wasn't already in range.
      // Reset per-activation counter on activate/end_activation.
      let moveBonus = 0;
      const isMoveAction = absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral';
      if (absType === 'activate' || absType === 'end_activation') {
        _moveShapingThisActivation = 0;
      }
      if (isMoveAction && lastSnapshot.activeFigDist != null && afterSnap.activeFigDist != null
          && _moveShapingThisActivation < MOVE_REWARD_CAP_PER_ACT) {
        // Only shape when the figure was NOT already in attack range before moving.
        // If already in range, movement is tactical repositioning — let the existing
        // distance reward handle it. This prevents rewarding random shuffling in melee.
        if (!lastSnapshot.activeFigHasTargets) {
          // Term 1: per-space closing reward
          const distClosed = lastSnapshot.activeFigDist - afterSnap.activeFigDist;
          if (distClosed > 0) {
            const closingReward = Math.min(distClosed, 5) * MOVE_CLOSING_REWARD;
            moveBonus += closingReward;
          }
          // Term 2: engagement bonus — transitioned from "no targets" to "targets in range"
          if (afterSnap.activeFigHasTargets) {
            moveBonus += MOVE_ENGAGE_BONUS;
          }
          // Enforce per-activation cap
          const room = MOVE_REWARD_CAP_PER_ACT - _moveShapingThisActivation;
          moveBonus = Math.min(moveBonus, room);
          _moveShapingThisActivation += moveBonus;
        }
      }

      // ── start_move decision bonus ──────────────────────────────────────────
      // Rewards the TYPE-LEVEL decision to begin movement when no targets are
      // in attack range. This directly addresses the graph encoder's tendency
      // to suppress Q(start_move) relative to Q(end_activation) via bootstrap.
      let moveDecisionBonus = 0;
      if (MOVE_DECISION_BONUS > 0 && absType === 'start_move' && lastSnapshot && !lastSnapshot.activeFigHasTargets) {
        moveDecisionBonus = MOVE_DECISION_BONUS;
      }

      // ── Attack shaping bonus ──────────────────────────────────────────────
      // Flat bonus for choosing to attack, regardless of hit/miss outcome.
      // Without this, attacks get 0.15 base vs movement's 0.85-1.35,
      // causing greedy argmax to never select attack actions.
      let attackBonus = 0;
      if (ATTACK_SHAPE_REWARD > 0 && (absType === 'attack_close' || absType === 'attack_ranged')) {
        attackBonus = ATTACK_SHAPE_REWARD;
      }

      // Activation-action bonus: reward productive actions during activation phase.
      // Movement, attack, ability, and interact all deserve immediate credit because
      // they advance board state. end_activation / pass get no bonus (just step cost).
      const PRODUCTIVE_ABS_TYPES = new Set([
        'start_move', 'move_toward', 'move_away', 'move_lateral', 'move_done',
        'attack_close', 'attack_ranged', 'ability', 'interact',
      ]);
      const activationBonus = PRODUCTIVE_ABS_TYPES.has(absType) ? (REWARD_WEIGHTS.activationAction || 0) : 0;

      const reward = computeReward(lastSnapshot, afterSnap, false, false) + surgeBonus + ccBonus + dcSpecialBonus + moveBonus + moveDecisionBonus + attackBonus + activationBonus;
      const actionIdx = ABSTRACT_TYPES.indexOf(absType);
      const wgFeatures = pickSmartAction._lastWgFeatures || null;
      const wgType = pickSmartAction._lastWgType || null;
      const moveContrastive = pickSmartAction._lastMoveContrastive || null;
      trace.push({
        features: lastFeatures, actionIdx, reward, nextFeatures,
        nextActionIdxs: null, done: false,
        wgFeatures, wgType, moveContrastive,
        activeDcMsgId: lastActiveDcMsgId,   // v1 boundary truncation key
        activeFigIdx: lastActiveFigIdx,     // stored for v2 / diagnostics
      });
      lastSnapshot = null;
      lastFeatures = null;
      lastActiveDcMsgId = null;
      lastActiveFigIdx = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        const last = trace[trace.length - 1];
        last.reward += didWin ? REWARD_WEIGHTS.terminal : (didLose ? -REWARD_WEIGHTS.terminal : 0);
        last.nextFeatures = null; // Terminal state
        last.nextActionIdxs = null;
        last.done = true;
      }
      updateTraceNeural(learnings, trace);
      if (updateMeta) {
        learnings.meta.totalGames++;
        if (game.ended && game.winnerId) {
          if (game.winnerId === game.player1Id) learnings.meta.p1Wins++;
          else learnings.meta.p2Wins++;
        }
      }
    },

    getTrace() { return trace; },
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function loadLearnings(filePath) {
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      // Migrate from Phase 1/2 to Phase 3 if needed
      if (!data.network) {
        data.network = initializeNetwork();
        delete data.weights;
        delete data.states;
        data.brainPhase = 3;
      }
      if (!data.trainingStats) {
        data.trainingStats = {
          totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES,
          hiddenSize: HIDDEN_SIZE, lastTargetSync: 0, targetSyncs: 0,
          nanResets: 0, tdErrorHistory: [],
        };
      }
      // Migrate: ensure diversity-pilot telemetry fields exist
      if (!data.deckStats) data.deckStats = {};
      if (!data.mapStats) data.mapStats = {};
      if (!data.whitelistAudit) data.whitelistAudit = { totalHits: 0, hitsByCard: {} };
      if (!data.uniqueConfigs) data.uniqueConfigs = [];
      // Migrate network from fewer input features to current NUM_FEATURES
      // (e.g., 16 → N when new features are added)
      if (data.network && data.network.W1[0] && data.network.W1[0].length < NUM_FEATURES) {
        const oldFeatures = data.network.W1[0].length;
        const heInit = Math.sqrt(2 / NUM_FEATURES);
        for (let j = 0; j < data.network.W1.length; j++) {
          for (let i = oldFeatures; i < NUM_FEATURES; i++) {
            data.network.W1[j].push(randn() * heInit);
          }
        }
        console.log(`[learnings] Migrated W1 input features: ${oldFeatures} → ${NUM_FEATURES}`);
      }
      // Migrate hidden layer from smaller to larger size (e.g., 32 → 64)
      // Warm-start: existing neurons keep their learned weights, new neurons get fresh init.
      if (data.network && data.network.W1.length < HIDDEN_SIZE) {
        const oldHidden = data.network.W1.length;
        const nFeatures = data.network.W1[0].length;
        const heInit = Math.sqrt(2 / nFeatures);
        const xavierV = Math.sqrt(2 / (HIDDEN_SIZE + 1));
        const xavierA = Math.sqrt(2 / (HIDDEN_SIZE + (data.network.Wa?.length || NUM_ACTIONS)));
        // Add new rows to W1 (input→hidden) and b1
        for (let j = oldHidden; j < HIDDEN_SIZE; j++) {
          const row = [];
          for (let i = 0; i < nFeatures; i++) row.push(randn() * heInit);
          data.network.W1.push(row);
          data.network.b1.push(0);
          // Extend Wv (value head)
          data.network.Wv.push(randn() * xavierV);
        }
        // Extend each Wa row (advantage head) with new hidden columns
        for (let k = 0; k < data.network.Wa.length; k++) {
          for (let j = oldHidden; j < HIDDEN_SIZE; j++) {
            data.network.Wa[k].push(randn() * xavierA);
          }
        }
        console.log(`[learnings] Migrated hidden size: ${oldHidden} → ${HIDDEN_SIZE} (warm-start: ${oldHidden} neurons preserved, ${HIDDEN_SIZE - oldHidden} new)`);
      }
      // Migrate network from fewer action types to current NUM_ACTIONS
      // (e.g., 15 → 22 when A2 splits were added)
      if (data.network && data.network.Wa.length < NUM_ACTIONS) {
        const oldCount = data.network.Wa.length;
        const xavierA = Math.sqrt(2 / (HIDDEN_SIZE + NUM_ACTIONS));
        for (let k = oldCount; k < NUM_ACTIONS; k++) {
          const row = [];
          for (let j = 0; j < HIDDEN_SIZE; j++) row.push(randn() * xavierA);
          data.network.Wa.push(row);
          data.network.ba.push(0);
        }
      }
      // Ensure Phase 3 stats fields exist
      data.trainingStats.featureNames = FEATURE_NAMES;
      data.trainingStats.hiddenSize = HIDDEN_SIZE;
      if (data.trainingStats.lastTargetSync === undefined) data.trainingStats.lastTargetSync = 0;
      if (data.trainingStats.targetSyncs === undefined) data.trainingStats.targetSyncs = 0;
      if (data.trainingStats.nanResets === undefined) data.trainingStats.nanResets = 0;
      if (!data.trainingStats.tdErrorHistory) data.trainingStats.tdErrorHistory = [];
      data.brainPhase = 3;
      // Target network is always recreated from online network (not persisted)
      data.targetNetwork = deepCopyNetwork(data.network);
      if (!data.dcStats) data.dcStats = {};
      if (!data.affiliationStats) data.affiliationStats = {};
      if (!data.matchups) data.matchups = [];
      if (!data.replayBuffer) data.replayBuffer = { transitions: [], writeIdx: 0, count: 0 };
      if (!data.withinGroupWeights) {
        data.withinGroupWeights = {
          attack: new Array(6).fill(0), move: new Array(9).fill(0),
          surge: new Array(4).fill(0), cc: new Array(5).fill(0),
          activate: [0.3, -0.4, 0.2, 0.3, 0.2, 0.1, 0.1, 0.0],
        };
      }
      // One-time migration: add activate WG weights for gated activation-order scorer.
      // Seeded with domain-aligned priors so shadow mode produces meaningful
      // disagreement signal immediately (zero weights → 100% agreement → no data).
      // Priors: prefer threatened DCs (+0.3), wounded DCs (-0.4 = lower hpFrac → higher priority),
      // more figures (+0.2), closer to enemy (+0.3), closer to objective (+0.2),
      // ranged slight bonus (+0.1), late-round slight bonus (+0.1), bias 0.
      if (!data.withinGroupWeights.activate) {
        data.withinGroupWeights.activate = [0.3, -0.4, 0.2, 0.3, 0.2, 0.1, 0.1, 0.0];
        console.log('[learnings] Added activate WG weights (8 features, domain priors) for gated activation-order scorer');
      }
      // Migrate move scorer from 6 → 9 features (Phase 5 move-feature upgrade)
      if (data.withinGroupWeights?.move && data.withinGroupWeights.move.length === 6) {
        data.withinGroupWeights.move.push(0, 0, 0); // destInEnemyRange, destOnObjective, destAdjacentToAlly
        console.log('[learnings] Migrated move WG weights 6 → 9 features (added destInEnemyRange, destOnObjective, destAdjacentToAlly)');
      }
      // Migrate move scorer from 9 → 15 features (representation expansion)
      // Pads with zeros so previously-trained learners continue to behave identically
      // on the original 9 features; the 6 new features start with no learned weight and
      // acquire signal via the contrastive loss against the new 15-dim teacher.
      if (data.withinGroupWeights?.move && data.withinGroupWeights.move.length === 9) {
        data.withinGroupWeights.move.push(0, 0, 0, 0, 0, 0);
        console.log('[learnings] Migrated move WG weights 9 → 15 features (added canAttackFromDest, bestReachableKillFraction, reachableUnactivatedFraction, netDamageDelta, attackActionFeasibleAfterMove, losTargetCountNorm)');
      }
      // One-time migration: reset inverted surge WG weights to positive priors.
      // The surge scorer drifted into a negative basin under the old reward signal,
      // causing it to prefer the WORST surge options. Reset to domain-aligned priors:
      // damageValue=+1.0 (prefer high-damage surges), isAccuracy=+0.5, isRecover=+0.3, bias=0.
      if (data.withinGroupWeights?.surge && !data._surgeWgResetV1) {
        const sw = data.withinGroupWeights.surge;
        if (sw[3] < -1.0 || (sw[0] < 0 && sw[1] < 0 && sw[2] < 0)) {
          data.withinGroupWeights.surge = [1.0, 0.5, 0.3, 0.0];
          console.log('[learnings] Migrated surge WG weights from inverted basin → positive priors [1.0, 0.5, 0.3, 0.0]');
        }
        data._surgeWgResetV1 = true;
      }

      // One-time migration: extend surge WG weights from 4→5 for accuracyNeeded feature.
      // Append 0.0 so the new feature starts with no influence — scorer behaves identically
      // until training learns a weight for it.
      if (data.withinGroupWeights?.surge && data.withinGroupWeights.surge.length === 4) {
        data.withinGroupWeights.surge.push(0.0);
        console.log('[learnings] Extended surge WG weights 4→5: appended accuracyNeeded=0.0');
      }

      // One-time migration: extend surge WG weights from 5→6 for accuracySurplus feature.
      if (data.withinGroupWeights?.surge && data.withinGroupWeights.surge.length === 5) {
        data.withinGroupWeights.surge.push(0.0);
        console.log('[learnings] Extended surge WG weights 5→6: appended accuracySurplus=0.0');
      }

      // One-time migration: extend CC WG weights from 4→5 for isCombatTimed feature.
      if (data.withinGroupWeights?.cc && data.withinGroupWeights.cc.length === 4) {
        data.withinGroupWeights.cc.push(0.0);
        console.log('[learnings] Extended CC WG weights 4→5: appended isCombatTimed=0.0');
      }

      // One-time migration: reset inverted move WG weights to mild priors.
      // The move scorer drifted into a strongly negative basin (bias ≈ -5, all weights negative)
      // creating a "never move" death spiral — no movement → no positive signal → stays negative.
      // Feature semantics (all 0-1 normalized, higher = more of that quality):
      //   [0] distToNearestEnemy: 1=adjacent, 0=far → positive weight = prefer closer (aggression)
      //   [1] threatAtDest: 1=high threat, 0=safe → negative weight = avoid danger
      //   [2] objectiveProximity: 1=on objective, 0=far → positive weight = prefer objectives
      //   [3] allySupport: 1=allies nearby, 0=isolated → mild positive = prefer grouped positions
      //   [4] mpEfficiency: 1=cheap step, 0=costly → positive = prefer efficient movement
      //   [5] bias: should be mildly positive to encourage movement over standing still
      // Reset to mild domain-aligned priors rather than zeros:
      if (data.withinGroupWeights?.move && !data._moveWgResetV1) {
        const mw = data.withinGroupWeights.move;
        if (mw[5] < -2.0 || (mw[0] < 0 && mw[2] < 0 && mw[4] < 0)) {
          //                   enemy_close  threat  objective  ally   efficiency  bias  exposed  onObj  adjAlly
          data.withinGroupWeights.move = [0.5, -0.3, 0.5, 0.2, 0.3, 0.5, 0, 0, 0];
          console.log('[learnings] Migrated move WG weights from inverted basin → mild priors [0.5, -0.3, 0.5, 0.2, 0.3, 0.5, 0, 0, 0]');
        }
        data._moveWgResetV1 = true;
      }

      data.brainPhase = 5;
      // Graph encoder: initialize if ENCODER_TYPE=graph and not yet present
      if (ENCODER_TYPE === 'graph') {
        if (data.graphNetwork) {
          migrateGraphNetwork(data.graphNetwork);
          data.graphTargetNetwork = deepCopyGraphNetwork(data.graphNetwork);
        } else {
          data.graphNetwork = initGraphNetwork(NUM_ACTIONS);
          data.graphTargetNetwork = deepCopyGraphNetwork(data.graphNetwork);
        }
      }
      return data;
    }
  } catch { /* start fresh */ }
  const network = initializeNetwork();
  const result = {
    brainPhase: 5,
    meta: { totalGames: 0, p1Wins: 0, p2Wins: 0, lastUpdated: null, trainingHistory: [] },
    network,
    targetNetwork: deepCopyNetwork(network),
    trainingStats: {
      totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES,
      hiddenSize: HIDDEN_SIZE, lastTargetSync: 0, targetSyncs: 0,
      nanResets: 0, tdErrorHistory: [],
    },
    dcStats: {},
    affiliationStats: {},
    matchups: [],
    replayBuffer: { transitions: [], writeIdx: 0, count: 0 },
    withinGroupWeights: {
      attack: new Array(6).fill(0), move: new Array(9).fill(0),
      surge: new Array(4).fill(0), cc: new Array(4).fill(0),
    },
  };
  if (ENCODER_TYPE === 'graph') {
    result.graphNetwork = initGraphNetwork(NUM_ACTIONS);
    result.graphTargetNetwork = deepCopyGraphNetwork(result.graphNetwork);
  }
  return result;
}

export function saveLearnings(learnings, filePath) {
  learnings.meta.lastUpdated = new Date().toISOString();
  // Exclude targetNetwork from persistence (in-memory only)
  const toSave = {
    brainPhase: 5,
    meta: learnings.meta,
    network: learnings.network,
    trainingStats: learnings.trainingStats,
    dcStats: learnings.dcStats,
    affiliationStats: learnings.affiliationStats,
    matchups: learnings.matchups,
    withinGroupWeights: learnings.withinGroupWeights,
    _surgeWgResetV1: learnings._surgeWgResetV1 || false,
    _moveWgResetV1: learnings._moveWgResetV1 || false,
    deckStats: learnings.deckStats || {},
    mapStats: learnings.mapStats || {},
    whitelistAudit: learnings.whitelistAudit || { totalHits: 0, hitsByCard: {} },
    uniqueConfigs: learnings.uniqueConfigs || [],
  };
  // Persist graph network if present (target network rebuilt on load)
  if (learnings.graphNetwork) {
    toSave.graphNetwork = serializeGraphNetwork(learnings.graphNetwork);
    toSave.encoderType = ENCODER_TYPE;
  }
  writeFileSync(filePath, JSON.stringify(toSave));
}

// ── Replay Buffer Persistence ────────────────────────────────────────────

export function saveReplayBuffer(learnings, filePath) {
  const buf = learnings.replayBuffer;
  if (!buf || buf.transitions.length === 0) return;
  writeFileSync(filePath, JSON.stringify({
    transitions: buf.transitions,
    writeIdx: buf.writeIdx,
    count: buf.count,
  }));
}

export function loadReplayBuffer(learnings, filePath) {
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      learnings.replayBuffer = {
        transitions: data.transitions || [],
        writeIdx: data.writeIdx || 0,
        count: data.count || 0,
      };
      return;
    }
  } catch { /* start fresh */ }
  learnings.replayBuffer = { transitions: [], writeIdx: 0, count: 0 };
}

// ── Per-DC / Affiliation Tracking ────────────────────────────────────────

export function recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStatsFunc, getDcEffectsFunc, opts = {}) {
  if (!learnings.dcStats) learnings.dcStats = {};
  if (!learnings.affiliationStats) learnings.affiliationStats = {};
  if (!learnings.matchups) learnings.matchups = [];

  function getAffiliation(dcName) {
    try {
      if (getDcEffectsFunc) {
        const effects = getDcEffectsFunc();
        const lower = dcName?.toLowerCase?.() || '';
        const ciKey = Object.keys(effects).find(k => k.toLowerCase() === lower);
        const eff = effects[dcName] || (ciKey ? effects[ciKey] : null);
        if (eff?.affiliation) return eff.affiliation.toLowerCase();
      }
    } catch { /* ignore */ }
    return 'unknown';
  }

  function trackDc(dcName, isWinner) {
    if (!learnings.dcStats[dcName]) {
      learnings.dcStats[dcName] = { wins: 0, losses: 0, games: 0, affiliation: getAffiliation(dcName) };
    }
    const s = learnings.dcStats[dcName];
    s.games++;
    if (isWinner === true) s.wins++;
    else if (isWinner === false) s.losses++;
    if (s.affiliation === 'unknown') s.affiliation = getAffiliation(dcName);
  }

  for (const dc of p1Army) {
    const name = typeof dc === 'object' ? dc.dcName : dc;
    trackDc(name, winnerLabel === 'P1' ? true : winnerLabel === 'P2' ? false : null);
  }
  for (const dc of p2Army) {
    const name = typeof dc === 'object' ? dc.dcName : dc;
    trackDc(name, winnerLabel === 'P2' ? true : winnerLabel === 'P1' ? false : null);
  }

  const p1Affs = new Set(p1Army.map(dc => getAffiliation(typeof dc === 'object' ? dc.dcName : dc)));
  const p2Affs = new Set(p2Army.map(dc => getAffiliation(typeof dc === 'object' ? dc.dcName : dc)));
  for (const aff of p1Affs) {
    if (!learnings.affiliationStats[aff]) learnings.affiliationStats[aff] = { wins: 0, losses: 0, games: 0 };
    learnings.affiliationStats[aff].games++;
    if (winnerLabel === 'P1') learnings.affiliationStats[aff].wins++;
    else if (winnerLabel === 'P2') learnings.affiliationStats[aff].losses++;
  }
  for (const aff of p2Affs) {
    if (!learnings.affiliationStats[aff]) learnings.affiliationStats[aff] = { wins: 0, losses: 0, games: 0 };
    learnings.affiliationStats[aff].games++;
    if (winnerLabel === 'P2') learnings.affiliationStats[aff].wins++;
    else if (winnerLabel === 'P1') learnings.affiliationStats[aff].losses++;
  }

  learnings.matchups.push({
    p1: p1Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    p2: p2Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    winner: winnerLabel,
    game: learnings.meta.totalGames,
  });
  if (learnings.matchups.length > 200) learnings.matchups = learnings.matchups.slice(-200);

  // ── Deck-level tracking (diversity pilot) ─────────────────────────────
  if (opts.p1DeckName || opts.p2DeckName) {
    if (!learnings.deckStats) learnings.deckStats = {};
    for (const [dn, isWinner] of [[opts.p1DeckName, winnerLabel === 'P1'], [opts.p2DeckName, winnerLabel === 'P2']]) {
      if (!dn) continue;
      if (!learnings.deckStats[dn]) learnings.deckStats[dn] = { wins: 0, losses: 0, games: 0 };
      const s = learnings.deckStats[dn];
      s.games++;
      if (winnerLabel === 'P1' || winnerLabel === 'P2') {
        if (isWinner) s.wins++; else s.losses++;
      }
    }
  }

  // ── Map-level tracking (diversity pilot) ──────────────────────────────
  if (opts.mapId) {
    if (!learnings.mapStats) learnings.mapStats = {};
    const mid = opts.mapId;
    if (!learnings.mapStats[mid]) learnings.mapStats[mid] = { wins: { P1: 0, P2: 0 }, games: 0, totalVP: 0, decisive: 0 };
    const ms = learnings.mapStats[mid];
    ms.games++;
    if (winnerLabel === 'P1') ms.wins.P1++;
    if (winnerLabel === 'P2') ms.wins.P2++;
    if (typeof opts.totalVP === 'number') ms.totalVP += opts.totalVP;
    if (typeof opts.vpDiff === 'number' && opts.vpDiff >= 10) ms.decisive++;
  }
}

// ── Agent-Specific Action Selection (Arena) ─────────────────────────────────

export function pickAgentAction(agent, allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  pickAgentAction._lastWgFeatures = null;
  pickAgentAction._lastWgType = null;
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pickRandom(mandatoryActions);
  if (mandatoryActions.length > 0) return pickRandom(mandatoryActions);

  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pickRandom(allActions);

  // Agent-specific epsilon
  const epsilon = agent.strategy.epsilon;
  if (Math.random() < epsilon) {
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: Q via dueling neural network + agent preferences
  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const network = learnings.network;
  if (!network) return heuristicPick(strategicActions, game);

  const { Q } = forwardPass(network, features);
  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const idx = ABSTRACT_TYPES.indexOf(absType);
    if (idx < 0) continue;
    const preference = agent.strategy.actionPreferences[absType] ?? 0;
    const effectiveQ = Q[idx] + preference;
    if (effectiveQ > bestQ) {
      bestQ = effectiveQ;
      bestType = absType;
    }
  }

  if (bestType === null) return heuristicPick(strategicActions, game);
  const wgResult = pickWithinGroup(groups[bestType], bestType, game,
    learnings.withinGroupWeights, dcHealthState, dcMessageMeta, learnings.meta.totalGames);
  pickAgentAction._lastWgFeatures = wgResult.wgFeatures;
  pickAgentAction._lastWgType = wgResult.wgType;
  return wgResult.action;
}

/**
 * Compute reward with agent-specific reward multipliers.
 */
export function computeAgentReward(before, after, isTerminal, didWin, rewardMultipliers) {
  const m = rewardMultipliers;
  const deltaVP = (after.myVP - before.myVP) - (after.oppVP - before.oppVP);
  const oppDmgBefore = before.oppHpMax - before.oppHpCurrent;
  const oppDmgAfter = after.oppHpMax - after.oppHpCurrent;
  const deltaEnemyDmg = oppDmgAfter - oppDmgBefore;
  const deltaMyHP = after.myHpCurrent - before.myHpCurrent;
  const deltaDist = before.avgDist - after.avgDist;

  const w = REWARD_WEIGHTS;
  let reward =
    w.vp * deltaVP * (m.vp ?? 1) +
    w.dmg * deltaEnemyDmg * (m.dmg ?? 1) +
    w.hp * deltaMyHP * (m.hp ?? 1) +
    w.dist * deltaDist * (m.dist ?? 1);

  if (isTerminal) {
    const terminalReward = didWin ? w.terminal : -w.terminal;
    reward += terminalReward * (m.terminal ?? 1);
  }
  return reward;
}

/**
 * Create a game tracer that uses agent-specific reward computation.
 */
export function createAgentTracer(learnings, playerNum, dcHealthState, dcMessageMeta, rewardMultipliers) {
  const trace = [];
  let lastSnapshot = null;
  let lastFeatures = null;

  return {
    beforeAction(game, playerActions) {
      // Fill in previous entry's nextActionIdxs from current available actions
      if (playerActions && trace.length > 0) {
        const prev = trace[trace.length - 1];
        if (prev.nextActionIdxs === null && !prev.done) {
          prev.nextActionIdxs = getAbstractTypeIdxs(playerActions, game);
        }
      }

      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastFeatures) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastFeatures = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeAgentReward(lastSnapshot, afterSnap, false, false, rewardMultipliers);
      const actionIdx = ABSTRACT_TYPES.indexOf(absType);
      const wgFeatures = pickAgentAction._lastWgFeatures || null;
      const wgType = pickAgentAction._lastWgType || null;
      trace.push({
        features: lastFeatures, actionIdx, reward, nextFeatures,
        nextActionIdxs: null, done: false,
        wgFeatures, wgType,
      });
      lastSnapshot = null;
      lastFeatures = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        const last = trace[trace.length - 1];
        const termReward = didWin
          ? REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1)
          : (didLose ? -REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1) : 0);
        last.reward += termReward;
        last.nextFeatures = null;
        last.nextActionIdxs = null;
        last.done = true;
      }
      updateTraceNeural(learnings, trace);
      if (updateMeta) {
        learnings.meta.totalGames++;
        if (game.ended && game.winnerId) {
          if (game.winnerId === game.player1Id) learnings.meta.p1Wins++;
          else learnings.meta.p2Wins++;
        }
      }
    },

    getTrace() { return trace; },
  };
}

// ── Training history ─────────────────────────────────────────────────────────

/**
 * Record a training checkpoint to the persistent training history.
 * Called every N games during training so we can detect plateaus.
 * @param {object} learnings
 * @param {object} checkpoint - { games, completed, total, p1Wins, p2Wins, avgVP, avgAbsDelta, epsilon }
 */
export function recordTrainingCheckpoint(learnings, checkpoint) {
  if (!learnings.meta.trainingHistory) learnings.meta.trainingHistory = [];
  const entry = {
    totalGames: learnings.meta.totalGames,
    completionRate: checkpoint.total > 0 ? checkpoint.completed / checkpoint.total : 0,
    completed: checkpoint.completed,
    total: checkpoint.total,
    p1Wins: checkpoint.p1Wins || 0,
    p2Wins: checkpoint.p2Wins || 0,
    avgVP: checkpoint.avgVP || 0,
    avgAbsDelta: checkpoint.avgAbsDelta || 0,
    epsilon: checkpoint.epsilon || 0,
    ts: Date.now(),
  };
  // Diversity pilot fields (only present when --mixed is active)
  if (checkpoint.poolGames != null) entry.poolGames = checkpoint.poolGames;
  if (checkpoint.fixedGames != null) entry.fixedGames = checkpoint.fixedGames;
  if (checkpoint.uniqueConfigs != null) entry.uniqueConfigs = checkpoint.uniqueConfigs;
  if (checkpoint.whitelistHits != null) entry.whitelistHits = checkpoint.whitelistHits;
  if (checkpoint.poolAvgVP != null) entry.poolAvgVP = checkpoint.poolAvgVP;
  if (checkpoint.fixedAvgVP != null) entry.fixedAvgVP = checkpoint.fixedAvgVP;
  if (checkpoint.poolCompletionRate != null) entry.poolCompletionRate = checkpoint.poolCompletionRate;
  learnings.meta.trainingHistory.push(entry);
  // Keep last 200 checkpoints (10,000 games at 50-game intervals)
  if (learnings.meta.trainingHistory.length > 200) {
    learnings.meta.trainingHistory.shift();
  }
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getLearningsStats(learnings) {
  const network = learnings.network;
  if (!network) {
    return {
      totalGames: learnings.meta.totalGames,
      p1Wins: learnings.meta.p1Wins,
      p2Wins: learnings.meta.p2Wins,
      weightCount: 0,
      avgAbsWeight: 0,
      weightRange: [0, 0],
      totalUpdates: 0,
      avgAbsDelta: 0,
      epsilon: getEpsilon(learnings.meta.totalGames),
    };
  }

  // Count all parameters
  let weightCount = 0;
  let totalAbsWeight = 0;
  let maxAbsWeight = 0;

  function accum(val) {
    const av = Math.abs(val);
    weightCount++;
    totalAbsWeight += av;
    if (av > maxAbsWeight) maxAbsWeight = av;
  }

  const nHidden = network.b1.length;
  const nActions = network.Wa.length;

  for (let j = 0; j < nHidden; j++) {
    for (let i = 0; i < network.W1[j].length; i++) accum(network.W1[j][i]);
    accum(network.b1[j]);
    accum(network.Wv[j]);
  }
  accum(network.bv);
  for (let k = 0; k < nActions; k++) {
    for (let j = 0; j < network.Wa[k].length; j++) accum(network.Wa[k][j]);
    accum(network.ba[k]);
  }

  // Feature importance: importance[i] = Σ_j |W1[j][i]| × (|Wv[j]| + Σ_k |Wa[k][j]|)
  const featureImportance = [];
  for (let i = 0; i < NUM_FEATURES; i++) {
    let importance = 0;
    for (let j = 0; j < nHidden; j++) {
      let outputMag = Math.abs(network.Wv[j]);
      for (let k = 0; k < nActions; k++) {
        outputMag += Math.abs(network.Wa[k][j]);
      }
      importance += Math.abs(network.W1[j][i]) * outputMag;
    }
    featureImportance.push(importance);
  }

  const ts = learnings.trainingStats || {};

  // If graph encoder is active, also report graph network stats
  let graphStats = null;
  if (ENCODER_TYPE === 'graph' && learnings.graphNetwork) {
    graphStats = getGraphNetworkStats(learnings.graphNetwork);
  }

  return {
    totalGames: learnings.meta.totalGames,
    p1Wins: learnings.meta.p1Wins,
    p2Wins: learnings.meta.p2Wins,
    weightCount: graphStats ? graphStats.weightCount : weightCount,
    avgAbsWeight: graphStats ? graphStats.avgAbsWeight : (weightCount > 0 ? totalAbsWeight / weightCount : 0),
    weightRange: [-maxAbsWeight, maxAbsWeight],
    totalUpdates: ts.totalUpdates || 0,
    avgAbsDelta: ts.avgAbsDelta || 0,
    epsilon: getEpsilon(learnings.meta.totalGames),
    nanResets: ts.nanResets || 0,
    lastTargetSync: ts.lastTargetSync || 0,
    targetSyncs: ts.targetSyncs || 0,
    featureImportance,
    replayBufferSize: learnings.replayBuffer ? learnings.replayBuffer.transitions.length : 0,
    replayTotalStored: learnings.replayBuffer ? learnings.replayBuffer.count : 0,
    withinGroupWeights: learnings.withinGroupWeights || null,
    encoderType: ENCODER_TYPE,
    graphStats,
  };
}

// ── Compatibility Wrappers ──────────────────────────────────────────────────

/** Compute Q for a single action type (wraps forwardPass). */
export function computeQ(network, actionType, features) {
  if (!network || !network.W1) return 0;
  const idx = ABSTRACT_TYPES.indexOf(actionType);
  if (idx < 0) return 0;
  return forwardPass(network, features).Q[idx];
}

/** Max Q across all action types (fallback). */
function getBestQ(network, features) {
  if (!network || !network.W1) return 0;
  const { Q } = forwardPass(network, features);
  return Math.max(...Q);
}

/** Full Q-value vector for evaluation/diagnostics. */
export function getFullQ(network, features) {
  if (!network?.W1) return null;
  return forwardPass(network, features);
}

// ── Divergence Monitor ───────────────────────────────────────────────────────
// Fixed probe states for tracking V(s) and Q calibration during training.
// These never change, so cross-checkpoint comparisons are apples-to-apples.

const PROBE_STATES = [
  // EARLY_GAME_COMBAT: R1, even, in combat               + Phase 2 active-DC: healthy melee figure, enemies far
  [0,0.9,0.9,0,0.5,0, 0.7,0.8,0.2,0.5,1,0, 0.5,1,0.3,0.2, 0.8,0.8, 0,0,0,0, 0.5,0.5,0.33,0.33, 0.2,0.2,0, 0,0,0,0, 1,0.75,0.75, 1.0,0.5,0.54,0.08,0.3,0,0,0.67,0,1],
  // MID_GAME_WINNING: R3, ahead, in combat                + Phase 2 active-DC: ranged figure, targets in range
  [0.25,0.8,0.5,0.3,0.57,0.14, 0.8,0.9,0.6,0.6,1,0, 0.7,1,0.4,0.3, 0.7,0.4, 0.25,0,0,0, 0.33,0.33,0.5,0.25, 0.5,0.33,0.1, 0,0.125,0,0, 1,0.5,0.75, 0.8,0.63,0.29,0.42,0.7,0,1,0.33,0,0.5],
  // LATE_GAME_LOSING: R4, behind, low HP, in combat       + Phase 2 active-DC: wounded, stunned, no actions left
  [-0.25,0.4,0.7,-0.3,0.43,-0.14, 0.9,0.9,0.8,0.4,1,0, 0.4,1,0.6,0.5, 0.3,0.7, 0,0.25,0.25,0, 0.17,0.5,0.25,0.5, 0.67,0.33,-0.2, 0.125,0,0,0, 0,0.9,0.5, 0.3,0.5,0.54,0.08,0.8,1,0,0.33,0.33,0],
];

/**
 * Check for training divergence. Returns { ok, signals } where ok=false means
 * training should stop. Thresholds are empirically justified:
 *   - V(s) should stay within ±200 (max undiscounted return ~160, γ=0.95 → ~3200 theoretical max;
 *     200 gives 16x headroom over empirical V(s) ~9 at 5565v2, while catching 58k-scale blowups)
 *   - Wv L2 norm should stay < 10 (was 0.59 at 5565v2; 10 gives 17x headroom)
 *   - avgAbsTD should stay < 50 (was ~3 at 5565v2; catches 8000-scale explosion early)
 */
export function checkDivergence(learnings) {
  const V_THRESHOLD = 200;
  const WV_NORM_THRESHOLD = 10;
  const TD_ERROR_THRESHOLD = 50;

  // Graph mode: simplified divergence check (no flat probe states)
  if (ENCODER_TYPE === 'graph' && learnings.graphNetwork) {
    const avgAbsTD = learnings.trainingStats?.avgAbsDelta || 0;
    const gStats = getGraphNetworkStats(learnings.graphNetwork);
    const reasons = [];
    if (avgAbsTD > TD_ERROR_THRESHOLD) reasons.push(`avgTD=${avgAbsTD.toFixed(1)} > ${TD_ERROR_THRESHOLD}`);
    if (gStats.avgAbsWeight > 5.0) reasons.push(`graph avg|w|=${gStats.avgAbsWeight.toFixed(3)} > 5.0`);
    return { ok: reasons.length === 0, reasons, signals: { avgAbsTD, graphAvgAbsW: gStats.avgAbsWeight } };
  }

  const net = learnings.network;
  if (!net) return { ok: true, signals: {} };

  // V(s) on probe states
  const vValues = PROBE_STATES.map(f => forwardPass(net, f).V);
  const maxAbsV = Math.max(...vValues.map(v => Math.abs(v)));

  // Wv L2 norm
  const wvNorm = Math.sqrt(net.Wv.reduce((s, w) => s + w * w, 0));

  // Key advantage head L2 norms
  const surgeDmgIdx = ABSTRACT_TYPES.indexOf('surge_damage');
  const skipIdx = ABSTRACT_TYPES.indexOf('skip_surges');
  const ccIdx = ABSTRACT_TYPES.indexOf('play_cc');
  const actIdx = ABSTRACT_TYPES.indexOf('activate');
  const endIdx = ABSTRACT_TYPES.indexOf('end_activation');

  function waNorm(idx) {
    if (idx < 0 || !net.Wa[idx]) return 0;
    return Math.sqrt(net.Wa[idx].reduce((s, w) => s + w * w, 0));
  }

  const headNorms = {
    surge_damage: waNorm(surgeDmgIdx),
    skip_surges: waNorm(skipIdx),
    play_cc: waNorm(ccIdx),
    activate: waNorm(actIdx),
    end_activation: waNorm(endIdx),
  };

  const avgAbsTD = learnings.trainingStats?.avgAbsDelta || 0;

  // Q calibration: on probe states, get Q[play_cc] vs Q[surge_damage] gap
  const ccVsSurge = PROBE_STATES.map(f => {
    const { Q } = forwardPass(net, f);
    return Q[ccIdx] - Q[surgeDmgIdx];
  });
  const maxCcSurgeGap = Math.max(...ccVsSurge);

  const signals = {
    maxAbsV: +maxAbsV.toFixed(2),
    vValues: vValues.map(v => +v.toFixed(2)),
    wvNorm: +wvNorm.toFixed(4),
    headNorms: Object.fromEntries(Object.entries(headNorms).map(([k, v]) => [k, +v.toFixed(4)])),
    avgAbsTD: +avgAbsTD.toFixed(4),
    ccVsSurgeGap: ccVsSurge.map(v => +v.toFixed(2)),
    maxCcSurgeGap: +maxCcSurgeGap.toFixed(2),
  };

  const reasons = [];
  if (maxAbsV > V_THRESHOLD) reasons.push(`|V(s)|=${maxAbsV.toFixed(1)} > ${V_THRESHOLD}`);
  if (wvNorm > WV_NORM_THRESHOLD) reasons.push(`||Wv||=${wvNorm.toFixed(2)} > ${WV_NORM_THRESHOLD}`);
  if (avgAbsTD > TD_ERROR_THRESHOLD) reasons.push(`avgTD=${avgAbsTD.toFixed(1)} > ${TD_ERROR_THRESHOLD}`);

  return {
    ok: reasons.length === 0,
    reasons,
    signals,
  };
}

/**
 * Get Q-values for a given feature vector. Used for diagnostics.
 * @param {object} learnings
 * @param {number[]} features
 * @returns {number[]|null} Q-values array, or null if no network
 */
export function getQValues(learnings, features) {
  if (ENCODER_TYPE === 'graph' && learnings.graphNetwork) {
    // In graph mode, features is a flat array from diagnostics — build a synthetic graph
    // For now, use graphForwardPass if a graph object is passed, otherwise fall through to flat
    if (features && typeof features === 'object' && features.nodes) {
      return graphForwardPass(learnings.graphNetwork, features).Q;
    }
    // Flat diagnostic features can't be used with graph encoder — return null
    return null;
  }
  if (!learnings.network) return null;
  return forwardPass(learnings.network, features).Q;
}

export { ABSTRACT_TYPES, FEATURE_NAMES, NUM_FEATURES, PASS_FEATURE_NAMES, oracleActivationPlan };
