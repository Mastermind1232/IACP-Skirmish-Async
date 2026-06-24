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
    // (figureKey-keyed per IACP rule 2026-05-09)
    assert.strictEqual(game.freeAttackBonusPending?.[migsFigKey], true,
      'M22: Migs Return Fire must set freeAttackBonusPending despite 0 damage');

    // Witness 3: forcedAttackTarget points to the attacker.
    // Per alexanbv 2026-05-13: keyed by Migs's figureKey (the figure
    // that received the free-attack grant).
    assert.strictEqual(game.forcedAttackTarget?.[migsFigKey], attackerFigKey,
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

    const hanFigKey = combat.target.figureKey;
    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Han's Return Fire requires 0 damage — positive damage blocks it
    // (figureKey-keyed per IACP rule 2026-05-09)
    assert.notStrictEqual(game.freeAttackBonusPending?.[hanFigKey], true,
      'Control: Han Return Fire is gated on 0 damage — positive damage must block it');
  });
});
