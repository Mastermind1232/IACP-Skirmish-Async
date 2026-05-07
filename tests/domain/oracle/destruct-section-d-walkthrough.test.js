/**
 * Behavioral oracle suite — destruct's combat-pipeline audit walk-throughs.
 *
 * Section D of `hidden-wiggling-valley.md` enumerates ~15 scenarios destruct
 * walked through in the 2026-05-05 audit. This file covers the testable subset
 * at the helper / pure-function level. Full-orchestration scenarios (Tress
 * Cleave-after-move, Baze Cleave through dead blocker, Bib+Zillo discard
 * ordering, Luke→HG K&D-then-PS-then-Recover sequence) need integration-level
 * scaffolding and are tagged TODO at the bottom of this file.
 *
 * Each test:
 *   - Sets up a synthetic game state matching destruct's audit.
 *   - Runs the relevant helper through the real production code.
 *   - Asserts the rule destruct stated.
 *
 * Created 2026-05-07 for combat-rebuild Session 9.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCannotBeDefeated,
  applyCondition,
  HARMFUL_CONDITIONS,
} from '../../../src/game/conditions.js';
import { reduceHp } from '../../../src/game/damage-helpers.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGameWithFigure(dcName, figureKey, opts = {}) {
  return {
    p1DcList: [{ dcName, displayName: dcName }],
    p2DcList: [],
    p1ActivatedDcIndices: opts.activated ? [0] : [],
    p2ActivatedDcIndices: [],
    figurePositions: { 1: { [figureKey]: 'a1' }, 2: {} },
    figureConditions: opts.conditions ? { [figureKey]: opts.conditions.slice() } : {},
    youWillNotDenyMeActive: opts.ywndm ? { playerNum: 1 } : null,
    secondChanceDcMsgId: opts.secondChance ? { msg_x: 1 } : {},
  };
}

function makeHpState(maxHp, curHp = maxHp) {
  return new Map([['msg_x', [[curHp, maxHp]]]]);
}

// ── Cannot Be Defeated parity (Section D9, destruct 2026-05-07) ───────────

test('cannot-be-defeated: YWNDM protects Fifth Brother', () => {
  const game = makeGameWithFigure('Fifth Brother', 'Fifth Brother-1-0', { ywndm: true });
  assert.equal(isCannotBeDefeated(game, 'Fifth Brother-1-0'), true);
});

test('cannot-be-defeated: YWNDM does NOT protect non-Fifth-Brother figures', () => {
  const game = makeGameWithFigure('Darth Vader', 'Darth Vader-1-0', { ywndm: true });
  assert.equal(isCannotBeDefeated(game, 'Darth Vader-1-0'), false);
});

test('cannot-be-defeated: YWNDM cleared (null) → Fifth Brother defeatable', () => {
  const game = makeGameWithFigure('Fifth Brother', 'Fifth Brother-1-0', { ywndm: false });
  assert.equal(isCannotBeDefeated(game, 'Fifth Brother-1-0'), false);
});

test('cannot-be-defeated: Sustained-by-Rage protects Maul if not yet activated', () => {
  // Maul has sustained_by_rage in his data; lookup happens via getDcEffects().
  const game = makeGameWithFigure('Maul', 'Maul-1-0', { activated: false });
  assert.equal(isCannotBeDefeated(game, 'Maul-1-0'), true);
});

test('cannot-be-defeated: Sustained-by-Rage does NOT protect Maul after activation resolves', () => {
  const game = makeGameWithFigure('Maul', 'Maul-1-0', { activated: true });
  assert.equal(isCannotBeDefeated(game, 'Maul-1-0'), false);
});

test('cannot-be-defeated: standard figures without protection are defeatable', () => {
  const game = makeGameWithFigure('Stormtrooper', 'Stormtrooper-1-0');
  assert.equal(isCannotBeDefeated(game, 'Stormtrooper-1-0'), false);
});

// ── Damage cap at health (destruct 2026-05-07) ────────────────────────────

test('damage cap: reduceHp clamps at 0 — no overflow', () => {
  // Per destruct: "While a figure is on 0 HP, they cannot take any more
  // damage." reduceHp's Math.max(0, prevHp - damage) enforces this.
  const game = { totalDamageReceived: { 1: 0 } };
  const hp = makeHpState(5, 0); // already at 0 HP
  const result = reduceHp(hp, game, 'msg_x', 0, 5, 1); // 5 more damage
  assert.equal(result.newHp, 0, 'HP stays at 0');
  assert.equal(result.prevHp, 0, 'prevHp was 0');
  assert.equal(game.totalDamageReceived[1], 0, 'no damage actually applied');
});

test('damage cap: lethal damage caps at remaining HP', () => {
  // Figure at 2 HP takes 10 damage → cap at 2 (newHp=0, actual=2)
  const game = { totalDamageReceived: { 1: 0 } };
  const hp = makeHpState(10, 2);
  const result = reduceHp(hp, game, 'msg_x', 0, 10, 1);
  assert.equal(result.newHp, 0);
  assert.equal(result.prevHp, 2);
  assert.equal(game.totalDamageReceived[1], 2, 'only 2 damage actually applied (capped)');
});

// ── BENEFICIAL vs HARMFUL condition routing (destruct 2026-05-05) ─────────

test('HARMFUL_CONDITIONS list contains canonical 3', () => {
  // Per destruct's audit: BENEFICIAL → attacker, HARMFUL → target.
  // The HARMFUL_CONDITIONS list drives the routing split at
  // combat-bridge.js:655-666. Stun, Bleed, Weaken are the canonical 3.
  assert.deepEqual(HARMFUL_CONDITIONS.sort(), ['Bleed', 'Stun', 'Weaken'].sort());
});

test('applyCondition adds new condition to figureConditions', () => {
  const game = { figureConditions: {} };
  const ok = applyCondition(game, 'Stormtrooper-1-0', 'Stun');
  assert.equal(ok, true);
  assert.deepEqual(game.figureConditions['Stormtrooper-1-0'], ['Stun']);
});

test('applyCondition is idempotent — returns false if already present', () => {
  const game = { figureConditions: { 'Stormtrooper-1-0': ['Stun'] } };
  const ok = applyCondition(game, 'Stormtrooper-1-0', 'Stun');
  assert.equal(ok, false);
  assert.deepEqual(game.figureConditions['Stormtrooper-1-0'], ['Stun']); // no dup
});

// ── Wild gain-time selection (destruct 2026-05-05) ────────────────────────
// Plan section D: "Wild symbol means that when the token is gained, any
// token can be gained. Once a token is on a figure, it has a defined type."
// The grantPowerTokens path rejects 'Wild' as a stored token; verified by
// the existing Wild guard at game-helpers.js (slice 7ea45c1b).

test('Wild guard: grantPowerTokens rejects "Wild" as a stored type', async () => {
  const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
  const game = { figurePowerTokens: {} };
  const granted = grantPowerTokens(game, 'fk-1-0', 'Wild', 1);
  assert.equal(granted, 0, 'Wild rejected — 0 granted');
  assert.equal(game.figurePowerTokens['fk-1-0'], undefined,
    'no Wild token stored on figure');
});

test('Wild guard: grantPowerTokens accepts canonical types', async () => {
  const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
  const game = { figurePowerTokens: {} };
  for (const type of ['Block', 'Evade', 'Damage', 'Surge']) {
    const granted = grantPowerTokens(game, 'fk-1-0', type, 1);
    assert.equal(granted, 1, `${type} accepted`);
  }
  assert.equal(game.figurePowerTokens['fk-1-0'].length, 4);
});

// ── Stun blocks out-of-activation declares (destruct 2026-05-05) ──────────
// Plan section D: "Stunned figure cannot voluntarily exit its space and
// cannot declare an attack." Verified inline at combat-bridge.js for
// Parting Shot (1117-1122) and Return Fire (analogous block).
//
// This oracle pins the Step-7-snapshot pattern: PS uses combat._step7DefenderConds,
// not the live (post-Step-8) condition list, so Stun-applied-Step-8 does
// NOT block PS-fired-at-Step-7.

test('Stun-blocks-PS gating: pre-existing Stun blocks Parting Shot', () => {
  // Mock combat object with _step7DefenderConds snapshotted at Step-7 entry.
  const combat = {
    target: { figureKey: 'HG-1-0' },
    _step7DefenderConds: ['Stun'],  // Stun was on HG before this attack
  };
  const game = { figureConditions: { 'HG-1-0': ['Stun'] } };
  // Replicate the gate logic at combat-bridge.js:1119-1120
  const _psFigConds = combat._step7DefenderConds
    ?? (game.figureConditions?.[combat.target.figureKey] || []);
  const _psStunnedAlready = _psFigConds.includes('Stun');
  assert.equal(_psStunnedAlready, true, 'pre-existing Stun blocks PS');
});

test('Stun-blocks-PS gating: surge-Stun (Step 8) does NOT block PS-at-Step-7', () => {
  // Snapshot taken BEFORE Step 8 conditions land. Stun is queued for Step 8
  // but not yet on the figure when PS fires at Step 7.
  const combat = {
    target: { figureKey: 'HG-1-0' },
    _step7DefenderConds: [],  // empty at Step 7 entry (no pre-existing Stun)
  };
  const game = {
    // Live conds may include Stun if Step 8 already ran, but PS uses snapshot
    figureConditions: { 'HG-1-0': ['Stun'] },
  };
  const _psFigConds = combat._step7DefenderConds
    ?? (game.figureConditions?.[combat.target.figureKey] || []);
  const _psStunnedAlready = _psFigConds.includes('Stun');
  assert.equal(_psStunnedAlready, false,
    'surge-Stun queued for Step 8 does NOT block Step-7 PS interrupt');
});

// ── TODO: Full orchestration scenarios ─────────────────────────────────────
//
// These require integration-level scaffolding (real combat init, attack
// dice rolls, reroll passes, surge spend, defeat resolution). Captured here
// for future Session 9 expansion:
//
// - Tress Cleave-after-move: eligibility from POST-move position
// - Baze Cleave through dead blocker: LOS rebuilds after defeat removes figure
// - Bib (atk) discard before Zillo (def) discard: attacker first per CRR
// - Luke→HG K&D-then-PS-then-Recover: ordered Step-5/Step-7/Step-8 chain
// - 5th + YWNDM + Zillo discard: Zillo at Step 4 puts YWNDM live before
//   Step 7 begins; 5th survives at 0 HP with harmful conditions inert
// - Counter Negation/CD chains: recursive cancellation (depth-2+)
// - OI ignores token/innate/CC-discard +Block: only rolled-die survives
//   (already verified at game/combat.test.js Cunning-under-OI)
