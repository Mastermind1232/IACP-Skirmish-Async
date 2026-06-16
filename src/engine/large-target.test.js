// Large-target square-declaration data model (alexanbv 2026-06-16).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLargeTarget, getTargetSquares } from './large-target.js';

describe('large-target square model', () => {
  const g = { figurePositions: { 2: { 'Nexu (Elite)-2-0': 'b2', 'Darth Vader-2-1': 'e5' } } };
  it('a >1x1 figure is a large target; a 1x1 is not', () => {
    assert.equal(isLargeTarget(g, 'Nexu (Elite)-2-0'), true);  // 2x2
    assert.equal(isLargeTarget(g, 'Darth Vader-2-1'), false);  // 1x1
  });
  it('getTargetSquares returns every footprint cell for a large target', () => {
    assert.deepEqual(getTargetSquares(g, 2, 'Nexu (Elite)-2-0').sort(), ['b2', 'b3', 'c2', 'c3']);
    assert.deepEqual(getTargetSquares(g, 2, 'Darth Vader-2-1'), ['e5']);
  });
  it('returns [] for an unplaced figure', () => {
    assert.deepEqual(getTargetSquares(g, 2, 'Ghost-2-9'), []);
  });
});
