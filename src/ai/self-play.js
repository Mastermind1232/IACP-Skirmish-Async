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
import { insertSelfPlayRun } from '../db.js';
import { computeTransitionKey } from '../exploration/transition-key.js';

// ── Concurrency guard ─────────────────────────────────────────────────────────

let activeSelfPlayGameId = null;

export function getActiveSelfPlayGameId() {
  return activeSelfPlayGameId;
}

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
    return game.pendingNegation.targetPlayerId === game.player1Id ? 1 : 2;
  }
  if (game.pendingCcConfirmation) {
    return game.pendingCcConfirmation.playerId === game.player1Id ? 1 : 2;
  }
  if (game.pendingCcChoice?.playerId) {
    return game.pendingCcChoice.playerId === game.player1Id ? 1 : 2;
  }
  if (game.pendingCcSpaceChoice?.playerId) {
    return game.pendingCcSpaceChoice.playerId === game.player1Id ? 1 : 2;
  }
  if (game.pendingStrainChoice && Object.keys(game.pendingStrainChoice).length > 0) {
    const pid = game.pendingStrainChoice.playerId;
    return pid === game.player1Id ? 1 : (pid === game.player2Id ? 2 : 'both');
  }
  if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) {
    const pid = game.pendingDcAbilityChoice.playerId;
    return pid === game.player1Id ? 1 : (pid === game.player2Id ? 2 : 'both');
  }
  if (game.pendingCoverFire) return game.pendingCoverFire.defenderPlayerNum || 'both';
  if (game.pendingStillFaster) return 'both';
  if (game.pendingPowerTokenGrant) return game.pendingPowerTokenGrant.playerNum || 'both';
  if (game.pendingCelebration) return game.pendingCelebration.playerNum || 'both';
  if (game.pendingRushPush) return game.pendingRushPush.playerNum || 'both';
  if (game.pendingLastResort) return game.pendingLastResort.playerNum || 'both';
  if (game.pendingFalseOrders) return game.pendingFalseOrders.playerNum || 'both';
  if (game.forceVisionPending) return 'both';

  // Move in progress
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) {
    const pid = game.moveInProgress.playerId;
    return pid === game.player1Id ? 1 : (pid === game.player2Id ? 2 : 'both');
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
  'phaseGate', 'pendingCombat', 'moveInProgress', 'pendingEndTurn',
  'pendingNegation', 'pendingCoverFire', 'pendingStrainChoice',
  'pendingCcConfirmation', 'pendingCcChoice', 'pendingCcSpaceChoice',
  'pendingStillFaster', 'pendingPowerTokenGrant', 'pendingCelebration',
  'pendingDcAbilityChoice', 'pendingRushPush', 'pendingLastResort',
  'pendingFalseOrders', 'forceVisionPending', 'setupAttachmentPhase',
  'endOfRoundWhoseTurn', 'startOfRoundWhoseTurn',
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

function countAliveFigures(game) {
  let count = 0;
  if (game.deployedCards) {
    for (const dc of Object.values(game.deployedCards)) {
      if (dc.figures) {
        for (const fig of Object.values(dc.figures)) {
          if (fig.health > 0) count++;
        }
      }
    }
  }
  return count;
}

// ── Stop reason classification ────────────────────────────────────────────────

/** Bug stop reasons (real problems to fix). */
const BUG_STOPS = new Set([
  'handler_crash', 'discord_api_failure', 'stuck_no_actions',
  'action_loop', 'invariant_violation', 'unroutable_action',
]);

/** Limit stop reasons (known V1 capability bounds). */
const LIMIT_STOPS = new Set([
  'unsupported_interaction_type', 'manual_stop',
]);

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
  };
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
  const surgeSpends = atc.combat_surge_spend || 0;
  const surgeSkips = atc.combat_surge_skip || 0;
  const combatReady = atc.combat_resolve_ready || 0;
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
    `  Combat resolutions: ${combatReady}`,
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
    `── Coverage ───────────────────────────────────`,
    `  Handlers exercised: ${artifact.exercised_handlers?.length ?? 0}`,
    `  Action types seen:  ${artifact.seen_action_types?.length ?? 0}`,
    `  Pending states hit: [${(artifact.triggered_pending_states || []).join(', ')}]`,
    `  Unique transitions: ${artifact.transitions_hit?.length ?? 0}`,
    artifact.error_message ? `\n── Error ──────────────────────────────────────\n  ${artifact.error_message}` : '',
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
export async function runSelfPlayLoop(game, client, opts) {
  const {
    buildAllDeps, getGame, atomicOpts, actionDeps = {},
    scenario, guildId, delayMs = 200,
    persistCompleted = false, explorationMode,
  } = opts;

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

  // Stale-action safety net: if the same action is picked twice consecutively without
  // changing game state, the handler likely rejected it (stun, boxed in, etc.).
  // Ban it until the phase changes to prevent infinite loops.
  const bannedStaleActions = new Set();

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

  // Reset per-game strategy counters (graph vs flat, heuristic overrides)
  resetRuntimeStats();

  // Mark game as self-play (both players are AI)
  game.selfPlay = true;
  game.player1Id = `${AI_USER_PREFIX}1`;
  game.player2Id = `${AI_USER_PREFIX}2`;

  try {
    for (let step = 0; ; step++) {
      const g = getGame(game.gameId);
      if (!g || g.ended) {
        const wasManualStop = g?.selfPlayManualStop;
        const stopReason = wasManualStop ? 'manual_stop' : 'completed';
        const artifact = buildRunArtifact(g || game, { scenario, guildId, startedAt, ringBuffer, stopReason, surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
        if (wasManualStop) await insertSelfPlayRun(artifact);
        else if (persistCompleted) await insertSelfPlayRun(artifact);
        return { result: wasManualStop ? 'stopped' : 'completed', artifact };
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
            if (bannedStaleActions.has(a.customId)) return false;
            return true;
          })
          .map(a => ({ ...a, _playerNum: pn, actingPlayer: pn })));
      }

      if (allActions.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty > 20) {
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'stuck_no_actions', surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }

      // Action loop detection: same 3 actions repeating
      if (lastCustomIds.length >= 6) {
        const a = lastCustomIds.slice(0, 3).join(',');
        const b = lastCustomIds.slice(3, 6).join(',');
        if (a === b) {
          const loopPattern = lastCustomIds.slice(0, 3).join(' → ');
          const loopErr = new Error(`Repeating 3-action loop detected: ${loopPattern}`);
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'action_loop', error: loopErr, surfaceCtx, traceData, explorationMode, totalActionsDispatched, figureDefeats, vpPerRound });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
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
      const chosen = pick.action;

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
      const figuresBefore = countAliveFigures(g);

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
          || err.message?.includes('is not iterable');
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
            delete g.pendingNegation;
            console.warn(`[self-play] Negation cleared (no handler for ${negCustomId})`);
          }
        } catch (err) {
          delete g.pendingNegation;
          console.warn(`[self-play] Negation auto-resolve error: ${err.message}`);
        }
      }

      // Detect figure defeats via pre/post diff
      const gPostDispatch = getGame(game.gameId);
      if (gPostDispatch) {
        const figuresAfter = countAliveFigures(gPostDispatch);
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
      lastCustomIds.push(chosen.customId);
      if (lastCustomIds.length > 6) lastCustomIds.shift();

      // Stale-action detection: if same customId picked twice in a row, handler likely
      // rejected it without changing state. Ban it to prevent looping.
      const lci = lastCustomIds.length;
      if (lci >= 2 && lastCustomIds[lci - 1] === lastCustomIds[lci - 2]) {
        bannedStaleActions.add(lastCustomIds[lci - 1]);
        console.log(`[self-play] Banning stale action: ${lastCustomIds[lci - 1]}`);
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
      }

      const ccLabel = chosen.params?.cardName ? ` (${chosen.params.cardName})` : '';
      console.log(`[self-play] Step ${step}: P${chosen._playerNum} ${chosen.type}${ccLabel} → ${chosen.customId}`);

      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

  } finally {
    activeSelfPlayGameId = null;
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
    game.ended = true;
    game.selfPlayManualStop = true;
  }
  return gid;
}
