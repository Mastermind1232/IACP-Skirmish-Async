/**
 * BEHAVIORAL oracle tests for Combat Timing Phase 3: representative e2e pipeline coverage.
 *
 * Tests that the combat pipeline moves cleanly through its major synchronization
 * points in representative, live-relevant combat stories without stalling,
 * duplicating windows, or leaving stale state behind.
 *
 * Pipeline path (simplified):
 *   sendCombatGate('post_roll')
 *     → dispatchCombatGateAdvance → reroll phases → gates → proceedAfterRerolls
 *       → token windows → proceedAfterTokens → surge window
 *         → sendReadyToResolveRolls → sendCombatGate('pre_resolve')
 *           → dispatchCombatGateAdvance → resolveCombatAfterRolls → END
 *
 * Test categories:
 *   B-E2E-001: selfPlay baseline — full pipeline auto-runs from post_roll to resolution
 *   B-E2E-002: Attacker reroll path — reroll → gates → resolution
 *   B-E2E-003: Defender reroll + token path — defender ordering + token integration
 *   B-E2E-004: Attacker token + surge path — token → surge → resolution handoff
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendCombatGate,
  handleCombatGateReady,
  handleCombatReroll,
  handleCombatSurge,
  handleCombatToken,
} from '../../../src/handlers/combat.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

/** Mock thread with send() that captures calls */
function mockThread() {
  const sends = [];
  return {
    send: async (msg) => { sends.push(msg); return { id: 'thread-msg' }; },
    _sends: sends,
  };
}

/** Client whose channels.fetch returns a shared mock thread */
function mockClientWithThread(thread) {
  return {
    channels: { fetch: async () => thread },
    user: { id: 'bot' },
  };
}

function mockInteraction(customId, userId, client, thread) {
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
    client: client || { channels: { fetch: async () => null } },
    _followUpCalls: followUpCalls,
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
    figureConditions: {},
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
    target: { figureKey: 'Stormtrooper-2-0', label: 'Stormtrooper' },
    attackDiceResults: [
      { color: 'blue', acc: 2, dmg: 1, surge: 0 },
      { color: 'green', acc: 0, dmg: 1, surge: 0 },
    ],
    defenseDiceResults: [
      { color: 'white', block: 1, evade: 0, dodge: false },
    ],
    attackRoll: { acc: 2, dmg: 2, surge: 0 },
    defenseRoll: { block: 1, evade: 0, dodge: false },
    ...overrides,
  };
}

/**
 * Build ctx for e2e pipeline tests.
 * getDcEffects returns {} to skip all DC-passive checks in proceedAfterRerolls.
 * resolveCombatAfterRolls is tracked to verify pipeline completion.
 */
function buildE2eCtx(game, client, overrides = {}) {
  const calls = {
    saveGames: [],
    resolveCombatAfterRolls: [],
    rollSingleAttackDie: [],
    rollSingleDefenseDie: [],
  };

  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      saveGames: () => { calls.saveGames.push(true); },
      logGameAction: async () => {},
      // Reroll mocks
      rollSingleAttackDie: (color) => {
        const result = { color, acc: 1, dmg: 2, surge: 0 };
        calls.rollSingleAttackDie.push(result);
        return result;
      },
      rollSingleDefenseDie: (color) => {
        const result = { color, block: 1, evade: 1, dodge: false };
        calls.rollSingleDefenseDie.push(result);
        return result;
      },
      recalcAttackTotals: (dice) => dice.reduce((t, d) => ({
        acc: (t.acc || 0) + (d.acc || 0),
        dmg: (t.dmg || 0) + (d.dmg || 0),
        surge: (t.surge || 0) + (d.surge || 0),
      }), { acc: 0, dmg: 0, surge: 0 }),
      recalcDefenseTotals: (dice) => dice.reduce((t, d) => ({
        block: (t.block || 0) + (d.block || 0),
        evade: (t.evade || 0) + (d.evade || 0),
        dodge: t.dodge || d.dodge,
      }), { block: 0, evade: 0, dodge: false }),
      // Surge mocks
      getAttackerSurgeAbilities: () => [],
      SURGE_LABELS: {},
      getSurgeAbilityLabel: (id) => id,
      resolveSurgeAbility: () => ({}),
      parseSurgeEffect: () => ({}),
      getAbility: () => null,
      // DC effects: empty to skip all passive checks in proceedAfterRerolls
      getDcEffects: () => ({}),
      // Resolution tracker
      resolveCombatAfterRolls: async (g, c, cl) => {
        calls.resolveCombatAfterRolls.push({ gameId: g.gameId, combatGameId: c.gameId });
      },
      client: client || { channels: { fetch: async () => null } },
      ...overrides,
    },
    calls,
  };
}

/** Helper: advance a combat gate by having both players click Ready */
async function advanceGate(game, client, ctx) {
  const i1 = mockInteraction('combat_gate_42', 'player1', client);
  await handleCombatGateReady(i1, ctx);
  const i2 = mockInteraction('combat_gate_42', 'player2', client);
  await handleCombatGateReady(i2, ctx);
}

// ── B-E2E-001: selfPlay baseline ───────────────────────────────────────────

describe('B-E2E-001: selfPlay baseline — full pipeline auto-runs to resolution', () => {
  it('001: post_roll → no rerolls → no tokens → no surge → pre_resolve → resolution', async () => {
    const thread = mockThread();
    const client = mockClientWithThread(thread);
    const combat = makeCombat();
    const game = makeGame({ selfPlay: true, pendingCombat: combat });
    const { ctx, calls } = buildE2eCtx(game, client);

    // Single call: selfPlay skips all gates, runs entire pipeline
    await sendCombatGate(thread, game, combat, 'post_roll', ctx);

    // Pipeline completed: resolveCombatAfterRolls was called
    assert.strictEqual(calls.resolveCombatAfterRolls.length, 1,
      'resolveCombatAfterRolls called exactly once');
    assert.strictEqual(calls.resolveCombatAfterRolls[0].gameId, '42',
      'resolution received correct game');

    // No stale state left behind
    assert.strictEqual(combat.combatGate, undefined,
      'no stale combatGate — selfPlay never sets it');
    assert.strictEqual(combat.rerollPhase ?? null, null,
      'rerollPhase is null — no rerolls were available');
    assert.strictEqual(combat.tokenPhase ?? undefined, undefined,
      'tokenPhase never set — selfPlay skips token windows');
    assert.strictEqual(combat.surgeRemaining ?? undefined, undefined,
      'surgeRemaining never set — no surge abilities');
  });
});

// ── B-E2E-002: Attacker reroll path ────────────────────────────────────────

describe('B-E2E-002: Attacker reroll path — reroll → gates → resolution', () => {
  it('002: post_roll gate → attacker reroll → post_attacker_reroll gate → step4-attacker Mods Y/N prompt (CRR step 4)', async () => {
    const thread = mockThread();
    const client = mockClientWithThread(thread);
    const combat = makeCombat({
      attackerRerollsRemaining: 1,
      attackerRerolledIndices: [],
    });
    const game = makeGame({ pendingCombat: combat });
    const { ctx, calls } = buildE2eCtx(game, client);

    // Step 1: Create post_roll gate
    await sendCombatGate(thread, game, combat, 'post_roll', ctx);
    assert.strictEqual(combat.combatGate?.phase, 'post_roll',
      'Step 1: combatGate = post_roll');

    // Step 2: Both players ready → dispatchCombatGateAdvance('post_roll')
    //   → attackerRerollsRemaining=1 → rerollPhase='attacker', sendRerollUI
    await advanceGate(game, client, ctx);
    assert.strictEqual(combat.combatGate, undefined,
      'Step 2: gate consumed after both ready');
    assert.strictEqual(combat.rerollPhase, 'attacker',
      'Step 2: rerollPhase set to attacker');

    // Step 3: Attacker clicks "done" → sendCombatGate('post_attacker_reroll')
    const rerollInteraction = mockInteraction('combat_reroll_42_atk_done', 'player1', client);
    await handleCombatReroll(rerollInteraction, ctx);
    assert.strictEqual(combat.combatGate?.phase, 'post_attacker_reroll',
      'Step 3: combatGate = post_attacker_reroll after reroll done');

    // Step 4: Both players ready → dispatchCombatGateAdvance('post_attacker_reroll')
    //   → no forced, no defender rerolls → currentStep='step4-attacker'
    //   → sendModsYn (attacker) — destruct 2026-05-08: attacker mods window
    //   must fire at step 4 before defender / damage resolution.
    await advanceGate(game, client, ctx);
    assert.strictEqual(combat.rerollPhase, null,
      'Step 4: rerollPhase cleared to null');
    assert.strictEqual(combat.currentStep, 'step4-attacker',
      'Step 4: currentStep advanced to step4-attacker — Mods Y/N owns the window');
    assert.strictEqual(calls.resolveCombatAfterRolls.length, 0,
      'Step 4: resolveCombatAfterRolls NOT called — Mods Y/N prompt intervenes');
    assert.strictEqual(combat.combatGate, undefined,
      'Step 4: no stale combatGate — gate consumed by dispatch');
  });
});

// ── B-E2E-003: Defender reroll + token path ────────────────────────────────

describe('B-E2E-003: Defender reroll path — post-roll pipeline (PT-on-declare moved tokens pre-roll)', () => {
  it('003: post_roll → defender reroll → post_defender_reroll → pre_resolve → resolution', async () => {
    // After CRR-COMBAT-PT-DECLARE refactor: tokens are spent pre-roll, NOT post-rerolls.
    // This test exercises the post-roll pipeline only — token integration is covered by
    // tests/domain/oracle/combat-pt-on-declare.test.js (structural) and the new pre-roll
    // PT phase. The figurePowerTokens here are intentionally unspent — tokens that
    // would have been offered have already been declined or spent before Step 1.
    const thread = mockThread();
    const client = mockClientWithThread(thread);
    const combat = makeCombat({
      defenderRerollsRemaining: 1,
      defenderRerolledIndices: [],
    });
    // selfPlay skips the per-player Mods Y/N prompts (CRR step 4) so we
    // can exercise the rest of the pipeline. The Mods flow is covered
    // separately in handler-level tests.
    const game = makeGame({
      selfPlay: true,
      pendingCombat: combat,
      figurePowerTokens: {},
    });
    const { ctx, calls } = buildE2eCtx(game, client);

    // Step 1: post_roll gate
    await sendCombatGate(thread, game, combat, 'post_roll', ctx);

    // Step 2: Both ready → no attacker rerolls, no forced → rerollPhase='defender'
    await advanceGate(game, client, ctx);
    assert.strictEqual(combat.rerollPhase, 'defender',
      'Step 2: rerollPhase = defender (attacker skipped — no rerolls)');

    // Step 3: Defender clicks "done" → sendCombatGate('post_defender_reroll')
    const defRerollInteraction = mockInteraction('combat_reroll_42_def_done', 'player2', client);
    await handleCombatReroll(defRerollInteraction, ctx);

    // Step 4: Mods Y/N skipped (selfPlay) → proceedAfterRerolls →
    //   no tokens, no surge → resolveCombatAfterRolls fires automatically.
    await advanceGate(game, client, ctx);
    assert.strictEqual(combat.rerollPhase, null,
      'Step 4: rerollPhase cleared');
    assert.strictEqual(combat.tokenPhase ?? null, null,
      'Step 4: tokenPhase NOT set post-rerolls — tokens are pre-roll now (CRR p.50)');
    assert.strictEqual(calls.resolveCombatAfterRolls.length, 1,
      'Step 4: resolveCombatAfterRolls called — damage applies automatically');
    assert.strictEqual(combat.combatGate, undefined,
      'Step 4: no stale combatGate after auto-advance resolution');
  });
});

// ── B-E2E-004: Attacker token + surge path ─────────────────────────────────

describe('B-E2E-004: Attacker surge path — post-roll pipeline (PT-on-declare moved tokens pre-roll)', () => {
  it('004: post_roll → no rerolls → surge → pre_resolve → resolution', async () => {
    // After CRR-COMBAT-PT-DECLARE refactor: tokens are spent pre-roll. This test
    // exercises the post-roll surge → resolution pipeline. Pre-roll PT spending is
    // simulated by setting `attackerSpentPowerToken` directly + applying the +1 hit
    // via combat.bonusHits (matches what proceedToTokenPhase / handleCombatToken
    // would have done before rolls).
    const thread = mockThread();
    const client = mockClientWithThread(thread);
    const combat = makeCombat({
      attackRoll: { acc: 2, dmg: 2, surge: 2 },
      attackDiceResults: [
        { color: 'blue', acc: 2, dmg: 1, surge: 1 },
        { color: 'green', acc: 0, dmg: 1, surge: 1 },
      ],
      // Simulate pre-roll PT spend: +1 Damage already committed at declare.
      bonusHits: 1,
      attackerSpentPowerToken: true,
    });
    // selfPlay skips Mods Y/N (CRR step 4) per-player prompts so this
    // test can exercise the post-rerolls → surge → resolution pipeline
    // end-to-end. Mods Y/N flow is covered by dedicated handler tests.
    const game = makeGame({
      selfPlay: true,
      pendingCombat: combat,
      figurePowerTokens: {},
    });
    const { ctx, calls } = buildE2eCtx(game, client, {
      getAttackerSurgeAbilities: () => ['surge_dmg_1'],
      getSurgeAbilityLabel: () => '+1 Damage',
      getAbility: () => ({ surgeCost: 1 }),
    });

    // Step 1: sendCombatGate dispatches immediately under selfPlay, runs
    //   no-reroll path → proceedAfterRerolls → opens surge window.
    await sendCombatGate(thread, game, combat, 'post_roll', ctx);
    assert.strictEqual(combat.rerollPhase ?? null, null,
      'Step 1: no rerolls — rerollPhase stays null');
    assert.strictEqual(combat.tokenPhase ?? null, null,
      'Step 1: tokenPhase NOT set post-rerolls — tokens are pre-roll now (CRR p.50)');
    assert.ok(combat.surgeRemaining > 0,
      'Step 1: surgeRemaining > 0 — surge window opened under selfPlay');

    // Step 2: Attacker clicks "done" on surge → resolution
    const surgeInteraction = mockInteraction('combat_surge_42_done', 'player1', client);
    await handleCombatSurge(surgeInteraction, ctx);

    assert.strictEqual(combat.surgeRemaining, 0,
      'Step 2: surgeRemaining = 0 after done');
    assert.strictEqual(calls.resolveCombatAfterRolls.length, 1,
      'Step 2: resolveCombatAfterRolls called automatically after surge done');
    assert.strictEqual(combat.combatGate, undefined,
      'Step 2: no stale combatGate after resolution');
    // Pre-roll PT bonus survives through to resolution
    assert.strictEqual(combat.bonusHits, 1,
      'pre-roll PT +1 Hit preserved into resolution');
    assert.strictEqual(combat.attackerSpentPowerToken, true,
      'attackerSpentPowerToken tracked for Pulse Cannon');
  });
});
