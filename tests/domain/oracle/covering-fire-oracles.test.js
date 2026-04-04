/**
 * Oracle tests for Covering Fire — TROOPER Hide + round Surge:Stun.
 *
 * Rule: "Use at the start of the round. Up to 3 friendly TROOPERs become Hidden.
 *        During this round, each of your TROOPERs gains:
 *        Surge: Stun. If the target was already Stunned, apply +2 Damage to the attack results."
 *
 * Confirmed-safe core:
 *   - Hides up to 3 friendly TROOPERs (keyword-gated, not just activating group)
 *   - Sets round-scoped flag for TROOPER Surge:Stun + conditional +2 Damage
 *   - Non-TROOPER figures are not hidden
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

// ── Helper ───────────────────────────────────────────────────────────────────
function buildCoveringFireGame() {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();

  const stormMsgId = 'msg_storm';
  dcMessageMeta.set(stormMsgId, {
    gameId: 'testgame', playerNum: 1, dcName: 'Stormtrooper (Elite)',
    displayName: 'Stormtrooper (Elite) [DG 1]',
  });
  dcHealthState.set(stormMsgId, [[6, 6]]);

  // Non-TROOPER: Darth Vader
  const vaderMsgId = 'msg_vader';
  dcMessageMeta.set(vaderMsgId, {
    gameId: 'testgame', playerNum: 1, dcName: 'Darth Vader',
    displayName: 'Darth Vader [DG 1]',
  });
  dcHealthState.set(vaderMsgId, [[16, 16]]);

  const game = {
    gameId: 'testgame',
    figurePositions: {
      1: {
        'Stormtrooper (Elite)-1-0': 'D4',
        'Darth Vader-1-0': 'D5',
      },
      2: {},
    },
    figureConditions: {},
    p1DcList: [
      { dcName: 'Stormtrooper (Elite)', healthState: [6, 6] },
      { dcName: 'Darth Vader', healthState: [16, 16] },
    ],
    p2DcList: [],
    p1DcMessageIds: [stormMsgId, vaderMsgId],
    p2DcMessageIds: [],
  };

  return { game, dcMessageMeta, dcHealthState };
}

// ── ORACLE-COVF-001: TROOPERs become Hidden, non-TROOPERs do not ────────────
describe('ORACLE-COVF-001: Only TROOPERs become Hidden', () => {
  it('001: Stormtrooper gets Hidden, Vader does not', () => {
    const { game, dcMessageMeta, dcHealthState } = buildCoveringFireGame();

    const result = resolveAbility('Covering Fire', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });

    assert.equal(result.applied, true);

    const stormConds = game.figureConditions?.['Stormtrooper (Elite)-1-0'] || [];
    assert.ok(stormConds.includes('Hide'), 'Stormtrooper should be Hidden');

    const vaderConds = game.figureConditions?.['Darth Vader-1-0'] || [];
    assert.ok(!vaderConds.includes('Hide'), 'Vader should NOT be Hidden (not TROOPER)');
  });
});

// ── ORACLE-COVF-002: Round-scoped Surge:Stun flag set ────────────────────────
describe('ORACLE-COVF-002: Round-scoped TROOPER Surge:Stun flag', () => {
  it('002: roundTrooperSurgeStun is set for the player', () => {
    const { game, dcMessageMeta, dcHealthState } = buildCoveringFireGame();

    resolveAbility('Covering Fire', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });

    assert.ok(game.roundTrooperSurgeStun?.[1], 'roundTrooperSurgeStun should be set for player 1');
    assert.ok(!game.roundTrooperSurgeStun?.[2], 'Should not be set for player 2');
  });
});

// ── ORACLE-COVF-003: Log message includes both effects ──────────────────────
describe('ORACLE-COVF-003: Log message is comprehensive', () => {
  it('003: log mentions Hidden and Surge:Stun', () => {
    const { game, dcMessageMeta, dcHealthState } = buildCoveringFireGame();

    const result = resolveAbility('Covering Fire', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
    });

    assert.ok(result.logMessage.includes('Hidden'), 'Log should mention Hidden');
    assert.ok(result.logMessage.includes('Surge'), 'Log should mention Surge');
    assert.ok(result.logMessage.includes('Stun'), 'Log should mention Stun');
  });
});
