/**
 * BEHAVIORAL oracle tests for handleMovePick (Movement Phase 2).
 *
 * Tests the core movement confirmation path: position mutation, MP deduction,
 * movementBank sync, guard rejections, figureMoved tracking, stale interaction.
 *
 * Uses real map data (anchorhead-cantina-bar) and real pathfinding functions.
 * The handler gets its pure functions via ctx, so we pass real imports from
 * game/movement.js and mock only Discord-specific operations.
 *
 * Test categories:
 *   B-MVPICK-001: Legal move updates figurePositions correctly
 *   B-MVPICK-002: MP deducted correctly from moveState
 *   B-MVPICK-003: movementBank.remaining stays in sync with moveState
 *   B-MVPICK-004: Cripple guard blocks move to different space
 *   B-MVPICK-005: Tripod guard blocks move after attack
 *   B-MVPICK-006: figureMoved set to true after move
 *   B-MVPICK-007: Stale interaction (expired moveInProgress) rejects gracefully
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleMovePick } from '../../../src/handlers/movement.js';
import {
  getBoardStateForMovement,
  getMovementProfile,
  ensureMovementCache,
  computeMovementCache,
  getMovementTarget,
  getMovementPath,
  getNormalizedFootprint,
  collectOverlappingFigures,
  getValidDisplacementSpaces,
  pushFigureToNearestValid,
} from '../../../src/game/movement.js';
import { normalizeCoord, getFootprintCells } from '../../../src/game/coords.js';
import { getFigureSize, getDcStats } from '../../../src/data-loader.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  const mockMsg = {
    id: 'grid-msg-1',
    delete: async () => ({}),
    edit: async () => ({}),
    attachments: new Map(),
    author: { id: 'bot' },
  };
  return {
    customId,
    user: { id: userId },
    followUp: async (msg) => { followUpCalls.push(msg); return mockMsg; },
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: mockMsg,
    channel: {
      messages: {
        fetch: async (opts) => {
          // If called with a string ID, return single message
          if (typeof opts === 'string') return mockMsg;
          // If called with { limit: N }, return empty collection
          return new Map();
        },
      },
      send: async () => mockMsg,
    },
    _followUpCalls: followUpCalls,
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    player1Id: 'player1',
    player2Id: 'player2',
    selectedMap: { id: 'anchorhead-cantina-bar' },
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {},
    figureConditions: {},
    figurePowerTokens: {},
    openedDoors: [],
    moveInProgress: {},
    movementBank: {},
    moveGridMessageIds: {},
    pendingSpacePick: {},
    ...overrides,
  };
}

/**
 * Build ctx for handleMovePick.
 * Passes real pathfinding functions; mocks Discord-only operations.
 */
function buildCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    pushUndo: [],
  };

  const mockChannel = {
    messages: { fetch: async () => ({ delete: async () => ({}), edit: async () => ({}) }) },
    send: async () => ({ id: 'new-msg' }),
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      dcMessageMeta: new Map([
        ['3001', { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper', playerNum: 1, gameId: '42' }],
      ]),
      dcHealthState: new Map(),
      clearMoveGridMessages: async () => {},
      getBoardStateForMovement: (g, fk) => getBoardStateForMovement(g, fk),
      getMovementProfile: (dcName, fk, g) => getMovementProfile(dcName, fk, g),
      ensureMovementCache: (ms, start, mp, board, prof) => ensureMovementCache(ms, start, mp, board, prof),
      computeMovementCache: (start, mp, board, prof) => computeMovementCache(start, mp, board, prof),
      normalizeCoord: (c) => normalizeCoord(c),
      getMovementTarget: (cache, coord) => getMovementTarget(cache, coord),
      getFigureSize: (dcName) => getFigureSize(dcName),
      getNormalizedFootprint: (pos, size) => getNormalizedFootprint(pos, size),
      resolveMassivePush: async () => {},
      updateMovementBankMessage: async () => {},
      getMovementPath: (cache, start, dest, size, prof) => getMovementPath(cache, start, dest, size, prof),
      pushUndo: (g, entry) => { calls.pushUndo.push(entry); },
      logGameAction: async (...args) => { calls.logGameAction.push(args); return { id: 'log-msg' }; },
      countTerminalsControlledByPlayer: () => 0,
      getMovementMinimapAttachment: async () => null,
      buildBoardMapPayload: async () => ({}),
      getDcStats: (dcName) => getDcStats(dcName),
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => mockChannel }, user: { id: 'bot' } },
      processFigureDefeat: async () => {},
      updateDcActionsMessage: async () => {},
      ...overrides,
    },
    calls,
  };
}

/**
 * Seed a moveInProgress entry with real pathfinding cache for a given start position and MP.
 * This lets handleMovePick find valid destinations via ensureMovementCache → getMovementTarget.
 */
function seedMoveState(game, msgId, figureIndex, figureKey, playerNum, startCoord, mp, displayName) {
  const moveKey = `${msgId}_${figureIndex}`;
  const boardState = getBoardStateForMovement(game, figureKey);
  const profile = getMovementProfile('Rebel Trooper', figureKey, game);
  const cache = computeMovementCache(startCoord, mp, boardState, profile);
  game.moveInProgress[moveKey] = {
    figureKey,
    playerNum,
    mpRemaining: mp,
    displayName: displayName || 'Rebel Trooper',
    startCoord,
    boardState,
    movementProfile: profile,
    movementCache: cache,
    cacheMaxMp: mp,
    pendingMp: null,
  };
  return { moveKey, boardState, profile, cache };
}

// ── B-MVPICK-001: Legal move updates figurePositions ────────────────────────

describe('B-MVPICK-001: Legal move updates figurePositions correctly', () => {
  it('001: figure moves from a1 to a2, position updated in game state', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 4, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(
      mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.strictEqual(game.figurePositions[1]['Rebel Trooper-1-0'], 'a2',
      'figurePositions updated to destination a2');
  });
});

// ── B-MVPICK-002: MP deducted correctly from moveState ──────────────────────

describe('B-MVPICK-002: MP deducted correctly from moveState', () => {
  it('002a: 1-space move deducts 1 MP from moveState.mpRemaining', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 4, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(
      mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    const moveState = game.moveInProgress['3001_0'];
    assert.ok(moveState, 'moveState still exists (MP remaining > 0)');
    assert.strictEqual(moveState.mpRemaining, 3,
      'mpRemaining decremented from 4 to 3 (1 MP cost for adjacent move)');
  });

  it('002b: move that exhausts all MP cleans up moveInProgress', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 1, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(
      mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.strictEqual(game.moveInProgress['3001_0'], undefined,
      'moveInProgress cleaned up when MP exhausted');
  });
});

// ── B-MVPICK-003: movementBank.remaining stays in sync ──────────────────────

describe('B-MVPICK-003: movementBank.remaining stays in sync with moveState', () => {
  it('003: movementBank.remaining reflects newMp after move', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      movementBank: {
        '3001': { total: 4, remaining: 4, threadId: null, messageId: null, displayName: 'Rebel Trooper' },
      },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 4, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(
      mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.strictEqual(game.movementBank['3001'].remaining, 3,
      'movementBank.remaining synced to 3 (same as moveState.mpRemaining)');
  });

  it('003b: movementBank.remaining floors at 0 when MP exhausted', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      movementBank: {
        '3001': { total: 1, remaining: 1, threadId: null, messageId: null, displayName: 'Rebel Trooper' },
      },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 1, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(
      mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.strictEqual(game.movementBank['3001'].remaining, 0,
      'movementBank.remaining = 0 (Math.max(0, newMp))');
  });
});

// ── B-MVPICK-004: Cripple guard blocks move ─────────────────────────────────

describe('B-MVPICK-004: Cripple guard blocks move to different space', () => {
  it('004: Crippled figure rejected when moving to a different space', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      crippledFigures: ['Rebel Trooper'],
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 4, 'Rebel Trooper');

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('move_pick_3001_0_a2', 'player1');
    await handleMovePick(interaction, ctx);

    // Position should NOT change
    assert.strictEqual(game.figurePositions[1]['Rebel Trooper-1-0'], 'a1',
      'figurePositions unchanged — Cripple blocked the move');

    // Ephemeral rejection sent
    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Crippled'));
    assert.ok(msg, 'ephemeral Cripple rejection sent');

    // saveGames NOT called (no state change)
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-MVPICK-005: Tripod guard blocks move after attack ─────────────────────

describe('B-MVPICK-005: Tripod guard blocks move after attack', () => {
  it('005: figure with tripodAttacked rejected when trying to exit', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      tripodAttacked: { 'Rebel Trooper-1-0': true },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 4, 'Rebel Trooper');

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('move_pick_3001_0_a2', 'player1');
    await handleMovePick(interaction, ctx);

    // Position should NOT change
    assert.strictEqual(game.figurePositions[1]['Rebel Trooper-1-0'], 'a1',
      'figurePositions unchanged — Tripod blocked the move');

    // Ephemeral rejection sent
    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Tripod'));
    assert.ok(msg, 'ephemeral Tripod rejection sent');

    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-MVPICK-006: figureMoved set correctly ─────────────────────────────────

describe('B-MVPICK-006: figureMoved set to true after successful move', () => {
  it('006: figureMoved[figureKey] = true after legal move', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 4, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(
      mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.strictEqual(game.figureMoved?.['Rebel Trooper-1-0'], true,
      'figureMoved set to true — Tripod/ability tracking updated');
  });
});

// ── B-MVPICK-007: Stale interaction / expired moveInProgress ────────────────

describe('B-MVPICK-007: Stale interaction with expired moveInProgress', () => {
  it('007: no moveInProgress → ephemeral "expired" rejection', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      // moveInProgress intentionally empty — no active move session
    });

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('move_pick_3001_0_a2', 'player1');
    await handleMovePick(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('expired'));
    assert.ok(msg, 'ephemeral "Move session expired" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});
