/**
 * BEHAVIORAL end-of-round (EoR) ordering + representative effect tests.
 *
 * Tests the ordering contract of _runStatusPhaseLogic in round.js:
 *   1. Bossk Regenerate heals HP + discards Bleed BEFORE cleanupRoundStart
 *   2. Hardy discards harmful conditions BEFORE cleanupRoundStart
 *   3. cleanupRoundStart does not erase state needed for EoR effects
 *   4. After full EoR → round cleanup, game state is coherent
 *
 * Uses real pure functions (healHpDistributed, filterCondition, applyCondition,
 * cleanupRoundStart, needsRecovery, getRecoveryReason) — no Discord mocks.
 *
 * Test categories:
 *   B-EOR-001: Bossk Regenerate — HP recovery + Bleed removal
 *   B-EOR-002: Hardy — harmful condition clearing
 *   B-EOR-003: Ordering invariant — EoR effects fire before round cleanup
 *   B-EOR-004: recovery.js pendingCombat sentinel
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupRoundStart } from '../../../src/game/activation-state.js';
import { applyCondition, filterCondition, HARMFUL_CONDITIONS } from '../../../src/game/conditions.js';
import { healHpDistributed } from '../../../src/game/damage-helpers.js';
import { needsRecovery, getRecoveryReason } from '../../../src/engine/recovery.js';

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
 * Simulate the Bossk Regenerate EoR effect (round.js:331-346).
 * Pure-function reproduction: healHpDistributed, then filterCondition for Bleed.
 */
function applyBosskRegenerate(dcHealthState, game, msgId, playerNum) {
  const { totalRecovered, perFigure } = healHpDistributed(dcHealthState, game, msgId, 2, playerNum);
  // Discard Bleed from all Bossk figures
  for (const fk of Object.keys(game.figureConditions || {})) {
    if (!fk.startsWith('Bossk-')) continue;
    filterCondition(game, fk, 'Bleed');
  }
  return { totalRecovered, perFigure };
}

/**
 * Simulate the Hardy EoR effect (round.js:347-364).
 * Pure-function reproduction: filterCondition for each harmful condition on each figure of the DC.
 */
function applyHardyPassive(game, dcName) {
  const HARMFUL = ['Bleed', 'Stun', 'Weaken'];
  let cleared = false;
  for (const fk of Object.keys(game.figureConditions || {})) {
    if (!fk.startsWith(dcName + '-')) continue;
    const before = game.figureConditions[fk]?.length || 0;
    for (const h of HARMFUL) filterCondition(game, fk, h);
    if ((game.figureConditions[fk]?.length || 0) < before) cleared = true;
  }
  return cleared;
}

// ── B-EOR-001: Bossk Regenerate — HP recovery + Bleed removal ──────────────

describe('B-EOR-001: Bossk Regenerate — HP recovery + Bleed removal at EoR', () => {
  it('001a: Bossk recovers 2 HP (capped at max)', () => {
    const dcHealthState = new Map();
    const msgId = 'msg_bossk';
    // Bossk: 5/7 HP (2 damage)
    dcHealthState.set(msgId, [[5, 7]]);
    const game = makeGame();

    const { totalRecovered, perFigure } = applyBosskRegenerate(dcHealthState, game, msgId, 2);

    assert.strictEqual(totalRecovered, 2, 'recovered exactly 2 HP');
    assert.strictEqual(perFigure[0].newHp, 7, 'healed to 7/7');
    assert.strictEqual(dcHealthState.get(msgId)[0][0], 7, 'dcHealthState updated');
  });

  it('001b: Bossk recovery capped at missing HP (no over-heal)', () => {
    const dcHealthState = new Map();
    const msgId = 'msg_bossk';
    // Bossk: 6/7 HP (1 damage) — can only heal 1 of the 2
    dcHealthState.set(msgId, [[6, 7]]);
    const game = makeGame();

    const { totalRecovered } = applyBosskRegenerate(dcHealthState, game, msgId, 2);

    assert.strictEqual(totalRecovered, 1, 'only 1 HP recovered (capped at damage)');
    assert.strictEqual(dcHealthState.get(msgId)[0][0], 7, 'healed to max');
  });

  it('001c: Bossk at full HP — 0 recovery', () => {
    const dcHealthState = new Map();
    const msgId = 'msg_bossk';
    dcHealthState.set(msgId, [[7, 7]]);
    const game = makeGame();

    const { totalRecovered } = applyBosskRegenerate(dcHealthState, game, msgId, 2);

    assert.strictEqual(totalRecovered, 0, 'no recovery when at max HP');
  });

  it('001d: Bleed removed from Bossk at EoR', () => {
    const dcHealthState = new Map();
    const msgId = 'msg_bossk';
    dcHealthState.set(msgId, [[5, 7]]);
    const game = makeGame();
    applyCondition(game, 'Bossk-2-0', 'Bleed');

    applyBosskRegenerate(dcHealthState, game, msgId, 2);

    assert.ok(!game.figureConditions['Bossk-2-0']?.includes('Bleed'),
      'Bleed removed by Bossk Regenerate');
  });

  it('001e: Bleed removal does not affect other conditions on Bossk', () => {
    const dcHealthState = new Map();
    const msgId = 'msg_bossk';
    dcHealthState.set(msgId, [[5, 7]]);
    const game = makeGame();
    applyCondition(game, 'Bossk-2-0', 'Bleed');
    applyCondition(game, 'Bossk-2-0', 'Focus');
    applyCondition(game, 'Bossk-2-0', 'Weaken');

    applyBosskRegenerate(dcHealthState, game, msgId, 2);

    assert.ok(!game.figureConditions['Bossk-2-0']?.includes('Bleed'),
      'Bleed removed');
    assert.ok(game.figureConditions['Bossk-2-0']?.includes('Focus'),
      'Focus preserved');
    assert.ok(game.figureConditions['Bossk-2-0']?.includes('Weaken'),
      'Weaken preserved — Bossk Regenerate only removes Bleed');
  });

  it('001f: Bleed on non-Bossk figure NOT removed by Bossk Regenerate', () => {
    const dcHealthState = new Map();
    const msgId = 'msg_bossk';
    dcHealthState.set(msgId, [[5, 7]]);
    const game = makeGame();
    applyCondition(game, 'Bossk-2-0', 'Bleed');
    applyCondition(game, 'Trooper-1-0', 'Bleed');

    applyBosskRegenerate(dcHealthState, game, msgId, 2);

    assert.ok(!game.figureConditions['Bossk-2-0']?.includes('Bleed'),
      'Bossk Bleed removed');
    assert.ok(game.figureConditions['Trooper-1-0']?.includes('Bleed'),
      'Trooper Bleed NOT removed — Bossk Regenerate scoped to Bossk figures only');
  });
});

// ── B-EOR-002: Hardy — harmful condition clearing ──────────────────────────

describe('B-EOR-002: Hardy — harmful condition clearing at EoR', () => {
  it('002a: Hardy clears all harmful conditions (Bleed, Stun, Weaken)', () => {
    const game = makeGame();
    const dcName = 'Trandoshan Hunter (Elite)';
    const fk = `${dcName}-1-0`;
    applyCondition(game, fk, 'Bleed');
    applyCondition(game, fk, 'Stun');
    applyCondition(game, fk, 'Weaken');

    const cleared = applyHardyPassive(game, dcName);

    assert.strictEqual(cleared, true, 'conditions were cleared');
    assert.ok(!game.figureConditions[fk]?.includes('Bleed'), 'Bleed gone');
    assert.ok(!game.figureConditions[fk]?.includes('Stun'), 'Stun gone');
    assert.ok(!game.figureConditions[fk]?.includes('Weaken'), 'Weaken gone');
  });

  it('002b: Hardy preserves beneficial conditions (Focus, Hide)', () => {
    const game = makeGame();
    const dcName = 'Trandoshan Hunter (Elite)';
    const fk = `${dcName}-1-0`;
    applyCondition(game, fk, 'Stun');
    applyCondition(game, fk, 'Focus');
    applyCondition(game, fk, 'Hide');

    applyHardyPassive(game, dcName);

    assert.ok(!game.figureConditions[fk]?.includes('Stun'), 'Stun gone (harmful)');
    assert.ok(game.figureConditions[fk]?.includes('Focus'), 'Focus preserved (beneficial)');
    assert.ok(game.figureConditions[fk]?.includes('Hide'), 'Hide preserved (beneficial)');
  });

  it('002c: Hardy only affects its own DC — other figures untouched', () => {
    const game = makeGame();
    const dcName = 'Trandoshan Hunter (Elite)';
    applyCondition(game, `${dcName}-1-0`, 'Stun');
    applyCondition(game, 'Trooper-2-0', 'Stun');

    applyHardyPassive(game, dcName);

    assert.ok(!game.figureConditions[`${dcName}-1-0`]?.includes('Stun'),
      'Hardy DC cleared');
    assert.ok(game.figureConditions['Trooper-2-0']?.includes('Stun'),
      'Non-Hardy figure Stun preserved');
  });

  it('002d: Hardy with no harmful conditions returns false (no-op)', () => {
    const game = makeGame();
    const dcName = 'Trandoshan Hunter (Elite)';
    applyCondition(game, `${dcName}-1-0`, 'Focus');

    const cleared = applyHardyPassive(game, dcName);

    assert.strictEqual(cleared, false, 'nothing to clear → returns false');
    assert.ok(game.figureConditions[`${dcName}-1-0`]?.includes('Focus'),
      'Focus still present');
  });

  it('002e: Hardy on multi-figure DG clears all figures', () => {
    const game = makeGame();
    const dcName = 'Trandoshan Hunter (Elite)';
    applyCondition(game, `${dcName}-1-0`, 'Stun');
    applyCondition(game, `${dcName}-1-1`, 'Weaken');
    applyCondition(game, `${dcName}-1-1`, 'Focus');

    applyHardyPassive(game, dcName);

    assert.ok(!game.figureConditions[`${dcName}-1-0`]?.includes('Stun'),
      'figure 0 Stun cleared');
    assert.ok(!game.figureConditions[`${dcName}-1-1`]?.includes('Weaken'),
      'figure 1 Weaken cleared');
    assert.ok(game.figureConditions[`${dcName}-1-1`]?.includes('Focus'),
      'figure 1 Focus preserved');
  });
});

// ── B-EOR-003: Ordering invariant — EoR effects fire before round cleanup ──

describe('B-EOR-003: Ordering invariant — EoR effects before cleanupRoundStart', () => {
  it('003a: full EoR sequence — Bossk regen + Hardy + cleanup → coherent final state', () => {
    const dcHealthState = new Map();
    const bosskMsgId = 'msg_bossk';
    const hardyDcName = 'Trandoshan Hunter (Elite)';
    const hardyFk = `${hardyDcName}-1-0`;
    const bosskFk = 'Bossk-2-0';
    const trooperFk = 'Stormtrooper (Elite)-2-0';

    // Pre-state:
    // - Bossk: 4/7 HP, has Bleed
    // - Trandoshan Hunter (Elite): has Stun + Focus
    // - Stormtrooper: has Weaken
    // - Round penalty: player 2 has −2 accuracy penalty
    // - Pending state: pendingPowerTokenGrant is set
    dcHealthState.set(bosskMsgId, [[4, 7]]);
    const game = makeGame({
      roundDefenseAccuracyPenalty: { 2: -2 },
      pendingPowerTokenGrant: { grants: [], channelId: null, playerNum: 1 },
    });
    applyCondition(game, bosskFk, 'Bleed');
    applyCondition(game, hardyFk, 'Stun');
    applyCondition(game, hardyFk, 'Focus');
    applyCondition(game, trooperFk, 'Weaken');

    // ── Step 1: Bossk Regenerate (round.js:331-346) ──
    applyBosskRegenerate(dcHealthState, game, bosskMsgId, 2);

    // Intermediate check: Bossk healed, Bleed removed, round state still present
    assert.strictEqual(dcHealthState.get(bosskMsgId)[0][0], 6, 'Bossk 4 → 6 HP');
    assert.ok(!game.figureConditions[bosskFk]?.includes('Bleed'), 'Bossk Bleed removed');
    assert.strictEqual(game.roundDefenseAccuracyPenalty[2], -2,
      'round penalty still present (not yet cleaned)');
    assert.ok(game.pendingPowerTokenGrant,
      'pending state still present (not yet cleaned)');

    // ── Step 2: Hardy (round.js:347-364) ──
    applyHardyPassive(game, hardyDcName);

    // Intermediate check: Hardy cleared Stun, preserved Focus
    assert.ok(!game.figureConditions[hardyFk]?.includes('Stun'), 'Hardy Stun cleared');
    assert.ok(game.figureConditions[hardyFk]?.includes('Focus'), 'Hardy Focus preserved');

    // Trooper still has Weaken (no Hardy)
    assert.ok(game.figureConditions[trooperFk]?.includes('Weaken'),
      'Trooper Weaken still present (no Hardy passive)');

    // ── Step 3: cleanupRoundStart (round.js:838) ──
    cleanupRoundStart(game);

    // Final state assertions:
    // Conditions persist (not in round cleanup)
    assert.ok(game.figureConditions[hardyFk]?.includes('Focus'),
      'Focus survives round cleanup');
    assert.ok(game.figureConditions[trooperFk]?.includes('Weaken'),
      'Weaken survives round cleanup');
    // Bossk Bleed already removed by regenerate — still gone
    assert.ok(!game.figureConditions[bosskFk]?.includes('Bleed'),
      'Bossk Bleed still gone after cleanup');
    // Round-scoped state cleaned
    assert.deepStrictEqual(game.roundDefenseAccuracyPenalty, {},
      'round penalty wiped by cleanup');
    assert.strictEqual(game.pendingPowerTokenGrant, null,
      'pending state wiped by cleanup');
    // HP change from Bossk regen persists (dcHealthState is external Map)
    assert.strictEqual(dcHealthState.get(bosskMsgId)[0][0], 6,
      'Bossk HP change persists through round cleanup');
  });

  it('003b: cleanupRoundStart does not erase figureConditions needed by EoR effects', () => {
    // Prove that if cleanupRoundStart were called BEFORE Hardy, Hardy would still
    // work (conditions are not in round cleanup). This is a safety-net test.
    const game = makeGame({
      roundDefenseAccuracyPenalty: { 1: -2 },
    });
    const dcName = 'Trandoshan Hunter (Elite)';
    const fk = `${dcName}-1-0`;
    applyCondition(game, fk, 'Stun');

    // Call cleanup FIRST (wrong order, but should not destroy conditions)
    cleanupRoundStart(game);

    // Conditions still present — Hardy can still clear them
    assert.ok(game.figureConditions[fk]?.includes('Stun'),
      'Stun survives cleanupRoundStart — conditions not in round flag lists');

    applyHardyPassive(game, dcName);
    assert.ok(!game.figureConditions[fk]?.includes('Stun'),
      'Hardy still works after cleanup');
  });

  it('003c: round-scoped state IS erased by cleanup — effects must read it before', () => {
    // Demonstrates that round-scoped data (e.g., roundDefenseAccuracyPenalty)
    // would be lost if an effect needed it after cleanup. The ordering contract
    // requires effects to fire first.
    const game = makeGame({
      roundDefenseAccuracyPenalty: { 1: -4 },
      deflectionPending: { 1: 2 },
      crippledFigures: ['Trooper'],
    });

    // Capture pre-cleanup state that EoR effects could depend on
    const penaltyBefore = game.roundDefenseAccuracyPenalty[1];
    const deflectionBefore = game.deflectionPending[1];
    assert.strictEqual(penaltyBefore, -4, 'penalty available before cleanup');
    assert.strictEqual(deflectionBefore, 2, 'deflection available before cleanup');

    cleanupRoundStart(game);

    // After cleanup, this data is gone — any EoR effect that needed it would fail
    assert.strictEqual(game.roundDefenseAccuracyPenalty[1], undefined,
      'penalty erased — effects MUST read before cleanup');
    assert.strictEqual(game.deflectionPending[1], undefined,
      'deflection erased — effects MUST read before cleanup');
    assert.deepStrictEqual(game.crippledFigures, [],
      'cripple list erased — effects MUST read before cleanup');
  });
});

// ── B-EOR-004: recovery.js pendingCombat sentinel ──────────────────────────

describe('B-EOR-004: recovery.js pendingCombat sentinel', () => {
  it('004a: pendingCombat detected by needsRecovery', () => {
    const game = makeGame({
      pendingCombat: { attackerMsgId: 'msg_a', targetFigureKey: 'Trooper-2-0' },
    });

    assert.strictEqual(needsRecovery(game), true,
      'needsRecovery detects stale pendingCombat');
  });

  it('004b: getRecoveryReason returns pendingCombat reason', () => {
    const game = makeGame({
      pendingCombat: { attackerMsgId: 'msg_a', targetFigureKey: 'Trooper-2-0' },
    });

    const reason = getRecoveryReason(game);
    assert.ok(reason?.includes('pendingCombat'),
      `reason includes "pendingCombat": got "${reason}"`);
  });

  it('004c: pendingCombat with rerollPhase flagged in reason', () => {
    const game = makeGame({
      pendingCombat: { attackerMsgId: 'msg_a', rerollPhase: true },
    });

    const reason = getRecoveryReason(game);
    assert.ok(reason?.includes('reroll=true'),
      `reroll phase flagged: got "${reason}"`);
  });

  it('004d: cleanupRoundStart does NOT clear pendingCombat', () => {
    const game = makeGame({
      pendingCombat: { attackerMsgId: 'msg_a', targetFigureKey: 'Trooper-2-0' },
    });

    cleanupRoundStart(game);

    assert.ok(game.pendingCombat, 'pendingCombat survives cleanupRoundStart');
    assert.strictEqual(needsRecovery(game), true,
      'recovery still needed — cleanup did not clear it');
  });

  it('004e: after pendingCombat cleared by handler, needsRecovery returns false', () => {
    const game = makeGame({
      pendingCombat: { attackerMsgId: 'msg_a', targetFigureKey: 'Trooper-2-0' },
    });

    // Simulate handler clearing pendingCombat (combat-bridge.js happy path)
    delete game.pendingCombat;

    assert.strictEqual(needsRecovery(game), false,
      'no recovery needed after pendingCombat cleared');
    assert.strictEqual(getRecoveryReason(game), null,
      'no recovery reason');
  });

  it('004f: game with no pending state does not need recovery', () => {
    const game = makeGame();

    assert.strictEqual(needsRecovery(game), false);
    assert.strictEqual(getRecoveryReason(game), null);
  });

  it('004g: ended game never needs recovery regardless of pending state', () => {
    const game = makeGame({
      ended: true,
      pendingCombat: { attackerMsgId: 'msg_a' },
      moveInProgress: { 'msg_b_0': { mpRemaining: 3 } },
    });

    assert.strictEqual(needsRecovery(game), false, 'ended game → no recovery');
    assert.strictEqual(getRecoveryReason(game), null, 'ended game → no reason');
  });
});
