/**
 * PROBE-ATK-MULTIFIG-001: per-figure 1-attack-per-activation budget.
 *
 * Per alexanbv 2026-05-13 + CRR per-figure independent activation:
 * each figure in a multi-figure group has its OWN 1-attack-per-activation
 * cap. Without Assault, figure[0] attacking does NOT prevent figure[1]
 * from attacking. The cap is keyed by figureKey, not by msgId
 * (group). Previously `game.attackPerformedThisActivation[msgId] = true`
 * shared the gate across all figures in the group — confirmed bug
 * reported by alexanbv 2026-05-13.
 *
 * Regression scope:
 *  - One figure attacking sets `attackPerformedThisActivation[<that fk>]`.
 *  - Sibling figures in the same group remain eligible to attack
 *    (their own figureKey entry is unset).
 *  - The flag is correctly enumerated via ACTIVATION_FIGKEY_FLAGS so
 *    `cleanupActivation` clears each figure's entry at activation end.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

function getDcInfo(game, dcMessageMeta, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    if (dcName && meta.dcName !== dcName) continue;
    return { msgId, meta };
  }
  return null;
}

describe('PROBE-ATK-MULTIFIG-001: per-figure attack budget in a multifigure group', () => {
  it('figure[0] attacked → figure[1] in same group can still attack (no Assault)', () => {
    // Alliance Ranger (Regular) is a 3-figure group with no Assault.
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Alliance Ranger (Regular)' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Alliance Ranger (Regular)');
    assert.ok(dc, 'Alliance Ranger (Regular) must be in P1 army');

    // Find both group-0 figures.
    const allFigKeys = Object.keys(game.figurePositions[1] || {});
    const groupFks = allFigKeys.filter((fk) => fk.startsWith('Alliance Ranger (Regular)-'));
    assert.ok(groupFks.length >= 2, `Need at least 2 figures in the group; found ${groupFks.length}`);
    const fig0 = groupFks[0];
    const fig1 = groupFks[1];

    // Place fig1 in range of the P2 target so its attack target is computable.
    const p2FigKey = Object.keys(game.figurePositions[2])[0];
    game.figurePositions[1][fig1] = 'j10';
    game.figurePositions[2][p2FigKey] = 'j11';

    // Mid-activation: dcActionsData is currently on figure 1 (selectedFigure=1)
    // with 1 action remaining. Figure 0 already attacked this activation.
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = {
      remaining: 1,
      total: 2,
      specialsUsed: [],
      selectedFigure: 1, // figure 1 is now active
    };
    game.attackPerformedThisActivation = { [fig0]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.ok(attacks.length > 0,
      `CRR per-figure budget: figure[1] in the same multifigure group must still be able to attack after figure[0]. Got types: [${actions.map((a) => a.type).join(', ')}]`);
  });

  it('figure[1] attacked → figure[1] blocked from second attack (no Assault, no free-attack)', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Alliance Ranger (Regular)' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Alliance Ranger (Regular)');
    const groupFks = Object.keys(game.figurePositions[1] || {})
      .filter((fk) => fk.startsWith('Alliance Ranger (Regular)-'));
    const fig1 = groupFks[1];
    const p2FigKey = Object.keys(game.figurePositions[2])[0];
    game.figurePositions[1][fig1] = 'j10';
    game.figurePositions[2][p2FigKey] = 'j11';

    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = {
      remaining: 1, total: 2, specialsUsed: [], selectedFigure: 1,
    };
    // THIS figure already attacked — gate should fire.
    game.attackPerformedThisActivation = { [fig1]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.equal(attacks.length, 0,
      'Per-figure budget: figure that already attacked is blocked from a second attack (no Assault, no free-attack).');
  });

  it('flag is keyed by figureKey, not msgId — gate does not fire when only msgId entry exists', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Alliance Ranger (Regular)' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Alliance Ranger (Regular)');
    const groupFks = Object.keys(game.figurePositions[1] || {})
      .filter((fk) => fk.startsWith('Alliance Ranger (Regular)-'));
    const fig0 = groupFks[0];
    const p2FigKey = Object.keys(game.figurePositions[2])[0];
    game.figurePositions[1][fig0] = 'j10';
    game.figurePositions[2][p2FigKey] = 'j11';

    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = {
      remaining: 1, total: 2, specialsUsed: [], selectedFigure: 0,
    };
    // Stale msgId entry from the pre-fix bug: should NOT block the
    // figure-0 attack (the gate reads figureKey, not msgId).
    game.attackPerformedThisActivation = { [dc.msgId]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.ok(attacks.length > 0,
      'Per-figure flag: stale msgId entry must NOT block any figure (regression guard for the pre-fix shared-gate bug).');
  });
});
