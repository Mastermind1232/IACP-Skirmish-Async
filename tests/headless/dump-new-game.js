#!/usr/bin/env node
/**
 * dump-new-game.js — emit a canonical new-game JSON for JS↔Python parity.
 *
 * This is the JS counterpart of `python/engine/creation.py:create_game()`.
 * It hand-constructs the minimal "initial state" dict and writes canonical
 * JSON (sorted keys, no spaces). The Python test loads this, round-trips it
 * through `GameState.to_json()`, and asserts byte-identical output.
 *
 * At D1 scope we test *serialization + structure*, not full engine creation.
 * Later deliverables (D2+) will replace this with game-creation.js-driven
 * snapshots taken at well-defined lifecycle points.
 *
 * Usage:
 *   node tests/headless/dump-new-game.js                      # default demo state
 *   node tests/headless/dump-new-game.js --spec path/to.json  # from a spec file
 *   node tests/headless/dump-new-game.js --spec - < spec.json # from stdin
 *
 * Spec JSON shape (all fields optional):
 *   {
 *     "gameId": "TEST_GAME",
 *     "player1Id": "p1",
 *     "player2Id": "p2",
 *     "player1Squad": {...} | null,
 *     "player2Squad": {...} | null,
 *     "selectedMap": "mos-eisley" | null,
 *     "mission": "...",
 *     "version": 1
 *   }
 *
 * Output: canonical JSON on stdout (sorted keys, no whitespace).
 */

import { readFileSync } from 'node:fs';

const CURRENT_GAME_VERSION = 1;

const PHASES = {
  LOBBY: 'lobby',
  MAP_SELECTION: 'map_selection',
  INITIATIVE: 'initiative',
};

function deriveInitialPhase(spec) {
  if (spec.selectedMap && spec.player1Squad && spec.player2Squad) {
    return PHASES.INITIATIVE;
  }
  if (spec.gameId) return PHASES.MAP_SELECTION;
  return PHASES.LOBBY;
}

function buildNewGame(spec) {
  const gameId = spec.gameId ?? 'TEST_GAME';
  return {
    gameId,
    version: spec.version ?? CURRENT_GAME_VERSION,
    player1Id: spec.player1Id ?? 'p1',
    player2Id: spec.player2Id ?? 'p2',
    player1Squad: spec.player1Squad ?? null,
    player2Squad: spec.player2Squad ?? null,
    selectedMap: spec.selectedMap ?? null,
    mission: spec.mission ?? null,
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    phase: deriveInitialPhase(spec),
    ended: false,
  };
}

/** Serialize with sorted keys and no whitespace — matches Python's
 *  json.dumps(sort_keys=True, separators=(',', ':')). */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k]));
  return '{' + parts.join(',') + '}';
}

function parseArgs(argv) {
  const args = { specPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec') { args.specPath = argv[++i]; continue; }
  }
  return args;
}

function loadSpec(specPath) {
  if (!specPath) return {};
  const raw = specPath === '-'
    ? readFileSync(0, 'utf8')
    : readFileSync(specPath, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const { specPath } = parseArgs(process.argv.slice(2));
  const spec = loadSpec(specPath);
  const game = buildNewGame(spec);
  process.stdout.write(canonicalStringify(game));
}

main();
