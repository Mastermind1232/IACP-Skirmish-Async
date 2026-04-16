/**
 * Tier A Legality-Oracle Probes: Power Token Timing in Combat (CRR Risk #2)
 *
 * Tests that conditions with combat effects (Hidden, Focus) are:
 *   1) Applied at the correct phase in the combat pipeline
 *   2) Consumed after combat resolution (not before, not retained)
 *
 * PROBE-TOKEN-001: Hidden on defender causes ranged miss via -2 accuracy penalty
 *   a) Defender Hidden + marginal accuracy → miss through handler pipeline
 *   b) Same combat WITHOUT Hidden → hit (paired positive control)
 *
 * PROBE-TOKEN-002: Focus consumed after combat resolution
 *   Attacker has Focus → after resolveCombatAfterRolls → Focus removed
 *
 * PROBE-TOKEN-003: Hidden consumed from BOTH attacker and defender after combat
 *   Both sides have Hidden → after resolution → both lose Hidden
 *
 * NOTE: Priority 3 (Condition Immunity) already has direct_oracle coverage via
 * ORACLE-HANDLER-003 (003a-003c) + ORACLE-HANDLER-004 in combat-handler-oracles.test.js.
 * Those drive the real handler pipeline (resolveCombatAfterRolls) with immune figures.
 * No new probes needed for that risk — the CRR heat map underestimated existing coverage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';

/** Build a minimal combat object for resolveCombatAfterRolls. */
function buildCombat(game, dcMessageMeta, opts) {
  const attackerPN = opts.attackerPlayerNum || 1;
  const defenderPN = attackerPN === 1 ? 2 : 1;

  let attackerMsgId, attackerMeta, defenderMsgId, defenderMeta;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId) continue;
    if (meta.playerNum === attackerPN && !attackerMsgId) { attackerMsgId = msgId; attackerMeta = meta; }
    if (meta.playerNum === defenderPN && !defenderMsgId) { defenderMsgId = msgId; defenderMeta = meta; }
  }

  const attackerFigKey = Object.keys(game.figurePositions[attackerPN])[0];
  const defenderFigKey = Object.keys(game.figurePositions[defenderPN])[0];

  return {
    gameId: game.gameId,
    attackerPlayerNum: attackerPN, defenderPlayerNum: defenderPN,
    attackerMsgId,
    attackerDcName: attackerMeta.dcName,
    defenderDcName: defenderMeta.dcName,
    attackerDisplayName: attackerMeta.dcName,
    attackerFigureIndex: 0,
    attackerFigureKey: attackerFigKey,
    attackerConds: opts.attackerConds || [],
    defenderConds: opts.defenderConds || [],
    target: {
      msgId: defenderMsgId,
      figureKey: defenderFigKey,
      label: defenderMeta.dcName,
    },
    targetStats: { defense: ['white'], cost: 5, figures: 1 },
    attackInfo: { dice: ['blue', 'green'], type: opts.isRanged ? 'range' : 'melee' },
    isRanged: opts.isRanged || false,
    distanceToTarget: opts.distanceToTarget || 1,
    combatThreadId: 'oracle-thread',
    combatDeclareMsgId: 'oracle-declare',
    combatPreMsgId: 'oracle-pre',
    attackRoll: opts.attackRoll,
    defenseRoll: opts.defenseRoll,
    surgeConditions: opts.surgeConditions || [],
    bonusConditions: [],
    surgeDamage: opts.surgeDamage || 0,
    surgePierce: opts.surgePierce || 0,
    surgeAccuracy: 0,
    bonusSurgeAbilities: [],
    bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0,
    bonusBlock: 0, bonusEvade: 0,
    p1Ready: true, p2Ready: true,
    attackTargetMsgId: 'oracle-target',
    ...(opts.extra || {}),
  };
}

// ── PROBE-TOKEN-001: Hidden on defender causes ranged miss via accuracy penalty ─

describe('PROBE-TOKEN-001: Hidden on defender causes ranged miss via -2 accuracy', () => {
  it('001a: acc 3 vs distance 2, defender Hidden → acc 1 < 2 → miss', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    let defenderMsgId;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 2) { defenderMsgId = msgId; break; }
    }
    const initialHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];

    const combat = buildCombat(game, dcMessageMeta, {
      // acc 3 normally hits distance 2, but Hidden -2 → acc 1 < 2 → miss
      attackRoll: { acc: 3, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      defenderConds: ['Hide'],
      isRanged: true,
      distanceToTarget: 2,
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const finalHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];
    assert.equal(finalHp, initialHp,
      `Hidden should cause miss (acc 3 - 2 = 1 < distance 2). HP should be unchanged: ${initialHp}`);

    // Defender's Hidden should be consumed after combat
    const defenderFigKey = combat.target.figureKey;
    const defenderConds = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(!defenderConds.includes('Hide'),
      `Defender's Hidden should be consumed after combat. Conditions: [${defenderConds}]`);
  });

  it('001b: same rolls WITHOUT Hidden → hit (paired control)', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    let defenderMsgId;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 2) { defenderMsgId = msgId; break; }
    }
    const initialHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];

    const combat = buildCombat(game, dcMessageMeta, {
      // Identical rolls, no Hidden → acc 3 >= 2 → hit → 5 damage
      attackRoll: { acc: 3, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      defenderConds: [],
      isRanged: true,
      distanceToTarget: 2,
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const finalHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];
    assert.equal(initialHp - finalHp, 5,
      `Without Hidden, acc 3 >= distance 2 → hit → 5 damage. HP: ${initialHp} → ${finalHp}`);
  });
});

// ── PROBE-TOKEN-002: Focus consumed after combat resolution ──────────────────

describe('PROBE-TOKEN-002: Focus consumed after combat resolution', () => {
  it('002: attacker Focus present before combat → removed after resolution', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];

    // Apply Focus to attacker BEFORE combat
    game.figureConditions = game.figureConditions || {};
    game.figureConditions[attackerFigKey] = game.figureConditions[attackerFigKey] || [];
    game.figureConditions[attackerFigKey].push('Focus');

    // Verify Focus is set
    assert.ok(game.figureConditions[attackerFigKey].includes('Focus'),
      'Pre-condition: attacker should have Focus');

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      attackerConds: ['Focus'],
      isRanged: false,
      distanceToTarget: 1,
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Focus should be consumed after combat resolution
    const postConds = game.figureConditions?.[attackerFigKey] || [];
    assert.ok(!postConds.includes('Focus'),
      `Focus should be consumed after combat. Attacker conditions: [${postConds}]`);
  });
});

// ── PROBE-TOKEN-003: Hidden consumed from both sides after combat ────────────

describe('PROBE-TOKEN-003: Hidden consumed from both attacker and defender after combat', () => {
  it('003: both sides Hidden → both lose Hidden after resolution', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    const defenderFigKey = Object.keys(game.figurePositions[2])[0];

    // Apply Hidden to both sides
    game.figureConditions = game.figureConditions || {};
    game.figureConditions[attackerFigKey] = ['Hide'];
    game.figureConditions[defenderFigKey] = ['Hide'];

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      attackerConds: ['Hide'],
      defenderConds: ['Hide'],
      isRanged: false, // melee — Hidden accuracy penalty doesn't cause miss
      distanceToTarget: 1,
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const atkConds = game.figureConditions?.[attackerFigKey] || [];
    const defConds = game.figureConditions?.[defenderFigKey] || [];

    assert.ok(!atkConds.includes('Hide'),
      `Attacker's Hidden should be consumed after resolving attack. Conditions: [${atkConds}]`);
    assert.ok(!defConds.includes('Hide'),
      `Defender's Hidden should be consumed after being targeted. Conditions: [${defConds}]`);
  });
});
