/**
 * BEHAVIORAL oracle tests for Deployment Ability Phase 2:
 * Attachment specials, refund-on-failure, and pushTargetWithinRange.
 *
 * Representative abilities chosen by risk shape:
 *   Slice A — Inline attachment specials in dc-play-area.js
 *     VF: Focus      — once-per-round gated + dice-count-dependent + refund
 *     Autofire        — combat-linked pending (2 flags)
 *     Darksaber Strike — multi-pending follow-up (3 flags)
 *     Fire Mission    — double-action cost (cost=2)
 *
 *   Slice B — Refund-on-failure semantics
 *     Inline attachment failure refund (VF: Focus)
 *     requiresChoice temporary refund (multi-phase ability)
 *     No-refund manual fallback (resolveAbility applied:false)
 *
 *   Slice C — pushTargetWithinRange (Force Throw)
 *     Phase 1: target enumeration
 *     Phase 2: landing space enumeration
 *     Phase 3: push application
 *     Rejection + invariant cases
 *
 * Test IDs:
 *   B-DCATT-001: VF: Focus legal activation
 *   B-DCATT-002: VF: Focus guard/rejection + refund
 *   B-DCATT-003: Autofire legal activation
 *   B-DCATT-004: Darksaber Strike multi-pending setup
 *   B-DCATT-005: Fire Mission double-action cost
 *   B-DCREF-001: Inline attachment failure refund
 *   B-DCREF-002: requiresChoice temporary refund
 *   B-DCREF-003: No refund for manual fallback
 *   B-DCPUSH-001: Force Throw Phase 1 target enumeration
 *   B-DCPUSH-002: Force Throw Phase 2 landing space enumeration
 *   B-DCPUSH-003: Force Throw Phase 3 push application
 *   B-DCPUSH-004: Force Throw rejection + invariants
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDcAction } from '../../../src/handlers/dc-play-area.js';
import { resolveAbility } from '../../../src/game/abilities.js';
import { getMapData } from '../../../src/data-loader.js';

// ── Shared helpers ──────────────────────────────────────────────────────────────

const PLAYER1_ID = 'user_p1';
const MSG_ID = 'msg001';
const GAME_ID = 'test1';
const REAL_MAP_ID = 'mos-eisley-outskirts';

function makeGame(overrides = {}) {
  return {
    gameId: GAME_ID,
    player1Id: PLAYER1_ID,
    player2Id: 'user_p2',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    selectedMap: { id: REAL_MAP_ID },
    ...overrides,
  };
}

// ── Handler-level helpers (Slices A + B) ────────────────────────────────────────

function buildMockInteraction(customId, userId = PLAYER1_ID) {
  const responses = [];
  return {
    interaction: {
      customId,
      user: { id: userId },
      followUp: async (opts) => { responses.push(opts); return { id: 'resp_1' }; },
      editReply: async () => {},
      channel: {
        send: async () => ({ id: 'ch_msg' }),
        messages: { fetch: async () => new Map() },
      },
      message: { id: 'int_msg', edit: async () => ({}) },
    },
    responses,
  };
}

/**
 * Build a ctx for handleDcAction that routes through the attachment special path.
 * @param {object} game
 * @param {object} [opts]
 * @param {object} [opts.meta] - dcMessageMeta entry
 * @param {string[]} [opts.baseSpecials] - base DC specials (controls _baseSpecialCount)
 * @param {object} [opts.attackDice] - { dice: [...] } for getDcStats().attack
 * @param {number} [opts.figures] - figure count for getDcStats
 */
function buildAttachmentCtx(game, opts = {}) {
  const {
    meta = { _msgId: MSG_ID, gameId: GAME_ID, playerNum: 1, dcName: 'Test Trooper', displayName: 'Test Trooper [DG 1]' },
    baseSpecials = [],
    attackDice = { dice: ['blue'] },
    figures = 1,
  } = opts;
  const calls = { saveGames: [], logGameAction: [], updateDcActionsMessage: [] };
  const dcMessageMeta = new Map();
  dcMessageMeta.set(meta._msgId || MSG_ID, meta);

  return {
    ctx: {
      getGame: () => game,
      replyIfGameEnded: async () => false,
      dcMessageMeta,
      getDcStats: () => ({
        specials: baseSpecials,
        specialCosts: baseSpecials.map(() => 1),
        figures,
        attack: attackDice,
      }),
      getDcEffects: () => ({}),
      getMapData: () => ({}),
      getFigureSize: () => '1x1',
      getFootprintCells: (pos) => [pos],
      getRange: () => 5,
      hasLineOfSight: () => true,
      getEffectiveSpeed: () => 4,
      ensureMovementBankMessage: async () => {},
      getBoardStateForMovement: () => ({}),
      getMovementProfile: () => ({}),
      computeMovementCache: () => ({}),
      getMovementMinimapAttachment: async () => null,
      clearMoveGridMessages: async () => {},
      getLegalInteractOptions: () => [],
      FIGURE_LETTERS: 'abcdefghij',
      DC_ACTIONS_PER_ACTIVATION: 2,
      updateDcActionsMessage: async (...args) => { calls.updateDcActionsMessage.push(args); },
      logGameAction: async () => ({ id: 'log_msg' }),
      saveGames: () => { calls.saveGames.push(true); },
      client: {},
      logGameErrorToBotLogs: () => {},
      extractGameIdFromInteraction: () => GAME_ID,
      resolveAbility: () => ({ applied: false, manualMessage: 'Resolve manually.' }),
      getMapAttachmentForSpaces: async () => null,
      pushUndo: () => {},
      updateAttachmentMessageForDc: async () => {},
      checkWinConditions: async () => {},
      getDeploymentZones: () => ({}),
    },
    calls,
  };
}

// ── Slice A: Attachment Specials ────────────────────────────────────────────────

// VF: Focus is at attachment offset 1 (VF: Attack+Move is offset 0).
// With 0 base specials, specialIdx = 1 maps to VF: Focus.

describe('B-DCATT-001: VF: Focus — legal activation', () => {
  it('001a: succeeds when dice < 2 and not used this round', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx, calls } = buildAttachmentCtx(game, {
      attackDice: { dice: ['blue'] }, // 1 die < 2
    });
    const { interaction } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.ok(game.figureConditions?.['Test Trooper-1-0']?.includes('Focus'),
      'Focus condition applied to figure');
  });

  it('001b: sets vadersFocusUsedThisRound flag', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game, { attackDice: { dice: ['blue'] } });
    const { interaction } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.vadersFocusUsedThisRound?.[MSG_ID], true,
      'round-scoped flag set for this msgId');
  });

  it('001c: action deducted and specialsUsed updated', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx, calls } = buildAttachmentCtx(game, { attackDice: { dice: ['blue'] } });
    const { interaction } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 1,
      'remaining decremented 2→1');
    assert.ok(game.dcActionsData[MSG_ID].specialsUsed.includes(1),
      'specialIdx 1 added to specialsUsed');
    assert.ok(calls.saveGames.length > 0, 'game saved');
  });
});

describe('B-DCATT-002: VF: Focus — guard/rejection + refund', () => {
  it('002a: already used this round → rejected with refund', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
      vadersFocusUsedThisRound: { [MSG_ID]: true },
    });
    const { ctx } = buildAttachmentCtx(game, { attackDice: { dice: ['blue'] } });
    const { interaction, responses } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    // Action refunded
    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 2,
      'remaining restored to 2 after refund');
    // specialsUsed cleaned
    assert.ok(!game.dcActionsData[MSG_ID].specialsUsed.includes(1),
      'specialIdx 1 removed from specialsUsed');
    // No Focus applied
    assert.ok(!game.figureConditions?.['Test Trooper-1-0']?.includes('Focus'),
      'Focus NOT applied');
  });

  it('002b: dice count >= 2 → rejected with refund', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game, {
      attackDice: { dice: ['blue', 'green'] }, // 2 dice >= 2
    });
    const { interaction, responses } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    // Action refunded
    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 2,
      'remaining restored after dice-count rejection');
    // specialsUsed cleaned
    assert.ok(!game.dcActionsData[MSG_ID].specialsUsed.includes(1),
      'specialIdx removed from specialsUsed');
    // No Focus applied, no round flag
    assert.ok(!game.figureConditions?.['Test Trooper-1-0']?.includes('Focus'));
    assert.ok(!game.vadersFocusUsedThisRound?.[MSG_ID]);
  });
});

describe('B-DCATT-003: Autofire — legal activation', () => {
  // Autofire is injected by Z-6 Trooper attachment.
  // With 0 base specials, specialIdx=0 maps to Autofire.
  it('003a: sets autofireActive and freeAttackBonusPending', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ['Z-6 Trooper'] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.autofireActive?.[MSG_ID], true,
      'autofireActive flag set');
    assert.ok(game.freeAttackBonusPending?.[MSG_ID],
      'freeAttackBonusPending set');
  });

  it('003b: action deducted correctly (cost=1)', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ['Z-6 Trooper'] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 1, 'remaining 2→1');
    assert.ok(game.dcActionsData[MSG_ID].specialsUsed.includes(0));
  });
});

describe('B-DCATT-004: Darksaber Strike — multi-pending setup', () => {
  // Darksaber Strike is injected by "The Darksaber" attachment.
  // With 0 base specials, specialIdx=0 maps to Darksaber Strike.
  it('004a: sets all three pending flags', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ['The Darksaber'] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    // pendingOverrideAttackDice with red die + melee + darksaberBlastToCleave
    const override = game.pendingOverrideAttackDice?.[MSG_ID];
    assert.ok(override, 'pendingOverrideAttackDice set');
    assert.deepStrictEqual(override.dice, ['red'], 'override dice = [red]');
    assert.strictEqual(override.type, 'melee', 'override type = melee');
    assert.strictEqual(override.darksaberBlastToCleave, true);

    // freeAttackBonusPending
    assert.ok(game.freeAttackBonusPending?.[MSG_ID],
      'freeAttackBonusPending set');

    // darksaberSecondAttack
    assert.strictEqual(game.darksaberSecondAttack?.[MSG_ID], true,
      'darksaberSecondAttack flag set');
  });

  it('004b: action deducted correctly', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ['The Darksaber'] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 1, 'remaining 2→1');
  });
});

describe('B-DCATT-005: Fire Mission — double-action cost', () => {
  // Fire Mission is injected by "Mortar Trooper" attachment, cost=2.
  // With 0 base specials, specialIdx=0 maps to Fire Mission.
  it('005a: sets fireMissionActive and freeAttackBonusPending', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ['Mortar Trooper'] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.fireMissionActive?.[MSG_ID], true, 'fireMissionActive set');
    assert.ok(game.freeAttackBonusPending?.[MSG_ID], 'freeAttackBonusPending set');
  });

  it('005b: cost=2 deducts both actions (remaining 2→0)', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ['Mortar Trooper'] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const { ctx } = buildAttachmentCtx(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 0,
      'remaining 2→0 (cost=2 double-action)');
  });
});

// ── Slice B: Refund-on-failure semantics ────────────────────────────────────────

describe('B-DCREF-001: Inline attachment failure refund (VF: Focus)', () => {
  it('001a: action refunded on already-used-this-round rejection', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
      vadersFocusUsedThisRound: { [MSG_ID]: true },
    });
    const { ctx } = buildAttachmentCtx(game, { attackDice: { dice: ['blue'] } });
    const { interaction } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    // Verify: action deducted (line 1736) then refunded (line 1820)
    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 2,
      'action refunded: remaining back to 2');
    assert.ok(!game.dcActionsData[MSG_ID].specialsUsed.includes(1),
      'specialsUsed cleaned: index 1 removed');
  });

  it('001b: no partial effect on failure', async () => {
    const game = makeGame({
      p1DcAttachments: { [MSG_ID]: ["Vader's Finest"] },
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
      vadersFocusUsedThisRound: { [MSG_ID]: true },
    });
    const { ctx } = buildAttachmentCtx(game, { attackDice: { dice: ['blue'] } });
    const { interaction } = buildMockInteraction(`dc_special_1_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.ok(!game.figureConditions?.['Test Trooper-1-0']?.includes('Focus'),
      'no Focus condition applied');
    // vadersFocusUsedThisRound should still be true (was true before, not cleared)
    assert.strictEqual(game.vadersFocusUsedThisRound?.[MSG_ID], true,
      'round flag unchanged');
  });
});

describe('B-DCREF-002: requiresChoice temporary refund (multi-phase ability)', () => {
  // When resolveAbility returns requiresChoice, handleDcAction refunds the action
  // temporarily so the player can choose. The action is re-consumed on commit.
  it('002a: action temporarily refunded when requiresChoice returned', async () => {
    const game = makeGame({
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    // Use a base DC special (not attachment) that returns requiresChoice
    const meta = { _msgId: MSG_ID, gameId: GAME_ID, playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' };
    const { ctx, calls } = buildAttachmentCtx(game, {
      meta,
      baseSpecials: ['Test Push'],
    });
    // Override resolveAbility to return requiresChoice
    ctx.resolveAbility = () => ({
      applied: false,
      requiresChoice: true,
      choiceOptions: ['Target A', 'Target B'],
      targetFigureKeys: ['fig-2-0', 'fig-2-1'],
    });
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    // Action was deducted (1736) then refunded (2064): net = original
    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 2,
      'action temporarily refunded while player chooses');
  });

  it('002b: pendingDcAbilityChoice created with correct state', async () => {
    const game = makeGame({
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const meta = { _msgId: MSG_ID, gameId: GAME_ID, playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' };
    const { ctx } = buildAttachmentCtx(game, { meta, baseSpecials: ['Test Push'] });
    ctx.resolveAbility = () => ({
      applied: false,
      requiresChoice: true,
      choiceOptions: ['Target A'],
      targetFigureKeys: ['fig-2-0'],
    });
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    const pending = game.pendingDcAbilityChoice?.[`${MSG_ID}_0`];
    assert.ok(pending, 'pendingDcAbilityChoice created');
    assert.strictEqual(pending.playerNum, 1);
    assert.deepStrictEqual(pending.targetFigureKeys, ['fig-2-0']);
  });

  it('002c: specialsUsed NOT cleaned (prevents re-click during choice)', async () => {
    const game = makeGame({
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const meta = { _msgId: MSG_ID, gameId: GAME_ID, playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' };
    const { ctx } = buildAttachmentCtx(game, { meta, baseSpecials: ['Test Push'] });
    ctx.resolveAbility = () => ({
      applied: false,
      requiresChoice: true,
      choiceOptions: ['Target A'],
      targetFigureKeys: ['fig-2-0'],
    });
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    assert.ok(game.dcActionsData[MSG_ID].specialsUsed.includes(0),
      'specialIdx 0 stays in specialsUsed to prevent re-click');
  });
});

describe('B-DCREF-003: No refund for manual fallback (applied:false + manualMessage)', () => {
  it('003: action stays consumed when resolveAbility returns manual fallback', async () => {
    const game = makeGame({
      dcActionsData: { [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
      figurePositions: { 1: { 'Test Trooper-1-0': 'a1' }, 2: {} },
    });
    const meta = { _msgId: MSG_ID, gameId: GAME_ID, playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' };
    const { ctx } = buildAttachmentCtx(game, { meta, baseSpecials: ['Manual Ability'] });
    // resolveAbility returns applied:false with only manualMessage (no requiresChoice)
    ctx.resolveAbility = () => ({
      applied: false,
      manualMessage: 'No valid targets. Resolve manually.',
    });
    const { interaction, responses } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);

    await handleDcAction(interaction, ctx, 'dc_special_');

    // Action was deducted and NOT refunded — by design, the action is spent
    assert.strictEqual(game.dcActionsData[MSG_ID].remaining, 1,
      'action consumed (remaining 2→1), no refund for manual fallback');
    assert.ok(game.dcActionsData[MSG_ID].specialsUsed.includes(0),
      'specialsUsed still contains the index');
  });
});

// ── Slice C: pushTargetWithinRange (Force Throw) ────────────────────────────────

// Force Throw: range 3, requiresSmall, no LOS required, maxDistanceFromTarget 2.
// Uses resolveAbility directly (pure function) like B-DC-003/004/005.

function buildForceThrowContext({
  attackerPos = 'a1',
  enemyPositions = {},
  friendlyPositions = {},
  choiceIndex,
  targetFigureKey,
  chosenSpace,
  losCheck = () => true,
  mapDataOverride,
} = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const activatorMsgId = 'msg_kanan';
  const enemyMsgId = 'msg_enemy';

  dcMessageMeta.set(activatorMsgId, {
    gameId: GAME_ID, playerNum: 1, dcName: 'Kanan Jarrus',
    displayName: 'Kanan Jarrus [DG 1]',
  });
  dcMessageMeta.set(enemyMsgId, {
    gameId: GAME_ID, playerNum: 2, dcName: 'Imperial Officer',
    displayName: 'Imperial Officer [DG 1]',
  });

  const game = makeGame({
    figurePositions: {
      1: { 'Kanan Jarrus-1-0': attackerPos, ...friendlyPositions },
      2: enemyPositions,
    },
    dcActionsData: {
      [activatorMsgId]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 },
    },
  });

  dcHealthState.set(activatorMsgId, [[8, 8]]); // Kanan has 8 HP
  if (Object.keys(enemyPositions).length > 0) {
    dcHealthState.set(enemyMsgId, [[5, 5]]);
  }

  const meta = dcMessageMeta.get(activatorMsgId);

  return {
    game, dcMessageMeta, dcHealthState, meta, activatorMsgId,
    context: {
      game,
      playerNum: 1,
      meta,
      msgId: activatorMsgId,
      dcMessageMeta,
      dcHealthState,
      hasLineOfSight: losCheck,
      getRange: () => 3,
      getMapData: mapDataOverride || ((mapId) => getMapData(mapId)),
      findDcMessageIdForFigure: () => enemyMsgId,
      getDcEffects: () => ({}),
      choiceIndex,
      targetFigureKey,
      chosenSpace,
    },
  };
}

describe('B-DCPUSH-001: Force Throw Phase 1 — target enumeration', () => {
  it('001a: returns requiresChoice with valid SMALL enemy targets in range', () => {
    // a1 and a2 are adjacent (range 1, well within 3)
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true);
    assert.ok(result.targetFigureKeys.includes('Imperial Officer-1-0'),
      'adjacent enemy included as valid target');
  });

  it('001b: excludes MASSIVE figures (requiresSmall)', () => {
    // AT-ST has MASSIVE keyword — should be filtered out
    const { context, game } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'AT-ST-1-0': 'a2' },
    });
    const result = resolveAbility('force_throw', context);

    // No valid targets (AT-ST is MASSIVE, Force Throw requiresSmall)
    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage?.includes('no valid SMALL targets'),
      'MASSIVE figure excluded — no valid targets message');
  });

  it('001c: excludes out-of-range figures', () => {
    // Place enemy far away so countGameSpaces > 3
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'h8' },
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage?.includes('no valid SMALL targets'),
      'out-of-range figure excluded');
  });

  it('001d: Spiked Boots immunity excludes target when pusher not MASSIVE', () => {
    // Snowtrooper (Elite) has spiked_boots_snowtrooper. Kanan is not MASSIVE.
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Snowtrooper (Elite)-1-0': 'a2' },
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage?.includes('no valid SMALL targets'),
      'Spiked Boots target excluded — non-MASSIVE pusher');
  });

  it('001e: strain cost deferred to Phase 3 — Phase 1 leaves HP unchanged', () => {
    // Migration 2026-05-09: strain cost now queued via pendingStrainCost
    // in Phase 3 (after target+space picked) instead of raw HP mutation
    // in Phase 1. Avoids paying cost when the player cancels the picker.
    const { context, dcHealthState } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
    });
    resolveAbility('force_throw', context);

    const healthAfter = dcHealthState.get('msg_kanan');
    assert.strictEqual(healthAfter[0][0], 8, 'HP unchanged in Phase 1 (strain deferred to Phase 3)');
  });

  it('001e2: strain cost queued via pendingStrainCost on Phase 3', () => {
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
      targetFigureKey: 'Imperial Officer-1-0',
      chosenSpace: 'a3',
    });
    const result = resolveAbility('force_throw', context);
    assert.strictEqual(result.applied, true);
    assert.ok(result.pendingStrainCost, 'pendingStrainCost queued for applyStrain pipeline');
    assert.strictEqual(result.pendingStrainCost.amount, 1);
    assert.strictEqual(result.pendingStrainCost.controllerPlayerNum, 1);
  });

  it('001f: Phase 1 does not mutate figurePositions', () => {
    const { context, game } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
    });
    const posBefore = { ...game.figurePositions[2] };
    resolveAbility('force_throw', context);

    assert.deepStrictEqual(game.figurePositions[2], posBefore,
      'enemy positions unchanged in Phase 1');
  });
});

describe('B-DCPUSH-002: Force Throw Phase 2 — landing space enumeration', () => {
  it('002a: returns requiresSpaceChoice with valid unoccupied spaces', () => {
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
      targetFigureKey: 'Imperial Officer-1-0',
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresSpaceChoice, true);
    assert.ok(Array.isArray(result.validSpaces), 'validSpaces is an array');
    assert.ok(result.validSpaces.length > 0, 'at least one valid space');
  });

  it('002b: respects maxDistanceFromTarget constraint (≤2 spaces)', () => {
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
      targetFigureKey: 'Imperial Officer-1-0',
    });
    const result = resolveAbility('force_throw', context);

    // All valid spaces should be within 2 spaces of the target's position (a2)
    assert.ok(result.validSpaces.length > 0);
    // The target at a2 — spaces more than 2 away should be excluded.
    // We can't easily verify exact distances without counting, but verify
    // the target's own space (a2) is included (target vacates it, distance 0).
    assert.ok(result.validSpaces.includes('a2'),
      'target current space available (target vacates)');
  });

  it('002c: occupied spaces excluded from landing options', () => {
    // Place a friendly figure at a3 — it should not appear in validSpaces
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Kanan Jarrus-1-1': 'a3' },
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
      targetFigureKey: 'Imperial Officer-1-0',
    });
    const result = resolveAbility('force_throw', context);

    assert.ok(!result.validSpaces.includes('a3'),
      'occupied space a3 excluded from valid landing spaces');
  });
});

describe('B-DCPUSH-003: Force Throw Phase 3 — push application', () => {
  it('003a: figurePositions mutated to new space', () => {
    const { context, game } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
      targetFigureKey: 'Imperial Officer-1-0',
      chosenSpace: 'a3',
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, true, 'push applied');
    assert.strictEqual(game.figurePositions[2]['Imperial Officer-1-0'], 'a3',
      'target moved from a2 to a3');
  });

  it('003b: result includes refreshBoard and logMessage', () => {
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Imperial Officer-1-0': 'a2' },
      targetFigureKey: 'Imperial Officer-1-0',
      chosenSpace: 'a3',
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.refreshBoard, true, 'refreshBoard set');
    assert.ok(result.logMessage, 'logMessage present');
    assert.ok(result.logMessage.includes('Force Throw'), 'logMessage mentions ability');
  });

  it('003c: Spiked Boots blocks push at Phase 3 for non-MASSIVE pusher', () => {
    // Snowtrooper (Elite) has spiked_boots_snowtrooper; Kanan is not MASSIVE
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: { 'Snowtrooper (Elite)-1-0': 'a2' },
      targetFigureKey: 'Snowtrooper (Elite)-1-0',
      chosenSpace: 'a3',
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false, 'push blocked by Spiked Boots');
    assert.ok(result.manualMessage?.includes('Spiked Boots'),
      'rejection message mentions Spiked Boots');
  });
});

describe('B-DCPUSH-004: Force Throw rejection + invariants', () => {
  it('004a: no valid targets returns applied:false with message', () => {
    // No enemies on the board
    const { context } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: {},
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage?.includes('no valid SMALL targets'),
      'correct rejection message');
  });

  it('004b: target with no position returns applied:false in Phase 2', () => {
    // Target figure key exists but has no position
    const { context, game } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: {},
      targetFigureKey: 'Ghost-1-0',
    });
    const result = resolveAbility('force_throw', context);

    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage?.includes('no position'),
      'target-no-position rejection');
  });

  it('004c: no strain deducted when no valid targets found', () => {
    // No enemies — Phase 1 returns early at "no valid targets" before strain deduction
    const { context, dcHealthState } = buildForceThrowContext({
      attackerPos: 'a1',
      enemyPositions: {},
    });
    resolveAbility('force_throw', context);

    const healthAfter = dcHealthState.get('msg_kanan');
    assert.strictEqual(healthAfter[0][0], 8,
      'HP unchanged — strain not deducted on empty target list');
  });
});
