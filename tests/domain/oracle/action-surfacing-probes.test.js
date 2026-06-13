/**
 * Tier 3 Legality-Oracle Probes: Action Surfacing (D1)
 *
 * PROBE-AS-001: Already-attacked gate blocks second attack (no Assault/free-attack)
 * PROBE-AS-002: All DCs exhausted → end_activation_phase offered
 * PROBE-AS-003: Pass activation legality
 *   a) Equal activations → no pass
 *   b) Opponent has more → pass offered
 *   c) Player exhausted, opponent still has activations → forced pass
 * PROBE-AS-004: Dead DC (all figures defeated) not offered for activation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

/** Find P1's first DC msgId, meta, and figureKey from dcMessageMeta. */
function getP1DcInfo(game, dcMessageMeta) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== 1) continue;
    const figKey = Object.keys(game.figurePositions[1] || {})
      .find(fk => fk.startsWith(meta.dcName + '-'));
    return { msgId, meta, figKey };
  }
  return null;
}

/** Find P1 DC info by name. */
function getDcInfoByName(game, dcMessageMeta, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== 1) continue;
    if (meta.dcName !== dcName) continue;
    const figKey = Object.keys(game.figurePositions[1] || {})
      .find(fk => fk.startsWith(meta.dcName + '-'));
    return { msgId, meta, figKey };
  }
  return null;
}

// ── PROBE-AS-001: Already-attacked gate ─────────────────────────────────────

describe('PROBE-AS-001: No second attack after already attacked (without Assault/free-attack)', () => {
  it('001: attack_target not offered when attackPerformedThisActivation is set', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getP1DcInfo(game, dcMessageMeta);
    assert.ok(dc, 'Should find P1 DC');

    // Mid-activation: 1 action remaining, this figure already attacked
    // this activation. Per alexanbv 2026-05-13: the flag is keyed by
    // figureKey (per-figure), not msgId (per-group).
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { perFigureRemaining: { 0: 1 }, figureLocked: {} };
    game.attackPerformedThisActivation = { [dc.figKey]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attackActions = actions.filter(a => a.type === 'attack_target');

    assert.equal(attackActions.length, 0,
      `No attack_target should be offered after already attacking. Got types: [${actions.map(a => a.type)}]`);

    // Move should still be available (attack gate doesn't block movement)
    const moveActions = actions.filter(a => a.type === 'move_figure');
    assert.ok(moveActions.length > 0, 'Move should still be available after attacking');
  });
});

// ── PROBE-AS-002: All DCs exhausted → end_activation_phase ──────────────────

describe('PROBE-AS-002: All DCs exhausted → end_activation_phase offered', () => {
  it('002: player has activations but all DCs are exhausted → end_activation_phase prevents deadlock', () => {
    const { game, deps, dcMessageMeta, dcExhaustedState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // P1 has 1 activation remaining but all DCs are exhausted
    game.p1ActivationsRemaining = 1;

    // Mark all P1 DCs as exhausted
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 1) {
        dcExhaustedState.set(msgId, true);
      }
    }

    const actions = getAvailableActions(game, 1, deps);
    const actionTypes = actions.map(a => a.type);

    assert.ok(actionTypes.includes('end_activation_phase'),
      `end_activation_phase should be offered when all DCs exhausted. Got: [${actionTypes}]`);
    assert.ok(!actionTypes.includes('activate_dc'),
      `No activate_dc should be offered when all DCs are exhausted. Got: [${actionTypes}]`);
  });
});

// ── PROBE-AS-003: Pass activation conditions ────────────────────────────────

describe('PROBE-AS-003: Pass activation legal only when opponent has strictly more activations', () => {
  it('003a: equal activations → no pass offered', () => {
    const { game, deps } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Both players have 1 activation each (builder default for 1 DC each)
    game.p1ActivationsRemaining = 1;
    game.p2ActivationsRemaining = 1;

    const actions = getAvailableActions(game, 1, deps);
    const passActions = actions.filter(a => a.type === 'pass_activation_turn');

    assert.equal(passActions.length, 0, 'No pass when activations are equal');
  });

  it('003b: opponent has more activations → pass offered', () => {
    const { game, deps } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();

    // P1: 1 activation, P2: 2 activations
    game.p1ActivationsRemaining = 1;
    game.p2ActivationsRemaining = 2;

    const actions = getAvailableActions(game, 1, deps);
    const passActions = actions.filter(a => a.type === 'pass_activation_turn');

    assert.ok(passActions.length > 0,
      `pass_activation_turn should be offered when opponent has more. Got: [${actions.map(a => a.type)}]`);
  });

  it('003c: player has 0 activations, opponent still has some → forced pass', () => {
    const { game, deps } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // P1: 0 activations, P2: 1 — P1 must pass
    game.p1ActivationsRemaining = 0;
    game.p2ActivationsRemaining = 1;

    const actions = getAvailableActions(game, 1, deps);
    const passActions = actions.filter(a => a.type === 'pass_activation_turn');

    assert.ok(passActions.length > 0,
      `Forced pass when player has 0 activations but opponent has some. Got: [${actions.map(a => a.type)}]`);
  });
});

// ── PROBE-AS-004: Dead DC not offered for activation ────────────────────────

describe('PROBE-AS-004: Dead DC (all figures defeated) not offered for activation', () => {
  it('004: DC with no surviving figures not in activate_dc actions', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }, { dcName: 'Greedo' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();

    // Remove all Bossk figures from board (simulating defeat)
    const bosskFigKeys = Object.keys(game.figurePositions[1] || {}).filter(fk => fk.startsWith('Bossk-'));
    assert.ok(bosskFigKeys.length > 0, 'Bossk should have figures on board initially');
    for (const fk of bosskFigKeys) {
      delete game.figurePositions[1][fk];
    }

    const actions = getAvailableActions(game, 1, deps);
    const activateActions = actions.filter(a => a.type === 'activate_dc');
    const offeredDcNames = activateActions.map(a => a.params.dcName);

    assert.ok(!offeredDcNames.includes('Bossk'),
      `Dead Bossk should NOT be offered. Offered: [${offeredDcNames}]`);
    assert.ok(offeredDcNames.includes('Greedo'),
      `Living Greedo should still be offered. Offered: [${offeredDcNames}]`);
  });
});
