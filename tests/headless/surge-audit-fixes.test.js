/**
 * Surge-ability audit fixes (2026-06-21): behavioral tests for four gaps.
 *
 *   1. 0-0-0 "Shocking Palm"  — attack MISSES, defender Stunned unconditionally.
 *   2. Mak Eshka'rey "Critical Hit" — CC-lockout deferred to >=1 damage.
 *   3. Maul "Stalk Prey"      — +2 MP / Damage Token granted even on a miss.
 *   4. Biv Bodhrik "Suppression" — Strain counts numeric dodge results.
 *
 * Classification: harness (test-only, no production changes).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCombatResult } from '../../src/game/combat.js';
import {
  enqueueAttackerStep8Effects,
  enqueueAttackerPerDcEffects,
} from '../../src/handlers/after-attack-resolve.js';
import { getAfterAttackEffects } from '../../src/engine/after-attack-queue.js';

// ── 1. Shocking Palm ──────────────────────────────────────────────────────────
describe('Shocking Palm (0-0-0) surge', () => {
  it('computeCombatResult: attack is a MISS with 0 damage + Stun queued (would-have-hit case)', () => {
    const bonusConditions = [];
    const r = computeCombatResult({
      attackRoll: { acc: 3, dmg: 5, surge: 1 },
      defenseRoll: { block: 0, evade: 0 },
      attackMissAndStun: true,
      bonusConditions,
    });
    assert.equal(r.hit, false, 'must be a real miss, not a 0-damage hit');
    assert.equal(r.damage, 0);
    assert.ok(/MISS/.test(r.resultText));
    assert.ok(bonusConditions.includes('Stun'));
  });

  it('computeCombatResult: MISS + Stun queued even when fully blocked', () => {
    const bonusConditions = [];
    const r = computeCombatResult({
      attackRoll: { acc: 3, dmg: 2, surge: 0 },
      defenseRoll: { block: 9, evade: 0 },
      attackMissAndStun: true,
      bonusConditions,
    });
    assert.equal(r.hit, false);
    assert.equal(r.damage, 0);
    assert.ok(bonusConditions.includes('Stun'));
  });

  it('the queued Stun lands as a step-8 condition button (applied independent of damage)', () => {
    // Mirrors the combat-bridge append: on a Shocking Palm miss the Stun is
    // pushed onto _step8Conditions, and enqueueAttackerStep8Effects renders it
    // as an attacker "Apply Stun" button even though damage is 0.
    const combat = {
      _step7Hit: false,
      _step7Damage: 0,
      attackerMsgId: 'atkA',
      _step8Conditions: [{ condition: 'Stun', recipient: 'target' }],
    };
    enqueueAttackerStep8Effects(combat);
    const conds = getAfterAttackEffects(combat, 'attacker').filter((e) => e.type === 'condition');
    assert.equal(conds.length, 1);
    assert.equal(conds[0].payload.condition, 'Stun');
    assert.equal(conds[0].payload.recipient, 'target');
  });
});

// ── 2. Critical Hit (deferred CC lockout) ─────────────────────────────────────
describe("Mak Eshka'rey Critical Hit surge", () => {
  // Replicates the combat-bridge gate: game.criticalHitBlockedPlayer is set only
  // when surgeCriticalHitPending AND _step7Damage >= 1.
  function resolveCcLockout(game, combat) {
    if (combat.surgeCriticalHitPending && (combat._step7Damage || 0) >= 1) {
      game.criticalHitBlockedPlayer = combat.defenderPlayerNum;
    }
  }

  it('blocks the defender CCs when the target suffered >=1 Damage', () => {
    const game = {};
    resolveCcLockout(game, { surgeCriticalHitPending: true, _step7Damage: 3, defenderPlayerNum: 2 });
    assert.equal(game.criticalHitBlockedPlayer, 2);
  });

  it('does NOT block when the target suffered 0 Damage (fully blocked)', () => {
    const game = {};
    resolveCcLockout(game, { surgeCriticalHitPending: true, _step7Damage: 0, defenderPlayerNum: 2 });
    assert.equal(game.criticalHitBlockedPlayer, undefined);
  });

  it('does NOT block on a miss (no damage)', () => {
    const game = {};
    resolveCcLockout(game, { surgeCriticalHitPending: true, _step7Hit: false, _step7Damage: 0, defenderPlayerNum: 1 });
    assert.equal(game.criticalHitBlockedPlayer, undefined);
  });
});

// ── 3. Stalk Prey (no miss clause) ────────────────────────────────────────────
describe('Maul Stalk Prey surge', () => {
  const deps = { getDcEffects: () => ({}) };

  it('grants +2 MP / 1 Damage Token even when the attack MISSED', () => {
    const combat = {
      surgeStalkPrey: true,
      _step7Hit: false, // miss
      attackerMsgId: 'atkA',
      attackerFigureKey: 'maul#1',
    };
    enqueueAttackerPerDcEffects(combat, {}, deps);
    const sp = getAfterAttackEffects(combat, 'attacker').filter((e) => e.type === 'stalk_prey');
    assert.equal(sp.length, 1, 'Stalk Prey grant must fire even on a miss');
  });

  it('also fires on a hit', () => {
    const combat = {
      surgeStalkPrey: true,
      _step7Hit: true,
      attackerMsgId: 'atkA',
      attackerFigureKey: 'maul#1',
    };
    enqueueAttackerPerDcEffects(combat, {}, deps);
    assert.equal(getAfterAttackEffects(combat, 'attacker').filter((e) => e.type === 'stalk_prey').length, 1);
  });
});

// ── 4. Suppression (numeric dodge count) ──────────────────────────────────────
describe('Biv Bodhrik Suppression surge', () => {
  // Replicates the combat-bridge strain calc.
  const supAmt = (roll) => Math.min((roll.block || 0) + (roll.evade || 0) + (roll.dodge || 0), 2);

  it('counts a 2-dodge / 0-block / 0-evade roll as 2 strain (capped)', () => {
    assert.equal(supAmt({ block: 0, evade: 0, dodge: 2 }), 2);
  });

  it('does NOT treat dodge as binary (1 dodge = 1 strain, not capped to 1 of a larger set)', () => {
    assert.equal(supAmt({ block: 1, evade: 0, dodge: 1 }), 2);
  });

  it('caps total at 2', () => {
    assert.equal(supAmt({ block: 2, evade: 1, dodge: 2 }), 2);
  });

  it('1 dodge yields 1 strain', () => {
    assert.equal(supAmt({ block: 0, evade: 0, dodge: 1 }), 1);
  });
});
