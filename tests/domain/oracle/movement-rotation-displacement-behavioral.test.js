/**
 * BEHAVIORAL oracle tests for Movement Validation Phase 2.
 *
 * Slice A — Rotation legality for non-square large figures (1x2 ↔ 2x1).
 * Slice B — Massive displacement core logic (overlap detection, push BFS).
 *
 * Rotation key mechanics:
 *   - 1x2 figure at a1: footprint [a1, a2] (vertical)
 *   - Rotated 2x1 at a1: footprint [a1, b1] (horizontal)
 *   - Rotation costs 1 MP, same topLeft, different size in state key
 *   - 1x2 CANNOT slide perpendicular to long axis (0 overlap violates sliding rule)
 *   - Must rotate first, then slide in new direction — correct IA behavior
 *
 * Displacement key mechanics:
 *   - collectOverlappingFigures: pure, friendly-first ordering
 *   - pushFigureToNearestValid: orthogonal BFS, respects forbidden+occupied+blocked
 *   - getValidDisplacementSpaces: adjacency-based picker for Discord buttons
 *
 * Test categories:
 *   B-MVROT-001: Legal rotation in place
 *   B-MVROT-002: Rotation blocked by collision
 *   B-MVROT-003: Rotation + movement coherence
 *   B-MVROT-004: Geometry integrity
 *   B-MVDISP-001: collectOverlappingFigures
 *   B-MVDISP-002: getValidDisplacementSpaces
 *   B-MVDISP-003: pushFigureToNearestValid
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMovementCache,
  getSpacesAtCost,
  getMovementTarget,
  buildTempBoardState,
  movementStateKey,
  collectOverlappingFigures,
  pushFigureToNearestValid,
  getValidDisplacementSpaces,
} from '../../../src/game/movement.js';

// ── Synthetic grid builder ─────────────────────────────────────────────────

function buildGrid(cols, rows, overrides = {}) {
  const { blocked = [], difficult = [], movementBlockingEdges = [] } = overrides;
  const spaces = [];
  const adjacency = {};
  const terrain = {};

  function coord(col, row) {
    return String.fromCharCode(97 + col) + (row + 1);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = coord(c, r);
      if (blocked.includes(k)) continue;
      spaces.push(k);
      terrain[k] = difficult.includes(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          const nk = coord(nc, nr);
          if (!blocked.includes(nk)) {
            const ek = [k, nk].sort().join('|');
            const isBlocked = movementBlockingEdges.some(
              ([a, b]) => [a, b].sort().join('|') === ek
            );
            if (!isBlocked) neighbors.push(nk);
          }
        }
      }
      adjacency[k] = neighbors;
    }
  }

  return {
    spaces,
    adjacency,
    terrain,
    blocking: [],
    movementBlockingEdges: movementBlockingEdges || [],
    impassableEdges: [],
  };
}

// ── Profiles ───────────────────────────────────────────────────────────────

/** 1x2 (vertical): cols=1, rows=2. canRotate because cols≠rows. */
const rotatableProfile = {
  size: '1x2', cols: 1, rows: 2, isLarge: true, allowDiagonal: false, canRotate: true,
  isMassive: false, isMobile: false, ignoreDifficult: false, ignoreBlocking: false,
  ignoreFigureCost: false, canEndOnOccupied: false,
};

/** 2x2 (square): canRotate=false because cols==rows. */
const squareProfile = {
  size: '2x2', cols: 2, rows: 2, isLarge: true, allowDiagonal: false, canRotate: false,
  isMassive: false, isMobile: false, ignoreDifficult: false, ignoreBlocking: false,
  ignoreFigureCost: false, canEndOnOccupied: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// SLICE A — Rotation Legality
// ═══════════════════════════════════════════════════════════════════════════

// ── B-MVROT-001: Legal rotation in place ──────────────────────────────────

describe('B-MVROT-001: Legal rotation in place (1x2 ↔ 2x1)', () => {
  // 1x2 at a1 → footprint [a1, a2]
  // Rotate to 2x1 → footprint [a1, b1] (cost 1 MP)

  it('001a: rotation produces endpoint at same topLeft with rotated size', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, rotatableProfile);

    // a1 should be in cells (rotated in place) with size '2x1'
    const a1 = getMovementTarget(cache, 'a1');
    assert.ok(a1, 'a1 reachable at 1 MP (rotation in place)');
    assert.strictEqual(a1.cost, 1, 'rotation costs exactly 1 MP');
    assert.strictEqual(a1.size, '2x1', 'rotated size is 2x1 (was 1x2)');
  });

  it('001b: distinct state keys for each orientation in nodes', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 2, board, rotatableProfile);

    assert.ok(cache.nodes.has(movementStateKey('a1', '1x2')),
      'a1|1x2 (start orientation) in nodes');
    assert.ok(cache.nodes.has(movementStateKey('a1', '2x1')),
      'a1|2x1 (rotated orientation) in nodes');
  });

  it('001c: exactly 2 endpoints at 1 MP — rotation and slide-down', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, rotatableProfile);

    const at1 = getSpacesAtCost(cache, 1);
    // a1 (rotation to 2x1) and a2 (slide down in 1x2)
    assert.ok(at1.includes('a1'), 'a1 in 1-MP set (rotation)');
    assert.ok(at1.includes('a2'), 'a2 in 1-MP set (slide down)');
    assert.strictEqual(at1.length, 2,
      'exactly 2 endpoints — perpendicular slide blocked by sliding rule');
  });
});

// ── B-MVROT-002: Rotation blocked by collision ────────────────────────────

describe('B-MVROT-002: Rotation blocked by collision', () => {

  it('002a: occupied cell in rotated footprint blocks rotation', () => {
    const mapSpaces = buildGrid(6, 6);
    // b1 occupied — blocks rotation from 1x2 at a1 to 2x1 (footprint a1,b1)
    const board = buildTempBoardState(mapSpaces, ['b1'], []);
    const cache = computeMovementCache('a1', 1, board, rotatableProfile);

    // a1 should NOT appear (rotation blocked), only a2 (slide down)
    const a1 = getMovementTarget(cache, 'a1');
    assert.strictEqual(a1, null, 'rotation blocked — b1 occupied in rotated footprint');

    const at1 = getSpacesAtCost(cache, 1);
    assert.ok(at1.includes('a2'), 'slide down still works');
    assert.strictEqual(at1.length, 1, 'only 1 endpoint (slide down)');
  });

  it('002b: out-of-bounds cell in rotated footprint blocks rotation', () => {
    // 1x2 at e1 on a 5-col grid (a-e). Rotate to 2x1 needs f1 — off grid.
    const mapSpaces = buildGrid(5, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('e1', 1, board, rotatableProfile);

    const e1 = getMovementTarget(cache, 'e1');
    assert.strictEqual(e1, null,
      'rotation blocked — f1 in rotated footprint does not exist on 5-col grid');
  });

  it('002c: blocking terrain in rotated footprint blocks rotation', () => {
    const mapSpaces = buildGrid(6, 6);
    mapSpaces.blocking = ['b1'];
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, rotatableProfile);

    const a1 = getMovementTarget(cache, 'a1');
    assert.strictEqual(a1, null, 'rotation blocked — b1 is blocking terrain');
  });
});

// ── B-MVROT-003: Rotation + movement coherence ───────────────────────────

describe('B-MVROT-003: Rotation + movement coherence', () => {

  it('003a: destination reachable ONLY via rotate-first path', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 2, board, rotatableProfile);

    // b1 as 2x1 at cost 2: rotate(1 MP) → slide right(1 MP)
    // Without rotation, 1x2 at a1 can only slide down, never right
    const b1 = getMovementTarget(cache, 'b1');
    assert.ok(b1, 'b1 reachable at 2 MP (rotate then slide right)');
    assert.strictEqual(b1.cost, 2);
    assert.strictEqual(b1.size, '2x1', 'arrives in rotated orientation');
  });

  it('003b: destination reachable ONLY via slide-first path (no rotation)', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 2, board, rotatableProfile);

    // a3 as 1x2 at cost 2: slide down(1 MP) → slide down(1 MP)
    // This path never rotates
    const a3 = getMovementTarget(cache, 'a3');
    assert.ok(a3, 'a3 reachable at 2 MP (slide down twice)');
    assert.strictEqual(a3.cost, 2);
    assert.strictEqual(a3.size, '1x2', 'arrives in original orientation');
  });

  it('003c: double rotation returns to original orientation', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    // 3 MP: rotate(1) → rotate back(1) → slide down(1) = a2 as 1x2 at cost 3
    // Also: a2 as 1x2 at cost 1 (just slide down — cheaper path wins)
    const cache = computeMovementCache('a1', 3, board, rotatableProfile);

    // Verify both orientations visited at a1
    const nodeOriginal = cache.nodes.get(movementStateKey('a1', '1x2'));
    const nodeRotated = cache.nodes.get(movementStateKey('a1', '2x1'));
    assert.ok(nodeOriginal, 'original orientation node exists');
    assert.ok(nodeRotated, 'rotated orientation node exists');
    assert.strictEqual(nodeOriginal.cost, 0, 'original at cost 0 (start)');
    assert.strictEqual(nodeRotated.cost, 1, 'rotated at cost 1');
    // Double rotation would create a1|1x2 at cost 2, but start node already
    // has it at cost 0 — bestCost prevents re-entry. Confirms no cache corruption.
  });
});

// ── B-MVROT-004: Geometry integrity ───────────────────────────────────────

describe('B-MVROT-004: Geometry integrity for rotatable figures', () => {

  it('004a: no diagonal moves with canRotate profile', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('b2', 1, board, rotatableProfile);

    // b2 as 1x2: footprint [b2, b3]. At 1 MP: slide down (b3), slide up (b1),
    // rotate to 2x1 at b2. NO diagonal moves (isLarge=true).
    const at1 = getSpacesAtCost(cache, 1);
    // Should be: b1 (slide up), b3 (slide down), b2 (rotate)
    for (const dest of at1) {
      // No diagonal destinations (like a1, c1, a3, c3)
      assert.ok(!['a1', 'c1', 'a3', 'c3'].includes(dest),
        `${dest} should not be reachable — no diagonals for large figures`);
    }
  });

  it('004b: 1x2 cannot slide perpendicular to long axis (sliding rule)', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    // 1x2 at b2: footprint [b2, b3]. Moving right to c2: footprint [c2, c3].
    // Overlap: 0 cells. ceil(2/2) = 1. 0 < 1 → blocked.
    const cache = computeMovementCache('b2', 1, board, rotatableProfile);

    // c2 should NOT be reachable at 1 MP (perpendicular slide blocked)
    const c2 = getMovementTarget(cache, 'c2');
    assert.strictEqual(c2, null,
      'c2 not reachable at 1 MP — perpendicular slide violates sliding rule');

    // a2 should also NOT be reachable (left perpendicular slide)
    const a2 = getMovementTarget(cache, 'a2');
    assert.strictEqual(a2, null,
      'a2 not reachable at 1 MP — perpendicular slide violates sliding rule');
  });

  it('004c: square 2x2 has canRotate=false — no rotation in cache', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, squareProfile);

    // a1 should NOT appear in cells (no rotation for square figures)
    const a1 = getMovementTarget(cache, 'a1');
    assert.strictEqual(a1, null, 'a1 not reachable — square figures cannot rotate');

    // But regular moves work: b1 (right) and a2 (down)
    const at1 = getSpacesAtCost(cache, 1);
    assert.strictEqual(at1.length, 2, 'exactly 2 endpoints (no rotation)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SLICE B — Massive Displacement Core Logic
// ═══════════════════════════════════════════════════════════════════════════

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
  return {
    gameId: '42', player1Id: 'player1', player2Id: 'player2',
    selectedMap: { id: 'anchorhead-cantina-bar' },
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {}, figureConditions: {},
    openedDoors: [],
    ...overrides,
  };
}

// ── B-MVDISP-001: collectOverlappingFigures ───────────────────────────────

describe('B-MVDISP-001: collectOverlappingFigures', () => {

  it('001a: detects figure whose position overlaps massive footprint', () => {
    const game = {
      figurePositions: {
        1: {},
        2: { 'Stormtrooper (Regular)-1-0': 'c1' },
      },
      figureOrientations: {},
    };
    // Massive 2x2 landing zone at b1: footprint [b1, c1, b2, c2]
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const overlaps = collectOverlappingFigures(game, 1, 'MASSIVE-1-0', footprint);

    assert.strictEqual(overlaps.length, 1, 'one overlap detected');
    assert.strictEqual(overlaps[0].figureKey, 'Stormtrooper (Regular)-1-0');
    assert.strictEqual(overlaps[0].dcName, 'Stormtrooper (Regular)');
    assert.strictEqual(overlaps[0].playerNum, 2);
  });

  it('001b: non-overlapping figure excluded', () => {
    const game = {
      figurePositions: {
        1: {},
        2: { 'Stormtrooper (Regular)-1-0': 'e5' },  // far away
      },
      figureOrientations: {},
    };
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const overlaps = collectOverlappingFigures(game, 1, 'MASSIVE-1-0', footprint);

    assert.strictEqual(overlaps.length, 0, 'no overlap — figure not in footprint');
  });

  it('001c: moving figure excluded from results', () => {
    const game = {
      figurePositions: {
        1: { 'MASSIVE-1-0': 'b1' },  // the moving massive figure itself
        2: {},
      },
      figureOrientations: {},
    };
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const overlaps = collectOverlappingFigures(game, 1, 'MASSIVE-1-0', footprint);

    assert.strictEqual(overlaps.length, 0, 'moving figure excluded');
  });

  it('001d: friendly overlaps returned before enemy overlaps', () => {
    const game = {
      figurePositions: {
        1: {
          'MASSIVE-1-0': 'a1',             // moving figure (excluded)
          'Rebel Trooper-1-0': 'b1',       // friendly overlap
        },
        2: {
          'Stormtrooper (Regular)-1-0': 'c1',  // enemy overlap
        },
      },
      figureOrientations: {},
    };
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const overlaps = collectOverlappingFigures(game, 1, 'MASSIVE-1-0', footprint);

    assert.strictEqual(overlaps.length, 2, 'both overlaps detected');
    assert.strictEqual(overlaps[0].playerNum, 1, 'friendly first');
    assert.strictEqual(overlaps[0].figureKey, 'Rebel Trooper-1-0');
    assert.strictEqual(overlaps[1].playerNum, 2, 'enemy second');
    assert.strictEqual(overlaps[1].figureKey, 'Stormtrooper (Regular)-1-0');
  });
});

// ── B-MVDISP-002: getValidDisplacementSpaces ──────────────────────────────

describe('B-MVDISP-002: getValidDisplacementSpaces (anchorhead-cantina-bar)', () => {
  // b1 adj on this map: b2, a1, c1, a2, c2

  it('002a: returns adjacent empty non-forbidden spaces', () => {
    const game = makeGame({
      figurePositions: {
        1: {},
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    const forbiddenSet = new Set(['b1', 'c1', 'b2', 'c2']);
    const valid = getValidDisplacementSpaces(game, 'Stormtrooper (Regular)-1-0', 2, forbiddenSet);

    // b1 adj: [b2, a1, c1, a2, c2]. Forbidden: b2, c1, c2. Occupied: b1 (self).
    // Valid: a1, a2 (not forbidden, not occupied)
    assert.ok(valid.includes('a1') || valid.includes('A1'), 'a1 is valid displacement space');
    assert.ok(valid.includes('a2') || valid.includes('A2'), 'a2 is valid displacement space');
    assert.ok(!valid.some(s => forbiddenSet.has(s.toLowerCase())),
      'no forbidden spaces in result');
  });

  it('002b: excludes occupied and forbidden spaces', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },  // occupies a1
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    // Forbidden covers most of b1's neighbors
    const forbiddenSet = new Set(['b1', 'c1', 'b2', 'c2']);
    const valid = getValidDisplacementSpaces(game, 'Stormtrooper (Regular)-1-0', 2, forbiddenSet);

    // a1 is occupied → excluded. a2 is valid.
    assert.ok(!valid.some(s => s.toLowerCase() === 'a1'), 'a1 excluded — occupied');
    assert.ok(valid.some(s => s.toLowerCase() === 'a2'), 'a2 is valid');
  });
});

// ── B-MVDISP-003: pushFigureToNearestValid ────────────────────────────────

describe('B-MVDISP-003: pushFigureToNearestValid (anchorhead-cantina-bar)', () => {
  // b1 adj (BFS orthogonal): c1 (right), a1 (left), b2 (down)

  it('003a: pushes to nearest valid space and mutates figurePositions', () => {
    const game = makeGame({
      figurePositions: {
        1: {},
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    // b1 is forbidden (massive footprint)
    const forbiddenSet = new Set(['b1']);
    const result = pushFigureToNearestValid(game, 2, 'Stormtrooper (Regular)-1-0', forbiddenSet);

    assert.strictEqual(result, true, 'push succeeded');
    const newPos = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    assert.ok(newPos !== 'b1', 'figure moved from b1');
    assert.ok(!forbiddenSet.has(newPos), 'new position not in forbidden set');
  });

  it('003b: BFS past occupied neighbors finds valid space further away', () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Rebel Trooper-1-0': 'a1',
          'Rebel Trooper-2-0': 'c1',
          'Rebel Trooper-3-0': 'b2',
        },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    // b1 forbidden. All orthogonal neighbors (c1, a1, b2) occupied.
    // BFS must go 2 steps to find d1, c2, a2, or b3.
    const forbiddenSet = new Set(['b1']);
    const result = pushFigureToNearestValid(game, 2, 'Stormtrooper (Regular)-1-0', forbiddenSet);

    assert.strictEqual(result, true, 'push succeeded despite occupied neighbors');
    const newPos = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    assert.ok(newPos !== 'b1', 'figure moved from b1');
    assert.ok(!forbiddenSet.has(newPos), 'not in forbidden set');
    // Must not be on any occupied space
    assert.ok(!['a1', 'c1', 'b2'].includes(newPos),
      'not placed on occupied neighbor');
  });

  it('003c: respects forbidden set — does not place on massive footprint', () => {
    const game = makeGame({
      figurePositions: {
        1: {},
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    // Large forbidden set covering b1's immediate area
    const forbiddenSet = new Set(['b1', 'c1', 'b2', 'c2']);
    const result = pushFigureToNearestValid(game, 2, 'Stormtrooper (Regular)-1-0', forbiddenSet);

    assert.strictEqual(result, true, 'push succeeded');
    const newPos = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    for (const cell of forbiddenSet) {
      assert.ok(newPos !== cell, `not placed on forbidden cell ${cell}`);
    }
  });

  it('003d: returns false when figure has no position', () => {
    const game = makeGame({
      figurePositions: { 1: {}, 2: {} },
    });
    const result = pushFigureToNearestValid(game, 2, 'Ghost-1-0', new Set(['a1']));

    assert.strictEqual(result, false, 'returns false — figure has no position');
  });
});
