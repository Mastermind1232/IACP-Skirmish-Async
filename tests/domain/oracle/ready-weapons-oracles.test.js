/**
 * Oracle tests for Ready Weapons — auto-assign Damage tokens.
 *
 * Rule: "Special Action: Distribute 3 Damage Tokens among figures in your group."
 *
 * Confirmed-safe core:
 *   - Tokens are Damage type (not generic Power Tokens requiring choice)
 *   - Distributed among figures in activating group
 *   - Respects per-figure token cap
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

// ── Helper ───────────────────────────────────────────────────────────────────
function buildReadyWeaponsGame({ figureCount = 2 } = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();

  const stormMsgId = 'msg_storm';
  dcMessageMeta.set(stormMsgId, {
    gameId: 'testgame', playerNum: 1, dcName: 'Stormtrooper (Elite)',
    displayName: 'Stormtrooper (Elite) [DG 1]',
  });
  const healthArr = [];
  const positions = {};
  for (let i = 0; i < figureCount; i++) {
    healthArr.push([6, 6]);
    positions[`Stormtrooper (Elite)-1-${i}`] = `D${4 + i}`;
  }
  dcHealthState.set(stormMsgId, healthArr);

  const game = {
    gameId: 'testgame',
    figurePositions: { 1: positions, 2: {} },
    dcActionsData: { [stormMsgId]: { selectedFigure: 0 } },
    p1DcList: [{ dcName: 'Stormtrooper (Elite)', healthState: healthArr.map(h => [...h]) }],
    p2DcList: [],
    p1DcMessageIds: [stormMsgId],
    p2DcMessageIds: [],
    currentActivation: { playerNum: 1, msgId: stormMsgId },
  };

  return { game, dcMessageMeta, dcHealthState, stormMsgId };
}

// ── ORACLE-RWPN-001: Tokens are Damage type, not generic ────────────────────
describe('ORACLE-RWPN-001: Ready Weapons grants Damage tokens (not generic)', () => {
  it('001: all granted tokens are Damage type', () => {
    const { game, dcMessageMeta, dcHealthState } = buildReadyWeaponsGame({ figureCount: 2 });

    const result = resolveAbility('Ready Weapons', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });

    assert.equal(result.applied, true);
    // Check all tokens are Damage
    const allTokens = Object.values(game.figurePowerTokens || {}).flat();
    assert.ok(allTokens.length > 0, 'Should have granted tokens');
    assert.ok(allTokens.every(t => t === 'Damage'), `All tokens should be Damage, got: ${allTokens}`);
  });
});

// ── ORACLE-RWPN-002: No pending choice prompt ──────────────────────────────
describe('ORACLE-RWPN-002: No power token type choice required', () => {
  it('002: result does not require power token choice', () => {
    const { game, dcMessageMeta, dcHealthState } = buildReadyWeaponsGame({ figureCount: 2 });

    const result = resolveAbility('Ready Weapons', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });

    assert.equal(result.applied, true);
    assert.ok(!result.requiresPowerTokenChoice, 'Should not require power token choice');
    assert.ok(!game.pendingPowerTokenGrant, 'Should not set pendingPowerTokenGrant');
  });
});

// ── ORACLE-RWPN-003: 3 tokens distributed across group ──────────────────────
describe('ORACLE-RWPN-003: Distributes 3 tokens total', () => {
  it('003: 2-figure group receives 3 Damage tokens total', () => {
    const { game, dcMessageMeta, dcHealthState } = buildReadyWeaponsGame({ figureCount: 2 });

    resolveAbility('Ready Weapons', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });

    const allTokens = Object.values(game.figurePowerTokens || {}).flat();
    assert.equal(allTokens.length, 3, 'Should have 3 tokens total');
  });
});
