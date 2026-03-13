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
import { parseCoord } from '../../src/game/coords.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  loadLearnings, saveLearnings, createGameTracer,
  pickSmartAction, abstractActionType, getLearningsStats,
  recordMatchResult,
} from './learnings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEARNINGS_PATH = join(__dirname, 'learnings-data.json');
const MAX_ITERATIONS = 1500;

// Army pool — rotate through different matchups for generalization
const ARMIES = [
  [{ dcName: 'Luke Skywalker' }, { dcName: 'Han Solo' }],
  [{ dcName: 'Darth Vader' }, { dcName: 'Stormtrooper (Elite)' }],
  [{ dcName: 'IG-88' }, { dcName: 'Stormtrooper (Regular)' }],
  [{ dcName: 'Luke Skywalker' }, { dcName: 'Stormtrooper (Regular)' }],
  [{ dcName: 'Darth Vader' }, { dcName: 'Han Solo' }],
  [{ dcName: 'IG-88' }, { dcName: 'Luke Skywalker' }],
];

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
  const p1Army = ARMIES[gameNum % ARMIES.length];
  const p2Army = ARMIES[(gameNum + 3) % ARMIES.length]; // Offset for variety

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .inRound(1)
    .build();

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

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    const p1Actions = getAvailableActions(g, 1, actionDeps);
    const p2Actions = getAvailableActions(g, 2, actionDeps);
    const allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
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

  const winnerLabel = finalGame.winnerId === finalGame.player1Id ? 'P1' :
                      finalGame.winnerId === finalGame.player2Id ? 'P2' : null;

  // Track per-DC and per-affiliation results
  recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStats, getDcEffects);

  return {
    ended: finalGame.ended || false,
    winnerId: finalGame.winnerId,
    winnerLabel,
    p1Army: p1Army.map(a => a.dcName).join(' + '),
    p2Army: p2Army.map(a => a.dcName).join(' + '),
    p1VP: finalGame.player1VP?.total || 0,
    p2VP: finalGame.player2VP?.total || 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const numGames = parseInt(args.find(a => !a.startsWith('-')) || '50', 10);
  const reset = args.includes('--reset');

  const learnings = reset ? loadLearnings('/dev/null') // fresh default
                          : loadLearnings(LEARNINGS_PATH);

  console.log(`Training ${numGames} games (starting from ${learnings.meta.totalGames} prior games)`);
  if (reset) console.log('  (learnings reset)');

  let completed = 0;
  let p1Wins = 0;
  let p2Wins = 0;
  const startTime = Date.now();

  for (let i = 0; i < numGames; i++) {
    const gameNum = learnings.meta.totalGames; // Use total for army rotation
    const result = await runOneGame(learnings, gameNum);

    if (result.ended) {
      completed++;
      if (result.winnerLabel === 'P1') p1Wins++;
      if (result.winnerLabel === 'P2') p2Wins++;
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
    }
  }

  saveLearnings(learnings, LEARNINGS_PATH);

  console.log('\n=== Training Complete ===');
  const stats = getLearningsStats(learnings);
  console.log(`Total games trained: ${stats.totalGames}`);
  console.log(`Weights: ${stats.weightCount} | Avg |w|: ${stats.avgAbsWeight.toFixed(4)}`);
  console.log(`Total updates: ${stats.totalUpdates} | Avg |delta|: ${stats.avgAbsDelta.toFixed(4)}`);
  console.log(`This batch — completed: ${completed}/${numGames}, P1 wins: ${p1Wins}, P2 wins: ${p2Wins}`);
  console.log(`All time — P1 wins: ${stats.p1Wins}, P2 wins: ${stats.p2Wins}`);
  console.log(`Exploration rate: ${(stats.epsilon * 100).toFixed(1)}%`);
  console.log(`Learnings saved to ${LEARNINGS_PATH}`);
}

main().catch(err => {
  console.error('Training failed:', err);
  process.exit(1);
});
