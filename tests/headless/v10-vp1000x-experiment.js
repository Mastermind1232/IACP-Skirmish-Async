/**
 * v10 VP 1000x Experiment — Flat-only, 250 train + 50 eval.
 *
 * Tests whether making VP signal overwhelmingly dominant (vp: 10000.0)
 * forces the DQN to learn kill-chain credit assignment.
 *
 * All other shaping kept at v8 halved values.
 * ATTACK_SHAPE_REWARD = 0.50 (kept).
 * Movement shaping halved: closing 0.075, engage 0.25, decision 0.15.
 * Eval uses argmax (not softmax).
 *
 * Baseline comparisons:
 *   v6 attack-shaping (argmax):          17.3 atk/g, 4.3 VP
 *   v9a kill-shape:                      217.8 atk/g, 0.0 VP  (FAIL)
 *   v9b zero-move:                       1.2 atk/g, 4.2 VP    (PARTIAL)
 *
 * Usage: node tests/headless/v10-vp1000x-experiment.js
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  setEncoderType, loadLearnings, saveLearnings,
  createGameTracer, pickSmartAction, abstractActionType, extractFeatures,
  replayUpdate, getLearningsStats, getQValues, checkDivergence,
  initializeNetwork, setGreedyMode, setVpWeight,
  recordMatchResult, setWeightDecay,
  ABSTRACT_TYPES,
} from './learnings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

// ── Config ───────────────────────────────────────────────────────────────────

const TRAIN_GAMES = 250;
const EVAL_GAMES = 50;
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function pickMatchup(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

function freshLearnings() {
  return {
    brainPhase: 5,
    meta: { totalGames: 0, p1Wins: 0, p2Wins: 0, lastUpdated: null, trainingHistory: [] },
    network: initializeNetwork(),
    trainingStats: {
      totalUpdates: 0, avgAbsDelta: 0, hiddenSize: 64,
      lastTargetSync: 0, targetSyncs: 0, nanResets: 0,
      tdErrorHistory: [], featureNames: [],
    },
    dcStats: {}, affiliationStats: {}, matchups: [],
    replayBuffer: { transitions: [], writeIdx: 0, count: 0 },
    withinGroupWeights: {
      attack: new Array(6).fill(0), move: new Array(9).fill(0),
      surge: new Array(4).fill(0), cc: new Array(4).fill(0),
    },
  };
}

// ── Game Loop (copied from graph-ab-experiment.js, with no-progress tracking) ──

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
  if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
  if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
    .inRound(1).build();
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
  let lastActionType = null;
  let sameTypeCount = 0;
  const ccFailureCounts = new Map();
  const CC_MAX_RETRIES = 3;
  const failedMoves = new Set();
  let lastMoveId = null;
  let moveActions = 0, attackActions = 0, endActivations = 0;
  let totalActivations = 0, passActivations = 0;
  let surgeSpends = 0, surgeSkips = 0;

  // No-progress tracking
  let lastRound = 1, lastP1VP = 0, lastP2VP = 0, noProgressRounds = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;
    if ((g.currentRound || 1) > MAX_ROUNDS) {
      const p1vp = g.player1VP?.total || 0;
      const p2vp = g.player2VP?.total || 0;
      g.ended = true;
      if (p1vp > p2vp) g.winnerId = g.player1Id;
      else if (p2vp > p1vp) g.winnerId = g.player2Id;
      else {
        const p1Figs = Object.keys(g.figurePositions?.[1] || {}).length;
        const p2Figs = Object.keys(g.figurePositions?.[2] || {}).length;
        if (p1Figs > p2Figs) g.winnerId = g.player1Id;
        else if (p2Figs > p1Figs) g.winnerId = g.player2Id;
        else g.winnerId = null;
      }
      break;
    }

    // Track round transitions for no-progress
    const curRound = g.currentRound || 1;
    if (curRound > lastRound) {
      const curP1VP = g.player1VP?.total || 0;
      const curP2VP = g.player2VP?.total || 0;
      const roundVPGain = (curP1VP + curP2VP) - (lastP1VP + lastP2VP);
      if (roundVPGain === 0) noProgressRounds++;
      lastP1VP = curP1VP;
      lastP2VP = curP2VP;
      lastRound = curRound;
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
        if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) return false;
        const ccKey = `P${a.actingPlayer}:${a.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
        if ((ccFailureCounts.get(ccKey) || 0) >= CC_MAX_RETRIES) return false;
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

    // Stuck-state detection
    if (allActions.length > 0 && allActions.every(a => a.type === lastActionType)) {
      sameTypeCount++;
      if (sameTypeCount > 30) {
        for (const key of Object.keys(g)) {
          if (key.startsWith('pending') && g[key] != null && key !== 'pendingCombat') {
            g[key] = key.endsWith('Choice') ? {} : null;
          }
        }
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Stuck-state breaker');
        else if (p1Figs.length > 0) await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Stuck-state breaker');
        sameTypeCount = 0; lastActionType = null;
        continue;
      }
    } else { sameTypeCount = 0; lastActionType = allActions[0]?.type; }

    // Failed move filtering
    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) failedMoves.clear();
    const filteredActions = allActions.filter(a => !(a.type === 'move_figure' && failedMoves.has(a.customId)));
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    // Determine acting player
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);
    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else { actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer; }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const tracer = actingPN === 1 ? tracer1 : tracer2;
    tracer.beforeAction(g, playerActions);
    const action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);
    if (!action) continue;

    // Track metrics
    if (action.type === 'move_figure') { moveActions++; lastMoveId = action.customId; }
    else if (action.type === 'dc_end_activation') endActivations++;
    else if (action.type === 'attack_target') attackActions++;
    else if (action.type === 'activate_dc') totalActivations++;
    else if (action.type === 'pass_activation_turn') passActivations++;
    const absType = abstractActionType(action, g);
    if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') surgeSpends++;
    if (absType === 'skip_surges') surgeSkips++;

    // Execute action
    if (action.type === 'interact') {
      const p = action.params;
      const actionsData = g.dcActionsData?.[p.msgId];
      if (actionsData && actionsData.remaining > 0) {
        actionsData.remaining = Math.max(0, actionsData.remaining - 1);
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
      } catch (err) {
        const ccKey = `P${action.actingPlayer}:${action.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
        ccFailureCounts.set(ccKey, (ccFailureCounts.get(ccKey) || 0) + 1);
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }
    if (action.type === 'strain_choice_discard') {
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
      try { await harness.submitAction(action.customId, userId); } catch {}
      let g2 = harness.getGame();
      let safetyLimit = 30;
      while (g2.pendingStrainChoice?.discardTarget > 0 &&
             (g2.pendingStrainChoice.discardedCount || 0) < g2.pendingStrainChoice.discardTarget &&
             safetyLimit-- > 0) {
        const hand = getCcHand(g2, g2.pendingStrainChoice.playerNum) || [];
        if (hand.length === 0) break;
        try { await harness.submitAction(`strain_cc_pick_${g2.gameId}_${encodeURIComponent(hand[0])}`, action.actingPlayer === 1 ? g2.player1Id : g2.player2Id); } catch { break; }
        g2 = harness.getGame();
      }
      if (g2.pendingStrainChoice) delete g2.pendingStrainChoice;
      tracer.afterAction(harness.getGame(), action);
      continue;
    }
    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    try { await harness.submitAction(action.customId, userId); } catch {}
    tracer.afterAction(harness.getGame(), action);
  }

  const finalGame = harness.getGame();
  if (!finalGame.ended) {
    finalGame.ended = true;
    const p1vp = finalGame.player1VP?.total || 0;
    const p2vp = finalGame.player2VP?.total || 0;
    if (p1vp > p2vp) finalGame.winnerId = finalGame.player1Id;
    else if (p2vp > p1vp) finalGame.winnerId = finalGame.player2Id;
  }
  tracer1.finalize(finalGame, true);
  tracer2.finalize(finalGame, false);
  replayUpdate(learnings);

  const winnerLabel = finalGame.winnerId === finalGame.player1Id ? 'P1' :
                      finalGame.winnerId === finalGame.player2Id ? 'P2' : null;
  recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStats, getDcEffects);

  // Final round VP check
  const finalP1VP = finalGame.player1VP?.total || 0;
  const finalP2VP = finalGame.player2VP?.total || 0;
  const finalRound = finalGame.currentRound || 1;
  if (finalRound > lastRound) {
    const roundVPGain = (finalP1VP + finalP2VP) - (lastP1VP + lastP2VP);
    if (roundVPGain === 0) noProgressRounds++;
  }

  return {
    ended: finalGame.ended,
    winnerLabel,
    p1VP: finalP1VP,
    p2VP: finalP2VP,
    finalRound,
    moveActions, attackActions, endActivations, totalActivations, passActivations,
    surgeSpends, surgeSkips, noProgressRounds,
    totalRounds: finalRound,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  v10 VP 1000x Experiment                                ║');
  console.log('║  VP weight: 10000.0 (1000x baseline)                    ║');
  console.log('║  ATTACK_SHAPE_REWARD = 0.50 (kept)                      ║');
  console.log('║  Move shaping halved: close=0.075 engage=0.25 dec=0.15  ║');
  console.log('║  Argmax eval (no softmax)                               ║');
  console.log('║  250 training + 50 greedy eval                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  setEncoderType('flat');
  setWeightDecay(0);
  setGreedyMode(false);
  setVpWeight(10000.0);  // 1000x baseline (10.0 → 10000.0)

  const learnings = freshLearnings();
  const results = [];
  const startTime = Date.now();

  // ── Training ──────────────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Training: FLAT + VP_1000x, ${TRAIN_GAMES} games`);
  console.log(`${'='.repeat(60)}`);

  for (let i = 0; i < TRAIN_GAMES; i++) {
    const result = await runOneGame(learnings, i);
    results.push(result);

    if ((i + 1) % 50 === 0) {
      const window = results.slice(i - 49, i + 1);
      const completed = window.filter(r => r.ended).length;
      const p1Wins = window.filter(r => r.winnerLabel === 'P1').length;
      const p2Wins = window.filter(r => r.winnerLabel === 'P2').length;
      const avgVP = window.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / window.length;
      const avgMoves = window.reduce((s, r) => s + r.moveActions, 0) / window.length;
      const avgAtk = window.reduce((s, r) => s + r.attackActions, 0) / window.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const td = learnings.trainingStats.avgAbsDelta;
      console.log(`  [${i + 1}/${TRAIN_GAMES}] ${elapsed}s | comp: ${completed}/50 | P1/P2: ${p1Wins}/${p2Wins} | avgVP: ${avgVP.toFixed(1)} | TD: ${td.toFixed(4)} | moves/g: ${avgMoves.toFixed(1)} | atk/g: ${avgAtk.toFixed(1)} | updates: ${learnings.trainingStats.totalUpdates}`);

      const div = checkDivergence(learnings);
      if (!div.ok) {
        console.error(`  !!! DIVERGENCE at game ${i + 1}: ${div.reasons.join(', ')}`);
        break;
      }
    }

    if ((i + 1) % 10 === 0 && (i + 1) % 50 !== 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`  [${i + 1}/${TRAIN_GAMES}] ${elapsed}s | updates: ${learnings.trainingStats.totalUpdates}\r`);
    }
  }

  const trainTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Training done: ${trainTime}s, ${learnings.trainingStats.totalUpdates} updates, ${learnings.trainingStats.nanResets} NaN resets`);

  // ── Greedy Eval (argmax) ────────────────────────────────────────────────

  setGreedyMode(true);
  const evalResults = [];
  const evalStart = Date.now();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Greedy Eval: ${EVAL_GAMES} games (argmax, epsilon=0)`);
  console.log(`${'='.repeat(60)}`);

  for (let i = 0; i < EVAL_GAMES; i++) {
    const gameNum = TRAIN_GAMES + i;
    const result = await runOneGame(learnings, gameNum);
    evalResults.push(result);

    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - evalStart) / 1000).toFixed(1);
      const window = evalResults.slice(Math.max(0, evalResults.length - 10));
      const avgAtk = window.reduce((s, r) => s + r.attackActions, 0) / window.length;
      const avgVP = window.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / window.length;
      console.log(`  [${i + 1}/${EVAL_GAMES}] ${elapsed}s | atk/g: ${avgAtk.toFixed(1)} | VP: ${avgVP.toFixed(1)}`);
    }
  }

  setGreedyMode(false);
  const evalTime = ((Date.now() - evalStart) / 1000).toFixed(1);

  // ── Results ───────────────────────────────────────────────────────────────

  const n = evalResults.length;
  const completed = evalResults.filter(r => r.ended).length;
  const p1Wins = evalResults.filter(r => r.winnerLabel === 'P1').length;
  const p2Wins = evalResults.filter(r => r.winnerLabel === 'P2').length;
  const avgVP = evalResults.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / n;
  const avgAtk = evalResults.reduce((s, r) => s + r.attackActions, 0) / n;
  const avgMoves = evalResults.reduce((s, r) => s + r.moveActions, 0) / n;
  const avgRound = evalResults.reduce((s, r) => s + r.finalRound, 0) / n;
  const avgEnd = evalResults.reduce((s, r) => s + r.endActivations, 0) / n;
  const totalSurgeSpend = evalResults.reduce((s, r) => s + r.surgeSpends, 0);
  const totalSurgeSkip = evalResults.reduce((s, r) => s + r.surgeSkips, 0);
  const surgeRate = (totalSurgeSpend + totalSurgeSkip) > 0
    ? (totalSurgeSpend / (totalSurgeSpend + totalSurgeSkip) * 100).toFixed(1) : 'N/A';

  const totalRounds = evalResults.reduce((s, r) => s + r.totalRounds, 0);
  const totalNoProgress = evalResults.reduce((s, r) => s + r.noProgressRounds, 0);
  const noProgressRate = totalRounds > 0 ? (totalNoProgress / totalRounds * 100).toFixed(1) : 'N/A';
  const vpPerRound = totalRounds > 0 ? (evalResults.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / totalRounds).toFixed(2) : 'N/A';

  const trainAvgVP = results.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / results.length;
  const trainAvgAtk = results.reduce((s, r) => s + r.attackActions, 0) / results.length;

  console.log('\n' + '='.repeat(60));
  console.log('v10 VP 1000x RESULTS');
  console.log('='.repeat(60));
  console.log('');
  console.log(`                       TRAIN (${TRAIN_GAMES})    v10 EVAL     v6(atk shp)  v9b(zero mv)`);
  console.log(`  VP/game:             ${trainAvgVP.toFixed(1).padEnd(15)}${avgVP.toFixed(1).padEnd(13)}${'4.3'.padEnd(13)}4.2`);
  console.log(`  VP/round:            ${'-'.padEnd(15)}${vpPerRound.padEnd(13)}${'-'.padEnd(13)}-`);
  console.log(`  Attacks/game:        ${trainAvgAtk.toFixed(1).padEnd(15)}${avgAtk.toFixed(1).padEnd(13)}${'17.3'.padEnd(13)}1.2`);
  console.log(`  Moves/game:          ${(results.reduce((s, r) => s + r.moveActions, 0) / results.length).toFixed(1).padEnd(15)}${avgMoves.toFixed(1).padEnd(13)}${'200.1'.padEnd(13)}187.6`);
  console.log(`  Win rate:            ${((results.filter(r => r.winnerLabel).length / results.length) * 100).toFixed(1)}%${' '.repeat(11)}${((p1Wins + p2Wins) / n * 100).toFixed(1)}%${' '.repeat(9)}${'80.0%'.padEnd(13)}76.0%`);
  console.log(`  Avg rounds:          ${(results.reduce((s, r) => s + r.finalRound, 0) / results.length).toFixed(1).padEnd(15)}${avgRound.toFixed(1).padEnd(13)}${'9.4'.padEnd(13)}8.8`);
  console.log(`  No-progress rate:    ${'-'.padEnd(15)}${noProgressRate}%${' '.repeat(10 - noProgressRate.length)}${'88.7%'.padEnd(13)}88.0%`);
  console.log(`  Surge spend rate:    ${'-'.padEnd(15)}${surgeRate}%${' '.repeat(10 - String(surgeRate).length)}${'N/A'.padEnd(13)}N/A`);
  console.log(`  NaN resets:          ${learnings.trainingStats.nanResets}`);
  console.log(`  End activations/g:   ${'-'.padEnd(15)}${avgEnd.toFixed(1)}`);

  // ── Promotion Gate ────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('PROMOTION GATE (greedy eval)');
  console.log('='.repeat(60));

  const vpPass = avgVP >= 3.0;
  const atkPass = avgAtk >= 50;
  const nanPass = learnings.trainingStats.nanResets === 0;
  const noSpam = avgAtk <= 200;
  const vpGuard = avgVP >= 2.0;
  const noProgNum = parseFloat(noProgressRate);
  const noProgPass = !isNaN(noProgNum) && noProgNum <= 20;

  console.log(`  VP/game >= 3.0:      ${avgVP.toFixed(1)}  ${vpPass ? 'PASS' : 'FAIL'}`);
  console.log(`  Attacks/game >= 50:  ${avgAtk.toFixed(1)}  ${atkPass ? 'PASS' : 'FAIL'}`);
  console.log(`  NaN resets = 0:      ${learnings.trainingStats.nanResets}  ${nanPass ? 'PASS' : 'FAIL'}`);
  console.log(`  No attack spam:      ${avgAtk.toFixed(1)} <= 200  ${noSpam ? 'PASS' : 'FAIL'}`);
  console.log(`  VP guard >= 2.0:     ${avgVP.toFixed(1)}  ${vpGuard ? 'PASS' : 'FAIL'}`);
  console.log(`  No-progress <= 20%:  ${noProgressRate}%  ${noProgPass ? 'PASS' : 'FAIL'}`);

  const allPass = vpPass && atkPass && nanPass && noSpam && vpGuard && noProgPass;
  const rollback = !vpGuard || !nanPass || !noSpam;

  console.log('');
  if (rollback) {
    console.log('  >>> VERDICT: ROLLBACK — guard rail violated');
  } else if (allPass) {
    console.log('  >>> VERDICT: SUCCESS — VP dominance works');
  } else {
    console.log('  >>> VERDICT: PARTIAL — improvement but not yet promotable');
    if (!vpPass) console.log('      - VP still below 3.0 threshold');
    if (!atkPass) console.log('      - Attacks still below 50/game threshold');
    if (!noProgPass) console.log('      - No-progress rate above 20%');
  }

  // ── Save checkpoint ───────────────────────────────────────────────────────

  const checkpointPath = join(__dirname, 'learnings-data-v10-vp1000x.json');
  saveLearnings(learnings, checkpointPath);
  console.log(`\nCheckpoint: ${checkpointPath}`);
  console.log(`Train time: ${trainTime}s | Eval time: ${evalTime}s`);

  console.log('\n' + '='.repeat(60));
  console.log('EXPERIMENT COMPLETE');
  console.log('='.repeat(60));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
