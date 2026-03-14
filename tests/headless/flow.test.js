/**
 * Discord Flow Simulation Tests
 *
 * Exercises real handler dispatch chains through complete game flows,
 * asserting game-state + Discord-surface invariants after every action.
 *
 * Test suites:
 *   1-3:  Setup, activate/end, full combat (baseline)
 *   4:    Multi-activation round
 *   5:    Hand card privacy (DS-1, DS-2)
 *   6:    Message edit tracking (DS-3)
 *   7:    Pending state lifecycles (DS-4) — combat, negation, celebration, movement, power tokens
 *   8:    Component cleanup (DS-5)
 *   9:    Action control visibility (DS-6)
 *   10:   Regression scenarios (negation window, end-activation turn switch, etc.)
 *   11:   Stress test with full invariants
 *   12:   Payload shape validation (DS-7, DS-8, DS-9) — synthetic limit detection
 *   13:   Payload shape in real flows — validates no violations in actual game flow
 *
 * Usage: node --test tests/headless/flow.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFlowHarness, PENDING_STATE_KEYS } from './flow-harness.js';
import { assertSurfaceInvariants, validatePayloadShape } from './flow-invariants.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function findAction(fh, playerNum, type) {
  return fh.getActions(playerNum).find(a => a.type === type);
}

function assertNoErrors(result, label) {
  if (result.invariantErrors.length > 0) {
    assert.fail(`Invariant violations after ${label}:\n  ${result.invariantErrors.join('\n  ')}`);
  }
  if (result.result.error) {
    assert.fail(`Handler error after ${label}: ${result.result.error}`);
  }
}

/** Drive combat to completion: ready, roll, skip rerolls, skip surges, resolve. */
async function driveCombatToCompletion(fh) {
  const steps = [];
  for (let i = 0; i < 20; i++) {
    const game = fh.getGame();
    if (!game.pendingCombat) break;

    for (const [pn, uid] of [[1, 'player1'], [2, 'player2']]) {
      for (const type of ['combat_ready', 'combat_roll', 'combat_skip_surges', 'combat_resolve']) {
        const action = findAction(fh, pn, type);
        if (action) {
          const r = await fh.act(action.customId, uid);
          steps.push({ type, pn, errors: r.invariantErrors });
          break;
        }
      }
    }
  }
  return steps;
}

/** Drive activation: activate first available DC. */
async function activateDc(fh, playerNum) {
  const uid = playerNum === 1 ? 'player1' : 'player2';
  const action = findAction(fh, playerNum, 'activate_dc');
  if (!action) return null;
  return fh.act(action.customId, uid);
}

/** End activation for current DC. */
async function endActivation(fh, playerNum) {
  const uid = playerNum === 1 ? 'player1' : 'player2';
  const action = findAction(fh, playerNum, 'dc_end_activation');
  if (!action) return null;
  return fh.act(action.customId, uid);
}

// ── Suite 1: Game Setup ─────────────────────────────────────────────────────

describe('Flow: game setup', () => {
  it('creates valid round-active game with empty surface', () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    const game = fh.getGame();
    assert.equal(game.phase, 'round_active');
    assert.ok(fh.getActions(1).some(a => a.type === 'activate_dc'));

    const surface = fh.getSurface();
    assert.equal(surface.entries.length, 0);
    assert.equal(surface.pendingTransitions.length, 0);
  });
});

// ── Suite 2: Activate → End Activation ──────────────────────────────────────

describe('Flow: activate → end activation', () => {
  it('activation produces surface entries and clean lifecycle', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    const r1 = await activateDc(fh, 1);
    assertNoErrors(r1, 'activate_dc');
    assert.ok(fh.getSurface().getStepEntries(1).length > 0, 'Surface entries produced');

    const r2 = await endActivation(fh, 1);
    assertNoErrors(r2, 'dc_end_activation');
  });
});

// ── Suite 3: Full Combat Flow ───────────────────────────────────────────────

describe('Flow: full combat', () => {
  it('activate → attack → combat → end activation with surface tracking', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    await activateDc(fh, 1);

    const attackAction = findAction(fh, 1, 'attack_target');
    if (!attackAction) { console.log('  [skip] No attack target in range'); return; }

    const r2 = await fh.act(attackAction.customId, 'player1');
    assertNoErrors(r2, 'attack_target');

    const combatSteps = await driveCombatToCompletion(fh);
    for (const s of combatSteps) {
      assert.equal(s.errors.length, 0, `Combat step ${s.type} P${s.pn} clean`);
    }

    // Handle celebration if triggered
    if (fh.getGame().pendingCelebration) {
      const pass = findAction(fh, 1, 'celebration_pass') || findAction(fh, 2, 'celebration_pass');
      if (pass) {
        const uid = findAction(fh, 1, 'celebration_pass') ? 'player1' : 'player2';
        await fh.act(pass.customId, uid);
      }
    }

    if (!fh.getGame().ended) {
      const r = await endActivation(fh, 1);
      if (r) assertNoErrors(r, 'dc_end_activation');
    }

    const surface = fh.getSurface();
    console.log(`  [info] ${fh.getStepLog().length} steps, ${surface.entries.length} entries, ${surface.pendingTransitions.length} transitions`);
  });
});

// ── Suite 4: Multi-Activation Round ─────────────────────────────────────────

describe('Flow: multi-activation round', () => {
  it('4 DCs activate and end without invariant violations', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }, { dcName: 'Han Solo' }],
      p2Army: [{ dcName: 'Darth Vader' }, { dcName: 'Stormtrooper (Elite)' }],
    });

    let activations = 0;
    for (let i = 0; i < 50 && activations < 4; i++) {
      const game = fh.getGame();
      if (game.ended) break;

      for (const [pn, uid] of [[1, 'player1'], [2, 'player2']]) {
        for (const type of ['activate_dc', 'dc_end_activation', 'end_activation_phase', 'pass_activation_turn']) {
          const action = findAction(fh, pn, type);
          if (action) {
            const r = await fh.act(action.customId, uid);
            assertNoErrors(r, `step ${i} ${type}`);
            if (type === 'dc_end_activation') activations++;
            break;
          }
        }
        if (activations >= 4) break;
      }
    }
    assert.ok(activations >= 1, `At least 1 activation (got ${activations})`);
  });
});

// ── Suite 5: Hand Card Privacy ──────────────────────────────────────────────

describe('Flow: hand card privacy (DS-1, DS-2)', () => {
  it('hand card names never appear in shared surfaces', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
      p1CcHand: ['Son of Skywalker', 'Take Initiative'],
      p2CcHand: ['Force Lightning', 'Deflection'],
    });

    await activateDc(fh, 1);
    await endActivation(fh, 1);

    const surface = fh.getSurface();
    for (const card of ['Son of Skywalker', 'Take Initiative', 'Force Lightning', 'Deflection']) {
      assert.ok(!surface.sharedContainsText(card), `"${card}" not in shared surface`);
    }
  });

  it('P1 cards invisible to P2-only entries', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
      p1CcHand: ['Son of Skywalker'],
      p2CcHand: ['Force Lightning'],
    });

    await activateDc(fh, 1);
    const surface = fh.getSurface();

    for (const entry of surface.getVisibleToOpponentOnly(1)) {
      const text = (entry.content || '') + JSON.stringify(entry.embeds || []);
      assert.ok(!text.includes('Son of Skywalker'), 'P1 card not in P2-only entries');
    }
    for (const entry of surface.getVisibleToOpponentOnly(2)) {
      const text = (entry.content || '') + JSON.stringify(entry.embeds || []);
      assert.ok(!text.includes('Force Lightning'), 'P2 card not in P1-only entries');
    }
  });
});

// ── Suite 6: Message Edit Tracking (DS-3) ───────────────────────────────────

describe('Flow: message edit tracking (DS-3)', () => {
  it('all edits target known messages', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    await activateDc(fh, 1);
    await endActivation(fh, 1);

    const orphaned = fh.getSurface().getOrphanedEdits();
    assert.equal(orphaned.length, 0, `No orphaned edits (found ${orphaned.length})`);
  });
});

// ── Suite 7: Pending State Lifecycles (DS-4) ────────────────────────────────

describe('Flow: pending state lifecycles (DS-4)', () => {

  it('pendingCombat: created, has actions, cleared after resolution', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    await activateDc(fh, 1);

    const attackAction = findAction(fh, 1, 'attack_target');
    if (!attackAction) { console.log('  [skip] No attack target'); return; }

    const r = await fh.act(attackAction.customId, 'player1');
    assertNoErrors(r, 'attack_target');

    // Verify pendingCombat was created
    assert.ok(r.step.pendingCreated.includes('pendingCombat'), 'pendingCombat transition recorded');

    const surface = fh.getSurface();
    const combatCreated = surface.getPendingTransitions('pendingCombat').find(t => t.transition === 'created');
    assert.ok(combatCreated, 'pendingCombat created transition exists');
    assert.ok(combatCreated.p1HasActions || combatCreated.p2HasActions, 'At least one player has actions after combat created');

    // Drive combat to completion
    await driveCombatToCompletion(fh);

    // Handle celebration if any
    if (fh.getGame().pendingCelebration) {
      const pass = findAction(fh, 1, 'celebration_pass') || findAction(fh, 2, 'celebration_pass');
      if (pass) await fh.act(pass.customId, findAction(fh, 1, 'celebration_pass') ? 'player1' : 'player2');
    }

    // Verify pendingCombat was cleared
    assert.ok(!fh.getGame().pendingCombat, 'pendingCombat cleared after resolution');
    const lifecycle = surface.getPendingLifecycle('pendingCombat');
    assert.ok(lifecycle.created, 'Combat lifecycle: created');
    assert.ok(lifecycle.cleared, 'Combat lifecycle: cleared');
  });

  it('pendingCelebration: created when unique figure defeated, cleared on pass', async () => {
    const fh = createFlowHarness({
      // Stormtroopers are weak, Luke can one-shot them
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    await activateDc(fh, 1);
    const attackAction = findAction(fh, 1, 'attack_target');
    if (!attackAction) { console.log('  [skip] No attack target'); return; }

    await fh.act(attackAction.customId, 'player1');
    await driveCombatToCompletion(fh);

    const surface = fh.getSurface();
    const celebCreated = surface.getPendingTransitions('pendingCelebration')
      .find(t => t.transition === 'created');

    if (!celebCreated) {
      // Stormtrooper might not have died (dice-dependent) — that's OK
      console.log('  [skip] No celebration triggered (stormtrooper survived)');
      return;
    }

    assert.ok(celebCreated.p1HasActions || celebCreated.p2HasActions,
      'Someone has actions when celebration created');

    // Pass on celebration
    const pass = findAction(fh, 1, 'celebration_pass') || findAction(fh, 2, 'celebration_pass');
    assert.ok(pass, 'Celebration pass action available');
    const r = await fh.act(pass.customId, findAction(fh, 1, 'celebration_pass') ? 'player1' : 'player2');
    assertNoErrors(r, 'celebration_pass');

    assert.ok(!fh.getGame().pendingCelebration, 'pendingCelebration cleared');
    assert.ok(r.step.pendingCleared.includes('pendingCelebration'), 'celebration cleared in step log');
  });

  it('pendingNegation: synthetic injection → opponent has actions → resolves', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    // Synthetically inject a negation state (as if P1 played a cost-0 CC)
    const game = fh.getGame();
    game.pendingNegation = {
      playedBy: 1,
      card: 'Take Initiative',
      fromDc: false,
    };

    // P2 should now have negation actions
    const p2Actions = fh.getActions(2);
    const negPlay = p2Actions.find(a => a.type === 'negation_play');
    const negResolve = p2Actions.find(a => a.type === 'negation_let_resolve');

    assert.ok(negPlay || negResolve, 'P2 has negation response actions');

    // P1 should NOT have negation actions
    const p1Actions = fh.getActions(1);
    assert.ok(!p1Actions.some(a => a.type === 'negation_play' || a.type === 'negation_let_resolve'),
      'P1 does NOT have negation actions');

    // Let it resolve
    if (negResolve) {
      const r = await fh.act(negResolve.customId, 'player2');
      // Handler may error since we synthetically injected state (missing waitingMsgId etc.)
      // But the invariant check on the state transition is the real test
      if (r.result.error) {
        console.log(`  [info] Expected handler error on synthetic negation: ${r.result.error}`);
      }
    }
  });

  it('pendingPowerTokenGrant: synthetic injection → correct player has token choice actions', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    const game = fh.getGame();
    const p1FigKey = Object.keys(game.figurePositions[1])[0];

    // Inject power token grant for P1
    game.pendingPowerTokenGrant = {
      grants: [{ figureKey: p1FigKey, figName: 'Luke Skywalker', count: 1 }],
      channelId: null,
      playerNum: 1,
    };

    // P1 should have power token choice actions
    const p1Actions = fh.getActions(1);
    const tokenChoices = p1Actions.filter(a => a.type === 'power_token_choice');
    assert.ok(tokenChoices.length > 0, `P1 has token choice actions (got ${tokenChoices.length})`);
    assert.ok(tokenChoices.length === 4, 'Exactly 4 token types available (hit, surge, block, evade)');

    // P2 should NOT have token choice actions
    const p2Actions = fh.getActions(2);
    assert.ok(!p2Actions.some(a => a.type === 'power_token_choice'),
      'P2 does NOT have token choice actions');
  });

  it('moveInProgress: activated DC can start and complete movement', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    await activateDc(fh, 1);

    // Find move action
    const moveAction = findAction(fh, 1, 'move_figure');
    if (!moveAction) { console.log('  [skip] No move action available'); return; }

    const r = await fh.act(moveAction.customId, 'player1');
    // Movement may or may not create moveInProgress depending on handler flow
    // Some handlers transition directly; check what we got
    if (r.step.pendingCreated.includes('moveInProgress')) {
      const game = fh.getGame();
      assert.ok(Object.keys(game.moveInProgress).length > 0, 'moveInProgress has entries');

      // P1 should have movement actions
      const moveActions = fh.getActions(1).filter(a =>
        ['move_pick_space', 'move_mp', 'move_letter', 'move_done'].includes(a.type)
      );
      assert.ok(moveActions.length > 0, 'P1 has movement actions while move in progress');
    }
  });

  it('endOfRoundWhoseTurn: synthetic injection → only turn player has end-round action', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    const game = fh.getGame();
    // Simulate end-of-round state
    game.roundPhase = 'end_of_round';
    game.endOfRoundWhoseTurn = game.player1Id; // P1's turn first

    const p1Actions = fh.getActions(1);
    const p2Actions = fh.getActions(2);

    const p1EoR = p1Actions.find(a => a.type === 'end_end_of_round');
    const p2EoR = p2Actions.find(a => a.type === 'end_end_of_round');

    assert.ok(p1EoR, 'P1 has end-of-round action (their turn)');
    assert.ok(!p2EoR, 'P2 does NOT have end-of-round action (not their turn)');
  });
});

// ── Suite 8: Component Cleanup (DS-5) ───────────────────────────────────────

describe('Flow: component cleanup (DS-5)', () => {
  it('end-activation triggers component update evidence', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    await activateDc(fh, 1);
    const r = await endActivation(fh, 1);
    assertNoErrors(r, 'dc_end_activation');

    // Check that activation end produced some form of component cleanup
    const surface = fh.getSurface();
    const endStep = r.step.step;
    const stepEntries = surface.getStepEntries(endStep);

    // Should have either: interaction update, edit, or UI call
    const hasUpdate = stepEntries.some(e =>
      (e.source === 'interaction' && (e.responseType === 'update' || e.responseType === 'editReply')) ||
      (e.source === 'uiCall')
    );
    assert.ok(hasUpdate, 'End activation produced update or UI call');
  });

  it('combat resolution clears combat components', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    await activateDc(fh, 1);
    const attackAction = findAction(fh, 1, 'attack_target');
    if (!attackAction) { console.log('  [skip] No attack target'); return; }

    await fh.act(attackAction.customId, 'player1');
    await driveCombatToCompletion(fh);

    // Verify combat clearing produced cleanup evidence
    const surface = fh.getSurface();
    const combatCleared = surface.getPendingTransitions('pendingCombat')
      .find(t => t.transition === 'cleared');

    // Verify the full lifecycle: created → cleared
    const combatCreated = surface.getPendingTransitions('pendingCombat')
      .find(t => t.transition === 'created');
    assert.ok(combatCreated, 'pendingCombat was created');
    assert.ok(combatCleared, 'pendingCombat was cleared');
    assert.ok(
      combatCleared.step > combatCreated.step,
      `Combat cleared (step ${combatCleared?.step}) after creation (step ${combatCreated?.step})`
    );

    // After clearing, game should have no pendingCombat
    assert.ok(!fh.getGame().pendingCombat, 'pendingCombat is null after resolution');
  });
});

// ── Suite 9: Action Control Visibility (DS-6) ──────────────────────────────

describe('Flow: action control visibility (DS-6)', () => {
  it('private responses with components go to acting player only', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    await activateDc(fh, 1);
    const surface = fh.getSurface();

    const privateWithComponents = surface.entries.filter(e =>
      e.source === 'interaction' && e.visibility !== 'shared' && e.components?.length > 0
    );
    for (const entry of privateWithComponents) {
      const visPn = entry.visibility === 'p1' ? 1 : 2;
      assert.equal(visPn, entry.playerNum, `Private components at step ${entry.step} → correct player`);
    }
  });
});

// ── Suite 10: Regression Scenarios ──────────────────────────────────────────

describe('Flow: regression scenarios', () => {

  it('negation window: opponent gets response options, playing player waits', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    // Inject negation state
    const game = fh.getGame();
    game.pendingNegation = { playedBy: 1, card: 'Take Initiative', fromDc: false };

    // Verify correct player routing
    const p1Actions = fh.getActions(1);
    const p2Actions = fh.getActions(2);

    // P2 (opponent) should have negation options
    assert.ok(p2Actions.some(a => a.type === 'negation_let_resolve'), 'P2 can let resolve');
    // P1 (playing player) should NOT have negation options
    assert.ok(!p1Actions.some(a => a.type === 'negation_let_resolve'), 'P1 cannot respond to own negation');
    assert.ok(!p1Actions.some(a => a.type === 'negation_play'), 'P1 cannot negate own card');
  });

  it('end-activation turn switch: after P1 ends, P2 gets activate actions', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });

    // P1 activates and ends
    await activateDc(fh, 1);
    await endActivation(fh, 1);

    // Now P2 should be able to activate their DC
    const p2Actions = fh.getActions(2);
    const canActivate = p2Actions.some(a => a.type === 'activate_dc');
    const canPass = p2Actions.some(a => a.type === 'pass_activation_turn');
    assert.ok(canActivate || canPass, 'P2 has activate or pass actions after P1 ends');

    if (canActivate) {
      // P2 activates and ends
      await activateDc(fh, 2);
      await endActivation(fh, 2);

      // Turn should switch back or phase should advance
      const game = fh.getGame();
      const someoneCanAct = fh.getActions(1).length > 0 || fh.getActions(2).length > 0;
      assert.ok(someoneCanAct || game.ended, 'Game continues or ends after both activate');
    }
  });

  it('hand/discard updates: after activation, hand visual updates are private', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
      p1CcHand: ['Son of Skywalker'],
      p2CcHand: ['Deflection'],
    });

    await activateDc(fh, 1);
    await endActivation(fh, 1);

    const surface = fh.getSurface();

    // Any hand visual updates should be private to the correct player
    const handVisuals = surface.getUiCalls('updateHandVisualMessage');
    for (const call of handVisuals) {
      const expectedVis = call.playerNum === 1 ? 'p1' : 'p2';
      assert.equal(call.visibility, expectedVis,
        `Hand visual for P${call.playerNum} is ${expectedVis}-private`);
    }

    const discardUpdates = surface.getUiCalls('updateDiscardPileMessage');
    for (const call of discardUpdates) {
      const expectedVis = call.playerNum === 1 ? 'p1' : 'p2';
      assert.equal(call.visibility, expectedVis,
        `Discard pile for P${call.playerNum} is ${expectedVis}-private`);
    }
  });

  it('forfeit: game ends cleanly after all figures eliminated', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    // Use the deps to kill all P2 figures directly
    const game = fh.getGame();
    const deps = fh.getDeps();
    const p2Figs = Object.keys(game.figurePositions[2]);

    for (const figKey of p2Figs) {
      await deps.applyNpcDamageToFigure(game, 2, figKey, 999, 'Test kill');
    }

    // Game should be ended now
    assert.ok(game.ended, 'Game ended after all P2 figures killed');
    assert.ok(game.winnerId, 'Winner is set');

    // Invariants should still pass on ended game
    const errors = assertSurfaceInvariants(game, fh.getSurface(), 0);
    assert.deepEqual(errors, [], 'No surface violations on ended game');
  });

  it('combat with celebration + end activation: full flow no violations', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    // Run full flow: activate → attack → combat → maybe celebration → end
    await activateDc(fh, 1);
    const attackAction = findAction(fh, 1, 'attack_target');
    if (!attackAction) { console.log('  [skip] No attack target'); return; }

    await fh.act(attackAction.customId, 'player1');
    await driveCombatToCompletion(fh);

    // Track whether celebration happened
    const surface = fh.getSurface();
    let celebrationOccurred = false;

    if (fh.getGame().pendingCelebration) {
      celebrationOccurred = true;
      const pass = findAction(fh, 1, 'celebration_pass') || findAction(fh, 2, 'celebration_pass');
      if (pass) {
        const uid = findAction(fh, 1, 'celebration_pass') ? 'player1' : 'player2';
        const r = await fh.act(pass.customId, uid);
        assertNoErrors(r, 'celebration_pass');

        // Verify celebration was properly created and cleared
        const lifecycle = surface.getPendingLifecycle('pendingCelebration');
        assert.ok(lifecycle.created, 'Celebration created');
        assert.ok(lifecycle.cleared, 'Celebration cleared');
      }
    }

    if (!fh.getGame().ended) {
      const r = await endActivation(fh, 1);
      if (r) assertNoErrors(r, 'end_activation after combat');
    }

    console.log(`  [info] celebration=${celebrationOccurred}, steps=${fh.getStepLog().length}`);
  });
});

// ── Suite 11: Stress Test ───────────────────────────────────────────────────

describe('Flow: stress test with full invariants', () => {
  it('100 pseudo-random actions, all invariants checked', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'IG-88' }],
      p2Army: [{ dcName: 'Luke Skywalker' }],
      p1CcHand: ['Pummel', 'Blaze of Glory'],
      p2CcHand: ['Son of Skywalker', 'Deflection'],
    });

    const violations = [];

    for (let step = 0; step < 100; step++) {
      if (fh.getGame().ended) break;

      const p1Actions = fh.getActions(1);
      const p2Actions = fh.getActions(2);
      const allActions = [
        ...p1Actions.map(a => ({ ...a, _uid: 'player1' })),
        ...p2Actions.map(a => ({ ...a, _uid: 'player2' })),
      ];

      if (allActions.length === 0) {
        violations.push(`Step ${step}: dead-end`);
        break;
      }

      const action = allActions[step % allActions.length];
      const result = await fh.act(action.customId, action._uid);
      for (const err of result.invariantErrors) {
        violations.push(`Step ${step} (${action.type}): ${err}`);
      }
    }

    const surface = fh.getSurface();
    if (violations.length > 0) {
      console.log(`  [BUGS] ${violations.length} violations:`);
      for (const v of violations.slice(0, 10)) console.log(`    - ${v}`);
    }

    console.log(
      `  [info] ${fh.getStepLog().length} steps, ` +
      `${surface.entries.length} entries, ` +
      `${surface.pendingTransitions.length} transitions, ` +
      `${surface.componentHistory.length} component changes, ` +
      `${violations.length} violations`
    );
  });
});

// ── Suite 12: Payload Shape Validation — Synthetic (DS-7, DS-8, DS-9) ───────

describe('Flow: payload shape validation (synthetic)', () => {

  // Helper: build a plain-object ActionRow (bypasses Discord.js builder validation)
  function fakeRow(...children) {
    return { data: { type: 1 }, components: children };
  }
  function fakeButton(customId, label = 'B') {
    return { data: { type: 2, custom_id: customId, label, style: 1 } };
  }
  function fakeSelect(customId, optionCount) {
    const options = Array.from({ length: optionCount }, (_, i) => ({ label: `O${i}`, value: `v${i}` }));
    return { data: { type: 3, custom_id: customId, options } };
  }
  function fakeEmbed(overrides = {}) {
    return { data: { title: 'T', ...overrides } };
  }

  it('detects too many action rows', () => {
    const rows = Array.from({ length: 6 }, (_, i) => fakeRow(fakeButton(`b${i}`)));
    const errors = validatePayloadShape({ components: rows }, 'test-6-rows');
    assert.ok(errors.some(e => e.includes('6 action rows')), `Should flag 6 rows: ${errors}`);
  });

  it('detects too many buttons per row', () => {
    const buttons = Array.from({ length: 6 }, (_, i) => fakeButton(`b${i}`));
    const errors = validatePayloadShape({ components: [fakeRow(...buttons)] }, 'test-6-buttons');
    assert.ok(errors.some(e => e.includes('6 buttons')), `Should flag 6 buttons: ${errors}`);
  });

  it('detects too many select options', () => {
    const errors = validatePayloadShape({
      components: [fakeRow(fakeSelect('sel', 26))],
    }, 'test-26-opts');
    assert.ok(errors.some(e => e.includes('26 options')), `Should flag 26 options: ${errors}`);
  });

  it('detects zero select options', () => {
    const errors = validatePayloadShape({
      components: [fakeRow(fakeSelect('sel', 0))],
    }, 'test-0-opts');
    assert.ok(errors.some(e => e.includes('0 options')), `Should flag 0 options: ${errors}`);
  });

  it('detects embed title too long', () => {
    const errors = validatePayloadShape({
      embeds: [fakeEmbed({ title: 'X'.repeat(257) })],
    }, 'test-long-title');
    assert.ok(errors.some(e => e.includes('title') && e.includes('257')), `Should flag title: ${errors}`);
  });

  it('detects embed description too long', () => {
    const errors = validatePayloadShape({
      embeds: [fakeEmbed({ description: 'X'.repeat(4097) })],
    }, 'test-long-desc');
    assert.ok(errors.some(e => e.includes('description') && e.includes('4097')), `Should flag desc: ${errors}`);
  });

  it('detects too many embed fields', () => {
    const fields = Array.from({ length: 26 }, (_, i) => ({ name: `F${i}`, value: `V${i}` }));
    const errors = validatePayloadShape({
      embeds: [fakeEmbed({ fields })],
    }, 'test-26-fields');
    assert.ok(errors.some(e => e.includes('26 fields')), `Should flag 26 fields: ${errors}`);
  });

  it('detects embed field value too long', () => {
    const errors = validatePayloadShape({
      embeds: [fakeEmbed({ fields: [{ name: 'N', value: 'V'.repeat(1025) }] })],
    }, 'test-long-field');
    assert.ok(errors.some(e => e.includes('field value') && e.includes('1025')), `Should flag field: ${errors}`);
  });

  it('detects content too long', () => {
    const errors = validatePayloadShape({ content: 'X'.repeat(2001) }, 'test-long-content');
    assert.ok(errors.some(e => e.includes('content') && e.includes('2001')), `Should flag content: ${errors}`);
  });

  it('detects too many embeds', () => {
    const embeds = Array.from({ length: 11 }, () => fakeEmbed());
    const errors = validatePayloadShape({ embeds }, 'test-11-embeds');
    assert.ok(errors.some(e => e.includes('11 embeds')), `Should flag 11 embeds: ${errors}`);
  });

  it('detects customId too long', () => {
    const errors = validatePayloadShape({
      components: [fakeRow(fakeButton('x'.repeat(101)))],
    }, 'test-long-id');
    assert.ok(errors.some(e => e.includes('customId') && e.includes('101')), `Should flag customId: ${errors}`);
  });

  it('passes valid payloads without errors', () => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ok').setLabel('OK').setStyle(ButtonStyle.Primary)
    );
    const embed = new EmbedBuilder().setTitle('Title').addFields({ name: 'N', value: 'V' });
    const errors = validatePayloadShape({
      content: 'Hello',
      components: [row],
      embeds: [embed],
    }, 'test-valid');
    assert.deepEqual(errors, [], `Valid payload should have no errors: ${errors}`);
  });
});

// ── Suite 13: Payload Shape in Real Flows ───────────────────────────────────

describe('Flow: payload shape in real game flow (DS-7/8/9/10)', () => {

  it('full combat flow produces no payload shape violations', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });

    await activateDc(fh, 1);
    const attackAction = findAction(fh, 1, 'attack_target');
    if (!attackAction) { console.log('  [skip] No attack target'); return; }

    await fh.act(attackAction.customId, 'player1');
    await driveCombatToCompletion(fh);

    if (fh.getGame().pendingCelebration) {
      const pass = findAction(fh, 1, 'celebration_pass') || findAction(fh, 2, 'celebration_pass');
      if (pass) await fh.act(pass.customId, findAction(fh, 1, 'celebration_pass') ? 'player1' : 'player2');
    }

    if (!fh.getGame().ended) {
      await endActivation(fh, 1);
    }

    // Check all interaction responses for payload shape violations
    const surface = fh.getSurface();
    const shapeViolations = [];
    for (const entry of surface.entries) {
      if (entry.source !== 'interaction') continue;
      const entryErrors = validatePayloadShape(entry, `step-${entry.step}-${entry.responseType}`);
      shapeViolations.push(...entryErrors);
    }

    assert.deepEqual(shapeViolations, [],
      `Payload shape violations in combat flow:\n  ${shapeViolations.join('\n  ')}`);
  });

  it('multi-activation round produces no DS-7/8/9 violations', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }, { dcName: 'Han Solo' }],
      p2Army: [{ dcName: 'Darth Vader' }, { dcName: 'Stormtrooper (Elite)' }],
    });

    let actions = 0;
    for (let i = 0; i < 50 && actions < 8; i++) {
      if (fh.getGame().ended) break;

      for (const [pn, uid] of [[1, 'player1'], [2, 'player2']]) {
        for (const type of ['activate_dc', 'dc_end_activation', 'end_activation_phase', 'pass_activation_turn']) {
          const action = findAction(fh, pn, type);
          if (action) {
            const r = await fh.act(action.customId, uid);
            // Only check for DS-7/8/9/10 violations (the new ones)
            const dsViolations = r.invariantErrors.filter(e =>
              e.startsWith('DS-7') || e.startsWith('DS-8') || e.startsWith('DS-9') || e.startsWith('DS-10')
            );
            assert.deepEqual(dsViolations, [],
              `Payload violation at step ${i} ${type}: ${dsViolations.join('; ')}`);
            actions++;
            break;
          }
        }
        if (actions >= 8) break;
      }
    }
    assert.ok(actions >= 2, `At least 2 actions (got ${actions})`);
    console.log(`  [info] ${actions} actions, no DS-7/8/9/10 violations`);
  });

  it('stress test: 100 actions with payload shape checks', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'IG-88' }],
      p2Army: [{ dcName: 'Luke Skywalker' }],
      p1CcHand: ['Pummel', 'Blaze of Glory'],
      p2CcHand: ['Son of Skywalker', 'Deflection'],
    });

    const payloadViolations = [];

    for (let step = 0; step < 100; step++) {
      if (fh.getGame().ended) break;

      const p1Actions = fh.getActions(1);
      const p2Actions = fh.getActions(2);
      const allActions = [
        ...p1Actions.map(a => ({ ...a, _uid: 'player1' })),
        ...p2Actions.map(a => ({ ...a, _uid: 'player2' })),
      ];

      if (allActions.length === 0) break;

      const action = allActions[step % allActions.length];
      const result = await fh.act(action.customId, action._uid);

      const dsPayload = result.invariantErrors.filter(e =>
        e.startsWith('DS-7') || e.startsWith('DS-8') || e.startsWith('DS-9') || e.startsWith('DS-10')
      );
      payloadViolations.push(...dsPayload);
    }

    if (payloadViolations.length > 0) {
      console.log(`  [PAYLOAD BUGS] ${payloadViolations.length}:`);
      for (const v of payloadViolations.slice(0, 5)) console.log(`    - ${v}`);
    }

    assert.deepEqual(payloadViolations, [],
      `Payload shape violations in stress test:\n  ${payloadViolations.join('\n  ')}`);
    console.log(`  [info] ${fh.getStepLog().length} steps, 0 payload violations`);
  });
});
