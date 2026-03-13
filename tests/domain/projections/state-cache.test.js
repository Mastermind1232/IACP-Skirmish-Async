import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateCacheProjection } from '../../../src/domain/projections/state-cache.js';
import { createDomainEvent, resetSeqCounter } from '../../../src/domain/events.js';

describe('StateCacheProjection', () => {
  it('apply events → get state matches reducer output', () => {
    resetSeqCounter('proj-1', 0);
    const proj = new StateCacheProjection();

    const e1 = createDomainEvent('RoundStarted', 'proj-1', null, { roundNumber: 1 });
    proj.apply(e1);

    const state = proj.get('proj-1');
    assert.ok(state);
    assert.equal(state.currentRound, 1);
  });

  it('apply returns updated state', () => {
    resetSeqCounter('proj-2', 0);
    const proj = new StateCacheProjection();

    const e1 = createDomainEvent('RoundStarted', 'proj-2', null, { roundNumber: 3 });
    const result = proj.apply(e1);
    assert.equal(result.currentRound, 3);
  });

  it('batch apply processes multiple events', () => {
    resetSeqCounter('proj-3', 0);
    const proj = new StateCacheProjection();

    const events = [
      createDomainEvent('RoundStarted', 'proj-3', null, { roundNumber: 1 }),
      createDomainEvent('VpAwarded', 'proj-3', 'p1', { playerNum: 1, amount: 3, reason: 'kill' }),
    ];
    const result = proj.applyBatch(events);
    assert.equal(result.currentRound, 1);
    assert.equal(result.player1VP.total, 3);
  });

  it('get returns null for unknown gameId', () => {
    const proj = new StateCacheProjection();
    assert.equal(proj.get('nonexistent'), null);
  });

  it('set and delete work', () => {
    const proj = new StateCacheProjection();
    proj.set('g-1', { currentRound: 5 });
    assert.deepEqual(proj.get('g-1'), { currentRound: 5 });

    proj.delete('g-1');
    assert.equal(proj.get('g-1'), null);
  });
});
