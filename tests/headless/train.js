/**
 * Multi-game training loop — runs N headless games with Q-learning.
 * Both players use pickSmartAction and learn from every game.
 *
 * Usage:
 *   node tests/headless/train.js [numGames] [--reset]
 *   node tests/headless/train.js 100        # Train 100 games
 *   node tests/headless/train.js 50 --reset # Wipe learnings and train 50
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import {
  loadLearnings, saveLearnings, createGameTracer,
  pickSmartAction, abstractActionType, getLearningsStats,
  recordMatchResult, replayUpdate, loadReplayBuffer, saveReplayBuffer,
} from './learnings.js';
import { unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEARNINGS_PATH = join(__dirname, 'learnings-data.json');
const REPLAY_BUFFER_PATH = join(__dirname, 'replay-buffer.json');
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

// Load Destruct test decks — 36 competitive decks with full DC + CC lists
const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const TEST_DECKS = JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));

/**
 * Pick a random matchup: two different decks from the test deck pool.
 * Returns { p1Deck, p2Deck } each with { name, dcList, ccList }.
 */
function pickMatchup(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  // Offset by roughly half the pool + prime step to avoid repeated pairings
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
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

  const hDeps = harness.getDeps();

  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapSpaces,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
  };

  const tracer1 = createGameTracer(learnings, 1, dcHealthState, dcMessageMeta);
  const tracer2 = createGameTracer(learnings, 2, dcHealthState, dcMessageMeta);

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;

  // CC failure retry guard: track failures scoped to game context
  // Key: "P{n}:{cardName}:R{round}:{roundPhase}:{activatingDcIdx}"
  const ccFailureCounts = new Map();  // key → count
  const CC_MAX_RETRIES = 3;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    // Round cap: force game end — higher VP wins, ties go to elimination count
    if ((g.currentRound || 1) > MAX_ROUNDS) {
      const p1vp = g.player1VP?.total || 0;
      const p2vp = g.player2VP?.total || 0;
      g.ended = true;
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
      if (a.type === 'play_cc') {
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

    if (action.type === 'move_figure') lastMoveId = action.customId;

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
    if (action.type === 'play_cc') {
      try {
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

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;

    try {
      await harness.submitAction(action.customId, userId);
      tracer.afterAction(harness.getGame(), action);
    } catch {
      tracer.afterAction(harness.getGame(), action);
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
  };
}

async function main() {
  const args = process.argv.slice(2);
  const numGames = parseInt(args.find(a => !a.startsWith('-')) || '50', 10);
  const reset = args.includes('--reset');

  const noReplay = args.includes('--no-replay');
  const learnings = reset ? loadLearnings('/dev/null') // fresh default
                          : loadLearnings(LEARNINGS_PATH);

  if (reset) {
    try { unlinkSync(REPLAY_BUFFER_PATH); } catch {}
  } else if (!noReplay) {
    loadReplayBuffer(learnings, REPLAY_BUFFER_PATH);
  }
  if (noReplay) {
    learnings.replayBuffer = null; // disable buffer storage + replay updates
  }

  const uniqueDcs = new Set();
  TEST_DECKS.forEach(d => d.dcList.forEach(dc => uniqueDcs.add(dc)));
  console.log(`Training ${numGames} games (starting from ${learnings.meta.totalGames} prior games)`);
  console.log(`  Deck pool: ${TEST_DECKS.length} decks, ${uniqueDcs.size} unique DCs`);
  if (reset) console.log('  (learnings reset)');

  let completed = 0;
  let p1Wins = 0;
  let p2Wins = 0;
  let totalVP = 0;
  let vpCount = 0;
  const perGameResults = [];
  const checkpoints = [];
  let cpCompleted = 0, cpP1 = 0, cpP2 = 0, cpVP = 0, cpGames = 0;
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
    });

    cpGames++;
    cpVP += gameVP;
    if (result.ended) {
      completed++;
      cpCompleted++;
      if (result.winnerLabel === 'P1') { p1Wins++; cpP1++; }
      if (result.winnerLabel === 'P2') { p2Wins++; cpP2++; }
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
      console.log(`  Avg |delta|: ${cp.avgAbsDelta} | Avg |w|: ${cp.avgAbsWeight} | epsilon: ${cp.epsilon}`);
      console.log(`  Updates this window: ${cp.updatesThisWindow} | Total: ${cp.totalUpdates}`);
      console.log(`  Replay buf: ${cp.replayBufSize} | Total stored: ${cp.replayTotalStored}`);
      console.log(`  NaN resets: ${cp.nanResets} | Wall: ${cp.wallTime}s`);
      // Reset window counters
      cpCompleted = 0; cpP1 = 0; cpP2 = 0; cpVP = 0; cpGames = 0;
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
      saveLearnings(learnings, LEARNINGS_PATH);
      if (!noReplay) saveReplayBuffer(learnings, REPLAY_BUFFER_PATH);
    }
  }

  saveLearnings(learnings, LEARNINGS_PATH);
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

  console.log(`\nLearnings saved to ${LEARNINGS_PATH}`);
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
