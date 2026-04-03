/**
 * Oracle tests for Companion activation block when host defeated (Wave 7).
 *
 * Rule: COMPANIONS (RULES_REFERENCE.md L919-920):
 *   "If a companion's associated Deployment card or its attached figures
 *    have left play, the companion can no longer activate."
 *
 * Confirmed-safe core:
 *   - Companion is offered for activation when host group is alive
 *   - Companion is NOT offered when host group is defeated (offer-time)
 *   - Handler rejects stale activation attempt when host group is defeated (handler-time)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

// ── ORACLE-COMP-001: Companion Offered When Host Alive ──────────────────

describe('ORACLE-COMP-001: Companion Offered When Host Alive', () => {
  it('001: J4X-7 activation offered when Jarrod Kelvin is alive', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jarrod Kelvin' }, { dcName: 'J4X-7' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Set up companion host map (mirrors post-deploy.js behavior)
    const jarrodFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Jarrod Kelvin-'));
    const j4xFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('J4X-7-'));
    assert.ok(jarrodFigKey, 'Jarrod Kelvin figure should exist');
    assert.ok(j4xFigKey, 'J4X-7 figure should exist');

    game.companionHostMap = {};
    game.companionHostMap[j4xFigKey] = { hostFigureKey: jarrodFigKey, playerNum: 1 };

    const actions = getAvailableActions(game, 1, deps);
    const activateActions = actions.filter(a => a.type === 'activate_dc');
    const dcNames = activateActions.map(a => a.params.dcName);

    assert.ok(
      dcNames.includes('J4X-7'),
      `J4X-7 should be offered for activation when host is alive. Got: [${dcNames}]`
    );
    assert.ok(
      dcNames.includes('Jarrod Kelvin'),
      `Jarrod Kelvin should also be offered. Got: [${dcNames}]`
    );
  });
});

// ── ORACLE-COMP-002: Companion NOT Offered When Host Defeated ───────────

describe('ORACLE-COMP-002: Companion NOT Offered When Host Defeated', () => {
  it('002: J4X-7 activation blocked when Jarrod Kelvin is defeated (offer-time)', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jarrod Kelvin' }, { dcName: 'J4X-7' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Set up companion host map
    const jarrodFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Jarrod Kelvin-'));
    const j4xFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('J4X-7-'));
    assert.ok(jarrodFigKey, 'Jarrod Kelvin figure should exist');
    assert.ok(j4xFigKey, 'J4X-7 figure should exist');

    game.companionHostMap = {};
    game.companionHostMap[j4xFigKey] = { hostFigureKey: jarrodFigKey, playerNum: 1 };

    // Defeat Jarrod Kelvin — remove from figure positions
    delete game.figurePositions[1][jarrodFigKey];

    const actions = getAvailableActions(game, 1, deps);
    const activateActions = actions.filter(a => a.type === 'activate_dc');
    const dcNames = activateActions.map(a => a.params.dcName);

    assert.ok(
      !dcNames.includes('J4X-7'),
      `J4X-7 should NOT be offered when host Jarrod Kelvin is defeated. Got: [${dcNames}]`
    );
    // J4X-7 is still alive on the board, just can't activate
    assert.ok(
      game.figurePositions[1][j4xFigKey],
      'J4X-7 figure should still exist on the board'
    );
  });
});

// ── ORACLE-COMP-003: Handler Rejects Stale Activation After Host Defeat ─

describe('ORACLE-COMP-003: Handler Rejects Stale Activation After Host Defeat', () => {
  it('003: dc_activate_ for J4X-7 rejected when Jarrod Kelvin defeated (handler-time, state-based)', async () => {
    const { game, harness, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jarrod Kelvin' }, { dcName: 'J4X-7' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Set up companion host map
    const jarrodFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Jarrod Kelvin-'));
    const j4xFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('J4X-7-'));
    assert.ok(jarrodFigKey, 'Jarrod Kelvin figure should exist');
    assert.ok(j4xFigKey, 'J4X-7 figure should exist');

    game.companionHostMap = {};
    game.companionHostMap[j4xFigKey] = { hostFigureKey: jarrodFigKey, playerNum: 1 };

    // Defeat Jarrod Kelvin
    delete game.figurePositions[1][jarrodFigKey];

    // Find J4X-7's dcIndex in p1DcList
    const j4xDcIndex = game.p1DcList.findIndex(dc => dc.dcName === 'J4X-7');
    assert.ok(j4xDcIndex >= 0, 'J4X-7 should be in p1DcList');

    // Construct the stale dc_activate_ customId that a cached button would send
    const customId = `dc_activate_${game.gameId}_1_${j4xDcIndex}`;

    // Submit via harness — this calls handleDcActivate through the real handler pipeline
    const result = await harness.submitAction(customId, 'player1');

    // State-based assertion: no dcActionsData should be created for the companion
    const dcActionsData = game.dcActionsData || {};
    const j4xMsgId = (game.p1DcMessageIds || [])[j4xDcIndex];
    assert.ok(
      !dcActionsData[j4xMsgId],
      `dcActionsData should NOT be created for J4X-7 when host is defeated. Keys: [${Object.keys(dcActionsData)}]`
    );

    // Verify no error was thrown (handler should gracefully reject, not crash)
    assert.ok(
      !result.error,
      `Handler should not throw an error: ${result.error || ''}`
    );
  });
});
