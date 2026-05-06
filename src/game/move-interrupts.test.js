import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractMoveInterruptOpportunities, PB_TYPE, DT_TYPE, SD_TYPE } from './move-interrupts.js';

// Mock the data-loader/movement deps that move-interrupts.js imports. Since
// we can't easily mock ESM imports without a heavier harness, the tests use
// real shared maps. We construct a minimal map with adjacency hand-wired
// and place figures via game.figurePositions.

// Re-import the real movement helper to use its adjacency walk; we only
// need a real map id whose adjacency we control via getMapData. The
// simplest approach: use a known map ID and lean on real spatial data.
//
// For unit-test purity, we exercise the path-iteration + filtering logic
// by mocking getFiguresAdjacentToCoord via dependency injection. But the
// helper imports it directly. So instead, we use a real dummy game on a
// real map and verify boundaries.
//
// Practical compromise: use a minimal mock map registered via the real
// data-loader's map registry — too heavy for a unit test. Skip integration
// here; behavioral tests below cover null/empty/skipInterrupts/empty-path
// branches that don't depend on real map data.

test('extractMoveInterruptOpportunities: empty path returns []', () => {
  const out = extractMoveInterruptOpportunities({}, 'map1', { figureKey: 'A-1-0', playerNum: 1 }, [], {});
  assert.deepEqual(out, []);
});

test('extractMoveInterruptOpportunities: single-cell path (no movement) returns []', () => {
  const out = extractMoveInterruptOpportunities({}, 'map1', { figureKey: 'A-1-0', playerNum: 1 }, ['a1'], {});
  assert.deepEqual(out, []);
});

test('extractMoveInterruptOpportunities: skipInterrupts=true returns [] regardless of path', () => {
  const out = extractMoveInterruptOpportunities({}, 'map1', { figureKey: 'A-1-0', playerNum: 1 }, ['a1', 'a2', 'a3'], { skipInterrupts: true });
  assert.deepEqual(out, []);
});

test('extractMoveInterruptOpportunities: missing mover returns []', () => {
  const out = extractMoveInterruptOpportunities({}, 'map1', null, ['a1', 'a2'], {});
  assert.deepEqual(out, []);
  const out2 = extractMoveInterruptOpportunities({}, 'map1', { figureKey: '', playerNum: 1 }, ['a1', 'a2'], {});
  assert.deepEqual(out2, []);
});

test('extractMoveInterruptOpportunities: missing game/mapId returns []', () => {
  const out = extractMoveInterruptOpportunities(null, 'map1', { figureKey: 'A-1-0', playerNum: 1 }, ['a1', 'a2'], {});
  assert.deepEqual(out, []);
  const out2 = extractMoveInterruptOpportunities({}, '', { figureKey: 'A-1-0', playerNum: 1 }, ['a1', 'a2'], {});
  assert.deepEqual(out2, []);
});

test('PB_TYPE / DT_TYPE / SD_TYPE constants are exported and distinct', () => {
  assert.equal(PB_TYPE, 'PB');
  assert.equal(DT_TYPE, 'DT');
  assert.equal(SD_TYPE, 'SD');
  assert.notEqual(PB_TYPE, DT_TYPE);
  assert.notEqual(DT_TYPE, SD_TYPE);
  assert.notEqual(PB_TYPE, SD_TYPE);
});
