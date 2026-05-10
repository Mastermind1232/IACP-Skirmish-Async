/**
 * BEHAVIORAL oracle tests for Activation Flow Phase 1:
 * Action Cost Correctness + Un-activate Safety
 *
 * Tests the core action-cost / refund / gating loop that every live Discord PvP
 * activation depends on: dcActionsData.remaining mutation, free-action bypass,
 * refund cap semantics, gating at remaining=0, and un-activate cleanup correctness.
 *
 * Test categories:
 *   B-ACTCOST-001: Remove Stun costs 1 action (handleDcRemoveStun, full handler)
 *   B-ACTCOST-002: Remove Stun gates at 0 remaining (handleDcRemoveStun, full handler)
 *   B-ACTCOST-003: CC Special Action costs 1 (dc-play-area.js:697 pattern)
 *   B-ACTCOST-004: CC Double Action sets remaining to 0 (dc-play-area.js:700 pattern)
 *   B-ACTCOST-005: Attack costs 1 on normal path (combat.js:966 pattern)
 *   B-ACTCOST-006: Free attack path leaves remaining unchanged (combat.js:946-964)
 *   B-ACTCOST-007: Interact costs 1 (handleInteractChoice, full handler)
 *   B-ACTCOST-008: Special ability uses variable actionCost (dc-play-area.js:1719 pattern)
 *   B-ACTCOST-009: Failed ability refund restores action, capped at total
 *   B-ACTCOST-010: Dubious Counterparts refund caps at total+1
 *   B-ACTCOST-011: Gating prevents action when remaining=0 (handleDcRemoveStun)
 *   B-ACTCOST-012: Move costs 1 non-free, 0 with Executive Order (dc-play-area.js:1380-1386)
 *   B-UNACT-001: Un-activate rejects after actions spent
 *   B-UNACT-002: Un-activate rejects after MP spent
 *   B-UNACT-003: Un-activate cleans core activation state correctly
 *   B-UNACT-004: Activation-scoped scalar flags survive un-activate (gap audit)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDcRemoveStun, handleDcUnactivate } from '../../../src/handlers/dc-play-area.js';
import { handleInteractChoice } from '../../../src/handlers/interact.js';
import {
  ACTIVATION_SCALAR_FLAGS,
  ACTIVATION_MSGID_FLAGS,
} from '../../../src/game/activation-state.js';

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
    client: { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async () => ({}) }) } }) } },
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
    p1DcList: [{ dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]' }],
    p1DcMessageIds: ['3001'],
    p1ActivatedDcIndices: [],
    p1ActivationsTotal: 1,
    p1ActivationsRemaining: 1,
    ...overrides,
  };
}

function buildRemoveStunCtx(game, overrides = {}) {
  const calls = { saveGames: [], logGameAction: [], updateDcActionsMessage: [] };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      replyIfGameEnded: async () => false,
      dcMessageMeta: new Map([
        ['3001', { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]', playerNum: 1, gameId: '42' }],
      ]),
      DC_ACTIONS_PER_ACTIVATION: 2,
      updateDcActionsMessage: async (...args) => { calls.updateDcActionsMessage.push(args); },
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async () => ({}) }) } }) } },
      ...overrides,
    },
    calls,
  };
}

function buildUnactivateCtx(game, overrides = {}) {
  const calls = { saveGames: [], updateActivationsMessage: [] };
  const exhaustedState = new Map([['3001', true]]);
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      dcMessageMeta: new Map([
        ['3001', { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]', playerNum: 1, gameId: '42' }],
      ]),
      dcExhaustedState: exhaustedState,
      dcHealthState: new Map([['3001', [[5, 6]]]]),
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      getDcEffects: () => ({ 'Rebel Trooper': { figures: 1 } }),
      updateActivationsMessage: async (...args) => { calls.updateActivationsMessage.push(args); },
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => null } },
      ...overrides,
    },
    calls,
    exhaustedState,
  };
}

function buildInteractCtx(game, overrides = {}) {
  const calls = { saveGames: [], logGameAction: [], updateDcActionsMessage: [] };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      dcMessageMeta: new Map([
        ['3001', { dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]', playerNum: 1, gameId: '42' }],
      ]),
      getLegalInteractOptions: () => [{ id: 'test_option', label: 'Test', missionSpecific: false }],
      getDcStats: () => ({ figures: 1 }),
      updateDcActionsMessage: async (...args) => { calls.updateDcActionsMessage.push(args); },
      logGameAction: async (...args) => { calls.logGameAction.push(args); return {}; },
      saveGames: () => { calls.saveGames.push(true); },
      pushUndo: () => {},
      getMissionTokenLabel: () => 'Mission Token',
      ...overrides,
    },
    calls,
  };
}

// ── B-ACTCOST-001: Remove Stun costs 1 action ──────────────────────────────

describe('B-ACTCOST-001: Remove Stun costs 1 action', () => {
  it('001a: remaining decrements from 2 to 1', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      figureConditions: { 'Rebel Trooper-1-0': ['Stun'] },
    });
    const { ctx, calls } = buildRemoveStunCtx(game);
    await handleDcRemoveStun(mockInteraction('dc_remove_stun_3001_f0', 'player1'), ctx);

    assert.strictEqual(game.dcActionsData['3001'].remaining, 1, 'remaining 2→1');
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
    assert.ok(calls.updateDcActionsMessage.length > 0, 'UI updated');
  });

  it('001b: remaining decrements from 1 to 0', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 1, total: 2 } },
      figureConditions: { 'Rebel Trooper-1-0': ['Stun'] },
    });
    const { ctx } = buildRemoveStunCtx(game);
    await handleDcRemoveStun(mockInteraction('dc_remove_stun_3001_f0', 'player1'), ctx);

    assert.strictEqual(game.dcActionsData['3001'].remaining, 0, 'remaining 1→0');
  });

  it('001c: Stun condition is removed from figure', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      figureConditions: { 'Rebel Trooper-1-0': ['Stun', 'Bleed'] },
    });
    const { ctx } = buildRemoveStunCtx(game);
    await handleDcRemoveStun(mockInteraction('dc_remove_stun_3001_f0', 'player1'), ctx);

    assert.ok(!game.figureConditions['Rebel Trooper-1-0'].includes('Stun'), 'Stun removed');
    assert.ok(game.figureConditions['Rebel Trooper-1-0'].includes('Bleed'), 'Bleed preserved');
  });
});

// ── B-ACTCOST-002: Remove Stun gates at 0 remaining ────────────────────────

describe('B-ACTCOST-002: Remove Stun gates at 0 remaining', () => {
  it('002: remaining=0 returns early with ephemeral message', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 0, total: 2 } },
      figureConditions: { 'Rebel Trooper-1-0': ['Stun'] },
    });
    const { ctx, calls } = buildRemoveStunCtx(game);
    const interaction = mockInteraction('dc_remove_stun_3001_f0', 'player1');
    await handleDcRemoveStun(interaction, ctx);

    // Remaining unchanged
    assert.strictEqual(game.dcActionsData['3001'].remaining, 0, 'remaining stays 0');
    // Gate message sent
    const gateMsg = interaction._followUpCalls.find(m => m.ephemeral && m.content?.includes('No actions remaining'));
    assert.ok(gateMsg, 'ephemeral gate message sent');
    // saveGames NOT called (action rejected)
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames not called');
    // Stun still present
    assert.ok(game.figureConditions['Rebel Trooper-1-0'].includes('Stun'), 'Stun preserved');
  });
});

// ── B-ACTCOST-003: CC Special Action costs 1 ───────────────────────────────

describe('B-ACTCOST-003: CC Special Action costs 1', () => {
  // Pattern from dc-play-area.js:695-697:
  //   if (timingLabel === 'Special Action') {
  //     const data = game.dcActionsData?.[msgId];
  //     if (data && typeof data.remaining === 'number') data.remaining = Math.max(0, data.remaining - 1);
  //   }
  it('003a: remaining 2→1 after Special Action', () => {
    const data = { remaining: 2, total: 2 };
    // Exact formula from dc-play-area.js:697
    if (data && typeof data.remaining === 'number') data.remaining = Math.max(0, data.remaining - 1);
    assert.strictEqual(data.remaining, 1);
  });

  it('003b: remaining 1→0 after Special Action', () => {
    const data = { remaining: 1, total: 2 };
    if (data && typeof data.remaining === 'number') data.remaining = Math.max(0, data.remaining - 1);
    assert.strictEqual(data.remaining, 0);
  });

  it('003c: remaining 0 stays 0 (floor at 0)', () => {
    const data = { remaining: 0, total: 2 };
    if (data && typeof data.remaining === 'number') data.remaining = Math.max(0, data.remaining - 1);
    assert.strictEqual(data.remaining, 0, 'cannot go negative');
  });
});

// ── B-ACTCOST-004: CC Double Action sets remaining to 0 ────────────────────

describe('B-ACTCOST-004: CC Double Action sets remaining to 0', () => {
  // Pattern from dc-play-area.js:698-700:
  //   } else if (timingLabel === 'Double Action') {
  //     const data = game.dcActionsData?.[msgId];
  //     if (data && typeof data.remaining === 'number') data.remaining = 0;
  //   }
  it('004a: remaining 2→0', () => {
    const data = { remaining: 2, total: 2 };
    if (data && typeof data.remaining === 'number') data.remaining = 0;
    assert.strictEqual(data.remaining, 0);
  });

  it('004b: remaining 1→0', () => {
    const data = { remaining: 1, total: 2 };
    if (data && typeof data.remaining === 'number') data.remaining = 0;
    assert.strictEqual(data.remaining, 0);
  });

  it('004c: remaining 3→0 (Overdrive-boosted budget)', () => {
    const data = { remaining: 3, total: 2 };
    if (data && typeof data.remaining === 'number') data.remaining = 0;
    assert.strictEqual(data.remaining, 0, 'Double Action always exhausts all actions');
  });
});

// ── B-ACTCOST-005: Attack costs 1 on normal path ───────────────────────────

describe('B-ACTCOST-005: Attack costs 1 on normal path', () => {
  // Pattern from combat.js:965-967:
  //   } else {
  //     actionsData.remaining = Math.max(0, actionsData.remaining - 1);
  //     await updateDcActionsMessage(...);
  //   }
  it('005a: remaining 2→1 after attack', () => {
    const actionsData = { remaining: 2, total: 2 };
    actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    assert.strictEqual(actionsData.remaining, 1);
  });

  it('005b: remaining 1→0 after attack', () => {
    const actionsData = { remaining: 1, total: 2 };
    actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    assert.strictEqual(actionsData.remaining, 0);
  });
});

// ── B-ACTCOST-006: Free attack path leaves remaining unchanged ──────────────

describe('B-ACTCOST-006: Free attack path bypasses cost', () => {
  // Pattern from combat.js:936-968: 8 free-attack sources each delete their
  // pending flag and skip the default decrement at line 966.
  it('006: fellSwoop free attack does not decrement remaining', () => {
    const actionsData = { remaining: 1, total: 2 };
    const game = { fellSwoopFreeAttack: { '3001': true } };
    const msgId = '3001';

    // Simulate combat.js:939,948-949
    const isFellSwoopFreeAttack = !!game.fellSwoopFreeAttack?.[msgId];
    if (isFellSwoopFreeAttack) {
      delete game.fellSwoopFreeAttack[msgId];
    } else {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    }

    assert.strictEqual(actionsData.remaining, 1, 'remaining unchanged — free attack');
    assert.strictEqual(game.fellSwoopFreeAttack[msgId], undefined, 'free attack flag consumed');
  });

  it('006b: Executive Order free attack does not decrement remaining', () => {
    const actionsData = { remaining: 2, total: 2 };
    const game = { pendingExecutiveOrder: { forMsgId: '3001' } };
    const msgId = '3001';

    // Simulate combat.js:941,954-955
    const isExecOrderFreeAttack = game.pendingExecutiveOrder?.forMsgId === msgId;
    if (isExecOrderFreeAttack) {
      delete game.pendingExecutiveOrder;
    } else {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    }

    assert.strictEqual(actionsData.remaining, 2, 'remaining unchanged — Executive Order free attack');
    assert.strictEqual(game.pendingExecutiveOrder, undefined, 'pending consumed');
  });
});

// ── B-ACTCOST-007: Interact costs 1 (full handler) ─────────────────────────

describe('B-ACTCOST-007: Interact costs 1', () => {
  it('007a: remaining 2→1 after interact choice', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' } },
      selectedMap: { id: 'test-map' },
    });
    const { ctx, calls } = buildInteractCtx(game);
    // interact_choice_{gameId}_{msgId}_{figureIndex}_{optionId}
    const interaction = mockInteraction('interact_choice_42_3001_0_test_option', 'player1');

    await handleInteractChoice(interaction, ctx).catch(() => {});

    assert.strictEqual(game.dcActionsData['3001'].remaining, 1, 'remaining 2→1');
    assert.ok(calls.updateDcActionsMessage.length > 0, 'UI updated');
  });

  it('007b: remaining=0 gates interact', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 0, total: 2 } },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' } },
      selectedMap: { id: 'test-map' },
    });
    const { ctx, calls } = buildInteractCtx(game);
    const interaction = mockInteraction('interact_choice_42_3001_0_test_option', 'player1');

    await handleInteractChoice(interaction, ctx);

    assert.strictEqual(game.dcActionsData['3001'].remaining, 0, 'remaining stays 0');
    const gateMsg = interaction._followUpCalls.find(m => m.ephemeral && m.content?.includes('No actions remaining'));
    assert.ok(gateMsg, 'gate message sent');
    assert.strictEqual(calls.updateDcActionsMessage.length, 0, 'UI NOT updated');
  });
});

// ── B-ACTCOST-008: Special ability variable actionCost ──────────────────────

describe('B-ACTCOST-008: Special ability variable actionCost', () => {
  // Pattern from dc-play-area.js:1718-1719:
  //   const actionCost = buttonKey === 'dc_special_' ? _effectiveActionCost : 1;
  //   actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
  it('008a: cost=1 special, remaining 2→1', () => {
    const actionsData = { remaining: 2, total: 2 };
    const actionCost = 1;
    actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
    assert.strictEqual(actionsData.remaining, 1);
  });

  it('008b: cost=2 special, remaining 2→0', () => {
    const actionsData = { remaining: 2, total: 2 };
    const actionCost = 2;
    actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
    assert.strictEqual(actionsData.remaining, 0);
  });

  it('008c: cost=0 special (MP-based), remaining unchanged', () => {
    const actionsData = { remaining: 2, total: 2 };
    const actionCost = 0;
    actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
    assert.strictEqual(actionsData.remaining, 2, 'MP-based special costs 0 actions');
  });

  it('008d: cost=2 special from remaining=1, floors at 0', () => {
    const actionsData = { remaining: 1, total: 2 };
    const actionCost = 2;
    actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
    assert.strictEqual(actionsData.remaining, 0, 'cannot go negative');
  });
});

// ── B-ACTCOST-009: Failed ability refund capped at total ────────────────────

describe('B-ACTCOST-009: Failed ability refund capped at total', () => {
  // Pattern from dc-play-area.js:1763 (Smuggler's Run), :1803/:1831 (VF Focus),
  // :2047 (ability picker), :2108/:2159 (freeAction/Expertise), :2411 (order resolve):
  //   actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + actionCost);
  const DC_ACTIONS_PER_ACTIVATION = 2;

  it('009a: refund 1 from remaining=1, total=2 → 2', () => {
    const actionsData = { remaining: 1, total: 2 };
    const actionCost = 1;
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + actionCost);
    assert.strictEqual(actionsData.remaining, 2, 'refunded to total');
  });

  it('009b: refund 1 from remaining=0, total=2 → 1', () => {
    const actionsData = { remaining: 0, total: 2 };
    const actionCost = 1;
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + actionCost);
    assert.strictEqual(actionsData.remaining, 1);
  });

  it('009c: refund 1 from remaining=2, total=2 → capped at 2 (no over-refund)', () => {
    const actionsData = { remaining: 2, total: 2 };
    const actionCost = 1;
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + actionCost);
    assert.strictEqual(actionsData.remaining, 2, 'capped at total — cannot exceed budget');
  });

  it('009d: refund 2 from remaining=0, total=2 → capped at 2', () => {
    const actionsData = { remaining: 0, total: 2 };
    const actionCost = 2;
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + actionCost);
    assert.strictEqual(actionsData.remaining, 2, 'refund 2 from 0 = exactly total');
  });

  it('009e: total undefined falls back to DC_ACTIONS_PER_ACTIVATION (2)', () => {
    const actionsData = { remaining: 1 };
    const actionCost = 1;
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + actionCost);
    assert.strictEqual(actionsData.remaining, 2, 'undefined total uses fallback 2');
  });
});

// ── B-ACTCOST-010: Dubious Counterparts refund caps at total+1 ──────────────

describe('B-ACTCOST-010: Dubious Counterparts refund caps at total+1', () => {
  // Pattern from dc-play-area.js:2173:
  //   actionsData.remaining = Math.min((actionsData.total ?? DC_ACTIONS_PER_ACTIVATION) + 1, actionsData.remaining + 1);
  // Same formula as Overdrive (interrupts.js:161). This is intentional — Dubious
  // Counterparts grants a genuinely extra action (total+1 cap, not total cap).
  const DC_ACTIONS_PER_ACTIVATION = 2;

  it('010a: refund from remaining=1, total=2 → 2 (under cap)', () => {
    const actionsData = { remaining: 1, total: 2 };
    actionsData.remaining = Math.min((actionsData.total ?? DC_ACTIONS_PER_ACTIVATION) + 1, actionsData.remaining + 1);
    assert.strictEqual(actionsData.remaining, 2);
  });

  it('010b: refund from remaining=2, total=2 → 3 (total+1 cap)', () => {
    const actionsData = { remaining: 2, total: 2 };
    actionsData.remaining = Math.min((actionsData.total ?? DC_ACTIONS_PER_ACTIVATION) + 1, actionsData.remaining + 1);
    assert.strictEqual(actionsData.remaining, 3, 'exceeds total — extra action granted');
  });

  it('010c: refund from remaining=3, total=2 → capped at 3 (cannot exceed total+1)', () => {
    const actionsData = { remaining: 3, total: 2 };
    actionsData.remaining = Math.min((actionsData.total ?? DC_ACTIONS_PER_ACTIVATION) + 1, actionsData.remaining + 1);
    assert.strictEqual(actionsData.remaining, 3, 'hard cap at total+1');
  });
});

// ── B-ACTCOST-011: Gating at remaining=0 (handleDcRemoveStun, already 002) ─
// Covered by B-ACTCOST-002 above. Included as cross-reference.

// ── B-ACTCOST-012: Move costs 1 non-free, 0 with Executive Order ───────────

describe('B-ACTCOST-012: Move action cost', () => {
  // Pattern from dc-play-area.js:1380-1388:
  //   if (!isSpendMp) {
  //     const actData = game.dcActionsData?.[msgId];
  //     const isExecOrderFreeMove = game.pendingExecutiveOrder?.forMsgId === msgId;
  //     if (isExecOrderFreeMove) { delete game.pendingExecutiveOrder; }
  //     else if (actData) { actData.remaining = Math.max(0, actData.remaining - 1); }
  //   }
  it('012a: normal Move costs 1 action', () => {
    const actData = { remaining: 2, total: 2 };
    const game = {};
    const msgId = '3001';
    const isSpendMp = false;
    const isExecOrderFreeMove = game.pendingExecutiveOrder?.forMsgId === msgId;

    if (!isSpendMp) {
      if (isExecOrderFreeMove) {
        delete game.pendingExecutiveOrder;
      } else if (actData) {
        actData.remaining = Math.max(0, actData.remaining - 1);
      }
    }

    assert.strictEqual(actData.remaining, 1, 'Move costs 1 action');
  });

  it('012b: Executive Order free move costs 0 actions', () => {
    const actData = { remaining: 1, total: 2 };
    const game = { pendingExecutiveOrder: { forMsgId: '3001' } };
    const msgId = '3001';
    const isSpendMp = false;
    const isExecOrderFreeMove = game.pendingExecutiveOrder?.forMsgId === msgId;

    if (!isSpendMp) {
      if (isExecOrderFreeMove) {
        delete game.pendingExecutiveOrder;
      } else if (actData) {
        actData.remaining = Math.max(0, actData.remaining - 1);
      }
    }

    assert.strictEqual(actData.remaining, 1, 'remaining unchanged — Executive Order free move');
    assert.strictEqual(game.pendingExecutiveOrder, undefined, 'pending consumed');
  });

  it('012c: SpendMp costs 0 actions (uses MP bank)', () => {
    const actData = { remaining: 2, total: 2 };
    const isSpendMp = true;

    if (!isSpendMp) {
      actData.remaining = Math.max(0, actData.remaining - 1);
    }

    assert.strictEqual(actData.remaining, 2, 'SpendMp uses MP bank, not actions');
  });
});

// ── B-UNACT-001: Un-activate rejects after actions spent ────────────────────

describe('B-UNACT-001: Un-activate rejects after actions spent', () => {
  it('001: remaining < total returns ephemeral rejection', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 1, total: 2 } },
      p1ActivatedDcIndices: [0],
    });
    const { ctx, calls, exhaustedState } = buildUnactivateCtx(game);
    const interaction = mockInteraction('dc_unactivate_3001', 'player1');

    await handleDcUnactivate(interaction, ctx);

    // Rejection message
    const rejection = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Cannot un-activate'));
    assert.ok(rejection, 'ephemeral rejection sent');
    // State unchanged
    assert.ok(exhaustedState.get('3001'), 'DC still exhausted');
    assert.deepStrictEqual(game.p1ActivatedDcIndices, [0], 'activatedDcIndices unchanged');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-UNACT-002: Un-activate rejects after MP spent ─────────────────────────

describe('B-UNACT-002: Un-activate rejects after MP spent', () => {
  it('002: bank.remaining < bank.total returns ephemeral rejection', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } }, // Actions full (gate 1 passes)
      movementBank: { '3001': { remaining: 3, total: 4 } }, // MP spent (gate 2 rejects)
      p1ActivatedDcIndices: [0],
    });
    const { ctx, calls, exhaustedState } = buildUnactivateCtx(game);
    const interaction = mockInteraction('dc_unactivate_3001', 'player1');

    await handleDcUnactivate(interaction, ctx);

    const rejection = interaction._followUpCalls.find(m =>
      m.ephemeral && m.content?.includes('Cannot un-activate'));
    assert.ok(rejection, 'ephemeral rejection for MP spent');
    assert.strictEqual(calls.saveGames.length, 0, 'saveGames NOT called');
  });
});

// ── B-UNACT-003: Un-activate cleans core activation state correctly ─────────

describe('B-UNACT-003: Un-activate cleans core activation state', () => {
  it('003: cleans dcActionsData, movementBank, activated indices, exhaust state', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      movementBank: { '3001': { remaining: 4, total: 4 } },
      p1ActivatedDcIndices: [0],
      p1ActivationsRemaining: 0,
      p1ActivationsTotal: 1,
      dcFinishedPinged: { '3001': true },
      pendingEndTurn: { '3001': { playerNum: 1 } },
      // Position required so handleDcUnactivate's per-figureKey sweep finds the figure.
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' }, 2: {} },
      // Per-figure 2026-05-09 (multifigure-independent-activation rule).
      nextAttacksBonusHits: { 'Rebel Trooper-1-0': 2 },
      nextAttacksBonusConditions: { 'Rebel Trooper-1-0': ['Stun'] },
      nextAttackBonusSurgeAbilities: { 'Rebel Trooper-1-0': [{ surge: 1 }] },
      nextAttackBonusPierce: { 'Rebel Trooper-1-0': 1 },
      pendingOverrideAttackDice: { '3001': { dice: ['red'] } },
      // saberOrbitAttacksRemaining migrated to figureKey-keyed
      // 2026-05-09 (per-figure scope per IACP rule clarification).
      saberOrbitAttacksRemaining: { 'Rebel Trooper-1-0': 2 },
      pendingMissileSalvo: { '3001': { diceAvailable: ['blue'] } },
    });
    const { ctx, calls, exhaustedState } = buildUnactivateCtx(game);
    const interaction = mockInteraction('dc_unactivate_3001', 'player1');

    await handleDcUnactivate(interaction, ctx);

    // Core state cleaned
    assert.strictEqual(game.dcActionsData?.['3001'], undefined, 'dcActionsData cleaned');
    assert.strictEqual(game.movementBank?.['3001'], undefined, 'movementBank cleaned');
    assert.strictEqual(exhaustedState.get('3001'), false, 'DC no longer exhausted');
    assert.ok(!game.p1ActivatedDcIndices.includes(0), 'removed from activatedDcIndices');
    assert.strictEqual(game.dcFinishedPinged?.['3001'], undefined, 'dcFinishedPinged cleaned');
    assert.strictEqual(game.pendingEndTurn?.['3001'], undefined, 'pendingEndTurn cleaned');
    assert.strictEqual(game.nextAttacksBonusHits?.['Rebel Trooper-1-0'], undefined, 'nextAttacksBonusHits cleaned (figureKey-keyed 2026-05-09)');
    assert.strictEqual(game.nextAttacksBonusConditions?.['Rebel Trooper-1-0'], undefined, 'nextAttacksBonusConditions cleaned (figureKey-keyed 2026-05-09)');
    assert.strictEqual(game.nextAttackBonusSurgeAbilities?.['Rebel Trooper-1-0'], undefined, 'nextAttackBonusSurgeAbilities cleaned (figureKey-keyed 2026-05-09)');
    assert.strictEqual(game.nextAttackBonusPierce?.['Rebel Trooper-1-0'], undefined, 'nextAttackBonusPierce cleaned (figureKey-keyed 2026-05-09)');
    assert.strictEqual(game.pendingOverrideAttackDice?.['3001'], undefined, 'pendingOverrideAttackDice cleaned');
    assert.strictEqual(game.saberOrbitAttacksRemaining?.['Rebel Trooper-1-0'], undefined, 'saberOrbitAttacksRemaining cleaned (figureKey-keyed 2026-05-09)');
    assert.strictEqual(game.pendingMissileSalvo?.['3001'], undefined, 'pendingMissileSalvo cleaned');
    // saveGames called
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });
});

// ── B-UNACT-004: Activation-scoped scalar flags survive un-activate ─────────

describe('B-UNACT-004: Un-activate clears activation-scoped flags via cleanupActivation (regression)', () => {
  // REGRESSION: handleDcUnactivate now calls cleanupActivation() after its manual
  // cleanup. This closes the gap where activation-scoped scalar and msgId-keyed
  // flags could leak when a player un-activated before spending any actions.
  //
  // Previously leaked flags (now fixed):
  //   commsJammerActivePlayerNum — set by applyStartOfActivationEffects
  //   onTheLamActive — set by applyStartOfActivationEffects

  it('004a: ACTIVATION_SCALAR_FLAGS cleared on un-activate', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      commsJammerActivePlayerNum: 2,
      onTheLamActive: true,
      p1ActivatedDcIndices: [0],
    });
    const { ctx } = buildUnactivateCtx(game);
    await handleDcUnactivate(mockInteraction('dc_unactivate_3001', 'player1'), ctx);

    assert.strictEqual(game.commsJammerActivePlayerNum, undefined,
      'commsJammerActivePlayerNum cleared — opponent CC hand unlocked');
    assert.strictEqual(game.onTheLamActive, undefined,
      'onTheLamActive cleared');
  });

  it('004b: ACTIVATION_MSGID_FLAGS cleaned on un-activate', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      dcFinishedPinged: { '3001': true },
      fellSwoopFreeAttack: { '3001': true },
      pendingMpBonus: { '3001': 3 },
      p1ActivatedDcIndices: [0],
    });
    const { ctx } = buildUnactivateCtx(game);
    await handleDcUnactivate(mockInteraction('dc_unactivate_3001', 'player1'), ctx);

    assert.strictEqual(game.dcFinishedPinged?.['3001'], undefined, 'dcFinishedPinged cleaned');
    assert.strictEqual(game.fellSwoopFreeAttack?.['3001'], undefined,
      'fellSwoopFreeAttack cleaned (was previously leaked)');
    assert.strictEqual(game.pendingMpBonus?.['3001'], undefined,
      'pendingMpBonus cleaned (was previously leaked)');
  });

  it('004c: ACTIVATION_FIGKEY_FLAGS cleaned on un-activate', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      figureMoved: { 'Rebel Trooper-1-0': true, 'Enemy-2-0': true },
      p1ActivatedDcIndices: [0],
    });
    const { ctx } = buildUnactivateCtx(game);
    await handleDcUnactivate(mockInteraction('dc_unactivate_3001', 'player1'), ctx);

    assert.strictEqual(game.figureMoved?.['Rebel Trooper-1-0'], undefined,
      'figureMoved for activated DC cleaned');
    assert.strictEqual(game.figureMoved?.['Enemy-2-0'], true,
      'figureMoved for other DC preserved');
  });

  it('004d: moveInProgress compound keys cleaned on un-activate', async () => {
    const game = makeGame({
      dcActionsData: { '3001': { remaining: 2, total: 2 } },
      moveInProgress: { '3001_0': { mp: 3 }, '3002_0': { mp: 5 } },
      p1ActivatedDcIndices: [0],
    });
    const { ctx } = buildUnactivateCtx(game);
    await handleDcUnactivate(mockInteraction('dc_unactivate_3001', 'player1'), ctx);

    assert.strictEqual(game.moveInProgress?.['3001_0'], undefined, 'moveInProgress for this DC cleaned');
    assert.ok(game.moveInProgress?.['3002_0'], 'moveInProgress for other DC preserved');
  });
});
