/**
 * Oracle tests for Dioxis Fumes — defeat routing through processFigureDefeat.
 *
 * Rule: Each non-DROID figure suffers 1 Strain (damage). Non-DROID figures cannot
 *       recover Strain for the rest of this round.
 *
 * Phase 1A fix: Dioxis Fumes defeats now return defeatedFigures array instead of
 * inline figurePositions deletion, ensuring processFigureDefeat handles VP awards,
 * CC attachment cleanup, passive redraws, Heroic Effort, Scavenged Weaponry,
 * Hunt Dissent, activation decrement, and win-condition checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

function buildDioxisGame() {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();

  // P1: Stormtrooper (Regular) at 1 HP — will be defeated by 1 strain
  const stormMsgId = 'msg_storm';
  dcMessageMeta.set(stormMsgId, {
    gameId: 'testgame', playerNum: 1, dcName: 'Stormtrooper (Regular)',
    displayName: 'Stormtrooper (Regular) [DG 1]',
  });
  dcHealthState.set(stormMsgId, [[1, 3], [3, 3], [3, 3]]);

  // P2: Rebel Trooper at full HP — survives
  const rebelMsgId = 'msg_rebel';
  dcMessageMeta.set(rebelMsgId, {
    gameId: 'testgame', playerNum: 2, dcName: 'Rebel Trooper',
    displayName: 'Rebel Trooper [DG 1]',
  });
  dcHealthState.set(rebelMsgId, [[2, 2], [2, 2], [2, 2]]);

  const game = {
    gameId: 'testgame',
    figurePositions: {
      1: { 'Stormtrooper (Regular)-1-0': 'A1', 'Stormtrooper (Regular)-1-1': 'A2', 'Stormtrooper (Regular)-1-2': 'A3' },
      2: { 'Rebel Trooper-1-0': 'B1', 'Rebel Trooper-1-1': 'B2', 'Rebel Trooper-1-2': 'B3' },
    },
    p1DcList: [{ dcName: 'Stormtrooper (Regular)', healthState: [1, 3] }],
    p2DcList: [{ dcName: 'Rebel Trooper', healthState: [2, 2] }],
    p1DcMessageIds: [stormMsgId],
    p2DcMessageIds: [rebelMsgId],
  };

  return { game, dcMessageMeta, dcHealthState, stormMsgId, rebelMsgId };
}

// ── ORACLE-DIOXIS-001: Dioxis Fumes routes strain through applyStrain pipeline ──
// 2026-05-09 migration: Dioxis Fumes used to do raw HP mutation + return
// defeatedFigures[]. It now returns pendingStrain[] which apply-ability-result
// routes through applyStrain (Fireproof / Headhunter / per-strain choice /
// Under Duress / Paz). Defeats happen inside the strain pipeline when the
// player picks the damage branch — no longer determined synchronously.
describe('ORACLE-DIOXIS-001: Dioxis Fumes routes strain through applyStrain', () => {
  it('001a: returns pendingStrain[] with one entry per non-DROID figure', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDioxisGame();

    const result = resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    assert.equal(result.applied, true, 'Dioxis Fumes should resolve');
    assert.ok(Array.isArray(result.pendingStrain), 'Result must include pendingStrain array');
    // Six non-DROID figures (3 Stormtroopers + 3 Rebel Troopers); none are DROIDs.
    assert.equal(result.pendingStrain.length, 6, 'Exactly 6 strain events queued (one per non-DROID figure)');
    for (const ps of result.pendingStrain) {
      assert.equal(ps.amount, 1);
      assert.equal(ps.source, 'Dioxis Fumes');
      assert.ok(ps.figureKey);
      assert.ok(ps.controllerPlayerNum === 1 || ps.controllerPlayerNum === 2);
    }
  });

  it('001b: figure position is NOT removed inline (deferred to applyStrain → applyDamage pipeline)', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDioxisGame();

    resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    // Figure should still be in figurePositions — defeat happens inside
    // applyStrain when the player picks the damage branch.
    assert.ok(
      game.figurePositions[1]['Stormtrooper (Regular)-1-0'],
      'Figure should remain in figurePositions until applyStrain → applyDamage runs'
    );
  });

  it('001c: roundDioxisActive flag is set so non-DROID figures cannot recover Strain this round', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDioxisGame();

    resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    assert.equal(game.roundDioxisActive, true, 'roundDioxisActive must be set');
  });
});
