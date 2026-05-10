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

// ── ORACLE-CFIRE-002: No effect when all non-attackers are melee ─────────────
// Per alexanbv 2026-05-09: Concentrated Fire is PLAYED by the supporting
// Ranged TROOPER. If no eligible supporter exists, the card cannot be played
// (no die bonus, no Stun, no effect — the entire card whiffs).
describe('ORACLE-CFIRE-002: No effect when no eligible Ranged TROOPER supporter', () => {
  it('002: no die and no stun when only melee non-attacker figures exist', () => {
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

    assert.equal(result.applied, true, 'CC resolves');
    assert.equal(combat.attackBonusDice, undefined, 'No die should be added');
    assert.equal(game.applySelfStunAfterAttackFigureKey, undefined,
      'No Stun without an eligible supporter to be Stunned');
    assert.ok(result.logMessage.toLowerCase().includes('no ranged non-attacker'),
      'Log should explain why the card has no effect');
  });
});

// ── ORACLE-CFIRE-003: Stun targets the supporter, not the attacker ───────────
// Per alexanbv 2026-05-09: card text "you become Stunned" — "you" is the
// supporting TROOPER who played the card, not the attacker.
describe('ORACLE-CFIRE-003: Stun lands on the supporter figure, not the attacker', () => {
  it('003: applySelfStunAfterAttackFigureKey records supporter figure when single eligible', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',
          'Stormtrooper (Elite)-1-1': 'D5',  // single eligible Ranged TROOPER
        },
      },
    };

    resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.equal(
      game.applySelfStunAfterAttackFigureKey?.[1],
      'Stormtrooper (Elite)-1-1',
      'Stun keyed on supporter figureKey, NOT attacker figureKey',
    );
  });

  it('003b: multiple eligible supporters → resolver returns requiresChoice', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',
          'Stormtrooper (Elite)-1-1': 'D5',
          'Stormtrooper (Elite)-1-2': 'D6',
        },
      },
    };

    const result = resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });

    assert.equal(result.requiresChoice, true,
      'multiple eligible supporters → picker required');
    assert.equal(result.choiceValues?.length, 2,
      'two non-attacker figures offered');
    assert.equal(game.applySelfStunAfterAttackFigureKey, undefined,
      'Stun not yet applied — waiting for player choice');
  });

  it('003c: chosenFigureKey resolves the play and stamps Stun on chosen supporter', () => {
    const combat = {
      attackerPlayerNum: 1,
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      attackerMsgId: 'msg_storm',
    };
    const game = {
      figurePositions: {
        1: {
          'Stormtrooper (Elite)-1-0': 'D4',
          'Stormtrooper (Elite)-1-1': 'D5',
          'Stormtrooper (Elite)-1-2': 'D6',
        },
      },
    };

    resolveAbility('Concentrated Fire', {
      game, playerNum: 1, combat,
      chosenFigureKey: 'Stormtrooper (Elite)-1-2',
    });

    assert.equal(combat.attackBonusDice, 1, 'die added');
    assert.equal(
      game.applySelfStunAfterAttackFigureKey?.[1],
      'Stormtrooper (Elite)-1-2',
      'Stun lands on the chosen supporter, not the attacker',
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

// ── ORACLE-CFIRE-005b: Ranged non-TROOPER is not an eligible supporter ───────
describe('ORACLE-CFIRE-005b: Ranged non-TROOPER does not unlock the play', () => {
  it('005b: card has no effect when only non-attacker Ranged figure is non-TROOPER', () => {
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

    assert.equal(result.applied, true, 'CC resolves (no error)');
    assert.equal(combat.attackBonusDice, undefined, 'No die — Boba is not a TROOPER');
    assert.equal(game.applySelfStunAfterAttackFigureKey, undefined,
      'No Stun — no eligible supporter to be Stunned');
    assert.ok(result.logMessage.toLowerCase().includes('no ranged non-attacker'),
      'Log should explain why the card has no effect');
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
