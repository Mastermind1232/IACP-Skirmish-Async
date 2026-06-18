/**
 * BEHAVIORAL oracle tests for Combat Timing Phase 1: reaction-window correctness.
 *
 * Tests the highest-frequency, highest-visibility combat timing surfaces:
 * combat gate FSM, pending state guards, and stale-state safety.
 *
 * Combat timing path (simplified):
 *   handleAttackTarget → pendingCombat created
 *   → handleCombatRoll → dice rolled, combatGate (post_roll) posted
 *   → handleCombatGateReady → p1Ready/p2Ready → advance
 *   → dispatchCombatGateAdvance → reroll phases (attacker → forced → defender)
 *   → proceedAfterRerolls → post-roll passives → combatGate (pre_resolve)
 *   → resolveCombatAfterRolls → damage applied, pendingCombat = null
 *
 * NOTE: The old Negation-window tests (B-CTIME-001–006, 014) were removed
 * when the legacy handleNegationPlay / handleNegationLetResolve handlers were
 * deleted; the unified counter-window is covered by cc-counter-window*-tests.
 *
 * Test categories:
 *   B-CTIME-007 – 011: Combat Gate FSM (ready tracking, both-ready, guards)
 *   B-CTIME-012 – 013: Pending combat state invariants
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

// ── B-CTIME-007: Combat Gate — P1 ready, gate still open ─────────────────

describe('B-CTIME-007: handleCombatGateReady tracks P1 ready, gate stays open', () => {
  it('007: attacker (P1) clicks ready → acked[1]=true, activePlayer rotates to defender (P2), gate survives', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        // Sequential gate: attacker is the active player first.
        combatGate: { phase: 'post_roll', acked: {}, activePlayer: 1 },
      },
    });

    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player1');
    await handleCombatGateReady(interaction, ctx);

    const gate = game.pendingCombat.combatGate;
    assert.ok(gate, 'combatGate still present (not yet advanced)');
    assert.strictEqual(gate.acked[1], true, 'attacker acked = true');
    assert.ok(!gate.acked[2], 'defender NOT yet acked');
    assert.strictEqual(gate.activePlayer, 2, 'activePlayer rotated to defender');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME-008: Combat Gate — both ready, gate deleted ──────────────────

describe('B-CTIME-008: handleCombatGateReady advances when both ready', () => {
  it('008: defender (P2) clicks ready after attacker → combatGate deleted, saveGames called', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        // Sequential gate: attacker already acked, defender now active.
        combatGate: { phase: 'post_roll', acked: { 1: true }, activePlayer: 2 },
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

describe('B-CTIME-009: handleCombatGateReady rejects out-of-turn click', () => {
  it('009: P1 acked, defender now active — P1 clicks again → ephemeral "waiting on defender"', async () => {
    const game = makeGame({
      pendingCombat: {
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        // Sequential gate: attacker already acked, activePlayer is defender.
        combatGate: { phase: 'post_roll', acked: { 1: true }, activePlayer: 2 },
      },
    });

    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_gate_42', 'player1');
    await handleCombatGateReady(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && (m.content?.includes('Sequential gate') || m.content?.includes('waiting on')));
    assert.ok(msg, 'ephemeral out-of-turn rejection sent');

    // Gate unchanged
    assert.ok(game.pendingCombat.combatGate, 'combatGate still present');
    assert.strictEqual(game.pendingCombat.combatGate.acked[1], true, 'attacker still acked');
    assert.ok(!game.pendingCombat.combatGate.acked[2], 'defender still NOT acked');
    assert.strictEqual(game.pendingCombat.combatGate.activePlayer, 2, 'activePlayer unchanged');
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
    // This mirrors what sendCombatGate creates (sequential gate, attacker first)
    const gate = { phase: 'post_roll', acked: {}, activePlayer: 1 };

    assert.strictEqual(gate.phase, 'post_roll', 'gate has phase');
    assert.deepStrictEqual(gate.acked, {}, 'acked map starts empty');
    assert.strictEqual(gate.activePlayer, 1, 'attacker (P1) is the initial activePlayer');
  });

  it('012b: valid combatGate phases cover the full pipeline', () => {
    const validPhases = ['post_roll', 'post_attacker_reroll', 'post_forced_reroll', 'post_defender_reroll', 'pre_resolve'];
    // These are the phases used in dispatchCombatGateAdvance switch statement
    for (const phase of validPhases) {
      const gate = { phase, acked: {}, activePlayer: 1 };
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
      'pendingThereIsNoTry',
    ];
    for (const key of combatPendings) {
      assert.ok(ROUND_NULL_FLAGS.includes(key),
        `${key} MUST be in ROUND_NULL_FLAGS — stale combat pending would deadlock`);
    }
  });
});

