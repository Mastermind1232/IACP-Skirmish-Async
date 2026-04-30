/**
 * BEHAVIORAL oracle tests for Combat Timing Phase 2: rerolls, surge, token-spend.
 *
 * Tests the highest-frequency remaining combat timing surfaces:
 * reroll phase sequencing, surge spending completion, and power token spending gates.
 *
 * Focus: wrong-order / stale-state / missed-window / duplicate-window bugs.
 *
 * Combat reroll path (simplified):
 *   handleCombatReroll guard checks → rerollPhase match → player permission
 *   → voluntary reroll: decrement attackerRerollsRemaining, mark attackerRerolledIndices
 *   → "done" or exhausted → sendCombatGate('post_attacker_reroll')
 *
 * Surge path:
 *   handleCombatSurge guard checks → surgeRemaining > 0 → player permission
 *   → "done" → surgeRemaining = 0, sendReadyToResolveRolls → combatGate('pre_resolve')
 *
 * Token path:
 *   handleCombatToken → tokenPhase must match role → player permission
 *   → skip → advanceTokenPhase; spend → applyTokenBonus + removeSpentToken + advance
 *
 * Test categories:
 *   B-CTIME2-001: handleCombatReroll guard — no combat/rerollPhase → reject
 *   B-CTIME2-002: handleCombatReroll guard — wrong phase (defender during attacker) → reject
 *   B-CTIME2-003: handleCombatReroll guard — wrong player → reject
 *   B-CTIME2-004: handleCombatReroll integration — attacker rerolls die → state updated, UI re-sent
 *   B-CTIME2-005: handleCombatReroll — attacker "done" → combatGate('post_attacker_reroll')
 *   B-CTIME2-006: handleCombatSurge guard — no surgeRemaining → reject
 *   B-CTIME2-007: handleCombatSurge guard — wrong player → reject
 *   B-CTIME2-008: handleCombatSurge — "done" → surgeRemaining=0, combatGate('pre_resolve')
 *   B-CTIME2-009: handleCombatToken guard — wrong tokenPhase → silent return
 *   B-CTIME2-010: handleCombatToken guard — wrong player → reject
 *   B-CTIME2-011: Phase sequencing invariant — reroll → gate → surge → gate → token
 *   B-CTIME2-012: Reroll exhaustion — rerollsRemaining=0 after last reroll → auto-gate
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleCombatReroll, handleCombatSurge, handleCombatToken, sendCombatGate } from '../../../src/handlers/combat.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1', opts = {}) {
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
    client: opts.client || {
      channels: { fetch: async () => null },
    },
    _followUpCalls: followUpCalls,
  };
}

/** Client whose channels.fetch returns a mock thread with send(). */
function mockClientWithThread() {
  return {
    channels: {
      fetch: async () => ({
        send: async () => ({ id: 'thread-msg' }),
      }),
    },
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    player1Id: 'player1',
    player2Id: 'player2',
    generalId: 'general-ch',
    figurePositions: { 1: {}, 2: {} },
    figurePowerTokens: {},
    ...overrides,
  };
}

function makeCombat(overrides = {}) {
  return {
    gameId: '42',
    combatThreadId: 'thread-1',
    attackerPlayerNum: 1,
    attackerFigureKey: 'Rebel Trooper-1-0',
    attackerDcName: 'Rebel Trooper',
    attackerDisplayName: 'Rebel Trooper',
    target: { figureKey: 'Stormtrooper-2-0' },
    attackDiceResults: [
      { color: 'blue', acc: 2, dmg: 1, surge: 1 },
      { color: 'green', acc: 0, dmg: 1, surge: 1 },
    ],
    defenseDiceResults: [
      { color: 'white', block: 1, evade: 0, dodge: false },
    ],
    attackRoll: { acc: 2, dmg: 2, surge: 2 },
    defenseRoll: { block: 1, evade: 0, dodge: false },
    ...overrides,
  };
}

/**
 * Build ctx for combat handlers.
 * Provides the minimum dependencies each handler destructures.
 */
function buildCombatCtx(game, overrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    rollSingleAttackDie: [],
    recalcAttackTotals: [],
    resolveCombatAfterRolls: [],
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      saveGames: () => { calls.saveGames.push(true); },
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      // Reroll dependencies
      rollSingleAttackDie: (color) => {
        const result = { color, acc: 1, dmg: 2, surge: 0 };
        calls.rollSingleAttackDie.push(result);
        return result;
      },
      rollSingleDefenseDie: (color) => ({ color, block: 1, evade: 1, dodge: false }),
      recalcAttackTotals: (dice) => {
        const totals = dice.reduce((t, d) => ({
          acc: (t.acc || 0) + (d.acc || 0),
          dmg: (t.dmg || 0) + (d.dmg || 0),
          surge: (t.surge || 0) + (d.surge || 0),
        }), { acc: 0, dmg: 0, surge: 0 });
        calls.recalcAttackTotals.push(totals);
        return totals;
      },
      recalcDefenseTotals: (dice) => dice.reduce((t, d) => ({
        block: (t.block || 0) + (d.block || 0),
        evade: (t.evade || 0) + (d.evade || 0),
        dodge: t.dodge || d.dodge,
      }), { block: 0, evade: 0, dodge: false }),
      // Surge dependencies
      getAttackerSurgeAbilities: () => [],
      SURGE_LABELS: {},
      getSurgeAbilityLabel: (id) => id,
      resolveSurgeAbility: () => ({}),
      parseSurgeEffect: () => ({}),
      resolveCombatAfterRolls: async (...args) => { calls.resolveCombatAfterRolls.push(args); },
      getDcEffects: () => ({}),
      client: { channels: { fetch: async () => ({ send: async () => ({ id: 'thread-msg' }) }) } },
      ...overrides,
    },
    calls,
  };
}

// ── B-CTIME2-001: handleCombatReroll guard — no rerollPhase ────────────────

describe('B-CTIME2-001: handleCombatReroll guard — no combat/rerollPhase', () => {
  it('001a: no pendingCombat → ephemeral reject, no save', async () => {
    const game = makeGame(); // no pendingCombat
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_reroll_42_atk_0', 'player1');
    await handleCombatReroll(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No reroll phase'));
    assert.ok(msg, 'ephemeral "No reroll phase" reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('001b: pendingCombat exists but rerollPhase is null → ephemeral reject', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({ rerollPhase: null }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_reroll_42_atk_0', 'player1');
    await handleCombatReroll(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No reroll phase'));
    assert.ok(msg, 'ephemeral reject when rerollPhase is null');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-002: handleCombatReroll guard — wrong phase ───────────────────

describe('B-CTIME2-002: handleCombatReroll guard — wrong reroll phase', () => {
  it('002: defender reroll during attacker phase → ephemeral reject', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({ rerollPhase: 'attacker' }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    // side='def' but rerollPhase='attacker' → mismatch
    const interaction = mockInteraction('combat_reroll_42_def_0', 'player2');
    await handleCombatReroll(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes("attacker's turn"));
    assert.ok(msg, 'ephemeral wrong-phase reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-003: handleCombatReroll guard — wrong player ──────────────────

describe('B-CTIME2-003: handleCombatReroll guard — wrong player', () => {
  it('003: player2 tries attacker reroll when player1 is attacker → reject', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        rerollPhase: 'attacker',
        attackerPlayerNum: 1,
      }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    // player2 tries to reroll attacker dice
    const interaction = mockInteraction('combat_reroll_42_atk_0', 'player2');
    await handleCombatReroll(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && /Only\s+\*?\*?(P\d|Player \d)/.test(m.content || ''));
    assert.ok(msg, 'ephemeral wrong-player reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-004: handleCombatReroll integration — attacker rerolls die ────

describe('B-CTIME2-004: handleCombatReroll integration — attacker rerolls die', () => {
  it('004: attacker rerolls die index 0 → rerollsRemaining decremented, rerolledIndices updated', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        rerollPhase: 'attacker',
        attackerPlayerNum: 1,
        attackerRerollsRemaining: 2,
        attackerRerolledIndices: [],
      }),
    });
    const client = mockClientWithThread();
    const { ctx, calls } = buildCombatCtx(game, { client });
    const interaction = mockInteraction('combat_reroll_42_atk_0', 'player1', { client });
    await handleCombatReroll(interaction, ctx);

    const combat = game.pendingCombat;
    assert.strictEqual(combat.attackerRerollsRemaining, 1,
      'attackerRerollsRemaining decremented from 2 to 1');
    assert.ok(combat.attackerRerolledIndices.includes(0),
      'die index 0 added to attackerRerolledIndices');
    assert.ok(calls.rollSingleAttackDie.length > 0,
      'rollSingleAttackDie called');
    assert.ok(calls.recalcAttackTotals.length > 0,
      'recalcAttackTotals called to update totals');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME2-005: handleCombatReroll — "done" → combatGate ─────────────────

describe('B-CTIME2-005: handleCombatReroll — attacker "done" sets combatGate', () => {
  it('005: attacker clicks done → combatGate set to post_attacker_reroll', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        rerollPhase: 'attacker',
        attackerPlayerNum: 1,
        attackerRerollsRemaining: 2,
        attackerRerolledIndices: [],
      }),
    });
    const client = mockClientWithThread();
    const { ctx, calls } = buildCombatCtx(game, { client });
    const interaction = mockInteraction('combat_reroll_42_atk_done', 'player1', { client });
    await handleCombatReroll(interaction, ctx);

    const combat = game.pendingCombat;
    assert.ok(combat.combatGate, 'combatGate created');
    assert.strictEqual(combat.combatGate.phase, 'post_attacker_reroll',
      'combatGate.phase = post_attacker_reroll');
    assert.strictEqual(combat.combatGate.p1Ready, false, 'p1Ready initialized false');
    assert.strictEqual(combat.combatGate.p2Ready, false, 'p2Ready initialized false');
    // rerollsRemaining unchanged (done doesn't consume a reroll)
    assert.strictEqual(combat.attackerRerollsRemaining, 2,
      'attackerRerollsRemaining unchanged — "done" doesn\'t spend a reroll');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME2-006: handleCombatSurge guard — no surgeRemaining ──────────────

describe('B-CTIME2-006: handleCombatSurge guard — no surgeRemaining', () => {
  it('006a: no pendingCombat → ephemeral reject', async () => {
    const game = makeGame(); // no pendingCombat
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_surge_42_done', 'player1');
    await handleCombatSurge(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No surge'));
    assert.ok(msg, 'ephemeral "No surge" reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('006b: surgeRemaining = 0 → ephemeral reject', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({ surgeRemaining: 0 }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_surge_42_done', 'player1');
    await handleCombatSurge(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('No surge'));
    assert.ok(msg, 'ephemeral reject when surgeRemaining = 0');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-007: handleCombatSurge guard — wrong player ───────────────────

describe('B-CTIME2-007: handleCombatSurge guard — wrong player', () => {
  it('007: player2 tries to spend surge when player1 is attacker → reject', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        surgeRemaining: 2,
        attackerPlayerNum: 1,
      }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_surge_42_done', 'player2');
    await handleCombatSurge(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Only the attacker'));
    assert.ok(msg, 'ephemeral wrong-player reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-008: handleCombatSurge — "done" → combatGate pre_resolve ─────

describe('B-CTIME2-008: handleCombatSurge — "done" auto-advances through pre_resolve', () => {
  it('008: surge "done" → surgeRemaining=0, pre_resolve auto-advances → resolveCombatAfterRolls fires', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        surgeRemaining: 2,
        attackerPlayerNum: 1,
      }),
    });
    const client = mockClientWithThread();
    const { ctx, calls } = buildCombatCtx(game, { client });
    const interaction = mockInteraction('combat_surge_42_done', 'player1', { client });
    await handleCombatSurge(interaction, ctx);

    const combat = game.pendingCombat;
    assert.strictEqual(combat.surgeRemaining, 0,
      'surgeRemaining set to 0 on "done"');
    // pre_resolve is now an AUTO_ADVANCE sub-phase — no Ready gate posted,
    // damage applies immediately. Verify resolveCombatAfterRolls fired
    // and the gate was cleared after dispatch.
    assert.strictEqual(combat.combatGate, undefined,
      'combatGate cleared after auto-advance through pre_resolve');
    assert.ok(calls.resolveCombatAfterRolls.length > 0,
      'resolveCombatAfterRolls fired automatically after surge done');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-CTIME2-009: handleCombatToken guard — wrong tokenPhase ───────────────

describe('B-CTIME2-009: handleCombatToken guard — wrong tokenPhase', () => {
  it('009a: defender button during attacker tokenPhase → silent return', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({ tokenPhase: 'attacker' }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    // role='def' but tokenPhase='attacker' → mismatch at line 5049
    const interaction = mockInteraction('combat_token_42_def_skip', 'player2');
    await handleCombatToken(interaction, ctx);

    // Silent return — no followUp, no save
    assert.strictEqual(interaction._followUpCalls.length, 0,
      'no followUp sent — silent return on phase mismatch');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('009b: attacker button during defender tokenPhase → silent return', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({ tokenPhase: 'defender' }),
    });
    const { ctx, calls } = buildCombatCtx(game);
    const interaction = mockInteraction('combat_token_42_att_skip', 'player1');
    await handleCombatToken(interaction, ctx);

    assert.strictEqual(interaction._followUpCalls.length, 0,
      'no followUp sent — silent return on phase mismatch');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-010: handleCombatToken guard — wrong player ───────────────────

describe('B-CTIME2-010: handleCombatToken guard — wrong player', () => {
  it('010: player2 tries attacker token when player1 is attacker → reject', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        tokenPhase: 'attacker',
        attackerPlayerNum: 1,
      }),
    });
    const client = mockClientWithThread();
    const { ctx, calls } = buildCombatCtx(game, { client });
    // player2 presses attacker token button
    const interaction = mockInteraction('combat_token_42_att_skip', 'player2', { client });
    await handleCombatToken(interaction, ctx);

    const msg = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Only the correct player'));
    assert.ok(msg, 'ephemeral wrong-player reject sent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });
});

// ── B-CTIME2-011: Phase sequencing invariant ───────────────────────────────

describe('B-CTIME2-011: Phase sequencing invariant across reroll → surge → token', () => {
  it('011: reroll done → post_attacker_reroll gate, surge done → pre_resolve gate, token phase guard consistent', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        rerollPhase: 'attacker',
        attackerPlayerNum: 1,
        attackerRerollsRemaining: 1,
        attackerRerolledIndices: [],
        surgeRemaining: 1,
      }),
    });
    const client = mockClientWithThread();

    // Step 1: Attacker clicks "done" on rerolls
    const { ctx: ctx1 } = buildCombatCtx(game, { client });
    await handleCombatReroll(
      mockInteraction('combat_reroll_42_atk_done', 'player1', { client }), ctx1);

    const combat = game.pendingCombat;
    assert.strictEqual(combat.combatGate?.phase, 'post_attacker_reroll',
      'Step 1: combatGate = post_attacker_reroll after reroll done');

    // Step 2: Clear gate (simulating both players ready) and set up for surge
    delete combat.combatGate;
    combat.rerollPhase = null; // rerolls done

    // Step 3: Surge done → pre_resolve auto-advances → no gate left behind
    const { ctx: ctx2 } = buildCombatCtx(game, { client });
    await handleCombatSurge(
      mockInteraction('combat_surge_42_done', 'player1', { client }), ctx2);

    assert.strictEqual(combat.surgeRemaining, 0,
      'Step 3: surgeRemaining = 0 after surge done');
    assert.strictEqual(combat.combatGate, undefined,
      'Step 3: pre_resolve auto-advanced — no gate left behind');

    // Step 4: Token phase guard — wrong phase returns silently
    delete combat.combatGate;
    combat.tokenPhase = 'attacker';
    const { ctx: ctx3 } = buildCombatCtx(game, { client });
    await handleCombatToken(
      mockInteraction('combat_token_42_def_skip', 'player2', { client }), ctx3);

    // Defender button during attacker tokenPhase → silent reject (no followUp)
    // tokenPhase unchanged — no state mutation
    assert.strictEqual(combat.tokenPhase, 'attacker',
      'Step 4: tokenPhase unchanged — defender button rejected during attacker phase');
  });
});

// ── B-CTIME2-012: Reroll exhaustion → auto-gate ────────────────────────────

describe('B-CTIME2-012: Reroll exhaustion auto-gates when rerollsRemaining hits 0', () => {
  it('012: last reroll (remaining=1) → rerollsRemaining=0, combatGate=post_attacker_reroll', async () => {
    const game = makeGame({
      pendingCombat: makeCombat({
        rerollPhase: 'attacker',
        attackerPlayerNum: 1,
        attackerRerollsRemaining: 1,
        attackerRerolledIndices: [],
      }),
    });
    const client = mockClientWithThread();
    const { ctx, calls } = buildCombatCtx(game, { client });
    // Reroll die index 0 — this will exhaust remaining rerolls
    const interaction = mockInteraction('combat_reroll_42_atk_0', 'player1', { client });
    await handleCombatReroll(interaction, ctx);

    const combat = game.pendingCombat;
    assert.strictEqual(combat.attackerRerollsRemaining, 0,
      'attackerRerollsRemaining decremented to 0');
    assert.ok(combat.attackerRerolledIndices.includes(0),
      'die index 0 recorded in rerolledIndices');
    // Auto-gate: when rerollsRemaining hits 0, sendCombatGate is called
    assert.ok(combat.combatGate, 'combatGate created on reroll exhaustion');
    assert.strictEqual(combat.combatGate.phase, 'post_attacker_reroll',
      'combatGate.phase = post_attacker_reroll (auto-gate on exhaustion)');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});
