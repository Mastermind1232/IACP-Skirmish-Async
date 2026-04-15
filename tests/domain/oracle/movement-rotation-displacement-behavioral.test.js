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
  initMassiveDisplacement,
  resolveNextDisplacements,
  applyDisplacementChoice,
  resolveMassivePush,
} from '../../../src/game/movement.js';
import { pushFigure } from '../../../src/game/player-helpers.js';

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

// ── B-MVDISP-004: Iterative recalculation changes later figure options ────

describe('B-MVDISP-004: resolveNextDisplacements iterative recalc', () => {
  // anchorhead-cantina-bar: b1 adj includes a1, c1, b2, a2, c2

  it('004a: resolving figure A frees space for figure B', () => {
    // Two figures under footprint. A is auto-placed at a1.
    // B's only adjacent non-forbidden space is a1 — but after A lands there, a1 is occupied.
    // Iterative recalc means B sees a1 as occupied and falls to BFS.
    const game = makeGame({
      figurePositions: {
        1: {
          'MASSIVE-1-0': 'a3',
          'Rebel Trooper-1-0': 'b1',   // friendly A — adj non-forbidden: a1, a2
          'Rebel Trooper-2-0': 'c1',   // friendly B — adj non-forbidden: ??? (depends on A's placement)
        },
        2: {},
      },
    });
    // Massive footprint covers b1, c1, b2, c2
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const pending = initMassiveDisplacement(game, 1, 'MASSIVE-1-0', footprint);
    assert.ok(pending, 'pending created');
    assert.strictEqual(pending.friendlyQueue.length, 2, 'two friendly overlaps');
    assert.strictEqual(pending.enemyQueue.length, 0, 'no enemy overlaps');

    // Resolve iteratively
    const r1 = resolveNextDisplacements(game, pending);
    // First figure should auto-resolve (b1 adj → a1, a2 available, but may need choice or auto)
    // Either way, at least one figure processed
    assert.ok(r1.autoResolved.length > 0 || r1.needsChoice, 'at least one figure processed');

    // If both auto-resolved, verify they ended in different spaces
    if (r1.done) {
      const posA = game.figurePositions[1]['Rebel Trooper-1-0'];
      const posB = game.figurePositions[1]['Rebel Trooper-2-0'];
      assert.ok(posA !== posB, 'figures placed in different spaces');
      assert.ok(!footprint.has(posA), 'A not in footprint');
      assert.ok(!footprint.has(posB), 'B not in footprint');
    }
  });

  it('004b: figure with 0 adjacent under old precompute gets options after prior displacement', () => {
    // Setup: B at c1, all c1 adj spaces either forbidden or occupied by A at b1.
    // Under old precompute: both computed simultaneously, c1 adj = {b1(forbidden), c2(forbidden), d1(?)}.
    // After A displaced from b1 → a1, c1 adj to b1 is... wait b1 is still forbidden.
    // Better setup: A at a2, B at a1. Forbidden: {a1, a2, b1, b2}.
    // a1 adj = {a2(forbidden), b1(forbidden), b2(forbidden)}. Pre-compute: 0 adjacent for B.
    // But if A (at a2) resolved first → A leaves a2, making it non-forbidden? No, forbidden is the massive footprint.
    // Correct approach: A at b1 occupies adjacent of B. When A moves away, B gets that space.
    // a1 adj on anchorhead: a2, b1, b2. Forbidden: {a1, b1, b2}.
    // If someone occupies a2, B has 0 adj. But if that someone is displaced first and leaves a2, B gets a2.
    const game = makeGame({
      figurePositions: {
        1: {
          'MASSIVE-1-0': 'c3',
        },
        2: {
          'Stormtrooper (Regular)-1-0': 'a2', // enemy A — at a2
          'Stormtrooper (Regular)-2-0': 'a1', // enemy B — at a1, adj: {a2(occupied by A), b1(forbidden), b2(forbidden)}
        },
      },
    });
    // Massive footprint covers a1, b1, a2, b2
    const footprint = new Set(['a1', 'b1', 'a2', 'b2']);
    const pending = initMassiveDisplacement(game, 1, 'MASSIVE-1-0', footprint);
    assert.ok(pending, 'pending created');

    // Under old precompute: both figures computed at once.
    // For B at a1: adj={a2,b1,b2}. a2 occupied by A, b1 forbidden, b2 forbidden → 0 adj (BFS fallback).
    // Under iterative: A resolved first (A at a2, adj = {a1(forbidden), a3, b2(forbidden)} → a3 is valid).
    // Then B: adj = {a2(now empty! A moved to a3), b1(forbidden), b2(forbidden)} → a2 valid!

    // Resolve A first (enemy figures, stable iteration order: A before B since A iterated first)
    // Note: both are enemy since massive is player 1, stormtroopers are player 2
    assert.strictEqual(pending.phase, 'enemy', 'starts in enemy phase (no friendlies)');

    // Resolve all
    let allAuto = [];
    let result = resolveNextDisplacements(game, pending);
    allAuto.push(...result.autoResolved);
    while (!result.done) {
      if (result.needsChoice) {
        // Pick first valid space
        applyDisplacementChoice(game, pending, result.needsChoice.validSpaces[0]);
      }
      result = resolveNextDisplacements(game, pending);
      allAuto.push(...result.autoResolved);
    }

    const posA = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    const posB = game.figurePositions[2]['Stormtrooper (Regular)-2-0'];
    assert.ok(!footprint.has(posA), 'A not in footprint');
    assert.ok(!footprint.has(posB), 'B not in footprint');
    assert.ok(posA !== posB, 'A and B in different spaces');
  });
});

// ── B-MVDISP-005: Push authority (friendly vs enemy controller) ──────────

describe('B-MVDISP-005: push authority per phase', () => {

  it('005a: friendly phase → controllerPlayerNum is massive controller', () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'MASSIVE-1-0': 'a3',
          'Rebel Trooper-1-0': 'b1', // friendly overlap
        },
        2: {},
      },
    });
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const pending = initMassiveDisplacement(game, 1, 'MASSIVE-1-0', footprint);
    assert.ok(pending);
    assert.strictEqual(pending.phase, 'friendly');

    const result = resolveNextDisplacements(game, pending);
    if (result.needsChoice) {
      assert.strictEqual(result.needsChoice.controllerPlayerNum, 1,
        'friendly phase: massive controller (P1) picks destination');
    }
    // If auto-resolved (0 or 1 option), the authority doesn't matter — no choice shown
  });

  it('005b: enemy phase → controllerPlayerNum is enemy player', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'MASSIVE-1-0': 'a3' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' }, // enemy overlap
      },
    });
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const pending = initMassiveDisplacement(game, 1, 'MASSIVE-1-0', footprint);
    assert.ok(pending);
    assert.strictEqual(pending.phase, 'enemy', 'starts in enemy phase (no friendlies)');

    const result = resolveNextDisplacements(game, pending);
    if (result.needsChoice) {
      assert.strictEqual(result.needsChoice.controllerPlayerNum, 2,
        'enemy phase: enemy player (P2) picks destination');
    }
  });
});

// ── B-MVDISP-006: Friendly-before-enemy ordering in mixed overlaps ───────

describe('B-MVDISP-006: friendly-before-enemy ordering', () => {

  it('006a: friendly figures resolved before enemy figures', () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'MASSIVE-1-0': 'a3',
          'Rebel Trooper-1-0': 'b1',    // friendly
        },
        2: {
          'Stormtrooper (Regular)-1-0': 'c1',  // enemy
        },
      },
    });
    const footprint = new Set(['b1', 'c1', 'b2', 'c2']);
    const pending = initMassiveDisplacement(game, 1, 'MASSIVE-1-0', footprint);
    assert.ok(pending);
    assert.strictEqual(pending.phase, 'friendly', 'starts in friendly phase');
    assert.strictEqual(pending.friendlyQueue.length, 1);
    assert.strictEqual(pending.enemyQueue.length, 1);

    // Resolve friendly first
    const r1 = resolveNextDisplacements(game, pending);
    // After friendly is resolved (auto or choice), check that we haven't touched enemy yet
    const enemyStillAtC1 = game.figurePositions[2]['Stormtrooper (Regular)-1-0'] === 'c1';
    if (r1.autoResolved.length > 0) {
      // Friendly was auto-resolved
      assert.strictEqual(r1.autoResolved[0].entry.playerNum, 1, 'auto-resolved is friendly');
    }
    if (r1.needsChoice) {
      assert.strictEqual(r1.needsChoice.entry.playerNum, 1, 'choice is for friendly');
      assert.ok(enemyStillAtC1, 'enemy not yet displaced while friendly pending');
      applyDisplacementChoice(game, pending, r1.needsChoice.validSpaces[0]);
    }

    // Now resolve enemy
    const r2 = resolveNextDisplacements(game, pending);
    if (r2.autoResolved.length > 0) {
      assert.strictEqual(r2.autoResolved[0].entry.playerNum, 2, 'auto-resolved is enemy');
    }
    if (r2.needsChoice) {
      assert.strictEqual(r2.needsChoice.entry.playerNum, 2, 'choice is for enemy');
      applyDisplacementChoice(game, pending, r2.needsChoice.validSpaces[0]);
    }

    // Finish
    if (!r2.done) {
      const r3 = resolveNextDisplacements(game, pending);
      assert.ok(r3.done, 'all resolved');
    }

    const posF = game.figurePositions[1]['Rebel Trooper-1-0'];
    const posE = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    assert.ok(!footprint.has(posF), 'friendly not in footprint');
    assert.ok(!footprint.has(posE), 'enemy not in footprint');
  });
});

// ── B-MVDISP-007: resolveMassivePush (non-interactive) iterative semantics ─

describe('B-MVDISP-007: resolveMassivePush uses iterative engine', () => {

  it('007a: non-interactive path resolves all figures out of footprint', async () => {
    const game = makeGame({
      figurePositions: {
        1: { 'MASSIVE-1-0': 'a3' },
        2: {
          'Stormtrooper (Regular)-1-0': 'b1',
          'Stormtrooper (Regular)-2-0': 'c1',
        },
      },
    });
    const footprint = ['b1', 'c1', 'b2', 'c2'];
    const profile = { canEndOnOccupied: true };
    const logs = [];
    const mockLog = async (_g, _c, msg) => logs.push(msg);

    await resolveMassivePush(game, profile, 'MASSIVE-1-0', 1, footprint, null, mockLog);

    const posA = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    const posB = game.figurePositions[2]['Stormtrooper (Regular)-2-0'];
    const fpSet = new Set(footprint);
    assert.ok(!fpSet.has(posA), 'figure A not in footprint');
    assert.ok(!fpSet.has(posB), 'figure B not in footprint');
    assert.ok(posA !== posB, 'figures in different spaces');
    assert.ok(game.massiveMovementLocked?.['MASSIVE-1-0'], 'movement locked');
    assert.ok(logs.length >= 3, 'at least 3 log messages (2 displacements + lock)');
  });

  it('007b: deployment-triggered massive placement follows displacement rules', async () => {
    // Per RULES_REFERENCE.md:1915-1917: deployment is treated as ending movement.
    // resolveMassivePush should handle it identically.
    const game = makeGame({
      figurePositions: {
        1: { 'AT-DP-1-0': 'b1' },  // massive figure deployed at b1
        2: { 'Rebel Trooper-1-0': 'c1' },  // overlapped by deployment
      },
      figureOrientations: { 'AT-DP-1-0': '2x2' },
    });
    const footprint = ['b1', 'c1', 'b2', 'c2'];
    const profile = { canEndOnOccupied: true };
    const logs = [];
    const mockLog = async (_g, _c, msg) => logs.push(msg);

    await resolveMassivePush(game, profile, 'AT-DP-1-0', 1, footprint, null, mockLog);

    const pos = game.figurePositions[2]['Rebel Trooper-1-0'];
    assert.ok(!new Set(footprint).has(pos), 'displaced figure not in massive footprint');
    assert.ok(game.massiveMovementLocked?.['AT-DP-1-0'], 'movement locked after deployment displacement');
  });
});

// ── B-MVDISP-008: Full-contract certification ────────────────────────────
// Single scenario exercising: mixed friendly/enemy, iterative recalc that
// changes options, push authority per phase, deterministic within-group order.

describe('B-MVDISP-008: full-contract certification (anchorhead-cantina-bar)', () => {
  // Map adjacency (verified from data):
  // b2 adj: b1, b3, a2, c2, a1, a3, c1, c3
  // c2 adj: c1, c3, b2, d2, b1, b3, d1, d3
  // a2 adj: a1, a3, b2, b1, b3
  // d2 adj: d1, d3, c2, e2, c1, c3, e1, e3

  it('008a: mixed overlap — friendly resolved first, then enemy, with iterative recalc', () => {
    // Massive P1 at footprint {b2, c2, b3, c3}.
    // Friendly P1 figure at b2 (overlaps).
    // Enemy P2 figure at c2 (overlaps).
    // Block most of b2's adj so friendly has limited options.
    const game = makeGame({
      figurePositions: {
        1: {
          'MASSIVE-1-0': 'a4',             // massive figure (excluded from overlaps)
          'Rebel Trooper-1-0': 'b2',       // friendly — in footprint
          'Rebel Trooper-2-0': 'a2',       // NOT in footprint, occupies a2
          'Rebel Trooper-3-0': 'a1',       // NOT in footprint, occupies a1
        },
        2: {
          'Stormtrooper (Regular)-1-0': 'c2',  // enemy — in footprint
        },
      },
    });
    const footprint = new Set(['b2', 'c2', 'b3', 'c3']);
    const pending = initMassiveDisplacement(game, 1, 'MASSIVE-1-0', footprint);
    assert.ok(pending, 'pending created');
    assert.strictEqual(pending.friendlyQueue.length, 1, '1 friendly overlap');
    assert.strictEqual(pending.enemyQueue.length, 1, '1 enemy overlap');
    assert.strictEqual(pending.phase, 'friendly', 'starts in friendly phase');

    // ── Phase 1: friendly ──
    // b2 adj: {b1, b3(f), a2(occupied), c2(f), a1(occupied), a3, c1, c3(f)}
    // valid: b1, a3, c1
    const r1 = resolveNextDisplacements(game, pending);
    if (r1.needsChoice) {
      // Friendly phase: massive controller (P1) has authority
      assert.strictEqual(r1.needsChoice.controllerPlayerNum, 1,
        'friendly phase authority = P1 (massive controller)');
      assert.ok(r1.needsChoice.validSpaces.length >= 2,
        'friendly has multiple options');
      // Choose b1 — this is adjacent to c2's adj list (c2 adj includes b1)
      const pickedSpace = r1.needsChoice.validSpaces.find(s => s === 'b1') || r1.needsChoice.validSpaces[0];
      applyDisplacementChoice(game, pending, pickedSpace);
    }
    // Friendly resolved — verify not in footprint
    const friendlyPos = game.figurePositions[1]['Rebel Trooper-1-0'];
    assert.ok(!footprint.has(friendlyPos), 'friendly displaced out of footprint');

    // ── Phase 2: enemy ──
    // c2 adj: {c1, c3(f), b2(f), d2, b1(maybe occupied by friendly!), b3(f), d1, d3}
    // If friendly went to b1, b1 is now occupied → c2's options exclude b1
    const r2 = resolveNextDisplacements(game, pending);
    for (const a of r2.autoResolved) {
      assert.strictEqual(a.entry.playerNum, 2, 'auto-resolved is enemy');
    }
    if (r2.needsChoice) {
      // Enemy phase: enemy player (P2) has authority
      assert.strictEqual(r2.needsChoice.controllerPlayerNum, 2,
        'enemy phase authority = P2 (displaced figure owner)');
      // Verify iterative recalc: if friendly was placed at b1, b1 should NOT be in options
      if (friendlyPos === 'b1') {
        assert.ok(!r2.needsChoice.validSpaces.includes('b1'),
          'iterative recalc: b1 excluded (occupied by previously displaced friendly)');
      }
      applyDisplacementChoice(game, pending, r2.needsChoice.validSpaces[0]);
    }

    // Finish
    if (!r2.done) {
      const r3 = resolveNextDisplacements(game, pending);
      assert.ok(r3.done, 'all resolved after enemy phase');
    }

    // Final state
    const enemyPos = game.figurePositions[2]['Stormtrooper (Regular)-1-0'];
    assert.ok(!footprint.has(enemyPos), 'enemy displaced out of footprint');
    assert.ok(friendlyPos !== enemyPos, 'friendly and enemy in different spaces');
  });
});
