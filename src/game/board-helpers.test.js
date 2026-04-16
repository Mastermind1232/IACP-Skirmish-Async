import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getClosedDoorEdges, countGameSpaces } from './board-helpers.js';
import { edgeKey } from './coords.js';

describe('getClosedDoorEdges', () => {
  it('returns empty set when game has no map', () => {
    const game = {};
    assert.strictEqual(getClosedDoorEdges(game).size, 0);
  });

  it('returns empty set for null game', () => {
    assert.strictEqual(getClosedDoorEdges(null).size, 0);
  });

  it('returns all door edges when no doors are opened', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
    const edges = getClosedDoorEdges(game);
    // mos-eisley-outskirts current door set: r11|r12, s11|s12
    assert.strictEqual(edges.size, 2);
    assert.ok(edges.has(edgeKey('r11', 'r12')));
    assert.ok(edges.has(edgeKey('s11', 's12')));
  });

  it('excludes opened doors', () => {
    const game = {
      selectedMap: { id: 'mos-eisley-outskirts' },
      openedDoors: [edgeKey('r11', 'r12')],
    };
    const edges = getClosedDoorEdges(game);
    assert.strictEqual(edges.size, 1);
    assert.ok(!edges.has(edgeKey('r11', 'r12')));
    assert.ok(edges.has(edgeKey('s11', 's12')));
  });

  it('returns empty set when all doors are opened', () => {
    const game = {
      selectedMap: { id: 'mos-eisley-outskirts' },
      openedDoors: [
        edgeKey('r11', 'r12'),
        edgeKey('s11', 's12'),
      ],
    };
    assert.strictEqual(getClosedDoorEdges(game).size, 0);
  });
});

describe('countGameSpaces', () => {
  it('returns Infinity when game has no map', () => {
    assert.strictEqual(countGameSpaces({}, 'a1', 'a2'), Infinity);
  });

  it('returns 0 for same coord', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
    assert.strictEqual(countGameSpaces(game, 'a1', 'a1'), 0);
  });

  it('returns BFS distance for adjacent spaces', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
    // m17 and m16 are door-adjacent — with door closed, path must go around
    // m17 and m18 should be adjacent on the map (1 step)
    const dist = countGameSpaces(game, 'm17', 'm18');
    assert.ok(dist >= 0 && dist < Infinity, `expected finite distance, got ${dist}`);
  });
});
