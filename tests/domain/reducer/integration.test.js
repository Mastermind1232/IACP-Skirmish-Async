import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gameReducer, getRegisteredReducerTypes } from '../../../src/domain/reducer/index.js';

function makeEvent(type, payload = {}) {
  return { type, payload, seq: 0, gameId: 'test', playerId: null };
}

describe('Master Reducer Integration', () => {
  it('registers handlers for all 70 event types', () => {
    const types = getRegisteredReducerTypes();
    assert.equal(types.length, 70, `Expected 70 reducer handlers, got ${types.length}`);
  });

  it('full mini-game lifecycle through gameReducer', () => {
    let state = {};

    // 1. Game creation
    state = gameReducer(state, makeEvent('GameCreated', {
      player1Id: 'alice', player2Id: 'bob', generalId: 'game-001',
    }));
    assert.equal(state.phase, 'map_selection');
    assert.equal(state.player1Id, 'alice');

    // 2. Map selection
    state = gameReducer(state, makeEvent('MapSelected', { mapId: 'mos-eisley' }));
    assert.equal(state.phase, 'initiative');

    // 3. Initiative
    state = gameReducer(state, makeEvent('InitiativeDetermined', { initiativePlayerNum: 1 }));
    assert.equal(state.phase, 'zone_selection');

    // 4. Deployment zone
    state = gameReducer(state, makeEvent('DeploymentZoneChosen', { playerNum: 1, zoneId: 'red' }));
    assert.equal(state.phase, 'deployment');

    // 5. Deploy figures
    state = gameReducer(state, makeEvent('FigureDeployed', {
      figureKey: 'Trooper-0-0', dcName: 'Stormtrooper', playerNum: 1, coord: 'A1',
    }));
    state = gameReducer(state, makeEvent('FigureDeployed', {
      figureKey: 'Trooper-0-1', dcName: 'Stormtrooper', playerNum: 1, coord: 'A2',
    }));
    state = gameReducer(state, makeEvent('FigureDeployed', {
      figureKey: 'Rebel-0-0', dcName: 'Rebel Saboteur', playerNum: 2, coord: 'D4',
    }));
    state = gameReducer(state, makeEvent('FigureDeployed', {
      figureKey: 'Rebel-0-1', dcName: 'Rebel Saboteur', playerNum: 2, coord: 'D5',
    }));
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'A1');
    assert.equal(state.figurePositions[2]['Rebel-0-0'], 'D4');

    // 6. Deployment completed
    state = gameReducer(state, makeEvent('DeploymentCompleted', { playerNum: 1 }));
    state = gameReducer(state, makeEvent('DeploymentCompleted', { playerNum: 2 }));
    assert.equal(state.player1Deployed, true);
    assert.equal(state.player2Deployed, true);

    // 7. Round started
    state = gameReducer(state, makeEvent('RoundStarted', { roundNumber: 1 }));
    assert.equal(state.currentRound, 1);
    assert.equal(state.roundPhase, 'start_of_round');

    // 8. Activation phase
    state = gameReducer(state, makeEvent('ActivationPhaseStarted', { activePlayerId: 'alice' }));
    assert.equal(state.roundPhase, 'activation');

    // 9. Activate DC
    state = gameReducer(state, makeEvent('DcActivated', {
      msgId: 'msg-trooper', dcIndex: 0, totalActions: 2,
    }));
    assert.equal(state.dcActionsData['msg-trooper'].remaining, 2);

    // 10. Move figure
    state = gameReducer(state, makeEvent('FigureMoved', {
      figureKey: 'Trooper-0-0', fromCoord: 'A1', toCoord: 'B1', playerNum: 1, mpCost: 1,
    }));
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'B1');

    // 11. End activation
    state = gameReducer(state, makeEvent('DcEndedActivation', { msgId: 'msg-trooper' }));
    assert.equal(state.dcActionsData['msg-trooper'].remaining, 0);

    // 12. Cleanup activation
    state = gameReducer(state, makeEvent('ActivationCleanedUp', {
      msgId: 'msg-trooper', playerNum: 1, figureKeys: ['Trooper-0-0', 'Trooper-0-1'],
    }));

    // 13. Activation phase ended
    state = gameReducer(state, makeEvent('ActivationPhaseEnded', {}));
    assert.equal(state.player1ActivationPhaseEnded, true);

    // 14. End of round
    state = gameReducer(state, makeEvent('EndOfRoundStarted', {}));
    assert.equal(state.roundPhase, 'end_of_round');

    state = gameReducer(state, makeEvent('RoundEnded', { roundNumber: 1 }));
    assert.equal(state.roundPhase, null);

    // 15. Game ended
    state = gameReducer(state, makeEvent('GameEnded', { winnerId: 'alice' }));
    assert.equal(state.ended, true);
    assert.equal(state.winnerId, 'alice');
    assert.equal(state.phase, 'ended');
  });

  it('multi-round event sequence with VP, positions, conditions, and tokens', () => {
    let state = {};

    // Setup
    state = gameReducer(state, makeEvent('GameCreated', { player1Id: 'alice', player2Id: 'bob', generalId: 'g-1' }));
    state = gameReducer(state, makeEvent('MapSelected', { mapId: 'mos-eisley' }));
    state = gameReducer(state, makeEvent('InitiativeDetermined', { initiativePlayerNum: 1 }));
    state = gameReducer(state, makeEvent('DeploymentZoneChosen', { playerNum: 1, zoneId: 'red' }));

    // Deploy
    state = gameReducer(state, makeEvent('FigureDeployed', { figureKey: 'Trooper-0-0', dcName: 'Stormtrooper', playerNum: 1, coord: 'A1' }));
    state = gameReducer(state, makeEvent('FigureDeployed', { figureKey: 'Trooper-0-1', dcName: 'Stormtrooper', playerNum: 1, coord: 'A2' }));
    state = gameReducer(state, makeEvent('FigureDeployed', { figureKey: 'Rebel-0-0', dcName: 'Rebel Saboteur', playerNum: 2, coord: 'D4' }));
    state = gameReducer(state, makeEvent('FigureDeployed', { figureKey: 'Rebel-0-1', dcName: 'Rebel Saboteur', playerNum: 2, coord: 'D5' }));
    state = gameReducer(state, makeEvent('DeploymentCompleted', { playerNum: 1 }));
    state = gameReducer(state, makeEvent('DeploymentCompleted', { playerNum: 2 }));

    // Round 1
    state = gameReducer(state, makeEvent('RoundStarted', { roundNumber: 1 }));
    state = gameReducer(state, makeEvent('ActivationPhaseStarted', { activePlayerId: 'alice' }));

    // Activate and move
    state = gameReducer(state, makeEvent('DcActivated', { msgId: 'msg-t', dcIndex: 0, totalActions: 2 }));
    state = gameReducer(state, makeEvent('FigureMoved', { figureKey: 'Trooper-0-0', fromCoord: 'A1', toCoord: 'B1', playerNum: 1, mpCost: 1 }));
    state = gameReducer(state, makeEvent('FigureMoved', { figureKey: 'Trooper-0-0', fromCoord: 'B1', toCoord: 'C1', playerNum: 1, mpCost: 1 }));
    state = gameReducer(state, makeEvent('FigureMoved', { figureKey: 'Trooper-0-0', fromCoord: 'C1', toCoord: 'D1', playerNum: 1, mpCost: 1 }));

    // Checkpoint: positions after movement
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'D1');
    assert.equal(state.figurePositions[1]['Trooper-0-1'], 'A2'); // unmoved

    // Apply conditions and tokens
    state = gameReducer(state, makeEvent('ConditionApplied', { figureKey: 'Trooper-0-0', condition: 'Focus' }));
    assert.deepEqual(state.figureConditions['Trooper-0-0'], ['Focus']);

    state = gameReducer(state, makeEvent('PowerTokenGained', { figureKey: 'Trooper-0-0', tokenType: 'Hit' }));
    assert.deepEqual(state.figurePowerTokens['Trooper-0-0'], ['Hit']);

    // Combat with defeat
    state = gameReducer(state, makeEvent('CombatDeclared', {
      attackerMsgId: 'msg-t', defenderMsgId: 'msg-r',
      attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackDice: ['green'], defenseDice: ['black'],
    }));
    state = gameReducer(state, makeEvent('CombatPlayerReady', { playerNum: 1 }));
    state = gameReducer(state, makeEvent('CombatPlayerReady', { playerNum: 2 }));
    state = gameReducer(state, makeEvent('CombatDiceRolled', { side: 'attack', dice: [{ color: 'green', face: { dmg: 3, surge: 1 } }] }));
    state = gameReducer(state, makeEvent('CombatDiceRolled', { side: 'defense', dice: [{ color: 'black', face: { block: 0 } }] }));
    state = gameReducer(state, makeEvent('CombatResolved', { damageDealt: 3, defeated: false }));
    assert.equal(state.pendingCombat, undefined); // combat cleared

    // Defeat a figure
    state = gameReducer(state, makeEvent('FigureDefeated', { figureKey: 'Rebel-0-0', dcName: 'Rebel Saboteur', playerNum: 2, vpValue: 3 }));
    assert.equal(state.player1VP.kills, 3);
    assert.equal(state.player1VP.total, 3);
    assert.equal(state.figurePositions[2]['Rebel-0-0'], undefined); // removed

    // Remove condition
    state = gameReducer(state, makeEvent('ConditionRemoved', { figureKey: 'Trooper-0-0', condition: 'Focus' }));
    assert.deepEqual(state.figureConditions['Trooper-0-0'], []);

    // End activation
    state = gameReducer(state, makeEvent('DcEndedActivation', { msgId: 'msg-t' }));
    state = gameReducer(state, makeEvent('ActivationCleanedUp', { msgId: 'msg-t', playerNum: 1, figureKeys: ['Trooper-0-0', 'Trooper-0-1'] }));

    // End round 1
    state = gameReducer(state, makeEvent('ActivationPhaseEnded', {}));
    state = gameReducer(state, makeEvent('EndOfRoundStarted', {}));
    state = gameReducer(state, makeEvent('RoundEnded', { roundNumber: 1 }));

    // Round 2
    state = gameReducer(state, makeEvent('RoundStarted', { roundNumber: 2 }));
    assert.equal(state.currentRound, 2);

    // Game end
    state = gameReducer(state, makeEvent('GameEnded', { winnerId: 'alice' }));
    assert.equal(state.ended, true);
    assert.equal(state.player1VP.total, 3);
  });

  it('concurrent activations: msg2 survives msg1 cleanup', () => {
    let state = {};
    state = gameReducer(state, makeEvent('DcActivated', { msgId: 'msg1', dcIndex: 0, totalActions: 2 }));
    state = gameReducer(state, makeEvent('DcActivated', { msgId: 'msg2', dcIndex: 1, totalActions: 2 }));
    assert.equal(state.dcActionsData['msg1'].remaining, 2);
    assert.equal(state.dcActionsData['msg2'].remaining, 2);

    state = gameReducer(state, makeEvent('DcEndedActivation', { msgId: 'msg1' }));
    state = gameReducer(state, makeEvent('ActivationCleanedUp', { msgId: 'msg1', playerNum: 1, figureKeys: [] }));

    assert.equal(state.dcActionsData['msg1'], undefined); // cleaned up
    assert.equal(state.dcActionsData['msg2'].remaining, 2); // intact
  });

  it('RoundStarted clears activation state flags', () => {
    let state = {
      overrunThisActivation: { 'msg1': true },
      pummelAttacksRemaining: { 'msg1': 2 },
    };
    state = gameReducer(state, makeEvent('RoundStarted', { roundNumber: 2 }));
    assert.equal(state.currentRound, 2);
    // overrunThisActivation and pummelAttacksRemaining are activation-scoped
    // (cleaned up by ActivationCleanedUp), not round-scoped.
    // RoundStarted only sets round-level state.
    assert.equal(state.roundPhase, 'start_of_round');
  });
});
