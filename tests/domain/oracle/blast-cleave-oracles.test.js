/**
 * Handler-level oracle tests for Blast & Cleave step 8 timing (Wave 3).
 *
 * Finding 1: Blast silently fails when the target is defeated (position removed
 *            before adjacency check).
 * Finding 2: Cleave eligibility uses target adjacency instead of attacker
 *            eligibility; objects (crates) excluded.
 * Finding 3: NPC target path (crates) bypasses Blast/Cleave entirely;
 *            figure-target Blast ignores adjacent objects.
 *
 * Test coordinates on mos-eisley-outskirts:
 *   A=b1 (attacker), B=c1 (target, adj A), D=a1 (adj A, NOT adj B), E=d1 (adj B, NOT adj A)
 * Ranged test on mos-eisley-outskirts:
 *   A=a1, B=d1 (3 spaces from A), F=a3 (2 spaces from A, NOT adj B)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { computeCleaveEligibleTargets } from '../../../src/engine/combat-bridge.js';

// 2026-05-09 cleave migration: cleave is queued for the step-8 attacker
// post-resolve window (one entry per source). The headless drain fires
// fireCleave (which sets pendingCleave) and immediately advances to
// combat-close, which clears pendingCleave. So tests probe two things:
//   - combat._step8Snapshot.attacker captured pre-drain proves cleave
//     was enqueued as a button-firing effect.
//   - computeCleaveEligibleTargets is called directly to assert the
//     eligible-target set the picker would have offered.
function _hasCleaveEnqueued(combat) {
  const snap = combat?._step8Snapshot?.attacker;
  if (!Array.isArray(snap)) return false;
  return snap.some((e) => e.type === 'cleave');
}
function _cleaveEligibleKeys(game, combat, defenderPN, deps) {
  return computeCleaveEligibleTargets(game, combat, defenderPN, {
    getFiguresAdjacentToCoord: deps.getFiguresAdjacentToCoord,
    getMapData: deps.getMapData,
    getEffectiveMapSpaces: deps.getEffectiveMapSpaces,
    isWithinN: deps.isWithinN,
    hasFigureLineOfSight: deps.hasFigureLineOfSight,
    getFigureFootprint: deps.getFigureFootprint,
    getFigureSize: deps.getFigureSize,
    getFigureLabel: deps.getFigureLabel,
    getDcEffect: deps.getDcEffect,
    getLoadoutCards: deps.getLoadoutCards,
  }).map((t) => t.figureKey);
}

/**
 * Build a minimal pendingCombat object.
 * Same pattern as combat-handler-oracles.test.js buildCombat.
 */
function buildCombat(game, dcMessageMeta, opts) {
  const attackerPN = opts.attackerPlayerNum || 1;
  const defenderPN = attackerPN === 1 ? 2 : 1;

  let attackerMsgId, attackerMeta, defenderMsgId, defenderMeta;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId) continue;
    if (meta.playerNum === attackerPN && !attackerMsgId) {
      attackerMsgId = msgId;
      attackerMeta = meta;
    }
    if (meta.playerNum === defenderPN && !defenderMsgId) {
      defenderMsgId = msgId;
      defenderMeta = meta;
    }
  }

  const defenderFigKey = Object.keys(game.figurePositions[defenderPN])[0];
  const attackerFigKey = Object.keys(game.figurePositions[attackerPN])[0];

  return {
    gameId: game.gameId,
    attackerPlayerNum: attackerPN,
    defenderPlayerNum: defenderPN,
    attackerMsgId,
    attackerDcName: attackerMeta.dcName,
    defenderDcName: defenderMeta.dcName,
    attackerDisplayName: attackerMeta.displayName || attackerMeta.dcName,
    attackerFigureIndex: 0,
    attackerFigureKey: attackerFigKey,
    attackerConds: [],
    defenderConds: [],
    target: {
      msgId: defenderMsgId,
      figureKey: defenderFigKey,
      label: defenderMeta.displayName || defenderMeta.dcName,
    },
    targetStats: {
      defense: ['black'],
      cost: 5,
      figures: 1,
    },
    attackInfo: { dice: ['blue', 'green'], type: opts.isRanged ? 'range' : 'melee' },
    isRanged: opts.isRanged || false,
    distanceToTarget: opts.distanceToTarget || 1,
    combatThreadId: 'oracle-combat-thread',
    combatDeclareMsgId: 'oracle-declare-msg',
    combatPreMsgId: 'oracle-pre-msg',
    attackRoll: opts.attackRoll,
    defenseRoll: opts.defenseRoll,
    surgeConditions: opts.surgeConditions || [],
    bonusConditions: [],
    surgeDamage: opts.surgeDamage || 0,
    surgePierce: opts.surgePierce || 0,
    surgeAccuracy: opts.surgeAccuracy || 0,
    bonusSurgeAbilities: [],
    bonusHits: 0,
    bonusPierce: 0,
    bonusAccuracy: 0,
    bonusBlock: 0,
    bonusEvade: 0,
    p1Ready: true,
    p2Ready: true,
    attackTargetMsgId: 'oracle-target-msg',
    ...(opts.extra || {}),
  };
}

/**
 * Get info for the Nth (0-based) P2 DC in dcMessageMeta.
 */
function getP2DcInfo(game, dcMessageMeta, dcHealthState, index) {
  let count = 0;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== 2) continue;
    if (count === index) {
      const figKey = Object.entries(game.figurePositions[2])
        .find(([fk]) => fk.startsWith(meta.dcName))?.[0];
      return { msgId, meta, figKey, hp: () => dcHealthState.get(msgId)?.[0]?.[0] };
    }
    count++;
  }
  return null;
}

// ── ORACLE-HANDLER-008: Blast on Defeated Target (Finding 1) ──────────────
//
// Rule: Blast (RULES_REFERENCE.md Lines 655-656): "If the target of an attack
//       that has the Blast keyword suffers one or more damage, each figure and
//       object other than the target on or adjacent to the target space suffers
//       damage equal to the Blast value."
//       A killed target has suffered damage. Blast must still apply.
// Bug:  removeFigurePosition (L878) deletes target position before Blast
//       adjacency check (L1208). getFiguresAdjacentToTarget returns [] when
//       position is missing.

describe('ORACLE-HANDLER-008: Blast on Defeated Target', () => {
  it('008a: Blast fires when target is killed', async () => {
    // P1: attacker at b1, P2: target (Greedo 7hp) at c1, bystander (Gideon 5hp) at d1
    // d1 is adjacent to c1 (target) but NOT adjacent to b1 (attacker)
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Gideon Argus' }])
      .inRound(1)
      .build();

    // Place figures at controlled positions
    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 1);
    game.figurePositions[2] = {
      [target.figKey]: 'c1',    // adjacent to attacker (b1)
      [bystander.figKey]: 'd1', // adjacent to target (c1), NOT to attacker (b1)
    };

    // Set target HP to 1 so attack kills it
    dcHealthState.get(target.msgId)[0] = [1, 7];
    const bystanderHpBefore = bystander.hp();

    const combat = buildCombat(game, dcMessageMeta, {
      // 3 dmg vs 1 block = 2 damage → kills target (1 HP)
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: { surgeBlast: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Target should be defeated (position removed)
    assert.strictEqual(
      game.figurePositions[2][target.figKey],
      undefined,
      'Target should be defeated and removed from figurePositions'
    );

    // Bystander should have taken 2 Blast damage
    const bystanderHpAfter = bystander.hp();
    assert.strictEqual(
      bystanderHpAfter,
      bystanderHpBefore - 2,
      `Blast should deal 2 damage to adjacent bystander even when target killed. ` +
      `HP: ${bystanderHpBefore} → ${bystanderHpAfter} (expected ${bystanderHpBefore - 2})`
    );
  });

  it('008b: Blast fires when target survives (control)', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Gideon Argus' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 1);
    game.figurePositions[2] = {
      [target.figKey]: 'c1',
      [bystander.figKey]: 'd1',
    };

    // Target keeps full HP (7) — survives the attack
    const bystanderHpBefore = bystander.hp();

    const combat = buildCombat(game, dcMessageMeta, {
      // 3 dmg vs 1 block = 2 damage → target survives (7 HP)
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: { surgeBlast: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Target should survive
    assert.ok(
      game.figurePositions[2][target.figKey],
      'Target should survive (control test)'
    );

    // Bystander should have taken 2 Blast damage
    const bystanderHpAfter = bystander.hp();
    assert.strictEqual(
      bystanderHpAfter,
      bystanderHpBefore - 2,
      `Blast should deal 2 damage to adjacent bystander. ` +
      `HP: ${bystanderHpBefore} → ${bystanderHpAfter} (expected ${bystanderHpBefore - 2})`
    );
  });
});

// ── ORACLE-HANDLER-009: Cleave Eligibility (Finding 2) ────────────────────
//
// Rule: Cleave (RULES_REFERENCE.md Lines 859-865): "the attacker may choose
//       a different hostile figure or object that they could target for this
//       attack." For melee: adjacent to the ATTACKER (not the target).
//       For ranged (Lines 871-873): within LOS and Accuracy of ATTACKER.
// Bug:  Code uses getFiguresAdjacentToTarget (adjacent to target, L1832),
//       not adjacent to attacker. Also excludes objects.

describe('ORACLE-HANDLER-009: Cleave Eligibility', () => {
  it('009a: melee Cleave offers figure adjacent to attacker, not adjacent to target', async () => {
    // A=b1 (attacker), B=c1 (target, adj A), D=a1 (adj A, NOT adj B)
    // Current code: D not offered (not adjacent to target c1)
    // Fixed code: D offered (adjacent to attacker b1)
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Gideon Argus' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 1);
    game.figurePositions[2] = {
      [target.figKey]: 'c1',    // adjacent to attacker (b1)
      [bystander.figKey]: 'a1', // adjacent to attacker (b1), NOT adjacent to target (c1)
    };

    const combat = buildCombat(game, dcMessageMeta, {
      // 3 dmg vs 0 block = 3 damage → target survives (7 HP)
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      extra: { surgeCleave: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    assert.ok(_hasCleaveEnqueued(combat), 'Cleave should be enqueued for the step-8 attacker window');
    const cleaveTargetKeys = _cleaveEligibleKeys(game, combat, 2, deps);
    assert.ok(
      cleaveTargetKeys.includes(bystander.figKey),
      `Cleave should offer figure adjacent to ATTACKER (${bystander.figKey}). ` +
      `Offered: [${cleaveTargetKeys}]`
    );
  });

  it('009b: ranged Cleave offers figure within Accuracy of attacker', async () => {
    // A=a1 (attacker), B=d1 (target, 3 spaces from A), F=a3 (2 spaces from A, NOT adj B)
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Gideon Argus' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'a1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 1);
    game.figurePositions[2] = {
      [target.figKey]: 'd1',    // 3 spaces from attacker
      [bystander.figKey]: 'a3', // 2 spaces from attacker, NOT adjacent to target
    };

    const combat = buildCombat(game, dcMessageMeta, {
      // Ranged attack, acc=5, 3 dmg vs 0 block = 3 damage
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 3,
      extra: { surgeCleave: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    assert.ok(_hasCleaveEnqueued(combat), 'Ranged Cleave should be enqueued');
    const cleaveTargetKeys = _cleaveEligibleKeys(game, combat, 2, deps);
    assert.ok(
      cleaveTargetKeys.includes(bystander.figKey),
      `Ranged Cleave should offer figure within Accuracy of ATTACKER (${bystander.figKey}). ` +
      `Offered: [${cleaveTargetKeys}]`
    );
  });

  it('009c: Cleave works when target is killed', async () => {
    // Attacker at b1, target at c1, bystander at a1 (adj to attacker).
    // Target killed — current code fails (target position removed, adjacency returns []).
    // Fixed code: uses attacker adjacency, so bystander still found.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Gideon Argus' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 1);
    game.figurePositions[2] = {
      [target.figKey]: 'c1',
      [bystander.figKey]: 'a1', // adjacent to attacker (b1)
    };

    // Set target HP to 1 so attack kills it
    dcHealthState.get(target.msgId)[0] = [1, 7];

    const combat = buildCombat(game, dcMessageMeta, {
      // 3 dmg vs 0 block = 3 damage → kills target (1 HP)
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      extra: { surgeCleave: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    assert.ok(_hasCleaveEnqueued(combat), 'Cleave should still enqueue even when target is killed');
    const cleaveTargetKeys = _cleaveEligibleKeys(game, combat, 2, deps);
    assert.ok(
      cleaveTargetKeys.includes(bystander.figKey),
      `Cleave should offer bystander even when target killed. Offered: [${cleaveTargetKeys}]`
    );
  });

  it('009d: Cleave offers eligible crate as target', async () => {
    // Slice 4 (alexanbv 2026-05-10): Cleave-eligibility enumerates
    // targetable damageable objects from game.objectMeta.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    game.figurePositions[2] = { [target.figKey]: 'c1' };

    // Place a crate at a1 (adjacent to attacker b1) — new unified state.
    game.cratePositions = { a1: 'a1' };
    game.objectHealth = { 'crate-a1': [5, 5] };
    game.objectPositions = { 'crate-a1': 'a1' };
    game.objectMeta = {
      'crate-a1': {
        name: 'Crate @ A1', targetable: true, defenseBlock: 1, defenseEvade: 0,
        splashOnDefeat: { amount: 2, radius: 1, target: 'all' },
        vpOnDefeat: null, moves: true,
      },
    };

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      extra: { surgeCleave: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    assert.ok(_hasCleaveEnqueued(combat), 'Cleave should be enqueued');
    const cleaveTargetKeys = _cleaveEligibleKeys(game, combat, 2, deps);
    const hasCrate = cleaveTargetKeys.some(k => k.includes('crate') || k.includes('a1'));
    assert.ok(
      hasCrate,
      `Cleave should offer adjacent crate as target. Offered: [${cleaveTargetKeys}]`
    );
  });
});

// ── ORACLE-HANDLER-010: NPC Target Blast / Object Blast (Finding 3) ───────
//
// Rule: Blast affects "each figure and object other than the target on or
//       adjacent to the target space" — this applies even when the TARGET
//       is an object (crate). Also, Blast from a figure-target attack should
//       damage adjacent objects.
// Bug:  NPC target path (L296-324) returns before Blast code (L1207).
//       Figure-target Blast only iterates figurePositions, ignoring crates.

describe('ORACLE-HANDLER-010: NPC Target Blast / Object Blast', () => {
  it('010a: Blast hits adjacent figure when targeting crate', async () => {
    // Attacker targets crate at c1, P2 figure (bystander) at d1 (adjacent to crate).
    // Current code: NPC path returns before Blast → bystander takes 0 damage.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    game.figurePositions[2] = { [bystander.figKey]: 'd1' }; // adjacent to crate at c1

    // Place crate at c1 (adjacent to attacker b1, adjacent to bystander d1)
    game.cratePositions = { c1: 'c1' };
    game.crateHealth = { c1: 5 };

    const bystanderHpBefore = bystander.hp();

    // Build NPC-target combat manually
    let attackerMsgId, attackerMeta;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 1) {
        attackerMsgId = msgId;
        attackerMeta = meta;
        break;
      }
    }

    const combat = {
      gameId: game.gameId,
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      attackerMsgId,
      attackerDcName: attackerMeta.dcName,
      defenderDcName: 'Crate',
      attackerDisplayName: attackerMeta.displayName || attackerMeta.dcName,
      attackerFigureIndex: 0,
      attackerFigureKey: attackerFigKey,
      attackerConds: [],
      defenderConds: [],
      target: {
        figureKey: 'npc_crate_c1',
        label: 'Crate @ C1 (5/5 HP)',
        isNpc: true,
        npcType: 'crate',
        crateOrigCoord: 'c1',
      },
      targetStats: { defense: [], cost: 0, figures: 1 },
      attackInfo: { dice: ['blue', 'green'], type: 'melee' },
      isRanged: false,
      distanceToTarget: 1,
      combatThreadId: 'oracle-combat-thread',
      combatDeclareMsgId: 'oracle-declare-msg',
      combatPreMsgId: 'oracle-pre-msg',
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      surgeConditions: [],
      bonusConditions: [],
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
      surgeBlast: 2,
      bonusSurgeAbilities: [],
      bonusHits: 0,
      bonusPierce: 0,
      bonusAccuracy: 0,
      bonusBlock: 0,
      bonusEvade: 0,
      p1Ready: true,
      p2Ready: true,
      attackTargetMsgId: 'oracle-target-msg',
    };

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Bystander adjacent to crate should take 2 Blast damage
    const bystanderHpAfter = bystander.hp();
    assert.strictEqual(
      bystanderHpAfter,
      bystanderHpBefore - 2,
      `Blast should hit adjacent figure when targeting crate. ` +
      `HP: ${bystanderHpBefore} → ${bystanderHpAfter} (expected ${bystanderHpBefore - 2})`
    );
  });

  it('010b: Blast hits adjacent crate when targeting figure (via unified object-damage pipeline)', async () => {
    // Slice 3 (alexanbv 2026-05-10): crate HP now lives in
    // game.objectHealth[objectId] via the unified pipeline. Blast still
    // routes through fireBlast (step 8), which iterates damageable
    // objects within 1 of target and routes through applyDamageToObject.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };

    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    game.figurePositions[2] = { [target.figKey]: 'c1' };

    // Register a damageable crate at d1 in the new pipeline state.
    game.cratePositions = { d1: 'd1' };
    game.objectHealth = { 'crate-d1': [5, 5] };
    game.objectPositions = { 'crate-d1': 'd1' };
    game.objectMeta = {
      'crate-d1': {
        name: 'Crate @ D1', targetable: true, defenseBlock: 1, defenseEvade: 0,
        splashOnDefeat: { amount: 2, radius: 1, target: 'all' },
        vpOnDefeat: null, moves: true,
      },
    };

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      extra: { surgeBlast: 2 },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Crate should take 2 Blast damage: 5 - 2 = 3 (now in objectHealth).
    assert.strictEqual(
      game.objectHealth['crate-d1']?.[0],
      3,
      `Blast should damage adjacent crate. objectHealth: ${game.objectHealth['crate-d1']?.[0]} (expected 3)`
    );
  });
});

// ── ORACLE-SEP: damage step / after_resolve gate separation ───────────────────
// alexanbv 2026-06-15 "proceed with the separation". The gate-sequence rebuild
// splits the bundled resolve into a DAMAGE step (dodge + range/acc → damage
// pipeline + defeat interrupts) and a separate after_resolve GATE step (Blast /
// Cleave / Return Fire). With combat._seqActive set, applyDamageAndFinishCombat
// applies the main-target damage but DEFERS the after-attack window, stashing
// the crossing locals on combat._afterResolveArgs. This test drives the REAL
// resolve both ways and asserts the damage core is identical and the after-attack
// effect (Blast) is cleanly deferred — i.e. the separation changes nothing about
// the numbers, only WHEN the after-attack window runs.
describe('ORACLE-SEP: damage / after_resolve separation (_seqActive)', () => {
  function setup() {
    const built = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Gideon Argus' }])
      .inRound(1)
      .build();
    const { game, dcMessageMeta, dcHealthState } = built;
    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    game.figurePositions[1] = { [attackerFigKey]: 'b1' };
    const target = getP2DcInfo(game, dcMessageMeta, dcHealthState, 0);
    const bystander = getP2DcInfo(game, dcMessageMeta, dcHealthState, 1);
    game.figurePositions[2] = { [target.figKey]: 'c1', [bystander.figKey]: 'd1' };
    // Target survives (full HP, takes 2) so both target damage and Blast are
    // observable. 3 dmg − 1 block = 2 to target; surgeBlast 2 to the adjacent
    // bystander (d1 is adjacent to c1, not to attacker b1).
    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 3, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: { surgeBlast: 2 },
    });
    return { ...built, target, bystander, combat };
  }

  it('legacy applies main-target damage + Blast bundled; _seqActive applies identical damage and DEFERS Blast', async () => {
    // Run A — legacy bundled path (no _seqActive).
    const A = setup();
    const aTargetBefore = A.target.hp();
    const aBystanderBefore = A.bystander.hp();
    await A.deps.resolveCombatAfterRolls(A.game, A.combat, A.deps.client);
    const aTargetAfter = A.target.hp();
    const aBystanderAfter = A.bystander.hp();
    assert.strictEqual(aTargetAfter, aTargetBefore - 2, 'legacy: target took 2 damage');
    assert.strictEqual(aBystanderAfter, aBystanderBefore - 2, 'legacy: bystander took 2 Blast (bundled)');
    assert.ok(!A.combat._afterResolveArgs, 'legacy: after_resolve NOT deferred (ran inline)');

    // Run B — separation path (_seqActive): identical damage core, Blast deferred.
    const B = setup();
    const bBystanderBefore = B.bystander.hp();
    B.combat._seqActive = true;
    await B.deps.resolveCombatAfterRolls(B.game, B.combat, B.deps.client);
    // Damage core: main-target damage matches the legacy run exactly.
    assert.strictEqual(B.target.hp(), aTargetAfter, 'separation: main-target damage identical to legacy');
    // The DAMAGE STEP MUST NOT FINISH COMBAT (alexanbv): the after-attack window
    // is deferred — Blast has NOT fired in the damage step.
    assert.strictEqual(B.bystander.hp(), bBystanderBefore, 'separation: Blast deferred — bystander untouched after the damage step');
    // Crossing locals stashed for the after_resolve gate, serializable (Set→array).
    assert.ok(B.combat._afterResolveArgs, 'separation: after_resolve args stashed for the gate');
    assert.ok(Array.isArray(B.combat._afterResolveArgs.embedRefreshMsgIds), 'separation: embedRefreshMsgIds serialized to an array (survives game save)');
    assert.strictEqual(B.combat._afterResolveArgs.defenderPlayerNum, 2, 'separation: stashed defenderPlayerNum is correct');

    // Now run the after_resolve GATE (what the sequence driver does after the
    // damage step): the bound window auto-drains under the fake client, firing
    // the attacker's after-attack effects (Blast) — identical net result to the
    // legacy bundled run. This proves the gate, not just the deferral.
    const thr = await B.deps.client.channels.fetch(B.combat.combatThreadId);
    const a = B.combat._afterResolveArgs;
    await B.deps.runAfterResolveWindow(thr, B.game, B.combat, {
      resultText: a.resultText,
      embedRefreshMsgIds: new Set(a.embedRefreshMsgIds),
      ownerId: a.ownerId,
      defenderPlayerNum: a.defenderPlayerNum,
    }, B.deps.client);
    assert.strictEqual(B.bystander.hp(), aBystanderAfter, 'separation: after_resolve gate fires Blast to the SAME net result as legacy');
  });
});
