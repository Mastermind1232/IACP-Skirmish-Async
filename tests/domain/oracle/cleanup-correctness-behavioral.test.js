/**
 * BEHAVIORAL oracle tests for Cleanup Correctness Phase 1.
 *
 * These tests pin the results of the cross-reference audit that found 38 transient
 * handler fields missing from cleanup arrays. Each test verifies that a specific
 * dangerous field is present in the correct cleanup list and is actually cleaned
 * by the corresponding cleanup function.
 *
 * Test categories:
 *   B-CLEANUP-001: executorTriggered in ROUND_OBJECT_FLAGS → reset to {}
 *   B-CLEANUP-002: Combat pipeline pendings in ROUND_NULL_FLAGS → reset to null
 *   B-CLEANUP-003: Movement/activation pendings in ROUND_NULL_FLAGS → reset to null
 *   B-CLEANUP-004: lastAttack* stale tracking in ROUND_DELETE_FLAGS → deleted
 *   B-CLEANUP-005: iKnowEverythingResolved gate in ROUND_DELETE_FLAGS → deleted
 *   B-CLEANUP-006: drivenByHatredAttackPenalty in ROUND_OBJECT_FLAGS (prior audit fix)
 *   B-CLEANUP-007: pendingCombat must NOT be in any cleanup list (recovery.js contract)
 *   B-CLEANUP-008: slowOnTheDrawInterrupt in ROUND_NULL_FLAGS (interrupt chain residue)
 *   B-CLEANUP-009: Compound moveInProgress keys cleaned per-activation
 *   B-CLEANUP-010: No activation-scoped flag leaks into next activation (integration)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupActivation,
  cleanupRoundStart,
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../../src/game/activation-state.js';

// Helper: all round cleanup lists combined
const ALL_ROUND_FLAGS = new Set([
  ...ROUND_OBJECT_FLAGS, ...ROUND_NULL_FLAGS, ...ROUND_ARRAY_FLAGS,
  ...ROUND_FALSE_FLAGS, ...ROUND_DELETE_FLAGS,
]);

// Helper: all activation cleanup lists combined
const ALL_ACTIVATION_FLAGS = new Set([
  ...ACTIVATION_MSGID_FLAGS, ...ACTIVATION_FIGKEY_FLAGS,
  ...ACTIVATION_PLAYERNUM_FLAGS, ...ACTIVATION_SCALAR_FLAGS,
]);

// ── B-CLEANUP-001: executorTriggered ───────────────────────────────────────

describe('B-CLEANUP-001: executorTriggered round cleanup', () => {
  it('001a: executorTriggered is in ROUND_OBJECT_FLAGS', () => {
    assert.ok(ROUND_OBJECT_FLAGS.includes('executorTriggered'),
      'executorTriggered must be in ROUND_OBJECT_FLAGS');
  });

  it('001b: cleanupRoundStart resets executorTriggered to {}', () => {
    const game = { executorTriggered: { '3001': true, '3002': true } };
    cleanupRoundStart(game);
    assert.deepStrictEqual(game.executorTriggered, {},
      'executorTriggered reset to {} — stale Executor state cannot leak into next round');
  });
});

// ── B-CLEANUP-002: Combat pipeline pendings ─────────────────────────────────

describe('B-CLEANUP-002: Combat pipeline pendings in ROUND_NULL_FLAGS', () => {
  const COMBAT_PENDINGS = [
    'pendingCelebration', 'pendingCleave', 'pendingFightingKnife',
    'pendingConcussiveBolt', 'pendingSpreadThePain', 'pendingSpreadThePainCondPick',
    'pendingReaction', 'pendingBoltslinger', 'pendingIndiscriminateFire',
    'pendingHeavyFire', 'pendingHavocShot', 'pendingDeflect',
    'pendingWantonDestruction', 'pendingFigurehead', 'pendingRogueOneTokenPick',
    'pendingZilloDiscard', 'pendingStrikeMeDown', 'pendingSlowOnTheDraw',
    'pendingForceExhaustion',
  ];

  for (const flag of COMBAT_PENDINGS) {
    it(`002: ${flag} is in ROUND_NULL_FLAGS`, () => {
      assert.ok(ROUND_NULL_FLAGS.includes(flag),
        `${flag} must be in ROUND_NULL_FLAGS — combat pending safety net`);
    });
  }

  it('002-fn: cleanupRoundStart nulls all combat pendings', () => {
    const game = {};
    for (const flag of COMBAT_PENDINGS) {
      game[flag] = { someStaleData: true };
    }
    cleanupRoundStart(game);
    for (const flag of COMBAT_PENDINGS) {
      assert.strictEqual(game[flag], null,
        `${flag} must be null after round cleanup — stale pending cannot block next round`);
    }
  });
});

// ── B-CLEANUP-003: Movement/activation pendings ─────────────────────────────

describe('B-CLEANUP-003: Movement/activation pendings in ROUND_NULL_FLAGS', () => {
  // Single-pending scalar fields (one pending object per game).
  // pendingEe3Carbine moved out 2026-05-05 — it's actually msgId-keyed
  // (game.pendingEe3Carbine[msgId] = ...) and belongs in ROUND_OBJECT_FLAGS.
  // pendingOrderedMove RETIRED 2026-05-09 — migrated to pendingMoveX
  // (single move pipeline). Kept out of MOVEMENT_PENDINGS so the
  // cleanup test no longer asserts it.
  const MOVEMENT_PENDINGS = [
    'pendingFalseOrders', 'pendingShoulderRush',
    'pendingDioFollow', 'pendingRightBackAtYa',
    'pendingBattlefieldLeadership', 'pendingScavengedWeaponryTransfer',
    'pendingHeroicEffortReturn',
  ];

  for (const flag of MOVEMENT_PENDINGS) {
    it(`003: ${flag} is in ROUND_NULL_FLAGS`, () => {
      assert.ok(ROUND_NULL_FLAGS.includes(flag),
        `${flag} must be in ROUND_NULL_FLAGS — movement pending safety net`);
    });
  }

  it('003-fn: cleanupRoundStart nulls all movement pendings', () => {
    const game = {};
    for (const flag of MOVEMENT_PENDINGS) {
      game[flag] = { playerNum: 1, spaces: ['a3'] };
    }
    cleanupRoundStart(game);
    for (const flag of MOVEMENT_PENDINGS) {
      assert.strictEqual(game[flag], null,
        `${flag} must be null after round cleanup`);
    }
  });

  // pendingEe3Carbine + voraciousUsed — msgId-keyed objects, in ROUND_OBJECT_FLAGS.
  // (pendingVoracious removed 2026-05-07 when Voracious migrated to the SoA
  // orchestrator — replaced by voraciousUsed which tracks once-per-round usage.)
  it('003b: pendingEe3Carbine + voraciousUsed are in ROUND_OBJECT_FLAGS (msgId-keyed)', async () => {
    const { ROUND_OBJECT_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_OBJECT_FLAGS.includes('pendingEe3Carbine'),
      'pendingEe3Carbine must be in ROUND_OBJECT_FLAGS — used as msgId-keyed map');
    assert.ok(ROUND_OBJECT_FLAGS.includes('voraciousUsed'),
      'voraciousUsed must be in ROUND_OBJECT_FLAGS — replaces pendingVoracious post-orchestrator-migration');
  });
});

// ── B-CLEANUP-004: lastAttack* stale tracking ───────────────────────────────

describe('B-CLEANUP-004: lastAttack* fields in ROUND_DELETE_FLAGS', () => {
  const LAST_ATTACK_FIELDS = [
    'lastAttackAttackerMsgId',
    'lastAttackAttackerFigureIndex',
    'lastAttackTargetFigureKey',
    'lastDefeatInfo',
    'lastAttackTargetSpacesForRubble',
    'lastAttackAttackerPlayerNum',
  ];

  for (const flag of LAST_ATTACK_FIELDS) {
    it(`004: ${flag} is in ROUND_DELETE_FLAGS`, () => {
      assert.ok(ROUND_DELETE_FLAGS.includes(flag),
        `${flag} must be in ROUND_DELETE_FLAGS — stale attack tracking cannot leak across rounds`);
    });
  }

  it('004-fn: cleanupRoundStart deletes all lastAttack* fields', () => {
    const game = {};
    for (const flag of LAST_ATTACK_FIELDS) {
      game[flag] = 'stale-value';
    }
    game.currentRound = 5; // control field
    cleanupRoundStart(game);
    for (const flag of LAST_ATTACK_FIELDS) {
      assert.ok(!(flag in game),
        `${flag} must be deleted after round cleanup — cannot inform wrong-round effects`);
    }
    assert.strictEqual(game.currentRound, 5, 'non-round state preserved');
  });
});

// ── B-CLEANUP-005: iKnowEverythingResolved ──────────────────────────────────

describe('B-CLEANUP-005: iKnowEverythingResolved in ROUND_DELETE_FLAGS', () => {
  it('005a: iKnowEverythingResolved is in ROUND_DELETE_FLAGS', () => {
    assert.ok(ROUND_DELETE_FLAGS.includes('iKnowEverythingResolved'),
      'iKnowEverythingResolved must be in ROUND_DELETE_FLAGS — per-round gate must reset');
  });

  it('005b: cleanupRoundStart deletes iKnowEverythingResolved', () => {
    const game = { iKnowEverythingResolved: true };
    cleanupRoundStart(game);
    assert.ok(!('iKnowEverythingResolved' in game),
      'iKnowEverythingResolved deleted — I Know Everything can fire again next round');
  });
});

// ── B-CLEANUP-006: drivenByHatredAttackPenalty ──────────────────────────────

describe('B-CLEANUP-006: drivenByHatredAttackPenalty in ROUND_OBJECT_FLAGS', () => {
  it('006a: drivenByHatredAttackPenalty is in ROUND_OBJECT_FLAGS', () => {
    assert.ok(ROUND_OBJECT_FLAGS.includes('drivenByHatredAttackPenalty'),
      'drivenByHatredAttackPenalty must be in ROUND_OBJECT_FLAGS — leaked penalty softlocks attacks');
  });

  it('006b: cleanupRoundStart resets drivenByHatredAttackPenalty to {}', () => {
    const game = { drivenByHatredAttackPenalty: { '3001': { removeDice: ['red'] } } };
    cleanupRoundStart(game);
    assert.deepStrictEqual(game.drivenByHatredAttackPenalty, {},
      'drivenByHatredAttackPenalty reset to {} — penalty cannot leak into next round');
  });
});

// ── B-CLEANUP-007: pendingCombat intentionally excluded ─────────────────────

describe('B-CLEANUP-007: pendingCombat NOT in any cleanup list (recovery.js contract)', () => {
  it('007: pendingCombat absent from all round cleanup lists', () => {
    assert.ok(!ALL_ROUND_FLAGS.has('pendingCombat'),
      'pendingCombat must NOT be in any ROUND cleanup list — recovery.js handles it');
  });

  it('007b: pendingCombat absent from all activation cleanup lists', () => {
    assert.ok(!ALL_ACTIVATION_FLAGS.has('pendingCombat'),
      'pendingCombat must NOT be in any ACTIVATION cleanup list — recovery.js handles it');
  });
});

// ── B-CLEANUP-008: slowOnTheDrawInterrupt ───────────────────────────────────

describe('B-CLEANUP-008: slowOnTheDrawInterrupt in ROUND_NULL_FLAGS', () => {
  it('008a: slowOnTheDrawInterrupt is in ROUND_NULL_FLAGS', () => {
    assert.ok(ROUND_NULL_FLAGS.includes('slowOnTheDrawInterrupt'),
      'slowOnTheDrawInterrupt must be in ROUND_NULL_FLAGS — interrupt chain residue');
  });

  it('008b: cleanupRoundStart nulls slowOnTheDrawInterrupt', () => {
    const game = { slowOnTheDrawInterrupt: { attackerMsgId: '3001' } };
    cleanupRoundStart(game);
    assert.strictEqual(game.slowOnTheDrawInterrupt, null,
      'slowOnTheDrawInterrupt nulled — stale interrupt cannot fire in next round');
  });
});

// ── B-CLEANUP-009: moveInProgress compound keys ─────────────────────────────

describe('B-CLEANUP-009: moveInProgress compound-key cleanup per activation', () => {
  it('009a: activation cleanup removes matching msgId prefix keys', () => {
    const game = {
      moveInProgress: {
        '3001_0': { figureKey: 'Trooper-1-0', mp: 3 },
        '3001_1': { figureKey: 'Trooper-1-1', mp: 2 },
        '3002_0': { figureKey: 'Rebel-1-0', mp: 4 },
      },
    };
    cleanupActivation(game, '3001', 1, ['Trooper-1-0', 'Trooper-1-1']);
    assert.strictEqual(game.moveInProgress['3001_0'], undefined, 'figure 0 cleaned');
    assert.strictEqual(game.moveInProgress['3001_1'], undefined, 'figure 1 cleaned');
    assert.ok(game.moveInProgress['3002_0'], 'other DC preserved');
  });

  it('009b: round cleanup resets entire moveInProgress to {}', () => {
    const game = { moveInProgress: { '3001_0': { mp: 3 }, '3002_0': { mp: 4 } } };
    cleanupRoundStart(game);
    assert.deepStrictEqual(game.moveInProgress, {}, 'moveInProgress fully reset at round boundary');
  });
});

// ── B-CLEANUP-010: Integration — no activation state leaks ──────────────────

describe('B-CLEANUP-010: No activation state leaks into next activation', () => {
  it('010: full activation cleanup clears all flag categories', () => {
    const msgId = 'dc-active';
    const playerNum = 1;
    const figureKeys = ['Unit-1-0', 'Unit-1-1'];
    const game = {};

    // Seed every activation flag category with values for this activation
    for (const key of ACTIVATION_MSGID_FLAGS) {
      game[key] = { [msgId]: { someData: true }, 'other-dc': { someData: true } };
    }
    for (const key of ACTIVATION_FIGKEY_FLAGS) {
      game[key] = { 'Unit-1-0': true, 'Unit-1-1': true, 'Enemy-2-0': true };
    }
    for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
      game[key] = { [playerNum]: 'active', 2: 'opponent' };
    }
    for (const key of ACTIVATION_SCALAR_FLAGS) {
      game[key] = 'active-value';
    }
    game.moveInProgress = {
      [`${msgId}_0`]: { mp: 3 },
      [`${msgId}_1`]: { mp: 2 },
      'other-dc_0': { mp: 5 },
    };

    cleanupActivation(game, msgId, playerNum, figureKeys);

    // msgId-keyed: active DC cleared, other DC preserved
    for (const key of ACTIVATION_MSGID_FLAGS) {
      assert.strictEqual(game[key][msgId], undefined, `${key}[${msgId}] cleaned`);
      assert.ok(game[key]['other-dc'], `${key}[other-dc] preserved`);
    }
    // figKey-keyed: active figures cleared, enemy preserved
    for (const key of ACTIVATION_FIGKEY_FLAGS) {
      assert.strictEqual(game[key]['Unit-1-0'], undefined, `${key}[Unit-1-0] cleaned`);
      assert.strictEqual(game[key]['Unit-1-1'], undefined, `${key}[Unit-1-1] cleaned`);
      assert.ok(game[key]['Enemy-2-0'], `${key}[Enemy-2-0] preserved`);
    }
    // playerNum-keyed: active player cleared, opponent preserved
    for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
      assert.strictEqual(game[key][playerNum], undefined, `${key}[${playerNum}] cleaned`);
      assert.strictEqual(game[key][2], 'opponent', `${key}[2] preserved`);
    }
    // scalars: deleted
    for (const key of ACTIVATION_SCALAR_FLAGS) {
      assert.ok(!(key in game), `${key} deleted`);
    }
    // compound moveInProgress: active DC cleaned, other preserved
    assert.strictEqual(game.moveInProgress[`${msgId}_0`], undefined, 'moveInProgress figure 0 cleaned');
    assert.strictEqual(game.moveInProgress[`${msgId}_1`], undefined, 'moveInProgress figure 1 cleaned');
    assert.ok(game.moveInProgress['other-dc_0'], 'moveInProgress other DC preserved');
  });
});
