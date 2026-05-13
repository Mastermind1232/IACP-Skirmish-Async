/**
 * Tier 3 Legality-Oracle Probes: Free-Attack / Bonus-Attack Surfacing (D1)
 *
 * The normal "already attacked this activation" gate blocks attack_target unless
 * a bypass flag is set. Five flags bypass: freeAttackBonusPending, pounceAttackPending,
 * fellSwoopFreeAttack, pummelTwoAttacksThisActivation, imperialRetrofittingMultiAttack.
 * Assault keyword is a separate bypass (already tested in AS-007 Batch 2).
 *
 * PROBE-FA-001: freeAttackBonusPending bypasses already-attacked gate
 *   a) Flag set → attack_target offered despite already attacked
 *   b) Flag absent + no Assault → attack blocked (paired negative)
 *
 * PROBE-FA-002: imperialRetrofittingMultiAttack bypasses already-attacked gate
 *   Flag set → attack_target offered despite already attacked
 *
 * PROBE-FA-003: fellSwoopFreeAttack bypasses already-attacked gate
 *   Flag set → attack_target offered despite already attacked
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

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

/**
 * Build a mid-activation game with attacker and target placed adjacent for guaranteed LOS.
 * Returns { game, deps, dc } where dc has the P1 DC's msgId and figKey.
 */
function buildAttackScenario(attackerDc, defenderDc) {
  const { game, deps, dcMessageMeta } = createTestGame()
    .withPlayer1Army([{ dcName: attackerDc }])
    .withPlayer2Army([{ dcName: defenderDc }])
    .inRound(1)
    .build();

  const dc = getDcInfo(game, dcMessageMeta, 1, attackerDc);
  const p2FigKey = Object.keys(game.figurePositions[2])[0];

  // Place adjacent for guaranteed range/LOS
  game.figurePositions[1][dc.figKey] = 'j10';
  game.figurePositions[2][p2FigKey] = 'j11';

  // Mid-activation: 1 action remaining, this figure already attacked
  // (figureKey-keyed per alexanbv 2026-05-13).
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[dc.msgId] = { remaining: 1, total: 2, specialsUsed: [] };
  game.attackPerformedThisActivation = { [dc.figKey]: true };

  return { game, deps, dc };
}

// ── PROBE-FA-001: freeAttackBonusPending ─────────────────────────────────

describe('PROBE-FA-001: freeAttackBonusPending bypasses already-attacked gate', () => {
  it('001a: flag set → attack_target offered despite already attacked', () => {
    const { game, deps, dc } = buildAttackScenario('Bossk', 'Greedo');

    // Set the free-attack flag (figureKey-keyed per IACP rule 2026-05-09)
    game.freeAttackBonusPending = { [dc.figKey]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter(a => a.type === 'attack_target');

    assert.ok(attacks.length > 0,
      `freeAttackBonusPending should bypass already-attacked gate. Got types: [${actions.map(a => a.type)}]`);
  });

  it('001b: flag absent + no Assault → attack blocked (paired negative)', () => {
    const { game, deps } = buildAttackScenario('Bossk', 'Greedo');

    // No free-attack flags, Bossk has no Assault
    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter(a => a.type === 'attack_target');

    assert.equal(attacks.length, 0,
      'No free-attack flag + no Assault → attack should be blocked');
  });
});

// ── PROBE-FA-002: imperialRetrofittingMultiAttack ────────────────────────

describe('PROBE-FA-002: imperialRetrofittingMultiAttack bypasses already-attacked gate', () => {
  it('002: flag set → attack_target offered despite already attacked', () => {
    const { game, deps, dc } = buildAttackScenario('Bossk', 'Greedo');

    // Set the Imperial Retrofitting multi-attack flag
    game.imperialRetrofittingMultiAttack = { [dc.msgId]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter(a => a.type === 'attack_target');

    assert.ok(attacks.length > 0,
      `imperialRetrofittingMultiAttack should bypass already-attacked gate. Got types: [${actions.map(a => a.type)}]`);
  });
});

// ── PROBE-FA-003: fellSwoopFreeAttack ────────────────────────────────────

describe('PROBE-FA-003: fellSwoopFreeAttack bypasses already-attacked gate', () => {
  it('003: flag set → attack_target offered despite already attacked', () => {
    const { game, deps, dc } = buildAttackScenario('Bossk', 'Greedo');

    // Set the Fell Swoop free-attack flag
    game.fellSwoopFreeAttack = { [dc.msgId]: true };

    const actions = getAvailableActions(game, 1, deps);
    const attacks = actions.filter(a => a.type === 'attack_target');

    assert.ok(attacks.length > 0,
      `fellSwoopFreeAttack should bypass already-attacked gate. Got types: [${actions.map(a => a.type)}]`);
  });
});
