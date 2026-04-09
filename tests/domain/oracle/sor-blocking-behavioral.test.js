/**
 * BEHAVIORAL oracle tests for Start-of-Round async blocking.
 *
 * Verifies that interactive SoR effects block the activation phase via
 * pendingStartOfRoundResolve, and that auto-resolving effects do not.
 *
 * Test IDs:
 *   B-SORBLK-001: Programming Override (4-LOM) blocks activation
 *   B-SORBLK-002: Brush (Ezra) auto-grants MP without blocking
 *   B-SORBLK-003: resolveStartOfRoundEffect decrements and triggers activation at 0
 *   B-SORBLK-004: resolveStartOfRoundEffect does not trigger activation when counter > 1
 *   B-SORBLK-005: Imperial Citadel blocks activation (regression)
 *   B-SORBLK-006: Force Slow blocks activation when multiple targets in range
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStartOfRoundDcEffects, resolveStartOfRoundEffect } from '../../../src/handlers/round.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
  return {
    gameId: 'test1',
    player1Id: 'user_p1',
    player2Id: 'user_p2',
    initiativePlayerId: 'user_p1',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    p1DcList: [],
    p2DcList: [],
    p1DcMessageIds: [],
    p2DcMessageIds: [],
    ...overrides,
  };
}

function mockClient() {
  return { channels: { fetch: async () => null } };
}

function mockCtx() {
  const calls = { logGameAction: [], sendPhaseGateMessages: [], saveGames: [] };
  return {
    ctx: {
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      updateHandChannelMessages: async () => {},
      sendPhaseGateMessages: async (g, phase) => { calls.sendPhaseGateMessages.push(phase); },
      saveGames: () => { calls.saveGames.push(true); },
    },
    calls,
  };
}

// ── B-SORBLK-001: Programming Override (4-LOM) blocks activation ───────────

describe('B-SORBLK-001: Programming Override blocks activation', () => {
  it('increments pendingStartOfRoundResolve and returns true', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: '4-LOM', displayName: '4-LOM' }],
      p1DcMessageIds: ['msg_4lom'],
      figurePositions: { 1: { '4-LOM-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = mockCtx();
    const hasPending = await runStartOfRoundDcEffects(game, 'test1', mockClient(), ctx);
    assert.ok(hasPending, 'should return true — activation must be blocked');
    assert.ok(
      (game.pendingStartOfRoundResolve || 0) >= 1,
      `pendingStartOfRoundResolve should be >= 1, got ${game.pendingStartOfRoundResolve}`,
    );
  });
});

// ── B-SORBLK-002: Brush (Ezra) does NOT block ─────────────────────────────

describe('B-SORBLK-002: Brush auto-resolves without blocking', () => {
  it('does not increment pendingStartOfRoundResolve', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: 'Ezra Bridger', displayName: 'Ezra Bridger' }],
      p1DcMessageIds: ['msg_ezra'],
      figurePositions: { 1: { 'Ezra Bridger-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = mockCtx();
    const hasPending = await runStartOfRoundDcEffects(game, 'test1', mockClient(), ctx);
    assert.equal(hasPending, false, 'should return false — Brush is auto-resolve');
    assert.equal(game.pendingStartOfRoundResolve ?? 0, 0, 'counter should remain 0');
  });
});

// ── B-SORBLK-003: resolveStartOfRoundEffect triggers activation at 0 ──────

describe('B-SORBLK-003: resolveStartOfRoundEffect triggers activation when counter hits 0', () => {
  it('decrements counter and calls sendPhaseGateMessages', async () => {
    const game = makeGame({ pendingStartOfRoundResolve: 1 });
    const { ctx, calls } = mockCtx();
    await resolveStartOfRoundEffect(game, ctx);
    assert.equal(game.pendingStartOfRoundResolve, undefined, 'counter should be deleted');
    assert.equal(calls.sendPhaseGateMessages.length, 1, 'sendPhaseGateMessages should be called once');
    assert.equal(calls.sendPhaseGateMessages[0], 'pre_activation', 'should send pre_activation gate');
  });
});

// ── B-SORBLK-004: resolveStartOfRoundEffect does NOT trigger with counter > 1 ─

describe('B-SORBLK-004: resolveStartOfRoundEffect holds when multiple effects pending', () => {
  it('decrements counter but does not trigger activation', async () => {
    const game = makeGame({ pendingStartOfRoundResolve: 3 });
    const { ctx, calls } = mockCtx();
    await resolveStartOfRoundEffect(game, ctx);
    assert.equal(game.pendingStartOfRoundResolve, 2, 'counter should be 2');
    assert.equal(calls.sendPhaseGateMessages.length, 0, 'sendPhaseGateMessages should NOT be called yet');

    // Resolve again
    await resolveStartOfRoundEffect(game, ctx);
    assert.equal(game.pendingStartOfRoundResolve, 1, 'counter should be 1');
    assert.equal(calls.sendPhaseGateMessages.length, 0, 'still should not trigger');

    // Final resolve
    await resolveStartOfRoundEffect(game, ctx);
    assert.equal(game.pendingStartOfRoundResolve, undefined, 'counter should be deleted');
    assert.equal(calls.sendPhaseGateMessages.length, 1, 'now should trigger activation');
  });
});

// ── B-SORBLK-005: Imperial Citadel blocks activation (regression) ──────────

describe('B-SORBLK-005: Imperial Citadel blocks activation', () => {
  it('increments pendingStartOfRoundResolve for Citadel SoR token placement', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: '[Imperial Citadel]', displayName: 'Imperial Citadel' }],
      p1DcMessageIds: ['msg_citadel'],
    });
    const { ctx } = mockCtx();
    const hasPending = await runStartOfRoundDcEffects(game, 'test1', mockClient(), ctx);
    assert.ok(hasPending, 'should return true — Citadel token choice blocks activation');
    assert.ok(
      (game.pendingStartOfRoundResolve || 0) >= 1,
      `pendingStartOfRoundResolve should be >= 1, got ${game.pendingStartOfRoundResolve}`,
    );
  });
});

// ── B-SORBLK-006: Force Slow blocks activation with multiple targets ───────

describe('B-SORBLK-006: Force Slow blocks activation when multiple hostile targets in range', () => {
  it('increments pendingStartOfRoundResolve when picker is shown', async () => {
    // Use mos-eisley-outskirts: a1 and a2 are adjacent (distance 1)
    const game = makeGame({
      selectedMap: { id: 'mos-eisley-outskirts' },
      p1DcList: [{ dcName: 'Cal Kestis', displayName: 'Cal Kestis' }],
      p1DcMessageIds: ['msg_cal'],
      figurePositions: {
        1: { 'Cal Kestis-1-0': 'a1' },
        2: { 'Stormtrooper-2-0': 'a2', 'Stormtrooper-2-1': 'a3' },
      },
    });
    const { ctx } = mockCtx();
    const hasPending = await runStartOfRoundDcEffects(game, 'test1', mockClient(), ctx);
    assert.ok(hasPending, 'should return true — Force Slow multi-target picker blocks activation');
    assert.ok(
      (game.pendingStartOfRoundResolve || 0) >= 1,
      `pendingStartOfRoundResolve should be >= 1, got ${game.pendingStartOfRoundResolve}`,
    );
  });

  it('does NOT block when only 1 hostile target (auto-resolve)', async () => {
    const game = makeGame({
      selectedMap: { id: 'mos-eisley-outskirts' },
      p1DcList: [{ dcName: 'Cal Kestis', displayName: 'Cal Kestis' }],
      p1DcMessageIds: ['msg_cal'],
      figurePositions: {
        1: { 'Cal Kestis-1-0': 'a1' },
        2: { 'Stormtrooper-2-0': 'a2' },
      },
    });
    const { ctx } = mockCtx();
    const hasPending = await runStartOfRoundDcEffects(game, 'test1', mockClient(), ctx);
    assert.equal(hasPending, false, 'should return false — single target auto-resolves');
    assert.equal(game.pendingStartOfRoundResolve ?? 0, 0, 'counter should remain 0');
  });
});
