/**
 * Forced step-by-step movement allowlist + figure-aware dynamic conditions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isForcedStepByStep, isForcedStepByStepForFigure } from './forced-step-movement.js';

describe('isForcedStepByStep (static DC allowlist)', () => {
  it('returns true for Iden Versio (Dio attached)', () => {
    assert.equal(isForcedStepByStep('Iden Versio'), true);
  });
  it('returns false for an ordinary DC', () => {
    assert.equal(isForcedStepByStep('Stormtrooper'), false);
    assert.equal(isForcedStepByStep('Kuiil'), false);
  });
});

describe('isForcedStepByStepForFigure (dynamic per-figure conditions)', () => {
  it('honors the static allowlist regardless of game state', () => {
    assert.equal(isForcedStepByStepForFigure('Iden Versio', {}, 'Iden Versio-1-0'), true);
  });

  it('forces step-by-step for Kuiil while a Hop On designation is active', () => {
    const game = { hopOnDesignated: { 'Kuiil-1-0': 'Bodhi Rook-1-0' } };
    assert.equal(isForcedStepByStepForFigure('Kuiil', game, 'Kuiil-1-0'), true);
  });

  it('does NOT force step-by-step for Kuiil with no designation', () => {
    assert.equal(isForcedStepByStepForFigure('Kuiil', { hopOnDesignated: {} }, 'Kuiil-1-0'), false);
    assert.equal(isForcedStepByStepForFigure('Kuiil', {}, 'Kuiil-1-0'), false);
  });

  it('only forces the designated Kuiil figure, not other figures', () => {
    const game = { hopOnDesignated: { 'Kuiil-1-0': 'Bodhi Rook-1-0' } };
    assert.equal(isForcedStepByStepForFigure('Kuiil', game, 'Kuiil-1-1'), false);
  });
});
