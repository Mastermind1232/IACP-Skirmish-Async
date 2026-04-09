/**
 * BEHAVIORAL oracle tests for Activation Sequencing Phase 2.
 *
 * Covers the 3-step End Activation → End Turn → turn switch dance.
 * handleDcEndActivation cleans activation state, sets pendingEndTurn.
 * handleEndTurn consumes pendingEndTurn, flips currentActivationTurnPlayerId.
 *
 * Test categories:
 *   B-SEQ-001: handleDcEndActivation normal path — cleanup, pendingEndTurn set, save
 *   B-SEQ-002: handleEndTurn normal path — consume pendingEndTurn, flip turn, save
 *   B-SEQ-003: Full sequence: End Activation → End Turn → opponent gets turn
 *   B-SEQ-004: Stale/gate guards on handleEndTurn (repeated press, activation not ended, wrong player)
 *   B-SEQ-005: pendingEndTurn lifecycle invariant (absent → set → consumed)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDcEndActivation, handleEndTurn } from '../../../src/handlers/activation.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  return {
    customId,
    user: { id: userId },
    followUp: async (msg) => { followUpCalls.push(msg); return {}; },
    deferUpdate: async () => ({}),
    update: async () => ({}),
    _followUpCalls: followUpCalls,
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    player1Id: 'player1',
    player2Id: 'player2',
    generalId: 'general-ch',
    p1PlayAreaId: 'pa1',
    p2PlayAreaId: 'pa2',
    figurePowerTokens: {},
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    currentRound: 1,
    ...overrides,
  };
}

/**
 * Build ctx for activation handlers.
 * Discord channel ops are mocked (all wrapped in try/catch in production code).
 */
function buildCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    maybeShowEndActivationPhaseButton: [],
  };

  const mockMessage = {
    edit: async () => ({}),
    delete: async () => ({}),
    id: 'endturn-msg-123',
  };
  const mockChannel = {
    messages: { fetch: async () => mockMessage },
    send: async () => mockMessage,
    setArchived: async () => ({}),
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      dcMessageMeta: new Map([
        ['3001', { dcName: 'Test Unit', displayName: 'Test Unit', playerNum: 1, gameId: '42' }],
      ]),
      dcHealthState: new Map([['3001', [[5, 6]]]]),
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      maybeShowEndActivationPhaseButton: async (...args) => { calls.maybeShowEndActivationPhaseButton.push(args); },
      client: { channels: { fetch: async () => mockChannel } },
      saveGames: () => { calls.saveGames.push(true); },
      getDcStats: () => ({ figures: 1, cost: 4 }),
      findDcMessageIdForFigure: () => null,
      ...overrides,
    },
    calls,
  };
}

// ── B-SEQ-001: handleDcEndActivation normal path ────────────────────────────

describe('B-SEQ-001: handleDcEndActivation normal path', () => {
  it('001: cleans dcActionsData, sets pendingEndTurn, saves', async () => {
    const game = makeGame({
      dcActionsData: {
        '3001': { remaining: 0, total: 2, threadId: 'thread-1', messageId: 'act-msg' },
      },
    });

    const { ctx, calls } = buildCtx(game);
    await handleDcEndActivation(mockInteraction('dc_end_activation_3001', 'player1'), ctx);

    // cleanupActivation should have deleted dcActionsData['3001']
    assert.strictEqual(game.dcActionsData?.['3001'], undefined,
      'dcActionsData[3001] deleted by cleanupActivation — activation state wiped');

    // pendingEndTurn set for the End Turn button
    assert.ok(game.pendingEndTurn?.['3001'],
      'pendingEndTurn[3001] set — End Turn button posted');
    assert.strictEqual(game.pendingEndTurn['3001'].playerNum, 1,
      'pendingEndTurn records activating playerNum');
    assert.strictEqual(game.pendingEndTurn['3001'].displayName, 'Test Unit',
      'pendingEndTurn records DC displayName');

    // saveGames called to persist
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-SEQ-002: handleEndTurn normal path ────────────────────────────────────

describe('B-SEQ-002: handleEndTurn normal path', () => {
  it('002: consumes pendingEndTurn and flips turn to opponent', async () => {
    const game = makeGame({
      pendingEndTurn: {
        '3001': { playerNum: 1, displayName: 'Test Unit', messageId: 'endturn-msg' },
      },
      // dcActionsData absent for this DC — End Activation already cleared it
    });

    const { ctx, calls } = buildCtx(game);
    await handleEndTurn(mockInteraction('end_turn_42_3001', 'player1'), ctx);

    // pendingEndTurn consumed
    assert.strictEqual(game.pendingEndTurn?.['3001'], undefined,
      'pendingEndTurn[3001] consumed (deleted)');

    // Turn flipped to opponent
    assert.strictEqual(game.currentActivationTurnPlayerId, 'player2',
      'currentActivationTurnPlayerId flipped to player2 (opponent)');

    // saveGames called
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-SEQ-003: Full sequence ────────────────────────────────────────────────

describe('B-SEQ-003: Full End Activation → End Turn → opponent turn', () => {
  it('003: three-step dance completes — pendingEndTurn flows through, turn switches', async () => {
    const game = makeGame({
      dcActionsData: {
        '3001': { remaining: 0, total: 2, threadId: 'thread-1', messageId: 'act-msg' },
      },
      currentActivationTurnPlayerId: 'player1',
    });

    // Step 1: End Activation
    const { ctx: ctx1, calls: calls1 } = buildCtx(game);
    await handleDcEndActivation(
      mockInteraction('dc_end_activation_3001', 'player1'), ctx1);

    assert.strictEqual(game.dcActionsData?.['3001'], undefined, 'Step 1: dcActionsData cleared');
    assert.ok(game.pendingEndTurn?.['3001'], 'Step 1: pendingEndTurn set');

    // Step 2: End Turn
    const { ctx: ctx2, calls: calls2 } = buildCtx(game);
    await handleEndTurn(
      mockInteraction('end_turn_42_3001', 'player1'), ctx2);

    assert.strictEqual(game.pendingEndTurn?.['3001'], undefined, 'Step 2: pendingEndTurn consumed');
    assert.strictEqual(game.currentActivationTurnPlayerId, 'player2',
      'Step 2: turn switched to player2 (opponent)');

    // Both steps persisted
    assert.ok(calls1.saveGames.length > 0, 'saveGames called after End Activation');
    assert.ok(calls2.saveGames.length > 0, 'saveGames called after End Turn');
  });
});

// ── B-SEQ-004: Stale button / gate guards ───────────────────────────────────

describe('B-SEQ-004: handleEndTurn guards', () => {
  it('004a: rejects when pendingEndTurn absent (repeated / stale press)', async () => {
    const game = makeGame(); // no pendingEndTurn

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('end_turn_42_3001', 'player1');
    await handleEndTurn(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('already ended'));
    assert.ok(msg, 'ephemeral "already ended" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });

  it('004b: rejects when dcActionsData still present (End Activation not pressed)', async () => {
    const game = makeGame({
      pendingEndTurn: {
        '3001': { playerNum: 1, displayName: 'Test Unit', messageId: 'endturn-msg' },
      },
      dcActionsData: {
        '3001': { remaining: 1, total: 2, threadId: 'thread-1' },
      },
    });

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('end_turn_42_3001', 'player1');
    await handleEndTurn(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('End Activation'));
    assert.ok(msg, 'ephemeral "End Activation first" rejection sent');
    assert.ok(game.pendingEndTurn?.['3001'], 'pendingEndTurn NOT consumed');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });

  it('004c: rejects when wrong player presses End Turn', async () => {
    const game = makeGame({
      pendingEndTurn: {
        '3001': { playerNum: 1, displayName: 'Test Unit', messageId: 'endturn-msg' },
      },
    });

    const { ctx, calls } = buildCtx(game);
    // player2 tries to end player1's turn
    const interaction = mockInteraction('end_turn_42_3001', 'player2');
    await handleEndTurn(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Only the player'));
    assert.ok(msg, 'ephemeral wrong-player rejection sent');
    assert.ok(game.pendingEndTurn?.['3001'], 'pendingEndTurn NOT consumed');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-SEQ-005: pendingEndTurn lifecycle invariant ───────────────────────────

describe('B-SEQ-005: pendingEndTurn lifecycle invariant', () => {
  it('005: transitions absent → set (with shape) → consumed', async () => {
    const game = makeGame({
      dcActionsData: {
        '3001': { remaining: 0, total: 2, threadId: 'thread-1' },
      },
    });

    // Phase 0: absent
    assert.strictEqual(game.pendingEndTurn, undefined,
      'Phase 0: pendingEndTurn absent before sequence');

    // Phase 1: End Activation sets it
    const { ctx: ctx1 } = buildCtx(game);
    await handleDcEndActivation(
      mockInteraction('dc_end_activation_3001', 'player1'), ctx1);

    assert.ok(game.pendingEndTurn?.['3001'], 'Phase 1: pendingEndTurn set');
    const shape = game.pendingEndTurn['3001'];
    assert.strictEqual(shape.playerNum, 1, 'shape.playerNum = activating player');
    assert.strictEqual(shape.displayName, 'Test Unit', 'shape.displayName = DC display name');
    assert.ok(shape.messageId, 'shape.messageId populated (End Turn button message ID)');

    // Phase 2: End Turn consumes it
    const { ctx: ctx2 } = buildCtx(game);
    await handleEndTurn(
      mockInteraction('end_turn_42_3001', 'player1'), ctx2);

    assert.strictEqual(game.pendingEndTurn?.['3001'], undefined,
      'Phase 2: pendingEndTurn consumed — lifecycle complete');
  });
});
