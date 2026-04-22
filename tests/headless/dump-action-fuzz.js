#!/usr/bin/env node
/**
 * dump-action-fuzz.js — generate standalone (state, action, resultState)
 * fixtures for Python parity testing.
 *
 * Each output line is a complete ActionParityOracle fixture — no ordering
 * dependency between lines, so Python oracles can cherry-pick any action
 * type, load its fixture, and validate in isolation.
 *
 * Output format (one JSON object per line):
 *   {
 *     seq: integer,
 *     gameId: string,
 *     preState: <game state BEFORE action>,
 *     customId: string,
 *     userId: string,
 *     actionOpts: object | null,
 *     dicePools: { attack: {<color>: [idx...]}, defense: {...} },
 *     postState: <game state AFTER action>,
 *     ok: boolean,
 *     error?: string
 *   }
 *
 * Pre/post snapshots + dicePools are what a Python oracle needs to replay
 * any action deterministically. Seed-driven so runs are reproducible.
 *
 * Usage:
 *   node tests/headless/dump-action-fuzz.js --count 200 --seed 42 > fuzz.jsonl
 *   node tests/headless/dump-action-fuzz.js --count 50 --out fuzz.jsonl
 */
import fs from 'node:fs';
import { createHarness } from '../../src/headless/game-harness.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { setDiceRecorder, clearDiceHooks } from '../../src/game/combat.js';
import { runSetupSim } from './setup-harness.js';

function parseArgs(argv) {
  const args = { count: 200, seed: 42, out: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = parseInt(argv[++i], 10) || 200;
    else if (argv[i] === '--seed') args.seed = parseInt(argv[++i], 10) || 42;
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--verbose') args.verbose = true;
  }
  return args;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function snapshot(game) {
  return game ? JSON.parse(JSON.stringify(game)) : null;
}

// Canonical matchup pool. Expanded as more DCs get exercised by oracles.
const MATCHUPS = [
  {
    p1Army: [{ dcName: 'Luke Skywalker' }],
    p2Army: [{ dcName: 'Darth Vader' }],
  },
  {
    p1Army: [{ dcName: 'Rebel Trooper (Regular)' }],
    p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
  },
];

const STANDARD_CC_DECK = [
  'Take Initiative', 'Son of Skywalker', 'Adrenaline', 'Blaze of Glory',
  'Reinforcements', 'Negation', 'Celebration', 'Element of Surprise',
  'Strength in Numbers', 'Planning', 'Change of Plans', 'Recovery',
  'Urgency', 'Price on Their Heads', 'Glory of the Kill',
];
const IMPERIAL_CC_DECK = [
  'Take Initiative', 'Reinforcements', 'Negation', 'Celebration',
  'Element of Surprise', 'Strength in Numbers', 'Planning',
  'Change of Plans', 'Recovery', 'Urgency', 'Price on Their Heads',
  'Glory of the Kill', 'Adrenaline', 'Blaze of Glory', 'Maximum Firepower',
];

const MAP_POOL = [
  'mos-eisley-outskirts',
];

function pickMatchup(rand) {
  const m = MATCHUPS[Math.floor(rand() * MATCHUPS.length)];
  return {
    mapId: MAP_POOL[Math.floor(rand() * MAP_POOL.length)],
    p1Army: m.p1Army,
    p2Army: m.p2Army,
    p1CcDeck: STANDARD_CC_DECK,
    p2CcDeck: IMPERIAL_CC_DECK,
  };
}

/**
 * Pick the active player. For a game in ROUND_ACTIVE / activation
 * phase, legal actions may exist for either p1 or p2 depending on
 * turn-taking state; prefer the one with actions available.
 */
function pickActingPlayer(game) {
  for (const pn of [1, 2]) {
    const actions = getAvailableActions(game, pn);
    if (actions && actions.length) return pn;
  }
  return 1;
}

async function generateFixture(seed, seq) {
  const rand = mulberry32(seed);
  const cfg = pickMatchup(rand);

  // Build initial game via real setup chain.
  const setup = await runSetupSim(cfg);
  const game = setup.game;
  if (!game || (game.phase !== 'round_active' && game.phase !== 'activation')) {
    return { seq, skipped: true, reason: `setup did not reach round_active (phase=${game?.phase})` };
  }

  const playerNum = pickActingPlayer(game);
  const userId = playerNum === 1 ? game.player1Id : game.player2Id;
  const actions = getAvailableActions(game, playerNum) || [];
  if (actions.length === 0) {
    return { seq, skipped: true, reason: `no legal actions for player ${playerNum}` };
  }
  const action = actions[Math.floor(rand() * actions.length)];

  const preState = snapshot(game);

  // Install dice recorder for this action.
  const recorder = { pools: { attack: {}, defense: {} }, log: [] };
  setDiceRecorder(recorder);

  const harness = createHarness(game);
  let result, error;
  try {
    result = await harness.submitAction(action.customId, userId, {});
  } catch (e) {
    error = e.message || String(e);
  } finally {
    setDiceRecorder(null);
  }

  const postState = snapshot(harness.getGame());

  const dicePools = {
    attack: Object.fromEntries(
      Object.entries(recorder.pools.attack || {}).map(([c, q]) => [c, [...q]])
    ),
    defense: Object.fromEntries(
      Object.entries(recorder.pools.defense || {}).map(([c, q]) => [c, [...q]])
    ),
  };

  return {
    seq,
    gameId: game.gameId,
    preState,
    customId: action.customId,
    userId,
    actionOpts: null,
    dicePools,
    postState,
    ok: !error,
    ...(error ? { error } : {}),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ? fs.createWriteStream(args.out) : process.stdout;

  let emitted = 0;
  let skipped = 0;
  for (let i = 0; i < args.count; i++) {
    // Per-fixture seed = args.seed * 1e6 + i so each fixture is
    // independently reproducible.
    const caseSeed = (args.seed >>> 0) * 1000003 + i;
    try {
      const fixture = await generateFixture(caseSeed, i);
      out.write(JSON.stringify(fixture) + '\n');
      if (fixture.skipped) skipped++;
      else emitted++;
    } catch (e) {
      out.write(JSON.stringify({
        seq: i,
        skipped: true,
        reason: `error: ${e.message || String(e)}`,
      }) + '\n');
      skipped++;
    } finally {
      clearDiceHooks();
    }
    if (args.verbose && i % 20 === 0 && i > 0) {
      process.stderr.write(`[dump-action-fuzz] ${i}/${args.count} (${emitted} ok, ${skipped} skipped)\n`);
    }
  }

  if (args.out) {
    await new Promise((r) => out.end(r));
  }
  process.stderr.write(`[dump-action-fuzz] done: ${emitted} fixtures, ${skipped} skipped (total ${args.count})\n`);
}

main().catch((e) => {
  process.stderr.write(`dump-action-fuzz: ${e.stack || e.message}\n`);
  process.exit(1);
});
