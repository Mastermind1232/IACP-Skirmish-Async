#!/usr/bin/env node
/**
 * dump-movement-cache.js — deterministic JS-side movement-cache outcomes for
 * randomized Dijkstra cases (D6.8a parity).
 *
 * Generates N fuzz cases on a synthetic grid: each case picks grid dims,
 * start cell, MP budget, profile flags, random occupied set, random hostile
 * set, random blocking-cell set, and random movement-blocking edges. Runs
 * buildTempBoardState + computeMovementCache, then emits the reachable cells
 * (sorted topLeft) with their costs + sizes as a JSONL line. Python reads
 * this and runs the same inputs through compute_movement_cache; mismatches
 * are logged.
 *
 * Usage:
 *   node tests/headless/dump-movement-cache.js --count 200 --seed 42
 *
 * Output JSONL per line:
 *   {
 *     "seq": 0,
 *     "cols": 8, "rows": 8,
 *     "start": "a1",
 *     "mp": 6,
 *     "profile": { ...MovementProfile dict... },
 *     "blocking": ["c3", ...],
 *     "occupied": ["d4"],
 *     "hostile": ["d4"],
 *     "mbe": [["b2","b3"]],
 *     "cells": [ ["a2", { "cost": 1, "size": "1x1" }], ... ]
 *   }
 *
 * IMPORTANT: This script only exercises `buildTempBoardState` +
 * `computeMovementCache` — the pure-geometry surfaces that D2.7/D2.8
 * completed. Full getBoardStateForMovement / getMovementProfile integration
 * is deferred to D4 (DC data-loader dependence).
 */
import {
  buildTempBoardState,
  computeMovementCache,
} from '../../src/game/movement.js';

function parseArgs(argv) {
  const args = { count: 200, seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = parseInt(argv[++i], 10) || 200;
    else if (argv[i] === '--seed') args.seed = parseInt(argv[++i], 10) || 42;
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

function coord(c, r) { return String.fromCharCode(97 + c) + (r + 1); }

function buildGrid(cols, rows, { blocked = [], difficult = [] } = {}) {
  const blockedSet = new Set(blocked);
  const difficultSet = new Set(difficult);
  const spaces = [];
  const adjacency = {};
  const terrain = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = coord(c, r);
      if (blockedSet.has(k)) continue;
      spaces.push(k);
      terrain[k] = difficultSet.has(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nk = coord(nc, nr);
        if (blockedSet.has(nk)) continue;
        neighbors.push(nk);
      }
      adjacency[k] = neighbors;
    }
  }
  return { spaces, adjacency, terrain, blocking: [], movementBlockingEdges: [], impassableEdges: [] };
}

function main() {
  const { count, seed } = parseArgs(process.argv.slice(2));
  const rng = mulberry32(seed);
  const lines = [];
  for (let seq = 0; seq < count; seq++) {
    const cols = 5 + Math.floor(rng() * 4);   // 5-8
    const rows = 5 + Math.floor(rng() * 4);   // 5-8
    const startC = Math.floor(rng() * cols);
    const startR = Math.floor(rng() * rows);
    const start = coord(startC, startR);
    const mp = 2 + Math.floor(rng() * 5);      // 2-6

    // Random difficult cells (0-3, excluding start)
    const diffCount = Math.floor(rng() * 4);
    const difficult = new Set();
    for (let i = 0; i < diffCount; i++) {
      const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
      const k = coord(c, r);
      if (k !== start) difficult.add(k);
    }

    // Random blocking cells (0-2, non-start, non-difficult)
    const blkCount = Math.floor(rng() * 3);
    const blockingCells = new Set();
    for (let i = 0; i < blkCount; i++) {
      const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
      const k = coord(c, r);
      if (k !== start && !difficult.has(k)) blockingCells.add(k);
    }

    const mapSpaces = buildGrid(cols, rows, { difficult: [...difficult] });
    mapSpaces.blocking = [...blockingCells];

    // Random occupied + hostile sets (same figure can be both).
    const occCount = Math.floor(rng() * 3);
    const occupied = new Set();
    for (let i = 0; i < occCount; i++) {
      const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
      const k = coord(c, r);
      if (k !== start && !blockingCells.has(k)) occupied.add(k);
    }
    const hostCount = Math.floor(rng() * 3);
    const hostile = new Set();
    for (let i = 0; i < hostCount; i++) {
      const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
      const k = coord(c, r);
      if (k !== start && !blockingCells.has(k)) hostile.add(k);
    }

    // Random movement-blocking edges (0-2).
    const mbeCount = Math.floor(rng() * 3);
    const mbe = [];
    for (let i = 0; i < mbeCount; i++) {
      const c = Math.floor(rng() * cols), r = Math.floor(rng() * rows);
      const k = coord(c, r);
      const dir = Math.floor(rng() * 4);
      const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nk = coord(nc, nr);
      if (blockingCells.has(k) || blockingCells.has(nk)) continue;
      mbe.push([k, nk]);
    }
    mapSpaces.movementBlockingEdges = mbe;

    // Random profile flags.
    const ignoreDifficult = rng() < 0.25;
    const ignoreBlocking = rng() < 0.1;
    const ignoreFigureCost = rng() < 0.25;
    const canEndOnOccupied = rng() < 0.1;
    const treatBlockingAsDifficult = rng() < 0.05;
    const profile = {
      size: '1x1', cols: 1, rows: 1,
      isLarge: false, allowDiagonal: true, canRotate: false,
      isMassive: false, isMobile: false,
      ignoreDifficult, ignoreBlocking, ignoreFigureCost, canEndOnOccupied,
      treatBlockingAsDifficult,
    };

    const board = buildTempBoardState(mapSpaces, [...occupied], [...hostile]);
    const cache = computeMovementCache(start, mp, board, profile);

    // Serialize cells as sorted [topLeft, {cost, size}] pairs.
    const cells = [];
    for (const [k, info] of cache.cells.entries()) {
      cells.push([k, { cost: info.cost, size: info.size }]);
    }
    cells.sort((a, b) => a[0].localeCompare(b[0]));

    lines.push(JSON.stringify({
      seq, cols, rows, start, mp, profile,
      blocking: [...blockingCells].sort(),
      difficult: [...difficult].sort(),
      occupied: [...occupied].sort(),
      hostile: [...hostile].sort(),
      mbe: mbe.map(e => e.slice()).sort((a, b) => a.join('|').localeCompare(b.join('|'))),
      cells,
    }));
  }
  process.stdout.write(lines.join('\n') + '\n');
}

main();
