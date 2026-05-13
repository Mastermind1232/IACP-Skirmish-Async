/**
 * Phase-D behavioral probe — CRR-ATK-029.
 *
 * CRR: "A figure with a Deployment card can use only one of its actions to
 * attack per activation, including special actions that perform attacks
 * (Pounce, Brutality)."
 *
 * The existing feature-extraction test ("already attacked this activation → 0")
 * pins the block for the regular attack path. Free-attack bypass flags are
 * covered by free-attack-surfacing-probes.test.js. The missing clause is that
 * the Pounce / Brutality bypass is SINGLE-USE — after the special-action
 * attack resolves, the bypass flag is cleared, the normal gate re-engages,
 * and the budget is spent. In other words: Pounce/Brutality COUNT against
 * the one-attack-per-activation limit.
 *
 * The probes below simulate the post-special-action state (bypass-flag
 * cleared, attackPerformedThisActivation set, no Assault) and verify
 * getAvailableActions offers no further attack_target action.
 *
 * PROBE-ATK-029-A: Pounce bypass consumed → gate re-blocks
 * PROBE-ATK-029-B: Brutality/freeAttackBonus consumed → gate re-blocks
 * PROBE-ATK-029-C: Assault DCs are unaffected (sanity — Assault is the only
 *                  legitimate way to get 2 real attacks per activation)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

function getDcInfo(game, dcMessageMeta, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    if (dcName && meta.dcName !== dcName) continue;
    const figKey = Object.keys(game.figurePositions[playerNum] || {})
      .find((fk) => fk.startsWith(meta.dcName + '-'));
    return { msgId, meta, figKey };
  }
  return null;
}

function buildMidActivation(attackerDc, defenderDc) {
  const { game, deps, dcMessageMeta } = createTestGame()
    .withPlayer1Army([{ dcName: attackerDc }])
    .withPlayer2Army([{ dcName: defenderDc }])
    .inRound(1)
    .build();
  const dc = getDcInfo(game, dcMessageMeta, 1, attackerDc);
  const p2FigKey = Object.keys(game.figurePositions[2])[0];
  game.figurePositions[1][dc.figKey] = 'j10';
  game.figurePositions[2][p2FigKey] = 'j11';
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[dc.msgId] = { remaining: 1, total: 2, specialsUsed: [] };
  // attackPerformedThisActivation is keyed per-figureKey per IACP rule
  // (alexanbv 2026-05-13) — each figure in a multifigure group has its
  // own attack budget.
  game.attackPerformedThisActivation = { [dc.figKey]: true };
  return { game, deps, dc };
}

describe('PROBE-ATK-029-A: Pounce bypass is single-use — post-Pounce gate re-blocks', () => {
  it('pounceAttackPending=true → attack offered (bypass active)', () => {
    const { game, deps, dc } = buildMidActivation('Bossk', 'Greedo');
    game.pounceAttackPending = { [dc.msgId]: true };
    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.ok(attacks.length > 0,
      'Baseline: pounceAttackPending must bypass the already-attacked gate.');
  });

  it('pounceAttackPending cleared after resolution → attack blocked', () => {
    const { game, deps } = buildMidActivation('Bossk', 'Greedo');
    // State after the Pounce attack resolved: bypass flag consumed,
    // attackPerformedThisActivation still set, no Assault on Bossk.
    // (We never set pounceAttackPending — simulates post-consumption state.)
    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.equal(attacks.length, 0,
      'CRR-ATK-029: Pounce/Brutality count against the one-attack limit — post-special-action, no further attack.');
  });
});

describe('PROBE-ATK-029-B: Brutality / freeAttackBonusPending is single-use', () => {
  it('freeAttackBonusPending=true → attack offered (bypass active)', () => {
    const { game, deps, dc } = buildMidActivation('Bossk', 'Greedo');
    // figureKey-keyed per IACP rule 2026-05-09
    game.freeAttackBonusPending = { [dc.figKey]: true };
    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.ok(attacks.length > 0,
      'Baseline: freeAttackBonusPending (Brutality/Heroic/Rapid Fire) must bypass the gate.');
  });

  it('freeAttackBonusPending cleared after resolution → attack blocked', () => {
    const { game, deps } = buildMidActivation('Bossk', 'Greedo');
    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.equal(attacks.length, 0,
      'CRR-ATK-029: special-action attack consumes the attack budget — no follow-up without Assault.');
  });
});

describe('PROBE-ATK-029-C: Assault DC is the legitimate 2-attack path (sanity)', () => {
  it('Assault DC can still attack after the first attack — separate from special-action path', () => {
    // Baze Malbus has the Assault keyword per dc-effects.
    // If this assertion destabilises due to dataset changes, keep the
    // Bossk-based probes above and adapt this one.
    const { game, deps } = buildMidActivation('Baze Malbus', 'Greedo');
    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter((a) => a.type === 'attack_target');
    assert.ok(attacks.length > 0,
      'Sanity: Assault keyword bypasses the one-attack limit for normal attacks.');
  });
});
