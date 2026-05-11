/**
 * Diagnostic script — analyzes non-completing games to build a failure taxonomy.
 * Runs 100 games, captures detailed telemetry on every game, classifies failures.
 *
 * Usage: node tests/headless/diagnose-failures.js
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import {
  loadLearnings, createGameTracer,
  pickSmartAction, abstractActionType,
  replayUpdate, loadReplayBuffer,
} from './learnings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEARNINGS_PATH = join(__dirname, 'learnings-data.json');
const REPLAY_BUFFER_PATH = join(__dirname, 'replay-buffer.json');
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

function pickMatchup(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

async function diagnoseOneGame(learnings, gameNum) {
  const { p1Deck, p2Deck } = pickMatchup(gameNum);
  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  const builder = createTestGame()
    .lightweight()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army);

  if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
  if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
    .inRound(1)
    .build();

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

  // Telemetry counters
  const tel = {
    totalIterations: 0,
    actionTypeCounts: {},
    abstractTypeCounts: {},
    emptyActionRuns: 0,
    maxEmptyRun: 0,
    sameTypeStalls: 0,         // times stuck-state breaker fired
    deadlockBreakers: 0,       // times deadlock breaker fired
    attackCount: 0,
    moveCount: 0,
    passCount: 0,
    endActivationCount: 0,
    activateCount: 0,
    roundsReached: 1,
    crashCount: 0,
    crashTypes: [],
    vpByRound: { 1: { p1: 0, p2: 0 } },
    hpByRound: { 1: { p1: 0, p2: 0 } },
    figsByRound: { 1: { p1: 0, p2: 0 } },
    distByRound: {},
    pendingStatesAtEnd: [],
    lastActions: [],            // last 20 actions before end
    endReason: null,            // 'completed', 'round_cap', 'max_iterations', 'no_figures'
    // Phase/round tracking
    roundActionCounts: {},
    phaseAtEnd: null,
    roundPhaseAtEnd: null,
    moveInProgressAtEnd: false,
    pendingCombatAtEnd: false,
  };

  // Track initial HP
  let p1MaxHp = 0, p2MaxHp = 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta) continue;
    for (const [cur, max] of healthArr) {
      if (meta.playerNum === 1) p1MaxHp += max;
      else p2MaxHp += max;
    }
  }
  tel.hpByRound[1] = { p1: p1MaxHp, p2: p2MaxHp };
  tel.figsByRound[1] = {
    p1: Object.keys(game.figurePositions?.[1] || {}).length,
    p2: Object.keys(game.figurePositions?.[2] || {}).length,
  };

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;
  let currentEmptyRun = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) {
      tel.endReason = 'completed';
      break;
    }

    const round = g.currentRound || 1;
    tel.roundsReached = Math.max(tel.roundsReached, round);
    tel.totalIterations = i + 1;

    if (round > MAX_ROUNDS) {
      tel.endReason = 'round_cap';
      const p1vp = g.player1VP?.total || 0;
      const p2vp = g.player2VP?.total || 0;
      g.ended = true;
      if (p1vp > p2vp) g.winnerId = g.player1Id;
      else if (p2vp > p1vp) g.winnerId = g.player2Id;
      break;
    }

    // OOM prevention
    if (i > 0 && i % 200 === 0) {
      if (g.undoStack) g.undoStack = [];
      if (g.eventLog) g.eventLog = [];
      if (g.actionHistory) g.actionHistory = [];
      if (hDeps._actionLog) hDeps._actionLog.length = 0;
      if (hDeps._client?._sentMessages) hDeps._client._sentMessages.length = 0;
      if (hDeps._client?._channelCache) {
        for (const ch of hDeps._client._channelCache.values()) {
          if (ch._sentMessages) ch._sentMessages.length = 0;
          if (ch._messageStore) ch._messageStore.clear();
        }
      }
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
      if (a.type === 'phase_gate_unready') return false;
      if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        return canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps);
      }
      return true;
    });

    if (allActions.length === 0) {
      consecutiveEmpty++;
      currentEmptyRun++;
      if (currentEmptyRun > tel.maxEmptyRun) tel.maxEmptyRun = currentEmptyRun;
      if (consecutiveEmpty > 10) {
        tel.deadlockBreakers++;
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
        } else {
          tel.endReason = 'no_figures';
          break;
        }
        consecutiveEmpty = 0;
      }
      continue;
    }
    consecutiveEmpty = 0;
    currentEmptyRun = 0;

    // Stuck-state detection
    if (allActions.length > 0 && allActions.every(a => a.type === lastActionType)) {
      sameTypeCount++;
      if (sameTypeCount > 30) {
        tel.sameTypeStalls++;
        for (const key of Object.keys(g)) {
          if (key.startsWith('pending') && g[key] != null && key !== 'pendingCombat') {
            g[key] = key.endsWith('Choice') ? {} : null;
          }
        }
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

    // Move tracking
    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) {
      failedMoves.clear();
    }

    const filteredActions = allActions.filter(a => {
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      return true;
    });
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    // Player selection
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);
    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else {
      actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
    }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const tracer = actingPN === 1 ? tracer1 : tracer2;
    tracer.beforeAction(g, playerActions);
    const action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);

    if (!action) continue;

    // Count action types
    tel.actionTypeCounts[action.type] = (tel.actionTypeCounts[action.type] || 0) + 1;
    const absType = abstractActionType(action, g);
    tel.abstractTypeCounts[absType] = (tel.abstractTypeCounts[absType] || 0) + 1;

    if (absType === 'attack_close' || absType === 'attack_ranged') tel.attackCount++;
    if (absType.startsWith('move_')) tel.moveCount++;
    if (absType === 'pass') tel.passCount++;
    if (absType === 'end_activation') tel.endActivationCount++;
    if (absType === 'activate') tel.activateCount++;

    // Round-level tracking
    if (!tel.roundActionCounts[round]) tel.roundActionCounts[round] = 0;
    tel.roundActionCounts[round]++;

    // Track VP/HP/figs at round boundaries
    if (!tel.vpByRound[round]) {
      tel.vpByRound[round] = { p1: g.player1VP?.total || 0, p2: g.player2VP?.total || 0 };
      // HP remaining
      let p1Hp = 0, p2Hp = 0;
      for (const [msgId, healthArr] of dcHealthState) {
        const meta = dcMessageMeta.get(msgId);
        if (!meta) continue;
        for (const [cur] of healthArr) {
          if (meta.playerNum === 1) p1Hp += cur;
          else p2Hp += cur;
        }
      }
      tel.hpByRound[round] = { p1: p1Hp, p2: p2Hp };
      tel.figsByRound[round] = {
        p1: Object.keys(g.figurePositions?.[1] || {}).length,
        p2: Object.keys(g.figurePositions?.[2] || {}).length,
      };
    }

    // Track last 20 actions
    tel.lastActions.push({ type: action.type, absType, player: actingPN, round });
    if (tel.lastActions.length > 20) tel.lastActions.shift();

    if (action.type === 'move_figure') lastMoveId = action.customId;

    // Execute action
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
          g.launchPanelState = g.launchPanelState || {};
          g.launchPanelState[parts[0].toLowerCase()] = parts[1];
          if (action.actingPlayer === 1) g.p1LaunchPanelFlippedThisRound = true;
          else g.p2LaunchPanelFlippedThisRound = true;
        } else if (optionId?.startsWith('open_door_')) {
          const edgeKeys = optionId.replace('open_door_', '').split(',');
          g.openedDoors = g.openedDoors || [];
          for (const ek of edgeKeys) {
            if (!g.openedDoors.includes(ek)) g.openedDoors.push(ek);
          }
        }
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
      try {
        if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[action.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (action.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0;
          }
        }
        await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
      } catch {}
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    try {
      await harness.submitAction(action.customId, userId);
      tracer.afterAction(harness.getGame(), action);
    } catch (err) {
      tel.crashCount++;
      tel.crashTypes.push(action.type + ': ' + (err.message || '').slice(0, 80));
      tracer.afterAction(harness.getGame(), action);
    }
  }

  // Final state analysis
  const fg = harness.getGame();
  if (!tel.endReason) {
    tel.endReason = fg.ended ? 'completed' : 'max_iterations';
  }

  tel.phaseAtEnd = fg.phase;
  tel.roundPhaseAtEnd = fg.roundPhase;
  tel.moveInProgressAtEnd = !!(fg.moveInProgress && Object.keys(fg.moveInProgress).length > 0);
  tel.pendingCombatAtEnd = !!fg.pendingCombat;

  // Collect all pending states
  for (const key of Object.keys(fg)) {
    if (key.startsWith('pending') && fg[key] != null) {
      const val = fg[key];
      if (typeof val === 'object' && Object.keys(val).length === 0) continue;
      tel.pendingStatesAtEnd.push(key);
    }
  }

  // Final VP/HP
  const finalRound = fg.currentRound || tel.roundsReached;
  let p1FinalHp = 0, p2FinalHp = 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta) continue;
    for (const [cur] of healthArr) {
      if (meta.playerNum === 1) p1FinalHp += cur;
      else p2FinalHp += cur;
    }
  }

  // Finalize tracers
  tracer1.finalize(fg, true);
  tracer2.finalize(fg, false);
  replayUpdate(learnings);

  return {
    gameNum,
    p1Army: p1Deck.name,
    p2Army: p2Deck.name,
    completed: fg.ended && fg.winnerId != null,
    ended: fg.ended || false,
    endReason: tel.endReason,
    winnerId: fg.winnerId,
    p1VP: fg.player1VP?.total || 0,
    p2VP: fg.player2VP?.total || 0,
    p1FinalHp,
    p2FinalHp,
    p1MaxHp,
    p2MaxHp,
    p1Figs: Object.keys(fg.figurePositions?.[1] || {}).length,
    p2Figs: Object.keys(fg.figurePositions?.[2] || {}).length,
    totalIterations: tel.totalIterations,
    roundsReached: tel.roundsReached,
    attackCount: tel.attackCount,
    moveCount: tel.moveCount,
    passCount: tel.passCount,
    endActivationCount: tel.endActivationCount,
    activateCount: tel.activateCount,
    deadlockBreakers: tel.deadlockBreakers,
    sameTypeStalls: tel.sameTypeStalls,
    maxEmptyRun: tel.maxEmptyRun,
    crashCount: tel.crashCount,
    crashTypes: tel.crashTypes,
    phaseAtEnd: tel.phaseAtEnd,
    roundPhaseAtEnd: tel.roundPhaseAtEnd,
    moveInProgressAtEnd: tel.moveInProgressAtEnd,
    pendingCombatAtEnd: tel.pendingCombatAtEnd,
    pendingStatesAtEnd: tel.pendingStatesAtEnd,
    lastActions: tel.lastActions,
    roundActionCounts: tel.roundActionCounts,
    abstractTypeCounts: tel.abstractTypeCounts,
    actionTypeCounts: tel.actionTypeCounts,
    vpByRound: tel.vpByRound,
    hpByRound: tel.hpByRound,
    figsByRound: tel.figsByRound,
  };
}

function classifyFailure(result) {
  if (result.completed) return 'completed';

  // Round-cap: game reached 10+ rounds but nobody won by elimination or 40VP
  if (result.endReason === 'round_cap') {
    // Was it close? Check VP difference
    const vpDiff = Math.abs(result.p1VP - result.p2VP);
    const totalVP = result.p1VP + result.p2VP;

    // Both sides barely damaged each other
    const p1DmgDealt = result.p2MaxHp - result.p2FinalHp;
    const p2DmgDealt = result.p1MaxHp - result.p1FinalHp;
    const totalDmg = p1DmgDealt + p2DmgDealt;

    if (totalDmg < 5) return 'kiting_no_engagement';
    if (result.attackCount < 5) return 'no_attacks';
    if (totalVP > 20 && vpDiff < 5) return 'close_game_timeout';
    if (totalVP > 10) return 'slow_grind_timeout';
    return 'round_cap_low_activity';
  }

  // Max iterations hit
  if (result.endReason === 'max_iterations') {
    if (result.deadlockBreakers > 0 || result.sameTypeStalls > 0) {
      return 'deadlock_structural';
    }
    if (result.maxEmptyRun > 5) {
      return 'empty_action_stall';
    }
    // Check for loop patterns in last actions
    const lastTypes = result.lastActions.map(a => a.type);
    const uniqueLast = new Set(lastTypes);
    if (uniqueLast.size <= 2) {
      return 'action_loop_' + [...uniqueLast].join('+');
    }
    if (result.crashCount > 5) {
      return 'crash_heavy';
    }
    return 'iteration_exhaustion';
  }

  if (result.endReason === 'no_figures') return 'deadlock_no_figures';

  return 'unknown';
}

async function main() {
  const NUM_GAMES = 100;
  const learnings = loadLearnings(LEARNINGS_PATH);
  loadReplayBuffer(learnings, REPLAY_BUFFER_PATH);
  console.log(`Diagnosing ${NUM_GAMES} games (brain has ${learnings.meta.totalGames} games trained)`);

  const results = [];
  for (let i = 0; i < NUM_GAMES; i++) {
    const result = await diagnoseOneGame(learnings, i);
    result.failureClass = classifyFailure(result);
    results.push(result);
    if ((i + 1) % 10 === 0) {
      const comp = results.filter(r => r.completed).length;
      process.stdout.write(`  [${i + 1}/${NUM_GAMES}] completed: ${comp}/${i + 1}\n`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  const completed = results.filter(r => r.completed);
  const failed = results.filter(r => !r.completed);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`FAILURE TAXONOMY — ${NUM_GAMES} games, ${completed.length} completed, ${failed.length} failed`);
  console.log(`${'═'.repeat(70)}`);

  // 1. Failure class breakdown
  const classCounts = {};
  for (const r of results) {
    classCounts[r.failureClass] = (classCounts[r.failureClass] || 0) + 1;
  }
  console.log(`\n--- Failure Classification ---`);
  const sorted = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
  for (const [cls, count] of sorted) {
    const pct = (count / NUM_GAMES * 100).toFixed(0);
    console.log(`  ${cls.padEnd(35)} ${String(count).padStart(3)} (${pct}%)`);
  }

  // 2. End reason breakdown
  console.log(`\n--- End Reason ---`);
  const endReasons = {};
  for (const r of results) endReasons[r.endReason] = (endReasons[r.endReason] || 0) + 1;
  for (const [reason, count] of Object.entries(endReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(25)} ${count}`);
  }

  // 3. Completed vs failed stats
  console.log(`\n--- Completed Games (${completed.length}) ---`);
  if (completed.length > 0) {
    const avgIter = completed.reduce((s, r) => s + r.totalIterations, 0) / completed.length;
    const avgRounds = completed.reduce((s, r) => s + r.roundsReached, 0) / completed.length;
    const avgAtk = completed.reduce((s, r) => s + r.attackCount, 0) / completed.length;
    const avgVP = completed.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / completed.length;
    console.log(`  Avg iterations: ${avgIter.toFixed(0)}`);
    console.log(`  Avg rounds: ${avgRounds.toFixed(1)}`);
    console.log(`  Avg attacks: ${avgAtk.toFixed(1)}`);
    console.log(`  Avg total VP: ${avgVP.toFixed(1)}`);
  }

  console.log(`\n--- Failed Games (${failed.length}) ---`);
  if (failed.length > 0) {
    const avgIter = failed.reduce((s, r) => s + r.totalIterations, 0) / failed.length;
    const avgRounds = failed.reduce((s, r) => s + r.roundsReached, 0) / failed.length;
    const avgAtk = failed.reduce((s, r) => s + r.attackCount, 0) / failed.length;
    const avgVP = failed.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / failed.length;
    const avgDeadlock = failed.reduce((s, r) => s + r.deadlockBreakers, 0) / failed.length;
    const avgStalls = failed.reduce((s, r) => s + r.sameTypeStalls, 0) / failed.length;
    const avgCrashes = failed.reduce((s, r) => s + r.crashCount, 0) / failed.length;
    console.log(`  Avg iterations: ${avgIter.toFixed(0)}`);
    console.log(`  Avg rounds: ${avgRounds.toFixed(1)}`);
    console.log(`  Avg attacks: ${avgAtk.toFixed(1)}`);
    console.log(`  Avg total VP: ${avgVP.toFixed(1)}`);
    console.log(`  Avg deadlock breakers: ${avgDeadlock.toFixed(1)}`);
    console.log(`  Avg same-type stalls: ${avgStalls.toFixed(1)}`);
    console.log(`  Avg crashes: ${avgCrashes.toFixed(1)}`);
  }

  // 4. Pending states at end for failed games
  console.log(`\n--- Pending States at End (failed games) ---`);
  const pendingCounts = {};
  for (const r of failed) {
    for (const ps of r.pendingStatesAtEnd) {
      pendingCounts[ps] = (pendingCounts[ps] || 0) + 1;
    }
    if (r.moveInProgressAtEnd) pendingCounts['moveInProgress'] = (pendingCounts['moveInProgress'] || 0) + 1;
    if (r.pendingCombatAtEnd) pendingCounts['pendingCombat'] = (pendingCounts['pendingCombat'] || 0) + 1;
  }
  for (const [ps, count] of Object.entries(pendingCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ps.padEnd(35)} ${count}/${failed.length}`);
  }

  // 5. Phase at end for failed games
  console.log(`\n--- Phase/RoundPhase at End (failed games) ---`);
  const phaseCounts = {};
  for (const r of failed) {
    const key = `${r.phaseAtEnd || '?'}/${r.roundPhaseAtEnd || '?'}`;
    phaseCounts[key] = (phaseCounts[key] || 0) + 1;
  }
  for (const [ph, count] of Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ph.padEnd(35)} ${count}`);
  }

  // 6. Crash types
  const allCrashes = [];
  for (const r of results) allCrashes.push(...r.crashTypes);
  if (allCrashes.length > 0) {
    console.log(`\n--- Crash Types (${allCrashes.length} total) ---`);
    const crashCounts = {};
    for (const c of allCrashes) crashCounts[c] = (crashCounts[c] || 0) + 1;
    for (const [c, count] of Object.entries(crashCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${c.padEnd(60)} ${count}`);
    }
  }

  // 7. Action type distribution: completed vs failed
  console.log(`\n--- Abstract Action Distribution (avg per game) ---`);
  const allAbsTypes = new Set();
  for (const r of results) for (const t of Object.keys(r.abstractTypeCounts)) allAbsTypes.add(t);
  console.log(`  ${'Type'.padEnd(20)} ${'Completed'.padStart(10)} ${'Failed'.padStart(10)} ${'Ratio'.padStart(8)}`);
  for (const t of [...allAbsTypes].sort()) {
    const compAvg = completed.length > 0 ? completed.reduce((s, r) => s + (r.abstractTypeCounts[t] || 0), 0) / completed.length : 0;
    const failAvg = failed.length > 0 ? failed.reduce((s, r) => s + (r.abstractTypeCounts[t] || 0), 0) / failed.length : 0;
    const ratio = compAvg > 0 && failAvg > 0 ? (failAvg / compAvg).toFixed(2) : '-';
    console.log(`  ${t.padEnd(20)} ${compAvg.toFixed(1).padStart(10)} ${failAvg.toFixed(1).padStart(10)} ${String(ratio).padStart(8)}`);
  }

  // 8. Last 20 actions of 5 representative failed games
  console.log(`\n--- Last Actions of 5 Failed Games ---`);
  const failSample = failed.slice(0, 5);
  for (const r of failSample) {
    console.log(`\n  Game #${r.gameNum}: ${r.failureClass} | iters=${r.totalIterations} rounds=${r.roundsReached} VP=${r.p1VP}v${r.p2VP}`);
    console.log(`    Armies: ${r.p1Army} vs ${r.p2Army}`);
    console.log(`    Attacks: ${r.attackCount}, Moves: ${r.moveCount}, Pass: ${r.passCount}`);
    console.log(`    Deadlock breakers: ${r.deadlockBreakers}, Stalls: ${r.sameTypeStalls}, Crashes: ${r.crashCount}`);
    if (r.pendingStatesAtEnd.length > 0) console.log(`    Pending: ${r.pendingStatesAtEnd.join(', ')}`);
    console.log(`    Last 10 actions: ${r.lastActions.slice(-10).map(a => a.absType).join(' → ')}`);
  }

  // 9. Round-level analysis for failed games
  console.log(`\n--- Avg Actions Per Round (failed games) ---`);
  const roundTotals = {};
  const roundGameCounts = {};
  for (const r of failed) {
    for (const [round, count] of Object.entries(r.roundActionCounts)) {
      roundTotals[round] = (roundTotals[round] || 0) + count;
      roundGameCounts[round] = (roundGameCounts[round] || 0) + 1;
    }
  }
  for (const round of Object.keys(roundTotals).sort((a, b) => +a - +b)) {
    const avg = roundTotals[round] / roundGameCounts[round];
    console.log(`  Round ${round}: ${avg.toFixed(0)} actions (${roundGameCounts[round]} games reached it)`);
  }
}

main().catch(err => {
  console.error('Diagnosis failed:', err);
  process.exit(1);
});
