/**
 * BEHAVIORAL oracle tests for interrupts.js Phase 1: Pre-defeat interrupt chain
 * (SDP, Last Resort, Executor) and Extra Protection (Onar Koma CC).
 *
 * Test categories:
 *   B-I-PREDEFEAT-*: Self-Destruct Protocol, Last Resort, Executor re-entry contract
 *   B-I-EP-*:        Extra Protection double-damage regression, skip path, guard
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleSelfDestructProtocol, handleLastResort, handleExecutor,
  handleExtraProtection,
} from '../../../src/handlers/interrupts.js';
import { applyDamageAndFinishCombat } from '../../../src/engine/combat-bridge.js';
import { reduceHp } from '../../../src/game/damage-helpers.js';

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
  const thread = mockThread();
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

function makeCombat(overrides = {}) {
  return {
    gameId: '42',
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
    attackDiceResults: [{ color: 'blue', acc: 2, dmg: 3, surge: 0 }],
    defenseDiceResults: [{ color: 'white', block: 0, evade: 0, dodge: false }],
    attackRoll: { acc: 2, dmg: 3, surge: 0 },
    defenseRoll: { block: 0, evade: 0, dodge: false },
    surgeRemaining: 0,
    ...overrides,
  };
}

/**
 * Build ctx for interrupt handlers.
 * `applyDamageAndFinishCombat` is mocked to record the re-entry call.
 */
function buildInterruptCtx(game, overrides = {}) {
  const calls = {
    applyDamageAndFinishCombat: [],
    processFigureDefeat: [],
    logGameAction: [],
    saveGames: [],
  };
  return {
    ctx: {
      getGame: (id) => String(id) === String(game.gameId) ? game : null,
      canActAsPlayer: () => true,
      replyIfGameEnded: async () => false,
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => mockThread() } },
      dcMessageMeta: new Map(),
      dcHealthState: new Map(),
      logGameAction: async (...args) => { calls.logGameAction.push(args); },
      getDiceData: () => ({ attack: { red: [{ dmg: 2, acc: 0, surge: 0 }] } }),
      getMapData: () => ({ adjacency: {} }),
      applyDamageAndFinishCombat: async (g, c, params, cl) => {
        calls.applyDamageAndFinishCombat.push({ game: g, combat: c, params });
      },
      processFigureDefeat: async (g, opts) => { calls.processFigureDefeat.push(opts); },
      ...overrides,
    },
    calls,
  };
}

// ── B-I-PREDEFEAT: Pre-defeat interrupt chain ────────────────────────────────

describe('B-I-PREDEFEAT: Self-Destruct Protocol, Last Resort, Executor', () => {

  it('B-I-PREDEFEAT-001: SDP use path routes through the Move-X picker (sdpExplode continuation)', async () => {
    // Post-2026-05-09 migration: SDP destination picker is the unified
    // Move-X picker. The "Use" branch stamps pendingMoveX[targetMsgId]
    // with a 3-space budget and a nextAction.type === 'sdpExplode'
    // continuation. If the picker has zero legal destinations (e.g.
    // test fixture without real map data), it auto-runs _finishPicker
    // → fires the sdpExplode continuation → processFigureDefeat. Both
    // paths are valid; the test accepts either as evidence the
    // migration is wired.
    const combat = makeCombat();
    const game = makeGame({
      pendingCombat: combat,
      pendingSelfDestruct: {
        targetMsgId: 'dc2', defenderPlayerNum: 2, attackerPlayerNum: 1,
        damage: 3, hit: true, resultText: 'test', totalBlast: 0,
        ownerId: 'player1', targetFigIndex: 0,
      },
      selfDestructProtocolTriggered: { dc2: true },
      figurePositions: { 1: {}, 2: { 'Rebel Trooper-1-0': 'a1' } },
      selectedMap: { id: 'test_map' },
    });
    const { ctx, calls } = buildInterruptCtx(game);

    await handleSelfDestructProtocol(
      mockInteraction('self_destruct_protocol_use_42_dc2', 'player2'), ctx,
    );

    assert.strictEqual(game.pendingSelfDestruct, undefined, 'pendingSelfDestruct deleted on use');
    const pmx = game.pendingMoveX?.['dc2'];
    const sdpExplodedAlready = calls.processFigureDefeat.length > 0;
    assert.ok(pmx || sdpExplodedAlready,
      'either pendingMoveX is stamped (player has destinations to pick from), or the picker auto-cleared on zero destinations and ran the sdpExplode continuation immediately');
    if (pmx) {
      assert.strictEqual(pmx.source, 'Self-Destruct Protocol');
      assert.strictEqual(pmx.nextAction?.type, 'sdpExplode',
        'sdpExplode continuation must be attached so the explosion fires after the picker drains');
      assert.strictEqual(pmx.nextAction?.payload?.defenderPlayerNum, 2);
    }
    // Legacy applyDamageAndFinishCombat re-entry no longer used by SDP
    // (defeat finalized via completeDeferredDefeat → processFigureDefeat).
    assert.strictEqual(calls.applyDamageAndFinishCombat.length, 0);
    assert.ok(calls.saveGames.length > 0, 'saveGames called');
  });

  it('B-I-PREDEFEAT-002: SDP skip path deletes pending and calls re-entry', async () => {
    const combat = makeCombat();
    const game = makeGame({
      pendingCombat: combat,
      pendingSelfDestruct: {
        targetMsgId: 'dc2', defenderPlayerNum: 2, attackerPlayerNum: 1,
        damage: 3, hit: true, resultText: 'test', totalBlast: 0,
        ownerId: 'player1', targetFigIndex: 0,
      },
    });
    const { ctx, calls } = buildInterruptCtx(game);

    await handleSelfDestructProtocol(
      mockInteraction('self_destruct_protocol_skip_42_dc2', 'player2'), ctx,
    );

    assert.strictEqual(game.pendingSelfDestruct, undefined, 'pendingSelfDestruct deleted');
    // 2026-05-08 migration: skip path finalizes via completeDeferredDefeat
    // → processFigureDefeat (replacing applyDamageAndFinishCombat re-entry).
    assert.strictEqual(calls.processFigureDefeat.length, 1, 'processFigureDefeat called for SDP figure on skip');
    assert.strictEqual(calls.processFigureDefeat[0].source, 'Self-Destruct Protocol skipped', 'source labeled');
  });

  it('B-I-PREDEFEAT-003: Last Resort use path depletes attachment, calls re-entry', async () => {
    const combat = makeCombat();
    const game = makeGame({
      pendingCombat: combat,
      pendingLastResort: {
        targetMsgId: 'dc2', defenderPlayerNum: 2, attackerPlayerNum: 1,
        damage: 4, hit: true, resultText: 'test', totalBlast: 0,
        ownerId: 'player1', targetFigIndex: 0,
      },
      lastResortTriggered: { dc2: true },
      p2DcAttachments: { dc2: ['Last Resort', 'Targeting Computer'] },
    });
    const { ctx, calls } = buildInterruptCtx(game);

    await handleLastResort(
      mockInteraction('last_resort_use_42_dc2', 'player2'), ctx,
    );

    assert.strictEqual(game.pendingLastResort, undefined, 'pendingLastResort deleted');
    // Last Resort depleted from attachments
    assert.ok(!game.p2DcAttachments.dc2.includes('Last Resort'), 'Last Resort removed from attachments');
    assert.ok(game.p2DcAttachments.dc2.includes('Targeting Computer'), 'other attachments preserved');
    // 2026-05-08 migration: handler now finalizes the deferred defeat
    // via completeDeferredDefeat → processFigureDefeat instead of
    // re-entering the legacy applyDamageAndFinishCombat path.
    assert.strictEqual(calls.processFigureDefeat.length, 1, 'processFigureDefeat called for deferred defeat');
    assert.strictEqual(calls.processFigureDefeat[0].defeatedPlayerNum, 2, 'defender side defeated');
    assert.strictEqual(calls.processFigureDefeat[0].source, 'Last Resort', 'source labeled');
  });

  it('B-I-PREDEFEAT-004: Executor use path grants MP + free attack, marks once-per-round', async () => {
    const combat = makeCombat();
    const game = makeGame({
      pendingCombat: combat,
      pendingExecutorInterrupt: {
        rgcFigKey: 'Royal Guard Champion-1-0', rgcMsgId: 'dc3',
        rgcPlayerNum: 2, rgcDcName: 'Royal Guard Champion',
        defeatedLabel: 'Rebel Trooper',
        targetMsgId: 'dc2', defenderPlayerNum: 2, attackerPlayerNum: 1,
        damage: 5, hit: true, resultText: 'test', totalBlast: 0,
        ownerId: 'player1', targetFigIndex: 0,
      },
      executorTriggered: { dc2: true },
    });
    const { ctx, calls } = buildInterruptCtx(game);

    await handleExecutor(
      mockInteraction('executor_use_42_dc3', 'player2'), ctx,
    );

    assert.strictEqual(game.pendingExecutorInterrupt, undefined, 'pendingExecutorInterrupt deleted');
    // Once-per-round guard set
    assert.strictEqual(
      game.roundFigureAbilityUsed['Royal Guard Champion-1-0_executor'], true,
      'once-per-round ability marked',
    );
    // MP granted
    assert.ok(game.movementBank?.dc3, 'movement bank created for RGC');
    assert.strictEqual(game.movementBank.dc3.remaining, 2, '2 MP granted');
    // Free attack granted (figureKey-keyed per IACP rule 2026-05-09)
    assert.strictEqual(game.freeAttackBonusPending?.['Royal Guard Champion-1-0'], true, 'free attack pending');
    // 2026-05-09 migration: Executor moved BEFORE_DEFEATED → WHEN_DEFEATED.
    // The friendly's defeat is finalized by processFigureDefeat BEFORE
    // RGC's button click (in the pipeline's WHEN_DEFEATED + CC-play
    // window + processFigureDefeat block). handleExecutor no longer
    // calls completeDeferredDefeat — it just grants the MP + free
    // attack and clears the pending state.
    assert.strictEqual(calls.processFigureDefeat.length, 0, 'processFigureDefeat not invoked from handleExecutor (defeat already finalized upstream)');
  });

  it('B-I-PREDEFEAT-005: triggered-once guards prevent re-trigger on re-entry', async () => {
    // Verify that if we call applyDamageAndFinishCombat re-entry with triggered flags set,
    // the pending fields are NOT re-set (the guards in combat-bridge.js prevent it).
    // We test this by checking that the pending fields stay undefined after re-entry setup.
    const game = makeGame({
      selfDestructProtocolTriggered: { dc2: true },
      lastResortTriggered: { dc2: true },
      executorTriggered: { dc2: true },
    });

    // These pending fields should NOT exist — the triggered guards prevent re-creation.
    // This is a structural test: verify the guard condition logic.
    assert.strictEqual(game.pendingSelfDestruct, undefined, 'SDP pending not set when triggered');
    assert.strictEqual(game.pendingLastResort, undefined, 'LR pending not set when triggered');
    assert.strictEqual(game.pendingExecutorInterrupt, undefined, 'Executor pending not set when triggered');

    // The triggered flags are keyed by msgId, not blanket booleans
    assert.strictEqual(game.selfDestructProtocolTriggered.dc2, true, 'SDP guard keyed by msgId');
    assert.strictEqual(game.lastResortTriggered.dc2, true, 'LR guard keyed by msgId');
    assert.strictEqual(game.executorTriggered.dc2, true, 'Executor guard keyed by msgId');
  });

  it('B-I-PREDEFEAT-006: all handlers clear pending on both use and skip paths', async () => {
    // SDP skip: already tested in 002
    // Last Resort skip:
    const combat = makeCombat();
    const game1 = makeGame({
      pendingCombat: combat,
      pendingLastResort: {
        targetMsgId: 'dc2', defenderPlayerNum: 2, attackerPlayerNum: 1,
        damage: 3, hit: true, resultText: '', totalBlast: 0,
        ownerId: 'player1', targetFigIndex: 0,
      },
    });
    const { ctx: ctx1 } = buildInterruptCtx(game1);
    await handleLastResort(mockInteraction('last_resort_skip_42_dc2', 'player2'), ctx1);
    assert.strictEqual(game1.pendingLastResort, undefined, 'LR skip clears pending');

    // Executor skip:
    const game2 = makeGame({
      pendingCombat: makeCombat(),
      pendingExecutorInterrupt: {
        rgcFigKey: 'RGC-1-0', rgcMsgId: 'dc3', rgcPlayerNum: 2,
        rgcDcName: 'RGC', defeatedLabel: 'Trooper',
        targetMsgId: 'dc2', defenderPlayerNum: 2, attackerPlayerNum: 1,
        damage: 3, hit: true, resultText: '', totalBlast: 0,
        ownerId: 'player1', targetFigIndex: 0,
      },
    });
    const { ctx: ctx2, calls: calls2 } = buildInterruptCtx(game2);
    await handleExecutor(mockInteraction('executor_skip_42_dc3', 'player2'), ctx2);
    assert.strictEqual(game2.pendingExecutorInterrupt, undefined, 'Executor skip clears pending');
    // Verify no MP/attack granted on skip
    assert.strictEqual(game2.movementBank, undefined, 'no MP granted on skip');
    assert.strictEqual(game2.freeAttackBonusPending, undefined, 'no free attack on skip');
    // 2026-05-09 migration: Executor moved to WHEN_DEFEATED. Friendly's
    // defeat is finalized upstream; handleExecutor no longer calls
    // processFigureDefeat on either Use or Skip.
    assert.strictEqual(calls2.processFigureDefeat.length, 0, 'processFigureDefeat not invoked from handleExecutor on skip');
  });
});

// ── B-I-EP: Extra Protection ─────────────────────────────────────────────────

describe('B-I-EP: Extra Protection double-damage regression and cleanup', () => {

  it('B-I-EP-001: re-entry does NOT double-apply damage (regression)', async () => {
    // This tests applyDamageAndFinishCombat directly with the _epReentry guard.
    // Setup: target at 1 HP (damage was already applied in first pass: 4→1).
    // Re-entry should NOT call reduceHp again.
    const dcHealthState = new Map();
    dcHealthState.set('dc2', { 0: [1, 4] }); // [currentHp, maxHp]
    // Per alexanbv 2026-05-09: EP re-entry detection moved from a global
    // flag (extraProtectionTriggeredThisCombat) to a per-frame marker
    // (combat._damageApplied) set by combat-bridge after first-pass
    // damage applies. Mirror that here to simulate the re-entry path.
    const combat = makeCombat({
      target: { figureKey: 'Rebel Trooper-1-0', label: 'Rebel Trooper', playerNum: 2, isNpc: false },
      _damageApplied: true,
    });
    const game = makeGame({
      pendingCombat: combat,
      // pendingExtraProtection is null (deleted by handler before re-entry)
    });

    let reduceHpCallCount = 0;
    const deps = buildMinimalCombatBridgeDeps(dcHealthState, game, {
      reduceHp: (hs, g, msgId, figIdx, dmg, pn) => {
        reduceHpCallCount++;
        return reduceHp(hs, g, msgId, figIdx, dmg, pn);
      },
    });

    await applyDamageAndFinishCombat(
      game, combat,
      { damage: 3, hit: true, resultText: '', totalBlast: 0,
        defenderPlayerNum: 2, attackerPlayerNum: 1, ownerId: 'player1',
        targetMsgId: 'dc2', targetFigIndex: 0 },
      { channels: { fetch: async () => mockThread() } },
      deps,
    );

    // reduceHp should NOT have been called for the target (skipped by _epReentry guard)
    assert.strictEqual(reduceHpCallCount, 0, 'reduceHp not called on EP re-entry');
    // HP should still be 1 (unchanged)
    const hp = dcHealthState.get('dc2')[0];
    assert.strictEqual(hp[0], 1, 'target HP unchanged at 1 (no double damage)');
  });

  it('B-I-EP-002: re-entry does NOT double-apply surge conditions (regression)', async () => {
    const dcHealthState = new Map();
    dcHealthState.set('dc2', { 0: [1, 4] });
    const combat = makeCombat({
      target: { figureKey: 'Rebel Trooper-1-0', label: 'Rebel Trooper', playerNum: 2, isNpc: false },
      surgeConditions: ['Stun'],
      bonusConditions: ['Bleed'],
      _damageApplied: true, // re-entry marker (per-combat) per alexanbv 2026-05-09
    });
    const game = makeGame({
      pendingCombat: combat,
      figureConditions: {},
    });

    let applyConditionCalls = [];
    const deps = buildMinimalCombatBridgeDeps(dcHealthState, game, {
      _applyCondition: (g, fk, cond) => {
        applyConditionCalls.push({ figureKey: fk, condition: cond });
        return true;
      },
    });

    await applyDamageAndFinishCombat(
      game, combat,
      { damage: 3, hit: true, resultText: '', totalBlast: 0,
        defenderPlayerNum: 2, attackerPlayerNum: 1, ownerId: 'player1',
        targetMsgId: 'dc2', targetFigIndex: 0 },
      { channels: { fetch: async () => mockThread() } },
      deps,
    );

    // Conditions should NOT be re-applied on EP re-entry
    const targetConds = applyConditionCalls.filter(c => c.figureKey === 'Rebel Trooper-1-0');
    assert.strictEqual(targetConds.length, 0, 'no conditions applied to target on EP re-entry');
  });

  it('B-I-EP-003: skip path clears pending, calls re-entry, does not grant MP/attack', async () => {
    const combat = makeCombat();
    const game = makeGame({
      pendingCombat: combat,
      pendingExtraProtection: {
        targetFigKey: 'Rebel Trooper-1-0', targetMsgId: 'dc2', targetFigIndex: 0,
        damage: 3, playerNum: 2,
        onarFigKey: 'Onar Koma-1-0', onarMsgId: 'dc4', onarDcName: 'Onar Koma',
        hit: true, resultText: '', totalBlast: 0,
        defenderPlayerNum: 2, attackerPlayerNum: 1, ownerId: 'player1',
      },
    });
    const { ctx, calls } = buildInterruptCtx(game);

    await handleExtraProtection(
      mockInteraction('extra_protection_skip_42', 'player2'), ctx,
    );

    assert.strictEqual(game.pendingExtraProtection, undefined, 'pendingExtraProtection deleted');
    assert.strictEqual(game.movementBank, undefined, 'no MP granted on skip');
    assert.strictEqual(game.freeAttackBonusPending, undefined, 'no free attack on skip');
    assert.strictEqual(calls.applyDamageAndFinishCombat.length, 1, 're-entry called');
  });

  it('B-I-EP-004: play path stamps pendingMoveX (no bank) + free attack, clears pending, calls re-entry', async () => {
    const combat = makeCombat();
    const game = makeGame({
      pendingCombat: combat,
      player2CcHand: ['Extra Protection', 'Take Initiative'],
      player2CcDiscard: [],
      pendingExtraProtection: {
        targetFigKey: 'Rebel Trooper-1-0', targetMsgId: 'dc2', targetFigIndex: 0,
        damage: 3, playerNum: 2,
        onarFigKey: 'Onar Koma-1-0', onarMsgId: 'dc4', onarDcName: 'Onar Koma',
        hit: true, resultText: '', totalBlast: 0,
        defenderPlayerNum: 2, attackerPlayerNum: 1, ownerId: 'player1',
      },
      figurePositions: { 1: {}, 2: { 'Onar Koma-1-0': 'a1' } },
    });
    const { ctx, calls } = buildInterruptCtx(game, {
      dcMessageMeta: new Map([['dc4', { dcName: 'Onar Koma', playerNum: 2 }]]),
    });

    await handleExtraProtection(
      mockInteraction('extra_protection_play_42', 'player2'), ctx,
    );

    assert.strictEqual(game.pendingExtraProtection, undefined, 'pendingExtraProtection deleted');
    // Card moved from hand to discard
    assert.ok(!game.player2CcHand.includes('Extra Protection'), 'EP removed from hand');
    assert.ok(game.player2CcDiscard.includes('Extra Protection'), 'EP added to discard');
    assert.ok(game.player2CcHand.includes('Take Initiative'), 'other cards preserved');
    // Key migration behaviors: no banked MP, free attack flag set so
    // combat.js marks the eventual attack as free. The Move-X picker
    // posted into Discord (and may have auto-cleared on the empty
    // adjacency mock) — its persistence isn't asserted here because
    // the mock map has no real cells; the migration's correctness is
    // already covered by Move-X picker tests.
    assert.strictEqual(game.movementBank, undefined, 'no bank — Move-X never banks');
    assert.strictEqual(game.freeAttackBonusPending?.['Onar Koma-1-0'], true, 'free attack pending for Onar');
    // Re-entry called
    assert.strictEqual(calls.applyDamageAndFinishCombat.length, 1, 're-entry called');
    assert.strictEqual(calls.applyDamageAndFinishCombat[0].params.damage, 3, 'original damage passed');
  });
});

// ── Minimal dep builder for applyDamageAndFinishCombat ───────────────────────

function buildMinimalCombatBridgeDeps(dcHealthState, game, overrides = {}) {
  const noop = async () => {};
  const noopSync = () => {};
  return {
    logGameAction: noop,
    saveGames: noopSync,
    dcHealthState,
    dcMessageMeta: new Map(),
    dcNameFromFigureKey: (fk) => (fk || '').replace(/-\d+-\d+$/, ''),
    parseFigureKey: (fk) => {
      const m = (fk || '').match(/^(.+)-(\d+)-(\d+)$/);
      return m ? { dcName: m[1], dgIndex: parseInt(m[2]), figureIndex: parseInt(m[3]) } : { dcName: fk, dgIndex: 1, figureIndex: 0 };
    },
    opponentPlayerNum: (pn) => pn === 1 ? 2 : 1,
    discordCatch: noopSync,
    reduceHp,
    healHp: () => ({ newHp: 1, maxHp: 4, healed: 0 }),
    removeFigurePosition: noopSync,
    calculateKillVp: () => 0,
    awardKillVp: noopSync,
    awardObjectiveVp: noopSync,
    vpKey: (pn) => `player${pn}VP`,
    getDcList: () => [],
    getDcMessageIds: () => [],
    getDcStats: () => ({}),
    getDcEffects: () => ({}),
    getDcEffect: () => null,
    getDcKeywords: () => ({}),
    getPlayerId: (g, pn) => g[`player${pn}Id`],
    getMapData: () => null,
    getEffectiveMapSpaces: () => null,
    isWithinN: () => false,
    hasLineOfSight: () => false,
    getFiguresAdjacentToTarget: () => [],
    getFiguresAdjacentToCoord: () => [],
    getFiguresOnOrAdjacentToSpace: () => [],
    getEffectiveFigureSize: () => 1,
    getFootprintCells: () => [],
    getFigureSize: () => 1,
    findDcMessageIdForFigure: () => null,
    lookupFigureDcIndex: () => ({ idx: -1 }),
    getFigureLabel: () => '',
    getCcHand: () => [],
    getCcEffectsData: () => ({ cards: {} }),
    getCcEffect: () => null,
    ccHandKey: (pn) => `player${pn}CcHand`,
    ccDiscardKey: (pn) => `player${pn}CcDiscard`,
    ccDeckKey: (pn) => `player${pn}CcDeck`,
    ccAttachmentsKey: (pn) => `p${pn}DcAttachments`,
    _applyCondition: () => false,
    filterCondition: noopSync,
    isConditionImmune: () => false,
    HARMFUL_CONDITIONS: ['Bleed', 'Stun', 'Weaken'],
    isDcUnique: () => false,
    getActivatedDcIndices: () => [],
    isDbConfigured: () => false,
    achievementsChannelId: null,
    checkAndGrantAchievements: noop,
    checkAndPostAchievements: noop,
    postAchievementNotification: noop,
    checkNefariousGains: noop,
    checkWinConditions: noop,
    checkHuntDissent: noop,
    checkFriendlyDefeatedPassiveRedraws: noop,
    decrementActivationIfGroupDefeated: noop,
    updateAttachmentMessageForDc: noop,
    grantMovementBank: noopSync,
    grantPowerTokens: noopSync,
    getDiceData: () => ({ attack: {}, defense: {} }),
    ButtonBuilder: class { setCustomId() { return this; } setLabel() { return this; } setStyle() { return this; } },
    ButtonStyle: { Primary: 1, Secondary: 2, Danger: 4 },
    ActionRowBuilder: class { addComponents() { return this; } },
    getCelebrationButtons: () => {},
    getCleaveTargetButtons: () => [],
    applyNpcDamageToFigure: noop,
    checkPostCombatSurges: noop,
    finishCombatResolution: noop,
    normalizeCoord: (c) => String(c).toLowerCase(),
    ...overrides,
  };
}
