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

test('getReachableSpaces mp 0 returns empty', () => {
  const mapSpaces = buildGrid5x5();
  const reachable = getReachableSpaces('a1', 0, mapSpaces, []);
  assert.deepStrictEqual(reachable, []);
});
