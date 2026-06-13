/**
 * BEHAVIORAL oracle tests for Round/Lifecycle Phase 2: status-phase and round-transition correctness.
 *
 * Tests the universal round flows: end-activation-phase confirmation,
 * activation-count recomputation, CC draw count arithmetic,
 * and representative end-of-round status effects.
 *
 * Status phase pipeline:
 *   handleStatusPhase — both-player confirmation (p1/p2ActivationPhaseEnded)
 *   → sendPhaseGateMessages('pre_end_of_round') → EoR window
 *   → _runStatusPhaseLogic:
 *     1. Ready cards: un-exhaust, setActivatedDcIndices([]), recomputeActivationCounts
 *     2. Draw CCs: base 1 + terminals + Rebel High Command - Channel the Force
 *     3. EoR effects: Regenerate, Hardy, etc.
 *     4. _runInitiativeSwapAndContinue: initiative swap, currentRound++, cleanupRoundStart
 *
 * Test categories:
 *   B-STATUS-001: handleStatusPhase both-player confirmation flow
 *   B-STATUS-002: handleStatusPhase guards (activations remaining, wrong player)
 *   B-STATUS-003: recomputeActivationCounts — round-boundary reset
 *   B-STATUS-004: CC draw count arithmetic (base, terminals, RHC, Cut Lines)
 *   B-STATUS-005: runStatusPhaseAfterEndOfRound representative e2e path
 *   B-STATUS-006: Representative EoR effects (Regenerate healing, Hardy condition clear)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleStatusPhase } from '../../../src/handlers/activation.js';
import { runStatusPhaseAfterEndOfRound, handleEndEndOfRound } from '../../../src/handlers/round.js';
import { recomputeActivationCounts, setActivatedDcIndices } from '../../../src/game/player-helpers.js';

/**
 * Drive the End-of-Round player window to completion (init player, then other).
 *
 * Per alexanbv 2026-06-13, runStatusPhaseAfterEndOfRound now only runs the
 * status-phase PREFIX (ready DCs, draw CCs, mission EoR) and then OPENS the EoR
 * player window. The SUFFIX — DC EoR auto-effects (Regenerate/Hardy),
 * initiative swap, currentRound++, cleanupRoundStart — runs only after BOTH
 * players pass the window via handleEndEndOfRound.
 */
async function passEorWindow(game, ctx) {
  const mkInteraction = (userId) => {
    const mockMsg = { id: 'eor-msg', delete: async () => ({}), edit: async () => ({}), components: [] };
    return {
      customId: `end_end_of_round_${game.gameId}`,
      user: { id: userId },
      followUp: async () => mockMsg,
      deferUpdate: async () => ({}),
      update: async () => ({}),
      message: mockMsg,
    };
  };
  const initId = game.endOfRoundWhoseTurn;
  assert.ok(initId, 'EoR window should be open after the status-phase prefix');
  await handleEndEndOfRound(mkInteraction(initId), ctx);
  const otherId = game.endOfRoundWhoseTurn;
  assert.ok(otherId && otherId !== initId, 'window should toggle to the non-initiative player');
  await handleEndEndOfRound(mkInteraction(otherId), ctx);
}

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  const mockMsg = {
    id: 'msg-1',
    delete: async () => ({}),
    edit: async () => ({}),
    components: [],
  };
  return {
    customId,
    user: { id: userId },
    followUp: async (msg) => { followUpCalls.push(msg); return mockMsg; },
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: mockMsg,
    client: {
      channels: { fetch: async () => ({ messages: { fetch: async () => mockMsg }, send: async () => mockMsg }) },
    },
    _followUpCalls: followUpCalls,
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    player1Id: 'player1',
    player2Id: 'player2',
    generalId: 'general-ch',
    p1PlayAreaId: 'pa1',
    p2PlayAreaId: 'pa2',
    p1HandId: 'hand1',
    p2HandId: 'hand2',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    initiativePlayerId: 'player1',
    p1ActivationsRemaining: 0,
    p2ActivationsRemaining: 0,
    p1ActivationsTotal: 0,
    p2ActivationsTotal: 0,
    p1ActivatedDcIndices: [],
    p2ActivatedDcIndices: [],
    ...overrides,
  };
}

/**
 * Build ctx for handleStatusPhase (activation.js).
 */
function buildStatusPhaseCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    sendPhaseGateMessages: [],
    logGameAction: [],
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      hasActionsRemainingInGame: () => false,
      GAME_PHASES: { ROUND: { emoji: '🔄' } },
      PHASE_COLOR: 0x00ff00,
      getInitiativePlayerZoneLabel: () => '',
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      updateHandChannelMessages: async () => {},
      sendPhaseGateMessages: async (g, phase) => { calls.sendPhaseGateMessages.push(phase); },
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async () => ({}) }) }, send: async () => ({}) }) } },
      ...overrides,
    },
    calls,
  };
}

/**
 * Build ctx for runStatusPhaseAfterEndOfRound (round.js).
 * This runs _runStatusPhaseLogic, which is the universal skeleton.
 * Mocks all Discord-specific operations; getDcEffects returns {} to skip DC-specific EoR effects.
 */
function buildRunStatusCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    recomputeActivationCounts: [],
    renderDcEmbed: [],
  };

  /** Mock discord collection — supports .find() like a real discord.js Collection */
  const mockCollection = { find: () => null, filter: () => mockCollection, size: 0 };
  const mockChannel = {
    messages: { fetch: async (id) => {
      if (typeof id === 'string') return { edit: async () => ({}), delete: async () => ({}) };
      return mockCollection;
    }},
    send: async () => ({ id: 'new-msg' }),
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      getPlayerZoneLabel: () => '',
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      updateHandChannelMessages: async () => {},
      updateHandVisualMessage: async () => {},
      buildHandDisplayPayload: () => ({ content: '', embeds: [], components: [] }),
      saveGames: () => { calls.saveGames.push(true); },
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      isDepletedRemovedFromGame: () => false,
      renderDcEmbed: async () => { calls.renderDcEmbed.push(true); return { embed: {}, files: [] }; },
      getDcPlayAreaComponents: () => [],
      countTerminalsControlledByPlayer: () => 0,
      isFigureInDeploymentZone: () => false,
      checkWinConditions: async () => {},
      getMapTokensData: () => ({}),
      getSpaceController: () => null,
      getMissionRules: () => ({}),
      runEndOfRoundRules: null,
      runStartOfRoundRules: null,
      getFiguresOnOrAdjacentToSpace: () => [],
      runNpcThugActivation: null,
      runNpcKryknaActivation: null,
      applyNpcDamageToFigure: null,
      getMapData: () => null,
      getMapRegistry: () => ({}),
      filterMapSpacesByBounds: () => [],
      getInitiativePlayerZoneLabel: () => '',
      sendRoundActivationPhaseMessage: async () => {},
      buildBoardMapPayload: null,
      sendPhaseGateMessages: async () => {},
      postDevaronDoorButtons: null,
      postDevaronCratePushPrompts: null,
      postKryknaPushButtons: null,
      postFluctuationSwapButtons: null,
      client: { channels: { fetch: async () => mockChannel } },
      ...overrides,
    },
    calls,
  };
}

// ── B-STATUS-001: handleStatusPhase both-player confirmation ───────────────

describe('B-STATUS-001: handleStatusPhase both-player confirmation flow', () => {
  it('001a: P1 clicks first → p1ActivationPhaseEnded=true, P2 still pending, saveGames called', async () => {
    const game = makeGame();
    const { ctx, calls } = buildStatusPhaseCtx(game);
    const interaction = mockInteraction('status_phase_42', 'player1');
    await handleStatusPhase(interaction, ctx);

    assert.strictEqual(game.p1ActivationPhaseEnded, true, 'p1ActivationPhaseEnded set');
    assert.strictEqual(game.p2ActivationPhaseEnded, false, 'p2ActivationPhaseEnded still false');
    assert.strictEqual(calls.sendPhaseGateMessages.length, 0,
      'phase gate NOT sent — still waiting for P2');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('001b: P2 clicks after P1 → both ended, sendPhaseGateMessages(pre_end_of_round) called', async () => {
    const game = makeGame({ p1ActivationPhaseEnded: true });
    const { ctx, calls } = buildStatusPhaseCtx(game);
    const interaction = mockInteraction('status_phase_42', 'player2');
    await handleStatusPhase(interaction, ctx);

    // Both ended → flags reset
    assert.strictEqual(game.p1ActivationPhaseEnded, false, 'p1ActivationPhaseEnded reset');
    assert.strictEqual(game.p2ActivationPhaseEnded, false, 'p2ActivationPhaseEnded reset');
    // Phase gate triggered
    assert.strictEqual(calls.sendPhaseGateMessages.length, 1,
      'sendPhaseGateMessages called once');
    assert.strictEqual(calls.sendPhaseGateMessages[0], 'pre_end_of_round',
      'phase gate = pre_end_of_round');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('001c: P2 clicks first, then P1 → same result', async () => {
    const game = makeGame();
    const { ctx: ctx1, calls: calls1 } = buildStatusPhaseCtx(game);
    await handleStatusPhase(mockInteraction('status_phase_42', 'player2'), ctx1);

    assert.strictEqual(game.p2ActivationPhaseEnded, true, 'p2 set after first click');
    assert.strictEqual(game.p1ActivationPhaseEnded, false, 'p1 still false');
    assert.strictEqual(calls1.sendPhaseGateMessages.length, 0, 'gate not sent yet');

    const { ctx: ctx2, calls: calls2 } = buildStatusPhaseCtx(game);
    await handleStatusPhase(mockInteraction('status_phase_42', 'player1'), ctx2);

    assert.strictEqual(game.p1ActivationPhaseEnded, false, 'both flags reset after both-ended');
    assert.strictEqual(game.p2ActivationPhaseEnded, false, 'both flags reset');
    assert.strictEqual(calls2.sendPhaseGateMessages[0], 'pre_end_of_round', 'gate sent');
  });
});

// ── B-STATUS-002: handleStatusPhase guards ─────────────────────────────────

describe('B-STATUS-002: handleStatusPhase guards', () => {
  it('002a: rejects when activations remaining', async () => {
    const game = makeGame({ p1ActivationsRemaining: 2 });
    const { ctx, calls } = buildStatusPhaseCtx(game);
    const interaction = mockInteraction('status_phase_42', 'player1');
    await handleStatusPhase(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('must use all activations'));
    assert.ok(msg, 'ephemeral "must use all activations" reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('002b: rejects when actions remaining in game', async () => {
    const game = makeGame();
    const { ctx, calls } = buildStatusPhaseCtx(game, {
      hasActionsRemainingInGame: () => true,
    });
    const interaction = mockInteraction('status_phase_42', 'player1');
    await handleStatusPhase(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('actions'));
    assert.ok(msg, 'ephemeral actions-remaining reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('002c: rejects non-player (spectator)', async () => {
    const game = makeGame();
    const { ctx, calls } = buildStatusPhaseCtx(game);
    const interaction = mockInteraction('status_phase_42', 'spectator123');
    await handleStatusPhase(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Only players'));
    assert.ok(msg, 'ephemeral non-player reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('002d: same player clicking twice does not double-advance', async () => {
    const game = makeGame();
    const { ctx: ctx1 } = buildStatusPhaseCtx(game);
    await handleStatusPhase(mockInteraction('status_phase_42', 'player1'), ctx1);
    assert.strictEqual(game.p1ActivationPhaseEnded, true, 'P1 set');

    // P1 clicks again — p1ActivationPhaseEnded already true, but code re-sets it
    // Key: sendPhaseGateMessages should NOT be called because p2 still false
    const { ctx: ctx2, calls: calls2 } = buildStatusPhaseCtx(game);
    await handleStatusPhase(mockInteraction('status_phase_42', 'player1'), ctx2);

    assert.strictEqual(game.p1ActivationPhaseEnded, true, 'P1 still set (re-set is harmless)');
    assert.strictEqual(game.p2ActivationPhaseEnded, false, 'P2 still false');
    assert.strictEqual(calls2.sendPhaseGateMessages.length, 0,
      'gate NOT sent — P2 has not confirmed');
  });
});

// ── B-STATUS-003: recomputeActivationCounts ────────────────────────────────

describe('B-STATUS-003: recomputeActivationCounts — round-boundary reset', () => {
  it('003a: recomputes correctly with 2 DCs that have figures', () => {
    const game = makeGame({
      p1DcList: [
        { dcName: 'Rebel Trooper' },
        { dcName: 'Han Solo' },
      ],
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1', 'Han Solo-1-0': 'b2' },
        2: {},
      },
      p1ActivatedDcIndices: [0], // Rebel Trooper was activated
    });

    const result = recomputeActivationCounts(game, 1);

    assert.strictEqual(result.total, 2, 'total = 2 DCs with figures');
    assert.strictEqual(result.remaining, 1, 'remaining = 1 (1 activated)');
    assert.strictEqual(game.p1ActivationsTotal, 2, 'game.p1ActivationsTotal = 2');
    assert.strictEqual(game.p1ActivationsRemaining, 1, 'game.p1ActivationsRemaining = 1');
  });

  it('003b: after clearing activatedDcIndices (round boundary), remaining = total', () => {
    const game = makeGame({
      p1DcList: [
        { dcName: 'Rebel Trooper' },
        { dcName: 'Han Solo' },
      ],
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1', 'Han Solo-1-0': 'b2' },
        2: {},
      },
      p1ActivatedDcIndices: [0, 1], // both activated last round
    });

    // Simulate round boundary: clear activated indices, recompute
    setActivatedDcIndices(game, 1, []);
    const result = recomputeActivationCounts(game, 1);

    assert.strictEqual(result.total, 2, 'total = 2');
    assert.strictEqual(result.remaining, 2, 'remaining = 2 — all activations restored');
    assert.strictEqual(game.p1ActivationsRemaining, 2, 'game reflects new remaining');
  });

  it('003c: skirmish upgrades ([brackets]) are excluded from activation count', () => {
    const game = makeGame({
      p1DcList: [
        { dcName: 'Rebel Trooper' },
        { dcName: '[Extra Armor]' },
        { dcName: '[Rebel High Command]' },
      ],
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: {},
      },
      p1ActivatedDcIndices: [],
    });

    const result = recomputeActivationCounts(game, 1);

    assert.strictEqual(result.total, 1,
      'total = 1 — skirmish upgrades [Extra Armor] and [Rebel High Command] excluded');
    assert.strictEqual(result.remaining, 1, 'remaining = 1');
  });

  it('003d: DC with no living figures contributes 0 to activation count', () => {
    const game = makeGame({
      p1DcList: [
        { dcName: 'Rebel Trooper' },
        { dcName: 'Han Solo' },
      ],
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' }, // Han Solo has no figures (defeated)
        2: {},
      },
      p1ActivatedDcIndices: [],
    });

    const result = recomputeActivationCounts(game, 1);

    assert.strictEqual(result.total, 1,
      'total = 1 — Han Solo has no figures on board');
    assert.strictEqual(result.remaining, 1, 'remaining = 1');
  });
});

// ── B-STATUS-004: CC draw count arithmetic ─────────────────────────────────

describe('B-STATUS-004: CC draw count arithmetic', () => {
  /**
   * The draw formula in _runStatusPhaseLogic (round.js:220):
   *   drawCount = 1 + terminals + (hasRHC ? 1 : 0) - (hasCtF ? 1 : 0)
   *   if noCommandDrawThisRound: drawCount = 0
   *
   * Since _runStatusPhaseLogic is private, we test the arithmetic directly
   * via runStatusPhaseAfterEndOfRound and verify the deck/hand state.
   */

  it('004a: base draw = 1 card per player (no terminals, no bonuses)', async () => {
    const game = makeGame({
      player1CcDeck: ['Card A', 'Card B'],
      player2CcDeck: ['Card C', 'Card D'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });
    const { ctx } = buildRunStatusCtx(game);

    await runStatusPhaseAfterEndOfRound(game, ctx);

    assert.deepStrictEqual(game.player1CcHand, ['Card A'],
      'P1 drew 1 card (base draw)');
    assert.deepStrictEqual(game.player1CcDeck, ['Card B'],
      'P1 deck lost 1 card');
    assert.deepStrictEqual(game.player2CcHand, ['Card C'],
      'P2 drew 1 card (base draw)');
    assert.deepStrictEqual(game.player2CcDeck, ['Card D'],
      'P2 deck lost 1 card');
  });

  it('004b: terminal bonus = +1 per terminal controlled', async () => {
    const game = makeGame({
      player1CcDeck: ['A1', 'A2', 'A3'],
      player2CcDeck: ['B1', 'B2', 'B3'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });
    const { ctx } = buildRunStatusCtx(game, {
      // P1 controls 2 terminals, P2 controls 1
      countTerminalsControlledByPlayer: (g, pn) => pn === 1 ? 2 : 1,
    });

    await runStatusPhaseAfterEndOfRound(game, ctx);

    // P1: base 1 + 2 terminals = 3 cards
    assert.strictEqual(game.player1CcHand.length, 3,
      'P1 drew 3 cards (1 base + 2 terminals)');
    // P2: base 1 + 1 terminal = 2 cards
    assert.strictEqual(game.player2CcHand.length, 2,
      'P2 drew 2 cards (1 base + 1 terminal)');
  });

  it('004c: Rebel High Command adds +1 draw', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: 'Rebel Trooper' }, { dcName: '[Rebel High Command]' }],
      p2DcList: [{ dcName: 'Stormtrooper' }],
      player1CcDeck: ['A1', 'A2', 'A3'],
      player2CcDeck: ['B1', 'B2', 'B3'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });
    const { ctx } = buildRunStatusCtx(game);

    await runStatusPhaseAfterEndOfRound(game, ctx);

    // P1: base 1 + RHC 1 = 2 cards
    assert.strictEqual(game.player1CcHand.length, 2,
      'P1 drew 2 cards (1 base + 1 Rebel High Command)');
    // P2: base 1 = 1 card
    assert.strictEqual(game.player2CcHand.length, 1,
      'P2 drew 1 card (no bonuses)');
  });

  it('004d: noCommandDrawThisRound (Cut Lines) → 0 draw for both players', async () => {
    const game = makeGame({
      player1CcDeck: ['A1', 'A2'],
      player2CcDeck: ['B1', 'B2'],
      player1CcHand: ['existing1'],
      player2CcHand: ['existing2'],
      selectedMap: { id: 'test-map' },
      noCommandDrawThisRound: true,
    });
    const { ctx } = buildRunStatusCtx(game);

    await runStatusPhaseAfterEndOfRound(game, ctx);

    assert.deepStrictEqual(game.player1CcHand, ['existing1'],
      'P1 hand unchanged — Cut Lines blocked draw');
    assert.deepStrictEqual(game.player2CcHand, ['existing2'],
      'P2 hand unchanged');
    assert.strictEqual(game.noCommandDrawThisRound, false,
      'noCommandDrawThisRound consumed (set to false)');
  });

  it('004e: empty deck → draw stops (no crash, no phantom cards)', async () => {
    const game = makeGame({
      player1CcDeck: [], // empty deck
      player2CcDeck: ['B1'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });
    const { ctx } = buildRunStatusCtx(game);

    await runStatusPhaseAfterEndOfRound(game, ctx);

    assert.deepStrictEqual(game.player1CcHand, [],
      'P1 hand empty — deck was empty');
    assert.deepStrictEqual(game.player2CcHand, ['B1'],
      'P2 drew 1 card normally');
  });

  it('004f: terminal + RHC stacking is additive', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: 'Rebel Trooper' }, { dcName: '[Rebel High Command]' }],
      player1CcDeck: ['A1', 'A2', 'A3', 'A4', 'A5'],
      player2CcDeck: ['B1'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });
    const { ctx } = buildRunStatusCtx(game, {
      // P1 controls 2 terminals
      countTerminalsControlledByPlayer: (g, pn) => pn === 1 ? 2 : 0,
    });

    await runStatusPhaseAfterEndOfRound(game, ctx);

    // P1: base 1 + 2 terminals + 1 RHC = 4 cards
    assert.strictEqual(game.player1CcHand.length, 4,
      'P1 drew 4 cards (1 base + 2 terminals + 1 RHC)');
  });
});

// ── B-STATUS-005: runStatusPhaseAfterEndOfRound representative e2e ─────────

describe('B-STATUS-005: runStatusPhaseAfterEndOfRound representative e2e path', () => {
  it('005: ready cards + draw CCs + initiative swap + round increment + cleanup', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: 'Rebel Trooper' }, { dcName: 'Han Solo' }],
      p2DcList: [{ dcName: 'Stormtrooper' }],
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1', 'Han Solo-1-0': 'b2' },
        2: { 'Stormtrooper-1-0': 'c3' },
      },
      p1ActivatedDcIndices: [0, 1], // both activated
      p2ActivatedDcIndices: [0],
      p1ActivationsRemaining: 0,
      p2ActivationsRemaining: 0,
      player1CcDeck: ['CC1', 'CC2'],
      player2CcDeck: ['CC3', 'CC4'],
      player1CcHand: [],
      player2CcHand: [],
      currentRound: 1,
      initiativePlayerId: 'player1',
      selectedMap: { id: 'test-map' },
      // Round-scoped flags that should be cleaned up
      tripodAttacked: { 'Rebel Trooper-1-0': true },
      figureMoved: { 'Rebel Trooper-1-0': true },
    });

    // Add DC metadata for ready-step iteration
    const dcMeta = new Map([
      ['m1', { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper', playerNum: 1, gameId: '42' }],
      ['m2', { dcName: 'Han Solo', displayName: 'Han Solo', playerNum: 1, gameId: '42' }],
      ['m3', { dcName: 'Stormtrooper', displayName: 'Stormtrooper', playerNum: 2, gameId: '42' }],
    ]);
    game.p1DcMessageIds = ['m1', 'm2'];
    game.p2DcMessageIds = ['m3'];

    const dcExhausted = new Map([['m1', true], ['m2', true], ['m3', true]]);

    const { ctx, calls } = buildRunStatusCtx(game, {
      dcMessageMeta: dcMeta,
      dcExhaustedState: dcExhausted,
    });

    // Prefix: ready cards + draw CCs + open EoR window.
    await runStatusPhaseAfterEndOfRound(game, ctx);
    // Suffix (DC EoR effects + initiative swap + round++ + cleanup) runs once
    // both players pass the EoR window.
    await passEorWindow(game, ctx);

    // STEP 1: Ready cards — activated indices cleared, counts recomputed
    assert.deepStrictEqual(game.p1ActivatedDcIndices, [],
      'Step 1: p1ActivatedDcIndices cleared');
    assert.deepStrictEqual(game.p2ActivatedDcIndices, [],
      'Step 1: p2ActivatedDcIndices cleared');
    assert.strictEqual(game.p1ActivationsTotal, 2,
      'Step 1: P1 total = 2 DCs with figures');
    assert.strictEqual(game.p1ActivationsRemaining, 2,
      'Step 1: P1 remaining = 2 — all restored');
    assert.strictEqual(game.p2ActivationsTotal, 1,
      'Step 1: P2 total = 1');
    assert.strictEqual(game.p2ActivationsRemaining, 1,
      'Step 1: P2 remaining = 1');

    // DCs un-exhausted
    assert.strictEqual(dcExhausted.get('m1'), false, 'Step 1: DC m1 un-exhausted');
    assert.strictEqual(dcExhausted.get('m2'), false, 'Step 1: DC m2 un-exhausted');
    assert.strictEqual(dcExhausted.get('m3'), false, 'Step 1: DC m3 un-exhausted');

    // STEP 2: Draw CCs (base 1 per player)
    assert.deepStrictEqual(game.player1CcHand, ['CC1'],
      'Step 2: P1 drew 1 card');
    assert.deepStrictEqual(game.player2CcHand, ['CC3'],
      'Step 2: P2 drew 1 card');

    // STEP 4 (via _runInitiativeSwapAndContinue):
    // Initiative swapped, round incremented, cleanup ran
    assert.strictEqual(game.initiativePlayerId, 'player2',
      'Step 4: initiative swapped to player2');
    assert.strictEqual(game.currentRound, 2,
      'Step 4: currentRound incremented to 2');

    // Round-scoped flags cleaned up by cleanupRoundStart
    assert.deepStrictEqual(game.tripodAttacked, {},
      'cleanupRoundStart: tripodAttacked reset to {}');
    assert.deepStrictEqual(game.figureMoved, {},
      'cleanupRoundStart: figureMoved reset to {}');

    // saveGames called
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-STATUS-006: Representative EoR effects ───────────────────────────────

describe('B-STATUS-006: Representative EoR effects', () => {
  it('006a: Regenerate (Bossk) — recovers HP and clears Bleed', async () => {
    const game = makeGame({
      p1DcList: [{ dcName: 'Bossk' }],
      p1DcMessageIds: ['m1'],
      figurePositions: { 1: { 'Bossk-1-0': 'a1' }, 2: {} },
      figureConditions: { 'Bossk-1-0': ['Bleed', 'Focus'] },
      player1CcDeck: ['CC1'],
      player2CcDeck: ['CC2'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });

    const dcMeta = new Map([
      ['m1', { dcName: 'Bossk', displayName: 'Bossk', playerNum: 1, gameId: '42' }],
    ]);
    // Bossk at 3/6 HP — will recover 2 → 5/6
    const dcHealth = new Map([['m1', [[3, 6]]]]);
    const dcExhausted = new Map([['m1', true]]);

    // getDcEffects must return Regenerate for Bossk
    const { getDcEffects: _origGetDcEffects } = await import('../../../src/data-loader.js');

    const { ctx, calls } = buildRunStatusCtx(game, {
      dcMessageMeta: dcMeta,
      dcHealthState: dcHealth,
      dcExhaustedState: dcExhausted,
    });

    await runStatusPhaseAfterEndOfRound(game, ctx);
    await passEorWindow(game, ctx); // suffix runs Regenerate DC EoR effect

    // Verify Bleed cleared (Regenerate clears Bleed)
    const conds = game.figureConditions['Bossk-1-0'] || [];
    assert.ok(!conds.includes('Bleed'),
      'Bleed removed from Bossk (Regenerate clears Bleed)');
    assert.ok(conds.includes('Focus'),
      'Focus preserved — Regenerate only clears Bleed');

    // Verify HP recovery
    const hp = dcHealth.get('m1');
    assert.ok(hp[0][0] > 3,
      'Bossk recovered HP (Regenerate heals 2)');
  });

  it('006b: Hardy (Trandoshan Hunter Elite) — clears all harmful conditions', async () => {
    const game = makeGame({
      p2DcList: [{ dcName: 'Trandoshan Hunter (Elite)' }],
      p2DcMessageIds: ['m2'],
      figurePositions: { 1: {}, 2: { 'Trandoshan Hunter (Elite)-2-0': 'c3' } },
      figureConditions: {
        'Trandoshan Hunter (Elite)-2-0': ['Bleed', 'Stun', 'Weaken', 'Focus', 'Hide'],
      },
      player1CcDeck: ['CC1'],
      player2CcDeck: ['CC2'],
      player1CcHand: [],
      player2CcHand: [],
      selectedMap: { id: 'test-map' },
    });

    const dcMeta = new Map([
      ['m2', { dcName: 'Trandoshan Hunter (Elite)', displayName: 'Trandoshan Hunter (Elite)', playerNum: 2, gameId: '42' }],
    ]);
    const dcHealth = new Map([['m2', [[5, 5]]]]);
    const dcExhausted = new Map([['m2', true]]);

    // getDcEffects uses the real data loader — Hardy must be found for Trandoshan Hunter (Elite)
    const { ctx } = buildRunStatusCtx(game, {
      dcMessageMeta: dcMeta,
      dcHealthState: dcHealth,
      dcExhaustedState: dcExhausted,
    });

    await runStatusPhaseAfterEndOfRound(game, ctx);
    await passEorWindow(game, ctx); // suffix runs Hardy DC EoR effect

    const conds = game.figureConditions['Trandoshan Hunter (Elite)-2-0'] || [];
    // Hardy clears Bleed, Stun, Weaken (HARMFUL conditions)
    assert.ok(!conds.includes('Bleed'), 'Bleed cleared by Hardy');
    assert.ok(!conds.includes('Stun'), 'Stun cleared by Hardy');
    assert.ok(!conds.includes('Weaken'), 'Weaken cleared by Hardy');
    // Focus and Hide are BENEFICIAL — should be preserved
    assert.ok(conds.includes('Focus'), 'Focus preserved (not harmful)');
    assert.ok(conds.includes('Hide'), 'Hide preserved (not harmful)');
  });
});
