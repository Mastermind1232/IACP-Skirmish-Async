/**
 * Oracle tests for Ready Weapons — PLAYER-CHOSEN Damage-token distribution.
 *
 * Rule: "Special Action: Distribute 3 Damage Tokens among figures in your group."
 * alexanbv 2026-06-22: the player chooses the distribution one token at a time
 * (sequential picker) — it is NOT auto-assigned in figure order.
 *
 * Confirmed-safe core:
 *   - Tokens are Damage type (not generic Power Tokens requiring a type choice)
 *   - Distributed among figures in the activating group, by player pick
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

// Drive the sequential distribution picker to completion with a fixed sequence
// of figure picks. Returns the final result.
function driveDistribution(picks, { figureCount = 2 } = {}) {
  const { game, dcMessageMeta, dcHealthState } = buildReadyWeaponsGame({ figureCount });
  let result = resolveAbility('Ready Weapons', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  for (const fk of picks) {
    if (!result.requiresChoice) break;
    result = resolveAbility('Ready Weapons', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: fk });
  }
  return { game, result };
}

// ── ORACLE-RWPN-001: Tokens are Damage type, not generic ────────────────────
describe('ORACLE-RWPN-001: Ready Weapons grants Damage tokens (not generic)', () => {
  it('001: all granted tokens are Damage type', () => {
    const { game } = driveDistribution(['Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-1-1']);
    const allTokens = Object.values(game.figurePowerTokens || {}).flat();
    assert.ok(allTokens.length > 0, 'Should have granted tokens');
    assert.ok(allTokens.every(t => t === 'Damage'), `All tokens should be Damage, got: ${allTokens}`);
  });
});

// ── ORACLE-RWPN-002: Player picks the distribution (no auto/type choice) ─────
describe('ORACLE-RWPN-002: player-chosen distribution, no power-token type choice', () => {
  it('002: initial play offers a figure picker, never a power-token type choice', () => {
    const { game, dcMessageMeta, dcHealthState } = buildReadyWeaponsGame({ figureCount: 2 });
    const result = resolveAbility('Ready Weapons', { game, playerNum: 1, dcMessageMeta, dcHealthState });
    assert.equal(result.requiresChoice, true, 'multi-figure group → player picks who gets each token');
    assert.equal(result.targetFigureKeys.length, 2);
    assert.ok(!result.requiresPowerTokenChoice, 'Should not require a power-token TYPE choice (always Damage)');
    assert.ok(!game.pendingPowerTokenGrant, 'Should not set pendingPowerTokenGrant');
  });

  it('002b: single-figure group auto-assigns (no real choice), capped at the token limit', () => {
    const { game } = driveDistribution([], { figureCount: 1 });
    const tokens = game.figurePowerTokens['Stormtrooper (Elite)-1-0'] || [];
    assert.equal(tokens.length, 2, 'single figure caps at getMaxPowerTokens (2)');
    assert.ok(tokens.every(t => t === 'Damage'));
  });
});

// ── ORACLE-RWPN-003: 3 tokens distributed by the chosen sequence ────────────
describe('ORACLE-RWPN-003: distributes 3 tokens per the player picks', () => {
  it('003: picking fig0,fig0,fig1 → fig0 gets 2, fig1 gets 1', () => {
    const { game, result } = driveDistribution(['Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-1-1']);
    assert.equal(result.applied, true);
    assert.equal((game.figurePowerTokens['Stormtrooper (Elite)-1-0'] || []).length, 2);
    assert.equal((game.figurePowerTokens['Stormtrooper (Elite)-1-1'] || []).length, 1);
    const allTokens = Object.values(game.figurePowerTokens || {}).flat();
    assert.equal(allTokens.length, 3, 'Should have 3 tokens total');
  });
});
