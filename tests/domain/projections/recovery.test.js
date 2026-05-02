import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recoverGameFromEvents } from '../../../src/domain/projections/recovery-projection.js';
import { createDomainEvent, resetSeqCounter } from '../../../src/domain/events.js';

describe('recoverGameFromEvents', () => {
  it('replays events from scratch when no snapshot', () => {
    resetSeqCounter('rec-1', 0);
    const events = [
      createDomainEvent('RoundStarted', 'rec-1', null, { roundNumber: 1 }),
      createDomainEvent('RoundStarted', 'rec-1', null, { roundNumber: 2 }),
    ];

    const { state, version } = recoverGameFromEvents({ snapshot: null, events });
    assert.equal(state.currentRound, 2);
    assert.equal(version, 2);
  });

  it('replays from snapshot mid-stream', () => {
    resetSeqCounter('rec-2', 5);
    const snapshot = {
      state: { currentRound: 3, player1VP: { total: 10, kills: 5, objectives: 5 } },
      version: 5,
    };
    const events = [
      createDomainEvent('RoundStarted', 'rec-2', null, { roundNumber: 4 }),
      createDomainEvent('VpAwarded', 'rec-2', 'p1', { playerNum: 1, amount: 2, reason: 'objective' }),
    ];

    const { state, version } = recoverGameFromEvents({ snapshot, events });
    assert.equal(state.currentRound, 4);
    assert.equal(version, 7);
  });

  it('returns empty state with no snapshot and no events', () => {
    const { state, version } = recoverGameFromEvents({ snapshot: null, events: [] });
    assert.deepEqual(state, {});
    assert.equal(version, 0);
  });

  it('snapshot-only recovery (no new events)', () => {
    const snapshot = { state: { currentRound: 5, player1VP: { total: 20, kills: 10, objectives: 10 } }, version: 50 };
    const { state, version } = recoverGameFromEvents({ snapshot, events: [] });
    assert.equal(state.currentRound, 5);
    assert.equal(state.player1VP.total, 20);
    assert.equal(version, 50);
  });
});
