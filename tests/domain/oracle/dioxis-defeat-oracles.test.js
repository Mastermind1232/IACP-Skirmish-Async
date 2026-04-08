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

// ── ORACLE-DIOXIS-001: Dioxis Fumes returns defeatedFigures for processFigureDefeat ──
describe('ORACLE-DIOXIS-001: Dioxis Fumes defeat routes through processFigureDefeat', () => {
  it('001a: figure at 1 HP returns defeatedFigures with correct metadata', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDioxisGame();

    const result = resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    assert.equal(result.applied, true, 'Dioxis Fumes should resolve');
    assert.ok(result.defeatedFigures, 'Result should include defeatedFigures array');
    assert.equal(result.defeatedFigures.length, 1, 'Exactly one figure defeated (Stormtrooper at 1 HP)');

    const df = result.defeatedFigures[0];
    assert.equal(df.figureKey, 'Stormtrooper (Regular)-1-0');
    assert.equal(df.defeatedPlayerNum, 1);
    assert.equal(df.attackerPlayerNum, 2, 'Opponent gets credit for defeat');
    assert.equal(df.source, 'Dioxis Fumes');
  });

  it('001b: figure position is NOT removed inline (deferred to processFigureDefeat)', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDioxisGame();

    resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    // Figure should still be in figurePositions — processFigureDefeat handles removal
    assert.ok(
      game.figurePositions[1]['Stormtrooper (Regular)-1-0'],
      'Defeated figure should remain in figurePositions until processFigureDefeat runs'
    );
  });

  it('001c: no defeatedFigures when all figures survive', () => {
    const { game, dcMessageMeta, dcHealthState, stormMsgId } = buildDioxisGame();

    // Set all stormtroopers to full HP — all survive
    dcHealthState.set(stormMsgId, [[3, 3], [3, 3], [3, 3]]);

    const result = resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    assert.equal(result.applied, true);
    assert.ok(!result.defeatedFigures, 'No defeatedFigures when all survive');
  });

  it('001d: refreshBoard true only when a defeat occurs', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDioxisGame();

    const result = resolveAbility('cc:dioxis_fumes', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
    });

    assert.equal(result.refreshBoard, true, 'refreshBoard should be true when defeat occurs');
  });
});
