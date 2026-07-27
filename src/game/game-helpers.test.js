import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { grantMovementBank, grantPowerTokens, resolveOverflowDiscard, getPlayerDeploymentZones, expireImmediateMp } from './game-helpers.js';

describe('grantMovementBank', () => {
  it('initializes bank and figure-0 sub-bank when absent', () => {
    const game = {};
    grantMovementBank(game, 'msg1', 3);
    // Per alexanbv 2026-06-13: per-figure only — MP lives in perFig[0].
    assert.deepStrictEqual(game.movementBank, { msg1: { perFig: { 0: { total: 3, remaining: 3 } } } });
  });
  it('adds to existing figure-0 sub-bank', () => {
    const game = { movementBank: { msg1: { perFig: { 0: { total: 2, remaining: 1 } } } } };
    grantMovementBank(game, 'msg1', 2);
    assert.strictEqual(game.movementBank.msg1.perFig[0].total, 4);
    assert.strictEqual(game.movementBank.msg1.perFig[0].remaining, 3);
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

describe('expireImmediateMp', () => {
  it('discards a flagged immediate-spend figure-0 sub-bank and returns the leftover', () => {
    const game = { movementBank: { msg1: { perFig: { 0: { total: 7, remaining: 4, _mustSpendImmediately: true } } } } };
    const lost = expireImmediateMp(game, 'msg1');
    assert.strictEqual(lost, 4);
    assert.strictEqual(game.movementBank, undefined);
  });
  it('leaves a normal (non-immediate) banked figure untouched', () => {
    const game = { movementBank: { msg1: { perFig: { 0: { total: 3, remaining: 2 } } } } };
    const lost = expireImmediateMp(game, 'msg1');
    assert.strictEqual(lost, 0);
    assert.deepStrictEqual(game.movementBank, { msg1: { perFig: { 0: { total: 3, remaining: 2 } } } });
  });
  it('no-ops when the entry is absent', () => {
    const game = {};
    assert.strictEqual(expireImmediateMp(game, 'missing'), 0);
  });
  it('preserves sibling DC bank entries when clearing one DC', () => {
    const game = { movementBank: {
      msg1: { perFig: { 0: { total: 2, remaining: 2, _mustSpendImmediately: true } } },
      msg2: { perFig: { 0: { total: 5, remaining: 5 } } },
    } };
    expireImmediateMp(game, 'msg1');
    assert.deepStrictEqual(game.movementBank, { msg2: { perFig: { 0: { total: 5, remaining: 5 } } } });
  });
  it('clears one figure\'s per-figure immediate sub-bank by index, leaving siblings', () => {
    const game = { movementBank: { msg1: { total: 0, remaining: 0, perFig: {
      0: { total: 4, remaining: 4 },
      1: { total: 6, remaining: 3, _mustSpendImmediately: true },
    } } } };
    const lost = expireImmediateMp(game, 'msg1', 1);
    assert.strictEqual(lost, 3);
    assert.strictEqual(game.movementBank.msg1.perFig[1], undefined);
    assert.deepStrictEqual(game.movementBank.msg1.perFig[0], { total: 4, remaining: 4 });
  });
  it("sweeps all flagged per-figure sub-banks when index is 'all'", () => {
    const game = { movementBank: { msg1: { perFig: {
      0: { total: 6, remaining: 2, _mustSpendImmediately: true },
      1: { total: 6, remaining: 5, _mustSpendImmediately: true },
    } } } };
    const lost = expireImmediateMp(game, 'msg1', 'all');
    assert.strictEqual(lost, 7);
    assert.strictEqual(game.movementBank, undefined);
  });
  it('does not clear a non-immediate per-figure sub-bank', () => {
    const game = { movementBank: { msg1: { total: 0, remaining: 0, perFig: {
      0: { total: 4, remaining: 4 },
    } } } };
    const lost = expireImmediateMp(game, 'msg1', 0);
    assert.strictEqual(lost, 0);
    assert.deepStrictEqual(game.movementBank.msg1.perFig[0], { total: 4, remaining: 4 });
  });
  it('discards entire entry for any immediate-spend figure (no savedBankedMp restore)', () => {
    const game = { movementBank: { msg1: { perFig: {
      0: { total: 6, remaining: 3, _mustSpendImmediately: true },
    } } } };
    const lost = expireImmediateMp(game, 'msg1', 0);
    assert.strictEqual(lost, 3);
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
    const game = { figurePowerTokens: { 'fig-1-0': ['Damage'] } };
    const granted = grantPowerTokens(game, 'fig-1-0', 'Block', 3, 2);
    assert.strictEqual(granted, 3);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Damage', 'Block', 'Block', 'Block']);
    // Should have overflow: 4 tokens, max 2, so overflow = 2
    assert.ok(game.pendingPowerTokenOverflow);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, 'fig-1-0');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 2);
  });
  it('queues overflow when already at max', () => {
    const game = { figurePowerTokens: { 'fig-1-0': ['Damage', 'Block', 'Surge'] } };
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
      figurePowerTokens: { 'fig-1-0': ['Damage', 'Block', 'Surge'] },
      pendingPowerTokenOverflow: [{ figureKey: 'fig-1-0', discardCount: 1 }],
    };
    const result = resolveOverflowDiscard(game, 'fig-1-0', 1); // discard 'Block'
    assert.strictEqual(result.discarded, 'Block');
    assert.strictEqual(result.remaining, 0);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Damage', 'Surge']);
    assert.strictEqual(game.pendingPowerTokenOverflow, null); // cleared
  });
  it('handles multiple discards needed', () => {
    const game = {
      figurePowerTokens: { 'fig-1-0': ['Damage', 'Block', 'Surge', 'Evade'] },
      pendingPowerTokenOverflow: [{ figureKey: 'fig-1-0', discardCount: 2 }],
    };
    const result = resolveOverflowDiscard(game, 'fig-1-0', 0); // discard 'Damage'
    assert.strictEqual(result.discarded, 'Damage');
    assert.strictEqual(result.remaining, 1);
    assert.deepStrictEqual(game.figurePowerTokens['fig-1-0'], ['Block', 'Surge', 'Evade']);
    assert.ok(game.pendingPowerTokenOverflow); // still has overflow
  });
  it('returns null for invalid index', () => {
    const game = {
      figurePowerTokens: { 'fig-1-0': ['Damage'] },
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
