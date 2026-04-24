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
import { createTestGame } from '../fixtures/game-builder.js';
import { createRecordingHarness } from './action-recorder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { pickRandomAction } from '../../src/ai/strategy.js';

const GAMES = parseInt(process.argv[2] || '5', 10);
const OUT_DIR = process.argv[3] || 'python/parity/oracles/drift_traces';
const MAP_ID = process.argv[4] || 'dawn-of-rebellion';
const ACTIONS_PER_GAME = parseInt(process.argv[5] || '200', 10);

async function recordOne(gameIndex, outPath, mapId) {
  // Use game-builder to get a FULLY deployed game ready for round 1.
  // runSetupSim has a deployment-phase bug that produces empty
  // figurePositions; createTestGame().deployed().inRound(1) is the
  // reliable way to get to round-active with figures on the board.
  const armies = {
    'dawn-of-rebellion': {
      p1: [{dcName: 'Luke Skywalker (Jedi Knight)'}, {dcName: 'Rebel Trooper (Regular)'}],
      p2: [{dcName: 'Darth Vader'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'mos-eisley-outskirts': {
      p1: [{dcName: 'Han Solo (Rebel Hero)'}, {dcName: 'Chewbacca'}],
      p2: [{dcName: 'Boba Fett'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'corellian-underground': {
      p1: [{dcName: 'Ahsoka Tano'}, {dcName: 'Rebel Trooper (Regular)'}],
      p2: [{dcName: 'Darth Vader'}, {dcName: 'Stormtrooper (Regular)'}],
    },
  };
  const a = armies[mapId] || armies['dawn-of-rebellion'];
  const built = createTestGame()
    .lightweight()
    .withMap(mapId)
    .withPlayer1Army(a.p1)
    .withPlayer2Army(a.p2)
    .deployed()
    .inRound(1)
    .build();
  const { game, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = built;

  const outStream = fs.createWriteStream(outPath);
  const harness = createRecordingHarness(game, {
    outStream, deps, dcMessageMeta, dcExhaustedState, dcHealthState,
  });

  let actionsDone = 0;
  let noProgressCount = 0;
  // Diversify by skipping consecutive identical actions.
  let lastCustomId = null;
  let sameCount = 0;

  while (actionsDone < ACTIONS_PER_GAME && noProgressCount < 15) {
    const curPlayer = game.activePlayer || 1;
    let actions;
    try {
      actions = getAvailableActions(game, curPlayer, deps);
    } catch (e) {
      noProgressCount += 1;
      continue;
    }
    if (!actions || actions.length === 0) {
      noProgressCount += 1;
      continue;
    }
    // Prefer non-status-phase actions when available to exercise combat
    // / movement / CC play. Fall back to any if that's all there is.
    let pool = actions.filter((a) => !String(a.customId || '').startsWith('status_phase_'));
    if (pool.length === 0) pool = actions;
    // Avoid the same action three times in a row — usually a loop.
    if (lastCustomId && sameCount >= 2) {
      pool = pool.filter((a) => a.customId !== lastCustomId);
      if (pool.length === 0) pool = actions;
    }
    const best = pickRandomAction(pool);
    if (!best) { noProgressCount += 1; continue; }
    try {
      await harness.submitAction(best.customId, 'test-user', best.opts || {});
      actionsDone += 1;
      noProgressCount = 0;
      if (best.customId === lastCustomId) {
        sameCount += 1;
      } else {
        lastCustomId = best.customId;
        sameCount = 0;
      }
    } catch (e) {
      noProgressCount += 1;
    }
  }

  outStream.end();
  await new Promise((r) => outStream.on('close', r));
  return { gameIndex, actionsDone, outPath };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (let i = 0; i < GAMES; i++) {
    const outPath = path.join(OUT_DIR, `game_${String(i).padStart(3, '0')}.jsonl`);
    try {
      const r = await recordOne(i, outPath, MAP_ID);
      results.push(r);
      process.stdout.write(`recorded ${outPath} (${r.actionsDone} actions, map=${MAP_ID})\n`);
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
