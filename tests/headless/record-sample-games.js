#!/usr/bin/env node
/**
 * Record a handful of short sample games as JSONL traces for the
 * Python full-game drift harness. Each trace captures initial state,
 * every action, and the dice-pool stream so Python can replay with
 * identical dice results.
 *
 * Usage:
 *   node tests/headless/record-sample-games.js [games=5] [outDir=python/parity/oracles/drift_traces]
 *
 * The traces are small (25-action games) and deterministic when
 * MATH_RANDOM_SEED is fixed via the run-setup harness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSetupSim } from './setup-harness.js';
import { createRecordingHarness } from './action-recorder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { pickRandomAction } from '../../src/ai/strategy.js';

const GAMES = parseInt(process.argv[2] || '5', 10);
const OUT_DIR = process.argv[3] || 'python/parity/oracles/drift_traces';

// Rough set of Discord button customIds to exercise in each sample:
// the harness auto-picks the first legal action from its queue, so we
// just need to nudge the game through a few turns.
const SAMPLE_ACTIONS_PER_GAME = 25;

async function recordOne(gameIndex, outPath) {
  // Deterministic seed: games share game-level ID across runs.
  const setupResult = await runSetupSim({
    p1: { squad: ['Luke Skywalker (Jedi Knight)', 'Rebel Trooper'] },
    p2: { squad: ['Darth Vader', 'Stormtrooper'] },
    mapId: 'dawn-of-rebellion',
    seed: 1000 + gameIndex,
  });
  const game = setupResult.game || setupResult;

  const outStream = fs.createWriteStream(outPath);
  const harness = createRecordingHarness(game, { outStream });

  let actionsDone = 0;
  let noProgressCount = 0;

  while (actionsDone < SAMPLE_ACTIONS_PER_GAME && noProgressCount < 5) {
    const curPlayer = game.activePlayer || 1;
    let actions;
    try {
      actions = getAvailableActions(game, curPlayer, {});
    } catch (e) {
      noProgressCount += 1;
      continue;
    }
    if (!actions || actions.length === 0) {
      noProgressCount += 1;
      continue;
    }
    // Random pick for breadth; deterministic via seeded RNG in setup.
    const best = pickRandomAction(actions);
    if (!best) { noProgressCount += 1; continue; }
    try {
      await harness.submitAction(best.customId, 'test-user', best.opts || {});
      actionsDone += 1;
      noProgressCount = 0;
    } catch (e) {
      noProgressCount += 1;
    }
  }

  outStream.end();
  return { gameIndex, actionsDone, outPath };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (let i = 0; i < GAMES; i++) {
    const outPath = path.join(OUT_DIR, `game_${String(i).padStart(3, '0')}.jsonl`);
    try {
      const r = await recordOne(i, outPath);
      results.push(r);
      process.stdout.write(`recorded ${outPath} (${r.actionsDone} actions)\n`);
    } catch (e) {
      process.stdout.write(`ERROR recording game ${i}: ${e.message}\n`);
    }
  }
  process.stdout.write(`\nTotal: ${results.length}/${GAMES} games recorded in ${OUT_DIR}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
