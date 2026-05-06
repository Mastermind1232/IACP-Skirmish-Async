/**
 * AI-vs-AI Discord self-play: runs a full game through the real handler pipeline,
 * captures structured artifacts on failure, and persists them to Postgres.
 *
 * V1 scope: buttons only. No select menus, modals, or setup/deploy paths.
 * Starts from prepared round-1 scenarios.
 */

import { execSync } from 'child_process';
import { getAvailableActions } from '../engine/available-actions.js';
import { pickBestAction, getCheckpointVersion, getCheckpointFile, resetRuntimeStats, getRuntimeStats } from './strategy.js';
import { createLiveAiInteraction, AI_USER_PREFIX } from './ai-discord.js';
import { getHandlerKey } from '../router.js';
import { getHandler, getHandlerGroup } from '../handlers/index.js';
import { buildContext } from '../context-factory.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { withAtomicGameLock } from '../game/action-queue.js';
import { getRecoveryReason } from '../engine/recovery.js';
import { clearPendingNegation } from '../game/interrupts.js';
import { insertSelfPlayRun, batchIncrementCoverageDiscord, batchSetCoverageVerified } from '../db.js';
import { computeTransitionKey } from '../exploration/transition-key.js';
import { setPhase, PHASES, enableStrictPhaseTransitions } from '../game/phase.js';
import { TRAINING_WHITELIST_DCS, TRAINING_WHITELIST_CCS } from './training-config.js';
import { getValidKryknaPlacementSpaces } from '../game/mission-rules.js';

// ── Concurrency guard ─────────────────────────────────────────────────────────

let activeSelfPlayGameId = null;

export function getActiveSelfPlayGameId() {
  return activeSelfPlayGameId;
}

// ── Claimed-Krykna placement heuristic (Chopper Base A) ─────────────────────
// The authored mission rule is that claimed Krykna land in the opponent's
// deployment zone; the choice of WHERE within that zone is a headless
// implementation knob. Default 'min' picks the valid space with minimum
// BFS distance to the nearest enemy figure (aggressive — sustains the
// Krykna moat). 'max' picks the furthest space. 'random' picks uniformly
// at random over valid spaces. Exposed for Chopper placement ablation.
let KRYKNA_PLACEMENT_MODE = 'min';
export function setKryknaPlacementMode(mode) {
  if (mode === 'min' || mode === 'max' || mode === 'random') {
    KRYKNA_PLACEMENT_MODE = mode;
  }
}
export function getKryknaPlacementMode() { return KRYKNA_PLACEMENT_MODE; }

// ── Commit SHA (cached once) ──────────────────────────────────────────────────

let _commitSha = null;
function getCommitSha() {
  if (_commitSha === null) {
    try {
      _commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      _commitSha = 'unknown';
    }
  }
  return _commitSha;
}

// ── Action ring buffer ────────────────────────────────────────────────────────

class ActionRingBuffer {
  constructor(capacity = 50) {
    this._buf = [];
    this._cap = capacity;
  }
  push(entry) {
    this._buf.push(entry);
    if (this._buf.length > this._cap) this._buf.shift();
  }
  toArray() { return [...this._buf]; }
  get length() { return this._buf.length; }
  get last() { return this._buf[this._buf.length - 1] ?? null; }
}

// ── Turn ownership ────────────────────────────────────────────────────────────

/**
 * Determine which player(s) should act based on game state.
 * Returns 1, 2, or 'both' for dual-eligible states (phase gates, CC draw).
 */
function determineActingPlayer(game) {
  // Phase gates: both players may need to ready up
  if (game.phaseGate) return 'both';

  // CC draw: both may need to draw
  if (game.phase === 'cc_draw') return 'both';

  // End-of-round window — only relevant during end_of_round phase
  if (game.endOfRoundWhoseTurn && game.roundPhase === 'end_of_round') {
    return game.endOfRoundWhoseTurn === game.player1Id ? 1 : 2;
  }
  // Start-of-round window — only relevant during start_of_round phase
  if (game.startOfRoundWhoseTurn && game.roundPhase === 'start_of_round') {
    return game.startOfRoundWhoseTurn === game.player1Id ? 1 : 2;
  }

  // Pending combat — always check both players.
  // getCombatActions already filters by player for each sub-state (ready check,
  // attack/defense roll, reroll phase, surges, reactions like ThereIsNoTry, etc.).
  // Trying to mirror that logic here caused bugs where we returned the wrong player.
  if (game.pendingCombat) return 'both';

  // Current activation turn
  if (game.currentActivationTurnPlayerId) {
    return game.currentActivationTurnPlayerId === game.player1Id ? 1 : 2;
  }

  // Blocking pending sub-states — check whose turn it is
  if (game.pendingNegation) {
    // Negation goes to the OPPONENT of the player who played the CC
    const negPlayedBy = game.pendingNegation.playedBy;
    const negOpponent = negPlayedBy === 1 ? 2 : 1;
    return negOpponent;
  }
  // Comm Disruption prompt — opponent of the CC player must respond
  if (game.pendingCommDisruptionPrompt) {
    return game.pendingCommDisruptionPrompt.targetPlayerNum || 'both';
  }
  if (game.pendingCcConfirmation) {
    return game.pendingCcConfirmation.playerNum || 'both';
  }
  if (game.pendingCcChoice) {
    return game.pendingCcChoice.playerNum || 'both';
  }
  if (game.pendingCcSpaceChoice) {
    return game.pendingCcSpaceChoice.playerNum || 'both';
  }
  if (game.pendingStrainChoice && Object.keys(game.pendingStrainChoice).length > 0) {
    return game.pendingStrainChoice.playerNum || 'both';
  }
  if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) {
    // pendingDcAbilityChoice is keyed by msgId_specialIdx — extract first entry's playerNum
    const firstEntry = Object.values(game.pendingDcAbilityChoice)[0];
    return firstEntry?.playerNum || 'both';
  }
  if (game.pendingCoverFire) return game.pendingCoverFire.defenderPlayerNum || 'both';
  if (game.pendingPowerTokenOverflow?.length > 0) {
    const entry = game.pendingPowerTokenOverflow[0];
    return entry.playerNum || 'both';
  }
  if (game.pendingStillFaster) return 'both';
  if (game.pendingPowerTokenGrant) return game.pendingPowerTokenGrant.playerNum || 'both';
  if (game.pendingCelebration) return game.pendingCelebration.attackerPlayerNum || 'both';
  if (game.pendingRushPush) return game.pendingRushPush.playerNum || 'both';
  if (game.pendingLastResort) return game.pendingLastResort.defenderPlayerNum || 'both';
  if (game.pendingFalseOrders) return game.pendingFalseOrders.controllerPlayerNum || 'both';
  if (game.forceVisionPending) return 'both';

  // Post-combat abilities (after pendingCombat is deleted)
  if (game.pendingBoltslinger) return game.pendingBoltslinger.attackerPlayerNum || 'both';
  if (game.pendingIndiscriminateFire) return game.pendingIndiscriminateFire.attackerPlayerNum || 'both';
  if (game.pendingHeavyFire) return game.pendingHeavyFire.attackerPlayerNum || 'both';
  if (game.pendingHavocShot) return game.pendingHavocShot.attackerPlayerNum || 'both';
  if (game.pendingWantonDestruction) return game.pendingWantonDestruction.ownerPlayerNum || 'both';
  if (game.pendingDeflect) return game.pendingDeflect.defenderPlayerNum || game.pendingDeflect.attackerPlayerNum || 'both';
  if (game.pendingReaction) return game.pendingReaction.defenderPlayerNum || 'both';
  if (game.pendingMastery) return game.pendingMastery.attackerPlayerNum || 'both';
  if (game.pendingInterrogate) return game.pendingInterrogate.attackerPlayerNum || 'both';
  if (game.pendingFigurehead) return game.pendingFigurehead.defenderPlayerNum || 'both';
  if (game.pendingCleave) return game.pendingCleave.attackerPlayerNum || 'both';
  if (game.pendingFightingKnife) return game.pendingFightingKnife.attackerPlayerNum || 'both';
  if (game.pendingConcussiveBolt) return game.pendingConcussiveBolt.attackerPlayerNum || 'both';
  if (game.pendingExtraProtection) return 'both';
  if (game.pendingSelfDestruct) return game.pendingSelfDestruct.defenderPlayerNum || 'both';
  if (game.pendingExecutorInterrupt) return 'both';

  // Move in progress — keyed by moveKey, each entry has playerNum
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) {
    const firstEntry = Object.values(game.moveInProgress)[0];
    return firstEntry?.playerNum || 'both';
  }

  // Pending end-turn
  if (game.pendingEndTurn && Object.keys(game.pendingEndTurn).length > 0) {
    return game.currentActivationTurnPlayerId === game.player1Id ? 1 : 2;
  }

  // Setup attachment phase
  if (game.setupAttachmentPhase) return 'both';

  return 'both';
}

// ── Pending state snapshot ────────────────────────────────────────────────────

const PENDING_KEYS = [
  // Core phases
  'phaseGate', 'pendingCombat', 'moveInProgress', 'pendingEndTurn',
  'setupAttachmentPhase', 'endOfRoundWhoseTurn', 'startOfRoundWhoseTurn',
  'postDeployQueue',
  // CC / negation / disruption
  'pendingNegation', 'pendingCommDisruptionPrompt',
  'pendingCcConfirmation', 'pendingCcChoice', 'pendingCcSpaceChoice',
  'pendingIllegalCcPlay',
  // Combat sub-states
  'pendingCoverFire', 'pendingPowerTokenOverflow', 'pendingStrainChoice', 'pendingStillFaster',
  'pendingStrikeMeDown', 'pendingSlowOnTheDraw', 'pendingForceExhaustion',
  'pendingIllicitArms', 'pendingPowerConverter', 'pendingThereIsNoTry',
  'pendingToughLuck', 'pendingHunterProtocol',
  // Ability / activation sub-states
  'pendingPowerTokenGrant', 'pendingCelebration', 'pendingDcAbilityChoice',
  'pendingRushPush', 'pendingLastResort', 'pendingFalseOrders',
  'forceVisionPending', 'pendingBleeding', 'pendingSpreadThePainCondPick',
  'pendingPounceSpaceChoice', 'pendingMissileSalvo', 'pendingShoulderRush',
  // Weapon choice
  'pendingEe3Carbine', 'pendingBoRifle', 'pendingOverrideAttackDice',
  // Placement sub-states
  'pendingOverwatchPlacement', 'pendingBombDrop', 'pendingOrbitalBombardment',
  // Post-combat abilities (set during finishCombatResolution after pendingCombat is deleted)
  'pendingBoltslinger', 'pendingIndiscriminateFire', 'pendingHeavyFire',
  'pendingHavocShot', 'pendingWantonDestruction', 'pendingDeflect',
  'pendingReaction', 'pendingMastery', 'pendingInterrogate',
  // Pre-resolution combat abilities (set while pendingCombat still exists)
  'pendingFigurehead', 'pendingCleave', 'pendingFightingKnife',
  'pendingConcussiveBolt', 'pendingAssassinsBlade', 'pendingExtraProtection',
  'pendingSelfDestruct', 'pendingExecutorInterrupt', 'pendingPunishingStrike',
  'pendingSuppressiveFireMp',
];

function capturePendingStates(game) {
  const out = {};
  for (const k of PENDING_KEYS) {
    if (game[k] != null && game[k] !== false) {
      out[k] = typeof game[k] === 'object' ? JSON.parse(JSON.stringify(game[k])) : game[k];
    }
  }
  return out;
}

// ── Figure count snapshot (for defeat detection) ─────────────────────────────

function countAliveFigures(game, dcHealthState) {
  let count = 0;
  for (const pn of [1, 2]) {
    const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
    if (!dcList) continue;
    for (const dc of dcList) {
      const msgId = dc?.msgId;
      if (!msgId) continue;
      const healthArr = dcHealthState?.get(msgId);
      if (!healthArr) continue;
      for (const figHp of healthArr) {
        if (Array.isArray(figHp) && figHp[0] > 0) count++;
      }
    }
  }
  return count;
}

// ── Training whitelist validation ────────────────────────────────────────────

/**
 * Validate that the entire reachable card pool is within the training whitelist.
 * Checks all DC and CC zones for both players plus the shared gameBox.
 * Returns { valid: true } or { valid: false, violations: [...] }.
 */
export function validateTrainingWhitelist(game) {
  const violations = [];

  // Check DCs for both players
  for (const pn of [1, 2]) {
    const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
    if (dcList) {
      for (const dc of dcList) {
        if (dc?.dcName && !TRAINING_WHITELIST_DCS.has(dc.dcName)) {
          violations.push({ zone: `p${pn}DcList`, card: dc.dcName });
        }
      }
    }
  }

  // Check all CC zones for both players
  for (const pn of [1, 2]) {
    const hand = pn === 1 ? game.player1CcHand : game.player2CcHand;
    const deck = pn === 1 ? game.player1CcDeck : game.player2CcDeck;
    const discard = pn === 1 ? game.player1CcDiscard : game.player2CcDiscard;
    const attachments = pn === 1 ? game.p1CcAttachments : game.p2CcAttachments;

    for (const cc of (hand || [])) {
      if (!TRAINING_WHITELIST_CCS.has(cc)) violations.push({ zone: `player${pn}CcHand`, card: cc });
    }
    for (const cc of (deck || [])) {
      if (!TRAINING_WHITELIST_CCS.has(cc)) violations.push({ zone: `player${pn}CcDeck`, card: cc });
    }
    for (const cc of (discard || [])) {
      if (!TRAINING_WHITELIST_CCS.has(cc)) violations.push({ zone: `player${pn}CcDiscard`, card: cc });
    }
    if (attachments && typeof attachments === 'object') {
      for (const ccs of Object.values(attachments)) {
        for (const cc of (ccs || [])) {
          if (!TRAINING_WHITELIST_CCS.has(cc)) violations.push({ zone: `p${pn}CcAttachments`, card: cc });
        }
      }
    }
  }

  // Shared gameBox (cards permanently removed from game)
  for (const cc of (game.gameBox || [])) {
    if (!TRAINING_WHITELIST_CCS.has(cc)) violations.push({ zone: 'gameBox', card: cc });
  }

  return violations.length === 0
    ? { valid: true }
    : { valid: false, violations };
}

// ── Stop reason classification ────────────────────────────────────────────────

/** Bug stop reasons (real problems to fix). */
const BUG_STOPS = new Set([
  'handler_crash', 'discord_api_failure', 'stuck_no_actions',
  'action_loop', 'invariant_violation', 'unroutable_action',
]);

/** Limit stop reasons (known V1 capability bounds). */
const LIMIT_STOPS = new Set([
  'unsupported_interaction_type', 'manual_stop', 'round_limit',
]);

/** Max rounds before force-ending a selfplay game. Real IA games are 4-6 rounds. */
const MAX_ROUNDS = 7;

// ── Artifact builder ──────────────────────────────────────────────────────────

function buildRunArtifact(game, { scenario, guildId, startedAt, ringBuffer, stopReason, error, surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound }) {
  const now = new Date();
  const result = BUG_STOPS.has(stopReason) ? 'failed'
    : stopReason === 'completed' ? 'completed'
    : 'stopped';

  // Derive winner from VP (.total because playerNVP is {total, kills, objectives})
  const p1vp = game?.player1VP?.total ?? 0;
  const p2vp = game?.player2VP?.total ?? 0;
  const winner = stopReason !== 'completed' ? null
    : p1vp > p2vp ? 'player1'
    : p2vp > p1vp ? 'player2'
    : 'draw';

  // Convert actionTypeCounts Map to plain object
  const actionTypeCounts = traceData?.actionTypeCounts
    ? Object.fromEntries(traceData.actionTypeCounts)
    : {};

  // End-condition telemetry: figure counts per player at game end
  const p1FiguresRemaining = Object.keys(game?.figurePositions?.[1] || {}).length;
  const p2FiguresRemaining = Object.keys(game?.figurePositions?.[2] || {}).length;

  // game_end_reason: the reason from checkWinConditions/postGameOver (e.g. "elimination", "40 VP")
  // For non-completed stops, derive from stopReason directly
  const gameEndReason = stopReason === 'completed'
    ? (game?.gameEndReason ?? (p1FiguresRemaining === 0 || p2FiguresRemaining === 0 ? 'elimination (inferred)' : 'unknown'))
    : stopReason;

  return {
    game_id: game?.gameId ?? 'unknown',
    guild_id: guildId ?? null,
    scenario: scenario ?? null,
    result,
    stop_reason: stopReason,
    commit_sha: getCommitSha(),
    checkpoint_games: getCheckpointVersion(),
    checkpoint_file: getCheckpointFile(),
    map: game?.selectedMap?.id ?? null,
    p1_squad: game?.player1Squad ?? null,
    p2_squad: game?.player2Squad ?? null,
    phase: game?.phase ?? null,
    round_phase: game?.roundPhase ?? null,
    current_round: game?.currentRound ?? null,
    active_player: game?.currentActivationTurnPlayerId ?? null,
    total_steps: totalActionsDispatched ?? ringBuffer.length,
    last_action: ringBuffer.last?.customId ?? null,
    recent_actions: ringBuffer.toArray(),
    pending_states: game ? capturePendingStates(game) : {},
    recovery_reason: game ? getRecoveryReason(game) : null,
    error_message: error?.message ?? null,
    error_stack: error?.stack?.slice(0, 2000) ?? null,
    handler_key: surfaceCtx?.handlerKey ?? null,
    intended_surface: surfaceCtx?.intendedSurface ?? null,
    actual_channel: surfaceCtx?.actualChannel ?? null,
    discord_op: surfaceCtx?.discordOp ?? null,
    discord_error: surfaceCtx?.discordError ?? null,
    started_at: startedAt,
    failed_at: now,
    duration_ms: now - startedAt,
    recovery_fired: false,
    recovery_count: 0,
    exploration_mode: explorationMode ?? null,
    // Coverage data
    winner,
    p1_vp: p1vp,
    p2_vp: p2vp,
    vp_per_round: vpPerRound ?? [],
    total_rounds: game?.currentRound ?? null,
    figure_defeats: figureDefeats ?? 0,
    action_type_counts: actionTypeCounts,
    exercised_handlers: traceData?.exercisedHandlers ? [...traceData.exercisedHandlers] : [],
    seen_action_types: Object.keys(actionTypeCounts),
    triggered_pending_states: traceData?.triggeredPendingStates ? [...traceData.triggeredPendingStates] : [],
    transitions_hit: traceData?.transitionsHit ? [...new Set(traceData.transitionsHit)] : [],
    // Per-game strategy runtime stats (graph vs flat, heuristic)
    runtime_stats: getRuntimeStats(),
    // End-condition telemetry
    game_end_reason: gameEndReason,
    p1_figures_remaining: p1FiguresRemaining,
    p2_figures_remaining: p2FiguresRemaining,
  };
}

// ── Manual kill diagnostic ────────────────────────────────────────────────────

/**
 * Capture a diagnostic snapshot before manually killing a game.
 * Lightweight version of buildRunArtifact for non-selfplay kill paths.
 */
export async function captureManualKillDiagnostic(game, gameId) {
  const pendingStates = capturePendingStates(game);
  const artifact = {
    game_id: gameId,
    guild_id: game.guildId ?? null,
    scenario: null,
    result: 'stopped',
    stop_reason: 'manual_kill',
    commit_sha: getCommitSha(),
    phase: game.phase ?? null,
    round_phase: game.roundPhase ?? null,
    current_round: game.currentRound ?? null,
    pending_states: pendingStates,
    recovery_reason: getRecoveryReason(game),
    p1_vp: game.player1VP?.total ?? 0,
    p2_vp: game.player2VP?.total ?? 0,
    failed_at: new Date(),
  };
  await insertSelfPlayRun(artifact);
  return artifact;
}

// ── Structured coverage summary ───────────────────────────────────────────────

/**
 * Format a human-readable coverage summary for a completed self-play run.
 * Suitable for console output and Discord bot-logs posting.
 */
export function formatCoverageSummary(artifact, runNum) {
  const atc = artifact.action_type_counts || {};
  const durSec = ((artifact.duration_ms || 0) / 1000).toFixed(1);
  const vpLine = artifact.winner
    ? `Winner: ${artifact.winner} | VP: ${artifact.p1_vp}-${artifact.p2_vp}`
    : `Result: ${artifact.result} (${artifact.stop_reason})`;

  // Squad labels
  const p1Label = artifact.p1_squad?.name || 'P1';
  const p2Label = artifact.p2_squad?.name || 'P2';

  // Key combat counters
  const attacks = atc.attack_target || 0;
  const surgeSpends = atc.combat_surge || 0;
  const surgeSkips = atc.combat_skip_surges || 0;
  const combatResolutions = atc.combat_resolve || 0;
  const ccPlays = atc.play_cc || 0;
  const dcSpecials = atc.dc_special || 0;
  const strainChoices = (artifact.triggered_pending_states || []).includes('pendingStrainChoice') ? 'yes' : 'no';

  // Top action types (sorted by count descending)
  const sortedActions = Object.entries(atc).sort((a, b) => b[1] - a[1]);
  const actionLines = sortedActions.map(([type, count]) => `  ${type}: ${count}`).join('\n');

  const rs = artifact.runtime_stats || {};
  const header = runNum != null ? `SMOKE RUN #${runNum}` : `SELF-PLAY RUN`;
  return [
    `══ ${header} ${'═'.repeat(Math.max(0, 50 - header.length))}`,
    `Game:       ${artifact.game_id}`,
    `Seed:       ${p1Label} vs ${p2Label}@${artifact.map || '?'}`,
    `Checkpoint: ${artifact.checkpoint_file ?? '?'} (${artifact.checkpoint_games ?? '?'} games) | commit: ${artifact.commit_sha ?? '?'}`,
    `Result:     ${artifact.result} (${artifact.total_rounds ?? '?'} rounds, ${artifact.total_steps} steps, ${durSec}s)`,
    vpLine,
    ``,
    `── Action Counts ──────────────────────────────`,
    actionLines || '  (none)',
    ``,
    `── Combat Events ──────────────────────────────`,
    `  Attacks declared:   ${attacks}`,
    `  Combat resolutions: ${combatResolutions}`,
    `  Surge spends:       ${surgeSpends}`,
    `  Surge skips:        ${surgeSkips}`,
    `  Figure defeats:     ${artifact.figure_defeats ?? 0}`,
    `  Strain choices:     ${strainChoices}`,
    `  CC plays:           ${ccPlays}`,
    `  DC specials:        ${dcSpecials}`,
    ``,
    `── VP per Round ───────────────────────────────`,
    ...(() => {
      const rounds = artifact.vp_per_round || [];
      if (rounds.length === 0) return ['  (no round transitions recorded)'];
      const lines = [];
      let prevP1 = 0, prevP2 = 0;
      let zeroGainRounds = 0;
      for (const r of rounds) {
        const d1 = r.p1 - prevP1, d2 = r.p2 - prevP2;
        const totalGain = d1 + d2;
        const flag = totalGain === 0 ? (++zeroGainRounds >= 2 ? ' 🔴' : ' 🟡') : (zeroGainRounds = 0, '');
        lines.push(`  Round ${r.round}: P1=${r.p1} (+${d1})  P2=${r.p2} (+${d2})${flag}`);
        prevP1 = r.p1; prevP2 = r.p2;
      }
      // Final round (game-end VP vs last snapshot)
      const fd1 = (artifact.p1_vp ?? 0) - prevP1, fd2 = (artifact.p2_vp ?? 0) - prevP2;
      const fTotal = fd1 + fd2;
      const fFlag = fTotal === 0 ? (++zeroGainRounds >= 2 ? ' 🔴' : ' 🟡') : '';
      lines.push(`  Final:   P1=${artifact.p1_vp ?? 0} (+${fd1})  P2=${artifact.p2_vp ?? 0} (+${fd2})${fFlag}`);
      return lines;
    })(),
    ``,
    `── Strategy ───────────────────────────────────`,
    `  Encoder:            ${rs.encoder ?? 'unknown'}`,
    `  Graph decisions:    ${rs.graphDecisions ?? 0}`,
    `  Flat decisions:     ${rs.flatDecisions ?? 0}`,
    `  Single-action skips:${rs.singleActionSkips ?? 0}`,
    `  Heuristic calls:    ${rs.heuristicCalls ?? 0}`,
    `  Heuristic overrides:${rs.heuristicOverrides ?? 0} (${rs.heuristicOverridesAttackLegal ?? 0} attack-legal)`,
    `  Move-only skipped:  ${rs.heuristicOverridesMoveOnly ?? 0} (old heuristic would have forced move)`,
    `  end_act suppressed: ${rs.endActSuppressed ?? 0}`,
    ``,
    `── Shadow Eval: Idle Suppression ───────────────`,
    `  Idle sup fired:     ${rs.idleSupFired ?? 0}`,
    `  Forced single:      ${rs.idleSupForcedSingle ?? 0} (suppression left only 1 action)`,
    `  Graph would idle:   ${rs.idleSupGraphWouldIdle ?? 0}`,
    `  Graph would attack: ${rs.idleSupGraphWouldAttack ?? 0}`,
    `  Graph would move:   ${rs.idleSupGraphWouldMove ?? 0}`,
    `  Graph would dcSpec: ${rs.idleSupGraphWouldDcSpecial ?? 0}`,
    `  Graph would interact:${rs.idleSupGraphWouldInteract ?? 0}`,
    `  Graph would playCc: ${rs.idleSupGraphWouldPlayCc ?? 0}`,
    `  Graph would other:  ${rs.idleSupGraphWouldOther ?? 0}`,
    `  Context: w/attack=${rs.idleSupWithAttack ?? 0} w/dcSpec=${rs.idleSupWithDcSpecial ?? 0} w/move=${rs.idleSupWithMove ?? 0} w/interact=${rs.idleSupWithInteract ?? 0} w/cc=${rs.idleSupWithPlayCc ?? 0}`,
    ``,
    `── Shadow Eval: Attack Node ────────────────────`,
    `  Attack-legal states: ${rs.activationEntryWithAttack ?? 0}`,
    `  Graph would attack:  ${rs.graphWouldAttack ?? 0}`,
    `  Graph would NOT atk: ${rs.graphWouldNotAttack ?? 0}`,
    ``,
    `── Coverage ───────────────────────────────────`,
    `  Handlers exercised: ${artifact.exercised_handlers?.length ?? 0}`,
    `  Action types seen:  ${artifact.seen_action_types?.length ?? 0}`,
    `  Pending states hit: [${(artifact.triggered_pending_states || []).join(', ')}]`,
    `  Unique transitions: ${artifact.transitions_hit?.length ?? 0}`,
    artifact.error_message ? [
      ``,
      `── Error ──────────────────────────────────────`,
      `  ${artifact.error_message}`,
      artifact.handler_key ? `  Handler: ${artifact.handler_key}` : null,
      artifact.discord_op ? `  CustomId: ${artifact.discord_op}` : null,
      artifact.error_stack ? `  Stack: ${artifact.error_stack.split('\n').slice(1, 4).map(l => l.trim()).join(' → ')}` : null,
    ].filter(Boolean).join('\n') : '',
    `${'═'.repeat(52)}`,
  ].filter(Boolean).join('\n');
}

// ── Main self-play loop ───────────────────────────────────────────────────────

/**
 * Run an AI-vs-AI self-play game through the real Discord handler pipeline.
 *
 * @param {object} game - Game state (must already be in round 1+)
 * @param {object} client - Discord client
 * @param {object} opts
 * @param {function} opts.buildAllDeps - Dependency builder
 * @param {function} opts.getGame - Game state accessor
 * @param {object}  opts.atomicOpts - For withAtomicGameLock
 * @param {object}  opts.actionDeps - Deps for getAvailableActions (dcMessageMeta, dcExhaustedState, etc.)
 * @param {string}  [opts.scenario] - Scenario name for artifact
 * @param {string}  [opts.guildId] - Guild ID for artifact
 * @param {number}  [opts.delayMs=200] - Delay between actions (ms)
 * @param {boolean} [opts.persistCompleted=false] - Also persist completed runs to DB
 * @returns {Promise<{ result: string, artifact: object }>}
 */

// ── Coverage correctness verification (game-end assertions) ─────────────────
// Three checks, each with explicit proof-level semantics:
//   1. end_condition: game-end state assertion (verified_by: selfplay:game_end_assert)
//   2. vp_source: partial VP accounting check (verified_by: selfplay:vp_accounting)
//      Only kill_vp and objective_vp — celebration, mission, nefarious_gains NOT yet verified
//   3. pending_state: orphan check only (verified_by: selfplay:orphan_check)
//      Proves the state was not orphaned at game end, NOT full semantic correctness

function verifyCoverageCorrectness(finalGame, coverageHits) {
  const results = new Map(); // item_id → { verified: boolean, verified_by: string }
  if (!finalGame) return results;

  // ── end_condition: game-end state assertions ──

  if (coverageHits.has('end_condition:vp_40')) {
    const p1vp = finalGame.player1VP?.total ?? 0;
    const p2vp = finalGame.player2VP?.total ?? 0;
    const pass = Math.max(p1vp, p2vp) >= 40;
    results.set('end_condition:vp_40', { verified: pass, verified_by: 'selfplay:game_end_assert' });
    if (!pass) console.warn(`[coverage-verify] FAIL end_condition:vp_40 — max VP=${Math.max(p1vp, p2vp)}`);
  }

  if (coverageHits.has('end_condition:elimination')) {
    // Authoritative predicate from win-conditions.js: figurePositions[pn] is empty
    const p1figs = Object.keys(finalGame.figurePositions?.[1] || {}).length;
    const p2figs = Object.keys(finalGame.figurePositions?.[2] || {}).length;
    const pass = p1figs === 0 || p2figs === 0;
    results.set('end_condition:elimination', { verified: pass, verified_by: 'selfplay:game_end_assert' });
    if (!pass) console.warn(`[coverage-verify] FAIL end_condition:elimination — p1figs=${p1figs}, p2figs=${p2figs}`);
  }

  if (coverageHits.has('end_condition:round_limit')) {
    const pass = (finalGame.currentRound ?? 0) > MAX_ROUNDS;
    results.set('end_condition:round_limit', { verified: pass, verified_by: 'selfplay:game_end_assert' });
    if (!pass) console.warn(`[coverage-verify] FAIL end_condition:round_limit — round=${finalGame.currentRound}, MAX=${MAX_ROUNDS}`);
  }

  if (coverageHits.has('end_condition:draw')) {
    const p1vp = finalGame.player1VP?.total ?? 0;
    const p2vp = finalGame.player2VP?.total ?? 0;
    const pass = p1vp === p2vp;
    results.set('end_condition:draw', { verified: pass, verified_by: 'selfplay:game_end_assert' });
    if (!pass) console.warn(`[coverage-verify] FAIL end_condition:draw — p1=${p1vp}, p2=${p2vp}`);
  }

  if (coverageHits.has('end_condition:forfeit')) {
    // Forfeit is triggered by explicit user action; if tracked, the action happened
    results.set('end_condition:forfeit', { verified: true, verified_by: 'selfplay:game_end_assert' });
  }

  // ── vp_source: partial VP accounting (kill_vp + objective_vp only) ──
  // Assertion: total == kills + objectives for both players

  const p1vp = finalGame.player1VP || {};
  const p2vp = finalGame.player2VP || {};
  const p1ok = (p1vp.total ?? 0) === (p1vp.kills ?? 0) + (p1vp.objectives ?? 0);
  const p2ok = (p2vp.total ?? 0) === (p2vp.kills ?? 0) + (p2vp.objectives ?? 0);
  const accountingOk = p1ok && p2ok;

  if (!accountingOk) {
    console.warn(`[coverage-verify] FAIL vp_accounting — P1: total=${p1vp.total} kills=${p1vp.kills} obj=${p1vp.objectives}, P2: total=${p2vp.total} kills=${p2vp.kills} obj=${p2vp.objectives}`);
  }

  if (coverageHits.has('vp_source:kill_vp')) {
    const hasKills = (p1vp.kills ?? 0) > 0 || (p2vp.kills ?? 0) > 0;
    results.set('vp_source:kill_vp', { verified: accountingOk && hasKills, verified_by: 'selfplay:vp_accounting' });
  }

  if (coverageHits.has('vp_source:objective_vp')) {
    const hasObj = (p1vp.objectives ?? 0) > 0 || (p2vp.objectives ?? 0) > 0;
    results.set('vp_source:objective_vp', { verified: accountingOk && hasObj, verified_by: 'selfplay:vp_accounting' });
  }

  // Note: celebration_vp, mission_vp, nefarious_gains NOT verified in this wave

  // ── pending_state: orphan check ──
  // Proves the state was entered and NOT orphaned at game end.
  // This is a narrower signal than full semantic correctness.

  for (const k of PENDING_KEYS) {
    const itemId = `pending_state:${k}`;
    if (!coverageHits.has(itemId)) continue;
    const isOrphaned = finalGame[k] != null && finalGame[k] !== false;
    results.set(itemId, { verified: !isOrphaned, verified_by: 'selfplay:orphan_check' });
    if (isOrphaned) {
      const val = typeof finalGame[k] === 'object' ? JSON.stringify(finalGame[k]).slice(0, 120) : finalGame[k];
      console.warn(`[coverage-verify] FAIL ${itemId} — orphaned at game end: ${val}`);
    }
  }

  return results;
}

export async function runSelfPlayLoop(game, client, opts) {
  const {
    buildAllDeps, getGame, atomicOpts, actionDeps = {},
    scenario, guildId, delayMs = 200,
    persistCompleted = false, explorationMode, trainingMode = false,
  } = opts;
  const { dcHealthState } = actionDeps;

  // Concurrency guard
  if (activeSelfPlayGameId) {
    throw new Error(`Self-play already active for game ${activeSelfPlayGameId}`);
  }
  activeSelfPlayGameId = game.gameId;

  const startedAt = new Date();
  const ringBuffer = new ActionRingBuffer(50);
  let surfaceCtx = {};
  let consecutiveEmpty = 0;
  let totalActionsDispatched = 0;
  let lastCustomIds = [];
  let loopRecoveries = 0;

  // Stale-action safety net: if the same action is picked twice consecutively without
  // changing game state, the handler likely rejected it (stun, boxed in, etc.).
  // Ban it until the phase changes to prevent infinite loops.
  const bannedStaleActions = new Set();

  // Max loop recoveries before killing the game — prevents infinite recovery cycles
  const MAX_LOOP_RECOVERIES = 10;

  // Phase-advancing action types used by the stuck escape hatch
  const ESCAPE_ACTION_TYPES = new Set([
    'dc_end_activation', 'pass_activation_turn', 'end_activation_phase', 'end_end_of_round',
  ]);

  // CC retry-loop prevention: track cards that hit the "illegal/manual" handler path.
  // Keyed by "cardName|roundPhase|activatingDcIndex" so the same card can be retried
  // in a different phase or activation context.
  const suppressedCcPlays = new Set();
  let lastRoundPhase = null;

  // Execution trace (Phase 1 queue runner)
  const exercisedHandlers = new Set();
  const actionTypeCounts = new Map();  // type → count (replaces Set for richer coverage data)
  const triggeredPendingStates = new Set();
  const transitionsHit = [];
  let figureDefeats = 0;
  const vpPerRound = [];          // [{round, p1, p2}, ...] — snapshot at each round transition
  let lastTrackedRound = game.currentRound ?? 1;
  const traceData = { exercisedHandlers, actionTypeCounts, triggeredPendingStates, transitionsHit };

  // Coverage ledger accumulator — batched to DB at game end
  const coverageHits = new Map();
  function trackCoverage(itemId) {
    coverageHits.set(itemId, (coverageHits.get(itemId) || 0) + 1);
  }
  let coverageDcSeeded = false;  // track DCs once after setup completes
  let lastP1VP = { kills: 0, objectives: 0 };
  let lastP2VP = { kills: 0, objectives: 0 };
  let finalGameState = null;  // captured at game end for correctness verification

  // Reset per-game strategy counters (graph vs flat, heuristic overrides)
  resetRuntimeStats();

  // Mark game as self-play (both players are AI)
  game.selfPlay = true;
  game.player1Id = `${AI_USER_PREFIX}1`;
  game.player2Id = `${AI_USER_PREFIX}2`;

  // Training mode: enable strict phase transitions for the entire process.
  // Only rejects genuinely invalid transitions (which are bugs), so safe even if
  // Discord games share the process — they make valid transitions.
  if (trainingMode) {
    enableStrictPhaseTransitions();
  }

  // Training mode whitelist validation: abort before generating any training data
  // if the card pool contains anything outside the verified whitelist.
  if (trainingMode) {
    const wlResult = validateTrainingWhitelist(game);
    if (!wlResult.valid) {
      const violationSummary = wlResult.violations.map(v => `${v.zone}: "${v.card}"`).join(', ');
      console.error(`[self-play] WHITELIST VIOLATION — aborting training game: ${violationSummary}`);
      activeSelfPlayGameId = null;
      const artifact = buildRunArtifact(game, { scenario, guildId, startedAt, ringBuffer, stopReason: 'whitelist_violation', surfaceCtx: { violationSummary }, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
      await insertSelfPlayRun(artifact);
      return { result: 'blocked', artifact };
    }
  }

  // Test flag: route overflow through PvP prompt path (set via selfplaymcp seed --test-overflow)
  let testOverflowInjected = false;

  try {
    for (let step = 0; ; step++) {
      const g = getGame(game.gameId);

      // Test: inject 2 power tokens on all figures once deployed (forces overflow on surge token grants)
      if (g?.testPvpOverflowPath && !testOverflowInjected && g.figurePositions) {
        const allFigs = [...Object.keys(g.figurePositions[1] || {}), ...Object.keys(g.figurePositions[2] || {})];
        if (allFigs.length > 0) {
          g.figurePowerTokens = g.figurePowerTokens || {};
          for (const fk of allFigs) g.figurePowerTokens[fk] = ['Block', 'Evade'];
          testOverflowInjected = true;
          console.log(`[self-play] TEST: Injected 2 power tokens on ${allFigs.length} figures to force overflow path`);
        }
      }
      if (!g || g.ended) {
        // Capture final-round VP snapshot (round transitions only fire mid-game)
        const finalGame = g || game;
        vpPerRound.push({
          round: finalGame?.currentRound ?? lastTrackedRound,
          p1: finalGame?.player1VP?.total ?? 0,
          p2: finalGame?.player2VP?.total ?? 0,
          final: true,
        });
        const wasManualStop = g?.selfPlayManualStop;
        const stopReason = wasManualStop ? 'manual_stop' : 'completed';
        finalGameState = finalGame;
        // Coverage: end condition
        if (finalGame) {
          const p1vp = finalGame.player1VP?.total ?? 0;
          const p2vp = finalGame.player2VP?.total ?? 0;
          if (p1vp >= 40 || p2vp >= 40) trackCoverage('end_condition:vp_40');
          else if (wasManualStop) { /* no end_condition for manual stop */ }
          else trackCoverage('end_condition:elimination');
        }
        const artifact = buildRunArtifact(finalGame, { scenario, guildId, startedAt, ringBuffer, stopReason, surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
        if (wasManualStop) await insertSelfPlayRun(artifact);
        else if (persistCompleted) await insertSelfPlayRun(artifact);
        return { result: wasManualStop ? 'stopped' : 'completed', artifact };
      }

      // Round limit — prevent infinite games when AI never scores VP
      if ((g.currentRound ?? 1) > MAX_ROUNDS) {
        console.warn(`[self-play] Round limit reached (round ${g.currentRound} > ${MAX_ROUNDS})`);
        finalGameState = g;
        // Capture VP snapshot at round-limit termination
        vpPerRound.push({
          round: g.currentRound ?? lastTrackedRound,
          p1: g.player1VP?.total ?? 0,
          p2: g.player2VP?.total ?? 0,
          final: true,
        });
        trackCoverage('end_condition:round_limit');
        const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'round_limit', surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
        await insertSelfPlayRun(artifact);
        return { result: 'stopped', artifact };
      }

      // Clear CC suppression when game phase changes (card may become legal in new context)
      const curPhase = `${g.roundPhase || '?'}|${g.currentActivatingDcIndex ?? 'x'}`;
      if (curPhase !== lastRoundPhase) {
        if (suppressedCcPlays.size > 0) {
          console.log(`[self-play] CC suppression cleared (phase ${lastRoundPhase} → ${curPhase}), was: ${[...suppressedCcPlays].join(', ')}`);
        }
        suppressedCcPlays.clear();
        bannedStaleActions.clear();
        lastRoundPhase = curPhase;
      }

      // Auto-resolve start-of-round window (both players just acknowledge — no decision)
      if (g.startOfRoundWhoseTurn && g.roundPhase === 'start_of_round') {
        const sorCustomId = `end_start_of_round_${g.gameId}`;
        const sorHandlerKey = getHandlerKey(sorCustomId, 'button');
        const sorHandler = sorHandlerKey ? getHandler(sorHandlerKey) : null;
        if (sorHandler) {
          try {
            console.log(`[self-play] Resolving start-of-round window (round ${g.currentRound})`);
            while (g.startOfRoundWhoseTurn) {
              const userId = g.startOfRoundWhoseTurn;
              const sorInteraction = createLiveAiInteraction(sorCustomId, userId, g, client);
              sorInteraction.client = client;
              if (g.generalId) {
                try { sorInteraction.channel = await fetchGameChannel(client, g.generalId); sorInteraction.message.channel = sorInteraction.channel; } catch {}
              }
              const sorGroup = getHandlerGroup(sorHandlerKey);
              if (sorGroup) {
                await sorHandler(sorInteraction, buildContext(sorGroup, buildAllDeps()));
              } else {
                await sorHandler(sorInteraction);
              }
              totalActionsDispatched++;
              ringBuffer.push({ step: totalActionsDispatched, type: 'end_start_of_round', customId: sorCustomId, playerNum: userId === g.player1Id ? 1 : 2, handlerKey: sorHandlerKey, ts: Date.now() });
            }
          } catch (err) {
            console.error(`[self-play] SOR handler crash (round ${g.currentRound}): ${err.message}`, err.stack?.split('\n').slice(0, 3).join('\n'));
          }
        }
        continue;
      }

      // Auto-resolve phase gates (both players are AI — bypass DQN inference)
      if (g.phaseGate) {
        const gatePhaseName = g.phaseGate.phase;
        const gateCustomId = `phase_gate_ready_${g.gameId}`;
        const gateHandlerKey = getHandlerKey(gateCustomId, 'button');
        const gateHandler = gateHandlerKey ? getHandler(gateHandlerKey) : null;
        if (gateHandler) {
          try {
            console.log(`[self-play] Resolving phase gate: ${gatePhaseName}`);
            for (const pn of [1, 2]) {
              if (!g.phaseGate) break;
              const isReady = Boolean((g.phaseGate.acked || {})[pn]);
              if (isReady) continue;
              const userId = pn === 1 ? g.player1Id : g.player2Id;
              const gateInteraction = createLiveAiInteraction(gateCustomId, userId, g, client);
              gateInteraction.client = client;
              if (g.generalId) {
                try { gateInteraction.channel = await fetchGameChannel(client, g.generalId); gateInteraction.message.channel = gateInteraction.channel; } catch {}
              }
              const gateGroup = getHandlerGroup(gateHandlerKey);
              if (gateGroup) {
                await gateHandler(gateInteraction, buildContext(gateGroup, buildAllDeps()));
              } else {
                await gateHandler(gateInteraction);
              }
            }
          } catch (err) {
            console.error(`[self-play] Phase gate crash (${gatePhaseName}): ${err.message}`, err.stack?.split('\n').slice(0, 3).join('\n'));
          }
        }
        continue;
      }

      // Execute Krykna push + end-of-round damage (Chopper Base A)
      if (g.pendingKryknaPushQueue?.length > 0) {
        const _kDeps = buildAllDeps();
        const _kMapId = g.selectedMap?.id;
        const _kRawMap = _kDeps.getMapData(_kMapId);
        const _kMapDef = _kDeps.getMapRegistry()?.find?.(m => m.id === _kMapId);
        const _kMapSpaces = _kDeps.filterMapSpacesByBounds(_kRawMap, _kMapDef?.gridBounds) || _kRawMap;
        const _kAdj = _kMapSpaces?.adjacency || {};
        const _kNormalize = _kDeps.normalizeCoord;

        // Push each active Krykna toward nearest figure (BFS, up to 3 spaces)
        const _kActive = (g.npcKrykna || []).filter(k => !k.defeated);
        for (const krykna of _kActive) {
          const startCoord = _kNormalize(krykna.coord);
          const allFigCoords = new Set();
          for (const pn of [1, 2]) {
            for (const coord of Object.values(g.figurePositions?.[pn] || {})) {
              allFigCoords.add(_kNormalize(coord));
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
              const n = _kNormalize(neighbor);
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
          }
        }

        // End-of-round damage: figures adjacent to Krykna take 2 damage
        const { damageEvents: _kDmgEvts, claimedPlacementNeeded: _kClaimed } = _kDeps.runNpcKryknaActivation(g, _kMapId, {
          getMapTokensData: _kDeps.getMapTokensData,
          getMapData: _kDeps.getMapData,
          getMapRegistry: _kDeps.getMapRegistry,
          filterMapSpacesByBounds: _kDeps.filterMapSpacesByBounds,
        });
        for (const { figureKey, playerNum: pnDmg, damage } of (_kDmgEvts || [])) {
          await _kDeps.applyNpcDamageToFigure(g, pnDmg, figureKey, damage, 'Krykna', _kDeps.logGameAction, client, actionDeps.dcHealthState, actionDeps.dcMessageMeta);
        }
        if ((_kDmgEvts || []).length > 0) await _kDeps.checkWinConditions(g, client);

        // Build claimed-Krykna placement queue if any kills happened
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

      // Execute claimed Krykna placement / respawn (Chopper Base A)
      if (g.pendingClaimedKryknaQueue?.length > 0) {
        const _rDeps = buildAllDeps();
        const _rMapId = g.selectedMap?.id;
        const _rAdj = (_rDeps.getMapData(_rMapId))?.adjacency || {};
        const _rNormalize = _rDeps.normalizeCoord;

        for (const playerNum of g.pendingClaimedKryknaQueue) {
          const claimed = g.claimedKrykna?.[playerNum] || 0;
          if (claimed <= 0) continue;
          const validSpaces = getValidKryknaPlacementSpaces(g, playerNum, _rMapId);
          if (validSpaces.length === 0) continue;

          // Pick the valid space within the opponent's deployment zone per the
          // KRYKNA_PLACEMENT_MODE heuristic. Mission rule (placement must be in
          // opponent's zone) is preserved by validSpaces; we only choose WHICH
          // valid space to use. Mode 'min' (default) is aggressive — places the
          // new Krykna BFS-closest to the opponent's figures. Mode 'max' is the
          // opposite (farthest). Mode 'random' is uniform over validSpaces.
          let bestSpace = validSpaces[0];
          if (KRYKNA_PLACEMENT_MODE === 'random') {
            bestSpace = validSpaces[Math.floor(Math.random() * validSpaces.length)];
          } else {
            const oppNum = playerNum === 1 ? 2 : 1;
            const enemyCoords = new Set(
              Object.values(g.figurePositions?.[oppNum] || {}).map(c => _rNormalize(c))
            );
            let bestDist = (KRYKNA_PLACEMENT_MODE === 'max') ? -Infinity : Infinity;
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
                    const n = _rNormalize(neighbor);
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
                if (KRYKNA_PLACEMENT_MODE === 'max' && dist > bestDist) { bestDist = dist; bestSpace = space; }
                else if (KRYKNA_PLACEMENT_MODE === 'min' && dist < bestDist) { bestDist = dist; bestSpace = space; }
              }
            }
          }

          // Place new Krykna at chosen space
          const nextId = `krykna-${(g.npcKrykna || []).length + 1}`;
          g.npcKrykna = g.npcKrykna || [];
          g.npcKrykna.push({ id: nextId, coord: _rNormalize(bestSpace), hp: 8, maxHp: 8, defeated: false });
          g.claimedKrykna[playerNum] = Math.max(0, claimed - 1);
        }
        g.pendingClaimedKryknaQueue = null;
        continue;
      }

      // Auto-skip fluctuation swap (Lothal Wastes B end-of-round interactive phase)
      if (g.pendingFluctuationSwapQueue?.length > 0) {
        const pn = g.pendingFluctuationSwapQueue[0];
        const userId = pn === 1 ? g.player1Id : g.player2Id;
        const skipCustomId = `fluctuation_skip_${g.gameId}`;
        const skipHandlerKey = getHandlerKey(skipCustomId, 'button');
        const skipHandler = skipHandlerKey ? getHandler(skipHandlerKey) : null;
        if (skipHandler) {
          try {
            const skipInteraction = createLiveAiInteraction(skipCustomId, userId, g, client);
            skipInteraction.client = client;
            if (g.generalId) {
              try { skipInteraction.channel = await fetchGameChannel(client, g.generalId); skipInteraction.message.channel = skipInteraction.channel; } catch {}
            }
            const skipGroup = getHandlerGroup(skipHandlerKey);
            if (skipGroup) {
              await skipHandler(skipInteraction, buildContext(skipGroup, buildAllDeps()));
            } else {
              await skipHandler(skipInteraction);
            }
          } catch (err) {
            console.error(`[self-play] Fluctuation skip crash (P${pn}): ${err.message}`);
          }
        }
        continue;
      }

      // Determine acting player
      const acting = determineActingPlayer(g);
      const playerNums = acting === 'both' ? [1, 2] : [acting];

      // Gather actions for acting player(s), filtering suppressed CCs and stale actions
      let allActions = [];
      for (const pn of playerNums) {
        const actions = getAvailableActions(g, pn, actionDeps);
        allActions.push(...actions
          .filter(a => {
            if (a.type === 'play_cc' && a.params?.cardName && suppressedCcPlays.has(a.params.cardName)) return false;
            if (bannedStaleActions.has(`${a.customId}::P${pn}`)) return false;
            return true;
          })
          .map(a => ({ ...a, _playerNum: pn, actingPlayer: pn })));
      }

      // Fallback: if acting player returned empty, try the other player
      // (handles status_phase_ where P1 already ended but P2 still needs to click)
      if (allActions.length === 0 && acting !== 'both') {
        const otherPn = acting === 1 ? 2 : 1;
        const otherActions = getAvailableActions(g, otherPn, actionDeps);
        allActions.push(...otherActions
          .filter(a => {
            if (a.type === 'play_cc' && a.params?.cardName && suppressedCcPlays.has(a.params.cardName)) return false;
            if (bannedStaleActions.has(`${a.customId}::P${otherPn}`)) return false;
            return true;
          })
          .map(a => ({ ...a, _playerNum: otherPn, actingPlayer: otherPn })));
      }

      if (allActions.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty === 1) {
          // Log diagnostic on first empty to help debug stuck states
          const pendingStates = PENDING_KEYS.filter(k => g[k] != null && g[k] !== false);
          const combatSnap = g.pendingCombat ? JSON.stringify({
            currentStep: g.pendingCombat.currentStep || '(unset)',
            acked: g.pendingCombat.acked || {},
            attackRoll: !!g.pendingCombat.attackRoll, defenseRoll: !!g.pendingCombat.defenseRoll,
            rerollPhase: g.pendingCombat.rerollPhase || null,
            pendingSurges: !!g.pendingCombat.pendingSurges, surgeRemaining: g.pendingCombat.surgeRemaining,
            attackerPn: g.pendingCombat.attackerPlayerNum,
          }) : 'none';
          // Scan ALL game.pending* keys (not just PENDING_KEYS) to find unknown blockers
          const allPending = Object.keys(g).filter(k => k.startsWith('pending') && g[k] != null && g[k] !== false);
          console.warn(`[self-play] Empty actions — pending: [${pendingStates.join(', ')}], allPending: [${allPending.join(', ')}], combat: ${combatSnap}, phase=${g.phase}, roundPhase=${g.roundPhase}, acting=${acting}, round=${g.round}`);
        }

        // Escape hatch: when nearing stuck threshold, bypass bans and force
        // a phase-advancing action (dc_end_activation, pass_activation_turn, etc.)
        // to unstick the game. Only fires when ban filtering removed all actions —
        // if the engine itself returns nothing, there's nothing to force.
        if (consecutiveEmpty >= 15 && allActions.length === 0) {
          const escapePns = acting === 'both' ? [1, 2] : [acting, acting === 1 ? 2 : 1];
          for (const pn of escapePns) {
            const rawActions = getAvailableActions(g, pn, actionDeps);
            const escape = rawActions.find(a => ESCAPE_ACTION_TYPES.has(a.type));
            if (escape) {
              console.log(`[self-play] Escape hatch: forcing ${escape.type} (${escape.customId}) for P${pn} to advance phase (consecutiveEmpty=${consecutiveEmpty})`);
              allActions = [{ ...escape, _playerNum: pn, actingPlayer: pn }];
              consecutiveEmpty = 0;
              break;
            }
          }
        }

        if (allActions.length === 0) {
          if (consecutiveEmpty > 20) {
            const pendingStates = PENDING_KEYS.filter(k => g[k] != null && g[k] !== false);
            console.error(`[self-play] stuck_no_actions — pending: [${pendingStates.join(', ')}], phase=${g.phase}, roundPhase=${g.roundPhase}, round=${g.round}`);
            const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'stuck_no_actions', surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
            await insertSelfPlayRun(artifact);
            return { result: 'failed', artifact };
          }
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
      }

      // Action loop detection: same 2 or 3 actions repeating.
      // Instead of killing the game, ban the looping actions and continue.
      // This converts action_loop from a fatal stop to a recoverable event.
      let loopDetected = false;
      if (lastCustomIds.length >= 4) {
        // 2-action oscillation: ABAB
        const a2 = lastCustomIds.slice(-4, -2).join(',');
        const b2 = lastCustomIds.slice(-2).join(',');
        if (a2 === b2) {
          for (const id of lastCustomIds.slice(-2)) bannedStaleActions.add(id);
          console.log(`[self-play] Loop recovery (2-cycle #${loopRecoveries + 1}): banned [${lastCustomIds.slice(-2).join(', ')}]`);
          loopDetected = true;
        }
      }
      if (!loopDetected && lastCustomIds.length >= 6) {
        // 3-action cycle: ABCABC
        const a3 = lastCustomIds.slice(0, 3).join(',');
        const b3 = lastCustomIds.slice(3, 6).join(',');
        if (a3 === b3) {
          for (const id of lastCustomIds.slice(0, 3)) bannedStaleActions.add(id);
          console.log(`[self-play] Loop recovery (3-cycle #${loopRecoveries + 1}): banned [${lastCustomIds.slice(0, 3).join(', ')}]`);
          loopDetected = true;
        }
      }
      if (loopDetected) {
        loopRecoveries++;
        lastCustomIds.length = 0; // reset detection window
        if (loopRecoveries > MAX_LOOP_RECOVERIES) {
          const loopErr = new Error(`Exhausted ${MAX_LOOP_RECOVERIES} loop recoveries — game is genuinely stuck`);
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'action_loop', error: loopErr, surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
        continue; // retry with looping actions banned
      }

      // Pick best action
      const engineLike = {
        getState: () => g,
        getAvailableActions: (pn) => getAvailableActions(g, pn, actionDeps),
      };
      const pick = pickBestAction(engineLike, allActions, allActions[0]._playerNum, actionDeps);
      if (!pick) {
        // All available actions are unsupported (e.g., only CC plays) — skip this step
        consecutiveEmpty++;
        if (consecutiveEmpty > 20) {
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'stuck_unsupported_only', surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      let chosen = pick.action;

      // Test override: when --test-overflow, prefer token-granting surges to force overflow
      if (g.testPvpOverflowPath && chosen.type === 'combat_surge') {
        const TOKEN_SURGE_PATTERNS = /token|block 1|evade(?!\s*cancel)/i;
        const tokenSurge = allActions.find(a =>
          a.type === 'combat_surge' && a.params?.surgeKey && TOKEN_SURGE_PATTERNS.test(a.params.surgeKey)
        );
        if (tokenSurge && tokenSurge.customId !== chosen.customId) {
          chosen = tokenSurge;
        }
      }

      // CC play bridge: play_cc actions require multi-step UI (dropdown → confirm).
      // Bypass the dropdown by pre-setting pendingCcConfirmation and routing
      // directly to the confirm handler, which does the actual play.
      if (chosen.type === 'play_cc' && chosen.params?.cardName) {
        g.pendingCcConfirmation = {
          playerNum: chosen._playerNum,
          card: chosen.params.cardName,
          ts: Date.now(),
        };
        chosen.customId = `cc_confirm_play_${g.gameId}`;
      }

      // Snapshot alive figures before dispatch (for defeat detection)
      const figuresBefore = countAliveFigures(g, dcHealthState);

      // Route to handler
      const handlerKey = getHandlerKey(chosen.customId, 'button');
      if (!handlerKey) {
        surfaceCtx = { handlerKey: null, intendedSurface: 'button', discordOp: chosen.customId };
        const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'unroutable_action', surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
        await insertSelfPlayRun(artifact);
        return { result: 'failed', artifact };
      }

      const handler = getHandler(handlerKey);
      if (!handler) {
        surfaceCtx = { handlerKey, intendedSurface: 'button' };
        const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'unroutable_action', surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
        await insertSelfPlayRun(artifact);
        return { result: 'failed', artifact };
      }

      // Build interaction
      const actingUserId = chosen._playerNum === 1 ? g.player1Id : g.player2Id;
      const interaction = createLiveAiInteraction(chosen.customId, actingUserId, g, client);
      interaction.client = client;

      // Set up guild/channel references
      if (g.guildId) {
        try { interaction.guild = await client.guilds.fetch(g.guildId); } catch {}
      }
      if (g.generalId) {
        try {
          interaction.channel = await fetchGameChannel(client, g.generalId);
          interaction.message.channel = interaction.channel;
        } catch {}
      }

      // Track surface context for artifact
      surfaceCtx = {
        handlerKey,
        intendedSurface: 'button',
        actualChannel: g.generalId ?? null,
        discordOp: chosen.customId,
        discordError: null,
      };

      // Dispatch through handler
      try {
        // Fail fast if general channel is null — running a handler without it
        // causes null.send crashes deep in handler code with no useful context.
        if (!interaction.channel) {
          throw new Error(`General channel null after retries (generalId=${g.generalId}, handler=${handlerKey}, customId=${chosen.customId})`);
        }
        const group = getHandlerGroup(handlerKey);
        const runHandler = async () => {
          if (group) {
            const ctx = buildContext(group, buildAllDeps());
            await handler(interaction, ctx);
          } else {
            await handler(interaction);
          }
        };

        if (atomicOpts) {
          await withAtomicGameLock(g.gameId, atomicOpts, runHandler);
        } else {
          await runHandler();
        }
      } catch (err) {
        // Hard crashes are failures
        const isCrash = err.message?.includes('Cannot read')
          || err.message?.includes('is not a function')
          || err.message?.includes('is not defined')
          || err.message?.includes('is not iterable')
          || err.message?.includes('channel null after retries');
        if (isCrash) {
          surfaceCtx.discordError = err.message;
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'handler_crash', error: err, surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
        // Soft errors (invalid state transitions) — log and continue
        console.warn(`[self-play] Step ${step} soft error: ${err.message}`);
      }

      // CC retry-loop prevention: if the handler set pendingIllegalCcPlay, the card
      // couldn't be auto-resolved. Suppress it for this phase/activation window and
      // clean up the pending state so the game doesn't stall.
      if (g.pendingIllegalCcPlay) {
        const suppCard = g.pendingIllegalCcPlay.card;
        const suppReason = g.pendingIllegalCcPlay.reason || 'unknown';
        suppressedCcPlays.add(suppCard);
        console.log(`[self-play] CC suppressed: "${suppCard}" (${suppReason}) — will retry after phase change`);
        delete g.pendingIllegalCcPlay;
        // Don't count this as a dispatched action — the card wasn't consumed
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }

      // Negation auto-resolve: cost-0 CCs set pendingNegation (opponent may play
      // Negation to cancel). In AI self-play both sides are AI — auto-let-resolve
      // by dispatching the negation_let_resolve handler so the game continues.
      if (g.pendingNegation) {
        const negCard = g.pendingNegation.card;
        const negOppNum = g.pendingNegation.playedBy === 1 ? 2 : 1;
        const negUserId = negOppNum === 1 ? g.player1Id : g.player2Id;
        const negCustomId = `negation_let_resolve_${g.gameId}`;
        try {
          const negHandlerKey = getHandlerKey(negCustomId, 'button');
          const negHandler = negHandlerKey ? getHandler(negHandlerKey) : null;
          if (negHandler) {
            const negInteraction = createLiveAiInteraction(negCustomId, negUserId, g, client);
            negInteraction.client = client;
            if (g.generalId) {
              try { negInteraction.channel = await fetchGameChannel(client, g.generalId); negInteraction.message.channel = negInteraction.channel; } catch {}
            }
            const negGroup = getHandlerGroup(negHandlerKey);
            if (negGroup) {
              const negCtx = buildContext(negGroup, buildAllDeps());
              await negHandler(negInteraction, negCtx);
            } else {
              await negHandler(negInteraction);
            }
            console.log(`[self-play] Negation auto-resolved: let "${negCard}" resolve (P${negOppNum} passed)`);
          } else {
            // Fallback: just clear the pending state
            clearPendingNegation(g);
            console.warn(`[self-play] Negation cleared (no handler for ${negCustomId})`);
          }
        } catch (err) {
          clearPendingNegation(g);
          console.warn(`[self-play] Negation auto-resolve error: ${err.message}`);
        }
      }

      // Detect figure defeats via pre/post diff
      const gPostDispatch = getGame(game.gameId);
      if (gPostDispatch) {
        const figuresAfter = countAliveFigures(gPostDispatch, dcHealthState);
        if (figuresAfter < figuresBefore) figureDefeats += (figuresBefore - figuresAfter);
      }

      // Record action — reset empty counter only when an action is actually dispatched
      consecutiveEmpty = 0;
      totalActionsDispatched++;
      ringBuffer.push({
        step,
        customId: chosen.customId,
        type: chosen.type,
        playerNum: chosen._playerNum,
        handlerKey,
        ts: Date.now(),
      });
      const stampedId = `${chosen.customId}::P${chosen._playerNum}`;
      lastCustomIds.push(stampedId);
      if (lastCustomIds.length > 6) lastCustomIds.shift();

      // Stale-action detection: if same customId+player picked twice in a row, handler
      // likely rejected it without changing state. Ban it to prevent looping.
      // Uses player-stamped IDs so different players dispatching the same customId
      // (e.g. both readying for combat) doesn't trigger a false ban.
      const lci = lastCustomIds.length;
      if (lci >= 2 && lastCustomIds[lci - 1] === lastCustomIds[lci - 2]) {
        bannedStaleActions.add(stampedId);
        console.log(`[self-play] Banning stale action: ${stampedId}`);
      }

      // Zero-movement detection: if move_pick_done was dispatched immediately after
      // dc_move for the same figure (no intermediate move_pick_space), the figure
      // moved zero spaces — it is boxed in or has no reachable tiles.  Ban dc_move
      // for this figure to prevent idle-suppression from looping on it.
      if (lci >= 2 && chosen.customId.endsWith('_done') && handlerKey === 'move_pick_') {
        const prevStamped = lastCustomIds[lci - 2];
        const prevCustomId = prevStamped.replace(/::P\d+$/, '');
        // dc_move_{msgId}_f{idx} → move_pick_{msgId}_{idx}_done — match same msgId
        if (prevCustomId.startsWith('dc_move_')) {
          const dcMoveStamped = prevStamped;
          bannedStaleActions.add(dcMoveStamped);
          console.log(`[self-play] Banning zero-movement dc_move: ${dcMoveStamped}`);
        }
      }

      // Trace collection
      exercisedHandlers.add(handlerKey);
      actionTypeCounts.set(chosen.type, (actionTypeCounts.get(chosen.type) || 0) + 1);
      const gAfter = getGame(game.gameId);
      if (gAfter) {
        for (const k of PENDING_KEYS) {
          if (gAfter[k] != null && gAfter[k] !== false) triggeredPendingStates.add(k);
        }
        // Transition key: same identity as headless explorer (roundPhase|pendingSet|actionType)
        transitionsHit.push(computeTransitionKey(gAfter, chosen.type));

        // VP-per-round snapshot: capture VP totals when the round number advances
        const curRound = gAfter.currentRound ?? 1;
        if (curRound > lastTrackedRound) {
          vpPerRound.push({
            round: lastTrackedRound,
            p1: gAfter.player1VP?.total ?? 0,
            p2: gAfter.player2VP?.total ?? 0,
          });
          lastTrackedRound = curRound;
        }

        // ── Coverage ledger tracking ──
        // Handler
        trackCoverage(`handler:${handlerKey}`);
        // Pending states
        for (const k of PENDING_KEYS) {
          if (gAfter[k] != null && gAfter[k] !== false) trackCoverage(`pending_state:${k}`);
        }
        // CC played
        if (chosen.type === 'play_cc' && chosen.params?.cardName) {
          trackCoverage(`cc:${chosen.params.cardName}`);
        }
        // DC special ability
        if (chosen.type === 'dc_special' && chosen.params?.specialId) {
          trackCoverage(`ability_dc_special:${chosen.params.specialId}`);
        }
        // Surge selected
        if (chosen.type === 'combat_surge' && chosen.params?.surgeKey) {
          trackCoverage(`ability_surge:${chosen.params.surgeKey}`);
        }
        // DC deployment: seed once after setup → activation transition
        if (!coverageDcSeeded && gAfter.roundPhase && gAfter.roundPhase !== 'setup') {
          coverageDcSeeded = true;
          for (const pNum of [1, 2]) {
            const positions = gAfter[`player${pNum}FigurePositions`] || gAfter.figurePositions?.[pNum];
            if (positions && typeof positions === 'object') {
              for (const figKey of Object.keys(positions)) {
                // figKey is the DC message ID; dcName is in the figure's metadata
                const meta = gAfter[`player${pNum}DcMeta`]?.[figKey] || gAfter.dcMeta?.[pNum]?.[figKey];
                if (meta?.dcName) trackCoverage(`dc:${meta.dcName}`);
              }
            }
          }
          // Fallback: extract DCs from squad lists if meta not available
          if (coverageHits.size === 0 || ![...coverageHits.keys()].some(k => k.startsWith('dc:'))) {
            for (const sq of [gAfter.player1Squad, gAfter.player2Squad]) {
              if (sq?.dcList) for (const dc of sq.dcList) trackCoverage(`dc:${dc}`);
            }
          }
        }
        // VP source tracking: detect VP changes
        const p1vp = gAfter.player1VP || {};
        const p2vp = gAfter.player2VP || {};
        if ((p1vp.kills ?? 0) > lastP1VP.kills || (p2vp.kills ?? 0) > lastP2VP.kills) {
          trackCoverage('vp_source:kill_vp');
        }
        if ((p1vp.objectives ?? 0) > lastP1VP.objectives || (p2vp.objectives ?? 0) > lastP2VP.objectives) {
          trackCoverage('vp_source:objective_vp');
        }
        lastP1VP = { kills: p1vp.kills ?? 0, objectives: p1vp.objectives ?? 0 };
        lastP2VP = { kills: p2vp.kills ?? 0, objectives: p2vp.objectives ?? 0 };
      }

      const ccLabel = chosen.params?.cardName ? ` (${chosen.params.cardName})` : '';
      console.log(`[self-play] Step ${step}: P${chosen._playerNum} ${chosen.type}${ccLabel} → ${chosen.customId}`);

      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

  } finally {
    activeSelfPlayGameId = null;

    // ── Persist coverage hits + verification results to DB ──
    if (coverageHits.size > 0) {
      try {
        await batchIncrementCoverageDiscord(coverageHits, game.gameId);
        // Run correctness verification on completed games
        const verifiedItems = verifyCoverageCorrectness(finalGameState, coverageHits);
        if (verifiedItems.size > 0) {
          await batchSetCoverageVerified(verifiedItems);
          const passed = [...verifiedItems.values()].filter(v => v.verified).length;
          const failed = verifiedItems.size - passed;
          console.log(`[self-play] Coverage: ${coverageHits.size} items tracked, ${passed} verified, ${failed} failed for game ${game.gameId}`);
        } else {
          console.log(`[self-play] Coverage: ${coverageHits.size} distinct items tracked for game ${game.gameId}`);
        }
      } catch (err) {
        console.error('[self-play] Coverage persist failed:', err.message);
      }
    }
  }
}

/**
 * Stop the active self-play run (called from /selfplay stop).
 * Sets the game.ended flag so the loop exits on its next iteration.
 */
export function stopSelfPlay(getGame) {
  if (!activeSelfPlayGameId) return null;
  const gid = activeSelfPlayGameId;
  const game = getGame(gid);
  if (game) {
    setPhase(game, PHASES.ENDED);
    game.ended = true;
    game.selfPlayManualStop = true;
  }
  return gid;
}
