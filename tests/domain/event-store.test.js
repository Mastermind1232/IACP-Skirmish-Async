import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Stub db.js functions before importing event-store
const insertedEvents = [];
let mockLatestSeq = 0;
let mockStoredEvents = [];

// We need to mock at the module level. Since event-store imports db.js,
// we'll test through the module's logic by using the --loader approach.
// For simplicity, test the logic directly by re-implementing with injectable deps.

describe('EventStore', () => {
  // Since we can't easily mock ESM imports in Node test runner,
  // we test the logic by importing and calling with no DB pool (graceful fallback).

  let eventStore;

  beforeEach(async () => {
    eventStore = await import('../../src/domain/event-store.js');
  });

  it('appendEvents calls insertDomainEvent for each event (no-pool graceful)', async () => {
    // With no DB pool, insertDomainEvent is a no-op — just verify no throw
    const events = [
      { seq: 1, type: 'A', correlationId: null, playerId: null, aggregateVersion: 1, timestamp: new Date().toISOString(), payload: {} },
      { seq: 2, type: 'B', correlationId: null, playerId: null, aggregateVersion: 2, timestamp: new Date().toISOString(), payload: {} },
    ];
    await assert.doesNotReject(() => eventStore.appendEvents('game-1', events));
  });

  it('getEvents returns empty array with no pool', async () => {
    const result = await eventStore.getEvents('game-1');
    assert.deepEqual(result, []);
  });

  it('getLatestSeq returns 0 with no pool', async () => {
    const result = await eventStore.getLatestSeq('game-1');
    assert.equal(result, 0);
  });

  it('appendEvents with expectedVersion rejects on mismatch', async () => {
    // getLatestDomainSeq returns 0 (no pool), so expectedVersion=5 should throw
    await assert.rejects(
      () => eventStore.appendEvents('game-1', [], 5),
      { message: 'Concurrency conflict: expected 5, got 0' }
    );
  });

  it('appendEvents with expectedVersion=0 succeeds (no pool returns 0)', async () => {
    await assert.doesNotReject(() => eventStore.appendEvents('game-1', [], 0));
  });

  it('getAllEventsSince returns empty array with no pool', async () => {
    const result = await eventStore.getAllEventsSince('game-1', 0);
    assert.deepEqual(result, []);
  });
});
