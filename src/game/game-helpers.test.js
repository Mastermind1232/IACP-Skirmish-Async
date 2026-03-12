import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { grantMovementBank, grantPowerTokens, resolveOverflowDiscard, getPlayerDeploymentZones } from './game-helpers.js';

describe('grantMovementBank', () => {
  it('initializes bank and entry when absent', () => {
    const game = {};
    grantMovementBank(game, 'msg1', 3);
    assert.deepStrictEqual(game.movementBank, { msg1: { total: 3, remaining: 3 } });
  });
  it('adds to existing entry', () => {
    const game = { movementBank: { msg1: { total: 2, remaining: 1 } } };
    grantMovementBank(game, 'msg1', 2);
    assert.strictEqual(game.movementBank.msg1.total, 4);
    assert.strictEqual(game.movementBank.msg1.remaining, 3);
  });
  it('no-ops for null msgId', () => {
    const game = {};
    grantMovementBank(game, null, 3);
    assert.strictEqual(game.movementBank, undefined);
  });
  it('no-ops for zero amount', () => {
    const game = {};
    grantMovementBank(game, 'msg1', 0);
    assert.strictEqual(game.movementBank, undefined);
  });
});

describe('grantPowerTokens', () => {
  it('initializes and grants tokens', () => {
    const game = {};
    const granted = grantPowerTokens(game, 'fig-1-0', 'Block', 2);
    assert.strictEqual(granted, 2);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Block', 'Block']);
    // No overflow since default max is 2 (from getMaxPowerTokens)
  });
  it('always grants tokens and queues overflow when exceeding max', () => {
    const game = { figurePowerTokens: { 'fig-1-0': ['Hit'] } };
    const granted = grantPowerTokens(game, 'fig-1-0', 'Block', 3, 2);
    assert.strictEqual(granted, 3);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Hit', 'Block', 'Block', 'Block']);
    // Should have overflow: 4 tokens, max 2, so overflow = 2
    assert.ok(game.pendingPowerTokenOverflow);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, 'fig-1-0');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 2);
  });
  it('queues overflow when already at max', () => {
    const game = { figurePowerTokens: { 'fig-1-0': ['Hit', 'Block', 'Surge'] } };
    const granted = grantPowerTokens(game, 'fig-1-0', 'Block', 2, 3);
    assert.strictEqual(granted, 2);
    assert.strictEqual(game.figurePowerTokens['fig-1-0'].length, 5);
    assert.ok(game.pendingPowerTokenOverflow);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 2);
  });
  it('no overflow when under max', () => {
    const game = {};
    const granted = grantPowerTokens(game, 'fig-1-0', 'Evade', 1, 5);
    assert.strictEqual(granted, 1);
    assert.strictEqual(game.figurePowerTokens['fig-1-0'].length, 1);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
  });
  it('no-ops for null figureKey', () => {
    const game = {};
    grantPowerTokens(game, null, 'Block', 1);
    assert.strictEqual(game.figurePowerTokens, undefined);
  });
});

describe('resolveOverflowDiscard', () => {
  it('removes the chosen token and decrements overflow', () => {
    const game = {
      figurePowerTokens: { 'fig-1-0': ['Hit', 'Block', 'Surge'] },
      pendingPowerTokenOverflow: [{ figureKey: 'fig-1-0', discardCount: 1 }],
    };
    const result = resolveOverflowDiscard(game, 'fig-1-0', 1); // discard 'Block'
    assert.strictEqual(result.discarded, 'Block');
    assert.strictEqual(result.remaining, 0);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Hit', 'Surge']);
    assert.strictEqual(game.pendingPowerTokenOverflow, null); // cleared
  });
  it('handles multiple discards needed', () => {
    const game = {
      figurePowerTokens: { 'fig-1-0': ['Hit', 'Block', 'Surge', 'Evade'] },
      pendingPowerTokenOverflow: [{ figureKey: 'fig-1-0', discardCount: 2 }],
    };
    const result = resolveOverflowDiscard(game, 'fig-1-0', 0); // discard 'Hit'
    assert.strictEqual(result.discarded, 'Hit');
    assert.strictEqual(result.remaining, 1);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Block', 'Surge', 'Evade']);
    assert.ok(game.pendingPowerTokenOverflow); // still has overflow
  });
  it('returns null for invalid index', () => {
    const game = {
      figurePowerTokens: { 'fig-1-0': ['Hit'] },
      pendingPowerTokenOverflow: [{ figureKey: 'fig-1-0', discardCount: 1 }],
    };
    const result = resolveOverflowDiscard(game, 'fig-1-0', 5);
    assert.strictEqual(result.discarded, null);
  });
});

describe('getPlayerDeploymentZones', () => {
  it('gives chosen zone to initiative player (P1)', () => {
    const game = { deploymentZoneChosen: 'red' };
    const { p1Zone, p2Zone } = getPlayerDeploymentZones(game, 1);
    assert.strictEqual(p1Zone, 'red');
    assert.strictEqual(p2Zone, 'blue');
  });
  it('gives opposite zone to initiative player (P2)', () => {
    const game = { deploymentZoneChosen: 'red' };
    const { p1Zone, p2Zone } = getPlayerDeploymentZones(game, 2);
    assert.strictEqual(p1Zone, 'blue');
    assert.strictEqual(p2Zone, 'red');
  });
  it('handles blue chosen zone', () => {
    const game = { deploymentZoneChosen: 'blue' };
    const { p1Zone, p2Zone } = getPlayerDeploymentZones(game, 1);
    assert.strictEqual(p1Zone, 'blue');
    assert.strictEqual(p2Zone, 'red');
  });
});
