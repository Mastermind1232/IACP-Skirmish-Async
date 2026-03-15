/**
 * Dark Sub-Chain Tests: targeted deterministic scenarios for interactive
 * handler follow-ups that broad sims can't reach.
 *
 * Priority 1: CC play confirmation chain (cc_confirm_play, cc_choice, cc_space)
 * Priority 2: Weapon choice handlers (arsenal_pick, ee3_pick_die, bo_rifle_pick)
 * Priority 3: Negation (0 hits in telemetry, high impact)
 * Priority 4: Special ability follow-ups (rush push, shoulder rush, false orders,
 *             overwatch placement, orbital bombardment, bomb drop)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';

function buildActionDeps(meta) {
  return {
    dcMessageMeta: meta.dcMessageMeta,
    dcExhaustedState: meta.dcExhaustedState,
    dcHealthState: meta.dcHealthState,
    getDcStats,
    getMapSpaces,
    computeMovementCache,
    getBoardStateForMovement,
    getMovementProfile,
    getPlayableCcFromHand,
  };
}

// ── Priority 1: CC Confirmation Chain ────────────────────────────────────────

describe('CC Confirmation chain (dark)', () => {
  it('pendingCcConfirmation gates actions and returns confirm/cancel', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;

    game.pendingCcConfirmation = { playerNum: 1, card: 'Son of Skywalker', ts: Date.now() };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const types = new Set(actions.map(a => a.type));

    assert.ok(types.has('cc_confirm_play'), 'cc_confirm_play offered to P1');
    assert.ok(types.has('cc_cancel_play'), 'cc_cancel_play offered to P1');
    assert.ok(!types.has('activate_dc'), 'no activate_dc while CC confirm pending');

    // P2 should not see confirm actions
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    assert.strictEqual(p2Actions.filter(a => a.type === 'cc_confirm_play').length, 0, 'P2 does not see cc_confirm_play');
  });

  it('pendingCcChoice gates actions and returns choice options', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;

    game.pendingCcChoice = {
      abilityId: 'retaliation',
      choiceOptions: ['Option A', 'Option B', 'Option C'],
      gameId: game.gameId,
      playerNum: 1,
      card: 'Retaliation',
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const ccChoices = actions.filter(a => a.type === 'cc_choice');

    assert.strictEqual(ccChoices.length, 3, 'three CC choice options returned');
    assert.ok(ccChoices[0].customId.includes('cc_choice_'), 'customId has correct prefix');
    assert.ok(!actions.some(a => a.type === 'activate_dc'), 'no activate_dc while CC choice pending');

    // P2 should get nothing
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    assert.strictEqual(p2Actions.filter(a => a.type === 'cc_choice').length, 0, 'P2 does not see choices');
  });

  it('pendingCcSpaceChoice gates actions and returns valid spaces', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;

    game.pendingCcSpaceChoice = {
      abilityId: 'smoke_grenade',
      gameId: game.gameId,
      playerNum: 1,
      card: 'Smoke Grenade',
      validSpaces: ['a1', 'a2', 'b1'],
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const ccSpaces = actions.filter(a => a.type === 'cc_space');

    assert.strictEqual(ccSpaces.length, 3, 'three CC space options returned');
    assert.ok(ccSpaces[0].customId.includes('cc_space_'), 'customId has correct prefix');
    assert.ok(ccSpaces.some(a => a.params?.space === 'a1'), 'a1 is a valid space option');
  });
});

// ── Priority 3: Negation ─────────────────────────────────────────────────────

describe('Negation gating (dark)', () => {
  it('pendingNegation gates actions for opponent only', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;

    // P1 played a CC, P2 has Negation
    game.pendingNegation = { playedBy: 1, card: 'Son of Skywalker' };

    const actionDeps = buildActionDeps(meta);
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    const p2Types = new Set(p2Actions.map(a => a.type));

    assert.ok(p2Types.has('negation_play'), 'P2 sees negation_play');
    assert.ok(p2Types.has('negation_let_resolve'), 'P2 sees negation_let_resolve');
    assert.ok(!p2Types.has('activate_dc'), 'no activate_dc during negation');

    // P1 should get nothing during negation window
    const p1Actions = getAvailableActions(game, 1, actionDeps);
    assert.strictEqual(p1Actions.length, 0, 'P1 gets no actions during negation window');
  });
});

// ── Priority 4: Rush Push ────────────────────────────────────────────────────

describe('Rush Push (Onar) dark chain', () => {
  it('pendingRushPush gates actions and returns fig targets + skip', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Onar Koma' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    const p2Figs = Object.keys(game.figurePositions[2]);

    game.pendingRushPush = {
      msgId: p1MsgId,
      playerNum: 1,
      targets: p2Figs.slice(0, 2),
      activatorFigureKey: Object.keys(game.figurePositions[1])[0],
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const rushFigs = actions.filter(a => a.type === 'rush_push_fig');
    const rushSkips = actions.filter(a => a.type === 'rush_push_skip');

    assert.ok(rushFigs.length >= 1, 'at least 1 rush_push_fig target offered');
    assert.strictEqual(rushSkips.length, 1, 'exactly 1 rush_push_skip offered');
    assert.ok(!actions.some(a => a.type === 'activate_dc'), 'no activate_dc during rush');

    // P2 should not see rush actions
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    assert.strictEqual(p2Actions.filter(a => a.type === 'rush_push_fig').length, 0, 'P2 does not see rush');
  });

  it('rush_push_fig customId matches handler regex', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Onar Koma' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.pendingRushPush = {
      msgId: p1MsgId,
      playerNum: 1,
      targets: [Object.keys(game.figurePositions[2])[0]],
      activatorFigureKey: Object.keys(game.figurePositions[1])[0],
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const figAction = actions.find(a => a.type === 'rush_push_fig');
    assert.ok(figAction, 'rush_push_fig action exists');

    // Verify customId matches handler regex: /^rush_push_fig_([^_]+)_([^_]+)_(\d+)$/
    const match = figAction.customId.match(/^rush_push_fig_([^_]+)_([^_]+)_(\d+)$/);
    assert.ok(match, `customId "${figAction.customId}" matches handler regex`);
  });
});

// ── Priority 4: Shoulder Rush ────────────────────────────────────────────────

describe('Shoulder Rush (Drokkatta) dark chain', () => {
  it('pendingShoulderRush gates actions and returns fig targets + skip', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Drokkatta' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    const p2Figs = Object.keys(game.figurePositions[2]);

    game.pendingShoulderRush = {
      msgId: p1MsgId,
      playerNum: 1,
      targets: p2Figs.slice(0, 1),
      activatorFigureKey: Object.keys(game.figurePositions[1])[0],
      activatorPos: Object.values(game.figurePositions[1])[0],
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const srFigs = actions.filter(a => a.type === 'shoulder_rush_fig');
    const srSkips = actions.filter(a => a.type === 'shoulder_rush_skip');

    assert.ok(srFigs.length >= 1, 'at least 1 shoulder_rush_fig target offered');
    assert.strictEqual(srSkips.length, 1, 'exactly 1 shoulder_rush_skip offered');
    assert.ok(!actions.some(a => a.type === 'activate_dc'), 'no activate_dc during shoulder rush');
  });
});

// ── Priority 4: False Orders ─────────────────────────────────────────────────

describe('False Orders dark chain', () => {
  it('pendingFalseOrders gates actions for controller and returns move/attack/skip', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Murne Rin' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    const p2Fig = Object.keys(game.figurePositions[2])[0];

    game.pendingFalseOrders = {
      controlledFigureKey: p2Fig,
      controlledPlayerNum: 2,
      controllerPlayerNum: 1,
      murneRinMsgId: p1MsgId,
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const types = new Set(actions.map(a => a.type));

    assert.ok(types.has('false_orders_move'), 'false_orders_move offered');
    assert.ok(types.has('false_orders_attack'), 'false_orders_attack offered');
    assert.ok(types.has('false_orders_skip'), 'false_orders_skip offered');
    assert.ok(!types.has('activate_dc'), 'no activate_dc during false orders');

    // P2 should not see false orders actions (controller is P1)
    const p2Actions = getAvailableActions(game, 2, actionDeps);
    assert.strictEqual(p2Actions.filter(a => a.type === 'false_orders_move').length, 0, 'P2 does not see FO actions');
  });

  it('false_orders_action customId matches handler regex', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Murne Rin' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.pendingFalseOrders = {
      controlledFigureKey: Object.keys(game.figurePositions[2])[0],
      controlledPlayerNum: 2,
      controllerPlayerNum: 1,
      murneRinMsgId: p1MsgId,
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const moveAction = actions.find(a => a.type === 'false_orders_move');
    assert.ok(moveAction, 'false_orders_move exists');

    // Handler regex: /^false_orders_action_([^_]+)_([^_]+)_(move|attack|skip)$/
    const match = moveAction.customId.match(/^false_orders_action_([^_]+)_([^_]+)_(move|attack|skip)$/);
    assert.ok(match, `customId "${moveAction.customId}" matches handler regex`);
  });
});

// ── Priority 4: Overwatch Placement ──────────────────────────────────────────

describe('Overwatch Placement dark chain', () => {
  it('pendingOverwatchPlacement returns space options alongside activation actions (non-blocking)', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'E-Web Engineer' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.pendingOverwatchPlacement = { [p1MsgId]: true };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const owSpaces = actions.filter(a => a.type === 'overwatch_space');

    assert.ok(owSpaces.length > 0, 'overwatch_space actions returned');
    // Non-blocking: activation actions should still be present
    const hasActivation = actions.some(a => a.type === 'activate_dc' || a.type === 'pass_activation_turn');
    assert.ok(hasActivation, 'activation actions still available alongside overwatch');

    // Verify customId matches handler regex: /^overwatch_space_([^_]+)_([^_]+)_(.+)$/
    const match = owSpaces[0].customId.match(/^overwatch_space_([^_]+)_([^_]+)_(.+)$/);
    assert.ok(match, `customId matches handler regex`);
  });
});

// ── Priority 4: Orbital Bombardment ──────────────────────────────────────────

describe('Orbital Bombardment dark chain', () => {
  it('pendingOrbitalBombardment returns space options alongside activation actions', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'E-Web Engineer' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.pendingOrbitalBombardment = {
      msgId: p1MsgId,
      playerNum: 1,
      spacesRemaining: 2,
      spacesChosen: [],
      gameId: game.gameId,
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const obSpaces = actions.filter(a => a.type === 'ob_space');

    assert.ok(obSpaces.length > 0, 'ob_space actions returned');

    // Verify customId matches handler regex: /^ob_space_([^_]+)_([^_]+)_(.+)$/
    const match = obSpaces[0].customId.match(/^ob_space_([^_]+)_([^_]+)_(.+)$/);
    assert.ok(match, `customId matches handler regex`);
  });
});

// ── Priority 4: Bomb Drop ────────────────────────────────────────────────────

describe('Bomb Drop dark chain', () => {
  it('pendingBombDrop returns space options alongside activation actions', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Sabine Wren' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game } = meta;

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];
    game.pendingBombDrop = {
      [p1MsgId]: {
        figureKey: Object.keys(game.figurePositions[1])[0],
        playerNum: 1,
      },
    };

    const actionDeps = buildActionDeps(meta);
    const actions = getAvailableActions(game, 1, actionDeps);
    const bdSpaces = actions.filter(a => a.type === 'bomb_drop_space');

    assert.ok(bdSpaces.length > 0, 'bomb_drop_space actions returned');

    // Verify customId matches handler regex: /^bomb_drop_space_([^_]+)_([^_]+)_(.+)$/
    const match = bdSpaces[0].customId.match(/^bomb_drop_space_([^_]+)_([^_]+)_(.+)$/);
    assert.ok(match, `customId matches handler regex`);
  });
});

// ── Cross-cutting: wrong-player routing ──────────────────────────────────────

describe('Dark chain wrong-player routing', () => {
  it('all dark pending states route to correct player only', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Luke Skywalker' }])
      .withPlayer2Army([{ dcName: 'Darth Vader' }])
      .inRound(1)
      .build();
    const { game } = meta;
    const actionDeps = buildActionDeps(meta);

    const p1MsgId = [...meta.dcMessageMeta.entries()].find(([, m]) => m.playerNum === 1)?.[0];

    // Test each pending state: set for P1, verify P2 gets nothing relevant
    const pendingStates = [
      { key: 'pendingCcConfirmation', value: { playerNum: 1, card: 'Test', ts: Date.now() }, p2Type: 'cc_confirm_play' },
      { key: 'pendingRushPush', value: { msgId: p1MsgId, playerNum: 1, targets: [Object.keys(game.figurePositions[2])[0]], activatorFigureKey: Object.keys(game.figurePositions[1])[0] }, p2Type: 'rush_push_fig' },
      { key: 'pendingShoulderRush', value: { msgId: p1MsgId, playerNum: 1, targets: [Object.keys(game.figurePositions[2])[0]], activatorFigureKey: Object.keys(game.figurePositions[1])[0], activatorPos: 'a1' }, p2Type: 'shoulder_rush_fig' },
      { key: 'pendingFalseOrders', value: { controlledFigureKey: Object.keys(game.figurePositions[2])[0], controlledPlayerNum: 2, controllerPlayerNum: 1, murneRinMsgId: p1MsgId }, p2Type: 'false_orders_move' },
    ];

    for (const { key, value, p2Type } of pendingStates) {
      // Clean all pending states
      for (const { key: k } of pendingStates) delete game[k];

      game[key] = value;
      const p2Actions = getAvailableActions(game, 2, actionDeps);
      const wrongPlayer = p2Actions.filter(a => a.type === p2Type);
      assert.strictEqual(wrongPlayer.length, 0, `P2 does not see ${p2Type} when ${key} is set for P1`);
    }
  });
});
