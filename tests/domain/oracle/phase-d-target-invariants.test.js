/**
 * Phase-D structural invariants for attack target enumeration.
 *
 * PROBE-PD-ATK-009: No friendly figure appears in attack_target list.
 *   CRR-ATK-009: "Players cannot target friendly figures with attacks."
 *
 * PROBE-PD-ATK-031: Every attack_target references a figureKey (no empty-space
 *   targets). CRR-ATK-031: "A figure cannot target an empty space with an attack."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

function findP1DcMsgId(game, dcMessageMeta, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== 1) continue;
    if (meta.dcName === dcName) return msgId;
  }
  return null;
}

describe('PROBE-PD-ATK-009: attack_target enumeration excludes friendly figures', () => {
  it('009: P1 attacker offered only P2 figures as targets (no P1 figureKeys)', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }, { dcName: 'Greedo' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    // Place both P1 figures adjacent to each other and to P2's Vader so
    // the target enumeration would include the friendly if the filter failed.
    const p1Keys = Object.keys(game.figurePositions[1]);
    const p2Keys = Object.keys(game.figurePositions[2]);
    game.figurePositions[1] = { [p1Keys[0]]: 'b1', [p1Keys[1]]: 'a1' };
    game.figurePositions[2] = { [p2Keys[0]]: 'c1' };

    // Put Bossk mid-activation so attack_target surfaces
    const msgId = findP1DcMsgId(game, dcMessageMeta, 'Bossk');
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgId] = { remaining: 2, total: 2, specialsUsed: [] };

    const actions = getAvailableActions(game, 1, deps);
    const attackActions = actions.filter(a => a.type === 'attack_target');

    assert.ok(attackActions.length > 0, 'at least one attack_target action surfaced');

    const p1KeySet = new Set(Object.keys(game.figurePositions[1]));
    for (const a of attackActions) {
      const tfk = a.params?.targetFigureKey;
      assert.ok(tfk, `attack_target missing targetFigureKey: ${a.customId}`);
      assert.ok(!p1KeySet.has(tfk),
        `attack_target references friendly figure ${tfk} — CRR-ATK-009 violation`);
    }
  });
});

describe('PROBE-PD-ATK-031: every attack_target names a concrete figure (no empty-space targets)', () => {
  it('031: every surfaced attack_target carries a targetFigureKey', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Darth Vader' }])
      .inRound(1)
      .build();

    const p1Keys = Object.keys(game.figurePositions[1]);
    const p2Keys = Object.keys(game.figurePositions[2]);
    game.figurePositions[1] = { [p1Keys[0]]: 'b1' };
    game.figurePositions[2] = { [p2Keys[0]]: 'c1', [p2Keys[1]]: 'd1' };

    const msgId = findP1DcMsgId(game, dcMessageMeta, 'Bossk');
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgId] = { remaining: 2, total: 2, specialsUsed: [] };

    const actions = getAvailableActions(game, 1, deps);
    const attackActions = actions.filter(a => a.type === 'attack_target');

    assert.ok(attackActions.length > 0, 'at least one attack_target action surfaced');

    const p2KeySet = new Set(Object.keys(game.figurePositions[2]));
    for (const a of attackActions) {
      const tfk = a.params?.targetFigureKey;
      assert.ok(tfk, `attack_target missing targetFigureKey: ${a.customId}`);
      assert.ok(p2KeySet.has(tfk),
        `attack_target targetFigureKey ${tfk} does not map to any current figure — empty-space target`);
    }
  });
});
