import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { grantMovementBank, grantPowerTokens, getPlayerDeploymentZones } from './game-helpers.js';

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
  });
  it('respects max cap', () => {
    const game = { figurePowerTokens: { 'fig-1-0': ['Hit'] } };
    const granted = grantPowerTokens(game, 'fig-1-0', 'Block', 3, 2);
    assert.strictEqual(granted, 1);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Hit', 'Block']);
  });
  it('returns 0 when already at max', () => {
    const game = { figurePowerTokens: { 'fig-1-0': ['Hit', 'Block', 'Surge'] } };
    const granted = grantPowerTokens(game, 'fig-1-0', 'Block', 2, 3);
    assert.strictEqual(granted, 0);
  });
  it('grants without limit when max not provided', () => {
    const game = {};
    const granted = grantPowerTokens(game, 'fig-1-0', 'Evade', 5);
    assert.strictEqual(granted, 5);
    assert.strictEqual(game.figurePowerTokens['fig-1-0'].length, 5);
  });
  it('no-ops for null figureKey', () => {
    const game = {};
    grantPowerTokens(game, null, 'Block', 1);
    assert.strictEqual(game.figurePowerTokens, undefined);
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
