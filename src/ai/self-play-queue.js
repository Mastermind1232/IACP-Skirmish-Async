/**
 * Self-play queue runner: cycles through scenarios or auto-selected seeds,
 * captures execution traces, pauses on failures for human review.
 *
 * Modes:
 * - Scenario mode (default): deterministic round-robin through CC scenarios.
 * - Seed mode: auto-selects highest-ranked unvalidated headless seed each run.
 */

import { runSelfPlayLoop, getActiveSelfPlayGameId, formatCoverageSummary } from './self-play.js';

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
    seedMode: queueOpts?.seedMode ?? false,
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
    interGameDelayMs = 5000, delayMs = 200,
    feedbackChannel, logChannel, saveGames,
    botLogsPost,
    seedMode = false, getNextSeed, onSeedRunComplete,
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

      // ── Seed mode: auto-select from ranked headless exploration data ──
      let scenarioId, scenarioIdx, seedConfig;
      if (seedMode && getNextSeed) {
        const seed = await getNextSeed();
        if (!seed) {
          console.log('[self-play-queue] No more seeds available. Stopping.');
          break;
        }
        scenarioId = `seed:${seed.p1Deck.name}_vs_${seed.p2Deck.name}@${seed.mapId}`;
        seedConfig = { mapId: seed.mapId, p1Deck: seed.p1Deck, p2Deck: seed.p2Deck };
        scenarioIdx = null;
        currentRunScenario = seed.seedKey;
      } else {
        scenarioIdx = rotationIndex % scenarios.length;
        scenarioId = scenarios[scenarioIdx];
        seedConfig = null;
        currentRunScenario = scenarioId;
      }

      const runNum = runCount + 1;
      const scenarioLabel = seedConfig
        ? `seed: ${currentRunScenario}`
        : `scenario ${scenarioId} (${scenarioIdx + 1}/${scenarios.length})`;
      console.log(`[self-play-queue] Run #${runNum}: ${scenarioLabel}`);

      let gameId = null;
      let result = null;
      let artifact = null;

      try {
        // 1. Create game
        const aiP1 = `${AI_USER_PREFIX}1`;
        const aiP2 = `${AI_USER_PREFIX}2`;
        const createOpts = { player2Id: aiP2 };
        if (seedConfig) createOpts.seedConfig = seedConfig;
        const created = await createTestGame(client, guild, aiP1, seedConfig ? null : scenarioId, feedbackChannel, createOpts);
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
          delayMs,
          persistCompleted: true,
          explorationMode: seedConfig ? 'seed_validation' : 'queue',
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

      // 4. Seed-mode coverage persistence
      if (seedConfig && onSeedRunComplete && artifact) {
        try {
          await onSeedRunComplete(artifact, seedConfig);
        } catch (err) {
          console.error('[self-play-queue] onSeedRunComplete error:', err.message);
        }
      }

      // 5. Post structured coverage summary to logChannel
      const summary = artifact
        ? formatCoverageSummary(artifact, runNum)
        : `**Run #${runNum}** — ${scenarioLabel}\nResult: **${result}**`;
      console.log(summary);
      try {
        // Discord message limit is 2000 chars — truncate if needed
        const discordSummary = summary.length > 1950
          ? summary.slice(0, 1950) + '\n... (truncated)'
          : summary;
        await logChannel.send(`\`\`\`\n${discordSummary}\n\`\`\``);
      } catch {}

      // 6. On failure: post to bot-logs, then pause
      if (result === 'failed') {
        failCount++;
        if (botLogsPost) {
          try { await botLogsPost(artifact); } catch {}
        }
        pauseQueue(`auto: ${artifact?.stop_reason || 'unknown'}`);
      }

      // 7. Increment counters
      runCount++;
      if (!seedMode) rotationIndex++;

      // 8. Inter-game delay (skip if paused/draining — the pause gate handles wait)
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
