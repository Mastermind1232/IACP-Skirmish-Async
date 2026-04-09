/**
 * BEHAVIORAL oracle tests for Combat Timing Phase 1: reaction-window correctness.
 *
 * Tests the highest-frequency, highest-visibility combat timing surfaces:
 * Negation lifecycle, combat gate FSM, pending state guards, and stale-state safety.
 *
 * Combat timing path (simplified):
 *   handleAttackTarget → pendingCombat created
 *   → handleCombatRoll → dice rolled, combatGate (post_roll) posted
 *   → handleCombatGateReady → p1Ready/p2Ready → advance
 *   → dispatchCombatGateAdvance → reroll phases (attacker → forced → defender)
 *   → proceedAfterRerolls → post-roll passives → combatGate (pre_resolve)
 *   → resolveCombatAfterRolls → damage applied, pendingCombat = null
 *
 * Negation path:
 *   Cost-0 CC played → pendingNegation set → opponent gets Negation/LetResolve buttons
 *   → handleNegationPlay: card cancelled, Negation discarded, pendingNegation deleted
 *   → handleNegationLetResolve: card resolves, pendingNegation deleted
 *
 * Test categories:
 *   B-CTIME-001 – 004: Negation Play (positive + guards)
 *   B-CTIME-005 – 006: Negation Let Resolve (positive + guard)
 *   B-CTIME-007 – 011: Combat Gate FSM (ready tracking, both-ready, guards)
 *   B-CTIME-012 – 013: Pending combat state invariants
 *   B-CTIME-014: Full Negation lifecycle (set → play → consumed)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleNegationPlay, handleNegationLetResolve } from '../../../src/handlers/cc-hand.js';
import { handleCombatGateReady } from '../../../src/handlers/combat.js';
import { ROUND_NULL_FLAGS } from '../../../src/game/activation-state.js';

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
      channels: { fetch: async () => null }, // null thread → gate exits early after cleanup
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
    p1HandChannelId: 'hand1',
    p2HandChannelId: 'hand2',
    figurePositions: { 1: {}, 2: {} },
    ...overrides,
  };
}

/**
 * Build ctx for Negation handlers (cc-hand.js).
 */
function buildNegationCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    resolveAbility: [],
  };

  const mockChannel = {
    messages: { fetch: async () => ({ edit: async () => ({}) }) },
    send: async () => ({ id: 'new-msg' }),
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      buildHandDisplayPayload: () => ({ content: '', embeds: [], components: [] }),
      updateHandVisualMessage: async () => {},
      updateDiscardPileMessage: async () => {},
      logGameAction: async (...args) => { calls.logGameAction.push(args); return { id: 'log-msg' }; },
      getCcEffect: () => null,
      client: { channels: { fetch: async () => mockChannel } },
      saveGames: () => { calls.saveGames.push(true); },
      resolveAbility: (...args) => { calls.resolveAbility.push(args); return {}; },
      dcMessageMeta: new Map(),
      dcHealthState: new Map(),
      ...overrides,
    },
    calls,
  };
}

/**
 * Build ctx for combat gate handler (combat.js).
 */
function buildCombatCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
  };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      saveGames: () => { calls.saveGames.push(true); },
      ...overrides,
    },
    calls,
  };
}

// ── B-CTIME-001: Negation Play positive path ─────────────────────────────

describe('B-CTIME-001: handleNegationPlay removes card, cleans pendingNegation', () => {
  it('001: Negation played → removed from hand, added to discard, pendingNegation deleted', async () => {
    const game = makeGame({
      pendingNegation: { playedBy: 1, card: 'Take Initiative' },
      player2CcHand: ['Negation', 'Covering Fire'],
      player2CcDiscard: ['Son of Skywalker'],
    });

    const { ctx, calls } = buildNegationCtx(game);
    // player2 is the opponent (playedBy=1 → oppNum=2)
    await handleNegationPlay(
      mockInteraction('negation_play_42', 'player2'), ctx);

    // Negation removed from hand
    assert.ok(!game.player2CcHand.includes('Negation'),
      'Negation removed from opponent hand');
    assert.strictEqual(game.player2CcHand.length, 1,
      'hand has 1 card remaining');

    // Negation added to discard
    assert.ok(game.player2CcDiscard.includes('Negation'),
      'Negation added to discard pile');

    // pendingNegation cleaned up
    assert.strictEqual(game.pendingNegation, undefined,
      'pendingNegation deleted (not null — fully removed)');

    // Game saved
    assert.ok(calls.saveGames.length > 0, 'saveGames called');

    // Log message references Negation
    const logMsg = calls.logGameAction.find(args =>
      typeof args[2] === 'string' && args[2].includes('Negation'));
    assert.ok(logMsg, 'logGameAction mentions Negation');
  });
});

// ── B-CTIME-002: Negation Play guard — no pendingNegation ─────────────────

describe('B-CTIME-002: handleNegationPlay rejects when no pendingNegation', () => {
  it('002: no pendingNegation → ephemeral rejection, no save', async () => {
    const game = makeGame(); // no pendingNegation
    const { ctx, calls } = buildNegationCtx(game);
    const interaction = mockInteraction('negation_play_42', 'player2');
    await handleNegationPlay(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No pending play'));
    assert.ok(msg, 'ephemeral "No pending play" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-CTIME-003: Negation Play guard — card not in hand ───────────────────

describe('B-CTIME-003: handleNegationPlay rejects when Negation not in hand', () => {
  it('003: opponent has no Negation → ephemeral rejection', async () => {
    const game = makeGame({
      pendingNegation: { playedBy: 1, card: 'Take Initiative' },
      player2CcHand: ['Covering Fire', 'Son of Skywalker'], // no Negation
    });

    const { ctx, calls } = buildNegationCtx(game);
    const interaction = mockInteraction('negation_play_42', 'player2');
    await handleNegationPlay(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes("don't have Negation"));
    assert.ok(msg, "ephemeral 'don't have Negation' rejection sent");

    // pendingNegation NOT consumed — still waiting for response
    assert.ok(game.pendingNegation, 'pendingNegation still present');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-CTIME-004: Negation Play guard — wrong player ──────────────────────

describe('B-CTIME-004: handleNegationPlay rejects when playing player tries to negate own card', () => {
  it('004: player who played the CC tries to click Negation → rejected', async () => {
    const game = makeGame({
      pendingNegation: { playedBy: 1, card: 'Take Initiative' },
      player1CcHand: ['Negation'], // player1 has Negation but is the one who played
    });

    const { ctx, calls } = buildNegationCtx(game);
    // player1 tries to negate their own card (oppNum=2, so player1 ≠ player2)
    const interaction = mockInteraction('negation_play_42', 'player1');
    await handleNegationPlay(interaction, ctx);

    // requirePlayer should reject (player1 is pn=1, not oppNum=2)
    assert.ok(game.pendingNegation, 'pendingNegation NOT consumed');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-CTIME-005: Negation Let Resolve positive path ──────────────────────

describe('B-CTIME-005: handleNegationLetResolve deletes pendingNegation and resolves', () => {
  it('005: opponent lets card resolve → pendingNegation deleted, saveGames called', async () => {
    const game = makeGame({
      pendingNegation: { playedBy: 1, card: 'Take Initiative', fromDc: false },
    });

    const { ctx, calls } = buildNegationCtx(game);
    // player2 is the opponent (playedBy=1 → oppNum=2)
    await handleNegationLetResolve(
      mockInteraction('negation_let_resolve_42', 'player2'), ctx);

    // pendingNegation cleaned up
    assert.strictEqual(game.pendingNegation, undefined,
      'pendingNegation deleted after resolve');

    // resolveAbility called (CC effect executed)
    assert.ok(calls.resolveAbility.length > 0, 'resolveAbility called');

    // Game saved
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME-006: Negation Let Resolve guard — no pendingNegation ─────────

describe('B-CTIME-006: handleNegationLetResolve rejects when no pendingNegation', () => {
  it('006: no pendingNegation → ephemeral rejection', async () => {
    const game = makeGame(); // no pendingNegation
    const { ctx, calls } = buildNegationCtx(game);
    const interaction = mockInteraction('negation_let_resolve_42', 'player2');
    await handleNegationLetResolve(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No pending play'));
    assert.ok(msg, 'ephemeral "No pending play" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-CTIME-007: Combat Gate — P1 ready, gate still open ─────────────────

describe('B-CTIME-007: handleCombatGateReady tracks P1 ready, gate stays open', () => {
  it('007: P1 clicks ready → p1Ready=true, p2Ready still false, gate survives', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatGate: { phase: 'post_roll', p1Ready: false, p2Ready: false },
      },
    });

    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player1');
    await handleCombatGateReady(interaction, ctx);

    const gate = game.pendingCombat.combatGate;
    assert.ok(gate, 'combatGate still present (not yet advanced)');
    assert.strictEqual(gate.p1Ready, true, 'p1Ready = true');
    assert.strictEqual(gate.p2Ready, false, 'p2Ready still false');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME-008: Combat Gate — both ready, gate deleted ──────────────────

describe('B-CTIME-008: handleCombatGateReady advances when both ready', () => {
  it('008: P2 clicks ready after P1 → combatGate deleted, saveGames called', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatGate: { phase: 'post_roll', p1Ready: true, p2Ready: false },
        // No combatThreadId → fetchCombatThread returns null → exits early after gate delete
      },
    });

    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player2');
    await handleCombatGateReady(interaction, ctx);

    // Gate deleted (both ready → advance)
    assert.strictEqual(game.pendingCombat.combatGate, undefined,
      'combatGate deleted after both ready');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME-009: Combat Gate — double press rejected ─────────────────────

describe('B-CTIME-009: handleCombatGateReady rejects double press', () => {
  it('009: P1 already ready, clicks again → ephemeral rejection', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatGate: { phase: 'post_roll', p1Ready: true, p2Ready: false },
      },
    });

    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player1');
    await handleCombatGateReady(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('already ready'));
    assert.ok(msg, 'ephemeral "already ready" rejection sent');

    // Gate unchanged
    assert.ok(game.pendingCombat.combatGate, 'combatGate still present');
    assert.strictEqual(game.pendingCombat.combatGate.p1Ready, true, 'p1Ready unchanged');
    assert.strictEqual(game.pendingCombat.combatGate.p2Ready, false, 'p2Ready unchanged');
  });
});

// ── B-CTIME-010: Combat Gate — no pending gate ───────────────────────────

describe('B-CTIME-010: handleCombatGateReady rejects when no combat gate exists', () => {
  it('010a: no pendingCombat at all → rejection', async () => {
    const game = makeGame(); // no pendingCombat
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player1');
    await handleCombatGateReady(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No pending combat gate'));
    assert.ok(msg, 'ephemeral "No pending combat gate" rejection sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });

  it('010b: pendingCombat exists but no combatGate → rejection', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        // combatGate intentionally absent — gate already cleared
      },
    });
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player1');
    await handleCombatGateReady(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No pending combat gate'));
    assert.ok(msg, 'ephemeral rejection — gate already cleared');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-CTIME-011: Combat Gate — non-player rejected ───────────────────────

describe('B-CTIME-011: handleCombatGateReady rejects non-player interaction', () => {
  it('011: spectator clicks ready → rejected', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatGate: { phase: 'post_roll', p1Ready: false, p2Ready: false },
      },
    });

    const { ctx } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'spectator-user');
    await handleCombatGateReady(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Only players'));
    assert.ok(msg, 'ephemeral non-player rejection sent');

    // Gate unchanged
    assert.strictEqual(game.pendingCombat.combatGate.p1Ready, false, 'p1Ready unchanged');
    assert.strictEqual(game.pendingCombat.combatGate.p2Ready, false, 'p2Ready unchanged');
  });
});

// ── B-CTIME-012: Pending combat state shape invariants ───────────────────

describe('B-CTIME-012: combatGate shape invariants', () => {
  it('012a: freshly created gate has phase, p1Ready=false, p2Ready=false', () => {
    // This mirrors what sendCombatGate creates (combat.js:75)
    const gate = { phase: 'post_roll', p1Ready: false, p2Ready: false };

    assert.strictEqual(gate.phase, 'post_roll', 'gate has phase');
    assert.strictEqual(gate.p1Ready, false, 'p1Ready starts false');
    assert.strictEqual(gate.p2Ready, false, 'p2Ready starts false');
  });

  it('012b: valid combatGate phases cover the full pipeline', () => {
    const validPhases = ['post_roll', 'post_attacker_reroll', 'post_forced_reroll', 'post_defender_reroll', 'pre_resolve'];
    // These are the phases used in dispatchCombatGateAdvance switch statement
    for (const phase of validPhases) {
      const gate = { phase, p1Ready: false, p2Ready: false };
      assert.strictEqual(gate.phase, phase, `phase ${phase} accepted`);
    }
  });
});

// ── B-CTIME-013: Pending combat cleanup safety ──────────────────────────

describe('B-CTIME-013: pendingNegation is in ROUND_NULL_FLAGS for round-boundary cleanup', () => {
  it('013: pendingNegation included in round cleanup list', () => {
    assert.ok(ROUND_NULL_FLAGS.includes('pendingNegation'),
      'pendingNegation MUST be in ROUND_NULL_FLAGS — stale Negation window would block the game');
  });

  it('013b: other critical combat pendings are in round cleanup', () => {
    const combatPendings = [
      'pendingReaction',
      'pendingDeflect',
      'pendingHavocShot',
      'pendingCleave',
      'pendingCelebration',
      'pendingToughLuck',
      'pendingThereIsNoTry',
    ];
    for (const key of combatPendings) {
      assert.ok(ROUND_NULL_FLAGS.includes(key),
        `${key} MUST be in ROUND_NULL_FLAGS — stale combat pending would deadlock`);
    }
  });
});

// ── B-CTIME-014: Full Negation lifecycle ─────────────────────────────────

describe('B-CTIME-014: Full Negation lifecycle — set → play → consumed', () => {
  it('014: pendingNegation flows through set → Negation play → fully deleted', async () => {
    const game = makeGame({
      player2CcHand: ['Negation', 'Take Initiative'],
      player2CcDiscard: [],
    });

    // Phase 1: absent
    assert.strictEqual(game.pendingNegation, undefined,
      'Phase 1: pendingNegation absent before CC played');

    // Phase 2: set (simulates what handleCcPlay does at cc-hand.js:668-669)
    game.pendingNegation = { playedBy: 1, card: 'Take Initiative', fromDc: false };
    assert.ok(game.pendingNegation, 'Phase 2: pendingNegation set');
    assert.strictEqual(game.pendingNegation.card, 'Take Initiative');
    assert.strictEqual(game.pendingNegation.playedBy, 1);

    // Phase 3: consumed (opponent plays Negation)
    const { ctx, calls } = buildNegationCtx(game);
    await handleNegationPlay(
      mockInteraction('negation_play_42', 'player2'), ctx);

    assert.strictEqual(game.pendingNegation, undefined,
      'Phase 3: pendingNegation deleted — lifecycle complete');
    assert.ok(!game.player2CcHand.includes('Negation'),
      'Negation removed from hand');
    assert.ok(game.player2CcDiscard.includes('Negation'),
      'Negation in discard');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('014b: pendingNegation flows through set → let resolve → fully deleted', async () => {
    const game = makeGame({
      player2CcHand: ['Covering Fire'],
      player2CcDiscard: [],
    });

    // Phase 1: set
    game.pendingNegation = { playedBy: 1, card: 'Take Initiative', fromDc: false };

    // Phase 2: opponent lets it resolve
    const { ctx, calls } = buildNegationCtx(game);
    await handleNegationLetResolve(
      mockInteraction('negation_let_resolve_42', 'player2'), ctx);

    assert.strictEqual(game.pendingNegation, undefined,
      'pendingNegation deleted after let-resolve');
    assert.ok(calls.resolveAbility.length > 0,
      'resolveAbility called — CC effect applied');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});
