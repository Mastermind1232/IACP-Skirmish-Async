import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleEndTurn, handlePassActivationTurn, handleActivateDc } from '../../../src/domain/commands/activation-commands.js';
import { handlePerformAction } from '../../../src/domain/commands/dc-play-area-commands.js';
import { createCommand } from '../../../src/domain/commands/index.js';
import { resetSeqCounter } from '../../../src/domain/events.js';

describe('Activation commands', () => {
  beforeEach(() => {
    resetSeqCounter('act-1', 0);
  });

  it('EndTurn → emits DcEndedActivation + ActivationCleanedUp', () => {
    const state = {};
    const cmd = createCommand('EndTurn', 'act-1', 'user1', { msgId: 'msg-123' });
    const { events, error } = handleEndTurn(state, cmd);

    assert.equal(error, null);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'DcEndedActivation');
    assert.equal(events[0].payload.msgId, 'msg-123');
    assert.equal(events[1].type, 'ActivationCleanedUp');
    assert.equal(events[1].payload.msgId, 'msg-123');
  });

  it('EndTurn without msgId → error', () => {
    const state = {};
    const cmd = createCommand('EndTurn', 'act-1', 'user1', {});
    const { error } = handleEndTurn(state, cmd);
    assert.equal(error, 'No msgId provided');
  });

  it('PassActivationTurn → emits ActivationTurnPassed', () => {
    const state = {};
    const cmd = createCommand('PassActivationTurn', 'act-1', 'user1', { playerNum: 1 });
    const { events, error } = handlePassActivationTurn(state, cmd);

    assert.equal(error, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ActivationTurnPassed');
    assert.equal(events[0].payload.newActivePlayerNum, 2);
  });

  it('ActivateDc → emits DcActivated', () => {
    const state = {};
    const cmd = createCommand('ActivateDc', 'act-1', 'user1', {
      msgId: 'msg-456',
      dcName: 'Stormtrooper',
      playerNum: 1,
    });
    const { events, error } = handleActivateDc(state, cmd);

    assert.equal(error, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'DcActivated');
    assert.equal(events[0].payload.dcName, 'Stormtrooper');
    assert.equal(events[0].payload.playerNum, 1);
  });

  it('ActivateDc rejects when not in activation phase', () => {
    const state = { roundPhase: 'end_of_round' };
    const cmd = createCommand('ActivateDc', 'act-1', 'user1', { msgId: 'msg-1', dcName: 'Test', playerNum: 1 });
    const { error } = handleActivateDc(state, cmd);
    assert.equal(error, 'Not in activation phase');
  });

  it('PerformAction rejects when no actions remaining', () => {
    const state = { dcActionsData: { 'msg-1': { remaining: 0 } } };
    const cmd = createCommand('PerformAction', 'act-1', 'user1', { msgId: 'msg-1', actionType: 'move' });
    const { error } = handlePerformAction(state, cmd);
    assert.equal(error, 'No actions remaining');
  });
});
