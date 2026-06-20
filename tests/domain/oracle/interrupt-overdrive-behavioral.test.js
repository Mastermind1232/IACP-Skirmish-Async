/**
 * BEHAVIORAL oracle tests for interrupts.js Phase 3: Overdrive
 *
 * Covers self-damage, action-count manipulation, self-defeat, guard behavior,
 * and DG-index figureKey construction.
 *
 * Test categories:
 *   B-I-OD-001: Normal use grants +1 action when remaining=0, applies 1 damage
 *   B-I-OD-002: Action math with remaining > 0 increments correctly
 *   B-I-OD-003: Action cap: remaining cannot exceed total+1
 *   B-I-OD-004: Self-defeat calls processFigureDefeat with correct args
 *   B-I-OD-005: No defeat when HP stays above 0
 *   B-I-OD-006: overdriveUsedThisActivation guard key matches DG-index pattern
 *   B-I-OD-007: No dcActionsData → handler returns early (stale context guard)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleOverdrive } from '../../../src/handlers/interrupts.js';

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  return {
    customId,
    user: { id: userId },
    followUp: async (msg) => { followUpCalls.push(msg); return {}; },
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: { content: '', edit: async () => ({}) },
    client: {
      channels: {
        fetch: async () => ({
          messages: { fetch: async () => ({ edit: async () => ({}) }) },
        }),
      },
    },
    channelId: 'thread1',
    _followUpCalls: followUpCalls,
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42',
    player1Id: 'player1',
    player2Id: 'player2',
    figurePowerTokens: {},
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    p1PlayAreaId: 'pa1',
    p2PlayAreaId: 'pa2',
    ...overrides,
  };
}

/**
 * Build ctx for Overdrive handler.
 * Uses real reduceHp (module-level import in interrupts.js) so dcHealthState
 * must be a real Map with valid structure.
 */
function buildCtx(game, dcHealthState, ctxOverrides = {}) {
  const calls = {
    saveGames: [],
    logGameAction: [],
    processFigureDefeat: [],
    updateDcActionsMessage: [],
  };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      canActAsPlayer: (g, userId, pn) => {
        if (pn === 1) return userId === g.player1Id;
        if (pn === 2) return userId === g.player2Id;
        return false;
      },
      saveGames: () => { calls.saveGames.push(true); },
      client: {
        channels: {
          fetch: async () => ({
            messages: { fetch: async () => ({ edit: async () => ({}) }) },
          }),
        },
      },
      dcMessageMeta: new Map([
        ['3001', { dcName: 'BT-1', displayName: 'BT-1 [DG 1]', playerNum: 1, gameId: '42' }],
      ]),
      dcHealthState,
      DC_ACTIONS_PER_ACTIVATION: 2,
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      updateDcActionsMessage: async (...args) => { calls.updateDcActionsMessage.push(args); },
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      processFigureDefeat: async (g, opts) => { calls.processFigureDefeat.push(opts); },
      ...ctxOverrides,
    },
    calls,
  };
}

// ── B-I-OD: Overdrive ───────────────────────────────────────────────────────

describe('B-I-OD: Overdrive', () => {

  it('B-I-OD-001: grants +1 action when remaining=0 and applies 2 self-damage', async () => {
    const dcHealthState = new Map([['3001', [[5, 6]]]]);
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 0, total: 2 } },
    });

    const { ctx, calls } = buildCtx(game, dcHealthState);
    const interaction = mockInteraction('overdrive_use_3001', 'player1');

    await handleOverdrive(interaction, ctx);

    // Action: remaining should go from 0 → 1
    assert.strictEqual(game.dcActionsData['3001'].remaining, 1, 'remaining = 1 after Overdrive from 0');

    // Self-damage: HP 5 → 3 (2 Damage)
    const hp = dcHealthState.get('3001')[0];
    assert.strictEqual(hp[0], 3, 'HP reduced by 2 (5→3)');
    assert.strictEqual(hp[1], 6, 'maxHp unchanged');

    // No defeat (HP > 0)
    assert.strictEqual(calls.processFigureDefeat.length, 0, 'no defeat');

    // saveGames called
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('B-I-OD-002: increments remaining correctly when actions remain', async () => {
    const dcHealthState = new Map([['3001', [[5, 6]]]]);
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 1, total: 2 } },
    });

    const { ctx } = buildCtx(game, dcHealthState);
    await handleOverdrive(mockInteraction('overdrive_use_3001', 'player1'), ctx);

    // remaining: min(2+1, 1+1) = min(3, 2) = 2
    assert.strictEqual(game.dcActionsData['3001'].remaining, 2, 'remaining = 2 after Overdrive from 1');
  });

  it('B-I-OD-003: remaining capped at total+1 (cannot exceed budget)', async () => {
    const dcHealthState = new Map([['3001', [[5, 6]]]]);
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
    });

    const { ctx } = buildCtx(game, dcHealthState);
    await handleOverdrive(mockInteraction('overdrive_use_3001', 'player1'), ctx);

    // remaining: min(2+1, 2+1) = min(3, 3) = 3 (capped at total+1)
    assert.strictEqual(game.dcActionsData['3001'].remaining, 3, 'remaining = 3 (total+1 cap)');
    // total unchanged
    assert.strictEqual(game.dcActionsData['3001'].total, 2, 'total unchanged');
  });

  it('B-I-OD-004: self-defeat calls processFigureDefeat with correct args', async () => {
    // HP=1 → after 1 damage → 0 → defeated
    const dcHealthState = new Map([['3001', [[1, 6]]]]);
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 0, total: 2 } },
    });

    const { ctx, calls } = buildCtx(game, dcHealthState);
    await handleOverdrive(mockInteraction('overdrive_use_3001', 'player1'), ctx);

    // HP should be 0
    assert.strictEqual(dcHealthState.get('3001')[0][0], 0, 'HP = 0');

    // processFigureDefeat called
    assert.strictEqual(calls.processFigureDefeat.length, 1, 'processFigureDefeat called once');
    const defeatArgs = calls.processFigureDefeat[0];
    assert.strictEqual(defeatArgs.defeatedPlayerNum, 1, 'defeated player = DC owner');
    assert.strictEqual(defeatArgs.figureKey, 'BT-1-1-0', 'figureKey = dcName-dgIdx-0');
    assert.strictEqual(defeatArgs.attackerPlayerNum, 2, 'opponent gets kill credit');
    assert.strictEqual(defeatArgs.source, 'Overdrive', 'source = Overdrive');

    // Action still granted (before defeat check)
    assert.strictEqual(game.dcActionsData['3001'].remaining, 1, 'action still granted despite defeat');
  });

  it('B-I-OD-005: no defeat when HP stays above 0', async () => {
    const dcHealthState = new Map([['3001', [[3, 6]]]]);
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 0, total: 2 } },
    });

    const { ctx, calls } = buildCtx(game, dcHealthState);
    await handleOverdrive(mockInteraction('overdrive_use_3001', 'player1'), ctx);

    assert.strictEqual(dcHealthState.get('3001')[0][0], 1, 'HP = 1 (3-2)');
    assert.strictEqual(calls.processFigureDefeat.length, 0, 'no defeat call');
  });

  it('B-I-OD-006: overdriveUsedThisActivation key matches DG-index pattern from displayName', async () => {
    // Test with DG 2 to verify non-default parsing
    const dcHealthState = new Map([['3002', [[5, 6]]]]);
    const game = makeGame({
      dcActionsData: { '3002': { remaining: 0, total: 2 } },
    });

    const { ctx, calls } = buildCtx(game, dcHealthState, {
      dcMessageMeta: new Map([
        ['3002', { dcName: 'Probe Droid', displayName: 'Probe Droid [DG 2]', playerNum: 1, gameId: '42' }],
      ]),
    });

    await handleOverdrive(mockInteraction('overdrive_use_3002', 'player1'), ctx);

    // Guard key should use DG 2 from displayName, not default 1
    assert.strictEqual(game.overdriveUsedThisActivation?.['Probe Droid-2-0'], true,
      'guard key = Probe Droid-2-0 (DG 2 from displayName)');
    assert.strictEqual(game.overdriveUsedThisActivation?.['Probe Droid-1-0'], undefined,
      'DG 1 key NOT set (would indicate wrong parsing)');

    // Also test default fallback: displayName without DG suffix
    const dcHealthState2 = new Map([['3003', [[5, 6]]]]);
    const game2 = makeGame({
      dcActionsData: { '3003': { remaining: 0, total: 2 } },
    });
    const { ctx: ctx2 } = buildCtx(game2, dcHealthState2, {
      dcMessageMeta: new Map([
        ['3003', { dcName: 'IG-88', displayName: 'IG-88', playerNum: 1, gameId: '42' }],
      ]),
    });
    await handleOverdrive(mockInteraction('overdrive_use_3003', 'player1'), ctx2);

    assert.strictEqual(game2.overdriveUsedThisActivation?.['IG-88-1-0'], true,
      'unique DC defaults to DG 1');
  });

  it('B-I-OD-007: no dcActionsData returns early without crash', async () => {
    const dcHealthState = new Map([['3001', [[5, 6]]]]);
    const game = makeGame({}); // no dcActionsData at all

    const { ctx, calls } = buildCtx(game, dcHealthState);
    const interaction = mockInteraction('overdrive_use_3001', 'player1');

    await handleOverdrive(interaction, ctx);

    // Should return early with ephemeral message
    const msg = interaction._followUpCalls.find(m => m.ephemeral && m.content?.includes('No active activation'));
    assert.ok(msg, 'ephemeral no-activation message sent');

    // No state changes
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
    assert.strictEqual(calls.processFigureDefeat.length, 0, 'no defeat');

    // HP should be unchanged (reduceHp never called)
    assert.strictEqual(dcHealthState.get('3001')[0][0], 5, 'HP unchanged');
  });
});
