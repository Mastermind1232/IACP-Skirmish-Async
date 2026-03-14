/**
 * Regression tests for pending-state resolution bugs:
 * - Cover Fire: pendingCoverFire must be cleared after block/skip
 * - Strain Choice: pendingStrainChoice must gate available-actions and resolve correctly
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';

function buildActionDeps(meta) {
  return {
    dcMessageMeta: meta.dcMessageMeta,
    dcExhaustedState: meta.dcExhaustedState,
    dcHealthState: meta.dcHealthState,
    getDcStats,
    getMapSpaces,
    computeMovementCache,
    getBoardStateForMovement,
    getMovementProfile,
    getPlayableCcFromHand,
  };
}

describe('Cover Fire pending-state resolution', () => {
  it('handleCoverFireBlock clears pendingCoverFire', async () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'CT-1701' }, { dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game, harness } = meta;

    // Find P1 figure keys for the block target
    const p1Figs = Object.keys(game.figurePositions[1]);
    assert.ok(p1Figs.length >= 2, 'P1 has at least 2 figures for Cover Fire');

    // Manually set pendingCoverFire as combat-bridge would
    game.pendingCoverFire = {
      gameId: game.gameId,
      attackerPlayerNum: 1,
      attackerMsgId: 'fake-msg',
      hit: true,
      targetFigureKey: Object.keys(game.figurePositions[2])[0],
    };

    // Verify available-actions gates on pendingCoverFire
    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const types = new Set(actions.map(a => a.type));
    assert.ok(types.has('cover_fire_block'), 'cover_fire_block offered');
    assert.ok(types.has('cover_fire_skip'), 'cover_fire_skip offered');
    assert.ok(!types.has('activate_dc'), 'no activate_dc while Cover Fire pending');

    // Submit a cover_fire_block action
    const blockAction = actions.find(a => a.type === 'cover_fire_block');
    await harness.submitAction(blockAction.customId, game.player1Id);

    // pendingCoverFire must be cleared
    const g = harness.getGame();
    assert.strictEqual(g.pendingCoverFire, null, 'pendingCoverFire cleared after block');

    // available-actions should no longer return cover_fire actions
    const afterActions = getAvailableActions(g, 1, actionDeps);
    const afterTypes = new Set(afterActions.map(a => a.type));
    assert.ok(!afterTypes.has('cover_fire_block'), 'no cover_fire_block after resolution');
    assert.ok(!afterTypes.has('cover_fire_skip'), 'no cover_fire_skip after resolution');
  });

  it('handleCoverFireDiscard skip clears pendingCoverFire', async () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'CT-1701' }, { dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game, harness } = meta;

    game.pendingCoverFire = {
      gameId: game.gameId,
      attackerPlayerNum: 1,
      attackerMsgId: 'fake-msg',
      hit: true,
      targetFigureKey: Object.keys(game.figurePositions[2])[0],
    };

    // Submit the skip action (cover_fire_discard_skip_)
    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const skipAction = actions.find(a => a.type === 'cover_fire_skip');
    assert.ok(skipAction, 'skip action exists');

    await harness.submitAction(skipAction.customId, game.player1Id);

    const g = harness.getGame();
    assert.strictEqual(g.pendingCoverFire, null, 'pendingCoverFire cleared after skip');

    // No more cover fire actions
    const afterActions = getAvailableActions(g, 1, actionDeps);
    const afterTypes = new Set(afterActions.map(a => a.type));
    assert.ok(!afterTypes.has('cover_fire_block'), 'no cover_fire_block after skip');
    assert.ok(!afterTypes.has('cover_fire_skip'), 'no cover_fire_skip after skip');
  });
});

describe('Strain Choice pending-state resolution', () => {
  it('pendingStrainChoice gates available-actions (hard gate)', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;

    // Manually set pendingStrainChoice as applyStrainToFigure would
    const p1Fig = Object.keys(game.figurePositions[1])[0];
    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.pendingStrainChoice = {
      figureKey: p1Fig,
      playerNum: 1,
      amount: 2,
      headhunterDmg: 0,
      abilityLabel: 'Test Strain',
      sourceLabel: 'test',
      dcName: 'Luke Skywalker',
      msgId: p1MsgId,
      figureIndex: 0,
      threadId: 'fake-thread',
      discardedCount: 0,
      underDuressActive: false,
      ccCostPerStrain: 1,
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const types = new Set(actions.map(a => a.type));

    // Only strain_choice actions should be offered
    assert.ok(types.has('strain_choice_alldmg'), 'strain_choice_alldmg offered');
    assert.ok(!types.has('activate_dc'), 'no activate_dc while strain pending');
    assert.ok(!types.has('pass_activation_turn'), 'no pass while strain pending');

    // Other player should get no strain actions (it's P1's strain)
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    const p2Types = new Set(p2Actions.map(a => a.type));
    assert.ok(!p2Types.has('strain_choice_alldmg'), 'P2 does not see strain_choice');
  });

  it('strain_choice_alldmg resolves and clears pendingStrainChoice', async () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game, harness } = meta;

    const p1Fig = Object.keys(game.figurePositions[1])[0];
    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];

    // Get initial HP
    const healthArr = meta.dcHealthState.get(p1MsgId);
    const initialHp = healthArr[0][0];

    game.pendingStrainChoice = {
      figureKey: p1Fig,
      playerNum: 1,
      amount: 2,
      headhunterDmg: 0,
      abilityLabel: 'Test Strain',
      sourceLabel: 'test',
      dcName: 'Luke Skywalker',
      msgId: p1MsgId,
      figureIndex: 0,
      threadId: 'fake-thread',
      discardedCount: 0,
      underDuressActive: false,
      ccCostPerStrain: 1,
    };

    // Submit strain_choice_alldmg
    const customId = `strain_choice_alldmg_${game.gameId}`;
    await harness.submitAction(customId, game.player1Id);

    const g = harness.getGame();
    // pendingStrainChoice must be deleted
    assert.ok(!g.pendingStrainChoice, 'pendingStrainChoice cleared after alldmg');

    // HP should have decreased by the strain amount
    const newHealthArr = meta.dcHealthState.get(p1MsgId);
    const newHp = newHealthArr[0][0];
    assert.strictEqual(newHp, initialHp - 2, `HP reduced by strain amount (${initialHp} -> ${newHp})`);

    // available-actions should no longer return strain_choice actions
    const actionDeps = buildActionDeps(meta);
    const afterActions = getAvailableActions(g, 1, actionDeps);
    const afterTypes = new Set(afterActions.map(a => a.type));
    assert.ok(!afterTypes.has('strain_choice_alldmg'), 'no strain_choice after resolution');
  });

  it('full game with CT-1701 (Cover Fire) completes without Cover Fire loop', async () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'CT-1701' }, { dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'IG-88' }, { dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();
    const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = meta;

    const actionDeps = buildActionDeps(meta);
    const MAX_ITERATIONS = 800;
    const STALE_THRESHOLD = 200; // force a kill if no progress in this many iterations
    let coverFireCount = 0;
    let iterations = 0;
    let lastKillIteration = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations = i + 1;
      const g = harness.getGame();
      if (g.ended) break;

      // Stale-progress detection: if no figure has died in STALE_THRESHOLD
      // iterations, random play is not converging — force a kill to unblock
      if (i - lastKillIteration >= STALE_THRESHOLD) {
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Stale breaker');
          lastKillIteration = i;
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Stale breaker');
          lastKillIteration = i;
        }
        continue;
      }

      const p1Actions = getAvailableActions(g, 1, actionDeps);
      const p2Actions = getAvailableActions(g, 2, actionDeps);
      const allActions = [
        ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
        ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
      ];

      if (allActions.length === 0) {
        // No-action deadlock breaker
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
          lastKillIteration = i;
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
          lastKillIteration = i;
        } else break;
        continue;
      }

      // Track cover fire action frequency
      if (allActions.some(a => a.type === 'cover_fire_block' || a.type === 'cover_fire_skip')) {
        coverFireCount++;
      }

      // Pick random action
      const action = allActions[Math.floor(Math.random() * allActions.length)];
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;

      try {
        await harness.submitAction(action.customId, userId);
      } catch {
        // Continue on error
      }
    }

    // Cover Fire should not dominate — if it was offered more than 20 times, the loop is back
    assert.ok(coverFireCount < 20,
      `Cover Fire actions offered ${coverFireCount} times — possible loop (should be <20)`);

    // Game should complete or at least progress significantly
    const finalGame = harness.getGame();
    assert.ok(iterations < MAX_ITERATIONS || finalGame.ended,
      `Game should complete within ${MAX_ITERATIONS} iterations (ran ${iterations})`);
  });
});

describe('Force Vision pending-state resolution', () => {
  it('forceVisionPending gates available-actions to force_vision_pick only', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }, { dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();
    const { game } = meta;

    // Simulate Kanan's Force Vision: P2 must pick which group activates next
    game.forceVisionPending = 2;

    const actionDeps = buildActionDeps(meta);

    // P2 should only see force_vision_pick actions
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    const p2Types = new Set(p2Actions.map(a => a.type));
    assert.ok(p2Types.has('force_vision_pick'), 'P2 sees force_vision_pick actions');
    assert.ok(!p2Types.has('activate_dc'), 'P2 cannot activate_dc while Force Vision pending');
    assert.ok(!p2Types.has('pass_activation_turn'), 'P2 cannot pass while Force Vision pending');

    // Each force_vision_pick should have valid dcIndex and customId format
    for (const a of p2Actions) {
      assert.strictEqual(a.type, 'force_vision_pick', 'all P2 actions are force_vision_pick');
      assert.ok(a.customId.startsWith('fv_pick_'), `customId starts with fv_pick_: ${a.customId}`);
      assert.ok(a.params.dcIndex >= 0, `dcIndex is valid: ${a.params.dcIndex}`);
    }

    // P1 should NOT see force_vision_pick (it's P2's pending state)
    const p1Actions = getAvailableActions(game, 1, actionDeps);
    const p1Types = new Set(p1Actions.map(a => a.type));
    assert.ok(!p1Types.has('force_vision_pick'), 'P1 does not see force_vision_pick');
  });

  it('stale forceVisionPending is cleared when no ready groups remain', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;

    // Mark all P2 DCs as activated so no ready groups exist
    game.p2ActivatedDcIndices = [0];
    game.forceVisionPending = 2;

    const actionDeps = buildActionDeps(meta);
    const p2Actions = getAvailableActions(game, 2, actionDeps);

    // forceVisionPending should have been cleared (safety net)
    assert.strictEqual(game.forceVisionPending, null, 'stale forceVisionPending cleared');
    // P2 should get normal actions (not stuck in force_vision_pick)
    const p2Types = new Set(p2Actions.map(a => a.type));
    assert.ok(!p2Types.has('force_vision_pick'), 'no force_vision_pick after safety clear');
  });
});
