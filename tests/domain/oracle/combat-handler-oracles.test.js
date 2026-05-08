/**
 * Handler-level oracle tests for combat resolution.
 *
 * These oracles exercise the REAL handler pipeline — not just computeCombatResult,
 * but the full path through resolveCombatAfterRolls → applyDamageAndFinishCombat.
 * They prove rules that live in the handler/bridge layer, which pure-function
 * oracles cannot reach.
 *
 * Infrastructure: Option 1 — deps override.
 * Roll functions are never called (combat objects have predetermined rolls).
 * The key insight is that resolveCombatAfterRolls receives a fully-formed combat
 * object with attackRoll/defenseRoll already set — it never re-rolls dice.
 * So we don't need to intercept roll functions at all; we just construct the
 * combat object with the rolls we want and call resolveCombatAfterRolls directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { createHarness } from '../../../src/headless/game-harness.js';
import { buildHeadlessDeps } from '../../../src/headless/headless-deps.js';

/**
 * Build a minimal pendingCombat object suitable for resolveCombatAfterRolls.
 *
 * @param {object} game - The game state
 * @param {Map} dcMessageMeta - DC message metadata
 * @param {object} opts - Combat configuration
 * @param {object} opts.attackRoll - { acc, dmg, surge }
 * @param {object} opts.defenseRoll - { block, evade, dodge }
 * @param {number} [opts.attackerPlayerNum=1]
 * @param {string[]} [opts.surgeConditions] - Conditions from surges (e.g. ['Stun'])
 * @param {number} [opts.surgeDamage=0]
 * @param {number} [opts.surgePierce=0]
 * @param {boolean} [opts.isRanged=false]
 * @param {number} [opts.distanceToTarget=1]
 * @returns {object} combat object
 */
function buildCombat(game, dcMessageMeta, opts) {
  const attackerPN = opts.attackerPlayerNum || 1;
  const defenderPN = attackerPN === 1 ? 2 : 1;

  // Find attacker and defender msgIds/meta from dcMessageMeta
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

  // Derive figure keys from positions
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
    defenderConds: opts.defenderConds || [],
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
    bonusConditions: opts.bonusConditions || [],
    surgeDamage: opts.surgeDamage || 0,
    surgePierce: opts.surgePierce || 0,
    surgeAccuracy: 0,
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

// ── ORACLE-HANDLER-001: G22 Condition Gating — Negative Path ───────────────
//
// Rule: Surge conditions (Stun, Bleed, Weaken) apply ONLY when final damage > 0.
//       When damage = 0, conditions must NOT be applied to the defender.
// Implementation: src/engine/combat-bridge.js:402-405
//   The outer `if (damage > 0 && targetMsgId)` block at line 390 +
//   defense-in-depth inner `if (damage > 0)` at line 405.
// Why handler-level: computeCombatResult always includes conditions in resultText.
//   The G22 gate lives in applyDamageAndFinishCombat, outside the pure function.

describe('ORACLE-HANDLER-001: G22 Condition Gating — Negative Path', () => {
  it('001a: zero damage blocks Stun application', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      // 1 dmg vs 2 block = 0 final damage
      attackRoll: { acc: 3, dmg: 1, surge: 1 },
      defenseRoll: { block: 2, evade: 0, dodge: 0 },
      surgeConditions: ['Stun'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // G22: damage was 0, so Stun must NOT be applied
    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      !conditions.includes('Stun'),
      `G22 violation: Stun was applied despite 0 damage. Conditions: [${conditions}]`
    );
  });

  it('001b: zero damage blocks Bleed application', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      // 2 dmg vs 3 block = 0 final damage
      attackRoll: { acc: 4, dmg: 2, surge: 1 },
      defenseRoll: { block: 3, evade: 0, dodge: 0 },
      surgeConditions: ['Bleed'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      !conditions.includes('Bleed'),
      `G22 violation: Bleed was applied despite 0 damage. Conditions: [${conditions}]`
    );
  });

  it('001c: zero damage blocks multiple conditions simultaneously', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 3, dmg: 1, surge: 2 },
      defenseRoll: { block: 2, evade: 0, dodge: 0 },
      surgeConditions: ['Stun', 'Bleed'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      !conditions.includes('Stun') && !conditions.includes('Bleed'),
      `G22 violation: Conditions applied despite 0 damage. Conditions: [${conditions}]`
    );
  });
});

// ── ORACLE-HANDLER-002: G22 Condition Gating — Positive Path ───────────────
//
// Rule: When final damage > 0, surge conditions ARE applied to the defender.
// This is the companion to 001 — proves conditions flow through when they should.

describe('ORACLE-HANDLER-002: G22 Condition Gating — Positive Path', () => {
  it('002a: positive damage applies Stun', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      // 3 dmg vs 1 block = 2 final damage
      attackRoll: { acc: 4, dmg: 3, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Stun'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      conditions.includes('Stun'),
      `G22 positive path: Stun should be applied when damage > 0. Conditions: [${conditions}]`
    );
  });

  it('002b: positive damage applies Bleed', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      // 4 dmg + 1 surge dmg vs 2 block = 3 final damage
      attackRoll: { acc: 5, dmg: 4, surge: 1 },
      defenseRoll: { block: 2, evade: 0, dodge: 0 },
      surgeConditions: ['Bleed'],
      surgeDamage: 1,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      conditions.includes('Bleed'),
      `G22 positive path: Bleed should be applied when damage > 0. Conditions: [${conditions}]`
    );
  });

  it('002c: damage = 1 (edge case) still applies conditions', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      // 2 dmg vs 1 block = 1 final damage (boundary case)
      attackRoll: { acc: 3, dmg: 2, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Weaken'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      conditions.includes('Weaken'),
      `G22 positive path: Weaken should apply at damage = 1 boundary. Conditions: [${conditions}]`
    );
  });
});

// ── ORACLE-HANDLER-003: Condition Immunity ─────────────────────────────────
//
// Rule: Figures with condition immunity cannot gain HARMFUL conditions
//       (Stun, Bleed, Weaken) even when damage > 0. Damage itself still applies.
// Implementation: src/engine/combat-bridge.js:407-413
//   `isConditionImmune(game, combat.target.figureKey)` filters HARMFUL_CONDITIONS.
// Units with immunity: Snowtrooper (Elite) — immune_snowtrooper_elite
//                      Onar Koma — immune_onar

describe('ORACLE-HANDLER-003: Condition Immunity', () => {
  it('003a: immune defender blocks Stun despite positive damage', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .withPlayer2Army([{ dcName: 'Snowtrooper (Elite)' }])
      .inRound(1)
      .build();

    // Find defender's initial HP for damage verification
    let defenderMsgId;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 2) {
        defenderMsgId = msgId;
        break;
      }
    }
    const initialHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];

    const combat = buildCombat(game, dcMessageMeta, {
      // 4 dmg vs 1 block = 3 final damage — conditions should still be blocked
      attackRoll: { acc: 5, dmg: 4, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Stun'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Condition immunity: Stun must NOT be applied
    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      !conditions.includes('Stun'),
      `Condition Immunity violation: Stun applied to immune figure. Conditions: [${conditions}]`
    );

    // Damage must still be applied (immunity blocks conditions, not damage)
    const finalHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];
    assert.ok(
      finalHp < initialHp,
      `Damage should still apply to immune figure. HP: ${initialHp} → ${finalHp}`
    );
  });

  it('003b: immune defender blocks multiple harmful conditions', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .withPlayer2Army([{ dcName: 'Snowtrooper (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 4, surge: 2 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Stun', 'Bleed'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      !conditions.includes('Stun') && !conditions.includes('Bleed'),
      `Condition Immunity: all harmful conditions should be blocked. Conditions: [${conditions}]`
    );
  });

  it('003c: non-immune defender DOES receive conditions (control test)', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 4, surge: 1 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Stun'],
      surgeDamage: 0,
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      conditions.includes('Stun'),
      `Control: non-immune figure should receive Stun. Conditions: [${conditions}]`
    );
  });
});

// ── ORACLE-HANDLER-004: Fireproof (I30) ────────────────────────────────────
//
// Rule: Flame Trooper figures cannot gain Bleed, even when damage > 0.
//       Other harmful conditions (Stun, Weaken) still apply normally.
// Implementation: src/engine/combat-bridge.js:416-419
//   `if (allConditions.includes('Bleed') && combat.defenderFireproof)`
// Distinct from condition immunity — Fireproof only blocks Bleed, not all harmful.

describe('ORACLE-HANDLER-004: Fireproof (I30)', () => {
  it('004a: Fireproof blocks Bleed but allows Stun', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      // 4 dmg vs 1 block = 3 final damage
      attackRoll: { acc: 5, dmg: 4, surge: 2 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Stun', 'Bleed'],
      surgeDamage: 0,
      extra: { defenderFireproof: true },
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      !conditions.includes('Bleed'),
      `Fireproof violation: Bleed applied to Fireproof figure. Conditions: [${conditions}]`
    );
    assert.ok(
      conditions.includes('Stun'),
      `Fireproof should not block Stun. Conditions: [${conditions}]`
    );
  });

  it('004b: control — non-Fireproof figure receives both Stun and Bleed', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 4, surge: 2 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      surgeConditions: ['Stun', 'Bleed'],
      surgeDamage: 0,
      // No defenderFireproof
    });

    const defenderFigKey = combat.target.figureKey;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const conditions = game.figureConditions?.[defenderFigKey] || [];
    assert.ok(
      conditions.includes('Stun') && conditions.includes('Bleed'),
      `Control: non-Fireproof figure should receive both. Conditions: [${conditions}]`
    );
  });
});

// ── ORACLE-HANDLER-007: M22 Migs Return Fire — 0-Damage Hit ──────────────────
//
// Rule distinction:
//   Han Solo's Return Fire: triggers ONLY on 0-damage hits (attack resolved with no damage).
//   Migs Mayfeld's Return Fire: triggers on ANY resolved attack, regardless of damage outcome.
// Implementation: src/engine/combat-bridge.js:2540-2570
//   Han gate (line 2546-2551): if damage > 0, _rfCanFire = false (blocked).
//   Migs: skips the gate entirely (_rfDefIds lacks 'return_fire'), so _rfCanFire stays true.
//   Sets freeAttackBonusPending + forcedAttackTarget + roundFigureAbilityUsed.
// Why handler-level: Return Fire logic lives in the post-combat handler pipeline,
//   outside computeCombatResult. Only resolveCombatAfterRolls exercises it.

describe('ORACLE-HANDLER-007: M22 Migs Return Fire — 0-Damage Hit', () => {
  it('007a: Migs Return Fire triggers on fully-blocked hit (0 damage)', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Migs Mayfeld' }])
      .inRound(1)
      .build();

    // Find defender (Migs) msgId and figure key
    let migsMsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 2) {
        migsMsgId = msgId;
        break;
      }
    }
    assert.ok(migsMsgId, 'Migs msgId found');

    const combat = buildCombat(game, dcMessageMeta, {
      // 2 dmg vs 3 block = 0 final damage (fully blocked, NOT a miss)
      attackRoll: { acc: 3, dmg: 2, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: 0 },
      isRanged: false,
      distanceToTarget: 1,
    });

    const migsFigKey = combat.target.figureKey;
    const attackerFigKey = combat.attackerFigureKey;

    // Verify initial HP (Migs should not take damage)
    const initialHp = dcHealthState.get(migsMsgId)?.[0]?.[0];
    assert.ok(initialHp > 0, `Migs initial HP is positive: ${initialHp}`);

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Witness 1: 0-damage hit — HP unchanged
    const finalHp = dcHealthState.get(migsMsgId)?.[0]?.[0];
    assert.strictEqual(finalHp, initialHp,
      `M22: 0-damage hit means Migs HP unchanged. Got: ${initialHp} → ${finalHp}`);

    // Witness 2: Return Fire triggered — freeAttackBonusPending set
    assert.strictEqual(game.freeAttackBonusPending?.[migsMsgId], true,
      'M22: Migs Return Fire must set freeAttackBonusPending despite 0 damage');

    // Witness 3: forcedAttackTarget points to the attacker
    assert.strictEqual(game.forcedAttackTarget?.[migsMsgId], attackerFigKey,
      'M22: Migs Return Fire must target the attacker');

    // Witness 4: once-per-round gate set
    const rfKey = `returnFire_${migsFigKey}`;
    assert.strictEqual(game.roundFigureAbilityUsed?.[rfKey], true,
      'M22: Migs Return Fire once-per-round key must be set');
  });

  it('007b: control — Han Solo Return Fire gated on 0 damage (positive damage blocks it)', async () => {
    // Han fires ONLY on 0-damage hits. Positive damage blocks his Return Fire.
    // This is the gate that Migs' version lacks — proving the distinction.
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Han Solo' }])
      .inRound(1)
      .build();

    let hanMsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 2) {
        hanMsgId = msgId;
        break;
      }
    }

    const combat = buildCombat(game, dcMessageMeta, {
      // 4 dmg vs 1 block = 3 final damage — Han takes damage
      attackRoll: { acc: 3, dmg: 4, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: 0 },
      isRanged: false,
      distanceToTarget: 1,
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Han's Return Fire requires 0 damage — positive damage blocks it
    assert.notStrictEqual(game.freeAttackBonusPending?.[hanMsgId], true,
      'Control: Han Return Fire is gated on 0 damage — positive damage must block it');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REROLL ORACLE INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a game + harness with pendingCombat already in reroll phase.
 *
 * Returns everything needed to submit reroll actions via harness.submitAction().
 * The deps bag has rollSingleAttackDie/rollSingleDefenseDie overridden with
 * fixture functions so reroll results are deterministic.
 *
 * @param {object} opts
 * @param {object[]} opts.attackDice - Individual attack die faces, e.g. [{ color: 'blue', acc: 3, dmg: 2, surge: 1 }]
 * @param {object[]} opts.defenseDice - Individual defense die faces, e.g. [{ color: 'black', block: 2, evade: 0, dodge: 0 }]
 * @param {string} [opts.rerollPhase='attacker'] - 'attacker' or 'defender'
 * @param {number} [opts.attackerRerolls=1] - Rerolls remaining for attacker
 * @param {number} [opts.defenderRerolls=0] - Rerolls remaining for defender
 * @param {Function} [opts.rollSingleAttackDie] - Fixture for attack die reroll result
 * @param {Function} [opts.rollSingleDefenseDie] - Fixture for defense die reroll result
 */
function buildMidCombatGame(opts) {
  const { game, deps: rawDeps, dcMessageMeta, dcExhaustedState, dcHealthState } = createTestGame()
    .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
    .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
    .inRound(1)
    .build();

  // Find attacker/defender metadata
  let attackerMsgId, attackerMeta, defenderMsgId, defenderMeta;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId) continue;
    if (meta.playerNum === 1 && !attackerMsgId) { attackerMsgId = msgId; attackerMeta = meta; }
    if (meta.playerNum === 2 && !defenderMsgId) { defenderMsgId = msgId; defenderMeta = meta; }
  }

  const attackerFigKey = Object.keys(game.figurePositions[1])[0];
  const defenderFigKey = Object.keys(game.figurePositions[2])[0];

  // Compute initial totals from provided dice arrays
  const atkTotals = opts.attackDice.reduce(
    (t, d) => ({ acc: t.acc + (d.acc ?? 0), dmg: t.dmg + (d.dmg ?? 0), surge: t.surge + (d.surge ?? 0) }),
    { acc: 0, dmg: 0, surge: 0 }
  );
  const defTotals = opts.defenseDice.reduce(
    (t, d) => ({ block: t.block + (d.block ?? 0), evade: t.evade + (d.evade ?? 0), dodge: t.dodge || !!d.dodge }),
    { block: 0, evade: 0, dodge: 0 }
  );

  // Construct pendingCombat in mid-reroll state
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
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
    targetStats: { defense: ['black'], cost: 5, figures: 1 },
    attackInfo: { dice: opts.attackDice.map(d => d.color), type: 'melee' },
    isRanged: false,
    distanceToTarget: 1,
    combatThreadId: 'oracle-reroll-thread',
    combatDeclareMsgId: 'oracle-declare-msg',
    combatPreMsgId: 'oracle-pre-msg',
    attackTargetMsgId: 'oracle-target-msg',

    // Dice results (individual faces + totals)
    attackDiceResults: opts.attackDice.map(d => ({ ...d })),
    defenseDiceResults: opts.defenseDice.map(d => ({ ...d })),
    attackRoll: { ...atkTotals },
    defenseRoll: { ...defTotals },
    defenseDiceCount: opts.defenseDice.length,

    // Reroll state
    rerollPhase: opts.rerollPhase || 'attacker',
    attackerRerollsRemaining: opts.attackerRerolls ?? 1,
    defenderRerollsRemaining: opts.defenderRerolls ?? 0,
    attackerRerolledIndices: [],
    defenderRerolledIndices: [],

    // Fields the handler reads but doesn't need to be non-default for our tests
    surgeConditions: [],
    bonusConditions: [],
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
    bonusSurgeAbilities: [],
    bonusHits: 0,
    bonusPierce: 0,
    bonusAccuracy: 0,
    bonusBlock: 0,
    bonusEvade: 0,
    p1Ready: true,
    p2Ready: true,
  };

  // Build fresh deps with roll fixture overrides
  const deps = buildHeadlessDeps({ dcMessageMeta, dcExhaustedState, dcHealthState });
  if (opts.rollSingleAttackDie) deps.rollSingleAttackDie = opts.rollSingleAttackDie;
  if (opts.rollSingleDefenseDie) deps.rollSingleDefenseDie = opts.rollSingleDefenseDie;

  const harness = createHarness(game, { deps, dcMessageMeta, dcExhaustedState, dcHealthState });

  return { game: harness.getGame(), harness, deps, dcMessageMeta, dcHealthState };
}

// ── ORACLE-HANDLER-005: Reroll Total Recalculation ─────────────────────────
//
// Rule: After rerolling a die, combat totals must exactly reflect the new
//       dice array — replaced die is the fixture, unchanged dice are preserved,
//       totals are the sum of all current dice faces.
// Implementation: handlers/combat.js:3249-3253 (attack), 3303-3307 (defense)
//   rollSingleAttackDie(color) → replace in array → recalcAttackTotals(dice)

describe('ORACLE-HANDLER-005: Reroll Total Recalculation', () => {
  it('005a: attack die reroll updates totals correctly', async () => {
    const die0 = { color: 'blue', acc: 3, dmg: 2, surge: 1 };
    const die1 = { color: 'green', acc: 1, dmg: 1, surge: 1 };
    const fixtureDie = { color: 'blue', acc: 5, dmg: 1, surge: 0 };
    const defDie = { color: 'black', block: 1, evade: 0, dodge: 0 };

    const { game, harness } = buildMidCombatGame({
      attackDice: [die0, die1],
      defenseDice: [defDie],
      rerollPhase: 'attacker',
      attackerRerolls: 1,
      rollSingleAttackDie: (color) => ({ ...fixtureDie }),
    });

    const gameId = game.gameId;
    await harness.submitAction(`combat_reroll_${gameId}_atk_0`, 'player1');

    const combat = game.pendingCombat;

    // Replaced die is exactly the fixture
    assert.equal(combat.attackDiceResults[0].acc, fixtureDie.acc);
    assert.equal(combat.attackDiceResults[0].dmg, fixtureDie.dmg);
    assert.equal(combat.attackDiceResults[0].surge, fixtureDie.surge);

    // Unchanged die preserved
    assert.equal(combat.attackDiceResults[1].acc, die1.acc);
    assert.equal(combat.attackDiceResults[1].dmg, die1.dmg);
    assert.equal(combat.attackDiceResults[1].surge, die1.surge);

    // Totals are exact sum of current dice array
    assert.equal(combat.attackRoll.acc, fixtureDie.acc + die1.acc);   // 5 + 1 = 6
    assert.equal(combat.attackRoll.dmg, fixtureDie.dmg + die1.dmg);   // 1 + 1 = 2
    assert.equal(combat.attackRoll.surge, fixtureDie.surge + die1.surge); // 0 + 1 = 1
  });

  it('005b: defense die reroll updates totals correctly', async () => {
    const atkDie = { color: 'blue', acc: 3, dmg: 2, surge: 1 };
    const defDie0 = { color: 'black', block: 2, evade: 1, dodge: 0 };
    const fixtureDefDie = { color: 'black', block: 0, evade: 0, dodge: 1 };

    const { game, harness } = buildMidCombatGame({
      attackDice: [atkDie],
      defenseDice: [defDie0],
      rerollPhase: 'defender',
      attackerRerolls: 0,
      defenderRerolls: 1,
      rollSingleDefenseDie: (color) => ({ ...fixtureDefDie }),
    });

    const gameId = game.gameId;
    await harness.submitAction(`combat_reroll_${gameId}_def_0`, 'player2');

    const combat = game.pendingCombat;

    // Replaced die is exactly the fixture
    assert.equal(combat.defenseDiceResults[0].block, fixtureDefDie.block);
    assert.equal(combat.defenseDiceResults[0].evade, fixtureDefDie.evade);
    assert.equal(combat.defenseDiceResults[0].dodge, fixtureDefDie.dodge);

    // Totals reflect the single (replaced) die
    assert.equal(combat.defenseRoll.block, fixtureDefDie.block);   // 0
    assert.equal(combat.defenseRoll.evade, fixtureDefDie.evade);   // 0
    assert.equal(combat.defenseRoll.dodge, fixtureDefDie.dodge);   // true
  });

  it('005c: G12 — second reroll on same die index rejected', async () => {
    const die0 = { color: 'blue', acc: 3, dmg: 2, surge: 1 };
    const die1 = { color: 'green', acc: 1, dmg: 1, surge: 1 };
    const fixtureDie = { color: 'blue', acc: 5, dmg: 1, surge: 0 };
    const defDie = { color: 'black', block: 1, evade: 0, dodge: 0 };

    const { game, harness } = buildMidCombatGame({
      attackDice: [die0, die1],
      defenseDice: [defDie],
      rerollPhase: 'attacker',
      attackerRerolls: 2,  // 2 rerolls available
      rollSingleAttackDie: (color) => ({ ...fixtureDie }),
    });

    const gameId = game.gameId;

    // First reroll on die 0 — should succeed
    await harness.submitAction(`combat_reroll_${gameId}_atk_0`, 'player1');
    const afterFirst = game.pendingCombat;
    assert.deepEqual(afterFirst.attackerRerolledIndices, [0]);

    // Snapshot state after first reroll
    const diceSnapshot = afterFirst.attackDiceResults.map(d => ({ ...d }));
    const rollSnapshot = { ...afterFirst.attackRoll };
    const rerolledSnapshot = [...afterFirst.attackerRerolledIndices];

    // Second reroll on same die 0 — must be rejected (G12)
    await harness.submitAction(`combat_reroll_${gameId}_atk_0`, 'player1');

    // No mutation: dice, totals, and rerolled indices unchanged
    assert.deepEqual(game.pendingCombat.attackDiceResults.map(d => ({ color: d.color, acc: d.acc, dmg: d.dmg, surge: d.surge })),
      diceSnapshot.map(d => ({ color: d.color, acc: d.acc, dmg: d.dmg, surge: d.surge })));
    assert.deepEqual(game.pendingCombat.attackRoll, rollSnapshot);
    assert.deepEqual(game.pendingCombat.attackerRerolledIndices, rerolledSnapshot);
  });
});

// ── ORACLE-HANDLER-006: Reroll Phase Enforcement ───────────────────────────
//
// Rule: During attacker reroll phase, defense-side rerolls are rejected.
//       During attacker reroll phase, the defender userId is rejected.
//       In both cases, no combat state is mutated.
// Implementation: handlers/combat.js:3142-3159
//   Phase validation (line 3146-3150) and permission check (line 3152-3159).

describe('ORACLE-HANDLER-006: Reroll Phase Enforcement', () => {
  it('006a: defense-side reroll rejected during attacker phase', async () => {
    const atkDie = { color: 'blue', acc: 3, dmg: 2, surge: 1 };
    const defDie = { color: 'black', block: 2, evade: 0, dodge: 0 };

    const { game, harness } = buildMidCombatGame({
      attackDice: [atkDie],
      defenseDice: [defDie],
      rerollPhase: 'attacker',
      attackerRerolls: 1,
      defenderRerolls: 1,
    });

    // Snapshot all combat state before rejected action
    const combat = game.pendingCombat;
    const phaseSnap = combat.rerollPhase;
    const atkDiceSnap = combat.attackDiceResults.map(d => ({ ...d }));
    const defDiceSnap = combat.defenseDiceResults.map(d => ({ ...d }));
    const atkRollSnap = { ...combat.attackRoll };
    const defRollSnap = { ...combat.defenseRoll };
    const atkRerolledSnap = [...combat.attackerRerolledIndices];
    const defRerolledSnap = [...combat.defenderRerolledIndices];

    // Attempt defense-side reroll during attacker phase (wrong side)
    await harness.submitAction(`combat_reroll_${game.gameId}_def_0`, 'player1');

    // No mutation
    assert.equal(combat.rerollPhase, phaseSnap, 'rerollPhase unchanged');
    assert.deepEqual(combat.attackDiceResults.map(d => ({ ...d })), atkDiceSnap, 'attackDiceResults unchanged');
    assert.deepEqual(combat.defenseDiceResults.map(d => ({ ...d })), defDiceSnap, 'defenseDiceResults unchanged');
    assert.deepEqual(combat.attackRoll, atkRollSnap, 'attackRoll unchanged');
    assert.deepEqual(combat.defenseRoll, defRollSnap, 'defenseRoll unchanged');
    assert.deepEqual(combat.attackerRerolledIndices, atkRerolledSnap, 'attackerRerolledIndices unchanged');
    assert.deepEqual(combat.defenderRerolledIndices, defRerolledSnap, 'defenderRerolledIndices unchanged');
  });

  it('006b: wrong player rejected during attacker phase', async () => {
    const atkDie = { color: 'blue', acc: 3, dmg: 2, surge: 1 };
    const defDie = { color: 'black', block: 2, evade: 0, dodge: 0 };

    const { game, harness } = buildMidCombatGame({
      attackDice: [atkDie],
      defenseDice: [defDie],
      rerollPhase: 'attacker',
      attackerRerolls: 1,
    });

    // Snapshot
    const combat = game.pendingCombat;
    const phaseSnap = combat.rerollPhase;
    const atkDiceSnap = combat.attackDiceResults.map(d => ({ ...d }));
    const defDiceSnap = combat.defenseDiceResults.map(d => ({ ...d }));
    const atkRollSnap = { ...combat.attackRoll };
    const defRollSnap = { ...combat.defenseRoll };
    const atkRerolledSnap = [...combat.attackerRerolledIndices];
    const defRerolledSnap = [...combat.defenderRerolledIndices];

    // Correct side (atk) but wrong player (player2 is the defender)
    await harness.submitAction(`combat_reroll_${game.gameId}_atk_0`, 'player2');

    // No mutation
    assert.equal(combat.rerollPhase, phaseSnap, 'rerollPhase unchanged');
    assert.deepEqual(combat.attackDiceResults.map(d => ({ ...d })), atkDiceSnap, 'attackDiceResults unchanged');
    assert.deepEqual(combat.defenseDiceResults.map(d => ({ ...d })), defDiceSnap, 'defenseDiceResults unchanged');
    assert.deepEqual(combat.attackRoll, atkRollSnap, 'attackRoll unchanged');
    assert.deepEqual(combat.defenseRoll, defRollSnap, 'defenseRoll unchanged');
    assert.deepEqual(combat.attackerRerolledIndices, atkRerolledSnap, 'attackerRerolledIndices unchanged');
    assert.deepEqual(combat.defenderRerolledIndices, defRerolledSnap, 'defenderRerolledIndices unchanged');
  });
});
