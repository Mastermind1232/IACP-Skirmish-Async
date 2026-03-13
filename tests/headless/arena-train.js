/**
 * Skirbo Arena — Evolutionary AI training loop.
 * 20 agents compete, evolve, and get smarter over generations.
 *
 * Usage:
 *   node tests/headless/arena-train.js [numGames] [--reset]
 *   node tests/headless/arena-train.js 100
 *   node tests/headless/arena-train.js 500 --reset
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { parseCoord } from '../../src/game/coords.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

import {
  loadLearnings, saveLearnings,
  pickAgentAction, createAgentTracer,
  abstractActionType, getLearningsStats,
  recordMatchResult,
} from './learnings.js';

import {
  loadArenaData, saveArenaData, initializePopulation, evolve,
} from './arena-agents.js';

import {
  calculateEloChange, updateAgentElo, updateAgentStats, selectMatchup,
} from './arena-elo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ARENA_PATH = join(__dirname, 'arena-data.json');
const LEARNINGS_PATH = join(__dirname, 'learnings-data.json');
const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const MAX_ITERATIONS = 1500;

function loadTestDecks() {
  return JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));
}

async function runArenaGame(arenaData, learnings, agent1, agent2) {
  // Build armies in the format the game builder expects
  const p1Army = agent1.army.dcList.map(n => ({ dcName: n }));
  const p2Army = agent2.army.dcList.map(n => ({ dcName: n }));

  let builder = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army);

  // Set CC decks if available
  if (agent1.army.ccList?.length > 0) {
    builder = builder.withPlayer1CcDeck(agent1.army.ccList);
  }
  if (agent2.army.ccList?.length > 0) {
    builder = builder.withPlayer2CcDeck(agent2.army.ccList);
  }

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
    .inRound(1)
    .build();

  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapSpaces,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
  };

  const tracer1 = createAgentTracer(learnings, 1, dcHealthState, dcMessageMeta, agent1.strategy.rewardMultipliers);
  const tracer2 = createAgentTracer(learnings, 2, dcHealthState, dcMessageMeta, agent2.strategy.rewardMultipliers);

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

    // Filter failed moves
    const filteredActions = allActions.filter(a => {
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      return true;
    });
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    // Determine acting player
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);

    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const turnMandatory = turnActions.some(a => ['phase_gate_ready', 'combat_ready', 'combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready', 'combat_ready', 'combat_roll'].includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else {
      actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
    }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const agent = actingPN === 1 ? agent1 : agent2;
    const tracer = actingPN === 1 ? tracer1 : tracer2;

    tracer.beforeAction(g);
    const action = pickAgentAction(agent, playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);

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

  // Finalize
  const finalGame = harness.getGame();
  tracer1.finalize(finalGame, true);
  tracer2.finalize(finalGame, false);

  const winnerId = finalGame.winnerId;
  let agent1Score, agent2Score, winnerAgentId;

  if (!finalGame.ended || !winnerId) {
    // Draw / non-completion
    agent1Score = 0.5;
    agent2Score = 0.5;
    winnerAgentId = null;
  } else if (winnerId === finalGame.player1Id) {
    agent1Score = 1.0;
    agent2Score = 0.0;
    winnerAgentId = agent1.id;
  } else {
    agent1Score = 0.0;
    agent2Score = 1.0;
    winnerAgentId = agent2.id;
  }

  return { ended: finalGame.ended || false, winnerAgentId, agent1Score, agent2Score };
}

async function main() {
  const args = process.argv.slice(2);
  const numGames = parseInt(args.find(a => !a.startsWith('-')) || '100', 10);
  const reset = args.includes('--reset');

  const testDecks = loadTestDecks();
  console.log(`Loaded ${testDecks.length} test decks for army seeding`);

  let arenaData;
  if (reset) {
    arenaData = {
      meta: {
        totalGames: 0,
        totalGenerations: 1,
        lastUpdated: null,
        settings: {
          populationSize: 20,
          matchesPerCycle: 50,
          kFactor: 32,
          mutationRate: 0.3,
          mutationStrength: 0.2,
          cullCount: 4,
          breedCount: 4,
        },
      },
      agents: initializePopulation(20, testDecks),
      matchHistory: [],
      evolutionLog: [],
    };
    console.log('Arena reset — initialized 20 agents');
  } else {
    arenaData = loadArenaData(ARENA_PATH);
    if (Object.keys(arenaData.agents).length === 0) {
      arenaData.agents = initializePopulation(20, testDecks);
      console.log('Initialized 20 agents (first run)');
    }
  }

  const learnings = loadLearnings(LEARNINGS_PATH);

  // Log initial roster
  const roster = Object.values(arenaData.agents).sort((a, b) => b.elo - a.elo);
  console.log(`\n=== SKIRBO ARENA ===`);
  console.log(`Population: ${roster.length} agents | Prior games: ${arenaData.meta.totalGames} | Generation: ${arenaData.meta.totalGenerations}`);
  console.log(`Training ${numGames} games\n`);

  const startTime = Date.now();
  let completed = 0;

  for (let i = 0; i < numGames; i++) {
    const agentsArray = Object.values(arenaData.agents);
    if (agentsArray.length < 2) {
      console.error('Not enough agents to match!');
      break;
    }

    const [agent1, agent2] = selectMatchup(agentsArray);
    let result;

    try {
      result = await runArenaGame(arenaData, learnings, agent1, agent2);
    } catch (err) {
      // Game crashed — treat as draw
      result = { ended: false, winnerAgentId: null, agent1Score: 0.5, agent2Score: 0.5 };
    }

    if (result.ended) completed++;

    // Update ELO
    const { changeA, changeB } = calculateEloChange(
      agent1.elo, agent2.elo, result.agent1Score, arenaData.meta.settings.kFactor
    );
    updateAgentElo(agent1, changeA, arenaData.meta.totalGames);
    updateAgentElo(agent2, changeB, arenaData.meta.totalGames);

    // Update win/loss stats
    if (result.winnerAgentId) {
      updateAgentStats(agent1, result.winnerAgentId === agent1.id);
      updateAgentStats(agent2, result.winnerAgentId === agent2.id);
    } else {
      // Draw: count as a game but no win/loss
      agent1.stats.games++;
      agent2.stats.games++;
    }

    // Match history
    arenaData.matchHistory.push({
      game: arenaData.meta.totalGames,
      agent1Id: agent1.id,
      agent1Name: agent1.name,
      agent2Id: agent2.id,
      agent2Name: agent2.name,
      winnerId: result.winnerAgentId,
      winnerName: result.winnerAgentId === agent1.id ? agent1.name :
                  result.winnerAgentId === agent2.id ? agent2.name : null,
      elo1Change: Math.round(changeA),
      elo2Change: Math.round(changeB),
    });
    if (arenaData.matchHistory.length > 500) {
      arenaData.matchHistory = arenaData.matchHistory.slice(-500);
    }

    arenaData.meta.totalGames++;

    // Evolution check
    if (arenaData.meta.totalGames % arenaData.meta.settings.matchesPerCycle === 0) {
      evolve(arenaData, testDecks);
      const sorted = Object.values(arenaData.agents).sort((a, b) => b.elo - a.elo);
      console.log(`\n  >>> EVOLUTION Gen ${arenaData.meta.totalGenerations} <<<`);
      const lastEvo = arenaData.evolutionLog[arenaData.evolutionLog.length - 1];
      if (lastEvo) {
        console.log(`      Culled: ${lastEvo.culled.map(c => `${c.name}(${c.elo})`).join(', ')}`);
        console.log(`      Bred:   ${lastEvo.bred.map(b => b.name).join(', ')}`);
      }
      console.log(`      Top: ${sorted[0]?.name} (${Math.round(sorted[0]?.elo)})\n`);
    }

    // Progress log every 10 games
    if ((i + 1) % 10 === 0 || i === numGames - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const sorted = Object.values(arenaData.agents).sort((a, b) => b.elo - a.elo);
      const avgElo = Math.round(sorted.reduce((s, a) => s + a.elo, 0) / sorted.length);
      const stats = getLearningsStats(learnings);
      console.log(
        `  [${i + 1}/${numGames}] ${elapsed}s | ` +
        `Gen ${arenaData.meta.totalGenerations} | ` +
        `Top: ${sorted[0]?.name} (${Math.round(sorted[0]?.elo)}) | ` +
        `Avg ELO: ${avgElo} | ` +
        `Completed: ${completed}/${i + 1} | ` +
        `States: ${stats.states >= 1000 ? (stats.states / 1000).toFixed(1) + 'K' : stats.states}`
      );
      // Save periodically
      saveArenaData(arenaData, ARENA_PATH);
      saveLearnings(learnings, LEARNINGS_PATH);
    }
  }

  // Final save
  saveArenaData(arenaData, ARENA_PATH);
  saveLearnings(learnings, LEARNINGS_PATH);

  // Final report
  const sorted = Object.values(arenaData.agents).sort((a, b) => b.elo - a.elo);
  console.log('\n=== ARENA RESULTS ===');
  console.log(`Total games: ${arenaData.meta.totalGames} | Generation: ${arenaData.meta.totalGenerations}`);
  console.log(`This batch: ${completed}/${numGames} completed`);
  console.log('\nLeaderboard:');
  sorted.slice(0, 10).forEach((a, i) => {
    const wr = a.stats.games > 0 ? ((a.stats.wins / a.stats.games) * 100).toFixed(0) : '—';
    console.log(
      `  ${String(i + 1).padStart(2)}. ${a.name.padEnd(24)} ` +
      `ELO: ${Math.round(a.elo).toString().padStart(5)} | ` +
      `${a.stats.wins}W/${a.stats.losses}L (${wr}%) | ` +
      `${a.affiliation}`
    );
  });
  console.log(`\nArena data saved to ${ARENA_PATH}`);
}

main().catch(err => {
  console.error('Arena training failed:', err);
  process.exit(1);
});
