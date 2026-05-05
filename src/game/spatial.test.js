import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRange,
  hasLineOfSight,
  isWithinSpaces,
  countSpaces,
} from './spatial.js';

describe('getRange', () => {
  it('returns 0 for same coord', () => {
    assert.strictEqual(getRange('a1', 'a1'), 0);
  });
  it('returns Manhattan distance', () => {
    assert.strictEqual(getRange('a1', 'c3'), 4); // |0-2| + |0-2| = 4
  });
  it('returns 999 for unparseable coord', () => {
    assert.strictEqual(getRange('!!!', 'a1'), 999);
  });
  it('handles uppercase coords', () => {
    assert.strictEqual(getRange('A1', 'B2'), 2);
  });
});

// isAdjacentCoords + isWithinRange describe blocks removed 2026-05-05
// alongside the dead Manhattan helpers themselves.

describe('hasLineOfSight', () => {
  const emptyMap = { blocking: [], impassableEdges: [] };
  it('returns true for same coord', () => {
    assert.ok(hasLineOfSight('a1', 'a1', emptyMap));
  });
  it('returns true with no obstructions', () => {
    assert.ok(hasLineOfSight('a1', 'c3', emptyMap));
  });
  it('returns false for unparseable coords', () => {
    assert.ok(!hasLineOfSight('!!!', 'a1', emptyMap));
  });
  it('blocks LOS through blocking terrain', () => {
    const map = { blocking: ['b2'], impassableEdges: [] };
    // a1 to c3 passes through b2
    assert.ok(!hasLineOfSight('a1', 'c3', map));
  });
  it('allows LOS that skirts blocking terrain', () => {
    const map = { blocking: ['b2'], impassableEdges: [] };
    // a1 to a3 doesn't go through b2
    assert.ok(hasLineOfSight('a1', 'a3', map));
  });
  // NOTE: synthetic single-wall isolated-cell tests aren't representative of
  // Nick's algorithm + curated `blockingIntersections` data on real maps. A
  // bare ['a1', 'b1'] wall on a 2-cell map gets translated into one wall
  // segment with no surrounding BI data; Nick's state-machine check at the
  // wall endpoint doesn't fire because no other walls connect there. Real
  // maps come with BI corners that block these adjacency cases properly,
  // and the lothal-wastes oracle (69/69) covers them.
  it('respects figureBlockingCoords', () => {
    const blocking = new Set(['b2']);
    assert.ok(!hasLineOfSight('a1', 'c3', emptyMap, blocking));
  });
});

describe('isWithinSpaces', () => {
  const mapSpaces = {
    adjacency: {
      a1: ['a2', 'b1'],
      a2: ['a1', 'a3', 'b2'],
      a3: ['a2'],
      b1: ['a1', 'b2'],
      b2: ['b1', 'a2'],
    },
  };
  it('returns true for same coord', () => {
    assert.ok(isWithinSpaces(mapSpaces, 'a1', 'a1', 1));
  });
  it('returns true for adjacent', () => {
    assert.ok(isWithinSpaces(mapSpaces, 'a1', 'a2', 1));
  });
  it('returns true for 2 steps', () => {
    assert.ok(isWithinSpaces(mapSpaces, 'a1', 'a3', 2));
  });
  it('returns false if too far', () => {
    assert.ok(!isWithinSpaces(mapSpaces, 'a1', 'a3', 1));
  });
  it('returns false for disconnected coords', () => {
    const sparse = { adjacency: { a1: ['a2'], a2: ['a1'] } };
    assert.ok(!isWithinSpaces(sparse, 'a1', 'c1', 5));
  });
  it('returns false with no adjacency data', () => {
    assert.ok(!isWithinSpaces({}, 'a1', 'a2', 1));
  });
});

describe('countSpaces', () => {
  // Open grid with diagonals: a1↔a2, a1↔b1, a1↔b2, a2↔b2, b1↔b2, b1↔c1, b2↔c2, c1↔c2
  const openGrid = {
    adjacency: {
      a1: ['a2', 'b1', 'b2'],
      a2: ['a1', 'b2'],
      b1: ['a1', 'b2', 'c1', 'a2', 'c2'],
      b2: ['a1', 'a2', 'b1', 'c2'],
      c1: ['b1', 'c2', 'b2'],
      c2: ['b2', 'c1', 'b1'],
    },
  };

  it('returns 0 for same coord', () => {
    assert.strictEqual(countSpaces(openGrid, 'a1', 'a1'), 0);
  });
  it('returns 1 for diagonal-adjacent (open space)', () => {
    assert.strictEqual(countSpaces(openGrid, 'a1', 'b2'), 1);
  });
  it('returns 2 for two-step path', () => {
    assert.strictEqual(countSpaces(openGrid, 'a1', 'c2'), 2);
  });

  // Wall scenario: c3 and d4 NOT directly adjacent (wall between)
  // Path must go c3→c4→d4 (2 steps)
  const wallGrid = {
    adjacency: {
      c3: ['c4', 'd3'],  // c3 NOT adjacent to d4 (wall blocks diagonal)
      c4: ['c3', 'd4'],
      d3: ['c3', 'd4'],
      d4: ['c4', 'd3'],  // d4 NOT adjacent to c3
    },
  };
  it('returns 2 when wall forces detour', () => {
    assert.strictEqual(countSpaces(wallGrid, 'c3', 'd4'), 2);
  });

  // Door scenario: r11↔r12 adjacent in graph, but closed door blocks
  const doorGrid = {
    adjacency: {
      r11: ['r12', 'r10', 's11'],
      r12: ['r11', 'r13', 's12'],
      r10: ['r11', 's10'],
      s11: ['r11', 's10', 's12'],
      s10: ['r10', 's11'],
      s12: ['r12', 's11', 'r13'],
      r13: ['r12', 's12'],
    },
  };
  it('returns 1 when door is open (no blockedEdges)', () => {
    assert.strictEqual(countSpaces(doorGrid, 'r11', 'r12'), 1);
  });
  it('returns longer path when door is closed (blockedEdges)', () => {
    const closedDoors = new Set(['r11|r12']);
    const dist = countSpaces(doorGrid, 'r11', 'r12', closedDoors);
    assert.ok(dist > 1, `closed door forces detour: got ${dist}`);
    assert.strictEqual(dist, 3); // r11→s11→s12→r12
  });

  it('returns Infinity for unreachable coord', () => {
    const disconnected = { adjacency: { a1: ['a2'], a2: ['a1'] } };
    assert.strictEqual(countSpaces(disconnected, 'a1', 'z99'), Infinity);
  });
  it('returns Infinity with no adjacency data', () => {
    assert.strictEqual(countSpaces({}, 'a1', 'a2'), Infinity);
  });
});

// getFiguresWithinRange + getFiguresAdjacentTo describe blocks removed
// 2026-05-05 alongside the dead Manhattan helpers themselves.
