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
    'chopper-base-atollon': {
      p1: [{dcName: 'Hera Syndulla'}, {dcName: 'Rebel Trooper (Regular)'}],
      p2: [{dcName: 'Boba Fett'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'lothal-wastes': {
      p1: [{dcName: 'Ezra Bridger'}, {dcName: 'Rebel Trooper (Regular)'}],
      p2: [{dcName: 'Agent Kallus'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'devaron-garrison': {
      p1: [{dcName: 'Cassian Andor'}, {dcName: 'Rebel Trooper (Regular)'}],
      p2: [{dcName: 'Darth Vader'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'anchorhead-cantina-bar': {
      p1: [{dcName: 'Han Solo (Rebel Hero)'}, {dcName: 'Chewbacca'}],
      p2: [{dcName: 'Boba Fett'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'development-facility': {
      p1: [{dcName: 'Ahsoka Tano'}, {dcName: 'Rebel Trooper (Regular)'}],
      p2: [{dcName: 'Darth Vader'}, {dcName: 'Stormtrooper (Regular)'}],
    },
    'hoth-battle-station': {
      p1: [{dcName: 'Luke Skywalker (Jedi Knight)'}, {dcName: 'Rebel Trooper (Regular)'}],
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
  // status_phase has an isTestGame fast-path that lets a single click advance
  // both players' end-of-phase flags. Without it, both player IDs must click.
  game.isTestGame = true;

  const outStream = fs.createWriteStream(outPath);
  const harness = createRecordingHarness(game, {
    outStream, deps, dcMessageMeta, dcExhaustedState, dcHealthState,
    lightweight: true,
  });
  const PLAYER1_ID = game.player1Id || 'player1';
  const PLAYER2_ID = game.player2Id || 'player2';
  const userIdFor = (p) => (p === 2 ? PLAYER2_ID : PLAYER1_ID);

  let actionsDone = 0;
  let noProgressCount = 0;
  // Diversify by skipping consecutive identical actions.
  let lastCustomId = null;
  let sameCount = 0;

  // Pick whichever player has actionable choices. The harness clones the
  // game internally; reading the live clone via harness.getGame() is the
  // only way to see post-activation state. Forward-progress preference:
  // a player whose only available action is progress-averse (status_phase,
  // *_unready) should be passed over in favor of their opponent who has
  // a progressive option — otherwise the recorder oscillates on phase gates.
  function pickPlayerAndActions() {
    const liveGame = harness.getGame();
    const declared = liveGame.activePlayer;
    const actionsFor = (p) => {
      try { return getAvailableActions(liveGame, p, deps) || []; }
      catch { return []; }
    };
    const a1 = actionsFor(1);
    const a2 = actionsFor(2);
    const fwd = (xs) => xs.filter((a) => !PROGRESS_AVERSE_PREFIXES_BOUND.some((p) => String(a.customId || '').startsWith(p)));
    if (declared === 1 && fwd(a1).length) return { player: 1, actions: a1, live: liveGame };
    if (declared === 2 && fwd(a2).length) return { player: 2, actions: a2, live: liveGame };
    const fwd1 = fwd(a1), fwd2 = fwd(a2);
    if (fwd1.length && fwd2.length) {
      const p1Acts = (liveGame.p1ActivatedDcIndices || []).length;
      const p2Acts = (liveGame.p2ActivatedDcIndices || []).length;
      const player = p1Acts <= p2Acts ? 1 : 2;
      return { player, actions: player === 1 ? a1 : a2, live: liveGame };
    }
    if (fwd1.length) return { player: 1, actions: a1, live: liveGame };
    if (fwd2.length) return { player: 2, actions: a2, live: liveGame };
    if (a1.length) return { player: 1, actions: a1, live: liveGame };
    if (a2.length) return { player: 2, actions: a2, live: liveGame };
    return { player: 0, actions: [], live: liveGame };
  }
  // Closure-bound list (the const inside the loop body isn't visible here).
  const PROGRESS_AVERSE_PREFIXES_BOUND = ['status_phase_', 'phase_gate_unready_'];

  // Deprioritize buttons that walk back progress: status_phase ends a round
  // (we want to play more first) and *_unready toggles undo the readiness we
  // just established, sending the recorder into oscillation loops.
  const PROGRESS_AVERSE_PREFIXES = [
    'status_phase_',
    'phase_gate_unready_',
  ];
  const isProgressAverse = (cid) =>
    PROGRESS_AVERSE_PREFIXES.some((p) => String(cid || '').startsWith(p));

  while (actionsDone < ACTIONS_PER_GAME && noProgressCount < 15) {
    const { actions, player } = pickPlayerAndActions();
    if (!actions.length) { noProgressCount += 1; continue; }
    const progressivePool = actions.filter((a) => !isProgressAverse(a.customId));
    let pool = progressivePool.length ? progressivePool : actions;
    if (lastCustomId && sameCount >= 2) {
      const filtered = pool.filter((a) => a.customId !== lastCustomId);
      // Falling back: stay within the progressive pool — falling back to
      // `actions` would let progress-averse buttons (status_phase, *_unready)
      // sneak in and undo the readiness we just established.
      if (filtered.length) pool = filtered;
    }
    const best = pickRandomAction(pool);
    if (!best) { noProgressCount += 1; continue; }
    try {
      // Use the player-specific user id so handlers like phase_gate_ready_
      // and status_phase_ correctly attribute the click. The recorder's
      // pickPlayerAndActions already filtered to a player who has actions —
      // matching userId lets the JS handler accept the button without
      // "not your turn" rejections.
      await harness.submitAction(best.customId, userIdFor(player), best.opts || {});
      actionsDone += 1;
      noProgressCount = 0;
      if (best.customId === lastCustomId) sameCount += 1;
      else { lastCustomId = best.customId; sameCount = 0; }
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
    const outPath = path.join(OUT_DIR, `${MAP_ID}_game_${String(i).padStart(3, '0')}.jsonl`);
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
