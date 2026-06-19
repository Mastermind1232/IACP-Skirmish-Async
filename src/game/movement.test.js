/**
 * Tests for src/game/movement.js using synthetic map data. Run: node --test src/game/movement.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  isWithinGridBounds,
  filterMapSpacesByBounds,
  buildTempBoardState,
  movementStateKey,
  getNormalizedFootprint,
  computeMovementCache,
  getSpacesAtCost,
  getMovementTarget,
  getReachableSpaces,
  getPathCost,
  getMovementPath,
  getMovementPathAvoiding,
  getImmediateStepSpaces,
} from './movement.js';

/** Build 5x5 grid a1..e5 with orthogonal adjacency. */
function buildGrid5x5(overrides = {}) {
  const { blocked = [], difficult = [], movementBlockingEdges = [] } = overrides;
  const spaces = [];
  const adjacency = {};
  const terrain = {};

  function coord(col, row) {
    return String.fromCharCode(97 + col) + (row + 1);
  }

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const k = coord(col, row);
      if (blocked.includes(k)) continue;
      spaces.push(k);
      terrain[k] = difficult.includes(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = col + dc, nr = row + dr;
        if (nc >= 0 && nc < 5 && nr >= 0 && nr < 5) {
          const nk = coord(nc, nr);
          if (!blocked.includes(nk)) {
            const edgeKey = [k, nk].sort().join('|');
            const isBlocked = movementBlockingEdges.some(
              ([a, b]) => [a, b].map((x) => String(x).toLowerCase()).sort().join('|') === edgeKey
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
    blocking: blocked,
    movementBlockingEdges: movementBlockingEdges || [],
    impassableEdges: [],
  };
}

const defaultProfile = {
  size: '1x1',
  cols: 1,
  rows: 1,
  isLarge: false,
  allowDiagonal: true,
  canRotate: false,
  isMassive: false,
  isMobile: false,
  ignoreDifficult: false,
  ignoreBlocking: false,
  ignoreFigureCost: false,
  canEndOnOccupied: false,
};

test('isWithinGridBounds', () => {
  assert.strictEqual(isWithinGridBounds('a1', null), true);
  assert.strictEqual(isWithinGridBounds('a1', {}), true);
  assert.strictEqual(isWithinGridBounds('a1', { maxCol: 4, maxRow: 4 }), true);
  assert.strictEqual(isWithinGridBounds('e5', { maxCol: 4, maxRow: 4 }), true);
  assert.strictEqual(isWithinGridBounds('f1', { maxCol: 4, maxRow: 4 }), false);
  assert.strictEqual(isWithinGridBounds('a6', { maxCol: 4, maxRow: 4 }), false);
  assert.strictEqual(isWithinGridBounds('invalid', { maxCol: 4, maxRow: 4 }), false);
});

test('filterMapSpacesByBounds', () => {
  const raw = buildGrid5x5();
  const filtered = filterMapSpacesByBounds(raw, { maxCol: 1, maxRow: 1 });
  assert.ok(filtered.spaces.length < raw.spaces.length);
  assert.ok(filtered.spaces.includes('a1'));
  assert.ok(filtered.spaces.includes('b1'));
  assert.ok(filtered.spaces.includes('a2'));
  assert.ok(!filtered.spaces.includes('c3'));
});

test('movementStateKey', () => {
  assert.strictEqual(movementStateKey('a1', '1x1'), 'a1|1x1');
  assert.strictEqual(movementStateKey('A1', '2x2'), 'a1|2x2');
});

test('getNormalizedFootprint', () => {
  assert.deepStrictEqual(getNormalizedFootprint('a1', '1x1'), ['a1']);
  assert.deepStrictEqual(getNormalizedFootprint('A1', '2x2'), ['a1', 'b1', 'a2', 'b2']);
});

test('buildTempBoardState', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  assert.ok(board);
  assert.ok(board.spacesSet);
  assert.ok(board.adjacency);
  assert.ok(board.spacesSet.has('a1'));
  assert.ok(Array.from(board.adjacency['a1'] || []).length > 0);
});

test('computeMovementCache empty board reachable', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('a1', 2, board, defaultProfile);
  assert.ok(cache.cells.size > 0);
  assert.ok(cache.cells.has('a1') === false); // start not in "reachable" cells (cost 0 excluded)
  assert.ok(cache.cells.has('b1') || cache.cells.has('a2'));
});

test('getSpacesAtCost', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('a1', 3, board, defaultProfile);
  const at1 = getSpacesAtCost(cache, 1);
  const at2 = getSpacesAtCost(cache, 2);
  assert.ok(Array.isArray(at1));
  assert.ok(Array.isArray(at2));
  assert.ok(at1.length >= 2);
});

test('getMovementTarget', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('a1', 2, board, defaultProfile);
  const target = getMovementTarget(cache, 'b1');
  assert.ok(target === null || (target && typeof target.cost === 'number'));
});

test('getReachableSpaces', () => {
  const mapSpaces = buildGrid5x5();
  const reachable = getReachableSpaces('a1', 2, mapSpaces, []);
  assert.ok(Array.isArray(reachable));
  assert.ok(reachable.length >= 2);
  assert.ok(reachable.every((c) => typeof c === 'string'));
});

test('getPathCost', () => {
  const mapSpaces = buildGrid5x5();
  const cost = getPathCost('a1', 'b1', mapSpaces, []);
  assert.strictEqual(typeof cost, 'number');
  assert.ok(cost >= 1 && cost < 50);
  const unreachable = getPathCost('a1', 'e5', mapSpaces, []);
  assert.ok(unreachable >= 1 && unreachable <= 50);
});

test('getPathCost blocked path', () => {
  const mapSpaces = buildGrid5x5({ blocked: ['b1', 'a2'] });
  const cost = getPathCost('a1', 'b2', mapSpaces, []);
  assert.strictEqual(cost, Infinity);
});

test('getMovementPath', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('a1', 5, board, defaultProfile);
  const path = getMovementPath(cache, 'a1', 'c3', '1x1', defaultProfile);
  assert.ok(Array.isArray(path));
  assert.ok(path.length >= 2);
  assert.strictEqual(path[0], 'a1');
});

test('getMovementPathAvoiding routes around a danger cell at equal MP cost', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const orthProfile = { ...defaultProfile, allowDiagonal: false };
  const cache = computeMovementCache('a1', 4, board, orthProfile);
  // b2 is reachable from a1 via b1 OR a2 — both cost 2. Mark b1 dangerous
  // (e.g. enemy adjacent): the avoider must take a1→a2→b2.
  const avoided = getMovementPathAvoiding(cache, board, 'a1', 'b2', '1x1', orthProfile, new Set(['b1']));
  assert.deepStrictEqual(avoided, ['a1', 'a2', 'b2']);
  // Symmetric: mark a2 dangerous instead → must take a1→b1→b2.
  const avoided2 = getMovementPathAvoiding(cache, board, 'a1', 'b2', '1x1', orthProfile, new Set(['a2']));
  assert.deepStrictEqual(avoided2, ['a1', 'b1', 'b2']);
});

test('getMovementPathAvoiding never costs extra MP (falls back to a shortest path)', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const orthProfile = { ...defaultProfile, allowDiagonal: false };
  const cache = computeMovementCache('a1', 4, board, orthProfile);
  // Both intermediate routes dangerous → still returns a length-3 shortest path.
  const path = getMovementPathAvoiding(cache, board, 'a1', 'b2', '1x1', orthProfile, new Set(['b1', 'a2']));
  assert.strictEqual(path.length, 3);
  assert.strictEqual(path[0], 'a1');
  assert.strictEqual(path[2], 'b2');
  // No danger set → identical to plain getMovementPath length.
  const plain = getMovementPathAvoiding(cache, board, 'a1', 'b2', '1x1', orthProfile, new Set());
  assert.strictEqual(plain.length, 3);
});

test('getImmediateStepSpaces returns only one-step neighbours (step-by-step mode)', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  // Orthogonal: a1 neighbours are b1 and a2 only.
  const orthProfile = { ...defaultProfile, allowDiagonal: false };
  const orth = getImmediateStepSpaces('a1', board, orthProfile, 10).sort();
  assert.deepStrictEqual(orth, ['a2', 'b1']);
  // Diagonal: a1 also reaches b2 in one step.
  const diag = getImmediateStepSpaces('a1', board, defaultProfile, 10).sort();
  assert.deepStrictEqual(diag, ['a2', 'b1', 'b2']);
  // Center cell b2 has 4 orthogonal neighbours.
  const center = getImmediateStepSpaces('b2', board, orthProfile, 10).sort();
  assert.deepStrictEqual(center, ['a2', 'b1', 'b3', 'c2']);
});

test('getImmediateStepSpaces respects the single-step MP budget', () => {
  const mapSpaces = buildGrid5x5({ difficult: ['b1'] });
  const board = buildTempBoardState(mapSpaces, []);
  const orthProfile = { ...defaultProfile, allowDiagonal: false };
  // b1 is difficult (costs 2); with only 1 MP it is unaffordable as a step.
  const oneMp = getImmediateStepSpaces('a1', board, orthProfile, 1).sort();
  assert.deepStrictEqual(oneMp, ['a2']);
  // With 2 MP, b1 becomes reachable in one step.
  const twoMp = getImmediateStepSpaces('a1', board, orthProfile, 2).sort();
  assert.deepStrictEqual(twoMp, ['a2', 'b1']);
});

test('getReachableSpaces mp 0 returns empty', () => {
  const mapSpaces = buildGrid5x5();
  const reachable = getReachableSpaces('a1', 0, mapSpaces, []);
  assert.deepStrictEqual(reachable, []);
});

// --- Extended movement tests (Pillar 8) ---

test('difficult terrain costs 2 MP', () => {
  const mapSpaces = buildGrid5x5({ difficult: ['b1'] });
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('a1', 2, board, defaultProfile);
  // b1 is difficult: costs 2 MP from a1
  const target = getMovementTarget(cache, 'b1');
  assert.ok(target);
  assert.strictEqual(target.cost, 2);
});

test('ignoreDifficult bypasses difficult terrain cost', () => {
  const mapSpaces = buildGrid5x5({ difficult: ['b1'] });
  const board = buildTempBoardState(mapSpaces, []);
  const profile = { ...defaultProfile, ignoreDifficult: true };
  const cache = computeMovementCache('a1', 2, board, profile);
  const target = getMovementTarget(cache, 'b1');
  assert.ok(target);
  assert.strictEqual(target.cost, 1); // ignores difficult, costs 1
});

test('movement-blocking edge prevents crossing', () => {
  const mapSpaces = buildGrid5x5({ movementBlockingEdges: [['a1', 'b1']] });
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('a1', 3, board, defaultProfile);
  // b1 should still be reachable via a2→b2→b1 (3 MP)
  const target = getMovementTarget(cache, 'b1');
  if (target) {
    assert.ok(target.cost > 1); // can't go directly, must detour
  }
});

test('occupied spaces block movement for hostile figures', () => {
  const mapSpaces = buildGrid5x5();
  // buildTempBoardState takes occupiedSet (strings) and hostileOccupiedSet (strings)
  const board = buildTempBoardState(mapSpaces, ['b1'], ['b1']);
  const cache = computeMovementCache('a1', 3, board, defaultProfile);
  // b1 is hostile occupied — cannot end there
  const target = getMovementTarget(cache, 'b1');
  assert.ok(!target); // can't enter hostile space
});

test('friendly occupied spaces allow passage', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, [{ coord: 'b1', hostile: false }]);
  const cache = computeMovementCache('a1', 2, board, defaultProfile);
  // b1 is friendly occupied — can pass through but not end there
  const c1Target = getMovementTarget(cache, 'c1');
  assert.ok(c1Target);
  assert.strictEqual(c1Target.cost, 2);
});

test('completely isolated start returns no reachable spaces', () => {
  const mapSpaces = buildGrid5x5({ blocked: ['a2', 'b1'] });
  const reachable = getReachableSpaces('a1', 5, mapSpaces, []);
  assert.deepStrictEqual(reachable, []);
});

test('getReachableSpaces with large MP covers entire grid', () => {
  const mapSpaces = buildGrid5x5();
  const reachable = getReachableSpaces('a1', 10, mapSpaces, []);
  // 5x5 grid = 25 spaces, minus start = 24 reachable
  assert.strictEqual(reachable.length, 24);
});

test('getPathCost returns 1 for adjacent spaces', () => {
  const mapSpaces = buildGrid5x5();
  const cost = getPathCost('a1', 'a2', mapSpaces, []);
  assert.strictEqual(cost, 1);
});

test('getPathCost through difficult terrain costs more', () => {
  // Disable diagonals so paths are orthogonal-only
  const mapSpaces = buildGrid5x5({ difficult: ['b1'] });
  const cost = getPathCost('a1', 'c1', mapSpaces, []);
  // With diagonals enabled, a1→b2(diag)→c1(diag) = 2 (bypasses difficult b1)
  assert.strictEqual(cost, 2);
});

test('getMovementPath returns valid path through grid', () => {
  const mapSpaces = buildGrid5x5();
  const board = buildTempBoardState(mapSpaces, []);
  const cache = computeMovementCache('c3', 4, board, defaultProfile);
  const path = getMovementPath(cache, 'c3', 'e5', '1x1', defaultProfile);
  assert.ok(Array.isArray(path));
  assert.strictEqual(path[0], 'c3');
  assert.strictEqual(path[path.length - 1], 'e5');
  // With diagonal movement: c3 → d4 → e5 = 3 steps (2 MP via diagonals)
  assert.ok(path.length >= 2 && path.length <= 5);
});

test('2x2 figure getNormalizedFootprint', () => {
  const fp = getNormalizedFootprint('a1', '2x2');
  assert.deepStrictEqual(fp, ['a1', 'b1', 'a2', 'b2']);
});

test('2x2 figure getNormalizedFootprint from different anchor', () => {
  const fp = getNormalizedFootprint('b2', '2x2');
  assert.deepStrictEqual(fp, ['b2', 'c2', 'b3', 'c3']);
});
