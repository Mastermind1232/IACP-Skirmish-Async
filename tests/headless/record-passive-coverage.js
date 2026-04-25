#!/usr/bin/env node
/**
 * Record drift traces with army compositions specifically chosen to
 * exercise the Pattern C combat-passive ports landed in
 * `python/engine/mechanics/passive_combat.py`. Each pair pits a
 * character whose passive we just ported against a foil so the passive
 * actually gets a chance to fire during combat.
 *
 * Usage:
 *   node tests/headless/record-passive-coverage.js
 *
 * Output: drops 1 trace per (battery × game-index) pair into
 * python/parity/oracles/drift_traces/passive-coverage_<battery>_<idx>.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { createTestGame } from '../fixtures/game-builder.js';
import { createRecordingHarness } from './action-recorder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { pickRandomAction } from '../../src/ai/strategy.js';

const OUT_DIR = 'python/parity/oracles/drift_traces';
const MAP_ID = 'dawn-of-rebellion';
const ACTIONS_PER_GAME = 200;
const GAMES_PER_BATTERY = 2;

// Each battery targets one or more newly-ported Pattern C handlers.
const BATTERIES = [
  {
    label: 'aim-rebel-trooper',
    p1: [{ dcName: 'Rebel Trooper (Regular)' }, { dcName: 'Han Solo (Rebel Hero)' }],
    p2: [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Stormtrooper (Elite)' }],
    note: 'aim_rebel_trooper_reg + squad_training_stormtrooper both exercised',
  },
  {
    label: 'aim-rebel-elite',
    p1: [{ dcName: 'Rebel Trooper (Elite)' }, { dcName: 'Rebel Trooper (Regular)' }],
    p2: [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Stormtrooper (Regular)' }],
    note: 'aim_rebel_trooper_elite (target-damaged-by-group gate)',
  },
  {
    label: 'jawa-take-cover',
    p1: [{ dcName: 'Jawa Scavenger (Elite)' }, { dcName: 'Jawa Scavenger (Regular)' }],
    p2: [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Stormtrooper (Regular)' }],
    note: 'take_cover_jawa_elite + take_cover_jawa_reg defender bonuses',
  },
  {
    label: 'r2d2-lucky',
    p1: [{ dcName: 'R2-D2' }, { dcName: 'Rebel Trooper (Regular)' }],
    p2: [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Stormtrooper (Regular)' }],
    note: 'lucky_r2d2 post-roll Dodge → recover 2 HP',
  },
  {
    label: 'jet-trooper-agile',
    p1: [{ dcName: 'Rebel Trooper (Regular)' }, { dcName: 'Han Solo (Rebel Hero)' }],
    p2: [{ dcName: 'Jet Trooper (Elite)' }, { dcName: 'Jet Trooper (Regular)' }],
    note: 'agile_jet_trooper_elite + agile_jet_trooper_reg block→evade',
  },
  {
    label: 'dark-trooper-targeting',
    p1: [{ dcName: 'Dark Trooper Mk III' }, { dcName: 'Stormtrooper (Regular)' }],
    p2: [{ dcName: 'Rebel Trooper (Regular)' }, { dcName: 'Rebel Trooper (Regular)' }],
    note: 'adv_targeting_computer_dark_trooper auto-Focus',
  },
  {
    label: 'kotun-dead-precise',
    p1: [{ dcName: 'Ko-Tun Feralo' }, { dcName: 'Rebel Trooper (Regular)' }],
    p2: [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Stormtrooper (Regular)' }],
    note: 'dead_precise_kotun +2 Acc if no movement',
  },
  {
    label: 'verena-improvised-cover',
    p1: [{ dcName: 'Verena Talos' }, { dcName: 'Rebel Trooper (Regular)' }],
    p2: [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Stormtrooper (Regular)' }],
    note: 'improvised_cover_verena +1 Block when adj non-friendly',
  },
];

async function recordOne(battery, gameIndex, outPath) {
  const built = createTestGame()
    .lightweight()
    .withMap(MAP_ID)
    .withPlayer1Army(battery.p1)
    .withPlayer2Army(battery.p2)
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
    let pool = actions.filter((a) => !String(a.customId || '').startsWith('status_phase_'));
    if (pool.length === 0) pool = actions;
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
      if (best.customId === lastCustomId) sameCount += 1;
      else { lastCustomId = best.customId; sameCount = 0; }
    } catch (e) {
      noProgressCount += 1;
    }
  }

  outStream.end();
  await new Promise((r) => outStream.on('close', r));
  return { battery: battery.label, gameIndex, actionsDone, outPath };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const battery of BATTERIES) {
    for (let i = 0; i < GAMES_PER_BATTERY; i++) {
      const outPath = path.join(
        OUT_DIR,
        `passive-coverage_${battery.label}_${String(i).padStart(3, '0')}.jsonl`,
      );
      try {
        const r = await recordOne(battery, i, outPath);
        results.push(r);
        process.stdout.write(`recorded ${outPath} (${r.actionsDone} actions, battery=${battery.label})\n`);
      } catch (e) {
        process.stdout.write(`ERROR recording battery=${battery.label} game ${i}: ${e.message}\n`);
      }
    }
  }
  process.stdout.write(`\nTotal: ${results.length}/${BATTERIES.length * GAMES_PER_BATTERY} traces written.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
