/**
 * Oracle tests for Concentrated Fire — playableBy + Ranged attack type gate.
 *
 * Rule: "Use when another friendly TROOPER declares an attack targeting a
 *        target in your line of sight. If you have the Ranged attack type,
 *        add 1 red die to the attack pool. You become Stunned."
 *
 * Confirmed-safe core:
 *   - playableBy is TROOPER (not "Any Figure") — only TROOPERs can play this CC
 *   - Die bonus is gated on requireRangedAttackType: only added if a non-attacker
 *     friendly figure has Ranged attack type
 *   - Stun (applySelfStunAfterAttack) is unconditional — fires even if die is blocked
 *   - When all non-attacker figures are melee, die bonus is skipped
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { isCcPlayLegalByRestriction } from '../../../src/game/cc-timing.js';

// ── ORACLE-CFIRE-001: Die bonus granted when Ranged non-attacker exists ───────
describe('ORACLE-CFIRE-001: Die bonus granted when Ranged non-attacker exists', () => {
  it('001: red die added when a friendly non-attacker has Ranged attack type', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',  // attacker (ranged, but excluded — it's the attacker)
          'Stormtrooper (Elite)-1-1': 'D5',  // non-attacker, ranged → qualifies
        },
      },
    };

    const result = resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.equal(result.applied, true);
    assert.equal(combat.attackBonusDice, 1, 'Should add 1 attack bonus die');
    assert.deepStrictEqual(combat.attackBonusDiceColors, ['red'], 'Die should be red');
    assert.ok(!result.logMessage.includes('skipped'), 'Should not say die was skipped');
  });
});

// ── ORACLE-CFIRE-002: Die bonus blocked when all non-attackers are melee ──────
describe('ORACLE-CFIRE-002: Die bonus blocked when all non-attackers are melee', () => {
  it('002: no die added when only melee non-attacker figures exist', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',  // attacker
          'Darth Vader-1-0': 'D5',            // non-attacker, melee
          'Emperor Palpatine-1-0': 'D6',      // non-attacker, melee
        },
      },
    };

    const result = resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.equal(result.applied, true, 'CC still resolves (stun applies)');
    assert.equal(combat.attackBonusDice, undefined, 'No die should be added');
    assert.ok(result.logMessage.includes('skipped'), 'Log should indicate die was skipped');
  });
});

// ── ORACLE-CFIRE-003: Stun flag is unconditional (fires even when die blocked) ─
describe('ORACLE-CFIRE-003: Stun is unconditional', () => {
  it('003: applySelfStunAfterAttack is set even when die is blocked', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',
          'Darth Vader-1-0': 'D5',  // melee only
        },
      },
    };

    resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.ok(
      game.applySelfStunAfterAttackPlayerNum?.[1],
      'Stun flag must be set even when die bonus is blocked'
    );
  });

  it('003b: applySelfStunAfterAttack is set when die is granted', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',
          'Stormtrooper (Elite)-1-1': 'D5',  // ranged non-attacker
        },
      },
    };

    resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.ok(
      game.applySelfStunAfterAttackPlayerNum?.[1],
      'Stun flag must be set when die bonus is granted'
    );
  });
});

// ── ORACLE-CFIRE-004: Mixed squad — Ranged + Melee non-attackers ─────────────
describe('ORACLE-CFIRE-004: Mixed squad with Ranged and Melee non-attackers', () => {
  it('004: die bonus granted when at least one non-attacker is Ranged', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',  // attacker
          'Darth Vader-1-0': 'D5',            // melee
          'Stormtrooper (Elite)-1-1': 'D6',   // ranged → qualifies
        },
      },
    };

    const result = resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.equal(combat.attackBonusDice, 1, 'Die should be added (ranged non-attacker exists)');
    assert.ok(!result.logMessage.includes('skipped'), 'Die should not be skipped');
  });
});

// ── ORACLE-CFIRE-005b: Ranged non-TROOPER does NOT qualify for die bonus ──────
describe('ORACLE-CFIRE-005b: Ranged non-TROOPER does not unlock die bonus', () => {
  it('005b: die blocked when only non-attacker Ranged figure is non-TROOPER', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',  // attacker (Ranged TROOPER, excluded)
          'Boba Fett-1-0': 'D5',              // non-attacker, Ranged but NOT TROOPER
        },
      },
    };

    const result = resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.equal(result.applied, true, 'CC still resolves (stun applies)');
    assert.equal(combat.attackBonusDice, undefined, 'No die — Boba is not a TROOPER');
    assert.ok(result.logMessage.includes('skipped'), 'Log should say die was skipped');
  });
});

// ── ORACLE-CFIRE-005: playableBy is TROOPER (not "Any Figure") ────────────────
describe('ORACLE-CFIRE-005: playableBy restriction is TROOPER', () => {
  it('005a: legal when player has a TROOPER DC', () => {
    const game = {
      p1DcList: [{ dcName: 'Stormtrooper (Elite)' }],
      p2DcList: [],
    };
    const result = isCcPlayLegalByRestriction(game, 1, 'Concentrated Fire');
    assert.equal(result.legal, true, 'Should be legal — player has Stormtrooper (TROOPER)');
  });

  it('005b: illegal when player has no TROOPER DCs', () => {
    const game = {
      p1DcList: [{ dcName: 'Darth Vader' }, { dcName: 'Emperor Palpatine' }],
      p2DcList: [],
    };
    const result = isCcPlayLegalByRestriction(game, 1, 'Concentrated Fire');
    assert.equal(result.legal, false, 'Should be illegal — no TROOPER in army');
  });
});
