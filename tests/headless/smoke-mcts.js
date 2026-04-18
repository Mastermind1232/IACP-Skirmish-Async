#!/usr/bin/env node
/**
 * MCTS smoke test.
 *
 *   - Loads a checkpoint
 *   - Advances a game to a realistic mid-round state
 *   - Runs pickMctsAction with N=10, 25, 50
 *   - Asserts: returns a legal action; visits sum to numSims; state restores between calls.
 *   - Prints per-action visit histogram for eyeball-inspection.
 *
 * Run: node tests/headless/smoke-mcts.js
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { loadLearnings, initializeNetwork } from './learnings.js';
import { pickMctsAction } from '../../src/ai/mcts.js';
import { performance } from 'perf_hooks';

const SILENCED_ERRORS = [
  'Failed to update DC card after End Activation',
  'Failed to ready DC embed',
  'Failed to send End Turn prompt',
  'Failed to update DC card:',
  'Failed to dispatch next massive push',
  'Failed to render minimap',
];
const _origConsoleError = console.error;
console.error = function (msg, ...rest) {
  const s = typeof msg === 'string' ? msg : String(msg);
  for (const pat of SILENCED_ERRORS) if (s.startsWith(pat)) return;
  _origConsoleError.call(console, msg, ...rest);
};

async function autoResolvePhaseGates(harness, game, budget = 20) {
  let safety = budget;
  while (safety-- > 0 && game.phaseGate) {
    const gateId = `phase_gate_ready_${game.gameId}`;
    try { await harness.submitAction(gateId, game.player1Id); } catch {}
    if (game.phaseGate) {
      try { await harness.submitAction(gateId, game.player2Id); } catch {}
    }
  }
}

async function advanceNActions(harness, game, actionDeps, playerNum, n) {
  const userId = playerNum === 1 ? game.player1Id : game.player2Id;
  for (let i = 0; i < n; i++) {
    if (game.ended) return;
    const actions = getAvailableActions(game, playerNum, actionDeps);
    if (actions.length === 0) return;
    const a = actions.find(x => x.type === 'activate_dc') || actions[0];
    try { await harness.submitAction(a.customId, userId); } catch {}
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  console.log('=== MCTS Smoke Test ===\n');

  const builder = createTestGame()
    .lightweight()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
    .withPlayer1Army([{ dcName: 'storm-troopers' }, { dcName: 'royal-guards' }])
    .withPlayer2Army([{ dcName: 'rebel-troopers' }, { dcName: 'han-solo' }])
    .inRound(1);

  const { game, harness, dcMessageMeta, dcExhaustedState, dcHealthState } = builder.build();
  const hDeps = harness.getDeps();
  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  await autoResolvePhaseGates(harness, game);
  await advanceNActions(harness, game, actionDeps, 1, 4);
  await autoResolvePhaseGates(harness, game);
  await advanceNActions(harness, game, actionDeps, 2, 4);
  await autoResolvePhaseGates(harness, game);

  let learnings;
  try {
    learnings = loadLearnings('./tests/headless/learnings-data.json');
    console.log(`DQN: loaded (totalGames=${learnings.totalGames || '?'})`);
  } catch (e) {
    learnings = initializeNetwork();
    console.log(`DQN: fresh-init (${e.message})`);
  }

  const getLive = () => harness.getGamesMap().get(game.gameId);
  const getActivePN = (g) => {
    const tpid = g.currentActivationTurnPlayerId ?? g.initiativePlayerId;
    return tpid === g.player1Id ? 1 : (tpid === g.player2Id ? 2 : 1);
  };

  const playerNum = getActivePN(getLive());
  const rootActions = getAvailableActions(getLive(), playerNum, actionDeps);
  console.log(`Legal actions: ${rootActions.length}, activePN=${playerNum}`);

  if (rootActions.length === 0) {
    console.error('No legal actions at test state — aborting.');
    process.exit(1);
  }

  const stateBefore = JSON.stringify(getLive());
  const exhaustedBefore = JSON.stringify([...dcExhaustedState]);
  const healthBefore = JSON.stringify([...dcHealthState]);

  for (const numSims of [10, 25, 50]) {
    const t0 = performance.now();
    const result = await pickMctsAction({
      game: getLive(), playerNum, actionDeps, learnings, harness,
      dcHealthState, dcExhaustedState, dcMessageMeta,
      numSims, cPuct: 1.4, temp: 1.0,
    });
    const dt = performance.now() - t0;
    assert(result, `numSims=${numSims}: MCTS returned null`);
    assert(result.action, `numSims=${numSims}: no action in result`);
    assert(rootActions.some(a => a.customId === result.action.customId),
           `numSims=${numSims}: returned action not in legal set`);
    const visits = result.stats.rootVisits;
    const totalVisits = visits.reduce((a, b) => a + b, 0);
    assert(totalVisits === numSims,
           `numSims=${numSims}: visits sum ${totalVisits} !== ${numSims}`);
    const stateAfter = JSON.stringify(harness.getGamesMap().get(game.gameId));
    const exhaustedAfter = JSON.stringify([...dcExhaustedState]);
    const healthAfter = JSON.stringify([...dcHealthState]);
    assert(stateBefore === stateAfter, `numSims=${numSims}: game state not restored`);
    assert(exhaustedBefore === exhaustedAfter, `numSims=${numSims}: dcExhaustedState not restored`);
    assert(healthBefore === healthAfter, `numSims=${numSims}: dcHealthState not restored`);

    const top3 = visits
      .map((n, i) => ({ i, n, Q: result.stats.rootQs[i], a: rootActions[i] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    console.log(`\nnumSims=${numSims} (${dt.toFixed(1)}ms, ${(dt / numSims).toFixed(2)}ms/sim)`);
    console.log(`  pick: ${result.action.type} (score=${result.score.toFixed(3)})`);
    console.log(`  expansions=${result.stats.expansions}, terminals=${result.stats.terminalHits}, handlerErrors=${result.stats.handlerErrors}`);
    console.log(`  top-3 visits:`);
    for (const r of top3) console.log(`    [${r.i}] ${r.a.type.padEnd(20)} N=${r.n}  Q=${r.Q.toFixed(3)}  customId=${r.a.customId.slice(0, 60)}`);
  }

  console.log('\n✓ all asserts passed — state isolation and visit accounting OK');
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
