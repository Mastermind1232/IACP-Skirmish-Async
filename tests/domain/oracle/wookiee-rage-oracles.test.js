/**
 * Oracle tests for Wookiee Rage — multi-target scaling damage.
 *
 * Rule: "Special Action: Choose up to 3 hostile figures adjacent to you.
 *        Each chosen figure suffers 1 Damage for each Damage you have suffered,
 *        to a maximum of 3 Damage."
 *
 * Confirmed-safe core:
 *   - playableBy is WOOKIEE (two E's) — matches dc-effects keyword
 *   - Damage per target = min(3, damageSuffered by activating figure)
 *   - Multi-target: up to 3 adjacent hostiles
 *   - 0 damage suffered = no damage dealt (auto-resolves)
 *
 * NOTE: Tests use the direct chosenFigureKey path to bypass countGameSpaces
 * (which requires real map data). Enumeration is tested via integration/self-play.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { isCcPlayLegalByRestriction } from '../../../src/game/cc-timing.js';

// ── Helper: build game state for Wookiee Rage ───────────────────────────────
function buildWookieeRageGame({ damageSuffered = 3, adjacentHostiles = 1 } = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();

  const wookieeMsgId = 'msg_wookiee';
  dcMessageMeta.set(wookieeMsgId, {
    gameId: 'testgame', playerNum: 1, dcName: 'Wookiee Warrior (Elite)',
    displayName: 'Wookiee Warrior (Elite) [DG 1]',
  });
  const wookieeMax = 12;
  dcHealthState.set(wookieeMsgId, [[wookieeMax - damageSuffered, wookieeMax]]);

  const hostileKeys = {};
  const hostileMsgIds = [];
  for (let i = 0; i < adjacentHostiles; i++) {
    const mId = `msg_hostile_${i}`;
    dcMessageMeta.set(mId, {
      gameId: 'testgame', playerNum: 2, dcName: `Stormtrooper (Elite)`,
      displayName: `Stormtrooper (Elite) [DG ${i + 1}]`,
    });
    dcHealthState.set(mId, [[6, 6]]);
    hostileKeys[`Stormtrooper (Elite)-${i + 1}-0`] = 'A2';
    hostileMsgIds.push(mId);
  }

  const game = {
    gameId: 'testgame',
    figurePositions: {
      1: { 'Wookiee Warrior (Elite)-1-0': 'A1' },
      2: hostileKeys,
    },
    dcActionsData: { [wookieeMsgId]: { selectedFigure: 0 } },
    p1DcList: [{ dcName: 'Wookiee Warrior (Elite)', healthState: [wookieeMax - damageSuffered, wookieeMax] }],
    p2DcList: hostileMsgIds.map(() => ({ dcName: 'Stormtrooper (Elite)', healthState: [6, 6] })),
    p1DcMessageIds: [wookieeMsgId],
    p2DcMessageIds: hostileMsgIds,
    selectedMap: { id: 'test_map' },
  };

  return { game, dcMessageMeta, dcHealthState, wookieeMsgId, hostileMsgIds };
}

// ── ORACLE-WRAGE-001: playableBy is WOOKIEE (two E's) ───────────────────────
describe('ORACLE-WRAGE-001: playableBy WOOKIEE matches keyword', () => {
  it('001a: legal when player has Wookiee Warrior (Elite)', () => {
    const game = {
      p1DcList: [{ dcName: 'Wookiee Warrior (Elite)' }],
      p2DcList: [],
    };
    const result = isCcPlayLegalByRestriction(game, 1, 'Wookiee Rage');
    assert.equal(result.legal, true);
  });

  it('001b: illegal when player has no WOOKIEE DCs', () => {
    const game = {
      p1DcList: [{ dcName: 'Luke Skywalker' }, { dcName: 'Darth Vader' }],
      p2DcList: [],
    };
    const result = isCcPlayLegalByRestriction(game, 1, 'Wookiee Rage');
    assert.equal(result.legal, false);
  });
});

// ── ORACLE-WRAGE-002: Damage scales with damage suffered (max 3) ─────────────
// Uses direct chosenFigureKey + wookiee_rage_done path to bypass map enumeration.
describe('ORACLE-WRAGE-002: Damage scales with damage suffered', () => {
  it('002a: 3 damage suffered → 3 damage to target', () => {
    const { game, dcMessageMeta, dcHealthState, hostileMsgIds } = buildWookieeRageGame({ damageSuffered: 3, adjacentHostiles: 1 });
    const targetFk = 'Stormtrooper (Elite)-1-0';
    // Accumulate target
    game._wookieeRageTargets = [targetFk];
    // Finalize
    const result = resolveAbility('Wookiee Rage', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
      chosenFigureKey: 'wookiee_rage_done',
    });
    assert.equal(result.applied, true);
    const hp = dcHealthState.get(hostileMsgIds[0]);
    assert.deepStrictEqual(hp, [[3, 6]], 'Target HP should be 6 → 3 (3 Damage)');
  });

  it('002b: 1 damage suffered → 1 damage to target', () => {
    const { game, dcMessageMeta, dcHealthState, hostileMsgIds } = buildWookieeRageGame({ damageSuffered: 1, adjacentHostiles: 1 });
    const targetFk = 'Stormtrooper (Elite)-1-0';
    game._wookieeRageTargets = [targetFk];
    const result = resolveAbility('Wookiee Rage', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
      chosenFigureKey: 'wookiee_rage_done',
    });
    assert.equal(result.applied, true);
    const hp = dcHealthState.get(hostileMsgIds[0]);
    assert.deepStrictEqual(hp, [[5, 6]], 'Target HP should be 6 → 5 (1 Damage)');
  });

  it('002c: 5 damage suffered → capped at 3 damage per target', () => {
    const { game, dcMessageMeta, dcHealthState, hostileMsgIds } = buildWookieeRageGame({ damageSuffered: 5, adjacentHostiles: 1 });
    const targetFk = 'Stormtrooper (Elite)-1-0';
    game._wookieeRageTargets = [targetFk];
    const result = resolveAbility('Wookiee Rage', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
      chosenFigureKey: 'wookiee_rage_done',
    });
    assert.equal(result.applied, true);
    const hp = dcHealthState.get(hostileMsgIds[0]);
    assert.deepStrictEqual(hp, [[3, 6]], 'Target HP should be 6 → 3 (capped at 3)');
  });
});

// ── ORACLE-WRAGE-003: 0 damage suffered → no damage dealt ────────────────────
describe('ORACLE-WRAGE-003: 0 damage suffered → no damage', () => {
  it('003: resolves with no damage when undamaged', () => {
    const { game, dcMessageMeta, dcHealthState, hostileMsgIds } = buildWookieeRageGame({ damageSuffered: 0, adjacentHostiles: 1 });
    // 0 damage suffered → handler auto-resolves on first call (no enumeration)
    const result = resolveAbility('Wookiee Rage', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });
    assert.equal(result.applied, true);
    assert.ok(result.logMessage.includes('0 Damage suffered'));
    const hp = dcHealthState.get(hostileMsgIds[0]);
    assert.deepStrictEqual(hp, [[6, 6]], 'Target HP should be unchanged');
  });
});

// ── ORACLE-WRAGE-004: Multi-target — 2 targets chosen ────────────────────────
describe('ORACLE-WRAGE-004: Multi-target damage', () => {
  it('004: 2 targets each take scaled damage', () => {
    const { game, dcMessageMeta, dcHealthState, hostileMsgIds } = buildWookieeRageGame({ damageSuffered: 2, adjacentHostiles: 2 });
    // Pre-set both targets
    game._wookieeRageTargets = ['Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-2-0'];
    const result = resolveAbility('Wookiee Rage', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
      chosenFigureKey: 'wookiee_rage_done',
    });
    assert.equal(result.applied, true);
    for (const mId of hostileMsgIds) {
      const hp = dcHealthState.get(mId);
      assert.deepStrictEqual(hp, [[4, 6]], `Each target HP should be 6 → 4 (2 Damage)`);
    }
  });
});
