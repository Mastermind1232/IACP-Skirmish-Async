/**
 * BEHAVIORAL accumulation-soak tests (Multi-Round Soak Phase 1).
 *
 * Tests that round-scoped, activation-scoped, and persistent state:
 *   1. expires when it should
 *   2. persists when it should
 *   3. does not silently compound across rounds/activations
 *   4. does not survive cleanup under the wrong key/scope
 *
 * Uses the real cleanupActivation() and cleanupRoundStart() functions
 * from activation-state.js — the authoritative cleanup code.
 * Uses real applyCondition/filterCondition from conditions.js.
 *
 * Test categories:
 *   B-SOAK-001: Round-scoped penalty stacking + reset
 *   B-SOAK-002: Activation-scoped flags across two activations
 *   B-SOAK-003: Condition persistence across round boundary
 *   B-SOAK-004: Pending-state leakage across round boundary
 *   B-SOAK-005: Repeated 2-round cycle invariant
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
import { applyCondition, filterCondition } from '../../../src/game/conditions.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {},
    figureConditions: {},
    figurePowerTokens: {},
    openedDoors: [],
    moveInProgress: {},
    movementBank: {},
    pendingSpacePick: {},
    ...overrides,
  };
}

/**
 * Simulate setting a round defense accuracy penalty for a player.
 * In production this happens inside ability resolution (e.g. Take Cover, Deflection).
 */
function addRoundDefenseAccuracyPenalty(game, playerNum, amount) {
  game.roundDefenseAccuracyPenalty = game.roundDefenseAccuracyPenalty || {};
  game.roundDefenseAccuracyPenalty[playerNum] =
    (game.roundDefenseAccuracyPenalty[playerNum] || 0) + amount;
}

// ── B-SOAK-001: Round-scoped penalty stacking + reset ──────────────────────

describe('B-SOAK-001: Round-scoped penalty stacking + reset', () => {
  it('001a: two CCs in same round accumulate correctly', () => {
    const game = makeGame();

    // Take Cover: −2 accuracy penalty for player 1
    addRoundDefenseAccuracyPenalty(game, 1, -2);
    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], -2);

    // Deflection: another −2
    addRoundDefenseAccuracyPenalty(game, 1, -2);
    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], -4,
      'stacked: −2 + −2 = −4 within round');
  });

  it('001b: cleanupRoundStart resets penalty to empty object', () => {
    const game = makeGame();
    addRoundDefenseAccuracyPenalty(game, 1, -4);

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.roundDefenseAccuracyPenalty, {},
      'roundDefenseAccuracyPenalty reset to {} after round boundary');
  });

  it('001c: fresh penalty in Round 2 does not carry Round 1 residue', () => {
    const game = makeGame();

    // Round 1
    addRoundDefenseAccuracyPenalty(game, 1, -4);
    cleanupRoundStart(game);

    // Round 2: fresh −2
    addRoundDefenseAccuracyPenalty(game, 1, -2);
    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], -2,
      'Round 2 penalty is −2, not −6 (no Round 1 residue)');
  });

  it('001d: per-player isolation — P1 penalty does not affect P2', () => {
    const game = makeGame();
    addRoundDefenseAccuracyPenalty(game, 1, -2);
    addRoundDefenseAccuracyPenalty(game, 2, -4);

    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], -2);
    assert.strictEqual(game.roundDefenseAccuracyPenalty[2], -4);

    cleanupRoundStart(game);
    assert.deepStrictEqual(game.roundDefenseAccuracyPenalty, {},
      'both players cleared at round boundary');
  });

  it('001e: all ROUND_OBJECT_FLAGS reset to {} by cleanupRoundStart', () => {
    const game = makeGame();
    // Seed every ROUND_OBJECT_FLAG with a non-empty value
    for (const key of ROUND_OBJECT_FLAGS) {
      game[key] = { sentinel: true };
    }

    cleanupRoundStart(game);

    for (const key of ROUND_OBJECT_FLAGS) {
      assert.deepStrictEqual(game[key], {},
        `ROUND_OBJECT_FLAG '${key}' must be {} after cleanup`);
    }
  });

  it('001f: all ROUND_NULL_FLAGS reset to null by cleanupRoundStart', () => {
    const game = makeGame();
    for (const key of ROUND_NULL_FLAGS) {
      game[key] = { stale: 'data' };
    }

    cleanupRoundStart(game);

    for (const key of ROUND_NULL_FLAGS) {
      assert.strictEqual(game[key], null,
        `ROUND_NULL_FLAG '${key}' must be null after cleanup`);
    }
  });

  it('001g: ROUND_ARRAY_FLAGS reset to [], ROUND_FALSE_FLAGS to false, ROUND_DELETE_FLAGS deleted', () => {
    const game = makeGame();
    for (const key of ROUND_ARRAY_FLAGS) game[key] = ['stale'];
    for (const key of ROUND_FALSE_FLAGS) game[key] = true;
    for (const key of ROUND_DELETE_FLAGS) game[key] = 'leftover';

    cleanupRoundStart(game);

    for (const key of ROUND_ARRAY_FLAGS) {
      assert.deepStrictEqual(game[key], [], `ROUND_ARRAY_FLAG '${key}' must be []`);
    }
    for (const key of ROUND_FALSE_FLAGS) {
      assert.strictEqual(game[key], false, `ROUND_FALSE_FLAG '${key}' must be false`);
    }
    for (const key of ROUND_DELETE_FLAGS) {
      assert.strictEqual(game[key], undefined, `ROUND_DELETE_FLAG '${key}' must be deleted`);
    }
  });
});

// ── B-SOAK-002: Activation-scoped flags across two activations ─────────────

describe('B-SOAK-002: Activation-scoped flags across two activations', () => {
  it('002a: activation flags set for Figure A, cleaned after A\'s activation', () => {
    const game = makeGame();
    const msgIdA = 'msg_a';
    const fkA = 'Stormtrooper (Elite)-1-0';

    // Set per-msgId flags
    game.dcActionsData = { [msgIdA]: { remaining: 0, total: 2 } };
    game.movementBank = { [msgIdA]: { total: 4, remaining: 0 } };
    // Set per-figKey flags
    game.figureMoved = { [fkA]: true };
    game.tripodAttacked = { [fkA]: true };
    // Set per-playerNum flags
    game.nextAttacksBonusHits = { 1: [{ source: 'test', hits: 1 }] };
    // Set scalar flag
    game.commsJammerActivePlayerNum = 2;

    cleanupActivation(game, msgIdA, 1, [fkA]);

    // per-msgId cleaned
    assert.strictEqual(game.dcActionsData?.[msgIdA], undefined, 'dcActionsData[msgA] cleaned');
    assert.strictEqual(game.movementBank?.[msgIdA], undefined, 'movementBank[msgA] cleaned');
    // per-figKey cleaned
    assert.strictEqual(game.figureMoved?.[fkA], undefined, 'figureMoved[A] cleaned');
    assert.strictEqual(game.tripodAttacked?.[fkA], undefined, 'tripodAttacked[A] cleaned');
    // per-playerNum cleaned for player 1
    assert.strictEqual(game.nextAttacksBonusHits?.[1], undefined, 'nextAttacksBonusHits[1] cleaned');
    // scalar cleaned
    assert.strictEqual(game.commsJammerActivePlayerNum, undefined, 'scalar flag deleted');
  });

  it('002b: Figure B activation sees no leftover from Figure A', () => {
    const game = makeGame();
    const msgIdA = 'msg_a';
    const fkA = 'Stormtrooper (Elite)-1-0';
    const msgIdB = 'msg_b';
    const fkB = 'Rebel Trooper (Elite)-1-0';

    // Activate Figure A
    game.figureMoved = { [fkA]: true };
    game.tripodAttacked = { [fkA]: true };
    game.dcActionsData = { [msgIdA]: { remaining: 0, total: 2 } };
    game.nextAttacksBonusHits = { 1: [{ source: 'test' }] };
    game.commsJammerActivePlayerNum = 2;

    // End A's activation
    cleanupActivation(game, msgIdA, 1, [fkA]);

    // Now activate Figure B — set B's own flags
    game.figureMoved = game.figureMoved || {};
    game.figureMoved[fkB] = true;
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgIdB] = { remaining: 1, total: 2 };

    // Figure A's data must not be present
    assert.strictEqual(game.figureMoved[fkA], undefined, 'A\'s figureMoved not visible during B');
    assert.strictEqual(game.dcActionsData[msgIdA], undefined, 'A\'s dcActionsData not visible during B');
    assert.strictEqual(game.nextAttacksBonusHits?.[1], undefined, 'A\'s playerNum bonus not visible during B');
    assert.strictEqual(game.commsJammerActivePlayerNum, undefined, 'A\'s scalar not visible during B');

    // B's own flags are live
    assert.strictEqual(game.figureMoved[fkB], true, 'B\'s figureMoved is set');
    assert.strictEqual(game.dcActionsData[msgIdB].remaining, 1, 'B\'s dcActionsData is set');
  });

  it('002c: cleanup scopes by msgId — other msgId entries preserved', () => {
    const game = makeGame();
    const msgIdA = 'msg_a';
    const msgIdB = 'msg_b';

    game.dcActionsData = {
      [msgIdA]: { remaining: 0, total: 2 },
      [msgIdB]: { remaining: 2, total: 2 },
    };
    game.movementBank = {
      [msgIdA]: { total: 4, remaining: 0 },
      [msgIdB]: { total: 4, remaining: 4 },
    };

    cleanupActivation(game, msgIdA, 1, ['Stormtrooper (Elite)-1-0']);

    assert.strictEqual(game.dcActionsData[msgIdA], undefined, 'A cleaned');
    assert.deepStrictEqual(game.dcActionsData[msgIdB], { remaining: 2, total: 2 },
      'B preserved — cleanup scoped to msgIdA only');
    assert.deepStrictEqual(game.movementBank[msgIdB], { total: 4, remaining: 4 },
      'B movementBank preserved');
  });

  it('002d: cleanup scopes by figureKey — other figures preserved', () => {
    const game = makeGame();
    const fkA = 'Stormtrooper (Elite)-1-0';
    const fkB = 'Rebel Trooper (Elite)-1-0';

    game.figureMoved = { [fkA]: true, [fkB]: true };
    game.tripodAttacked = { [fkA]: true, [fkB]: true };

    cleanupActivation(game, 'msg_a', 1, [fkA]);

    assert.strictEqual(game.figureMoved[fkA], undefined, 'A cleaned');
    assert.strictEqual(game.figureMoved[fkB], true, 'B preserved');
    assert.strictEqual(game.tripodAttacked[fkA], undefined, 'A cleaned');
    assert.strictEqual(game.tripodAttacked[fkB], true, 'B preserved');
  });

  it('002e: moveInProgress compound keys cleaned by msgId prefix', () => {
    const game = makeGame();
    game.moveInProgress = {
      'msg_a_0': { figureKey: 'Stormtrooper (Elite)-1-0', mpRemaining: 2 },
      'msg_a_1': { figureKey: 'Stormtrooper (Elite)-1-1', mpRemaining: 3 },
      'msg_b_0': { figureKey: 'Rebel Trooper (Elite)-1-0', mpRemaining: 4 },
    };

    cleanupActivation(game, 'msg_a', 1, ['Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-1-1']);

    assert.strictEqual(game.moveInProgress['msg_a_0'], undefined, 'A-0 cleaned');
    assert.strictEqual(game.moveInProgress['msg_a_1'], undefined, 'A-1 cleaned');
    assert.ok(game.moveInProgress['msg_b_0'], 'B-0 preserved');
  });

  it('002f: all ACTIVATION_MSGID_FLAGS for target msgId cleaned', () => {
    const game = makeGame();
    const msgId = 'msg_x';
    // Seed every activation msgId flag
    for (const key of ACTIVATION_MSGID_FLAGS) {
      game[key] = game[key] || {};
      game[key][msgId] = { test: true };
    }

    cleanupActivation(game, msgId, 1, ['Figure-1-0']);

    for (const key of ACTIVATION_MSGID_FLAGS) {
      assert.strictEqual(game[key]?.[msgId], undefined,
        `ACTIVATION_MSGID_FLAG '${key}' must be cleaned for ${msgId}`);
    }
  });
});

// ── B-SOAK-003: Condition persistence across round boundary ────────────────

describe('B-SOAK-003: Condition persistence across round boundary', () => {
  it('003a: Stun persists across round boundary (permanent until action-removal)', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Stun');

    cleanupRoundStart(game);

    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Stun'),
      'Stun persists — not affected by cleanupRoundStart');
  });

  it('003b: Weaken persists across round boundary', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Weaken');

    cleanupRoundStart(game);

    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Weaken'),
      'Weaken persists across round boundary');
  });

  it('003c: Focus persists across round boundary (consumed on attack, not round)', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Focus');

    cleanupRoundStart(game);

    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Focus'),
      'Focus persists — consumed by attack resolution, not round cleanup');
  });

  it('003d: multiple conditions on same figure all persist', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Stun');
    applyCondition(game, 'Trooper-1-0', 'Weaken');
    applyCondition(game, 'Trooper-1-0', 'Focus');

    cleanupRoundStart(game);

    const conds = game.figureConditions['Trooper-1-0'];
    assert.ok(conds.includes('Stun'), 'Stun persists');
    assert.ok(conds.includes('Weaken'), 'Weaken persists');
    assert.ok(conds.includes('Focus'), 'Focus persists');
    assert.strictEqual(conds.length, 3, 'exactly 3 conditions remain');
  });

  it('003e: conditions on different figures preserved independently', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Stun');
    applyCondition(game, 'Officer-2-0', 'Weaken');

    cleanupRoundStart(game);

    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Stun'));
    assert.ok(game.figureConditions['Officer-2-0']?.includes('Weaken'));
  });

  it('003f: filterCondition removes specific condition, others persist', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Stun');
    applyCondition(game, 'Trooper-1-0', 'Weaken');

    filterCondition(game, 'Trooper-1-0', 'Stun');

    assert.ok(!game.figureConditions['Trooper-1-0']?.includes('Stun'),
      'Stun removed by filterCondition');
    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Weaken'),
      'Weaken NOT removed — surgical removal');
  });

  it('003g: applyCondition deduplicates — double-apply does not stack', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Stun');
    const applied = applyCondition(game, 'Trooper-1-0', 'Stun');

    assert.strictEqual(applied, false, 'second apply returns false');
    assert.strictEqual(
      game.figureConditions['Trooper-1-0'].filter(c => c === 'Stun').length, 1,
      'Stun appears exactly once — no duplication');
  });

  it('003h: disarmPermanentWeakened blocks Weaken removal', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Weaken');
    game.disarmPermanentWeakened = { 'Trooper-1-0': true };

    filterCondition(game, 'Trooper-1-0', 'Weaken');

    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Weaken'),
      'Weaken NOT removed — disarmPermanentWeakened blocks removal');
  });

  it('003i: cleanupActivation does NOT touch figureConditions', () => {
    const game = makeGame();
    applyCondition(game, 'Trooper-1-0', 'Stun');
    applyCondition(game, 'Trooper-1-0', 'Weaken');

    cleanupActivation(game, 'msg_a', 1, ['Trooper-1-0']);

    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Stun'),
      'Stun persists through activation cleanup');
    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Weaken'),
      'Weaken persists through activation cleanup');
  });
});

// ── B-SOAK-004: Pending-state leakage across round boundary ────────────────

describe('B-SOAK-004: Pending-state leakage across round boundary', () => {
  it('004a: pendingPowerTokenGrant wiped by cleanupRoundStart', () => {
    const game = makeGame();
    game.pendingPowerTokenGrant = {
      grants: [{ figureKey: 'Trooper-1-0', figName: 'Trooper', count: 1 }],
      channelId: 'ch1', playerNum: 1,
    };

    cleanupRoundStart(game);

    assert.strictEqual(game.pendingPowerTokenGrant, null,
      'pendingPowerTokenGrant nulled at round boundary');
  });

  it('004b: pendingSpacePick wiped by cleanupRoundStart', () => {
    const game = makeGame();
    game.pendingSpacePick = { msg_a: { type: 'deploy', playerNum: 1 } };

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.pendingSpacePick, {},
      'pendingSpacePick reset to {} at round boundary');
  });

  it('004c: moveInProgress wiped by cleanupRoundStart', () => {
    const game = makeGame();
    game.moveInProgress = {
      'msg_a_0': { figureKey: 'Trooper-1-0', mpRemaining: 3 },
    };

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.moveInProgress, {},
      'moveInProgress reset to {} at round boundary');
  });

  it('004d: pendingOverrideAttackDice wiped by cleanupRoundStart', () => {
    const game = makeGame();
    game.pendingOverrideAttackDice = { msg_a: { dice: ['red', 'yellow'] } };

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.pendingOverrideAttackDice, {},
      'pendingOverrideAttackDice reset to {} at round boundary');
  });

  it('004e: pendingCombat intentionally NOT wiped (handled by recovery.js)', () => {
    const game = makeGame();
    game.pendingCombat = { attackerMsgId: 'msg_a', targetFigureKey: 'Trooper-2-0' };

    cleanupRoundStart(game);

    // pendingCombat is NOT in ROUND_NULL_FLAGS or ROUND_OBJECT_FLAGS
    assert.ok(game.pendingCombat,
      'pendingCombat survives cleanupRoundStart — handled by recovery.js separately');
    assert.strictEqual(game.pendingCombat.attackerMsgId, 'msg_a',
      'pendingCombat data intact');
  });

  it('004f: deflectionPending + deflectionUnconditional wiped', () => {
    const game = makeGame();
    game.deflectionPending = { 1: 2 };
    game.deflectionUnconditional = { 1: true };

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.deflectionPending, {}, 'deflectionPending reset');
    assert.deepStrictEqual(game.deflectionUnconditional, {}, 'deflectionUnconditional reset');
  });

  it('004g: crippledFigures + disabledFigures arrays wiped', () => {
    const game = makeGame();
    game.crippledFigures = ['Trooper', 'Officer'];
    game.disabledFigures = ['Droid'];

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.crippledFigures, [], 'crippledFigures reset to []');
    assert.deepStrictEqual(game.disabledFigures, [], 'disabledFigures reset to []');
  });

  it('004h: round boolean flags reset to false', () => {
    const game = makeGame();
    game.harshEnvironmentActive = true;
    game.noCommandDrawThisRound = true;

    cleanupRoundStart(game);

    assert.strictEqual(game.harshEnvironmentActive, false);
    assert.strictEqual(game.noCommandDrawThisRound, false);
  });
});

// ── B-SOAK-005: Repeated 2-round cycle invariant ───────────────────────────

describe('B-SOAK-005: Repeated 2-round / multi-activation cycle invariant', () => {
  it('005a: full 2-round cycle — round penalty does not accumulate', () => {
    const game = makeGame();

    // ── Round 1 ──
    addRoundDefenseAccuracyPenalty(game, 1, -4);
    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], -4);

    cleanupRoundStart(game);

    // ── Round 2 ──
    addRoundDefenseAccuracyPenalty(game, 1, -2);
    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], -2,
      'Round 2 penalty is −2, not −6 — no accumulation from Round 1');

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.roundDefenseAccuracyPenalty, {},
      'clean after Round 2');
  });

  it('005b: full 2-activation cycle — per-figure flags do not bleed', () => {
    const game = makeGame();
    const msgA = 'msg_a';
    const msgB = 'msg_b';
    const fkA = 'Stormtrooper (Elite)-1-0';
    const fkB = 'IG-88-1-0';

    // ── Activation 1: Figure A ──
    game.figureMoved = { [fkA]: true };
    game.tripodAttacked = { [fkA]: true };
    game.dcActionsData = { [msgA]: { remaining: 0, total: 2 } };
    game.nextAttacksBonusHits = { 1: [{ source: 'cc', hits: 1 }] };

    cleanupActivation(game, msgA, 1, [fkA]);

    // ── Activation 2: Figure B ──
    // Verify A's state is gone before B starts
    assert.strictEqual(game.figureMoved?.[fkA], undefined, 'A figureMoved gone');
    assert.strictEqual(game.tripodAttacked?.[fkA], undefined, 'A tripodAttacked gone');
    assert.strictEqual(game.dcActionsData?.[msgA], undefined, 'A dcActionsData gone');
    assert.strictEqual(game.nextAttacksBonusHits?.[1], undefined, 'A playerNum bonus gone');

    // Set B's flags
    game.figureMoved = game.figureMoved || {};
    game.figureMoved[fkB] = true;
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgB] = { remaining: 1, total: 2 };

    cleanupActivation(game, msgB, 1, [fkB]);

    // B's state also cleaned
    assert.strictEqual(game.figureMoved?.[fkB], undefined, 'B figureMoved gone');
    assert.strictEqual(game.dcActionsData?.[msgB], undefined, 'B dcActionsData gone');
  });

  it('005c: conditions survive activation + round cleanup cycle', () => {
    const game = makeGame();
    const fkA = 'Stormtrooper (Elite)-1-0';

    // Apply condition during activation
    applyCondition(game, fkA, 'Stun');
    applyCondition(game, fkA, 'Focus');

    // End activation
    cleanupActivation(game, 'msg_a', 1, [fkA]);

    assert.ok(game.figureConditions[fkA]?.includes('Stun'),
      'Stun survives activation cleanup');
    assert.ok(game.figureConditions[fkA]?.includes('Focus'),
      'Focus survives activation cleanup');

    // End round
    cleanupRoundStart(game);

    assert.ok(game.figureConditions[fkA]?.includes('Stun'),
      'Stun survives round cleanup');
    assert.ok(game.figureConditions[fkA]?.includes('Focus'),
      'Focus survives round cleanup');
  });

  it('005d: pending state seeded mid-round vanishes at round boundary', () => {
    const game = makeGame();

    // Simulate mid-round pending state from interrupted combat/ability
    game.pendingPowerTokenGrant = { grants: [], channelId: 'ch1', playerNum: 1 };
    game.pendingOverrideAttackDice = { msg_a: { dice: ['blue'] } };
    game.deflectionPending = { 2: 1 };
    game.crippledFigures = ['Trooper'];
    game.harshEnvironmentActive = true;
    game.moveInProgress = { 'msg_a_0': { mpRemaining: 2 } };

    cleanupRoundStart(game);

    assert.strictEqual(game.pendingPowerTokenGrant, null, 'pending token grant gone');
    assert.deepStrictEqual(game.pendingOverrideAttackDice, {}, 'pending override dice gone');
    assert.deepStrictEqual(game.deflectionPending, {}, 'deflection pending gone');
    assert.deepStrictEqual(game.crippledFigures, [], 'crippled figures gone');
    assert.strictEqual(game.harshEnvironmentActive, false, 'harsh env gone');
    assert.deepStrictEqual(game.moveInProgress, {}, 'move in progress gone');
  });

  it('005e: full story — R1 activate+attack+cleanup → R2 activate+attack+cleanup → clean', () => {
    const game = makeGame();
    const fkA = 'Emperor Palpatine-1-0';
    const fkB = 'IG-88-2-0';
    const msgA = 'msg_emp';
    const msgB = 'msg_ig88';

    // ── Round 1, Activation 1: Emperor attacks ──
    // Set activation flags
    game.figureMoved = { [fkA]: true };
    game.dcActionsData = { [msgA]: { remaining: 0, total: 2 } };
    game.nextAttacksBonusHits = { 1: [{ source: 'son_of_skywalker', hits: 2 }] };
    game.commsJammerActivePlayerNum = 2;
    // Set round flags
    addRoundDefenseAccuracyPenalty(game, 2, -2);
    game.deflectionPending = { 2: 1 };
    // Apply conditions to target
    applyCondition(game, fkB, 'Weaken');

    // End activation 1
    cleanupActivation(game, msgA, 1, [fkA]);

    // Verify activation state cleaned, round state + conditions preserved
    assert.strictEqual(game.figureMoved?.[fkA], undefined, 'R1A1: activation flag cleaned');
    assert.strictEqual(game.roundDefenseAccuracyPenalty?.[2], -2, 'R1A1: round penalty preserved');
    assert.deepStrictEqual(game.deflectionPending, { 2: 1 }, 'R1A1: deflection preserved');
    assert.ok(game.figureConditions[fkB]?.includes('Weaken'), 'R1A1: Weaken preserved');

    // ── End Round 1 ──
    cleanupRoundStart(game);

    // Round state gone, conditions persist
    assert.deepStrictEqual(game.roundDefenseAccuracyPenalty, {}, 'R1→R2: penalty gone');
    assert.deepStrictEqual(game.deflectionPending, {}, 'R1→R2: deflection gone');
    assert.ok(game.figureConditions[fkB]?.includes('Weaken'), 'R1→R2: Weaken persists');

    // ── Round 2, Activation 1: IG-88 activates ──
    game.figureMoved = game.figureMoved || {};
    game.figureMoved[fkB] = true;
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgB] = { remaining: 1, total: 2 };

    // No leftover from Round 1 activation
    assert.strictEqual(game.figureMoved?.[fkA], undefined, 'R2: no R1 figureMoved ghost');
    assert.strictEqual(game.dcActionsData?.[msgA], undefined, 'R2: no R1 dcActionsData ghost');

    // End activation
    cleanupActivation(game, msgB, 2, [fkB]);

    assert.strictEqual(game.figureMoved?.[fkB], undefined, 'R2A1: B activation cleaned');
    assert.ok(game.figureConditions[fkB]?.includes('Weaken'),
      'R2A1: Weaken STILL persists after 2 activations + 1 round boundary');

    // ── End Round 2 ──
    cleanupRoundStart(game);

    // Final invariants
    assert.deepStrictEqual(game.roundDefenseAccuracyPenalty, {}, 'final: penalty clean');
    assert.deepStrictEqual(game.moveInProgress, {}, 'final: moveInProgress clean');
    assert.ok(game.figureConditions[fkB]?.includes('Weaken'),
      'final: Weaken persists through entire 2-round cycle — correct by rules');
  });
});
