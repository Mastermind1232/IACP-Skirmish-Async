/**
 * BEHAVIORAL oracle tests for combat.js Phase 2: Token spending, power-token
 * overflow suspend/resume, and pending-state lifecycle.
 *
 * Test categories:
 *   B-C-TOKEN-*:    Token spend correctness, wild resolution, skip, bonus flags
 *   B-C-OVERFLOW-*: Power-token overflow detection, discard loop, resume-to-surge
 *   B-C-PEND2-*:    Pending-state lifecycle invariants for token/overflow flows
 *   B-C-COMBINED-*: Token spending interacting with surge resolution
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleCombatToken, handlePowerTokenChoice,
  handlePowerTokenOverflowDiscard, sendPowerTokenOverflowUI,
  resumeSurgeChoiceOrResolve,
} from '../../../src/handlers/combat.js';
import { grantPowerTokens, resolveOverflowDiscard } from '../../../src/game/game-helpers.js';
import {
  recalcAttackTotals, recalcDefenseTotals, getAttackerSurgeAbilities, parseSurgeEffect,
} from '../../../src/game/combat.js';

// ── Mock helpers (extended from Phase 1 pattern) ─────────────────────────────

function mockThread() {
  const sent = [];
  return {
    send: async (msg) => { sent.push(msg); return { content: typeof msg === 'string' ? msg : msg?.content, id: `msg_${sent.length}` }; },
    _sent: sent,
    id: 'thread1',
  };
}

function mockInteraction(customId, userId = 'player1', sharedThread = null) {
  const thread = sharedThread || mockThread();
  return {
    customId,
    user: { id: userId },
    followUp: async () => ({}),
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: { content: '', edit: async () => ({}) },
    client: { channels: { fetch: async () => thread } },
    channelId: 'thread1',
    _thread: thread,
  };
}

function makeCombat(overrides = {}) {
  return {
    gameId: 'g1',
    combatThreadId: 'thread1',
    attackerPlayerNum: 1,
    attackerDcName: 'Stormtrooper',
    attackerFigureKey: 'Stormtrooper-1-0',
    attackerDisplayName: 'Stormtrooper [DG 1]',
    attackerMsgId: 'dc1',
    attackerFigureIndex: 0,
    defenderPlayerNum: 2,
    defenderDcName: 'Rebel Trooper',
    target: { figureKey: 'Rebel Trooper-1-0', label: 'Rebel Trooper', playerNum: 2 },
    attackDiceResults: [
      { color: 'blue', acc: 2, dmg: 1, surge: 1 },
      { color: 'green', acc: 0, dmg: 2, surge: 0 },
    ],
    defenseDiceResults: [
      { color: 'white', block: 1, evade: 0, dodge: false },
    ],
    attackRoll: { acc: 2, dmg: 3, surge: 1 },
    defenseRoll: { block: 1, evade: 0, dodge: false },
    surgeRemaining: 0,
    surgeSpentCount: {},
    forcedRerollQueue: [],
    tokenPhase: null,
    ...overrides,
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: 'g1',
    player1Id: 'player1',
    player2Id: 'player2',
    figurePowerTokens: {},
    figurePositions: { 1: {}, 2: {} },
    ...overrides,
  };
}

function buildCtx(game, overrides = {}) {
  const thread = mockThread();
  const calls = {
    saveGames: [], logGameAction: [], resolveCombatAfterRolls: [],
    processDefeat: [], sendReadyToResolve: [],
  };
  return {
    ctx: {
      getGame: (id) => id === game.gameId ? game : null,
      canActAsPlayer: () => true,
      replyIfGameEnded: async () => false,
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => thread } },
      recalcAttackTotals,
      recalcDefenseTotals,
      getAttackerSurgeAbilities,
      parseSurgeEffect,
      resolveSurgeAbility: parseSurgeEffect,
      getSurgeAbilityLabel: (key) => key,
      SURGE_LABELS: {},
      getAbility: () => ({ surgeCost: 1 }),
      getDcEffects: () => ({}),
      resolveCombatAfterRolls: async () => { calls.resolveCombatAfterRolls.push(true); },
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      rollSingleAttackDie: (color) => ({ color, acc: 1, dmg: 1, surge: 0 }),
      rollSingleDefenseDie: (color) => ({ color, block: 1, evade: 0, dodge: false }),
      processFigureDefeat: async (_g, opts) => { calls.processDefeat.push(opts); },
      dcHealthState: new Map(),
      findDcMessageIdForFigure: () => 'dc1',
      checkWinConditions: async () => {},
      ...overrides,
    },
    thread,
    calls,
  };
}

// ── B-C-TOKEN: Token spend correctness ───────────────────────────────────────

describe('B-C-TOKEN: Power token spending during combat', () => {
  it('B-C-TOKEN-001: attacker spending Damage token adds +1 bonusHits', async () => {
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Damage', 'Surge'] },
    });
    const { ctx, calls } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits, 1, 'bonusHits increased by 1');
    assert.strictEqual(combat.attackerSpentPowerToken, true, 'attackerSpentPowerToken flag set');
    // Token removed from game state
    const remaining = game.figurePowerTokens['Stormtrooper-1-0'] || [];
    assert.strictEqual(remaining.length, 1, 'one token remains');
    assert.strictEqual(remaining[0], 'Surge', 'Surge token still present');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('B-C-TOKEN-002: defender spending Block token adds +1 bonusBlock and sets tracking flags', async () => {
    const combat = makeCombat({ tokenPhase: 'defender' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Block'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_def_0', 'player2'), ctx);

    assert.strictEqual(combat.bonusBlock, 1, 'bonusBlock increased by 1');
    assert.strictEqual(combat.defenderSpentBlock, true, 'defenderSpentBlock flag set');
    assert.strictEqual(combat.defenderRerolledOrModified, true, 'defenderRerolledOrModified flag set');
    // Token removed
    assert.strictEqual(game.figurePowerTokens['Rebel Trooper-1-0'], undefined, 'token array deleted when empty');
  });

  it('B-C-TOKEN-003: attacker spending Surge token adds +1 tokenSurgeBonus', async () => {
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Surge'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1'), ctx);

    assert.strictEqual(combat.tokenSurgeBonus, 1, 'tokenSurgeBonus increased by 1');
    assert.strictEqual(combat.attackerSpentPowerToken, true, 'attackerSpentPowerToken set');
  });

  it('B-C-TOKEN-004: defender spending Evade token adds +1 bonusEvade', async () => {
    const combat = makeCombat({ tokenPhase: 'defender' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Evade'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_def_0', 'player2'), ctx);

    assert.strictEqual(combat.bonusEvade, 1, 'bonusEvade increased by 1');
    assert.strictEqual(combat.defenderRerolledOrModified, true, 'defender modification tracked');
  });

  it('B-C-TOKEN-005: skip path does not mutate combat bonuses or remove tokens', async () => {
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Damage'] },
    });
    const { ctx, calls } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_skip', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits || 0, 0, 'no bonus applied');
    assert.strictEqual(combat.attackerSpentPowerToken, undefined, 'no spend flag');
    assert.deepStrictEqual(game.figurePowerTokens['Stormtrooper-1-0'], ['Damage'], 'token not removed');
    assert.ok(calls.saveGames.length > 0, 'saveGames still called');
  });

  it('B-C-TOKEN-006: Wild token suspends for type resolution (sets pendingWild fields)', async () => {
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Wild'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1'), ctx);

    assert.strictEqual(combat.pendingWildRole, 'attacker', 'pendingWildRole set');
    assert.strictEqual(combat.pendingWildTokenIndex, 0, 'pendingWildTokenIndex set');
    // Token NOT yet removed (waiting for type resolution)
    assert.deepStrictEqual(game.figurePowerTokens['Stormtrooper-1-0'], ['Wild'], 'token still present');
  });

  it('B-C-TOKEN-007: Wild type resolution applies bonus, removes token, clears pending fields', async () => {
    const combat = makeCombat({
      tokenPhase: 'attacker',
      pendingWildRole: 'attacker',
      pendingWildTokenIndex: 0,
      pendingWildCohesionFigureKey: null,
      pendingWildCohesionOwnerName: null,
    });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Wild'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_wild_damage', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits, 1, 'Wild→Damage applied +1 bonusHits');
    assert.strictEqual(combat.attackerSpentPowerToken, true, 'attacker spend tracked');
    assert.strictEqual(combat.pendingWildRole, null, 'pendingWildRole cleared');
    assert.strictEqual(combat.pendingWildTokenIndex, null, 'pendingWildTokenIndex cleared');
    assert.strictEqual(combat.pendingWildCohesionFigureKey, null, 'cohesion figKey cleared');
    assert.strictEqual(combat.pendingWildCohesionOwnerName, null, 'cohesion ownerName cleared');
    // Token removed
    assert.strictEqual(game.figurePowerTokens['Stormtrooper-1-0'], undefined, 'Wild token removed');
  });

  it('B-C-TOKEN-008: Unhinged Director prompts attacker for +1/+2 strain choice instead of auto-+2', async () => {
    // Updated 2026-05-04: per card text ("MAY suffer 1 Strain to apply +2
    // instead of +1"), Unhinged Director is a player choice — not an
    // automatic doubling. handleCombatToken now stages the pending choice
    // and posts a prompt; bonusHits stays at 0 until the user resolves.
    // Resolution flow is exercised end-to-end in the live integration
    // path; this oracle just verifies the staging.
    const combat = makeCombat({
      tokenPhase: 'attacker',
      attackerUnhingedBonus: true,
    });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Damage'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1'), ctx);

    assert.ok(!combat.bonusHits, 'no bonus applied yet — waiting for prompt resolution');
    assert.ok(game.pendingUnhingedDirector, 'pendingUnhingedDirector is set so the +1/+2 choice can resume');
    assert.strictEqual(game.pendingUnhingedDirector.tokenType, 'Damage');
  });

  it('B-C-TOKEN-009: wrong tokenPhase is silently rejected', async () => {
    const combat = makeCombat({ tokenPhase: 'defender' }); // phase is defender
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Damage'] },
    });
    const { ctx, calls } = buildCtx(game);

    // Attacker tries to spend during defender phase
    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits || 0, 0, 'no bonus applied');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
  });

  it('B-C-TOKEN-010: attacker skip advances to defender token phase when defender has tokens', async () => {
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: {
        'Stormtrooper-1-0': ['Damage'],
        'Rebel Trooper-1-0': ['Block'],
      },
    });
    const sharedThread = mockThread();
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_skip', 'player1', sharedThread), ctx);

    assert.strictEqual(combat.tokenPhase, 'defender', 'advanced to defender phase');
    // Should have sent defender token window
    assert.ok(sharedThread._sent.some(m => {
      const content = typeof m === 'string' ? m : m?.content || '';
      return content.includes('Defender') || content.includes('Block') || content.includes('token');
    }), 'defender token window shown');
  });

  it('B-C-TOKEN-011: defender Wild→Block sets defenderSpentBlock flag', async () => {
    const combat = makeCombat({
      tokenPhase: 'defender',
      pendingWildRole: 'defender',
      pendingWildTokenIndex: 0,
      pendingWildCohesionFigureKey: null,
      pendingWildCohesionOwnerName: null,
    });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Wild'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_wild_block', 'player2'), ctx);

    assert.strictEqual(combat.bonusBlock, 1, 'Wild→Block applied +1 bonusBlock');
    assert.strictEqual(combat.defenderSpentBlock, true, 'defenderSpentBlock set via Wild→Block');
    assert.strictEqual(combat.defenderRerolledOrModified, true, 'defender modification tracked');
  });
});

// ── B-C-OVERFLOW: Power-token overflow suspend/resume ────────────────────────

describe('B-C-OVERFLOW: Power-token overflow detection and resolution', () => {
  it('B-C-OVERFLOW-001: grantPowerTokens queues overflow when exceeding cap', () => {
    const game = makeGame({
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block'] },
    });
    // Cap is 2 by default; granting 1 more should overflow
    grantPowerTokens(game, 'Trooper-1-0', 'Surge', 1);

    assert.strictEqual(game.figurePowerTokens['Trooper-1-0'].length, 3, 'token granted first');
    assert.ok(game.pendingPowerTokenOverflow, 'overflow queued');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, 'Trooper-1-0');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1, 'must discard 1');
  });

  it('B-C-OVERFLOW-002: resolveOverflowDiscard removes token and decrements counter', () => {
    const game = makeGame({
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block', 'Surge'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Trooper-1-0', discardCount: 1 }],
    });

    const { discarded, remaining } = resolveOverflowDiscard(game, 'Trooper-1-0', 0);

    assert.strictEqual(discarded, 'Damage', 'first token discarded');
    assert.strictEqual(remaining, 0, 'no more discards needed');
    assert.strictEqual(game.figurePowerTokens['Trooper-1-0'].length, 2, 'down to 2 tokens');
    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'overflow cleared when empty');
  });

  it('B-C-OVERFLOW-003: multi-discard overflow requires multiple resolves', () => {
    const game = makeGame({
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block', 'Surge', 'Evade'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Trooper-1-0', discardCount: 2 }],
    });

    const r1 = resolveOverflowDiscard(game, 'Trooper-1-0', 0);
    assert.strictEqual(r1.remaining, 1, 'still 1 more to discard');
    assert.ok(game.pendingPowerTokenOverflow, 'overflow still pending');

    const r2 = resolveOverflowDiscard(game, 'Trooper-1-0', 0);
    assert.strictEqual(r2.remaining, 0, 'overflow resolved');
    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'overflow cleared');
    assert.strictEqual(game.figurePowerTokens['Trooper-1-0'].length, 2, 'at cap');
  });

  it('B-C-OVERFLOW-004: handlePowerTokenOverflowDiscard resumes surge when overflow resolves', async () => {
    // Note: pt_overflow_ regex requires numeric gameId
    const combat = makeCombat({ gameId: '99', surgeRemaining: 1 });
    const game = makeGame({
      gameId: '99',
      pendingCombat: combat,
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block', 'Surge'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Trooper-1-0', discardCount: 1, playerNum: 1, channelId: 'thread1' }],
      pendingSurgeOverflow: { combatThreadId: 'thread1', attackerPlayerNum: 1 },
    });
    const sharedThread = mockThread();
    const { ctx } = buildCtx(game);

    await handlePowerTokenOverflowDiscard(
      mockInteraction('pt_overflow_99_1_Trooper-1-0_0', 'player1', sharedThread),
      ctx,
    );

    // Overflow should be resolved
    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'overflow cleared');
    // pendingSurgeOverflow should be cleared (resume happened)
    assert.ok(game.pendingSurgeOverflow == null, 'pendingSurgeOverflow cleared');
    // Should have sent surge UI (or ready-to-resolve)
    assert.ok(sharedThread._sent.some(m => {
      const content = typeof m === 'string' ? m : m?.content || '';
      return content.includes('surge') || content.includes('Surge') || content.includes('resolve') || content.includes('Resolve');
    }), 'surge UI or resolve message sent after overflow resume');
  });

  it('B-C-OVERFLOW-005: handlePowerTokenOverflowDiscard loops when multiple discards needed', async () => {
    const combat = makeCombat({ gameId: '99', surgeRemaining: 0 });
    const game = makeGame({
      gameId: '99',
      pendingCombat: combat,
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block', 'Surge', 'Evade'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Trooper-1-0', discardCount: 2, playerNum: 1, channelId: 'thread1' }],
    });
    const sharedThread = mockThread();
    const { ctx } = buildCtx(game);

    // First discard — should show updated overflow UI, not resume
    await handlePowerTokenOverflowDiscard(
      mockInteraction('pt_overflow_99_1_Trooper-1-0_0', 'player1', sharedThread),
      ctx,
    );

    assert.ok(game.pendingPowerTokenOverflow, 'overflow still pending after first discard');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1, 'still 1 to go');
  });

  it('B-C-OVERFLOW-006: handlePowerTokenChoice sets pendingSurgeOverflow when overflow during surge', async () => {
    const combat = makeCombat({ surgeRemaining: 2 });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block'] },
      pendingPowerTokenGrant: {
        grants: [{ figureKey: 'Trooper-1-0', figName: 'Trooper', count: 1 }],
        channelId: 'thread1',
        playerNum: 1,
      },
    });
    const sharedThread = mockThread();
    const { ctx } = buildCtx(game);

    await handlePowerTokenChoice(
      mockInteraction('power_token_choice_g1_surge', 'player1', sharedThread),
      ctx,
    );

    // Token granted → overflow
    assert.strictEqual(game.pendingPowerTokenGrant, null, 'grant cleared');
    assert.ok(game.pendingPowerTokenOverflow, 'overflow queued');
    assert.ok(game.pendingSurgeOverflow, 'pendingSurgeOverflow set');
    assert.strictEqual(game.pendingSurgeOverflow.combatThreadId, 'thread1', 'correct thread stored');
  });

  it('B-C-OVERFLOW-007: handlePowerTokenChoice resumes surge directly when no overflow', async () => {
    const combat = makeCombat({ surgeRemaining: 1 });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: {}, // empty — grant will not overflow (0+1 = 1 <= 2 cap)
      pendingPowerTokenGrant: {
        grants: [{ figureKey: 'Trooper-1-0', figName: 'Trooper', count: 1 }],
        channelId: 'thread1',
        playerNum: 1,
      },
    });
    const sharedThread = mockThread();
    const { ctx } = buildCtx(game);

    await handlePowerTokenChoice(
      mockInteraction('power_token_choice_g1_block', 'player1', sharedThread),
      ctx,
    );

    assert.strictEqual(game.pendingPowerTokenGrant, null, 'grant cleared');
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined, 'no overflow');
    // Should have resumed surge
    assert.ok(sharedThread._sent.some(m => {
      const content = typeof m === 'string' ? m : m?.content || '';
      return content.includes('surge') || content.includes('Surge');
    }), 'surge UI shown after no-overflow grant');
  });
});

// ── B-C-PEND2: Pending-state lifecycle invariants ────────────────────────────

describe('B-C-PEND2: Pending-state lifecycle for token/overflow flows', () => {
  it('B-C-PEND2-001: Wild type resolution clears all four pendingWild fields', async () => {
    const combat = makeCombat({
      pendingWildRole: 'defender',
      pendingWildTokenIndex: 0,
      pendingWildCohesionFigureKey: 'Ko-Tun-1-0',
      pendingWildCohesionOwnerName: 'Ko-Tun Feralo',
    });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Ko-Tun-1-0': ['Wild'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_wild_evade', 'player2'), ctx);

    assert.strictEqual(combat.pendingWildRole, null, 'pendingWildRole cleared');
    assert.strictEqual(combat.pendingWildTokenIndex, null, 'pendingWildTokenIndex cleared');
    assert.strictEqual(combat.pendingWildCohesionFigureKey, null, 'cohesion figKey cleared');
    assert.strictEqual(combat.pendingWildCohesionOwnerName, null, 'cohesion ownerName cleared');
  });

  it('B-C-PEND2-002: skip path does NOT set any pendingWild fields', async () => {
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Wild'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_skip', 'player1'), ctx);

    assert.strictEqual(combat.pendingWildRole, undefined, 'no pendingWildRole');
    assert.strictEqual(combat.pendingWildTokenIndex, undefined, 'no pendingWildTokenIndex');
  });

  it('B-C-PEND2-003: overflow fully resolved clears pendingPowerTokenOverflow to null', () => {
    const game = makeGame({
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block', 'Surge'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Trooper-1-0', discardCount: 1 }],
    });

    resolveOverflowDiscard(game, 'Trooper-1-0', 2); // discard Surge

    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'null, not empty array');
    assert.strictEqual(game.figurePowerTokens['Trooper-1-0'].length, 2, 'at cap');
  });

  it('B-C-PEND2-004: handlePowerTokenOverflowDiscard clears pendingSurgeOverflow on resume', async () => {
    const combat = makeCombat({ gameId: '99', surgeRemaining: 0 }); // 0 surge → sends resolve, not surge UI
    const game = makeGame({
      gameId: '99',
      pendingCombat: combat,
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block', 'Surge'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Trooper-1-0', discardCount: 1, playerNum: 1, channelId: 'thread1' }],
      pendingSurgeOverflow: { combatThreadId: 'thread1', attackerPlayerNum: 1 },
    });
    const { ctx } = buildCtx(game);

    await handlePowerTokenOverflowDiscard(
      mockInteraction('pt_overflow_99_1_Trooper-1-0_0', 'player1'),
      ctx,
    );

    assert.ok(game.pendingSurgeOverflow == null, 'pendingSurgeOverflow cleared');
    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'overflow cleared');
  });

  it('B-C-PEND2-005: handlePowerTokenChoice clears pendingPowerTokenGrant unconditionally', async () => {
    const combat = makeCombat({ surgeRemaining: 0 });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: {},
      pendingPowerTokenGrant: {
        grants: [{ figureKey: 'Trooper-1-0', figName: 'Trooper', count: 1 }],
        channelId: 'thread1',
        playerNum: 1,
      },
    });
    const { ctx } = buildCtx(game);

    await handlePowerTokenChoice(
      mockInteraction('power_token_choice_g1_damage', 'player1'),
      ctx,
    );

    assert.strictEqual(game.pendingPowerTokenGrant, null, 'grant cleared even with no overflow');
  });

  it('B-C-PEND2-006: tokenPhase nulled by advanceTokenPhase after attacker spend', async () => {
    // No defender tokens → should advance through to proceedAfterTokens
    const combat = makeCombat({ tokenPhase: 'attacker' });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Damage'] },
    });
    const { ctx } = buildCtx(game);

    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1'), ctx);

    // No defender tokens → tokenPhase should be null (advanced past both)
    assert.strictEqual(combat.tokenPhase, null, 'tokenPhase cleared after advance');
  });
});

// ── B-C-COMBINED: Token spending interacting with surge resolution ───────────

describe('B-C-COMBINED: Token spend + surge interaction', () => {
  it('B-C-COMBINED-001: tokenSurgeBonus from Surge token feeds into surge remaining calculation', async () => {
    // This tests the flow: attacker spends Surge token → tokenSurgeBonus set →
    // proceedAfterTokens calculates totalSurge including tokenSurgeBonus
    const combat = makeCombat({
      tokenPhase: 'attacker',
      attackRoll: { acc: 2, dmg: 3, surge: 0 }, // 0 natural surge
      defenseRoll: { block: 1, evade: 0, dodge: false },
    });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Stormtrooper-1-0': ['Surge'] },
    });
    const sharedThread = mockThread();
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1'],
    });

    await handleCombatToken(mockInteraction('combat_token_g1_att_0', 'player1', sharedThread), ctx);

    // tokenSurgeBonus should be 1
    assert.strictEqual(combat.tokenSurgeBonus, 1, 'tokenSurgeBonus set from Surge token');
    // proceedAfterTokens was called (no defender tokens) → surge phase entered
    // The surge UI should show since tokenSurgeBonus gives 1 surge
    assert.ok(sharedThread._sent.some(m => {
      const content = typeof m === 'string' ? m : m?.content || '';
      return content.includes('surge') || content.includes('Surge');
    }), 'surge UI shown because tokenSurgeBonus contributes to totalSurge');
  });

  it('B-C-COMBINED-002: resumeSurgeChoiceOrResolve auto-advances when surgeRemaining is 0', async () => {
    const combat = makeCombat({ surgeRemaining: 0 });
    const game = makeGame({ pendingCombat: combat });
    const thread = mockThread();
    const { ctx, calls } = buildCtx(game);

    await resumeSurgeChoiceOrResolve(game, 'g1', combat, thread, ctx);

    assert.strictEqual(combat.surgeRemaining, 0, 'surgeRemaining stays 0');
    // pre_resolve is now AUTO_ADVANCE — damage applies automatically rather
    // than posting a Ready gate. resolveCombatAfterRolls fires directly.
    assert.ok(calls.resolveCombatAfterRolls.length > 0,
      'resolveCombatAfterRolls fired automatically (no Ready gate)');
  });

  it('B-C-COMBINED-003: resumeSurgeChoiceOrResolve shows surge UI when surgeRemaining > 0', async () => {
    const combat = makeCombat({
      surgeRemaining: 2,
      surgeSpentCount: {},
      attackerDcName: 'Stormtrooper',
      attackerFigureKey: 'Stormtrooper-1-0',
      attackRoll: { acc: 2, dmg: 3, surge: 1 },
    });
    const game = makeGame({ pendingCombat: combat });
    const thread = mockThread();
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1'],
    });

    await resumeSurgeChoiceOrResolve(game, 'g1', combat, thread, ctx);

    assert.ok(thread._sent.some(m => {
      const content = typeof m === 'string' ? m : m?.content || '';
      return content.includes('surge') || content.includes('Surge');
    }), 'surge choice UI shown when surges remain');
  });

  it('B-C-COMBINED-004: full token→overflow→surge resume flow maintains state integrity', async () => {
    // End-to-end: grant tokens during surge → overflow → resolve overflow → resume surge
    const combat = makeCombat({ surgeRemaining: 1 });
    const game = makeGame({
      pendingCombat: combat,
      figurePowerTokens: { 'Trooper-1-0': ['Damage', 'Block'] }, // at cap
    });

    // Step 1: Grant triggers overflow
    grantPowerTokens(game, 'Trooper-1-0', 'Surge', 1);
    assert.ok(game.pendingPowerTokenOverflow, 'overflow created');
    assert.strictEqual(game.figurePowerTokens['Trooper-1-0'].length, 3, 'token granted first');

    // Step 2: Resolve overflow
    const { discarded, remaining } = resolveOverflowDiscard(game, 'Trooper-1-0', 0);
    assert.strictEqual(discarded, 'Damage', 'oldest token discarded');
    assert.strictEqual(remaining, 0, 'overflow resolved');
    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'overflow cleared');
    assert.strictEqual(game.figurePowerTokens['Trooper-1-0'].length, 2, 'back at cap');

    // Step 3: Verify state is clean for surge resume
    assert.strictEqual(combat.surgeRemaining, 1, 'surgeRemaining preserved through overflow');
    assert.strictEqual(game.pendingSurgeOverflow, undefined, 'no orphan pendingSurgeOverflow');
  });
});
