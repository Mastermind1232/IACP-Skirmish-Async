import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { phaseReducerHandlers } from '../../../src/domain/reducer/phase-reducer.js';
import {
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../../src/game/activation-state.js';

describe('Phase Reducer', () => {
  it('GameCreated → MapSelected → InitiativeDetermined state flow', () => {
    let state = phaseReducerHandlers.GameCreated(null, {
      player1Id: 'p1', player2Id: 'p2', generalId: 'gen-1',
    });
    assert.equal(state.phase, 'map_selection');
    assert.equal(state.player1Id, 'p1');
    assert.equal(state.player2Id, 'p2');
    assert.deepEqual(state.player1VP, { total: 0, kills: 0, objectives: 0 });

    state = phaseReducerHandlers.MapSelected(state, { mapId: 'mos-eisley' });
    assert.equal(state.phase, 'initiative');
    assert.equal(state.selectedMap, 'mos-eisley');

    state = phaseReducerHandlers.InitiativeDetermined(state, { initiativePlayerNum: 1 });
    assert.equal(state.phase, 'zone_selection');
    assert.equal(state.initiativePlayerNum, 1);
  });

  it('DeploymentZoneChosen → DeploymentCompleted state flow', () => {
    let state = { phase: 'zone_selection' };
    state = phaseReducerHandlers.DeploymentZoneChosen(state, { playerNum: 1, zoneId: 'red' });
    assert.equal(state.player1DeploymentZone, 'red');
    assert.equal(state.phase, 'deployment');

    state = phaseReducerHandlers.DeploymentCompleted(state, { playerNum: 1 });
    assert.equal(state.player1Deployed, true);

    state = phaseReducerHandlers.DeploymentCompleted(state, { playerNum: 2 });
    assert.equal(state.player2Deployed, true);
  });

  it('RoundStarted resets all flags', () => {
    const state = { phase: 'round_active', someExistingField: 'keep' };
    const next = phaseReducerHandlers.RoundStarted(state, { roundNumber: 1 });

    assert.equal(next.currentRound, 1);
    assert.equal(next.phase, 'round_active');
    assert.equal(next.roundPhase, 'start_of_round');
    assert.equal(next.someExistingField, 'keep');

    for (const key of ROUND_OBJECT_FLAGS) {
      assert.deepEqual(next[key], {}, `${key} should be {}`);
    }
    for (const key of ROUND_NULL_FLAGS) {
      assert.equal(next[key], null, `${key} should be null`);
    }
    for (const key of ROUND_ARRAY_FLAGS) {
      assert.deepEqual(next[key], [], `${key} should be []`);
    }
    for (const key of ROUND_FALSE_FLAGS) {
      assert.equal(next[key], false, `${key} should be false`);
    }
    for (const key of ROUND_DELETE_FLAGS) {
      assert.equal(next[key], undefined, `${key} should be deleted`);
    }
  });

  it('PhaseGate lifecycle: open → ready × 2 → cleared', () => {
    let state = { phase: 'round_active' };
    state = phaseReducerHandlers.PhaseGateOpened(state, { gateType: 'start_of_round' });
    assert.deepEqual(state.phaseGate, { phase: 'start_of_round', p1Ready: false, p2Ready: false });

    state = phaseReducerHandlers.PhaseGatePlayerReady(state, { playerNum: 1 });
    assert.equal(state.phaseGate.p1Ready, true);
    assert.equal(state.phaseGate.p2Ready, false);

    state = phaseReducerHandlers.PhaseGatePlayerReady(state, { playerNum: 2 });
    assert.equal(state.phaseGate.p1Ready, true);
    assert.equal(state.phaseGate.p2Ready, true);

    state = phaseReducerHandlers.PhaseGateCleared(state);
    assert.equal(state.phaseGate, undefined);
  });

  it('GameEnded sets final state', () => {
    let state = { phase: 'round_active', currentRound: 3 };
    state = phaseReducerHandlers.GameEnded(state, { winnerId: 'p1' });
    assert.equal(state.ended, true);
    assert.equal(state.winnerId, 'p1');
    assert.equal(state.phase, 'ended');
    assert.equal(state.currentRound, 3);
  });
});
