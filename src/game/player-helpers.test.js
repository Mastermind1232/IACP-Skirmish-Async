import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { opponentPlayerNum, getInitiativePlayerNum } from './player-helpers.js';

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
