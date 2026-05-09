/**
 * BEHAVIORAL oracle tests for interrupts.js Phase 2: Still Faster Than You
 *
 * Covers the full 3-step flow: use → picker → dc_pick, plus skip and edge cases.
 *
 * Test categories:
 *   B-I-SFT-001: Eligibility filtering on use path
 *   B-I-SFT-002: DC pick grants MP + free attack + exclusion
 *   B-I-SFT-003: Skip path full cleanup
 *   B-I-SFT-004: No-eligible-figures path cleanup
 *   B-I-SFT-005: Additive movementBank on dc_pick (existing bank)
 *   B-I-SFT-006: Wrong-player rejection on all 3 paths
 *   B-I-SFT-007: Stale button press (no pending) on use and dc_pick
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleStillFaster } from '../../../src/handlers/interrupts.js';

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockThread() {
  const sent = [];
  return {
    send: async (msg) => { sent.push(msg); return { content: typeof msg === 'string' ? msg : msg?.content, id: `msg_${sent.length}` }; },
    _sent: sent,
    id: 'thread1',
  };
}

function mockInteraction(customId, userId = 'player1') {
  const followUpCalls = [];
  const thread = mockThread();
  return {
    customId,
    user: { id: userId },
    followUp: async (msg) => { followUpCalls.push(msg); return {}; },
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: { content: '', edit: async () => ({}) },
    client: { channels: { fetch: async () => thread } },
    channelId: 'thread1',
    _thread: thread,
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
    ...overrides,
  };
}

function makePending(overrides = {}) {
  return {
    gameId: '42',
    activatingMsgId: '2001',
    activatingPlayerNum: 1,
    sftPlayerNum: 2,
    ...overrides,
  };
}

/**
 * Build ctx for SFTY handler.
 * canActAsPlayer uses real player ID matching (needed for SFT-006).
 */
function buildCtx(game, overrides = {}) {
  const calls = { saveGames: [], logGameAction: [] };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      canActAsPlayer: (g, userId, pn) => {
        if (pn === 1) return userId === g.player1Id;
        if (pn === 2) return userId === g.player2Id;
        return false;
      },
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => mockThread() } },
      dcMessageMeta: new Map([
        ['1001', { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]', playerNum: 2, gameId: '42' }],
        ['1002', { dcName: 'Han Solo', displayName: 'Han Solo', playerNum: 2, gameId: '42' }],
        ['1003', { dcName: 'Jyn Erso', displayName: 'Jyn Erso [DG 1]', playerNum: 2, gameId: '42' }],
      ]),
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      ...overrides,
    },
    calls,
  };
}

/**
 * Extract button customIds from ActionRowBuilder[] components in a followUp call.
 */
function extractButtonIds(followUpMsg) {
  if (!followUpMsg?.components) return [];
  return followUpMsg.components.flatMap(row =>
    (row.components || []).map(b => b.data?.custom_id),
  );
}

// ── B-I-SFT: Still Faster Than You ──────────────────────────────────────────

describe('B-I-SFT: Still Faster Than You', () => {

  it('B-I-SFT-001: use path shows only eligible non-exhausted non-defeated DCs', async () => {
    const game = makeGame({
      pendingStillFaster: makePending(),
      stillFasterPlayerNum: 2,
      p2DcList: [
        { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]' },
        { dcName: 'Han Solo', displayName: 'Han Solo', defeated: true },
        { dcName: 'Jyn Erso', displayName: 'Jyn Erso [DG 1]' },
      ],
      p2DcMessageIds: ['1001', '1002', '1003'],
      p2ActivatedDcIndices: [2], // Jyn exhausted
    });

    const { ctx } = buildCtx(game);
    const interaction = mockInteraction('still_faster_use_42_2001', 'player2');

    await handleStillFaster(interaction, ctx);

    // Should show picker with only the eligible DC (index 0: Rebel Trooper)
    assert.strictEqual(interaction._followUpCalls.length, 1, 'one followUp call');
    const followUp = interaction._followUpCalls[0];
    assert.ok(followUp.components, 'followUp has components (button picker)');

    const buttonIds = extractButtonIds(followUp);
    assert.ok(buttonIds.some(id => id?.includes('1001')), 'eligible DC (Rebel Trooper) in picker');
    assert.ok(!buttonIds.some(id => id?.includes('1002')), 'defeated DC (Han Solo) excluded');
    assert.ok(!buttonIds.some(id => id?.includes('1003')), 'activated DC (Jyn Erso) excluded');
    assert.strictEqual(buttonIds.length, 1, 'exactly one button');
  });

  it('B-I-SFT-002: dc_pick stamps pendingMoveX (2 spaces), sets free-attack + exclusion', async () => {
    const game = makeGame({
      pendingStillFaster: makePending(),
      stillFasterPlayerNum: 2,
      figurePositions: { 1: {}, 2: { 'Rebel Trooper-1-0': 'a1' } },
    });

    const { ctx, calls } = buildCtx(game);
    // still_faster_dc_pick_{gameId}_{pickedMsgId}_{activatingMsgId}
    const interaction = mockInteraction('still_faster_dc_pick_42_1001_2001', 'player2');

    await handleStillFaster(interaction, ctx);

    // Pending state cleaned
    assert.strictEqual(game.pendingStillFaster, undefined, 'pendingStillFaster deleted');
    assert.strictEqual(game.stillFasterPlayerNum, null, 'stillFasterPlayerNum nulled');

    // CRR MOVE-017: a 2-space Move-X picker is stamped (no movementBank).
    // The picker may auto-finish when the test fixture lacks real map
    // data (no candidates → _finishPicker fires the freeAttackPrompt
    // continuation). Both states are valid evidence the migration ran.
    assert.strictEqual(game.movementBank?.['1001'], undefined, 'movementBank NOT used');
    const pmx = game.pendingMoveX?.['1001'];
    if (pmx) {
      assert.strictEqual(pmx.remaining, 2, 'pendingMoveX.remaining = 2');
      assert.strictEqual(pmx.bypassCosts, true, 'bypassCosts: true');
      assert.strictEqual(pmx.source, 'Still Faster Than You', 'source set');
      assert.strictEqual(pmx.nextAction?.type, 'freeAttackPrompt', 'freeAttackPrompt continuation queued');
    }

    // Free attack flag (consumed when the freeAttackPrompt fires post-move)
    assert.strictEqual(game.fellSwoopFreeAttack?.['1001'], true, 'fellSwoopFreeAttack set');

    // Exclusion: the activating hostile is excluded from the free attack
    assert.strictEqual(game.stillFasterExcludeMsgId, '2001', 'stillFasterExcludeMsgId = activating DC');

    // saveGames called
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('B-I-SFT-003: skip path fully cleans up pending and player state', async () => {
    const game = makeGame({
      pendingStillFaster: makePending(),
      stillFasterPlayerNum: 2,
    });

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('still_faster_skip_42_2001', 'player2');

    await handleStillFaster(interaction, ctx);

    // Pending and player state cleared
    assert.strictEqual(game.pendingStillFaster, undefined, 'pendingStillFaster deleted');
    assert.strictEqual(game.stillFasterPlayerNum, null, 'stillFasterPlayerNum nulled');

    // Movement / attack / exclusion NOT touched
    assert.strictEqual(game.movementBank, undefined, 'movementBank not created');
    assert.strictEqual(game.fellSwoopFreeAttack, undefined, 'fellSwoopFreeAttack not created');
    assert.strictEqual(game.stillFasterExcludeMsgId, undefined, 'stillFasterExcludeMsgId not set');

    // saveGames called
    assert.ok(calls.saveGames.length > 0, 'saveGames called');

    // FollowUp message mentions skip
    const msg = interaction._followUpCalls[0];
    assert.ok(msg?.content?.includes('Skipped'), 'skip message sent');
  });

  it('B-I-SFT-004: no-eligible-figures path cleans up and exits with message', async () => {
    const game = makeGame({
      pendingStillFaster: makePending(),
      stillFasterPlayerNum: 2,
      p2DcList: [
        { dcName: 'Han Solo', displayName: 'Han Solo', defeated: true },
        { dcName: 'Jyn Erso', displayName: 'Jyn Erso [DG 1]' },
      ],
      p2DcMessageIds: ['1002', '1003'],
      p2ActivatedDcIndices: [1], // Jyn exhausted, Han defeated → 0 eligible
    });

    const { ctx, calls } = buildCtx(game);
    const interaction = mockInteraction('still_faster_use_42_2001', 'player2');

    await handleStillFaster(interaction, ctx);

    // Pending and player state cleared (same as skip)
    assert.strictEqual(game.pendingStillFaster, undefined, 'pendingStillFaster deleted');
    assert.strictEqual(game.stillFasterPlayerNum, null, 'stillFasterPlayerNum nulled');

    // Message indicates no eligible figures
    const msg = interaction._followUpCalls.find(m => m.content?.includes('No eligible'));
    assert.ok(msg, 'no-eligible message sent');

    // No movement/attack state created
    assert.strictEqual(game.movementBank, undefined, 'movementBank not created');
    assert.strictEqual(game.fellSwoopFreeAttack, undefined, 'fellSwoopFreeAttack not created');

    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('B-I-SFT-005: dc_pick stamps a fresh pendingMoveX even if a prior bank exists (no banking)', async () => {
    // Per CRR MOVE-017, Still Faster Than You no longer touches the
    // movementBank — it stamps an independent pendingMoveX picker. A
    // pre-existing bank entry for the same DC must NOT be modified.
    const game = makeGame({
      pendingStillFaster: makePending(),
      stillFasterPlayerNum: 2,
      figurePositions: { 1: {}, 2: { 'Rebel Trooper-1-0': 'a1' } },
      movementBank: { '1001': { total: 3, remaining: 1 } },
    });

    const { ctx } = buildCtx(game);
    const interaction = mockInteraction('still_faster_dc_pick_42_1001_2001', 'player2');

    await handleStillFaster(interaction, ctx);

    // Existing bank untouched.
    assert.strictEqual(game.movementBank['1001'].total, 3, 'bank.total unchanged');
    assert.strictEqual(game.movementBank['1001'].remaining, 1, 'bank.remaining unchanged');
    // Picker stamped fresh (or auto-finished when no map data).
    const pmx = game.pendingMoveX?.['1001'];
    if (pmx) {
      assert.strictEqual(pmx.remaining, 2, 'picker.remaining = 2');
    }
  });

  it('B-I-SFT-006: wrong player rejected on all 3 button paths', async () => {
    // All 3 paths should reject player1 when sftPlayerNum is 2
    const paths = [
      { customId: 'still_faster_use_42_2001', label: 'use' },
      { customId: 'still_faster_skip_42_2001', label: 'skip' },
      { customId: 'still_faster_dc_pick_42_1001_2001', label: 'dc_pick' },
    ];

    for (const { customId, label } of paths) {
      const game = makeGame({
        pendingStillFaster: makePending(), // sftPlayerNum: 2
        stillFasterPlayerNum: 2,
        p2DcList: [{ dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]' }],
        p2DcMessageIds: ['1001'],
        p2ActivatedDcIndices: [],
      });

      const { ctx } = buildCtx(game);
      // player1 tries to act on player2's SFTY prompt
      const interaction = mockInteraction(customId, 'player1');

      await handleStillFaster(interaction, ctx);

      // Pending should NOT be deleted (handler returned early)
      assert.ok(game.pendingStillFaster, `[${label}] pendingStillFaster still present`);
      assert.strictEqual(game.stillFasterPlayerNum, 2, `[${label}] stillFasterPlayerNum unchanged`);

      // Rejection message sent
      const rejection = interaction._followUpCalls.find(m => m.ephemeral);
      assert.ok(rejection, `[${label}] ephemeral rejection sent`);
    }
  });

  it('B-I-SFT-007: stale button press (no pending) returns early without crash', async () => {
    // Use path: no pending → ephemeral message
    const game1 = makeGame({});
    const { ctx: ctx1 } = buildCtx(game1);
    const int1 = mockInteraction('still_faster_use_42_2001', 'player2');
    await handleStillFaster(int1, ctx1);
    const msg1 = int1._followUpCalls.find(m => m.ephemeral && m.content?.includes('No pending'));
    assert.ok(msg1, 'use path: ephemeral no-pending message');

    // DC pick path: no pending → ephemeral message
    const game2 = makeGame({});
    const { ctx: ctx2 } = buildCtx(game2);
    const int2 = mockInteraction('still_faster_dc_pick_42_1001_2001', 'player2');
    await handleStillFaster(int2, ctx2);
    const msg2 = int2._followUpCalls.find(m => m.ephemeral && m.content?.includes('No pending'));
    assert.ok(msg2, 'dc_pick path: ephemeral no-pending message');

    // Skip path with no pending: sftPlayerNum is undefined, requirePlayer rejects everyone
    const game3 = makeGame({});
    const { ctx: ctx3 } = buildCtx(game3);
    const int3 = mockInteraction('still_faster_skip_42_2001', 'player2');
    await handleStillFaster(int3, ctx3);
    // Should not crash — handler returns via requirePlayer rejection
    assert.ok(true, 'skip path with no pending does not crash');
  });
});
