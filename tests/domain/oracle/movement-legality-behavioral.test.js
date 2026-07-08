/**
 * BEHAVIORAL oracle tests for Movement Validation Phase 1.
 *
 * Tests movement legality computation: reachable destinations, terrain constraints,
 * door blocking, large figure footprint rules, massive figure special rules, and
 * illegal destination rejection at the handler level.
 *
 * Uses real map data (anchorhead-cantina-bar, mos-eisley-outskirts) and synthetic grids.
 *
 * Key real-map topology (anchorhead-cantina-bar):
 *   a1 adj: a2, b1, b2
 *   a2 adj: a1, a3, b1, b2, b3
 *   b1 adj: b2, a1, c1, a2, c2
 *   c1 adj: c2, b1, d1, b2, d2
 *
 * Key real-map topology (mos-eisley-outskirts door area):
 *   r11 adj: r10, r12, s11, s10, s12
 *   Doors: [r11,r12] and [s11,s12]
 *
 * Test categories:
 *   B-MVLEG-001: Baseline legal path on real map
 *   B-MVLEG-002: Occupied space blocking on real map
 *   B-MVLEG-003: Door blocks/allows movement
 *   B-MVLEG-004: Large figure (2x2) movement legality
 *   B-MVLEG-005: Massive figure movement legality
 *   B-MVLEG-006: Illegal destination rejection at handler level
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBoardStateForMovement,
  getMovementProfile,
  computeMovementCache,
  getSpacesAtCost,
  getMovementTarget,
  getMovementPath,
  buildTempBoardState,
  getNormalizedFootprint,
  ensureMovementCache,
} from '../../../src/game/movement.js';
import { normalizeCoord } from '../../../src/game/coords.js';
import { handleMovePick } from '../../../src/handlers/movement.js';
import { getFigureSize, getDcStats } from '../../../src/data-loader.js';

// ── Synthetic grid builder ─────────────────────────────────────────────────

/** Build NxM grid with orthogonal adjacency (a1..{maxCol}{maxRow}). */
function buildGrid(cols, rows, overrides = {}) {
  const { blocked = [], difficult = [], movementBlockingEdges = [] } = overrides;
  const spaces = [];
  const adjacency = {};
  const terrain = {};

  function coord(col, row) {
    return String.fromCharCode(97 + col) + (row + 1);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = coord(c, r);
      if (blocked.includes(k)) continue;
      spaces.push(k);
      terrain[k] = difficult.includes(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          const nk = coord(nc, nr);
          if (!blocked.includes(nk)) {
            const ek = [k, nk].sort().join('|');
            const isBlocked = movementBlockingEdges.some(
              ([a, b]) => [a, b].sort().join('|') === ek
            );
            if (!isBlocked) neighbors.push(nk);
          }
        }
      }
      adjacency[k] = neighbors;
    }
  }

  return {
    spaces,
    adjacency,
    terrain,
    blocking: [],
    movementBlockingEdges: movementBlockingEdges || [],
    impassableEdges: [],
  };
}

// ── Profiles ───────────────────────────────────────────────────────────────

const defaultProfile = {
  size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true, canRotate: false,
  isMassive: false, isMobile: false, ignoreDifficult: false, ignoreBlocking: false,
  ignoreFigureCost: false, canEndOnOccupied: false,
};

const largeProfile = {
  size: '2x2', cols: 2, rows: 2, isLarge: true, allowDiagonal: false, canRotate: false,
  isMassive: false, isMobile: false, ignoreDifficult: false, ignoreBlocking: false,
  ignoreFigureCost: false, canEndOnOccupied: false,
};

const massiveProfile = {
  size: '2x2', cols: 2, rows: 2, isLarge: true, allowDiagonal: false, canRotate: false,
  isMassive: true, isMobile: false, ignoreDifficult: true, ignoreBlocking: true,
  ignoreFigureCost: true, canEndOnOccupied: true,
};

// ── Mock helpers for handler tests (B-MVLEG-006) ──────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  const mockMsg = {
    id: 'grid-msg-1', delete: async () => ({}), edit: async () => ({}),
    attachments: new Map(), author: { id: 'bot' },
  };
  return {
    customId, user: { id: userId },
    followUp: async (msg) => { followUpCalls.push(msg); return mockMsg; },
    deferUpdate: async () => ({}), update: async () => ({}),
    message: mockMsg,
    channel: {
      messages: { fetch: async (opts) => typeof opts === 'string' ? mockMsg : new Map() },
      send: async () => mockMsg,
    },
    _followUpCalls: followUpCalls,
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42', player1Id: 'player1', player2Id: 'player2',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {}, figureConditions: {}, figurePowerTokens: {},
    openedDoors: [], moveInProgress: {}, movementBank: {},
    moveGridMessageIds: {}, pendingSpacePick: {},
    ...overrides,
  };
}

function buildCtx(game, overrides = {}) {
  const calls = { saveGames: [], logGameAction: [], pushUndo: [] };
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

function seedMoveState(game, msgId, figureIndex, figureKey, playerNum, startCoord, mp, displayName) {
  const moveKey = `${msgId}_${figureIndex}`;
  const boardState = getBoardStateForMovement(game, figureKey);
  const profile = getMovementProfile('Rebel Trooper', figureKey, game);
  const cache = computeMovementCache(startCoord, mp, boardState, profile);
  game.moveInProgress[moveKey] = {
    figureKey, playerNum, mpRemaining: mp, displayName: displayName || 'Rebel Trooper',
    startCoord, boardState, movementProfile: profile, movementCache: cache, cacheMaxMp: mp,
    pendingMp: null,
  };
  return { moveKey, boardState, profile, cache };
}

// ── B-MVLEG-001: Baseline legal path on real map ───────────────────────────

describe('B-MVLEG-001: Baseline legal path on real map (anchorhead-cantina-bar)', () => {
  // a1 adj: a2, b1, b2 — 2 orthogonal + 1 diagonal = 3 neighbors

  it('001a: 1 MP from a1 reaches exactly a2, b1, b2', () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('a1', 1, board, profile);

    const at1 = getSpacesAtCost(cache, 1);
    assert.ok(at1.includes('a2'), 'a2 reachable at cost 1 (orthogonal)');
    assert.ok(at1.includes('b1'), 'b1 reachable at cost 1 (orthogonal)');
    assert.ok(at1.includes('b2'), 'b2 reachable at cost 1 (diagonal)');
    assert.strictEqual(at1.length, 3, 'exactly 3 destinations at cost 1');
  });

  it('001b: start space NOT in reachable cells (cost 0 excluded)', () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('a1', 4, board, profile);

    assert.strictEqual(getMovementTarget(cache, 'a1'), null,
      'start space not in reachable cells');
  });

  it('001c: 2 MP reaches further spaces at correct costs', () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('a1', 2, board, profile);

    // a3: a1→a2(1)→a3(2)
    const a3 = getMovementTarget(cache, 'a3');
    assert.ok(a3, 'a3 reachable at 2 MP');
    assert.strictEqual(a3.cost, 2, 'a3 costs 2 MP');

    // c1: a1→b1(1)→c1(2) or a1→b2(1)→c1(2)
    const c1 = getMovementTarget(cache, 'c1');
    assert.ok(c1, 'c1 reachable at 2 MP');
    assert.strictEqual(c1.cost, 2, 'c1 costs 2 MP');
  });
});

// ── B-MVLEG-002: Occupied space blocking on real map ───────────────────────

describe('B-MVLEG-002: Occupied space blocking (anchorhead-cantina-bar)', () => {

  it('002a: hostile-occupied space excluded from reachable endpoints', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('a1', 4, board, profile);

    const b1 = getMovementTarget(cache, 'b1');
    assert.strictEqual(b1, null, 'hostile-occupied b1 not a valid endpoint');
  });

  it('002b: friendly-occupied space excluded from endpoints but pass-through works', () => {
    const game = makeGame({
      figurePositions: {
        1: {
          'Rebel Trooper-1-0': 'a1',
          'Rebel Trooper-2-0': 'b1',  // friendly on b1
        },
        2: {},
      },
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('a1', 2, board, profile);

    // b1 is friendly-occupied — can't end there
    assert.strictEqual(getMovementTarget(cache, 'b1'), null,
      'friendly-occupied b1 not a valid endpoint');

    // c1 reachable via pass-through b1 or diagonal
    const c1 = getMovementTarget(cache, 'c1');
    assert.ok(c1, 'c1 reachable by passing through friendly b1');
    assert.strictEqual(c1.cost, 2, 'c1 costs 2 MP');
  });

  it('002c: hostile-occupied space costs +1 MP; diagonal bypass is cheaper', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: { 'Stormtrooper (Regular)-1-0': 'b1' },
      },
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('a1', 4, board, profile);

    // c1 via hostile b1: a1→b1(2: base+hostile)→c1(+1) = 3
    // c1 via diagonal: a1→b2(1)→c1(1) = 2 (bypasses hostile)
    const c1 = getMovementTarget(cache, 'c1');
    assert.ok(c1, 'c1 reachable');
    assert.strictEqual(c1.cost, 2, 'c1 costs 2 (diagonal bypass cheaper than 3 through hostile)');
  });
});

// ── B-MVLEG-003: Door blocks/allows movement ──────────────────────────────

describe('B-MVLEG-003: Door blocks/allows movement (mos-eisley-outskirts)', () => {
  // Doors: [r11,r12] and [s11,s12]
  // r11 adj: r10, r12, s11, s10, s12

  it('003a: closed door blocks direct r11→r12 movement', () => {
    const game = makeGame({
      selectedMap: { id: 'mos-eisley-outskirts' },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'r11' }, 2: {} },
      openedDoors: [],  // all doors closed
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('r11', 1, board, profile);

    assert.strictEqual(getMovementTarget(cache, 'r12'), null,
      'r12 not reachable at 1 MP — door r11|r12 closed');
  });

  it('003b: opened door allows direct r11→r12 movement at cost 1', () => {
    const game = makeGame({
      selectedMap: { id: 'mos-eisley-outskirts' },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'r11' }, 2: {} },
      openedDoors: ['r11|r12'],  // first door opened
    });
    const board = getBoardStateForMovement(game, 'Rebel Trooper-1-0');
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    const cache = computeMovementCache('r11', 1, board, profile);

    const r12 = getMovementTarget(cache, 'r12');
    assert.ok(r12, 'r12 reachable at 1 MP — door opened');
    assert.strictEqual(r12.cost, 1, 'r12 costs 1 MP (direct orthogonal)');
  });

  it('003c: door edge correctly present/absent in movementBlockingSet', () => {
    // Closed: edge in blocking set
    const gameClosed = makeGame({
      selectedMap: { id: 'mos-eisley-outskirts' },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'r11' }, 2: {} },
      openedDoors: [],
    });
    const boardClosed = getBoardStateForMovement(gameClosed, 'Rebel Trooper-1-0');
    assert.ok(boardClosed.movementBlockingSet.has('r11|r12'),
      'closed door edge in movementBlockingSet');

    // Opened: edge not in blocking set
    const gameOpen = makeGame({
      selectedMap: { id: 'mos-eisley-outskirts' },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'r11' }, 2: {} },
      openedDoors: ['r11|r12'],
    });
    const boardOpen = getBoardStateForMovement(gameOpen, 'Rebel Trooper-1-0');
    assert.ok(!boardOpen.movementBlockingSet.has('r11|r12'),
      'opened door edge NOT in movementBlockingSet');
  });
});

// ── B-MVLEG-004: Large figure (2x2) movement legality ─────────────────────

describe('B-MVLEG-004: Large figure (2x2) movement legality (synthetic 6x6 grid)', () => {
  // 2x2 at a1 → footprint [a1,b1,a2,b2]
  // Move right → topLeft b1 → footprint [b1,c1,b2,c2], overlap [b1,b2] = 2 ≥ ceil(4/2) ✓
  // Move down  → topLeft a2 → footprint [a2,b2,a3,b3], overlap [a2,b2] = 2 ≥ 2 ✓

  it('004a: 2x2 figure — only orthogonal moves, no diagonals', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, largeProfile);

    const reachable = [...cache.cells.keys()];
    assert.ok(reachable.includes('b1'), 'b1 reachable (shift right)');
    assert.ok(reachable.includes('a2'), 'a2 reachable (shift down)');
    assert.strictEqual(reachable.length, 2, 'exactly 2 destinations (no diagonals for large)');
  });

  it('004b: 2x2 figure — sliding rule: 2 MP reaches stepwise destinations', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 2, board, largeProfile);

    // 2-step orthogonal destinations
    assert.ok(getMovementTarget(cache, 'c1'), 'c1 reachable at 2 MP (a1→b1→c1)');
    assert.ok(getMovementTarget(cache, 'a3'), 'a3 reachable at 2 MP (a1→a2→a3)');
    assert.ok(getMovementTarget(cache, 'b2'), 'b2 reachable at 2 MP (a1→b1→b2 or a1→a2→b2)');

    // c1 NOT reachable at cost 1 (would skip sliding rule)
    const at1 = getSpacesAtCost(cache, 1);
    assert.ok(!at1.includes('c1'), 'c1 not at cost 1 — requires 2 steps');
  });

  it('004c: 2x2 figure — occupied cell in footprint blocks endpoint', () => {
    const mapSpaces = buildGrid(6, 6);
    // c1 occupied (friendly) — blocks ending at topLeft=b1 (footprint includes c1)
    const board = buildTempBoardState(mapSpaces, ['c1'], []);
    const cache = computeMovementCache('a1', 1, board, largeProfile);

    assert.strictEqual(getMovementTarget(cache, 'b1'), null,
      'b1 not endable — c1 in footprint is occupied');
    assert.ok(getMovementTarget(cache, 'a2'),
      'a2 still reachable — footprint [a2,b2,a3,b3] is clear');
  });

  it('004d: 2x2 figure — pass through occupied footprint to reach clear space', () => {
    const mapSpaces = buildGrid(6, 6);
    // c1 occupied — b1 not endable but passable
    const board = buildTempBoardState(mapSpaces, ['c1'], []);
    const cache = computeMovementCache('a1', 2, board, largeProfile);

    // b1 is passable (node exists but canEnd=false), then b2 from b1→down
    // b2 footprint [b2,c2,b3,c3] — all clear
    const b2 = getMovementTarget(cache, 'b2');
    assert.ok(b2, 'b2 reachable at 2 MP — passed through occupied-footprint b1');
    assert.strictEqual(b2.cost, 2);
  });
});

// ── B-MVLEG-005: Massive figure movement legality ─────────────────────────

describe('B-MVLEG-005: Massive figure movement legality (synthetic 6x6 grid)', () => {

  it('005a: massive CAN end on occupied spaces', () => {
    const mapSpaces = buildGrid(6, 6);
    // c1 occupied — blocks non-massive at b1, but massive can end there
    const board = buildTempBoardState(mapSpaces, ['c1'], []);
    const cache = computeMovementCache('a1', 1, board, massiveProfile);

    assert.ok(getMovementTarget(cache, 'b1'),
      'b1 reachable — massive can end on occupied (canEndOnOccupied=true)');
  });

  it('005b: massive ignores difficult terrain (no extra MP cost)', () => {
    const mapSpaces = buildGrid(6, 6, { difficult: ['b1', 'c1'] });
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, massiveProfile);

    const b1 = getMovementTarget(cache, 'b1');
    assert.ok(b1, 'b1 reachable at 1 MP despite difficult terrain');
    assert.strictEqual(b1.cost, 1, 'cost 1 — massive ignores difficult');
  });

  it('005c: massive ignores blocking terrain', () => {
    const mapSpaces = buildGrid(6, 6);
    mapSpaces.blocking = ['c1'];  // blocking terrain at c1
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 1, board, massiveProfile);

    // b1 footprint includes c1 (blocking), but massive ignores blocking
    assert.ok(getMovementTarget(cache, 'b1'),
      'b1 reachable — massive ignores blocking terrain in footprint');
  });

  it('005d: massive CANNOT enter another massive figure\'s space', () => {
    const mapSpaces = buildGrid(6, 6);
    // Another massive 2x2 at c1 (footprint c1,d1,c2,d2)
    const board = buildTempBoardState(mapSpaces, ['c1', 'd1', 'c2', 'd2'], []);
    board.massiveOccupiedSet = new Set(['c1', 'd1', 'c2', 'd2']);
    const cache = computeMovementCache('a1', 4, board, massiveProfile);

    // b1 footprint [b1,c1,b2,c2] overlaps massiveOccupied at c1,c2 → blocked
    assert.strictEqual(getMovementTarget(cache, 'b1'), null,
      'b1 blocked — footprint overlaps another massive figure');

    // a2 footprint [a2,b2,a3,b3] — no overlap → reachable
    assert.ok(getMovementTarget(cache, 'a2'),
      'a2 reachable — footprint does not overlap massive');
  });

  it('005e: non-massive control — CANNOT end on occupied spaces', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, ['c1'], []);
    const cache = computeMovementCache('a1', 1, board, largeProfile);

    assert.strictEqual(getMovementTarget(cache, 'b1'), null,
      'non-massive cannot end at b1 — occupied cell in footprint');
  });
});

// ── B-MVLEG-006: Illegal destination rejection at handler level ───────────

describe('B-MVLEG-006: Illegal destination rejection — no downstream state mutation', () => {

  it('006a: destination not in cache → ephemeral rejection, position unchanged', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 1, 'Rebel Trooper');

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('move_pick_3001_0_z1', 'player1');
    await handleMovePick(interaction, ctx);

    assert.strictEqual(game.figurePositions[1]['Rebel Trooper-1-0'], 'a1',
      'position unchanged — invalid destination rejected');

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('not valid'));
    assert.ok(msg, 'ephemeral "not valid" rejection sent');
  });

  it('006b: no saveGames or figureMoved on invalid destination', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 1, 'Rebel Trooper');

    const { ctx, calls } = buildCtx(game);
    await handleMovePick(mockInteraction('move_pick_3001_0_z1', 'player1'), ctx);

    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
    assert.strictEqual(game.figureMoved?.['Rebel Trooper-1-0'], undefined,
      'figureMoved not set — no state mutation');
  });

  it('006c: moveInProgress survives rejection (session preserved)', async () => {
    const game = makeGame({
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
    });
    seedMoveState(game, '3001', 0, 'Rebel Trooper-1-0', 1, 'a1', 1, 'Rebel Trooper');

    const { ctx } = buildCtx(game);
    await handleMovePick(mockInteraction('move_pick_3001_0_z1', 'player1'), ctx);

    assert.ok(game.moveInProgress['3001_0'],
      'moveInProgress still exists — session preserved for retry');
    assert.strictEqual(game.moveInProgress['3001_0'].mpRemaining, 1,
      'MP unchanged after rejection');
  });
});
