import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateState } from '../../src/ai/evaluator.js';

describe('evaluateState', () => {
  const baseGame = {
    gameId: '00020',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    player1VP: { total: 10 },
    player2VP: { total: 5 },
    figurePositions: {
      1: { 'IG-88-1-0': 'e5', 'Stormtrooper-1-0': 'f5' },
      2: { 'Luke-1-0': 'j5' },
    },
  };

  it('returns positive score for player with VP advantage', () => {
    const p1Score = evaluateState(baseGame, 1);
    const p2Score = evaluateState(baseGame, 2);
    assert.ok(p1Score > 0, `P1 score should be positive, got ${p1Score}`);
    assert.ok(p2Score < 0, `P2 score should be negative, got ${p2Score}`);
  });

  it('returns 0 for null game', () => {
    assert.strictEqual(evaluateState(null, 1), 0);
  });

  it('returns high score for winner', () => {
    const game = { ...baseGame, ended: true, winnerId: 'p1' };
    const score = evaluateState(game, 1);
    assert.strictEqual(score, 10000);
  });

  it('returns low score for loser', () => {
    const game = { ...baseGame, ended: true, winnerId: 'p1' };
    const score = evaluateState(game, 2);
    assert.strictEqual(score, -10000);
  });

  it('returns symmetric scores for equal positions', () => {
    const game = {
      ...baseGame,
      player1VP: { total: 10 },
      player2VP: { total: 10 },
      figurePositions: {
        1: { 'A-1-0': 'e5' },
        2: { 'B-1-0': 'j5' },
      },
    };
    const p1Score = evaluateState(game, 1);
    const p2Score = evaluateState(game, 2);
    // Scores should be equal magnitude but opposite sign
    assert.ok(Object.is(p1Score, 0) && Object.is(p2Score, 0) || p1Score === -p2Score,
      `Expected symmetric: p1=${p1Score}, p2=${p2Score}`);
  });

  it('accounts for material advantage', () => {
    const game = {
      ...baseGame,
      player1VP: { total: 0 },
      player2VP: { total: 0 },
      figurePositions: {
        1: { 'A-1-0': 'e5', 'B-1-0': 'f5', 'C-1-0': 'g5' },
        2: { 'D-1-0': 'j5' },
      },
    };
    const p1Score = evaluateState(game, 1);
    assert.ok(p1Score > 0, `P1 with 3 figures vs 1 should score positive, got ${p1Score}`);
  });
});
