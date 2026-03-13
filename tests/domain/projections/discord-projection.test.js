import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleEvent, getHandledEventTypes } from '../../../src/domain/projections/discord-projection.js';

function makeEvent(type, payload = {}, gameId = 'game-1') {
  return { type, payload, gameId, seq: 1, playerId: null };
}

describe('Discord Projection', () => {
  it('handles DcActivated', () => {
    const result = handleEvent(makeEvent('DcActivated', { msgId: 'm1', dcName: 'Trooper' }));
    assert.deepEqual(result, { action: 'postActivationStart', gameId: 'game-1', data: { msgId: 'm1', dcName: 'Trooper' } });
  });

  it('handles DcEndedActivation', () => {
    const result = handleEvent(makeEvent('DcEndedActivation', { msgId: 'm1' }));
    assert.deepEqual(result, { action: 'postActivationEnd', gameId: 'game-1', data: { msgId: 'm1' } });
  });

  it('handles DcActionPerformed', () => {
    const result = handleEvent(makeEvent('DcActionPerformed', { msgId: 'm1', actionType: 'move' }));
    assert.deepEqual(result, { action: 'logActionPerformed', gameId: 'game-1', data: { msgId: 'm1', actionType: 'move' } });
  });

  it('handles MovementStarted', () => {
    const result = handleEvent(makeEvent('MovementStarted', { figureKey: 'T-0-0' }));
    assert.deepEqual(result, { action: 'logMovementStart', gameId: 'game-1', data: { figureKey: 'T-0-0' } });
  });

  it('handles FigureMoved', () => {
    const result = handleEvent(makeEvent('FigureMoved', { figureKey: 'T-0-0', toCoord: 'B3' }));
    assert.deepEqual(result, { action: 'updateBoardPosition', gameId: 'game-1', data: { figureKey: 'T-0-0', toCoord: 'B3' } });
  });

  it('handles MovementCompleted', () => {
    const result = handleEvent(makeEvent('MovementCompleted', { figureKey: 'T-0-0' }));
    assert.deepEqual(result, { action: 'logMovementEnd', gameId: 'game-1', data: { figureKey: 'T-0-0' } });
  });

  it('handles CombatDiceRolled', () => {
    const result = handleEvent(makeEvent('CombatDiceRolled', { side: 'attack', dice: [{ dmg: 2 }] }));
    assert.deepEqual(result, { action: 'postDiceRoll', gameId: 'game-1', data: { side: 'attack', dice: [{ dmg: 2 }] } });
  });

  it('handles CombatSurgeSpent', () => {
    const result = handleEvent(makeEvent('CombatSurgeSpent', { surgeKey: 'pierce_2' }));
    assert.deepEqual(result, { action: 'logSurgeSpent', gameId: 'game-1', data: { surgeKey: 'pierce_2' } });
  });

  it('handles CombatResolved', () => {
    const result = handleEvent(makeEvent('CombatResolved', { damageDealt: 3, defenderDefeated: true }));
    assert.deepEqual(result, { action: 'postCombatResult', gameId: 'game-1', data: { damageDealt: 3, defenderDefeated: true } });
  });

  it('handles ConditionApplied', () => {
    const result = handleEvent(makeEvent('ConditionApplied', { figureKey: 'T-0-0', condition: 'Stun' }));
    assert.deepEqual(result, { action: 'logConditionApplied', gameId: 'game-1', data: { figureKey: 'T-0-0', condition: 'Stun' } });
  });

  it('handles ConditionRemoved', () => {
    const result = handleEvent(makeEvent('ConditionRemoved', { figureKey: 'T-0-0', condition: 'Stun' }));
    assert.deepEqual(result, { action: 'logConditionRemoved', gameId: 'game-1', data: { figureKey: 'T-0-0', condition: 'Stun' } });
  });

  it('handles PowerTokenGained', () => {
    const result = handleEvent(makeEvent('PowerTokenGained', { figureKey: 'T-0-0', tokenType: 'Hit' }));
    assert.deepEqual(result, { action: 'logTokenGained', gameId: 'game-1', data: { figureKey: 'T-0-0', tokenType: 'Hit' } });
  });

  it('handles PowerTokenSpent', () => {
    const result = handleEvent(makeEvent('PowerTokenSpent', { figureKey: 'T-0-0', tokenType: 'Block' }));
    assert.deepEqual(result, { action: 'logTokenSpent', gameId: 'game-1', data: { figureKey: 'T-0-0', tokenType: 'Block' } });
  });

  it('handles PhaseGateOpened', () => {
    const result = handleEvent(makeEvent('PhaseGateOpened', { gateType: 'deploy_done' }));
    assert.deepEqual(result, { action: 'postGateOpened', gameId: 'game-1', data: { gateType: 'deploy_done' } });
  });

  it('handles PhaseGatePlayerReady', () => {
    const result = handleEvent(makeEvent('PhaseGatePlayerReady', { playerNum: 1 }));
    assert.deepEqual(result, { action: 'updateGateReady', gameId: 'game-1', data: { playerNum: 1 } });
  });

  it('handles PhaseGateCleared', () => {
    const result = handleEvent(makeEvent('PhaseGateCleared', { gateType: 'deploy_done' }));
    assert.deepEqual(result, { action: 'postGateCleared', gameId: 'game-1', data: { gateType: 'deploy_done' } });
  });

  it('handles CardPlayed', () => {
    const result = handleEvent(makeEvent('CardPlayed', { playerNum: 1, cardName: 'Take Initiative' }));
    assert.deepEqual(result, { action: 'logCardPlayed', gameId: 'game-1', data: { playerNum: 1, cardName: 'Take Initiative' } });
  });

  it('handles CardDiscarded', () => {
    const result = handleEvent(makeEvent('CardDiscarded', { playerNum: 2, cardName: 'Urgency' }));
    assert.deepEqual(result, { action: 'logCardDiscarded', gameId: 'game-1', data: { playerNum: 2, cardName: 'Urgency' } });
  });

  it('returns null for unhandled event type', () => {
    const result = handleEvent(makeEvent('SomeUnknownEvent', {}));
    assert.equal(result, null);
  });

  it('getHandledEventTypes returns correct count', () => {
    const types = getHandledEventTypes();
    assert.equal(types.length, 23); // 5 original + 18 new
    assert.ok(types.includes('RoundStarted'));
    assert.ok(types.includes('DcActivated'));
    assert.ok(types.includes('CardDiscarded'));
  });
});
