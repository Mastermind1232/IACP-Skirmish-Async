/**
 * AI-vs-AI Discord self-play: runs a full game through the real handler pipeline,
 * captures structured artifacts on failure, and persists them to Postgres.
 *
 * V1 scope: buttons only. No select menus, modals, or setup/deploy paths.
 * Starts from prepared round-1 scenarios.
 */

import { execSync } from 'child_process';
import { getAvailableActions } from '../engine/available-actions.js';
import { pickBestAction } from './strategy.js';
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

  // End-of-round window
  if (game.endOfRoundWhoseTurn) {
    return game.endOfRoundWhoseTurn === game.player1Id ? 1 : 2;
  }
  if (game.startOfRoundWhoseTurn) {
    return game.startOfRoundWhoseTurn === game.player1Id ? 1 : 2;
  }

  // Pending combat states — the attacker/defender depends on the sub-state
  if (game.pendingCombat) {
    const pc = game.pendingCombat;
    if (pc.rerollPhase) {
      // Defender rerolls first, then attacker
      return pc.rerollPhase === 'defender'
        ? (pc.defenderPlayerNum || (pc.attackerPlayerNum === 1 ? 2 : 1))
        : pc.attackerPlayerNum;
    }
    if (pc.surgePhase) return pc.attackerPlayerNum;
    return pc.attackerPlayerNum || 1;
  }

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

// ── Stop reason classification ────────────────────────────────────────────────

/** Bug stop reasons (real problems to fix). */
const BUG_STOPS = new Set([
  'handler_crash', 'discord_api_failure', 'stuck_no_actions',
  'action_loop', 'invariant_violation', 'unroutable_action',
]);

/** Limit stop reasons (known V1 capability bounds). */
const LIMIT_STOPS = new Set([
  'unsupported_interaction_type', 'action_cap_reached', 'manual_stop',
]);

// ── Artifact builder ──────────────────────────────────────────────────────────

function buildRunArtifact(game, { scenario, guildId, startedAt, ringBuffer, stopReason, error, surfaceCtx, traceData, explorationMode }) {
  const now = new Date();
  const result = BUG_STOPS.has(stopReason) ? 'failed'
    : stopReason === 'completed' ? 'completed'
    : 'stopped';

  return {
    game_id: game?.gameId ?? 'unknown',
    guild_id: guildId ?? null,
    scenario: scenario ?? null,
    result,
    stop_reason: stopReason,
    commit_sha: getCommitSha(),
    map: game?.selectedMap?.id ?? null,
    p1_squad: game?.player1Squad ?? null,
    p2_squad: game?.player2Squad ?? null,
    phase: game?.phase ?? null,
    round_phase: game?.roundPhase ?? null,
    current_round: game?.currentRound ?? null,
    active_player: game?.currentActivationTurnPlayerId ?? null,
    total_steps: ringBuffer.length,
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
    exercised_handlers: traceData?.exercisedHandlers ? [...traceData.exercisedHandlers] : [],
    seen_action_types: traceData?.seenActionTypes ? [...traceData.seenActionTypes] : [],
    triggered_pending_states: traceData?.triggeredPendingStates ? [...traceData.triggeredPendingStates] : [],
    transitions_hit: traceData?.transitionsHit ? [...new Set(traceData.transitionsHit)] : [],
  };
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
 * @param {number}  [opts.actionCap=500] - Max actions before stopping
 * @param {number}  [opts.delayMs=200] - Delay between actions (ms)
 * @param {boolean} [opts.persistCompleted=false] - Also persist completed runs to DB
 * @returns {Promise<{ result: string, artifact: object }>}
 */
export async function runSelfPlayLoop(game, client, opts) {
  const {
    buildAllDeps, getGame, atomicOpts, actionDeps = {},
    scenario, guildId, actionCap = 500, delayMs = 200,
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
  let lastCustomIds = [];

  // Execution trace (Phase 1 queue runner)
  const exercisedHandlers = new Set();
  const seenActionTypes = new Set();
  const triggeredPendingStates = new Set();
  const transitionsHit = [];
  const traceData = { exercisedHandlers, seenActionTypes, triggeredPendingStates, transitionsHit };

  // Mark game as self-play (both players are AI)
  game.selfPlay = true;
  game.player1Id = `${AI_USER_PREFIX}1`;
  game.player2Id = `${AI_USER_PREFIX}2`;

  try {
    for (let step = 0; step < actionCap; step++) {
      const g = getGame(game.gameId);
      if (!g || g.ended) {
        const wasManualStop = g?.selfPlayManualStop;
        const stopReason = wasManualStop ? 'manual_stop' : 'completed';
        const artifact = buildRunArtifact(g || game, { scenario, guildId, startedAt, ringBuffer, stopReason, surfaceCtx, traceData, explorationMode });
        if (wasManualStop) await insertSelfPlayRun(artifact);
        else if (persistCompleted) await insertSelfPlayRun(artifact);
        return { result: wasManualStop ? 'stopped' : 'completed', artifact };
      }

      // Determine acting player
      const acting = determineActingPlayer(g);
      const playerNums = acting === 'both' ? [1, 2] : [acting];

      // Gather actions for acting player(s)
      let allActions = [];
      for (const pn of playerNums) {
        const actions = getAvailableActions(g, pn, actionDeps);
        allActions.push(...actions.map(a => ({ ...a, _playerNum: pn })));
      }

      if (allActions.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty > 20) {
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'stuck_no_actions', surfaceCtx, traceData, explorationMode });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      consecutiveEmpty = 0;

      // Action loop detection: same 3 actions repeating
      if (lastCustomIds.length >= 6) {
        const a = lastCustomIds.slice(0, 3).join(',');
        const b = lastCustomIds.slice(3, 6).join(',');
        if (a === b) {
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'action_loop', surfaceCtx, traceData, explorationMode });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
      }

      // Pick best action
      const engineLike = {
        getState: () => g,
        getAvailableActions: (pn) => getAvailableActions(g, pn, actionDeps),
      };
      const pick = pickBestAction(engineLike, allActions, allActions[0]._playerNum);
      const chosen = pick?.action || allActions[0];

      // Route to handler
      const handlerKey = getHandlerKey(chosen.customId, 'button');
      if (!handlerKey) {
        surfaceCtx = { handlerKey: null, intendedSurface: 'button', discordOp: chosen.customId };
        const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'unroutable_action', surfaceCtx, traceData, explorationMode });
        await insertSelfPlayRun(artifact);
        return { result: 'failed', artifact };
      }

      const handler = getHandler(handlerKey);
      if (!handler) {
        surfaceCtx = { handlerKey, intendedSurface: 'button' };
        const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'unroutable_action', surfaceCtx, traceData, explorationMode });
        await insertSelfPlayRun(artifact);
        return { result: 'failed', artifact };
      }

      // Build interaction
      const actingUserId = chosen._playerNum === 1 ? g.player1Id : g.player2Id;
      const interaction = createLiveAiInteraction(chosen.customId, actingUserId, g, client);

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
          const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'handler_crash', error: err, surfaceCtx, traceData, explorationMode });
          await insertSelfPlayRun(artifact);
          return { result: 'failed', artifact };
        }
        // Soft errors (invalid state transitions) — log and continue
        console.warn(`[self-play] Step ${step} soft error: ${err.message}`);
      }

      // Record action
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

      // Trace collection
      exercisedHandlers.add(handlerKey);
      seenActionTypes.add(chosen.type);
      const gAfter = getGame(game.gameId);
      if (gAfter) {
        for (const k of PENDING_KEYS) {
          if (gAfter[k] != null && gAfter[k] !== false) triggeredPendingStates.add(k);
        }
        // Transition key: same identity as headless explorer (roundPhase|pendingSet|actionType)
        transitionsHit.push(computeTransitionKey(gAfter, chosen.type));
      }

      console.log(`[self-play] Step ${step}: P${chosen._playerNum} ${chosen.type} → ${chosen.customId}`);

      if (delayMs > 0 && step < actionCap - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // Hit action cap
    const g = getGame(game.gameId) || game;
    const artifact = buildRunArtifact(g, { scenario, guildId, startedAt, ringBuffer, stopReason: 'action_cap_reached', surfaceCtx, traceData, explorationMode });
    await insertSelfPlayRun(artifact);
    return { result: 'stopped', artifact };

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
