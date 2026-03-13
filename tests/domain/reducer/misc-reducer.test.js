import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { vpReducerHandlers } from '../../../src/domain/reducer/vp-reducer.js';
import { setupReducerHandlers } from '../../../src/domain/reducer/setup-reducer.js';
import { abilityReducerHandlers } from '../../../src/domain/reducer/ability-reducer.js';

describe('VP Reducer', () => {
  it('VpAwarded increments total and category', () => {
    let state = { player1VP: { total: 5, kills: 3, objectives: 2 } };
    state = vpReducerHandlers.VpAwarded(state, { playerNum: 1, amount: 2, reason: 'kill' });
    assert.equal(state.player1VP.total, 7);
    assert.equal(state.player1VP.kills, 5);
  });

  it('VpDeducted does not go below 0', () => {
    let state = { player2VP: { total: 1, kills: 1, objectives: 0 } };
    state = vpReducerHandlers.VpDeducted(state, { playerNum: 2, amount: 5, reason: 'kill' });
    assert.equal(state.player2VP.total, 0);
    assert.equal(state.player2VP.kills, 0);
  });

  it('ObjectiveClaimed tracks VP and objective ID', () => {
    let state = { player1VP: { total: 0, kills: 0, objectives: 0 }, claimedObjectives: [] };
    state = vpReducerHandlers.ObjectiveClaimed(state, { playerNum: 1, objectiveId: 'obj-1', vpValue: 3 });
    assert.equal(state.player1VP.objectives, 3);
    assert.equal(state.player1VP.total, 3);
    assert.deepEqual(state.claimedObjectives, ['obj-1']);
  });
});

describe('Setup Reducer', () => {
  it('FigurePlaced adds to figurePositions', () => {
    let state = { figurePositions: {} };
    state = setupReducerHandlers.FigurePlaced(state, {
      figureKey: 'Trooper-0-0', coord: 'A1', playerNum: 1,
    });
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'A1');
  });

  it('AttachmentPlaced adds to dcAttachments', () => {
    let state = { dcAttachments: {} };
    state = setupReducerHandlers.AttachmentPlaced(state, {
      dcName: 'Stormtrooper', attachmentName: 'Cross-Training',
    });
    assert.deepEqual(state.dcAttachments['Stormtrooper'], ['Cross-Training']);
  });
});

describe('Ability Reducer', () => {
  it('InterruptPrompted → InterruptResolved lifecycle', () => {
    let state = {};
    state = abilityReducerHandlers.InterruptPrompted(state, {
      interruptType: 'StillFaster', playerNum: 1, pendingField: 'pendingStillFaster',
    });
    assert.ok(state.pendingStillFaster);
    assert.equal(state.pendingStillFaster.interruptType, 'StillFaster');

    state = abilityReducerHandlers.InterruptResolved(state, {
      interruptType: 'StillFaster', choice: 'skip', pendingField: 'pendingStillFaster',
    });
    assert.equal(state.pendingStillFaster, undefined);
  });

  it('AbilityTriggered records to array', () => {
    let state = { triggeredAbilities: [] };
    state = abilityReducerHandlers.AbilityTriggered(state, { abilityId: 'focus_shot', source: 'cc' });
    assert.equal(state.triggeredAbilities.length, 1);
    assert.equal(state.triggeredAbilities[0].abilityId, 'focus_shot');
  });
});
