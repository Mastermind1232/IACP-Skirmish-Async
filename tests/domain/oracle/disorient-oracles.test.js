/**
 * Oracle tests for Disorient — no adjacency requirement.
 *
 * Rule: "Use after a hostile figure with a BENEFICIAL condition suffers Damage.
 *        Discard 1 BENEFICIAL condition from that figure. Then, that figure
 *        suffers 2 Strain."
 *
 * Confirmed-safe core:
 *   - No adjacency requirement — range: 999 in data bypasses adjacency filter
 *   - Requires target to have a beneficial condition (Focus or Hidden)
 *   - Discards 1 beneficial condition and applies 2 Strain
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { getAbilityLibrary } from '../../../src/data-loader.js';
import { drainPendingDamage } from '../../../src/game/damage-pipeline.js';

// ── Helper: build game state for Disorient resolution ─────────────────────────
function buildDisorientGame() {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();

  const activatorMsgId = 'msg_activator';
  dcMessageMeta.set(activatorMsgId, {
    gameId: 'testgame', playerNum: 1, dcName: 'Luke Skywalker',
    displayName: 'Luke Skywalker [DG 1]',
  });
  dcHealthState.set(activatorMsgId, [[12, 12]]);

  const targetMsgId = 'msg_target';
  dcMessageMeta.set(targetMsgId, {
    gameId: 'testgame', playerNum: 2, dcName: 'Darth Vader',
    displayName: 'Darth Vader [DG 1]',
  });
  dcHealthState.set(targetMsgId, [[16, 16]]);

  const game = {
    gameId: 'testgame',
    figurePositions: {
      1: { 'Luke Skywalker-1-0': 'A1' },
      2: { 'Darth Vader-1-0': 'H8' },
    },
    figureConditions: {
      'Darth Vader-1-0': ['Focus'],
    },
    dcActionsData: { [activatorMsgId]: { selectedFigure: 0 } },
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [12, 12] }],
    p2DcList: [{ dcName: 'Darth Vader', healthState: [16, 16] }],
    p1DcMessageIds: [activatorMsgId],
    p2DcMessageIds: [targetMsgId],
    selectedMap: { id: 'test_map' },
    activatingPlayerNum: 1,
    activatingDcMsgId: activatorMsgId,
  };

  return { game, dcMessageMeta, dcHealthState, activatorMsgId, targetMsgId };
}

// ── ORACLE-DISOR-001: Data verification — range: 999 (no adjacency) ───────────
describe('ORACLE-DISOR-001: Disorient data has range 999 (no adjacency)', () => {
  it('001: ability-library Disorient entry has range 999', () => {
    const lib = getAbilityLibrary();
    const entry = lib?.abilities?.Disorient;
    assert.ok(entry, 'Disorient entry should exist in ability library');
    assert.equal(
      entry.chooseAdjacentHostileThen?.range, 999,
      'Disorient range should be 999 (no adjacency restriction)'
    );
  });
});

// ── ORACLE-DISOR-002: Resolution discards Focus + applies 2 Strain ────────────
describe('ORACLE-DISOR-002: Resolution discards condition and applies Strain', () => {
  it('002: Focus discarded and 2 Strain applied to target', () => {
    const { game, dcMessageMeta, dcHealthState, targetMsgId } = buildDisorientGame();

    const result = resolveAbility('Disorient', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
      chosenFigureKey: 'Darth Vader-1-0',
    });

    assert.equal(result.applied, true, 'Should resolve successfully');

    // Focus should be discarded
    const conds = game.figureConditions?.['Darth Vader-1-0'] || [];
    assert.ok(!conds.includes('Focus'), 'Focus should be discarded');

    // Strain queues via pendingStrain[] — HP unchanged synchronously.
    const targetHp = dcHealthState.get(targetMsgId);
    assert.deepStrictEqual(targetHp, [[16, 16]], 'Vader HP unchanged synchronously (strain via pipeline)');
    assert.ok(Array.isArray(result.pendingStrain) && result.pendingStrain.length === 1);
    assert.strictEqual(result.pendingStrain[0].figureKey, 'Darth Vader-1-0');
    assert.strictEqual(result.pendingStrain[0].amount, 2);
  });

  it('002b: Hidden also counts as beneficial condition', () => {
    const { game, dcMessageMeta, dcHealthState, targetMsgId } = buildDisorientGame();
    game.figureConditions['Darth Vader-1-0'] = ['Hidden'];

    const result = resolveAbility('Disorient', {
      game, playerNum: 1,
      dcMessageMeta, dcHealthState,
      chosenFigureKey: 'Darth Vader-1-0',
    });

    assert.equal(result.applied, true);
    const conds = game.figureConditions?.['Darth Vader-1-0'] || [];
    assert.ok(!conds.includes('Hidden'), 'Hidden should be discarded');
  });
});

// ── chooseAdjacentHostileThen damage now routes through the defeat-aware
//    pipeline (alexanbv 2026-06-22) — a lethal CC hit queues a figure defeat.
//    This is the prerequisite for Ambush actually defeating the attacker. ──────
describe('chooseAdjacentHostileThen lethal damage queues a defeat (pipeline)', () => {
  it('Force Lightning dealing >= target HP reduces it to 0 and defeats it via the pipeline', async () => {
    const targetMsgId = 'msg_target';
    const dcMessageMeta = new Map([
      ['msg_act', { gameId: 'tg', playerNum: 1, dcName: 'Darth Vader', displayName: 'Darth Vader [DG 1]' }],
      [targetMsgId, { gameId: 'tg', playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [DG 1]' }],
    ]);
    const dcHealthState = new Map([
      ['msg_act', [[16, 16]]],
      [targetMsgId, [[2, 6]]], // 2 HP — Force Lightning's 2 Damage is lethal
    ]);
    const game = {
      gameId: 'tg',
      figurePositions: { 1: { 'Darth Vader-1-0': 'A1' }, 2: { 'Stormtrooper-1-0': 'A2' } },
      figureConditions: {},
      p1DcList: [{ dcName: 'Darth Vader', healthState: [[16, 16]] }],
      p2DcList: [{ dcName: 'Stormtrooper', healthState: [[2, 6]] }],
      p1DcMessageIds: ['msg_act'],
      p2DcMessageIds: [targetMsgId],
      selectedMap: { id: 'tm' },
    };
    resolveAbility('Force Lightning', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: 'Stormtrooper-1-0' });
    // resolveAbility is sync: it QUEUES the damage onto game._pendingDamage.
    assert.ok(Array.isArray(game._pendingDamage) && game._pendingDamage.some(d => d.figureKey === 'Stormtrooper-1-0'),
      'damage queued for the unified pipeline');
    // Drain through the SAME applyDamage pipeline combat uses; a lethal hit
    // reduces HP to 0 and finalizes the defeat via ctx.processFigureDefeat.
    const defeats = [];
    await drainPendingDamage(game, {
      dcHealthState,
      processFigureDefeat: (_g, rec) => { defeats.push(rec.figureKey); },
    });
    assert.deepStrictEqual(dcHealthState.get(targetMsgId)[0], [0, 6], 'target at 0 HP after drain');
    assert.ok(defeats.includes('Stormtrooper-1-0'), 'figure defeated via the pipeline');
  });
});

// ── ORACLE-DISOR-003: which-beneficial picker when the figure has BOTH ────────
describe('ORACLE-DISOR-003: player picks which beneficial condition to discard', () => {
  it('003: figure with Focus AND Hidden → prompts for which to discard, then discards the chosen one', () => {
    const { game, dcMessageMeta, dcHealthState } = buildDisorientGame();
    game.figureConditions['Darth Vader-1-0'] = ['Focus', 'Hidden'];

    // Picking the figure prompts for which beneficial condition to discard.
    const p1 = resolveAbility('Disorient', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
      chosenFigureKey: 'Darth Vader-1-0',
    });
    assert.equal(p1.requiresChoice, true, 'two beneficials → must pick which to discard');
    assert.deepStrictEqual(p1.targetFigureKeys, ['discard:Focus:Darth Vader-1-0', 'discard:Hidden:Darth Vader-1-0']);

    // Choosing "Hidden" discards Hidden and KEEPS Focus.
    const p2 = resolveAbility('Disorient', {
      game, playerNum: 1, dcMessageMeta, dcHealthState,
      chosenFigureKey: 'discard:Hidden:Darth Vader-1-0',
    });
    assert.equal(p2.applied, true);
    const conds = game.figureConditions?.['Darth Vader-1-0'] || [];
    assert.ok(!conds.includes('Hidden'), 'chosen Hidden discarded');
    assert.ok(conds.includes('Focus'), 'unchosen Focus kept');
    assert.ok(Array.isArray(p2.pendingStrain) && p2.pendingStrain[0].amount === 2, '2 Strain still queued');
  });
});
