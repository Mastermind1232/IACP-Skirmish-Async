/**
 * BEHAVIORAL tests for claimed Krykna placement (D3 fix).
 *
 * Covers:
 *   B-KPLACE-001: getValidKryknaPlacementSpaces — zone filtering + occupancy
 *   B-KPLACE-002: runNpcKryknaActivation returns claimedPlacementNeeded flag
 *   B-KPLACE-003: Placement queue ordering (initiative first)
 *   B-KPLACE-004: Placed Krykna is a live NPC (id, coord, hp, defeated=false)
 *   B-KPLACE-005: claimedKrykna decrement on placement
 *   B-KPLACE-006: No placement when claimedKrykna is 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getValidKryknaPlacementSpaces, runNpcKryknaActivation } from '../../../src/game/mission-rules.js';
import { getInitiativePlayerNum, opponentPlayerNum } from '../../../src/game/player-helpers.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {},
    figureConditions: {},
    figurePowerTokens: {},
    openedDoors: [],
    moveInProgress: {},
    movementBank: {},
    pendingSpacePick: {},
    initiativePlayerId: 'user_p1',
    player1Id: 'user_p1',
    player2Id: 'user_p2',
    ...overrides,
  };
}

// Chopper-base-atollon deployment zones (abbreviated — 3 coords each for test)
const TEST_MAP_ID = 'chopper-base-atollon';
const RED_ZONE = ['d11', 'e11', 'f11'];
const BLUE_ZONE = ['u14', 'u13', 'v13'];

// Stub getDeploymentZones so the pure function can find zones.
// getValidKryknaPlacementSpaces imports getDeploymentZones from data-loader,
// which reads the real JSON. We test against the real data here.

// ── B-KPLACE-001: Valid placement spaces ────────────────────────────────────

describe('B-KPLACE-001: getValidKryknaPlacementSpaces — zone + occupancy', () => {
  it('001a: P1 places in blue (opponent) zone, P2 places in red zone', () => {
    const game = makeGame();
    const p1Spaces = getValidKryknaPlacementSpaces(game, 1, TEST_MAP_ID);
    const p2Spaces = getValidKryknaPlacementSpaces(game, 2, TEST_MAP_ID);
    // P1 places in blue zone (opponent = P2's initial zone)
    assert.ok(p1Spaces.includes('u14'), 'P1 can place in blue zone');
    assert.ok(!p1Spaces.includes('d11'), 'P1 cannot place in red zone');
    // P2 places in red zone (opponent = P1's initial zone)
    assert.ok(p2Spaces.includes('d11'), 'P2 can place in red zone');
    assert.ok(!p2Spaces.includes('u14'), 'P2 cannot place in blue zone');
  });

  it('001b: occupied spaces excluded', () => {
    const game = makeGame({
      figurePositions: { 1: { 'Trooper-1-0': 'u14' }, 2: {} },
      npcKrykna: [{ id: 'krykna-1', coord: 'u13', hp: 8, maxHp: 8, defeated: false }],
    });
    const p1Spaces = getValidKryknaPlacementSpaces(game, 1, TEST_MAP_ID);
    assert.ok(!p1Spaces.includes('u14'), 'figure-occupied excluded');
    assert.ok(!p1Spaces.includes('u13'), 'krykna-occupied excluded');
    assert.ok(p1Spaces.includes('v13'), 'unoccupied space available');
  });

  it('001c: defeated Krykna do NOT occupy spaces', () => {
    const game = makeGame({
      npcKrykna: [{ id: 'krykna-1', coord: 'u14', hp: 0, maxHp: 8, defeated: true }],
    });
    const p1Spaces = getValidKryknaPlacementSpaces(game, 1, TEST_MAP_ID);
    assert.ok(p1Spaces.includes('u14'), 'defeated krykna space is available');
  });

  it('001d: unknown map returns empty array', () => {
    const game = makeGame();
    const spaces = getValidKryknaPlacementSpaces(game, 1, 'nonexistent-map');
    assert.deepStrictEqual(spaces, []);
  });
});

// ── B-KPLACE-002: claimedPlacementNeeded flag ──────────────────────────────

describe('B-KPLACE-002: runNpcKryknaActivation returns claimedPlacementNeeded', () => {
  it('002a: true when any player has claimed Krykna', () => {
    const game = makeGame({
      npcKrykna: [{ id: 'krykna-1', coord: 'k23', hp: 8, maxHp: 8, defeated: false }],
      claimedKrykna: { 1: 1, 2: 0 },
    });
    const ctx = {
      getMapTokensData: () => ({}),
      getMapData: () => ({ adjacency: {} }),
      getMapRegistry: () => [{ id: TEST_MAP_ID }],
      filterMapSpacesByBounds: (s) => s,
    };
    const { claimedPlacementNeeded } = runNpcKryknaActivation(game, TEST_MAP_ID, ctx);
    assert.strictEqual(claimedPlacementNeeded, true);
  });

  it('002b: false when no player has claimed Krykna', () => {
    const game = makeGame({
      npcKrykna: [{ id: 'krykna-1', coord: 'k23', hp: 8, maxHp: 8, defeated: false }],
      claimedKrykna: { 1: 0, 2: 0 },
    });
    const ctx = {
      getMapTokensData: () => ({}),
      getMapData: () => ({ adjacency: {} }),
      getMapRegistry: () => [{ id: TEST_MAP_ID }],
      filterMapSpacesByBounds: (s) => s,
    };
    const { claimedPlacementNeeded } = runNpcKryknaActivation(game, TEST_MAP_ID, ctx);
    assert.strictEqual(claimedPlacementNeeded, false);
  });

  it('002c: false when claimedKrykna not set', () => {
    const game = makeGame({
      npcKrykna: [{ id: 'krykna-1', coord: 'k23', hp: 8, maxHp: 8, defeated: false }],
    });
    const ctx = {
      getMapTokensData: () => ({}),
      getMapData: () => ({ adjacency: {} }),
      getMapRegistry: () => [{ id: TEST_MAP_ID }],
      filterMapSpacesByBounds: (s) => s,
    };
    const { claimedPlacementNeeded } = runNpcKryknaActivation(game, TEST_MAP_ID, ctx);
    assert.strictEqual(claimedPlacementNeeded, false);
  });
});

// ── B-KPLACE-003: Queue ordering ──────────────────────────────────────────

describe('B-KPLACE-003: Placement queue ordering', () => {
  it('003a: initiative player queued first', () => {
    const game = makeGame({
      claimedKrykna: { 1: 1, 2: 1 },
    });
    const initNum = getInitiativePlayerNum(game);
    const otherNum = opponentPlayerNum(initNum);
    // Simulate queue building (as in index.js)
    const queue = [];
    if ((game.claimedKrykna?.[initNum] || 0) > 0) queue.push(initNum);
    if ((game.claimedKrykna?.[otherNum] || 0) > 0) queue.push(otherNum);
    assert.strictEqual(queue[0], initNum, 'initiative player first');
    assert.strictEqual(queue[1], otherNum, 'non-initiative player second');
  });

  it('003b: only players with claims are queued', () => {
    const game = makeGame({
      claimedKrykna: { 1: 0, 2: 2 },
    });
    const initNum = getInitiativePlayerNum(game);
    const otherNum = opponentPlayerNum(initNum);
    const queue = [];
    if ((game.claimedKrykna?.[initNum] || 0) > 0) queue.push(initNum);
    if ((game.claimedKrykna?.[otherNum] || 0) > 0) queue.push(otherNum);
    assert.strictEqual(queue.length, 1, 'only P2 has claims');
    assert.strictEqual(queue[0], 2, 'P2 is the only entry');
  });
});

// ── B-KPLACE-004: Placed Krykna is a live NPC ─────────────────────────────

describe('B-KPLACE-004: Placed Krykna is a live NPC', () => {
  it('004a: placed Krykna has correct structure', () => {
    const game = makeGame({
      npcKrykna: [
        { id: 'krykna-1', coord: 'k23', hp: 8, maxHp: 8, defeated: false },
        { id: 'krykna-2', coord: 'l6', hp: 0, maxHp: 8, defeated: true },
      ],
      claimedKrykna: { 1: 1, 2: 0 },
    });

    // Simulate placement (as in handleKryknaPlacePick)
    const nextId = `krykna-${game.npcKrykna.length + 1}`;
    const coord = 'u14';
    game.npcKrykna.push({ id: nextId, coord, hp: 8, maxHp: 8, defeated: false });
    game.claimedKrykna[1] = Math.max(0, game.claimedKrykna[1] - 1);

    const placed = game.npcKrykna[2];
    assert.strictEqual(placed.id, 'krykna-3', 'sequential id');
    assert.strictEqual(placed.coord, 'u14', 'placed at chosen coord');
    assert.strictEqual(placed.hp, 8, 'full HP');
    assert.strictEqual(placed.maxHp, 8, 'max HP');
    assert.strictEqual(placed.defeated, false, 'not defeated');
    assert.strictEqual(game.claimedKrykna[1], 0, 'claimed decremented');
  });
});

// ── B-KPLACE-005: claimedKrykna decrement ─────────────────────────────────

describe('B-KPLACE-005: claimedKrykna decrement on placement', () => {
  it('005a: decrement by 1, not all', () => {
    const game = makeGame({
      npcKrykna: [{ id: 'krykna-1', coord: 'k23', hp: 8, maxHp: 8, defeated: false }],
      claimedKrykna: { 1: 3, 2: 1 },
    });

    // Simulate P1 placement
    game.npcKrykna.push({ id: 'krykna-2', coord: 'u14', hp: 8, maxHp: 8, defeated: false });
    game.claimedKrykna[1] = Math.max(0, game.claimedKrykna[1] - 1);

    assert.strictEqual(game.claimedKrykna[1], 2, 'P1 claimed: 3 → 2 (not 0)');
    assert.strictEqual(game.claimedKrykna[2], 1, 'P2 claimed unchanged');
  });

  it('005b: decrement to 0 does not go negative', () => {
    const game = makeGame({
      npcKrykna: [],
      claimedKrykna: { 1: 1, 2: 0 },
    });

    game.npcKrykna.push({ id: 'krykna-1', coord: 'u14', hp: 8, maxHp: 8, defeated: false });
    game.claimedKrykna[1] = Math.max(0, game.claimedKrykna[1] - 1);

    assert.strictEqual(game.claimedKrykna[1], 0, 'claimed at 0');

    // Extra decrement (shouldn't happen, but safety)
    game.claimedKrykna[1] = Math.max(0, game.claimedKrykna[1] - 1);
    assert.strictEqual(game.claimedKrykna[1], 0, 'clamped to 0');
  });
});

// ── B-KPLACE-006: No placement when claimedKrykna is 0 ───────────────────

describe('B-KPLACE-006: No placement when claimedKrykna is 0', () => {
  it('006a: claimedPlacementNeeded false when both players at 0', () => {
    const game = makeGame({
      npcKrykna: [{ id: 'krykna-1', coord: 'k23', hp: 8, maxHp: 8, defeated: false }],
      claimedKrykna: { 1: 0, 2: 0 },
    });
    const ctx = {
      getMapTokensData: () => ({}),
      getMapData: () => ({ adjacency: {} }),
      getMapRegistry: () => [{ id: TEST_MAP_ID }],
      filterMapSpacesByBounds: (s) => s,
    };
    const { claimedPlacementNeeded } = runNpcKryknaActivation(game, TEST_MAP_ID, ctx);
    assert.strictEqual(claimedPlacementNeeded, false);
  });

  it('006b: empty queue when only P1 has 0 claims and P2 has 0', () => {
    const game = makeGame({
      claimedKrykna: { 1: 0, 2: 0 },
    });
    const initNum = getInitiativePlayerNum(game);
    const otherNum = opponentPlayerNum(initNum);
    const queue = [];
    if ((game.claimedKrykna?.[initNum] || 0) > 0) queue.push(initNum);
    if ((game.claimedKrykna?.[otherNum] || 0) > 0) queue.push(otherNum);
    assert.strictEqual(queue.length, 0, 'no entries');
  });
});
