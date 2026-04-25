#!/usr/bin/env node
/**
 * dump-los-fuzz.js — deterministic JS-side LOS outcomes for randomized cases.
 *
 * Generates N fuzz cases (attacker, target, blocking, walls, figures) from a
 * seeded PRNG and evaluates `hasLineOfSight(...)` for each. Emits per-case
 * input + expected output as JSONL on stdout. The Python fuzz test reads
 * this file, runs `has_line_of_sight` with identical inputs, and compares.
 *
 * Usage:
 *   node tests/headless/dump-los-fuzz.js --count 200 --seed 42
 *
 * Output JSONL (one object per line):
 *   {
 *     "seq": 0,
 *     "a": "b3", "b": "e5",
 *     "blocking": ["c4", ...],
 *     "impassableEdges": [["b3","b4"]],
 *     "figureBlocking": ["d4"],
 *     "los": true
 *   }
 */
import { hasLineOfSight } from '../../src/game/spatial.js';
import { colRowToCoord } from '../../src/game/coords.js';

function parseArgs(argv) {
  const args = { count: 200, seed: 42, cols: 8, rows: 8 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = parseInt(argv[++i], 10) || 200;
    else if (argv[i] === '--seed') args.seed = parseInt(argv[++i], 10) || 42;
    else if (argv[i] === '--cols') args.cols = parseInt(argv[++i], 10) || 8;
    else if (argv[i] === '--rows') args.rows = parseInt(argv[++i], 10) || 8;
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

function pickCell(rng, cols, rows) {
  const c = Math.floor(rng() * cols);
  const r = Math.floor(rng() * rows);
  return colRowToCoord(c, r);
}

function main() {
  const { count, seed, cols, rows } = parseArgs(process.argv.slice(2));
  const rng = mulberry32(seed);
  const lines = [];
  let attempts = 0;
  while (lines.length < count && attempts < count * 10) {
    attempts++;
    const a = pickCell(rng, cols, rows);
    const b = pickCell(rng, cols, rows);
    if (a === b) continue;

    // Blocking cells: 0-4 random, excluding the path endpoints
    const blockingCount = Math.floor(rng() * 5);
    const blocking = new Set();
    for (let i = 0; i < blockingCount; i++) {
      const c = pickCell(rng, cols, rows);
      if (c !== a && c !== b) blocking.add(c);
    }

    // Impassable edges: 0-2 random orthogonal-neighbor pairs
    const edgeCount = Math.floor(rng() * 3);
    const impassableEdges = [];
    for (let i = 0; i < edgeCount; i++) {
      const e1 = pickCell(rng, cols, rows);
      const dir = Math.floor(rng() * 4);
      const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
      const p = e1.match(/([a-z]+)(\d+)/);
      if (!p) continue;
      const col = p[1].charCodeAt(0) - 97;
      const row = parseInt(p[2], 10) - 1;
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const e2 = colRowToCoord(nc, nr);
      impassableEdges.push([e1, e2]);
    }

    // Figure-blocking cells: 0-3 random, excluding endpoints
    const figCount = Math.floor(rng() * 4);
    const figureBlocking = new Set();
    for (let i = 0; i < figCount; i++) {
      const c = pickCell(rng, cols, rows);
      if (c !== a && c !== b) figureBlocking.add(c);
    }

    const mapSpaces = {
      blocking: [...blocking],
      impassableEdges,
    };
    const los = hasLineOfSight(a, b, mapSpaces,
      figureBlocking.size ? figureBlocking : null);

    lines.push(JSON.stringify({
      seq: lines.length,
      a, b,
      blocking: [...blocking].sort(),
      impassableEdges: impassableEdges.map(e => e.slice()).sort(
        (x, y) => x.join('|').localeCompare(y.join('|'))),
      figureBlocking: [...figureBlocking].sort(),
      los,
    }));
  }
  process.stdout.write(lines.join('\n') + '\n');
}

main();
