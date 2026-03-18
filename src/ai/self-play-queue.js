/**
 * Self-play queue runner: cycles through scenarios, captures execution traces,
 * pauses on failures for human review.
 *
 * Phase 1: deterministic round-robin, pause on any failure, in-memory state only.
 */

import { runSelfPlayLoop, getActiveSelfPlayGameId } from './self-play.js';

// ── Queue state (in-memory only) ─────────────────────────────────────────────

let queueState = 'idle'; // 'idle' | 'running' | 'paused' | 'draining'
let runCount = 0;
let failCount = 0;
let currentRunScenario = null;
let rotationIndex = 0;
let pauseReason = null;
let queueOpts = null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the queue runner.
 * @param {object} opts - All dependencies for game creation, loop, cleanup, logging.
 */
export function startQueue(opts) {
  if (queueState !== 'idle') {
    throw new Error(`Self-play is ${queueState}, cannot start. Use /selfplay stop first.`);
  }
  if (getActiveSelfPlayGameId()) {
    throw new Error(`Self-play already active for game ${getActiveSelfPlayGameId()}. Stop it first.`);
  }
  queueOpts = opts;
  queueState = 'running';
  runCount = 0;
  failCount = 0;
  rotationIndex = 0;
  pauseReason = null;
  currentRunScenario = null;

  // Fire-and-forget
  _runQueueLoop().catch(err => {
    console.error('[self-play-queue] Unhandled loop error:', err);
    queueState = 'idle';
    queueOpts = null;
    currentRunScenario = null;
  });
}

/** Drain the queue (finish current run, then stop). */
export function stopQueue() {
  if (queueState === 'idle') throw new Error('Self-play is not running.');
  queueState = 'draining';
}

/** Pause the queue after the current run completes. */
export function pauseQueue(reason = 'manual') {
  if (queueState !== 'running') throw new Error(`Self-play is ${queueState}, cannot pause.`);
  queueState = 'paused';
  pauseReason = reason;
}

/** Resume a paused queue. */
export function resumeQueue() {
  if (queueState !== 'paused') throw new Error(`Self-play is ${queueState}, cannot resume.`);
  queueState = 'running';
  pauseReason = null;
}

/** Get a snapshot of the queue state. */
export function getQueueStatus() {
  return {
    state: queueState,
    runCount,
    failCount,
    currentRunScenario,
    rotationIndex,
    pauseReason,
    totalScenarios: queueOpts?.scenarios?.length ?? 0,
  };
}

// ── Internal loop ────────────────────────────────────────────────────────────

async function _runQueueLoop() {
  const opts = queueOpts;
  const {
    client, guild, guildId,
    buildAllDeps, getGame, atomicOpts, actionDeps,
    createTestGame, deleteGameChannelsAndGame,
    cleanupCtx, scenarios,
    interGameDelayMs = 5000, actionCap = 500, delayMs = 200,
    feedbackChannel, logChannel, saveGames,
    botLogsPost,
  } = opts;

  const AI_USER_PREFIX = opts.AI_USER_PREFIX || 'ai_user_';

  try {
    while (queueState === 'running' || queueState === 'paused') {
      // Pause gate
      while (queueState === 'paused') {
        await new Promise(r => setTimeout(r, 1000));
        if (queueState === 'draining') break;
      }
      if (queueState === 'draining') break;

      const scenarioIdx = rotationIndex % scenarios.length;
      const scenarioId = scenarios[scenarioIdx];
      currentRunScenario = scenarioId;
      const runNum = runCount + 1;

      console.log(`[self-play-queue] Run #${runNum}: scenario ${scenarioId} (${scenarioIdx + 1}/${scenarios.length})`);

      let gameId = null;
      let result = null;
      let artifact = null;

      try {
        // 1. Create game
        const aiP1 = `${AI_USER_PREFIX}1`;
        const aiP2 = `${AI_USER_PREFIX}2`;
        const created = await createTestGame(client, guild, aiP1, scenarioId, feedbackChannel, { player2Id: aiP2 });
        gameId = created.gameId;

        const game = getGame(gameId);
        if (!game) throw new Error('Game creation returned no game state');
        game.selfPlay = true;
        game.guildId = guildId;
        saveGames();

        // 2. Run self-play loop
        const loopResult = await runSelfPlayLoop(game, client, {
          buildAllDeps,
          getGame,
          atomicOpts,
          actionDeps,
          scenario: scenarioId,
          guildId,
          actionCap,
          delayMs,
          explorationMode: 'queue',
        });
        result = loopResult.result;
        artifact = loopResult.artifact;

      } catch (err) {
        // Game creation or loop threw unexpectedly
        console.error(`[self-play-queue] Run #${runNum} threw:`, err.message);
        result = 'failed';
        artifact = {
          game_id: gameId || 'unknown',
          scenario: scenarioId,
          stop_reason: 'queue_run_error',
          error_message: err.message,
          error_stack: err.stack?.slice(0, 2000) ?? null,
          total_steps: 0,
          result: 'failed',
          exploration_mode: 'queue',
        };
      }

      // 3. Cleanup policy
      if (result !== 'failed' && gameId) {
        // Completed/stopped: clean up Discord channels
        try {
          const game = getGame(gameId);
          if (game) {
            await deleteGameChannelsAndGame(game, gameId, cleanupCtx);
          }
        } catch (err) {
          console.error(`[self-play-queue] Cleanup failed for ${gameId}:`, err.message);
        }
      }
      // Failed runs: SKIP cleanup — preserve Discord channels for human inspection

      // 4. Post summary to logChannel
      const summary = [
        `**Run #${runNum}** — ${scenarioId} (${scenarioIdx + 1}/${scenarios.length})`,
        `Result: **${result}** | Stop: ${artifact?.stop_reason || 'unknown'}`,
        `Steps: ${artifact?.total_steps ?? 0} | Handlers: ${artifact?.exercised_handlers?.length ?? '?'} | Actions: ${artifact?.seen_action_types?.length ?? '?'}`,
      ].join('\n');
      try {
        await logChannel.send(summary);
      } catch {}

      // 5. On failure: post to bot-logs, then pause
      if (result === 'failed') {
        failCount++;
        if (botLogsPost) {
          try { await botLogsPost(artifact); } catch {}
        }
        pauseQueue(`auto: ${artifact?.stop_reason || 'unknown'}`);
      }

      // 6. Increment counters
      runCount++;
      rotationIndex++;

      // 7. Inter-game delay (skip if paused/draining — the pause gate handles wait)
      if (queueState === 'running' && interGameDelayMs > 0) {
        await new Promise(r => setTimeout(r, interGameDelayMs));
      }
    }
  } finally {
    queueState = 'idle';
    queueOpts = null;
    currentRunScenario = null;
    console.log(`[self-play-queue] Queue stopped. Runs: ${runCount}, Failures: ${failCount}`);
  }
}
