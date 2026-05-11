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
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

import {
  loadLearnings, saveLearnings,
  pickAgentAction, createAgentTracer,
  abstractActionType, getLearningsStats,
  recordMatchResult, replayUpdate, loadReplayBuffer, saveReplayBuffer,
} from './learnings.js';
import { unlinkSync } from 'fs';

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
const REPLAY_BUFFER_PATH = join(__dirname, 'replay-buffer.json');
const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const MAX_ITERATIONS = 50000;

function loadTestDecks() {
  return JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));
}

async function runArenaGame(arenaData, learnings, agent1, agent2) {
  // Build armies in the format the game builder expects
  const p1Army = agent1.army.dcList.map(n => ({ dcName: n }));
  const p2Army = agent2.army.dcList.map(n => ({ dcName: n }));

  let builder = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
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

  const hDeps = harness.getDeps();

  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  const tracer1 = createAgentTracer(learnings, 1, dcHealthState, dcMessageMeta, agent1.strategy.rewardMultipliers);
  const tracer2 = createAgentTracer(learnings, 2, dcHealthState, dcMessageMeta, agent2.strategy.rewardMultipliers);

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    // Prevent OOM: clear accumulated state every 200 iterations
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
    const allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      // Never unready a phase gate — wastes iterations in a ready/unready loop
      if (a.type === 'phase_gate_unready') return false;
      // Filter CC plays by deep precondition check
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        return canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps);
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
    // the game is likely in an unresolvable pending state. Force progress.
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
      const MANDATORY = ['phase_gate_ready', 'combat_gate', 'combat_roll',
        'dc_ability_choice', 'celebration_play', 'celebration_pass',
        'pounce_space', 'missile_salvo_die', 'missile_salvo_done',
        'power_token_choice', 'cover_fire_block', 'cover_fire_skip',
        'spread_pain_cond', 'negation_play', 'negation_let_resolve'];
      const turnMandatory = turnActions.some(a => MANDATORY.includes(a.type));
      const otherMandatory = otherActions.some(a => MANDATORY.includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else {
      actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
    }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const agent = actingPN === 1 ? agent1 : agent2;
    const tracer = actingPN === 1 ? tracer1 : tracer2;

    tracer.beforeAction(g, playerActions);
    const action = pickAgentAction(agent, playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);

    if (!action) continue;

    if (action.type === 'move_figure') lastMoveId = action.customId;

    // Intercept CC plays — resolve directly via headless path
    if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
      try {
        // Deduct activation actions for special-action CCs (matching Discord dc-play-area.js:801-808)
        if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[action.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (action.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0;
          }
        }
        await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
      } catch (err) {
        // CC play failed — continue (canResolveCcHeadless should prevent most failures)
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

  // Finalize
  const finalGame = harness.getGame();
  tracer1.finalize(finalGame, true);
  tracer2.finalize(finalGame, false);
  replayUpdate(learnings);

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
  } else {
    arenaData = loadArenaData(ARENA_PATH);
    if (Object.keys(arenaData.agents).length === 0) {
      arenaData.agents = initializePopulation(20, testDecks);
    }
  }

  const learnings = loadLearnings(LEARNINGS_PATH);
  if (reset) {
    try { unlinkSync(REPLAY_BUFFER_PATH); } catch {}
  } else {
    loadReplayBuffer(learnings, REPLAY_BUFFER_PATH);
  }
  const roster = Object.values(arenaData.agents);
  console.log(`Arena: ${roster.length} agents | Game ${arenaData.meta.totalGames} | Gen ${arenaData.meta.totalGenerations} | Training ${numGames}`);

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

    // Record DC/affiliation stats into learnings
    const winnerLabel = result.winnerAgentId === agent1.id ? 'P1' :
                        result.winnerAgentId === agent2.id ? 'P2' : null;
    const p1Army = agent1.army.dcList.map(n => ({ dcName: n }));
    const p2Army = agent2.army.dcList.map(n => ({ dcName: n }));
    recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStats, getDcEffects);

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
      console.log(`  Gen ${arenaData.meta.totalGenerations} | Top: ${sorted[0]?.name} (${Math.round(sorted[0]?.elo)})`);
    }

    // Progress + save every 25 games
    if ((i + 1) % 25 === 0 || i === numGames - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const sorted = Object.values(arenaData.agents).sort((a, b) => b.elo - a.elo);
      console.log(`  [${i + 1}/${numGames}] ${elapsed}s | ${sorted[0]?.name} (${Math.round(sorted[0]?.elo)}) | ${completed}/${i + 1} done`);
      saveArenaData(arenaData, ARENA_PATH);
      saveLearnings(learnings, LEARNINGS_PATH);
      saveReplayBuffer(learnings, REPLAY_BUFFER_PATH);
    }
  }

  // Final save
  saveArenaData(arenaData, ARENA_PATH);
  saveLearnings(learnings, LEARNINGS_PATH);
  saveReplayBuffer(learnings, REPLAY_BUFFER_PATH);

  // Final report
  const sorted = Object.values(arenaData.agents).sort((a, b) => b.elo - a.elo);
  console.log(`Done. ${arenaData.meta.totalGames} total | Gen ${arenaData.meta.totalGenerations} | Top 5:`);
  sorted.slice(0, 5).forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.name} (${Math.round(a.elo)}) ${a.stats.wins}W/${a.stats.losses}L`);
  });
}

main().catch(err => {
  console.error('Arena training failed:', err);
  process.exit(1);
});
