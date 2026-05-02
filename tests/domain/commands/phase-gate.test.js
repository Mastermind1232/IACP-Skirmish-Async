import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePhaseGateReady, handlePhaseGateUnready } from '../../../src/domain/commands/phase-gate-commands.js';
import { createCommand } from '../../../src/domain/commands/index.js';
import { gameReducer } from '../../../src/domain/reducer/index.js';
import { resetSeqCounter } from '../../../src/domain/events.js';

describe('PhaseGateReady command', () => {
  beforeEach(() => {
    resetSeqCounter('gate-1', 0);
  });

  it('P1 ready → emits PhaseGatePlayerReady', () => {
    const state = {
      phaseGate: { phase: 'deployment', p1Ready: false, p2Ready: false },
    };
    const cmd = createCommand('PhaseGateReady', 'gate-1', 'user1', { playerNum: 1 });
    const { events, error } = handlePhaseGateReady(state, cmd);

    assert.equal(error, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'PhaseGatePlayerReady');
    assert.equal(events[0].payload.playerNum, 1);
  });

  it('P2 ready (both ready) → emits PhaseGatePlayerReady + PhaseGateCleared', () => {
    const state = {
      phaseGate: { phase: 'deployment', p1Ready: true, p2Ready: false },
    };
    const cmd = createCommand('PhaseGateReady', 'gate-1', 'user2', { playerNum: 2 });
    const { events, error } = handlePhaseGateReady(state, cmd);

    assert.equal(error, null);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'PhaseGatePlayerReady');
    assert.equal(events[1].type, 'PhaseGateCleared');
    assert.equal(events[1].payload.gateType, 'deployment');
  });

  it('already ready → error', () => {
    const state = {
      phaseGate: { phase: 'deployment', p1Ready: true, p2Ready: false },
    };
    const cmd = createCommand('PhaseGateReady', 'gate-1', 'user1', { playerNum: 1 });
    const { events, error } = handlePhaseGateReady(state, cmd);

    assert.equal(error, 'Player 1 is already ready');
    assert.equal(events.length, 0);
  });

  it('no gate → error', () => {
    const state = {};
    const cmd = createCommand('PhaseGateReady', 'gate-1', 'user1', { playerNum: 1 });
    const { events, error } = handlePhaseGateReady(state, cmd);

    assert.equal(error, 'No phase gate is active');
    assert.equal(events.length, 0);
  });

  it('events apply correctly through reducer', () => {
    let state = {
      phaseGate: { phase: 'deployment', p1Ready: false, p2Ready: false },
    };
    const cmd1 = createCommand('PhaseGateReady', 'gate-1', 'user1', { playerNum: 1 });
    const { events: events1 } = handlePhaseGateReady(state, cmd1);
    state = gameReducer(state, events1[0]);
    assert.equal(state.phaseGate.p1Ready, true);
    assert.equal(state.phaseGate.p2Ready, false);

    const cmd2 = createCommand('PhaseGateReady', 'gate-1', 'user2', { playerNum: 2 });
    const { events: events2 } = handlePhaseGateReady(state, cmd2);
    for (const e of events2) {
      state = gameReducer(state, e);
    }
    assert.equal(state.phaseGate, undefined);
  });
});
