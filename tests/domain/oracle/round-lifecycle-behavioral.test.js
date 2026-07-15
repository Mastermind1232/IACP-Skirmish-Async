/**
 * BEHAVIORAL oracle tests for Round/Phase Lifecycle Phase 1.
 *
 * Tests the core round-boundary correctness that affects every game:
 * cleanupRoundStart flag reset, handler entry guards, turn toggling,
 * stale pending flag expiry, and non-round state preservation.
 *
 * Test categories:
 *   B-RNDLC-001: cleanupRoundStart resets ROUND_OBJECT_FLAGS to {}
 *   B-RNDLC-002: cleanupRoundStart resets ROUND_NULL_FLAGS to null
 *   B-RNDLC-003: cleanupRoundStart resets ROUND_ARRAY_FLAGS to []
 *   B-RNDLC-004: cleanupRoundStart resets ROUND_FALSE_FLAGS to false
 *   B-RNDLC-005: cleanupRoundStart deletes ROUND_DELETE_FLAGS
 *   B-RNDLC-006: cleanupRoundStart preserves non-round state
 *   B-RNDLC-007: Stale pending flags from round N don't survive to round N+1
 *   B-RNDLC-008: handleEndEndOfRound guards (not in window, wrong player)
 *   B-RNDLC-009: handleEndEndOfRound initiative → opponent turn toggle
 *   B-RNDLC-010: handleEndStartOfRound guards (not in window, wrong player)
 *   B-RNDLC-011: handleEndStartOfRound initiative → opponent toggle
 *   B-RNDLC-012: handleEndStartOfRound sets currentActivationTurnPlayerId
 *   B-RNDLC-013: setRoundPhase validates transitions
 *   B-RNDLC-014: Full round boundary invariant — initiative swap + round increment + cleanup
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupRoundStart,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../../src/game/activation-state.js';
import { handleEndEndOfRound, handleEndStartOfRound } from '../../../src/handlers/round.js';
import { setRoundPhase, ROUND_PHASES, enableStrictPhaseTransitions } from '../../../src/game/phase.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  const mockMsg = {
    id: 'round-msg-1',
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
    currentRound: 1,
    initiativePlayerId: 'player1',
    figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: { 'Stormtrooper-2-0': 'b1' } },
    figureConditions: {},
    figurePowerTokens: {},
    phase: 'round_active',
    ...overrides,
  };
}

/**
 * Build ctx for round handlers.
 * Only mocks what the guard/toggle paths need (not full status phase logic).
 */
function buildRoundCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    updateHandChannelMessages: [],
    sendPhaseGateMessages: [],
  };

  const mockChannel = {
    messages: { fetch: async () => ({ delete: async () => ({}), edit: async () => ({}) }) },
    send: async () => ({ id: 'new-msg' }),
    setArchived: async () => ({}),
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      getPlayerZoneLabel: (g, userId) => userId === game.player1Id ? 'Rebel ' : 'Imperial ',
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      updateHandChannelMessages: async (...args) => { calls.updateHandChannelMessages.push(args); },
      saveGames: () => { calls.saveGames.push(true); },
      // Phase gate intercepts — prevents _runStatusPhaseLogic from running
      sendPhaseGateMessages: async (g, phase, c) => { calls.sendPhaseGateMessages.push(phase); },
      // SOR handler needs these
      shouldShowEndActivationPhaseButton: () => false,
      countTerminalsControlledByPlayer: () => 0,
      GAME_PHASES: { ROUND: { emoji: '🔄' } },
      PHASE_COLOR: 0x3498db,
      getInitiativePlayerZoneLabel: () => 'Rebel ',
      updateHandVisualMessage: async () => {},
      buildHandDisplayPayload: async () => ({}),
      sendRoundActivationPhaseMessage: async () => ({ id: 'round-msg' }),
      buildBoardMapPayload: async () => ({}),
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      isDepletedRemovedFromGame: () => false,
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      checkWinConditions: async () => false,
      client: { channels: { fetch: async () => mockChannel }, user: { id: 'bot' } },
      ...overrides,
    },
    calls,
  };
}

// ── B-RNDLC-001: cleanupRoundStart resets ROUND_OBJECT_FLAGS to {} ────────

describe('B-RNDLC-001: cleanupRoundStart resets all ROUND_OBJECT_FLAGS to {}', () => {
  it('001: every ROUND_OBJECT_FLAG is {} after cleanup', () => {
    const game = {};
    // Seed every flag with non-empty objects
    for (const key of ROUND_OBJECT_FLAGS) {
      game[key] = { someKey: 'dirty-value', nested: { a: 1 } };
    }

    cleanupRoundStart(game);

    for (const key of ROUND_OBJECT_FLAGS) {
      assert.deepStrictEqual(game[key], {},
        `${key} should be reset to {} — was ${JSON.stringify(game[key])}`);
    }
  });

  it('001b: ROUND_OBJECT_FLAGS count matches expected range (regression guard)', () => {
    // If a flag is added to the source but not here, this catches drift
    assert.ok(ROUND_OBJECT_FLAGS.length >= 90,
      `Expected ≥90 ROUND_OBJECT_FLAGS, got ${ROUND_OBJECT_FLAGS.length}`);
    assert.ok(ROUND_OBJECT_FLAGS.length <= 120,
      `Expected ≤120 ROUND_OBJECT_FLAGS, got ${ROUND_OBJECT_FLAGS.length} — review if intentional`);
  });
});

// ── B-RNDLC-002: cleanupRoundStart resets ROUND_NULL_FLAGS to null ────────

describe('B-RNDLC-002: cleanupRoundStart resets all ROUND_NULL_FLAGS to null', () => {
  it('002: every ROUND_NULL_FLAG is null after cleanup', () => {
    const game = {};
    for (const key of ROUND_NULL_FLAGS) {
      game[key] = { pending: true, data: [1, 2, 3] };
    }

    cleanupRoundStart(game);

    for (const key of ROUND_NULL_FLAGS) {
      assert.strictEqual(game[key], null,
        `${key} should be reset to null — was ${JSON.stringify(game[key])}`);
    }
  });

  it('002b: high-risk pending flags are in ROUND_NULL_FLAGS', () => {
    // Spot-check that the most dangerous pending flags are covered
    const criticalPendings = [
      'pendingRushPush',
      'pendingShoulderRush',
      'pendingDioFollow',
      'pendingExecutiveOrder',
      'pendingHunterProtocol',
      'pendingNegation',
      'pendingYHSIW',
      'pendingCoverFire',
      'pendingStillFaster',
      'pendingBombardmentSorin',
    ];
    for (const key of criticalPendings) {
      assert.ok(ROUND_NULL_FLAGS.includes(key),
        `${key} MUST be in ROUND_NULL_FLAGS — missing means stale pending can leak across rounds`);
    }
  });
});

// ── B-RNDLC-003: cleanupRoundStart resets ROUND_ARRAY_FLAGS to [] ─────────

describe('B-RNDLC-003: cleanupRoundStart resets all ROUND_ARRAY_FLAGS to []', () => {
  it('003: every ROUND_ARRAY_FLAG is [] after cleanup', () => {
    const game = {};
    for (const key of ROUND_ARRAY_FLAGS) {
      game[key] = ['stale-entry-1', 'stale-entry-2'];
    }

    cleanupRoundStart(game);

    for (const key of ROUND_ARRAY_FLAGS) {
      assert.deepStrictEqual(game[key], [],
        `${key} should be reset to [] — was ${JSON.stringify(game[key])}`);
    }
  });

  it('003b: crippledFigures is in ROUND_ARRAY_FLAGS', () => {
    assert.ok(ROUND_ARRAY_FLAGS.includes('crippledFigures'),
      'crippledFigures must reset each round');
    assert.ok(ROUND_ARRAY_FLAGS.includes('disabledFigures'),
      'disabledFigures must reset each round');
  });
});

// ── B-RNDLC-004: cleanupRoundStart resets ROUND_FALSE_FLAGS to false ──────

describe('B-RNDLC-004: cleanupRoundStart resets all ROUND_FALSE_FLAGS to false', () => {
  it('004: every ROUND_FALSE_FLAG is false after cleanup', () => {
    const game = {};
    for (const key of ROUND_FALSE_FLAGS) {
      game[key] = true;
    }

    cleanupRoundStart(game);

    for (const key of ROUND_FALSE_FLAGS) {
      assert.strictEqual(game[key], false,
        `${key} should be reset to false — was ${game[key]}`);
    }
  });
});

// ── B-RNDLC-005: cleanupRoundStart deletes ROUND_DELETE_FLAGS ─────────────

describe('B-RNDLC-005: cleanupRoundStart deletes all ROUND_DELETE_FLAGS', () => {
  it('005: every ROUND_DELETE_FLAG is absent after cleanup', () => {
    const game = {};
    for (const key of ROUND_DELETE_FLAGS) {
      game[key] = { staleData: true };
    }

    cleanupRoundStart(game);

    for (const key of ROUND_DELETE_FLAGS) {
      assert.strictEqual(game[key], undefined,
        `${key} should be deleted — was ${JSON.stringify(game[key])}`);
      assert.ok(!Object.hasOwn(game, key),
        `${key} should not be an own property after deletion`);
    }
  });

  it('005b: pendingStartOfRoundResolve is in ROUND_DELETE_FLAGS', () => {
    assert.ok(ROUND_DELETE_FLAGS.includes('pendingStartOfRoundResolve'),
      'pendingStartOfRoundResolve must be deleted at round boundary to prevent SOR stalls');
  });
});

// ── B-RNDLC-006: cleanupRoundStart preserves non-round state ──────────────

describe('B-RNDLC-006: cleanupRoundStart preserves non-round game state', () => {
  it('006: persistent fields survive cleanupRoundStart', () => {
    const game = {
      gameId: '42',
      player1Id: 'player1',
      player2Id: 'player2',
      currentRound: 3,
      initiativePlayerId: 'player2',
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      figureConditions: { 'Rebel Trooper-1-0': ['Stunned'] },
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Focus'] },
      selectedMap: { id: 'anchorhead-cantina-bar' },
      phase: 'round_active',
      roundPhase: 'start_of_round',
      p1DcList: [{ dcName: 'Rebel Trooper' }],
      p2DcList: [{ dcName: 'Stormtrooper' }],
      // Also seed some round flags that SHOULD be cleaned
      rushPending: { '3001': true },
      pendingRushPush: { msgId: '3001' },
      crippledFigures: ['Onar Koma'],
      pendingStartOfRoundResolve: 1,
    };

    cleanupRoundStart(game);

    // Persistent fields untouched
    assert.strictEqual(game.gameId, '42');
    assert.strictEqual(game.player1Id, 'player1');
    assert.strictEqual(game.player2Id, 'player2');
    assert.strictEqual(game.currentRound, 3);
    assert.strictEqual(game.initiativePlayerId, 'player2');
    assert.deepStrictEqual(game.figurePositions, { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} });
    assert.deepStrictEqual(game.figureConditions, { 'Rebel Trooper-1-0': ['Stunned'] });
    assert.deepStrictEqual(game.figurePowerTokens, { 'Rebel Trooper-1-0': ['Focus'] });
    assert.strictEqual(game.selectedMap.id, 'anchorhead-cantina-bar');
    assert.strictEqual(game.phase, 'round_active');
    assert.strictEqual(game.roundPhase, 'start_of_round');
    assert.deepStrictEqual(game.p1DcList, [{ dcName: 'Rebel Trooper' }]);
    assert.deepStrictEqual(game.p2DcList, [{ dcName: 'Stormtrooper' }]);

    // Round-scoped fields cleaned
    assert.deepStrictEqual(game.rushPending, {}, 'rushPending reset to {}');
    assert.strictEqual(game.pendingRushPush, null, 'pendingRushPush reset to null');
    assert.deepStrictEqual(game.crippledFigures, [], 'crippledFigures reset to []');
    assert.strictEqual(game.pendingStartOfRoundResolve, undefined, 'pendingStartOfRoundResolve deleted');
  });
});

// ── B-RNDLC-007: Stale pending flags from round N don't survive ───────────

describe('B-RNDLC-007: Stale pending flags from round N are gone after cleanupRoundStart', () => {
  it('007: dangerous combat/movement/reaction pendings are all cleared', () => {
    const game = {};
    // Seed a representative set of the most dangerous stale-pending scenarios
    const dangerousPendings = {
      // Combat pendings that would corrupt next round's combat
      pendingNegation: { playerNum: 1, cardName: 'Negation' },
      pendingCoverFire: { playerNum: 2 },
      pendingReaction: { type: 'dodge' },
      pendingDeflect: { playerNum: 1 },
      pendingHavocShot: { targets: ['a1'] },
      // Movement pendings that would cause phantom triggers
      pendingRushPush: { msgId: '3001', targets: ['Trooper-2-0'] },
      pendingShoulderRush: { msgId: '3001' },
      pendingDioFollow: { dioFigureKey: 'Dio-1-0' },
      pendingFalseOrders: { playerNum: 1 },
      // Interrupt pendings that would stall the game
      pendingExecutiveOrder: { playerNum: 1 },
      pendingHunterProtocol: { playerNum: 2 },
      pendingEmperorInterrupt: { playerNum: 1 },
      // Round-scoped activation state that would leak
      pendingStillFaster: { msgId: '3001' },
      pendingBombardmentSorin: { playerNum: 1 },
    };

    Object.assign(game, dangerousPendings);

    cleanupRoundStart(game);

    for (const key of Object.keys(dangerousPendings)) {
      assert.strictEqual(game[key], null,
        `${key} must be null after cleanup — stale pending would corrupt next round`);
    }
  });

  it('007b: round-scoped object flags with activation state are reset', () => {
    const game = {
      // These object flags track per-activation state within a round
      figureMoved: { 'Rebel Trooper-1-0': true, 'Onar Koma-1-0': true },
      tripodAttacked: { 'Stormtrooper-2-0': true },
      overrunThisActivation: { '3001': true },
      rushPending: { '3001': true },
      shoulderRushPending: { '3001': true },
      roundFigureAbilityUsed: { 'deference_protocol_KX-1-0': true },
      moveInProgress: { '3001_0': { figureKey: 'Rebel Trooper-1-0' } },
      deflectionPending: { '4001': true },
      pendingOverrideAttackDice: { '3001': { dice: ['red', 'yellow'] } },
    };

    cleanupRoundStart(game);

    assert.deepStrictEqual(game.figureMoved, {});
    assert.deepStrictEqual(game.tripodAttacked, {});
    assert.deepStrictEqual(game.overrunThisActivation, {});
    assert.deepStrictEqual(game.rushPending, {});
    assert.deepStrictEqual(game.shoulderRushPending, {});
    assert.deepStrictEqual(game.roundFigureAbilityUsed, {});
    assert.deepStrictEqual(game.moveInProgress, {});
    assert.deepStrictEqual(game.deflectionPending, {});
    assert.deepStrictEqual(game.pendingOverrideAttackDice, {});
  });
});

// ── B-RNDLC-008: handleEndEndOfRound guards ──────────────────────────────

describe('B-RNDLC-008: handleEndEndOfRound entry guards', () => {
  it('008a: rejects when not in End of Round window (endOfRoundWhoseTurn absent)', async () => {
    const game = makeGame(); // no endOfRoundWhoseTurn
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_end_of_round_42', 'player1');
    await handleEndEndOfRound(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Not in End of Round'));
    assert.ok(msg, 'ephemeral "Not in End of Round" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });

  it('008b: rejects when wrong player presses End of Round', async () => {
    const game = makeGame({
      endOfRoundWhoseTurn: 'player1',  // player1's turn
    });
    const { ctx, calls } = buildRoundCtx(game);
    // player2 tries to press
    const interaction = mockInteraction('end_end_of_round_42', 'player2');
    await handleEndEndOfRound(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('not your turn'));
    assert.ok(msg, 'ephemeral wrong-player rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-RNDLC-009: handleEndEndOfRound initiative → opponent toggle ─────────

describe('B-RNDLC-009: handleEndEndOfRound toggles from initiative to opponent', () => {
  it('009: initiative player presses → endOfRoundWhoseTurn flips to opponent', async () => {
    const game = makeGame({
      endOfRoundWhoseTurn: 'player1',
      initiativePlayerId: 'player1',
    });
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_end_of_round_42', 'player1');
    await handleEndEndOfRound(interaction, ctx);

    assert.strictEqual(game.endOfRoundWhoseTurn, 'player2',
      'endOfRoundWhoseTurn flipped from initiative (player1) to opponent (player2)');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
    assert.ok(calls.logGameAction.length > 0, 'logGameAction called');
  });

  it('009b: opponent (non-initiative) presses → endOfRoundWhoseTurn cleared, suffix runs', async () => {
    // Per alexanbv 2026-06-13: when the NON-initiative player passes the EoR
    // window it no longer fires a post_end_of_round phase gate. Instead it runs
    // the suffix (_runDcEorAndContinue) inline — DC EoR effects, then the round
    // tail (_runInitiativeSwapAndContinue): initiative swap + currentRound++ +
    // cleanupRoundStart + the new round's pre_activation gate.
    const game = makeGame({
      endOfRoundWhoseTurn: 'player2',
      initiativePlayerId: 'player1', // player2 is NOT initiative
      currentRound: 1,
      selectedMap: { id: 'test-map' },
    });
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_end_of_round_42', 'player2');
    await handleEndEndOfRound(interaction, ctx);

    assert.strictEqual(game.endOfRoundWhoseTurn, null,
      'endOfRoundWhoseTurn cleared — both players done');
    // Suffix ran: initiative swapped + round incremented.
    assert.strictEqual(game.initiativePlayerId, 'player2',
      'initiative swapped to opponent (suffix ran)');
    assert.strictEqual(game.currentRound, 2,
      'currentRound incremented (suffix ran)');
    // The new round opens its SoR window (not pre_activation directly) —
    // SoR is never skipped; pre_activation fires only after both SoR Done clicks.
    assert.ok(!calls.sendPhaseGateMessages.includes('post_end_of_round'),
      'post_end_of_round gate no longer fired');
    assert.ok(!calls.sendPhaseGateMessages.includes('pre_activation'),
      'pre_activation gate does NOT fire immediately — SoR Done must come first');
    assert.ok(calls.logGameAction.length > 0, 'logGameAction called for SoR Done button');
    assert.strictEqual(game.startOfRoundWhoseTurn, game.initiativePlayerId,
      'startOfRoundWhoseTurn set to new initiative player — awaiting SoR Done');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-RNDLC-010: handleEndStartOfRound guards ────────────────────────────

describe('B-RNDLC-010: handleEndStartOfRound entry guards', () => {
  it('010a: rejects when not in Start of Round window', async () => {
    const game = makeGame(); // no startOfRoundWhoseTurn
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_start_of_round_42', 'player1');
    await handleEndStartOfRound(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Not in Start of Round'));
    assert.ok(msg, 'ephemeral "Not in Start of Round" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });

  it('010b: rejects when wrong player presses Start of Round', async () => {
    const game = makeGame({
      startOfRoundWhoseTurn: 'player1',
    });
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_start_of_round_42', 'player2');
    await handleEndStartOfRound(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('not your turn'));
    assert.ok(msg, 'ephemeral wrong-player rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-RNDLC-011: handleEndStartOfRound initiative → opponent toggle ───────

describe('B-RNDLC-011: handleEndStartOfRound toggles initiative to opponent', () => {
  it('011: initiative player presses → startOfRoundWhoseTurn flips to opponent', async () => {
    const game = makeGame({
      startOfRoundWhoseTurn: 'player1',
      initiativePlayerId: 'player1',
    });
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_start_of_round_42', 'player1');
    await handleEndStartOfRound(interaction, ctx);

    assert.strictEqual(game.startOfRoundWhoseTurn, 'player2',
      'startOfRoundWhoseTurn flipped to opponent');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
    assert.ok(calls.logGameAction.length > 0, 'logGameAction called');
  });
});

// ── B-RNDLC-012: handleEndStartOfRound sets activation turn ──────────────

describe('B-RNDLC-012: handleEndStartOfRound sets currentActivationTurnPlayerId', () => {
  it('012: opponent (non-initiative) confirms → currentActivationTurnPlayerId = initiative', async () => {
    const game = makeGame({
      startOfRoundWhoseTurn: 'player2', // opponent's turn (last to confirm)
      initiativePlayerId: 'player1',
      p1DcList: [{ dcName: 'Rebel Trooper (Regular)' }],
      p1DcMessageIds: ['3001'],
      p2DcList: [{ dcName: 'Stormtrooper (Regular)' }],
      p2DcMessageIds: ['4001'],
    });
    const { ctx, calls } = buildRoundCtx(game);
    const interaction = mockInteraction('end_start_of_round_42', 'player2');
    await handleEndStartOfRound(interaction, ctx);

    assert.strictEqual(game.startOfRoundWhoseTurn, null,
      'startOfRoundWhoseTurn cleared — both done');

    // Phase gate or direct activation entry — either way, should save
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-RNDLC-013: setRoundPhase validates transitions ─────────────────────

describe('B-RNDLC-013: setRoundPhase validates round sub-phase transitions', () => {
  it('013a: valid transition START_OF_ROUND → ACTIVATION succeeds', () => {
    const game = { roundPhase: ROUND_PHASES.START_OF_ROUND };
    setRoundPhase(game, ROUND_PHASES.ACTIVATION);
    assert.strictEqual(game.roundPhase, ROUND_PHASES.ACTIVATION);
  });

  it('013b: valid transition ACTIVATION → END_OF_ROUND succeeds', () => {
    const game = { roundPhase: ROUND_PHASES.ACTIVATION };
    setRoundPhase(game, ROUND_PHASES.END_OF_ROUND);
    assert.strictEqual(game.roundPhase, ROUND_PHASES.END_OF_ROUND);
  });

  it('013c: valid transition END_OF_ROUND → START_OF_ROUND succeeds', () => {
    const game = { roundPhase: ROUND_PHASES.END_OF_ROUND };
    setRoundPhase(game, ROUND_PHASES.START_OF_ROUND);
    assert.strictEqual(game.roundPhase, ROUND_PHASES.START_OF_ROUND);
  });

  it('013d: invalid transition START_OF_ROUND → END_OF_ROUND warns (non-strict)', () => {
    const game = { roundPhase: ROUND_PHASES.START_OF_ROUND };
    // Should not throw in non-strict mode
    setRoundPhase(game, ROUND_PHASES.END_OF_ROUND);
    // Phase is set despite warning (defensive — production doesn't crash)
    assert.strictEqual(game.roundPhase, ROUND_PHASES.END_OF_ROUND);
  });

  it('013e: invalid transition throws in strict mode', () => {
    const game = { roundPhase: ROUND_PHASES.START_OF_ROUND };
    assert.throws(
      () => setRoundPhase(game, ROUND_PHASES.END_OF_ROUND, { strict: true }),
      { message: /Invalid round phase transition/ },
      'strict mode throws on invalid transition',
    );
  });
});

// ── B-RNDLC-014: Full round boundary invariant ───────────────────────────

describe('B-RNDLC-014: Full round boundary invariant — initiative swap + cleanup', () => {
  it('014: simulated round boundary correctly advances state', () => {
    const game = makeGame({
      currentRound: 2,
      initiativePlayerId: 'player1',
      roundPhase: ROUND_PHASES.END_OF_ROUND,
      // Seed stale round state that should be cleaned
      figureMoved: { 'Rebel Trooper-1-0': true },
      pendingRushPush: { msgId: '3001', targets: ['Stormtrooper-2-0'] },
      crippledFigures: ['Onar Koma'],
      noCommandDrawThisRound: true,
      pendingStartOfRoundResolve: 2,
      // Persistent state that should survive
      figureConditions: { 'Rebel Trooper-1-0': ['Stunned'] },
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Focus'] },
    });

    // Simulate what _runInitiativeSwapAndContinue does (lines 834-838):
    const prevInitiative = game.initiativePlayerId;
    game.initiativePlayerId = prevInitiative === game.player1Id ? game.player2Id : game.player1Id;
    game.currentRound = (game.currentRound || 1) + 1;
    setRoundPhase(game, ROUND_PHASES.START_OF_ROUND);
    game.startOfRoundWhoseTurn = game.initiativePlayerId;
    cleanupRoundStart(game);

    // Round advanced
    assert.strictEqual(game.currentRound, 3, 'currentRound incremented from 2 to 3');

    // Initiative swapped
    assert.strictEqual(game.initiativePlayerId, 'player2',
      'initiativePlayerId swapped from player1 to player2');

    // Round phase set
    assert.strictEqual(game.roundPhase, ROUND_PHASES.START_OF_ROUND,
      'roundPhase set to START_OF_ROUND');

    // SOR turn set to new initiative player
    assert.strictEqual(game.startOfRoundWhoseTurn, 'player2',
      'startOfRoundWhoseTurn = new initiative player');

    // Round-scoped state cleaned
    assert.deepStrictEqual(game.figureMoved, {}, 'figureMoved reset');
    assert.strictEqual(game.pendingRushPush, null, 'pendingRushPush reset');
    assert.deepStrictEqual(game.crippledFigures, [], 'crippledFigures reset');
    assert.strictEqual(game.noCommandDrawThisRound, false, 'noCommandDrawThisRound reset');
    assert.strictEqual(game.pendingStartOfRoundResolve, undefined, 'pendingStartOfRoundResolve deleted');

    // Persistent state survived
    assert.deepStrictEqual(game.figureConditions, { 'Rebel Trooper-1-0': ['Stunned'] },
      'figureConditions preserved (Stunned requires action to remove, not round reset)');
    assert.deepStrictEqual(game.figurePowerTokens, { 'Rebel Trooper-1-0': ['Focus'] },
      'figurePowerTokens preserved');
    assert.strictEqual(game.gameId, '42', 'gameId preserved');
    assert.strictEqual(game.player1Id, 'player1', 'player1Id preserved');
    assert.strictEqual(game.player2Id, 'player2', 'player2Id preserved');
  });
});
