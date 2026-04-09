/**
 * BEHAVIORAL oracle tests for post-move triggers in handleMovePick (Movement Phase 3).
 *
 * Tests that handleMovePick sets (or does not set) the correct pending flags
 * and trigger state after movement for player-visible post-move abilities.
 *
 * Uses real map data (anchorhead-cantina-bar) and real pathfinding functions.
 * Reuses the same harness pattern as movement-pick-behavioral.test.js.
 *
 * Key test topology (anchorhead-cantina-bar adjacency):
 *   a1 adj: a2, b1, b2
 *   b1 adj: b2, a1, c1, a2, c2
 *   a2 adj: a1, a3, b1, b2, b3
 *
 * Test categories:
 *   B-MVTRIG-001 – 002: Rush (Onar Koma) — pendingRushPush set/not-set
 *   B-MVTRIG-003 – 004: Shoulder Rush (KX-Series) — pendingShoulderRush set/not-set
 *   B-MVTRIG-005 – 007: Deference Protocol — Block token granted / not-granted
 *   B-MVTRIG-008 – 009: Dio Follow (Iden Versio) — pendingDioFollow set/not-set
 *   B-MVTRIG-010: Cross-trigger invariant — core state still correct after triggers
 *
 * NOTE: Overrun deferred — requires MASSIVE figure (2x2 footprint) harness.
 *   Regular figures cannot end on occupied spaces (pathfinding blocks it),
 *   so Overrun testing needs a dedicated MASSIVE-figure seedMoveState variant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleMovePick } from '../../../src/handlers/movement.js';
import {
  getBoardStateForMovement,
  getMovementProfile,
  computeMovementCache,
  ensureMovementCache,
  getMovementTarget,
  getMovementPath,
  getNormalizedFootprint,
} from '../../../src/game/movement.js';
import { normalizeCoord } from '../../../src/game/coords.js';
import { getFigureSize, getDcStats } from '../../../src/data-loader.js';

// ── Shared mock helpers ─────────────────────────────────────────────────────

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
          if (typeof opts === 'string') return mockMsg;
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

function buildCtx(game, dcMetaEntries, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    pushUndo: [],
    processFigureDefeat: [],
  };
  const mockChannel = {
    messages: { fetch: async () => ({ delete: async () => ({}), edit: async () => ({}) }) },
    send: async () => ({ id: 'new-msg' }),
  };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      dcMessageMeta: new Map(dcMetaEntries),
      dcHealthState: overrides.dcHealthState || new Map(),
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
      processFigureDefeat: async (g, opts) => { calls.processFigureDefeat.push(opts); },
      updateDcActionsMessage: async () => {},
      ...overrides,
    },
    calls,
  };
}

function seedMoveState(game, msgId, figureIndex, figureKey, playerNum, startCoord, mp, displayName, dcName) {
  const moveKey = `${msgId}_${figureIndex}`;
  const boardState = getBoardStateForMovement(game, figureKey);
  const profile = getMovementProfile(dcName || 'Rebel Trooper (Regular)', figureKey, game);
  const cache = computeMovementCache(startCoord, mp, boardState, profile);
  game.moveInProgress[moveKey] = {
    figureKey,
    playerNum,
    mpRemaining: mp,
    displayName: displayName || dcName || 'Rebel Trooper',
    startCoord,
    boardState,
    movementProfile: profile,
    movementCache: cache,
    cacheMaxMp: mp,
    pendingMp: null,
  };
  return { moveKey, cache };
}

// ── B-MVTRIG-001: Rush fires when conditions met ───────────────────────────

describe('B-MVTRIG-001: Rush sets pendingRushPush when adjacent SMALL hostile present', () => {
  it('001: Onar moves to a1, hostile on b1 (adjacent) → pendingRushPush set', async () => {
    // Onar Koma (GUARDIAN, HUNTER) at a2, moves to a1, exhausting MP
    // Hostile Stormtrooper on b1 (adjacent to a1, SMALL)
    const game = makeGame({
      figurePositions: {
        1: { 'Onar Koma-1-0': 'a2' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
      rushPending: { '3001': true },
    });

    const dcMeta = [
      ['3001', { dcName: 'Onar Koma', displayName: 'Onar Koma', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Onar Koma-1-0', 1, 'a2', 1, 'Onar Koma', 'Onar Koma');

    const { ctx, calls } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a1', 'player1'), ctx);

    assert.ok(game.pendingRushPush, 'pendingRushPush set');
    assert.strictEqual(game.pendingRushPush.msgId, '3001');
    assert.strictEqual(game.pendingRushPush.playerNum, 1);
    assert.strictEqual(game.pendingRushPush.activatorFigureKey, 'Onar Koma-1-0');
    assert.strictEqual(game.pendingRushPush.activatorPos, 'a1');
    assert.ok(game.pendingRushPush.targets.includes('Stormtrooper (Regular)-1-0'),
      'target list includes the adjacent hostile');
  });
});

// ── B-MVTRIG-002: Rush does NOT fire without conditions ────────────────────

describe('B-MVTRIG-002: Rush does NOT fire when conditions absent', () => {
  it('002a: no rushPending flag → no pendingRushPush', async () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Onar Koma-1-0': 'a2' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
      // rushPending intentionally absent
    });

    const dcMeta = [
      ['3001', { dcName: 'Onar Koma', displayName: 'Onar Koma', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Onar Koma-1-0', 1, 'a2', 1, 'Onar Koma', 'Onar Koma');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a1', 'player1'), ctx);

    assert.strictEqual(game.pendingRushPush, undefined, 'no pendingRushPush — rushPending not set');
  });

  it('002b: no adjacent hostile → no pendingRushPush', async () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Onar Koma-1-0': 'a2' },
        2: { 'Stormtrooper (Regular)-1-0': 'd1' }, // d1 NOT adjacent to a1
      },
      rushPending: { '3001': true },
    });

    const dcMeta = [
      ['3001', { dcName: 'Onar Koma', displayName: 'Onar Koma', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Onar Koma-1-0', 1, 'a2', 1, 'Onar Koma', 'Onar Koma');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a1', 'player1'), ctx);

    assert.strictEqual(game.pendingRushPush, undefined, 'no pendingRushPush — no adjacent hostile');
  });
});

// ── B-MVTRIG-003: Shoulder Rush fires when conditions met ──────────────────

describe('B-MVTRIG-003: Shoulder Rush sets pendingShoulderRush with adjacent hostile', () => {
  it('003: KX moves to a1, hostile on b1 → pendingShoulderRush set', async () => {
    const game = makeGame({
      figurePositions: {
        1: { 'KX-Series Security Droid (Elite)-1-0': 'a2' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
      shoulderRushPending: { '3001': true },
    });

    const dcMeta = [
      ['3001', { dcName: 'KX-Series Security Droid (Elite)', displayName: 'KX-Series Security Droid (Elite)', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'KX-Series Security Droid (Elite)-1-0', 1, 'a2', 1,
      'KX-Series Security Droid (Elite)', 'KX-Series Security Droid (Elite)');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a1', 'player1'), ctx);

    assert.ok(game.pendingShoulderRush, 'pendingShoulderRush set');
    assert.strictEqual(game.pendingShoulderRush.msgId, '3001');
    assert.strictEqual(game.pendingShoulderRush.activatorFigureKey, 'KX-Series Security Droid (Elite)-1-0');
    assert.ok(game.pendingShoulderRush.targets.includes('Stormtrooper (Regular)-1-0'),
      'target list includes the adjacent hostile');
  });
});

// ── B-MVTRIG-004: Shoulder Rush does NOT fire without conditions ───────────

describe('B-MVTRIG-004: Shoulder Rush does NOT fire without shoulderRushPending', () => {
  it('004: shoulderRushPending absent → no pendingShoulderRush', async () => {
    const game = makeGame({
      figurePositions: {
        1: { 'KX-Series Security Droid (Elite)-1-0': 'a2' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
      // shoulderRushPending intentionally absent
    });

    const dcMeta = [
      ['3001', { dcName: 'KX-Series Security Droid (Elite)', displayName: 'KX-Series Security Droid (Elite)', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'KX-Series Security Droid (Elite)-1-0', 1, 'a2', 1,
      'KX-Series Security Droid (Elite)', 'KX-Series Security Droid (Elite)');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a1', 'player1'), ctx);

    assert.strictEqual(game.pendingShoulderRush, undefined,
      'no pendingShoulderRush — flag not pre-set');
  });
});

// ── B-MVTRIG-005: Deference Protocol grants Block token ────────────────────

describe('B-MVTRIG-005: Deference Protocol grants Block token when LEADER enters adjacent', () => {
  it('005: Iden (LEADER) moves to a2, KX on b1 (adjacent) → KX gets Block token', async () => {
    // Iden Versio is a LEADER. KX-Series has deference_protocol.
    // KX on b1, Iden moves to a2. a2 is adjacent to b1 ✓
    const game = makeGame({
      figurePositions: {
        1: {
          'Iden Versio-1-0': 'a1',
          'KX-Series Security Droid (Elite)-1-0': 'b1',
        },
        2: {},
      },
    });

    const dcMeta = [
      ['3001', { dcName: 'Iden Versio', displayName: 'Iden Versio', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Iden Versio-1-0', 1, 'a1', 4, 'Iden Versio', 'Iden Versio');

    const { ctx, calls } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    // KX should have gained a Block token
    const kxTokens = game.figurePowerTokens?.['KX-Series Security Droid (Elite)-1-0'] || [];
    assert.ok(kxTokens.includes('Block'),
      'KX gained Block token via Deference Protocol');

    // roundFigureAbilityUsed guard set
    assert.strictEqual(
      game.roundFigureAbilityUsed?.['deference_protocol_KX-Series Security Droid (Elite)-1-0'],
      true,
      'once-per-round guard set');

    // Log message mentions Deference Protocol
    const logMsg = calls.logGameAction.find(args =>
      typeof args[2] === 'string' && args[2].includes('Deference Protocol'));
    assert.ok(logMsg, 'log message mentions Deference Protocol');
  });
});

// ── B-MVTRIG-006: Deference Protocol does NOT fire for non-LEADER ──────────

describe('B-MVTRIG-006: Deference Protocol does NOT fire when moved figure is not LEADER', () => {
  it('006: Rebel Trooper (TROOPER, not LEADER) moves adjacent to KX → no Block token', async () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Rebel Trooper (Regular)-1-0': 'a1',
          'KX-Series Security Droid (Elite)-1-0': 'b1',
        },
        2: {},
      },
    });

    const dcMeta = [
      ['3001', { dcName: 'Rebel Trooper (Regular)', displayName: 'Rebel Trooper', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Rebel Trooper (Regular)-1-0', 1, 'a1', 4,
      'Rebel Trooper', 'Rebel Trooper (Regular)');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    const kxTokens = game.figurePowerTokens?.['KX-Series Security Droid (Elite)-1-0'] || [];
    assert.ok(!kxTokens.includes('Block'),
      'KX did NOT gain Block — moved figure is not LEADER');
  });
});

// ── B-MVTRIG-007: Deference Protocol once-per-round guard ──────────────────

describe('B-MVTRIG-007: Deference Protocol does NOT fire twice in same round', () => {
  it('007: guard already set → no second Block token', async () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Iden Versio-1-0': 'a1',
          'KX-Series Security Droid (Elite)-1-0': 'b1',
        },
        2: {},
      },
      roundFigureAbilityUsed: {
        'deference_protocol_KX-Series Security Droid (Elite)-1-0': true,
      },
    });

    const dcMeta = [
      ['3001', { dcName: 'Iden Versio', displayName: 'Iden Versio', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Iden Versio-1-0', 1, 'a1', 4, 'Iden Versio', 'Iden Versio');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    const kxTokens = game.figurePowerTokens?.['KX-Series Security Droid (Elite)-1-0'] || [];
    assert.ok(!kxTokens.includes('Block'),
      'KX did NOT gain Block — once-per-round guard blocked');
  });
});

// ── B-MVTRIG-008: Dio Follow fires when Iden exits Dio's space ─────────────

describe('B-MVTRIG-008: pendingDioFollow set when Iden Versio exits Dio space', () => {
  it('008: Iden and Dio both on b1, Iden moves to a2 → pendingDioFollow set', async () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Iden Versio-1-0': 'b1',
          'Dio-1-0': 'b1',  // same space as Iden
        },
        2: {},
      },
    });

    const dcMeta = [
      ['3001', { dcName: 'Iden Versio', displayName: 'Iden Versio', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Iden Versio-1-0', 1, 'b1', 4, 'Iden Versio', 'Iden Versio');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.ok(game.pendingDioFollow, 'pendingDioFollow set');
    assert.strictEqual(game.pendingDioFollow.dioFigureKey, 'Dio-1-0');
    assert.strictEqual(game.pendingDioFollow.dioPlayerNum, 1);
    assert.strictEqual(game.pendingDioFollow.currentSpace, 'b1');
  });
});

// ── B-MVTRIG-009: Dio Follow does NOT fire when Dio not on same space ──────

describe('B-MVTRIG-009: pendingDioFollow NOT set when Dio is not on Iden start space', () => {
  it('009: Iden on b1, Dio on c1 (different space) → no pendingDioFollow', async () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Iden Versio-1-0': 'b1',
          'Dio-1-0': 'c1',  // different space
        },
        2: {},
      },
    });

    const dcMeta = [
      ['3001', { dcName: 'Iden Versio', displayName: 'Iden Versio', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Iden Versio-1-0', 1, 'b1', 4, 'Iden Versio', 'Iden Versio');

    const { ctx } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    assert.strictEqual(game.pendingDioFollow, undefined,
      'no pendingDioFollow — Dio not on Iden start space');
  });
});

// ── B-MVTRIG-010: Cross-trigger invariant ──────────────────────────────────

describe('B-MVTRIG-010: Core state correct after post-move triggers fire', () => {
  it('010: Deference Protocol fires AND core state still correct', async () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Iden Versio-1-0': 'a1',
          'KX-Series Security Droid (Elite)-1-0': 'b1',
        },
        2: {},
      },
      movementBank: {
        '3001': { total: 4, remaining: 4, threadId: null, messageId: null, displayName: 'Iden Versio' },
      },
    });

    const dcMeta = [
      ['3001', { dcName: 'Iden Versio', displayName: 'Iden Versio', playerNum: 1, gameId: '42' }],
    ];
    seedMoveState(game, '3001', 0, 'Iden Versio-1-0', 1, 'a1', 4, 'Iden Versio', 'Iden Versio');

    const { ctx, calls } = buildCtx(game, dcMeta);
    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    // Core invariants still hold after trigger:
    assert.strictEqual(game.figurePositions[1]['Iden Versio-1-0'], 'a2',
      'figurePositions correct');
    assert.strictEqual(game.moveInProgress['3001_0']?.mpRemaining, 3,
      'mpRemaining correct (4 - 1 = 3)');
    assert.strictEqual(game.movementBank['3001'].remaining, 3,
      'movementBank in sync');
    assert.strictEqual(game.figureMoved?.['Iden Versio-1-0'], true,
      'figureMoved set');

    // AND Deference Protocol also fired
    const kxTokens = game.figurePowerTokens?.['KX-Series Security Droid (Elite)-1-0'] || [];
    assert.ok(kxTokens.includes('Block'), 'Deference Protocol also fired');

    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});
