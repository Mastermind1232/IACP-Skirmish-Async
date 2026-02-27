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
