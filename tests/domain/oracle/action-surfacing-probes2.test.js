/**
 * Tier 3 Legality-Oracle Probes: Action Surfacing Batch 2 (D1)
 *
 * PROBE-AS-005: activationExtraActionThenStun blocks move_figure
 * PROBE-AS-006: massiveMovementLocked blocks move_figure
 * PROBE-AS-007: Assault keyword (Baze Malbus) allows second attack after attackPerformedThisActivation
 * PROBE-AS-008: CC Double Action requires data.remaining >= 2
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';
import { getDcStats } from '../../../src/data-loader.js';

/** Find DC info from dcMessageMeta by player number and DC name. */
function getDcInfo(game, dcMessageMeta, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    if (dcName && meta.dcName !== dcName) continue;
    const figKey = Object.keys(game.figurePositions[playerNum] || {})
      .find(fk => fk.startsWith(meta.dcName + '-'));
    return { msgId, meta, figKey };
  }
  return null;
}

// ── PROBE-AS-005: activationExtraActionThenStun blocks move ───────────────

describe('PROBE-AS-005: activationExtraActionThenStun blocks move_figure', () => {
  it('005: DC with activationExtraActionThenStun flag → move_figure NOT offered', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');
    assert.ok(dc, 'Should find Bossk DC');

    // Mid-activation with extra-action-then-stun flag set.
    // Per alexanbv 2026-05-13: keyed by figureKey.
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { remaining: 1, total: 2, specialsUsed: [] };
    game.activationExtraActionThenStun = { [dc.figKey]: true };

    const actions = getAvailableActions(game, 1, deps);
    const moveActions = actions.filter(a => a.type === 'move_figure');

    assert.equal(moveActions.length, 0,
      `move_figure should be blocked by activationExtraActionThenStun. Got types: [${actions.map(a => a.type)}]`);

    // Attack and end_activation should still be available
    const endActions = actions.filter(a => a.type === 'dc_end_activation');
    assert.ok(endActions.length > 0, 'end_activation should still be available');
  });
});

// ── PROBE-AS-006: massiveMovementLocked blocks move ──────────────────────

describe('PROBE-AS-006: massiveMovementLocked blocks move_figure', () => {
  it('006: DC figure with massiveMovementLocked flag → move_figure NOT offered', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');
    assert.ok(dc, 'Should find Bossk DC');
    assert.ok(dc.figKey, 'Bossk should have a figure on board');

    // Mid-activation with massiveMovementLocked set for this figure
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { remaining: 2, total: 2, specialsUsed: [] };
    game.massiveMovementLocked = { [dc.figKey]: true };

    const actions = getAvailableActions(game, 1, deps);
    const moveActions = actions.filter(a => a.type === 'move_figure');

    assert.equal(moveActions.length, 0,
      `move_figure should be blocked by massiveMovementLocked. Got types: [${actions.map(a => a.type)}]`);
  });
});

// ── PROBE-AS-007: Assault keyword allows multiple attacks ────────────────

describe('PROBE-AS-007: Assault keyword allows attack after attackPerformedThisActivation', () => {
  it('007: Baze Malbus (Assault) can attack again after first attack', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Baze Malbus' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Baze Malbus');
    assert.ok(dc, 'Should find Baze Malbus DC');

    // Mid-activation: 1 action remaining, already attacked this activation
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { remaining: 1, total: 2, specialsUsed: [] };
    game.attackPerformedThisActivation = { [dc.msgId]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attackActions = actions.filter(a => a.type === 'attack_target');

    // Baze has Assault — attack should be available (if targets exist in range)
    // Even if no targets are found (depends on map positions), the attack should NOT be
    // blocked by the already-attacked gate. We verify by checking that the code path
    // doesn't set attackBlocked=true.
    // With the builder's random deployment, targets may or may not be in range.
    // The key assertion: if we compare to a non-Assault DC with the same setup, attacks ARE blocked.
    // We test the non-Assault case as the control.
    const { game: game2, deps: deps2, dcMessageMeta: dcMeta2 } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc2 = getDcInfo(game2, dcMeta2, 1, 'Bossk');
    game2.dcActionsData = game2.dcActionsData || {};
    game2.dcActionsData[dc2.msgId] = { remaining: 1, total: 2, specialsUsed: [] };
    game2.attackPerformedThisActivation = { [dc2.msgId]: true };

    const actions2 = getAvailableActions(game2, 1, deps2);
    const attackActions2 = actions2.filter(a => a.type === 'attack_target');

    assert.equal(attackActions2.length, 0,
      `Bossk (no Assault) should have 0 attack_target after already attacking. Got: ${attackActions2.length}`);

    // For Baze, attacks may or may not show depending on range/LOS.
    // The definitive test: attack is NOT blocked (attackBlocked=false for Assault DCs).
    // We verify this indirectly: if there were valid targets, attacks would show.
    // To be explicit, let's also verify no move/attack blocker text mentions Assault.
    // The structural guarantee is: actions list for Baze does NOT filter out attacks due to the gate.
    // We can also verify by placing Greedo adjacent for guaranteed range.

    // Re-build with close placement for guaranteed LOS
    const { game: game3, deps: deps3, dcMessageMeta: dcMeta3 } = createTestGame()
      .withPlayer1Army([{ dcName: 'Baze Malbus' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc3 = getDcInfo(game3, dcMeta3, 1, 'Baze Malbus');
    const p2FigKey = Object.keys(game3.figurePositions[2])[0];
    const p1FigKey = dc3.figKey;

    // Place Baze and Greedo adjacent for guaranteed range/LOS
    game3.figurePositions[1][p1FigKey] = 'j10';
    game3.figurePositions[2][p2FigKey] = 'j11';

    game3.dcActionsData = game3.dcActionsData || {};
    game3.dcActionsData[dc3.msgId] = { remaining: 1, total: 2, specialsUsed: [] };
    game3.attackPerformedThisActivation = { [dc3.msgId]: true };

    const actions3 = getAvailableActions(game3, 1, deps3);
    const attackActions3 = actions3.filter(a => a.type === 'attack_target');

    assert.ok(attackActions3.length > 0,
      `Baze Malbus (Assault) should still have attack_target after already attacking. Got: [${actions3.map(a => a.type)}]`);
  });
});

// ── PROBE-AS-008: CC Double Action requires remaining >= 2 ───────────────

describe('PROBE-AS-008: CC Double Action requires data.remaining >= 2', () => {
  it('008a: remaining = 2 → play_cc_double offered (if cards exist)', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');

    // Mid-activation with 2 remaining
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { remaining: 2, total: 2, specialsUsed: [] };

    // Mock the CC double action dep to return a card
    const depsWithCcDouble = {
      ...deps,
      getPlayableCcDoubleActionsForDc: () => ['Test Double Action Card'],
    };

    const actions = getAvailableActions(game, 1, depsWithCcDouble);
    const ccDoubles = actions.filter(a => a.type === 'play_cc_double');

    assert.ok(ccDoubles.length > 0,
      `play_cc_double should be offered with remaining=2. Got types: [${actions.map(a => a.type)}]`);
  });

  it('008b: remaining = 1 → play_cc_double NOT offered (needs 2)', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');

    // Mid-activation with only 1 remaining
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { remaining: 1, total: 2, specialsUsed: [] };

    const depsWithCcDouble = {
      ...deps,
      getPlayableCcDoubleActionsForDc: () => ['Test Double Action Card'],
    };

    const actions = getAvailableActions(game, 1, depsWithCcDouble);
    const ccDoubles = actions.filter(a => a.type === 'play_cc_double');

    assert.equal(ccDoubles.length, 0,
      `play_cc_double should NOT be offered with remaining=1. Got types: [${actions.map(a => a.type)}]`);
  });
});
