/**
 * BEHAVIORAL oracle tests for DC ability activation and resolution.
 *
 * Representative abilities chosen by archetype:
 *   1. Mounted (Captain Terro)      — movement-linked start-of-activation effect
 *   2. Comms Jammer (ISB Infiltrator Elite) — activation-scoped scalar flag + cleanup
 *   3. Force Choke (Darth Vader)    — targeted hostile 2-phase (enumerate → apply)
 *   4. Dual-Bladed Fury (Seventh Sister) — chooseOne pending/follow-up choice
 *   5. Invasive Procedure (BT-1)    — targeted hostile + selfCondition
 *   6. handleDcAction guards        — cross-cutting guard/rejection tests
 *
 * Test IDs:
 *   B-DC-001: applyStartOfActivationEffects — Mounted
 *   B-DC-002: applyStartOfActivationEffects — Comms Jammer + cleanupActivation
 *   B-DC-003: resolveAbility — Force Choke (targetHostileFigure)
 *   B-DC-004: resolveAbility — Dual-Bladed Fury (chooseOne)
 *   B-DC-005: resolveAbility — Invasive Procedure (targetHostileFigure + selfCondition)
 *   B-DC-006: handleDcAction guards
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyStartOfActivationEffects } from '../../../src/engine/activation-effects.js';
import { cleanupActivation, _registerDcMessageMeta } from '../../../src/game/activation-state.js';
import { resolveAbility } from '../../../src/game/abilities.js';
import { handleDcAction } from '../../../src/handlers/dc-play-area.js';
import { enumerateActivatorSoaDescriptors } from '../../../src/game/soa-orchestrator.js';
import { applyDeferredAbilityEffects } from '../../../src/game/damage-pipeline.js';

// ── Shared helpers ──────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
  return {
    gameId: 'test1',
    player1Id: 'user_p1',
    player2Id: 'user_p2',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    ...overrides,
  };
}

// ── B-DC-001: Mounted (Captain Terro) — orchestrator-driven ─────────────────────
// Per destruct 2026-05-07: Mounted is no longer auto-fired by
// applyStartOfActivationEffects. The SoA orchestrator
// (enumerateActivatorSoaDescriptors) returns a Mounted descriptor that the
// player triggers via the chooser → soa_fire path.

describe('B-DC-001: SoA orchestrator — Mounted descriptor', () => {
  it('applyStartOfActivationEffects no longer auto-grants 3 MP for Captain Terro', () => {
    const game = makeGame();
    const msgId = 'msg_terro';
    const result = applyStartOfActivationEffects(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      displayName: 'Captain Terro [DG 1]',
      msgId,
    });
    assert.ok(!result.applied.some(e => e.effect === 'Mounted'),
      'Mounted is no longer in the applied[] list — it became a SoA descriptor');
    assert.equal(game.movementBank?.[msgId], undefined,
      'movementBank should NOT be auto-set by applyStartOfActivationEffects anymore');
  });

  it('enumerateActivatorSoaDescriptors returns a Mounted descriptor for Captain Terro', () => {
    const game = makeGame();
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      msgId: 'msg_terro',
    });
    const mounted = descriptors.find(d => d.subPromptKey === 'mounted');
    assert.ok(mounted, 'Mounted descriptor must be enumerated');
    assert.equal(mounted.ownerPlayerNum, 1);
    assert.equal(mounted.sourceLabel, 'Mounted');
    assert.equal(mounted.sourceMsgId, 'msg_terro');
  });

  it('does not enumerate Mounted descriptor for unrelated DC', () => {
    const game = makeGame();
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      msgId: 'msg_trooper',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'mounted'),
      'Stormtrooper has no Mounted ability');
  });

  it('does not mutate unrelated game state', () => {
    const game = makeGame({
      figurePositions: { 1: { 'Captain Terro-1-0': 'b3' }, 2: { 'Trooper-1-0': 'c5' } },
    });
    const posBefore = { ...game.figurePositions[1] };
    const condsBefore = { ...game.figureConditions };
    applyStartOfActivationEffects(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      displayName: 'Captain Terro [DG 1]',
      msgId: 'msg_terro',
    });
    enumerateActivatorSoaDescriptors(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      msgId: 'msg_terro',
    });
    assert.deepStrictEqual(game.figurePositions[1], posBefore);
    assert.deepStrictEqual(game.figureConditions, condsBefore);
  });
});

// ── B-DC-002: Comms Jammer (ISB Infiltrator Elite) — orchestrator-driven ────────
// Per destruct 2026-05-07: Comms Jammer is no longer auto-fired. The
// orchestrator returns a comms_jammer descriptor that the activator
// triggers via soa_fire_*_apply, which sets commsJammerActivePlayerNum.

describe('B-DC-002: SoA orchestrator — Comms Jammer descriptor', () => {
  it('applyStartOfActivationEffects no longer auto-sets commsJammerActivePlayerNum', () => {
    const game = makeGame();
    const result = applyStartOfActivationEffects(game, {
      dcName: 'ISB Infiltrator (Elite)',
      playerNum: 1,
      displayName: 'ISB Infiltrator (Elite) [DG 1]',
      msgId: 'msg_isb',
    });
    assert.ok(!result.applied.some(e => e.effect === 'Comms Jammer'),
      'Comms Jammer no longer auto-fires');
    assert.equal(game.commsJammerActivePlayerNum, undefined,
      'flag must NOT be set by applyStartOfActivationEffects anymore');
  });

  it('enumerateActivatorSoaDescriptors returns a comms_jammer descriptor', () => {
    const game = makeGame();
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'ISB Infiltrator (Elite)',
      playerNum: 1,
      msgId: 'msg_isb',
    });
    const cj = descriptors.find(d => d.subPromptKey === 'comms_jammer');
    assert.ok(cj, 'comms_jammer descriptor must be enumerated');
    assert.equal(cj.ownerPlayerNum, 1);
    assert.equal(cj.sourceLabel, 'Comms Jammer');
  });

  it('cleanupActivation removes commsJammerActivePlayerNum (when set by fire path)', () => {
    // Simulate the fire-path having set the flag (handleSoaFire 'apply' branch).
    const game = makeGame({ commsJammerActivePlayerNum: 1 });
    cleanupActivation(game, 'msg_isb', 1, ['ISB Infiltrator (Elite)-1-0']);
    assert.equal(game.commsJammerActivePlayerNum, undefined);
  });
});

// ── B-DC-003: Force Choke (targetHostileFigure, 2-phase) ────────────────────────

describe('B-DC-003: resolveAbility — Force Choke', () => {
  function buildForceChokeContext({ hasLos = true, enemyPositions = {}, choiceIndex, targetFigureKey } = {}) {
    const dcMessageMeta = new Map();
    const dcHealthState = new Map();
    const activatorMsgId = 'msg_vader';
    const enemyMsgId = 'msg_enemy';

    dcMessageMeta.set(activatorMsgId, {
      gameId: 'test1', playerNum: 1, dcName: 'Darth Vader',
      displayName: 'Darth Vader [DG 1]',
    });
    dcMessageMeta.set(enemyMsgId, {
      gameId: 'test1', playerNum: 2, dcName: 'Rebel Trooper',
      displayName: 'Rebel Trooper [DG 1]',
    });

    const game = makeGame({
      figurePositions: {
        1: { 'Darth Vader-1-0': 'b3' },
        2: enemyPositions,
      },
      dcActionsData: { [activatorMsgId]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
    });

    // Set up enemy health
    dcHealthState.set(enemyMsgId, [[5, 5]]);

    const meta = dcMessageMeta.get(activatorMsgId);

    return {
      game, dcMessageMeta, dcHealthState, meta,
      context: {
        game,
        playerNum: 1,
        meta,
        msgId: activatorMsgId,
        dcMessageMeta,
        dcHealthState,
        hasLineOfSight: () => hasLos,
        hasLineOfSightByCoord: () => hasLos,
        getFigureSize: () => '1x1',
        getRange: () => 5,
        getMapData: () => ({ adjacency: {}, spaces: ['b3', 'c5', 'd7'] }),
        choiceIndex,
        targetFigureKey,
      },
    };
  }

  it('Phase 1: enumerates valid enemy targets, returns requiresChoice', () => {
    const { context } = buildForceChokeContext({
      enemyPositions: { 'Rebel Trooper-1-0': 'c5', 'Rebel Trooper-1-1': 'd7' },
    });
    const result = resolveAbility('force_choke', context);
    assert.equal(result.applied, false);
    assert.equal(result.requiresChoice, true);
    assert.ok(Array.isArray(result.choiceOptions));
    assert.ok(result.choiceOptions.length >= 1, 'should have at least 1 target');
    assert.ok(Array.isArray(result.targetFigureKeys));
  });

  it('Phase 1: filters out targets without LOS', () => {
    const { context } = buildForceChokeContext({
      hasLos: false,
      enemyPositions: { 'Rebel Trooper-1-0': 'c5' },
    });
    const result = resolveAbility('force_choke', context);
    // No valid targets when LOS fails
    assert.equal(result.applied, false);
    assert.ok(!result.requiresChoice, 'should not offer choice when no targets');
  });

  it('Phase 2: applies 2 damage via the damage pipeline and queues 1 strain via pendingStrain', async () => {
    const { context, dcHealthState } = buildForceChokeContext({
      enemyPositions: { 'Rebel Trooper-1-0': 'c5' },
      choiceIndex: 0,
      targetFigureKey: 'Rebel Trooper-1-0',
    });
    const result = resolveAbility('force_choke', context);
    assert.equal(result.applied, true);
    // Damage routes through the unified applyDamage pipeline; strain via applyStrain.
    await applyDeferredAbilityEffects(context.game, { dcHealthState });
    const healthAfter = dcHealthState.get('msg_enemy');
    assert.equal(healthAfter[0][0], 3, 'HP should be 5 - 2 (damage only) = 3');
    assert.ok(Array.isArray(result.pendingStrain), 'should queue strain');
    assert.equal(result.pendingStrain.length, 1);
    assert.equal(result.pendingStrain[0].figureKey, 'Rebel Trooper-1-0');
    assert.equal(result.pendingStrain[0].amount, 1);
    assert.equal(result.pendingStrain[0].controllerPlayerNum, 2);
  });

  it('Phase 1: no valid targets returns not-applied', () => {
    const { context } = buildForceChokeContext({ enemyPositions: {} });
    const result = resolveAbility('force_choke', context);
    assert.equal(result.applied, false);
    assert.ok(!result.requiresChoice);
  });

  it('Phase 1 does not mutate game state', () => {
    const { context, game } = buildForceChokeContext({
      enemyPositions: { 'Rebel Trooper-1-0': 'c5' },
    });
    const condsBefore = { ...game.figureConditions };
    resolveAbility('force_choke', context);
    assert.deepStrictEqual(game.figureConditions, condsBefore);
  });
});

// ── B-DC-004: Dual-Bladed Fury (chooseOne, 2-phase) ─────────────────────────────

describe('B-DC-004: resolveAbility — Dual-Bladed Fury', () => {
  function buildDualBladedContext({ choiceIndex } = {}) {
    const game = makeGame({
      figurePositions: { 1: { 'Seventh Sister-1-0': 'b3' }, 2: {} },
      dcActionsData: { msg_7sis: { selectedFigure: 0 } },
    });
    const meta = { gameId: 'test1', playerNum: 1, dcName: 'Seventh Sister', displayName: 'Seventh Sister [DG 1]' };
    // Register meta so figureKeyForActivation can resolve msgId → figureKey
    // for the figureKey-keyed nextAttackReach + nextAttackBonusSurgeAbilities
    // writes (post 2026-05-09 multifigure-independent-activation migration).
    _registerDcMessageMeta(new Map([['msg_7sis', meta]]));
    return {
      game,
      context: { game, playerNum: 1, meta, msgId: 'msg_7sis', choiceIndex },
    };
  }

  it('Phase 1: returns requiresChoice with two options', () => {
    const { context } = buildDualBladedContext();
    const result = resolveAbility('dual_bladed_fury', context);
    assert.equal(result.applied, false);
    assert.equal(result.requiresChoice, true);
    assert.equal(result.choiceOptions.length, 2);
    assert.ok(result.choiceOptions[0].includes('Reach'));
    assert.ok(result.choiceOptions[1].includes('Focused'));
  });

  it('Choice 0 (Reach + Cleave): sets nextAttackReach and nextAttackBonusSurgeAbilities', () => {
    const { context, game } = buildDualBladedContext({ choiceIndex: 0 });
    const result = resolveAbility('dual_bladed_fury', context);
    assert.equal(result.applied, true);
    // Per-figure 2026-05-09 (multifigure-independent-activation rule).
    assert.ok(game.nextAttackReach?.['Seventh Sister-1-0'] === true,
      'nextAttackReach should be set for the activating figure');
    assert.ok(Array.isArray(game.nextAttackBonusSurgeAbilities?.['Seventh Sister-1-0']));
    assert.ok(game.nextAttackBonusSurgeAbilities['Seventh Sister-1-0'].some(s => s.includes('cleave')));
  });

  it('Choice 1 (Focus): applies Focus condition to figure', () => {
    const { context, game } = buildDualBladedContext({ choiceIndex: 1 });
    const result = resolveAbility('dual_bladed_fury', context);
    assert.equal(result.applied, true);
    assert.ok(game.figureConditions?.['Seventh Sister-1-0']?.includes('Focus'),
      'figure should have Focus condition');
  });

  it('Phase 1 does not mutate game state', () => {
    const { context, game } = buildDualBladedContext();
    const condsBefore = JSON.stringify(game.figureConditions);
    resolveAbility('dual_bladed_fury', context);
    assert.equal(JSON.stringify(game.figureConditions), condsBefore);
    assert.equal(game.nextAttackReach, undefined);
    assert.equal(game.nextAttackBonusSurgeAbilities, undefined);
  });

  it('invalid choiceIndex returns requiresChoice again', () => {
    const { context } = buildDualBladedContext({ choiceIndex: 99 });
    const result = resolveAbility('dual_bladed_fury', context);
    assert.equal(result.applied, false);
    assert.equal(result.requiresChoice, true);
  });
});

// ── B-DC-005: Invasive Procedure (targetHostileFigure + selfCondition) ──────────

describe('B-DC-005: resolveAbility — Invasive Procedure', () => {
  // Invasive Procedure has range: 1, so countGameSpaces (which uses the real
  // data-loader getMapData, not the context mock) must resolve to ≤1.
  // Use real map coords from mos-eisley-outskirts where a1 and a2 are adjacent.
  const REAL_MAP_ID = 'mos-eisley-outskirts';
  const ATTACKER_POS = 'a1';
  const ADJACENT_POS = 'a2';

  function buildInvasiveContext({ enemyPositions = {}, choiceIndex, targetFigureKey } = {}) {
    const dcMessageMeta = new Map();
    const dcHealthState = new Map();
    const activatorMsgId = 'msg_bt1';
    const enemyMsgId = 'msg_enemy';

    dcMessageMeta.set(activatorMsgId, {
      gameId: 'test1', playerNum: 1, dcName: 'BT-1',
      displayName: 'BT-1 [DG 1]',
    });
    dcMessageMeta.set(enemyMsgId, {
      gameId: 'test1', playerNum: 2, dcName: 'Rebel Trooper',
      displayName: 'Rebel Trooper [DG 1]',
    });

    const game = makeGame({
      selectedMap: { id: REAL_MAP_ID },
      figurePositions: {
        1: { 'BT-1-1-0': ATTACKER_POS },
        2: enemyPositions,
      },
      dcActionsData: { [activatorMsgId]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 } },
    });

    dcHealthState.set(enemyMsgId, [[4, 4]]);

    const meta = dcMessageMeta.get(activatorMsgId);

    return {
      game, dcMessageMeta, dcHealthState, meta,
      context: {
        game,
        playerNum: 1,
        meta,
        msgId: activatorMsgId,
        dcMessageMeta,
        dcHealthState,
        hasLineOfSight: () => true,
        getRange: () => 1,
        getMapData: () => ({ adjacency: {}, spaces: [] }),
        choiceIndex,
        targetFigureKey,
      },
    };
  }

  it('Phase 2: applies 1 damage via the damage pipeline, queues 1 strain via pendingStrain, applies Bleed to target + Focus to self', async () => {
    const { context, game, dcHealthState } = buildInvasiveContext({
      enemyPositions: { 'Rebel Trooper-1-0': ADJACENT_POS },
      choiceIndex: 0,
      targetFigureKey: 'Rebel Trooper-1-0',
    });
    const result = resolveAbility('invasive_procedure', context);
    assert.equal(result.applied, true);
    // Damage routes through the unified applyDamage pipeline; strain via applyStrain.
    await applyDeferredAbilityEffects(context.game, { dcHealthState });
    const healthAfter = dcHealthState.get('msg_enemy');
    assert.equal(healthAfter[0][0], 3, 'HP should be 4 - 1 (damage only) = 3');
    assert.ok(Array.isArray(result.pendingStrain), 'should queue strain');
    assert.equal(result.pendingStrain.length, 1);
    assert.equal(result.pendingStrain[0].amount, 1);
    // Bleed on target
    assert.ok(game.figureConditions?.['Rebel Trooper-1-0']?.includes('Bleed'),
      'target should have Bleed');
    // Focus on self
    assert.ok(game.figureConditions?.['BT-1-1-0']?.includes('Focus'),
      'activator should have Focus');
  });

  it('no valid targets: selfCondition (Focus) still applied', () => {
    const { context, game } = buildInvasiveContext({ enemyPositions: {} });
    // Phase 1 with no targets — I36 rule: selfCondition applied even with no targets
    const result = resolveAbility('invasive_procedure', context);
    assert.equal(result.applied, true);
    assert.ok(game.figureConditions?.['BT-1-1-0']?.includes('Focus'),
      'selfCondition should apply even with no targets');
  });

  it('Phase 1: enumerates adjacent enemy targets', () => {
    const { context } = buildInvasiveContext({
      enemyPositions: { 'Rebel Trooper-1-0': ADJACENT_POS },
    });
    const result = resolveAbility('invasive_procedure', context);
    assert.equal(result.applied, false);
    assert.equal(result.requiresChoice, true);
    assert.ok(result.targetFigureKeys.includes('Rebel Trooper-1-0'));
  });
});

// ── B-DC-006: handleDcAction guards ─────────────────────────────────────────────

describe('B-DC-006: handleDcAction guards', () => {
  const PLAYER1_ID = 'user_p1';
  const PLAYER2_ID = 'user_p2';
  const MSG_ID = 'testmsg123';

  function buildMockInteraction(customId, userId = PLAYER1_ID) {
    const responses = [];
    return {
      interaction: {
        customId,
        user: { id: userId },
        followUp: async (opts) => { responses.push(opts); return { id: 'resp_1' }; },
        editReply: async () => {},
        channel: { send: async () => ({ id: 'ch_msg' }) },
        message: {},
      },
      responses,
    };
  }

  function buildActionCtx({ game, meta, specials = ['TestSpecial'], specialCosts } = {}) {
    const dcMessageMeta = new Map();
    if (meta) dcMessageMeta.set(meta._msgId || MSG_ID, meta);
    // Per alexanbv 2026-05-13 migration: figureKeyForActivation reads
    // from the module-level meta registry. Register here so per-figure
    // flag reads work in tests.
    _registerDcMessageMeta(dcMessageMeta);
    return {
      getGame: () => game,
      replyIfGameEnded: async () => false,
      dcMessageMeta,
      getDcStats: () => ({ specials, specialCosts: specialCosts || specials.map(() => 1), figures: 1 }),
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
      updateDcActionsMessage: async () => {},
      logGameAction: async () => {},
      saveGames: () => {},
      client: {},
      logGameErrorToBotLogs: () => {},
      extractGameIdFromInteraction: () => 'test1',
      resolveAbility: () => ({ applied: false, manualMessage: 'Resolve manually.' }),
      getMapAttachmentForSpaces: async () => null,
      pushUndo: () => {},
    };
  }

  function makeActionGame(overrides = {}) {
    return makeGame({
      dcActionsData: {
        [MSG_ID]: { remaining: 2, total: 2, specialsUsed: [] },
      },
      ...overrides,
    });
  }

  it('rejects when DC no longer tracked (dcMessageMeta miss)', async () => {
    // customId: dc_special_0_<msgId> → specialIdx=0, msgId=nonexistent
    const { interaction, responses } = buildMockInteraction('dc_special_0_nonexistent', PLAYER1_ID);
    const ctx = buildActionCtx({
      game: makeActionGame(),
      // meta is not set → dcMessageMeta.get will miss
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.ok(responses.some(r => r.content?.includes('no longer tracked')));
  });

  it('rejects wrong player', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_special_0_${MSG_ID}`, 'user_wrong');
    const game = makeActionGame();
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.ok(responses.some(r => r.content?.includes('Only the owner')));
  });

  it('rejects when no actions remaining', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);
    const game = makeActionGame();
    game.dcActionsData[MSG_ID].perFigureRemaining = { 0: 0 };
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.ok(responses.some(r => r.content?.includes('No actions remaining')));
  });

  it('rejects duplicate special (specialsUsed)', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);
    const game = makeActionGame();
    // Per alexanbv 2026-05-13: specialsUsedByFig is per-figure.
    game.dcActionsData[MSG_ID].specialsUsedByFig = { 0: [0] };
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.ok(responses.some(r => r.content?.includes('already been used')));
  });

  it('rejects Disabled figure special action', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);
    const game = makeActionGame();
    game.disabledFigures = ['Test DC [DG 1]'];
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.ok(responses.some(r => r.content?.includes('Disabled')));
  });

  it('rejects when action cost exceeds remaining actions', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_special_0_${MSG_ID}`, PLAYER1_ID);
    const game = makeActionGame();
    game.dcActionsData[MSG_ID].perFigureRemaining = { 0: 1 };
    // Special costs 2 actions
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
      specials: ['Heavy Strike'],
      specialCosts: [2],
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.ok(responses.some(r => r.content?.includes('costs')));
  });

  it('no state mutation on any guard rejection', async () => {
    const game = makeActionGame();
    const snapshot = JSON.stringify(game);
    const { interaction } = buildMockInteraction(`dc_special_0_${MSG_ID}`, 'user_wrong');
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_special_');
    assert.equal(JSON.stringify(game), snapshot, 'game state should not mutate on guard rejection');
  });

  it('To the Limit blocks Move action', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_move_${MSG_ID}_f0`, PLAYER1_ID);
    // Per alexanbv 2026-05-13: activationExtraActionThenStun is keyed by figureKey.
    const game = makeActionGame({
      activationExtraActionThenStun: { 'Test DC-1-0': true },
    });
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_move_');
    assert.ok(responses.some(r => r.content?.includes('To the Limit')));
  });

  it('Stunned figure cannot Move', async () => {
    const { interaction, responses } = buildMockInteraction(`dc_move_${MSG_ID}_f0`, PLAYER1_ID);
    const game = makeActionGame({
      figureConditions: { 'Test DC-1-0': ['Stun'] },
    });
    const ctx = buildActionCtx({
      game,
      meta: { _msgId: MSG_ID, gameId: 'test1', playerNum: 1, dcName: 'Test DC', displayName: 'Test DC [DG 1]' },
    });
    await handleDcAction(interaction, ctx, 'dc_move_');
    assert.ok(responses.some(r => r.content?.includes('Stunned')));
  });
});
