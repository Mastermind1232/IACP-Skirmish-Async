/**
 * Unlimited Power (Emperor Palpatine CC): "Use when you use Emperor. You may
 * choose any other friendly figure on the map instead of another friendly
 * figure within 4 spaces."
 *
 * The handler set game.unlimitedPowerActive[playerNum] but nothing read it — the
 * Emperor targeting still enforced the 4-space limit. This verifies the reader:
 * with the flag, the limit is lifted. (countGameSpaces returns Infinity with no
 * selected map, so every figure reads as >4 — exactly the case the flag must
 * override.) alexanbv 2026-06-17.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const META = { gameId: 'g1', playerNum: 1, dcName: 'Emperor Palpatine', displayName: 'Emperor Palpatine [Group 1]' };

function fixture(unlimited) {
  const game = {
    gameId: 'g1',
    figurePositions: { 1: { 'Emperor Palpatine-1-0': 'A1', 'Royal Guard-1-0': 'Z26' } },
    dcActionsData: { 'm-emp': { selectedFigure: 0 } },
  };
  if (unlimited) game.unlimitedPowerActive = { 1: true };
  return game;
}

describe('Unlimited Power — Emperor targeting range', () => {
  it('without the flag, a far friendly figure is out of range (4-space limit enforced)', () => {
    const r = resolveAbility('emperor_interrupt', { game: fixture(false), playerNum: 1, meta: META, msgId: 'm-emp' });
    assert.equal(r.applied, false);
    assert.match(r.manualMessage, /within 4 spaces/);
  });

  it('with Unlimited Power active, the far friendly figure becomes a valid target', () => {
    const r = resolveAbility('emperor_interrupt', { game: fixture(true), playerNum: 1, meta: META, msgId: 'm-emp' });
    assert.equal(r.requiresChoice, true);
    assert.ok(r.targetFigureKeys.includes('Royal Guard-1-0'), 'any friendly figure on the map is targetable');
  });
});
