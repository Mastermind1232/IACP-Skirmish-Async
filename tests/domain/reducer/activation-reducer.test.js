import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activationReducerHandlers } from '../../../src/domain/reducer/activation-reducer.js';

describe('Activation Reducer', () => {
  it('activate DC → perform 2 actions → end turn → cleanup', () => {
    let state = { dcActionsData: {}, activatedDcIndices: [] };

    state = activationReducerHandlers.DcActivated(state, {
      msgId: 'msg1', dcIndex: 0, totalActions: 2,
    });
    assert.equal(state.dcActionsData['msg1'].remaining, 2);
    assert.equal(state.dcActionsData['msg1'].total, 2);
    assert.deepEqual(state.activatedDcIndices, [0]);

    state = activationReducerHandlers.DcActionPerformed(state, {
      msgId: 'msg1', actionType: 'move', actionCost: 1,
    });
    assert.equal(state.dcActionsData['msg1'].remaining, 1);

    state = activationReducerHandlers.DcActionPerformed(state, {
      msgId: 'msg1', actionType: 'attack', actionCost: 1,
    });
    assert.equal(state.dcActionsData['msg1'].remaining, 0);

    state = activationReducerHandlers.DcEndedActivation(state, { msgId: 'msg1' });
    assert.equal(state.dcActionsData['msg1'].remaining, 0);

    state = activationReducerHandlers.ActivationCleanedUp(state, {
      msgId: 'msg1', playerNum: 1, figureKeys: ['Trooper-0-0'],
    });
    // dcActionsData[msg1] should be cleaned up (it's an ACTIVATION_MSGID_FLAG)
    assert.equal(state.dcActionsData['msg1'], undefined);
  });

  it('ActivationTurnPassed switches player', () => {
    let state = { currentActivationTurnPlayerNum: 1 };
    state = activationReducerHandlers.ActivationTurnPassed(state, { newActivePlayerNum: 2 });
    assert.equal(state.currentActivationTurnPlayerNum, 2);
  });
});
