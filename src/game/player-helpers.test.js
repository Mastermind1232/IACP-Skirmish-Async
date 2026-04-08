import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { opponentPlayerNum, getInitiativePlayerNum, pushFigure } from './player-helpers.js';

describe('opponentPlayerNum', () => {
  test('returns 2 for 1', () => assert.strictEqual(opponentPlayerNum(1), 2));
  test('returns 1 for 2', () => assert.strictEqual(opponentPlayerNum(2), 1));
  test('returns 1 for 0 (falsy)', () => assert.strictEqual(opponentPlayerNum(0), 1));
  test('returns 1 for undefined', () => assert.strictEqual(opponentPlayerNum(undefined), 1));
  test('returns 1 for null', () => assert.strictEqual(opponentPlayerNum(null), 1));
});

describe('getInitiativePlayerNum', () => {
  test('returns 1 when p1 has initiative', () => {
    assert.strictEqual(getInitiativePlayerNum({ initiativePlayerId: 'u1', player1Id: 'u1' }), 1);
  });
  test('returns 2 when p2 has initiative', () => {
    assert.strictEqual(getInitiativePlayerNum({ initiativePlayerId: 'u2', player1Id: 'u1' }), 2);
  });
  test('returns 2 when initiativePlayerId is undefined', () => {
    assert.strictEqual(getInitiativePlayerNum({ player1Id: 'u1' }), 2);
  });
});

describe('pushFigure', () => {
  function makeGame(pos) {
    return { figurePositions: { 1: { ...pos }, 2: {} } };
  }

  test('returns null if figure has no position', () => {
    const game = makeGame({});
    const result = pushFigure(game, 1, 'Storm-1-0', 'b3');
    assert.strictEqual(result, null);
    assert.strictEqual(game.figurePositions[1]['Storm-1-0'], undefined);
  });

  test('returns null if playerNum bucket does not exist', () => {
    const game = { figurePositions: {} };
    const result = pushFigure(game, 1, 'Storm-1-0', 'b3');
    assert.strictEqual(result, null);
  });

  test('returns null if figurePositions is missing', () => {
    const game = {};
    const result = pushFigure(game, 1, 'Storm-1-0', 'b3');
    assert.strictEqual(result, null);
  });

  test('updates position and returns prevPos/newPos', () => {
    const game = makeGame({ 'Storm-1-0': 'a1' });
    const result = pushFigure(game, 1, 'Storm-1-0', 'B3');
    assert.deepStrictEqual(result, { prevPos: 'a1', newPos: 'b3' });
    assert.strictEqual(game.figurePositions[1]['Storm-1-0'], 'b3');
  });

  test('normalizes destination to lowercase', () => {
    const game = makeGame({ 'Storm-1-0': 'a1' });
    const result = pushFigure(game, 1, 'Storm-1-0', 'C5');
    assert.strictEqual(result.newPos, 'c5');
    assert.strictEqual(game.figurePositions[1]['Storm-1-0'], 'c5');
  });

  test('preserves other figures in same player bucket', () => {
    const game = makeGame({ 'Storm-1-0': 'a1', 'Storm-1-1': 'd4' });
    pushFigure(game, 1, 'Storm-1-0', 'b2');
    assert.strictEqual(game.figurePositions[1]['Storm-1-0'], 'b2');
    assert.strictEqual(game.figurePositions[1]['Storm-1-1'], 'd4');
  });
});
