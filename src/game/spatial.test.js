import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRange,
  isAdjacentCoords,
  isWithinRange,
  hasLineOfSight,
  isWithinSpaces,
  getFiguresWithinRange,
  getFiguresAdjacentTo,
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

describe('isAdjacentCoords', () => {
  it('returns true for adjacent', () => {
    assert.ok(isAdjacentCoords('a1', 'a2'));
    assert.ok(isAdjacentCoords('a1', 'b1'));
  });
  it('returns false for same space', () => {
    assert.ok(!isAdjacentCoords('a1', 'a1'));
  });
  it('returns false for diagonal', () => {
    assert.ok(!isAdjacentCoords('a1', 'b2'));
  });
});

describe('isWithinRange', () => {
  it('returns true when within range', () => {
    assert.ok(isWithinRange('a1', 'c1', 3));
  });
  it('returns false when out of range', () => {
    assert.ok(!isWithinRange('a1', 'e1', 3));
  });
  it('returns true for same space at range 0', () => {
    assert.ok(isWithinRange('a1', 'a1', 0));
  });
});

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
  it('blocks LOS through impassable wall', () => {
    const map = { blocking: [], impassableEdges: [['a1', 'b1']] };
    assert.ok(!hasLineOfSight('a1', 'b1', map));
  });
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

describe('getFiguresWithinRange', () => {
  const game = {
    figurePositions: {
      1: { 'Stormtrooper-0-0': 'a1', 'Stormtrooper-0-1': 'c3' },
      2: { 'Rebel-0-0': 'b2' },
    },
  };
  it('finds figures within range', () => {
    const result = getFiguresWithinRange(game, 'a1', 2);
    const keys = result.map((r) => r.figureKey);
    assert.ok(keys.includes('Stormtrooper-0-0')); // distance 0
    assert.ok(keys.includes('Rebel-0-0')); // distance 2
    assert.ok(!keys.includes('Stormtrooper-0-1')); // distance 4
  });
  it('filters by playerNum', () => {
    const result = getFiguresWithinRange(game, 'a1', 5, 2);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].figureKey, 'Rebel-0-0');
  });
  it('includes distance', () => {
    const result = getFiguresWithinRange(game, 'a1', 5);
    const rebel = result.find((r) => r.figureKey === 'Rebel-0-0');
    assert.strictEqual(rebel.distance, 2);
  });
});

describe('getFiguresAdjacentTo', () => {
  const game = {
    figurePositions: {
      1: { 'Trooper-0-0': 'a2' },
      2: { 'Rebel-0-0': 'c1' },
    },
  };
  it('returns only adjacent figures (distance === 1)', () => {
    const result = getFiguresAdjacentTo(game, 'a1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].figureKey, 'Trooper-0-0');
  });
  it('excludes same-space figures', () => {
    const result = getFiguresAdjacentTo(game, 'a2');
    // Trooper at a2 has distance 0, not adjacent
    assert.strictEqual(result.length, 0);
  });
});
