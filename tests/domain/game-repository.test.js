import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameRepository } from '../../src/domain/game-repository.js';
import { GameAggregate } from '../../src/domain/game-aggregate.js';
import { resetSeqCounter } from '../../src/domain/events.js';

const trivialReducer = (state, event) => ({
  ...(state || {}),
  [event.type]: (event.payload?.value ?? true),
  lastSeq: event.seq,
});

describe('GameRepository', () => {
  beforeEach(() => {
    resetSeqCounter('repo-test', 0);
  });

  it('load returns aggregate (empty when no pool)', async () => {
    const repo = new GameRepository(trivialReducer);
    const agg = await repo.load('repo-test');
    assert.ok(agg instanceof GameAggregate);
    assert.equal(agg.gameId, 'repo-test');
    // No pool → no snapshot, no events → empty
    assert.equal(agg.state, null);
    assert.equal(agg.version, 0);
  });

  it('save does not throw with no pool', async () => {
    const repo = new GameRepository(trivialReducer);
    const agg = new GameAggregate('repo-test', {}, 0);
    agg.recordEvent('TestEvent', null, { value: 1 });
    await assert.doesNotReject(() => repo.save(agg));
    // After save, uncommittedEvents should be flushed
    assert.deepEqual(agg.uncommittedEvents, []);
  });

  it('save with no uncommitted events is a no-op', async () => {
    const repo = new GameRepository(trivialReducer);
    const agg = new GameAggregate('repo-test', {}, 0);
    await assert.doesNotReject(() => repo.save(agg));
  });

  it('constructor stores reducer', () => {
    const repo = new GameRepository(trivialReducer);
    assert.equal(repo.reducer, trivialReducer);
  });
});
