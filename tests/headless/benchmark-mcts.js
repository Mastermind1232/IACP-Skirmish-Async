#!/usr/bin/env node
/**
 * MCTS feasibility benchmark: measures the per-iteration cost of a tree-search
 * rollout against the current simulator.
 *
 * Measurements:
 *   [1] structuredClone(state)               — clone cost per MCTS branch
 *   [2] getAvailableActions(state, p)        — legal-move enumeration
 *   [3] pickSmartAction(...) (DQN eval)      — leaf-node value estimation
 *   [4] full cycle: clone + enumerate + step — atomic MCTS iteration
 *
 * Budget calculation: real MCTS does ~1 full cycle per simulation. At think
 * time T, the number of simulations per decision ≈ T / cycle_time.
 *
 * Run: node tests/headless/benchmark-mcts.js
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { pickSmartAction, loadLearnings, initializeNetwork } from './learnings.js';
import { performance } from 'perf_hooks';

const BENCH_ITERS = 1000;
const WARMUP_ITERS = 50;

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
    // Prefer an activate_dc to get into activation flow
    const a = actions.find(x => x.type === 'activate_dc') || actions[0];
    try { await harness.submitAction(a.customId, userId); } catch {}
  }
}

function fmtUs(ms) {
  return `${(ms * 1000).toFixed(1)} µs`;
}

function budgetLine(label, msPerOp) {
  const line = [50, 100, 250, 500].map(b => `${b}ms→${Math.floor(b / msPerOp)}`).join('  ');
  return `    ${label}: ${line}`;
}

async function main() {
  console.log('=== MCTS Feasibility Benchmark ===\n');

  // ── 1. Build a game and advance to a realistic mid-round state ──
  const builder = createTestGame()
    .lightweight()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
    .withPlayer1Army([{ dcName: 'storm-troopers' }, { dcName: 'royal-guards' }])
    .withPlayer2Army([{ dcName: 'rebel-troopers' }, { dcName: 'han-solo' }])
    .inRound(1);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder.build();
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

  const snapJson = JSON.stringify(game);
  const sizeKb = (snapJson.length / 1024).toFixed(1);
  const actionsSample = getAvailableActions(game, 1, actionDeps);
  console.log(`Mid-round state: round=${game.currentRound}, phase=${game.phase}, ended=${!!game.ended}`);
  console.log(`State size (JSON-serialized): ${sizeKb} KB`);
  console.log(`Legal actions (p1) at snapshot: ${actionsSample.length}`);
  console.log('');

  const snap = structuredClone(game);

  // ── 2. Load or init learnings for DQN eval ──
  let learnings;
  try {
    learnings = loadLearnings('./tests/headless/learnings-data.json');
    console.log(`DQN: loaded checkpoint (totalGames=${learnings.totalGames || '?'})`);
  } catch (e) {
    learnings = initializeNetwork();
    console.log(`DQN: using fresh-init network (checkpoint load failed: ${e.message})`);
  }
  console.log('');

  // ── 3. Warmup ──
  for (let i = 0; i < WARMUP_ITERS; i++) {
    structuredClone(snap);
    getAvailableActions(snap, 1, actionDeps);
    pickSmartAction(actionsSample, snap, learnings, 1, dcHealthState, dcMessageMeta);
  }

  // ── 4. Benchmark: structuredClone ──
  {
    const t0 = performance.now();
    for (let i = 0; i < BENCH_ITERS; i++) structuredClone(snap);
    const t1 = performance.now();
    const msPerOp = (t1 - t0) / BENCH_ITERS;
    console.log(`[1] structuredClone(state)           ${fmtUs(msPerOp).padStart(10)}/op`);
    console.log(budgetLine('clones', msPerOp));
  }

  // ── 5. Benchmark: getAvailableActions ──
  {
    const t0 = performance.now();
    let sumActions = 0;
    for (let i = 0; i < BENCH_ITERS; i++) {
      const a = getAvailableActions(snap, 1, actionDeps);
      sumActions += a.length;
    }
    const t1 = performance.now();
    const msPerOp = (t1 - t0) / BENCH_ITERS;
    console.log(`[2] getAvailableActions(state, p)    ${fmtUs(msPerOp).padStart(10)}/op  (avg ${(sumActions / BENCH_ITERS).toFixed(1)} actions)`);
    console.log(budgetLine('enums', msPerOp));
  }

  // ── 6. Benchmark: DQN eval (pickSmartAction) ──
  {
    const actions = getAvailableActions(snap, 1, actionDeps);
    const t0 = performance.now();
    for (let i = 0; i < BENCH_ITERS; i++) {
      pickSmartAction(actions, snap, learnings, 1, dcHealthState, dcMessageMeta);
    }
    const t1 = performance.now();
    const msPerOp = (t1 - t0) / BENCH_ITERS;
    console.log(`[3] pickSmartAction (DQN fwd pass)   ${fmtUs(msPerOp).padStart(10)}/op`);
    console.log(budgetLine('evals ', msPerOp));
  }

  // ── 7. Benchmark: full MCTS-style iteration (with sub-timing) ──
  // Each iteration: clone snapshot → install as current game → enumerate → step once
  {
    const gamesMap = harness.getGamesMap();
    const origExhausted = new Map(dcExhaustedState);
    const origHealth = new Map(dcHealthState);
    let tClone = 0, tReset = 0, tEnum = 0, tStep = 0;
    const actionTypeHist = {};
    let okCount = 0;
    const tTotal0 = performance.now();
    for (let i = 0; i < BENCH_ITERS; i++) {
      let t = performance.now();
      const cloned = structuredClone(snap);
      tClone += performance.now() - t;

      t = performance.now();
      gamesMap.set(snap.gameId, cloned);
      dcExhaustedState.clear();
      for (const [k, v] of origExhausted) dcExhaustedState.set(k, v);
      dcHealthState.clear();
      for (const [k, v] of origHealth) dcHealthState.set(k, v);
      tReset += performance.now() - t;

      t = performance.now();
      const actions = getAvailableActions(cloned, 1, actionDeps);
      tEnum += performance.now() - t;

      if (actions.length > 0) {
        const action = actions[0];
        actionTypeHist[action.type] = (actionTypeHist[action.type] || 0) + 1;
        t = performance.now();
        try {
          await harness.submitAction(action.customId, cloned.player1Id);
          okCount++;
        } catch {}
        tStep += performance.now() - t;
      }
    }
    const tTotal = performance.now() - tTotal0;
    const msPerOp = tTotal / BENCH_ITERS;
    console.log(`[4] FULL CYCLE (clone+enum+step)     ${fmtUs(msPerOp).padStart(10)}/op  (${okCount}/${BENCH_ITERS} ok)`);
    console.log(`    breakdown: clone=${fmtUs(tClone/BENCH_ITERS)}  reset=${fmtUs(tReset/BENCH_ITERS)}  enum=${fmtUs(tEnum/BENCH_ITERS)}  step=${fmtUs(tStep/BENCH_ITERS)}`);
    console.log(`    action types executed: ${JSON.stringify(actionTypeHist)}`);
    console.log(budgetLine('sims  ', msPerOp));
    console.log('');
    console.log('── MCTS viability assessment ──');
    const sims100 = Math.floor(100 / msPerOp);
    const sims500 = Math.floor(500 / msPerOp);
    if (sims100 >= 1000) {
      console.log(`✓ STRONG: ${sims100} sims @ 100ms — full MCTS depth+width feasible out of the box`);
    } else if (sims100 >= 200) {
      console.log(`○ VIABLE: ${sims100} sims @ 100ms — usable but shallow; speedup recommended`);
    } else if (sims100 >= 50) {
      console.log(`△ MARGINAL: ${sims100} sims @ 100ms — need optimization or longer think time (${sims500} @ 500ms)`);
    } else {
      console.log(`✗ BLOCKED: ${sims100} sims @ 100ms — simulator speedup required before MCTS build`);
    }
  }
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
