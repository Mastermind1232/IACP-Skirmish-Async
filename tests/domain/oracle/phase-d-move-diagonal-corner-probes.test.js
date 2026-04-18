/**
 * Phase-D probes: diagonal corner-cut rule (single wall vs. wall combinations).
 *
 * PROBE-PD-MOVE-013: A figure can move diagonally past a single corner that
 *   is formed by a wall. (CRR MOVEMENT — diagonal corner-cut)
 * PROBE-PD-MOVE-014: A figure cannot move diagonally past a corner when
 *   walls combine to seal off both flanking paths. (CRR MOVEMENT)
 *
 * Implementation: src/game/movement.js `canMoveDiagonally` returns
 *   `aSecondOpen || bSecondOpen` — a disjunction over the two flanking
 *   corner paths (start→cornerA→dest and start→cornerB→dest). A single
 *   wall severs at most one flank, leaving the other open (MOVE-013);
 *   two walls can close both flanks (MOVE-014).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MV_SRC = readFileSync(resolve(__dirname, '../../../src/game/movement.js'), 'utf8');

const BASE_PROFILE = {
  size: '1x1', cols: 1, rows: 1,
  isLarge: false, allowDiagonal: true, canRotate: false,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
  treatBlockingAsDifficult: false,
};

// 2x2 grid: a1, b1, a2, b2. All orthogonally adjacent.
function make2x2(movementBlockingEdges = []) {
  return {
    spaces: ['a1', 'b1', 'a2', 'b2'],
    adjacency: {
      a1: ['b1', 'a2'],
      b1: ['a1', 'b2'],
      a2: ['a1', 'b2'],
      b2: ['b1', 'a2'],
    },
    terrain: {},
    blocking: [],
    movementBlockingEdges,
    impassableEdges: [],
  };
}

describe('PROBE-PD-MOVE-013 / MOVE-014: diagonal corner-cut is a disjunction of flank paths', () => {
  it('013a: source — canMoveDiagonally returns the OR of two flanking corner paths (not AND)', () => {
    // Single wall severs only one flank; disjunction keeps the other open.
    assert.match(MV_SRC, /return aSecondOpen \|\| bSecondOpen;/,
      'canMoveDiagonally must return the disjunction of flank paths — CRR-MOVE-013');
  });

  it('013b: source — each flank path requires both halves open (corner reachable, then dest reachable)', () => {
    // The second-half guard composes: aFirstOpen && no wall between corner and dest && corner adjacency includes dest.
    assert.match(MV_SRC, /const aSecondOpen\s*=\s*\n\s*aFirstOpen\s*&&/,
      'aSecondOpen must be gated on aFirstOpen — CRR-MOVE-013');
    assert.match(MV_SRC, /const bSecondOpen\s*=\s*\n\s*bFirstOpen\s*&&/,
      'bSecondOpen must be gated on bFirstOpen — CRR-MOVE-013');
  });

  it('013c: behavior — no walls: diagonal a1 to b2 succeeds (both flanks open)', () => {
    const board = buildTempBoardState(make2x2(), [], null);
    const cache = computeMovementCache('a1', 4, board, BASE_PROFILE);
    assert.ok(cache.cells.has('b2'),
      'b2 must be reachable with no walls — CRR-MOVE-013');
  });

  it('013d: behavior — single wall on one flank (a1 to b1): diagonal a1 to b2 still succeeds via a2', () => {
    const board = buildTempBoardState(
      make2x2([['a1', 'b1']]),
      [], null
    );
    const cache = computeMovementCache('a1', 4, board, BASE_PROFILE);
    assert.ok(cache.cells.has('b2'),
      'b2 must remain reachable when only the b1 flank is walled (a2 flank open) — CRR-MOVE-013');
  });

  it('013e: behavior — single wall on the other flank (a1 to a2): diagonal a1 to b2 still succeeds via b1', () => {
    const board = buildTempBoardState(
      make2x2([['a1', 'a2']]),
      [], null
    );
    const cache = computeMovementCache('a1', 4, board, BASE_PROFILE);
    assert.ok(cache.cells.has('b2'),
      'b2 must remain reachable when only the a2 flank is walled (b1 flank open) — CRR-MOVE-013');
  });

  it('014a: behavior — two walls sealing both flanks at the start corner blocks diagonal a1 to b2', () => {
    // Both first-halves walled: start→b1 AND start→a2 blocked.
    const board = buildTempBoardState(
      make2x2([['a1', 'b1'], ['a1', 'a2']]),
      [], null
    );
    const cache = computeMovementCache('a1', 4, board, BASE_PROFILE);
    assert.ok(!cache.cells.has('b2'),
      'b2 must be unreachable when walls seal both flanks at start — CRR-MOVE-014');
  });

  it('014b: behavior — walls on both second-halves (b1 to b2 and a2 to b2) also block diagonal', () => {
    // First-halves open, but both corner→dest edges walled.
    const board = buildTempBoardState(
      make2x2([['b1', 'b2'], ['a2', 'b2']]),
      [], null
    );
    const cache = computeMovementCache('a1', 4, board, BASE_PROFILE);
    assert.ok(!cache.cells.has('b2'),
      'b2 must be unreachable when walls seal both second-halves — CRR-MOVE-014');
  });

  it('014c: behavior — mixed wall combination (start to b1 AND a2 to b2) seals both flank paths', () => {
    // b1 path blocked at first-half; a2 path blocked at second-half.
    const board = buildTempBoardState(
      make2x2([['a1', 'b1'], ['a2', 'b2']]),
      [], null
    );
    const cache = computeMovementCache('a1', 4, board, BASE_PROFILE);
    assert.ok(!cache.cells.has('b2'),
      'b2 must be unreachable when mixed walls close both flank paths — CRR-MOVE-014');
  });
});
