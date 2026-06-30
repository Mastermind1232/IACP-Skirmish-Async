/**
 * Unified CC counter-window tests (alexanbv 2026-06-30).
 *
 * Verifies that playCC + injected promptOpponentCancel correctly blocks until
 * the Negate/Comms window resolves, for BOTH non-combat and combat CC paths.
 *
 * Also exercises the query-mode branch of _resolveCcCounterWindow (the
 * game._ccWindowResolve Promise resolver) that was added in this PR to support
 * the unified combat CC path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { playCC } from '../../../src/game/cc-timing.js';
import {
  openCounterWindow, pushCounter, resolveAndCloseWindow,
  openCcCounterWindow, topAvailableCounters, NEGATION, COMM_DISRUPTION,
  registerCombatGateResume, getCombatGateResume,
} from '../../../src/handlers/cc-pipeline.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Minimal game state that makes canPlayCC pass for 'Expose Weakness'
// (Any Figure, duringActivation, cost 0) played by player 1.
function gameForDuringActivation(overrides = {}) {
  return {
    gameId: 'test', player1Id: 'P1', player2Id: 'P2',
    currentRound: 1,
    currentActivationTurnPlayerId: 'P1',
    roundActivationMessageId: null,
    roundActivationButtonShown: false,
    endOfRoundWhoseTurn: null,
    startOfRoundWhoseTurn: null,
    combat: null, pendingCombat: null,
    shadowOpsBlockedPlayer: null,
    criticalHitBlockedPlayer: null,
    commsJammerActivePlayerNum: null,
    jundlandTerrorPlayedThisEor: false,
    reinforcementsPlayedThisSor: false,
    lastDefeatInfo: null,
    player1CcHand: ['Expose Weakness'],
    player2CcHand: [],
    player1CcDiscard: [], player2CcDiscard: [],
    ...overrides,
  };
}

// Minimal game for pipeline tests — no timing check needed here
function minimalGame(overrides = {}) {
  return {
    gameId: 'test', player1Id: 'P1', player2Id: 'P2',
    player1CcHand: [], player2CcHand: [],
    player1CcDiscard: [], player2CcDiscard: [],
    ...overrides,
  };
}

function makeCtx(overrides = {}) {
  return {
    getCcEffect: () => null,
    resolveAbility: async (abilityId) => ({ abilityId }),
    logGameAction: async () => {},
    dcMessageMeta: new Map(),
    saveGames: () => {},
    checkWinConditions: null,
    ...overrides,
  };
}

const NOOP_CLIENT = { channels: { fetch: async () => ({ send: async () => ({ id: 'msg' }) }) } };

// ── 1. Non-combat: promptOpponentCancel is called and determines outcome ──────

describe('playCC: promptOpponentCancel injection', () => {
  it('calls promptOpponentCancel and returns ok when it resolves not-cancelled', async () => {
    const game = gameForDuringActivation();
    const ctx = makeCtx();
    let cancelCalled = false;
    ctx.promptOpponentCancel = async () => { cancelCalled = true; return { cancelled: false }; };

    const res = await playCC(game, 1, 'fig-1-0', 'Expose Weakness', { ctx, skipExecute: true });

    assert.ok(cancelCalled, 'promptOpponentCancel must be called');
    assert.ok(res.ok, 'play should succeed');
    assert.ok(!res.cancelled, 'should not be cancelled');
    assert.deepEqual(game.player1CcHand, [], 'card removed from hand');
    assert.ok((game.player1CcDiscard || []).includes('Expose Weakness'), 'card in discard');
  });

  it('returns { cancelled } when promptOpponentCancel signals cancellation', async () => {
    const game = gameForDuringActivation();
    const ctx = makeCtx();
    ctx.promptOpponentCancel = async () => ({ cancelled: true, reason: 'opponent' });

    const res = await playCC(game, 1, 'fig-1-0', 'Expose Weakness', { ctx, skipExecute: true });

    assert.ok(res.ok, 'play should succeed (play happened, just cancelled)');
    assert.equal(res.cancelled, 'opponent', 'cancelled by opponent');
    assert.deepEqual(game.player1CcHand, [], 'card removed from hand even when cancelled');
    assert.ok((game.player1CcDiscard || []).includes('Expose Weakness'), 'card in discard when cancelled');
  });

  it('suspends until the promptOpponentCancel Promise resolves (async button click)', async () => {
    const game = gameForDuringActivation();
    const ctx = makeCtx();
    let resolveWindow;
    ctx.promptOpponentCancel = () => new Promise((r) => { resolveWindow = r; });

    const playPromise = playCC(game, 1, 'fig-1-0', 'Expose Weakness', { ctx, skipExecute: true });

    // playCC is now suspended inside await ctx.promptOpponentCancel(...)
    assert.equal(typeof resolveWindow, 'function', 'Promise resolver must be captured synchronously');
    assert.deepEqual(game.player1CcHand, ['Expose Weakness'], 'card still in hand while window is open');

    // Simulate opponent pressing "Pass"
    resolveWindow({ cancelled: false });
    const res = await playPromise;
    assert.ok(res.ok && !res.cancelled, 'play succeeded after async resolve');
    assert.deepEqual(game.player1CcHand, [], 'card moved to discard after resolve');
  });

  it('promptOpponentCancel NOT called when canPlayCC fails', async () => {
    // Missing player1CcHand entry → canPlayCC returns ok: false
    const game = gameForDuringActivation({ player1CcHand: [] });
    let cancelCalled = false;
    const ctx = makeCtx({ promptOpponentCancel: async () => { cancelCalled = true; return { cancelled: false }; } });

    const res = await playCC(game, 1, 'fig-1-0', 'Expose Weakness', { ctx, skipExecute: true });

    assert.ok(!res.ok, 'play should fail (card not in hand)');
    assert.ok(!cancelCalled, 'promptOpponentCancel must NOT be called on validation failure');
  });
});

// ── 2. Query-mode: game._ccWindowResolve receives { cancelled } ───────────────

describe('_resolveCcCounterWindow query mode: Promise resolver + effect suppression', () => {
  it('resolves with { cancelled: false } when no responder (auto-resolve path)', async () => {
    const game = minimalGame({ player1CcHand: ['Expose Weakness'] });
    const ctx = makeCtx({ client: NOOP_CLIENT });
    let resolved = null;
    game._ccWindowResolve = (r) => { resolved = r; };

    await openCcCounterWindow(game, 'test', {
      card: 'Expose Weakness', cost: 0, playedBy: 1,
      figureKey: 'fig-1-0', abilityId: 'Expose Weakness',
    }, ctx, NOOP_CLIENT);

    assert.deepEqual(resolved, { cancelled: false }, 'Promise resolved with { cancelled: false }');
    assert.ok(!game._ccWindowResolve, '_ccWindowResolve deleted after resolution');
  });

  it('does NOT set pendingCcEffect or call resolveAbility when _ccWindowResolve is set', async () => {
    const game = minimalGame({ player1CcHand: ['Expose Weakness'] });
    let effectRan = false;
    const ctx = makeCtx({
      client: NOOP_CLIENT,
      resolveAbility: async () => { effectRan = true; },
    });
    game._ccWindowResolve = () => {};

    await openCcCounterWindow(game, 'test', {
      card: 'Expose Weakness', cost: 0, playedBy: 1, abilityId: 'Expose Weakness',
    }, ctx, NOOP_CLIENT);

    assert.ok(!effectRan, 'resolveAbility must NOT run in query mode');
    assert.ok(!game.pendingCcEffect, 'pendingCcEffect must NOT be set in query mode');
  });

  it('does NOT call gate resume (pendingCombatCcResolve path) when _ccWindowResolve is set', async () => {
    // Even if pendingCombatCcResolve is set, query mode skips the resume
    let gateResumed = false;
    const oldResume = getCombatGateResume();
    registerCombatGateResume(async () => { gateResumed = true; });

    const game = minimalGame({
      player1CcHand: ['Expose Weakness'],
      pendingCombatCcResolve: { window: 'mods', side: 'attacker', gameId: 'test' },
    });
    const ctx = makeCtx({ client: NOOP_CLIENT });
    game._ccWindowResolve = () => {};

    await openCcCounterWindow(game, 'test', {
      card: 'Expose Weakness', cost: 0, playedBy: 1, abilityId: 'Expose Weakness',
    }, ctx, NOOP_CLIENT);

    assert.ok(!gateResumed, 'gate resume must NOT fire in query mode');

    // Restore
    if (oldResume) registerCombatGateResume(oldResume);
    else registerCombatGateResume(null);
  });
});

// ── 3. Normal mode: non-combat CC play is unaffected ─────────────────────────

describe('_resolveCcCounterWindow normal mode: non-combat CC plays unchanged', () => {
  it('runs resolveAbility for a resolved card when no _ccWindowResolve', async () => {
    const game = minimalGame({ player1CcHand: ['Expose Weakness'] });
    let effectAid = null;
    const ctx = makeCtx({
      client: NOOP_CLIENT,
      resolveAbility: async (abilityId) => { effectAid = abilityId; return {}; },
    });

    await openCcCounterWindow(game, 'test', {
      card: 'Expose Weakness', cost: 0, playedBy: 1, abilityId: 'Expose Weakness',
    }, ctx, NOOP_CLIENT);

    assert.equal(effectAid, 'Expose Weakness', 'resolveAbility ran with correct abilityId');
    assert.ok(!game.pendingCcEffect, 'pendingCcEffect cleared after resolution');
  });

  it('Negation cancels the main card — stack resolves correctly in normal mode', () => {
    // Low-level test: verify the window stack resolves correctly for Negation
    const game = minimalGame();
    openCounterWindow(game, { card: 'Expose Weakness', cost: 0, playedBy: 1 });
    pushCounter(game, { card: NEGATION, cost: 1, playedBy: 2, spyCount: 0 });
    const outcome = resolveAndCloseWindow(game);

    assert.equal(outcome.length, 2);
    assert.equal(outcome[0].card, 'Expose Weakness');
    assert.equal(outcome[0].status, 'cancelled');
    assert.equal(outcome[1].card, NEGATION);
    assert.equal(outcome[1].status, 'resolved');
  });

  it('Comm Disruption (cost 2, ≥1 SPY) cancels a cost-1 card in normal mode', () => {
    const game = minimalGame();
    openCounterWindow(game, { card: 'Vibro-Knucklers', cost: 1, playedBy: 1 });
    pushCounter(game, { card: COMM_DISRUPTION, cost: 2, playedBy: 2, spyCount: 1 });
    const outcome = resolveAndCloseWindow(game);

    assert.equal(outcome[0].status, 'cancelled', 'main card cancelled by Comms');
    assert.equal(outcome[1].status, 'resolved', 'Comm Disruption resolved');
  });

  it('no counter offered when card cost > opponent SPY count', () => {
    const game = minimalGame();
    openCounterWindow(game, { card: 'Vibro-Knucklers', cost: 1, playedBy: 1 });
    // Opponent has 0 SPY — Negate only hits cost-0, Comms needs ≥1 SPY
    assert.deepEqual(topAvailableCounters(game, 0), [], 'no counters available with 0 SPY vs cost-1 card');
    const outcome = resolveAndCloseWindow(game);
    assert.equal(outcome.length, 1, 'only the main card in outcome');
    assert.equal(outcome[0].status, 'resolved', 'card resolved without counter');
  });
});
