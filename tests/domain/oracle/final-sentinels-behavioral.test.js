/**
 * BEHAVIORAL final sentinel tests — closure pass.
 *
 * Four narrow, high-signal sentinels covering the last believable blind spots:
 *   B-SENT-001: Condition immunity (Onar Koma, Snowtrooper Elite, Fifth Brother)
 *   B-SENT-002: Multi-figure deployment-group activation cleanup
 *   B-SENT-003: Bossk + Hardy EoR interaction
 *   B-SENT-004: Cross-player activation flag isolation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupActivation } from '../../../src/game/activation-state.js';
import { applyCondition, filterCondition, isConditionImmune, HARMFUL_CONDITIONS } from '../../../src/game/conditions.js';
import { healHpDistributed } from '../../../src/game/damage-helpers.js';

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

/** Reproduce Bossk Regenerate EoR effect (round.js:331-346). */
function applyBosskRegenerate(dcHealthState, game, msgId, playerNum) {
  const { totalRecovered, perFigure } = healHpDistributed(dcHealthState, game, msgId, 2, playerNum);
  for (const fk of Object.keys(game.figureConditions || {})) {
    if (!fk.startsWith('Bossk-')) continue;
    filterCondition(game, fk, 'Bleed');
  }
  return { totalRecovered, perFigure };
}

/** Reproduce Hardy EoR effect (round.js:347-364). */
function applyHardyPassive(game, dcName) {
  const HARMFUL = ['Bleed', 'Stun', 'Weaken'];
  for (const fk of Object.keys(game.figureConditions || {})) {
    if (!fk.startsWith(dcName + '-')) continue;
    for (const h of HARMFUL) filterCondition(game, fk, h);
  }
}

// ── B-SENT-001: Condition immunity ─────────────────────────────────────────

describe('B-SENT-001: Condition immunity — harmful conditions rejected', () => {
  it('001a: Onar Koma is immune to harmful conditions', () => {
    const game = makeGame();
    assert.strictEqual(isConditionImmune(game, 'Onar Koma-1-0'), true,
      'Onar Koma detected as immune');
  });

  it('001b: Snowtrooper (Elite) is immune to harmful conditions', () => {
    const game = makeGame();
    assert.strictEqual(isConditionImmune(game, 'Snowtrooper (Elite)-2-0'), true,
      'Snowtrooper (Elite) detected as immune');
  });

  it('001c: Fifth Brother NOT immune under YWNDM (effects suppressed, not blocked)', () => {
    // Per destruct 2026-05-05: YWNDM applies conditions but suppresses
    // their effects (token placed, downstream effects skipped). Immunity
    // would block placement entirely — wrong for this card.
    const game = makeGame({ youWillNotDenyMeActive: true });
    assert.strictEqual(isConditionImmune(game, 'Fifth Brother-2-0'), false,
      'Fifth Brother is NOT immune under YWNDM — conditions still applied');
  });

  it('001d: Fifth Brother NOT immune when ability inactive', () => {
    const game = makeGame();
    assert.strictEqual(isConditionImmune(game, 'Fifth Brother-2-0'), false,
      'Fifth Brother vulnerable when ability not active');
  });

  it('001e: non-immune figure correctly returns false', () => {
    const game = makeGame();
    assert.strictEqual(isConditionImmune(game, 'Stormtrooper (Elite)-1-0'), false);
    assert.strictEqual(isConditionImmune(game, 'IG-88-2-0'), false);
  });

  it('001f: applyCondition still mutates state for immune figures (caller must gate)', () => {
    // isConditionImmune is a CHECK — applyCondition itself does not gate on it.
    // The handler is responsible for checking immunity before applying.
    // This sentinel proves the separation so callers know they must check.
    const game = makeGame();
    const applied = applyCondition(game, 'Onar Koma-1-0', 'Stun');
    assert.strictEqual(applied, true,
      'applyCondition does not check immunity — caller responsibility');
    assert.ok(game.figureConditions['Onar Koma-1-0']?.includes('Stun'),
      'condition written (handler should have gated this)');
  });
});

// ── B-SENT-002: Multi-figure DG activation cleanup ─────────────────────────

describe('B-SENT-002: Multi-figure deployment-group activation cleanup', () => {
  it('002a: 3-figure DG — all figureKey-scoped flags cleaned', () => {
    const game = makeGame();
    const msgId = 'msg_troopers';
    const fks = [
      'Stormtrooper (Elite)-1-0',
      'Stormtrooper (Elite)-1-1',
      'Stormtrooper (Elite)-1-2',
    ];

    // Set per-figKey flags for all 3 figures
    game.figureMoved = {};
    game.tripodAttacked = {};
    for (const fk of fks) {
      game.figureMoved[fk] = true;
      game.tripodAttacked[fk] = true;
    }
    // Set per-msgId flags
    game.dcActionsData = { [msgId]: { remaining: 0, total: 2 } };
    game.movementBank = { [msgId]: { total: 4, remaining: 0 } };
    // Set moveInProgress compound keys for all 3 figures
    game.moveInProgress = {
      [`${msgId}_0`]: { figureKey: fks[0], mpRemaining: 0 },
      [`${msgId}_1`]: { figureKey: fks[1], mpRemaining: 0 },
      [`${msgId}_2`]: { figureKey: fks[2], mpRemaining: 0 },
    };

    cleanupActivation(game, msgId, 1, fks);

    // All 3 figureKeys cleaned
    for (const fk of fks) {
      assert.strictEqual(game.figureMoved?.[fk], undefined, `figureMoved[${fk}] cleaned`);
      assert.strictEqual(game.tripodAttacked?.[fk], undefined, `tripodAttacked[${fk}] cleaned`);
    }
    // msgId-scoped cleaned
    assert.strictEqual(game.dcActionsData?.[msgId], undefined, 'dcActionsData cleaned');
    assert.strictEqual(game.movementBank?.[msgId], undefined, 'movementBank cleaned');
    // All compound moveInProgress keys cleaned
    assert.strictEqual(game.moveInProgress[`${msgId}_0`], undefined, 'moveInProgress_0 cleaned');
    assert.strictEqual(game.moveInProgress[`${msgId}_1`], undefined, 'moveInProgress_1 cleaned');
    assert.strictEqual(game.moveInProgress[`${msgId}_2`], undefined, 'moveInProgress_2 cleaned');
  });

  it('002b: 3-figure DG cleanup preserves other DG state', () => {
    const game = makeGame();
    const msgA = 'msg_troopers';
    const msgB = 'msg_rebels';
    const fksA = ['Stormtrooper (Elite)-1-0', 'Stormtrooper (Elite)-1-1', 'Stormtrooper (Elite)-1-2'];
    const fkB = 'Rebel Trooper (Elite)-2-0';

    game.figureMoved = {};
    for (const fk of fksA) game.figureMoved[fk] = true;
    game.figureMoved[fkB] = true;

    game.dcActionsData = {
      [msgA]: { remaining: 0, total: 2 },
      [msgB]: { remaining: 1, total: 2 },
    };

    cleanupActivation(game, msgA, 1, fksA);

    // A's 3 figures cleaned
    for (const fk of fksA) {
      assert.strictEqual(game.figureMoved?.[fk], undefined);
    }
    // B preserved
    assert.strictEqual(game.figureMoved[fkB], true, 'other DG figureMoved preserved');
    assert.deepStrictEqual(game.dcActionsData[msgB], { remaining: 1, total: 2 },
      'other DG dcActionsData preserved');
  });
});

// ── B-SENT-003: Bossk + Hardy EoR interaction ──────────────────────────────

describe('B-SENT-003: Bossk + Hardy EoR interaction', () => {
  it('003a: Bossk removes own Bleed, then Hardy removes own Stun — no over-clear', () => {
    const dcHealthState = new Map();
    const bosskMsgId = 'msg_bossk';
    const hardyDcName = 'Trandoshan Hunter (Elite)';
    const bosskFk = 'Bossk-2-0';
    const hardyFk = `${hardyDcName}-2-0`;

    dcHealthState.set(bosskMsgId, [[5, 7]]);
    const game = makeGame();

    // Both have harmful conditions
    applyCondition(game, bosskFk, 'Bleed');
    applyCondition(game, bosskFk, 'Weaken');
    applyCondition(game, hardyFk, 'Stun');
    applyCondition(game, hardyFk, 'Bleed');
    applyCondition(game, hardyFk, 'Focus');

    // Step 1: Bossk Regenerate (fires first per round.js ordering)
    applyBosskRegenerate(dcHealthState, game, bosskMsgId, 2);

    // Bossk: Bleed gone, Weaken still present (regen only removes Bleed)
    assert.ok(!game.figureConditions[bosskFk]?.includes('Bleed'), 'Bossk Bleed removed');
    assert.ok(game.figureConditions[bosskFk]?.includes('Weaken'), 'Bossk Weaken preserved');
    // Hardy figure: untouched by Bossk's regeneration
    assert.ok(game.figureConditions[hardyFk]?.includes('Stun'), 'Hardy Stun still present');
    assert.ok(game.figureConditions[hardyFk]?.includes('Bleed'), 'Hardy Bleed still present');

    // Step 2: Hardy Passive (fires second)
    applyHardyPassive(game, hardyDcName);

    // Hardy figure: all harmful gone, Focus preserved
    assert.ok(!game.figureConditions[hardyFk]?.includes('Stun'), 'Hardy Stun cleared');
    assert.ok(!game.figureConditions[hardyFk]?.includes('Bleed'), 'Hardy Bleed cleared');
    assert.ok(game.figureConditions[hardyFk]?.includes('Focus'), 'Hardy Focus preserved');
    // Bossk: Weaken still present (Hardy only affects its own DC)
    assert.ok(game.figureConditions[bosskFk]?.includes('Weaken'),
      'Bossk Weaken not touched by Hardy (different DC)');
    // HP recovery happened
    assert.strictEqual(dcHealthState.get(bosskMsgId)[0][0], 7, 'Bossk healed 5 → 7');
  });

  it('003b: idempotent — Hardy re-removing already-removed Bleed is a no-op', () => {
    const game = makeGame();
    const dcName = 'Trandoshan Hunter (Elite)';
    const fk = `${dcName}-2-0`;
    applyCondition(game, fk, 'Bleed');

    // First removal
    filterCondition(game, fk, 'Bleed');
    assert.ok(!game.figureConditions[fk]?.includes('Bleed'), 'first removal works');

    // Second removal (idempotent — no crash, no mutation)
    filterCondition(game, fk, 'Bleed');
    // Should not throw, and figureConditions should be clean
    assert.ok(!game.figureConditions[fk]?.length || !game.figureConditions[fk]?.includes('Bleed'),
      'idempotent removal — no crash or corruption');
  });
});

// ── B-SENT-004: Cross-player activation flag isolation ─────────────────────

describe('B-SENT-004: Cross-player activation flag isolation', () => {
  it('004a: P1 activation cleanup does not erase P2 figure-scoped flags', () => {
    const game = makeGame();
    // Per-figure 2026-05-09 (multifigure-independent-activation rule).
    game.nextAttacksBonusHits = {
      'Trooper-1-0': [{ source: 'cc_a', hits: 1 }],
      'IG-88-2-0': [{ source: 'cc_b', hits: 2 }],
    };
    game.nextAttackBonusPierce = { 'Trooper-1-0': 3, 'IG-88-2-0': 1 };

    // P1's activation ends
    cleanupActivation(game, 'msg_p1', 1, ['Trooper-1-0']);

    // P1's figure-scoped flags cleaned
    assert.strictEqual(game.nextAttacksBonusHits?.['Trooper-1-0'], undefined, 'P1 bonus hits cleaned');
    assert.strictEqual(game.nextAttackBonusPierce?.['Trooper-1-0'], undefined, 'P1 bonus pierce cleaned');
    // P2's figure-scoped flags preserved
    assert.deepStrictEqual(game.nextAttacksBonusHits?.['IG-88-2-0'], [{ source: 'cc_b', hits: 2 }],
      'P2 bonus hits preserved');
    assert.strictEqual(game.nextAttackBonusPierce?.['IG-88-2-0'], 1, 'P2 bonus pierce preserved');
  });

  it('004b: sequential P1 → P2 activations — no cross-contamination', () => {
    const game = makeGame();

    // P1 activates
    game.figureMoved = { 'Trooper-1-0': true };
    game.dcActionsData = { msg_p1: { remaining: 0, total: 2 } };
    // Per-figure 2026-05-09 (multifigure-independent-activation rule).
    game.nextAttacksBonusHits = { 'Trooper-1-0': [{ source: 'test' }] };
    game.commsJammerActivePlayerNum = 1;

    cleanupActivation(game, 'msg_p1', 1, ['Trooper-1-0']);

    // P2 activates
    game.figureMoved = game.figureMoved || {};
    game.figureMoved['IG-88-2-0'] = true;
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData['msg_p2'] = { remaining: 1, total: 2 };
    game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
    game.nextAttacksBonusHits['IG-88-2-0'] = [{ source: 'p2_cc' }];

    // P1 state must not be present during P2's activation
    assert.strictEqual(game.figureMoved['Trooper-1-0'], undefined, 'P1 figureMoved gone');
    assert.strictEqual(game.dcActionsData['msg_p1'], undefined, 'P1 dcActionsData gone');
    assert.strictEqual(game.nextAttacksBonusHits['Trooper-1-0'], undefined, 'P1 bonus gone');
    assert.strictEqual(game.commsJammerActivePlayerNum, undefined, 'P1 scalar gone');

    // P2 state is live
    assert.strictEqual(game.figureMoved['IG-88-2-0'], true, 'P2 figureMoved live');
    assert.strictEqual(game.dcActionsData['msg_p2'].remaining, 1, 'P2 dcActionsData live');

    // P2 activation ends
    cleanupActivation(game, 'msg_p2', 2, ['IG-88-2-0']);

    // Everything clean
    assert.strictEqual(game.figureMoved?.['IG-88-2-0'], undefined, 'P2 figureMoved cleaned');
    assert.strictEqual(game.dcActionsData?.['msg_p2'], undefined, 'P2 dcActionsData cleaned');
    assert.strictEqual(game.nextAttacksBonusHits?.['IG-88-2-0'], undefined, 'P2 bonus cleaned');
  });
});
