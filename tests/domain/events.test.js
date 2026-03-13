import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomainEvent, resetSeqCounter, getSeqCounter } from '../../src/domain/events.js';

describe('createDomainEvent', () => {
  beforeEach(() => {
    resetSeqCounter('game-1', 0);
    resetSeqCounter('game-A', 0);
    resetSeqCounter('game-B', 0);
  });

  it('returns all required fields with correct types', () => {
    const event = createDomainEvent('TestEvent', 'game-1', 'player-1', { foo: 'bar' }, { correlationId: 'corr-1' });
    assert.equal(event.type, 'TestEvent');
    assert.equal(event.gameId, 'game-1');
    assert.equal(event.seq, 1);
    assert.equal(typeof event.timestamp, 'string');
    assert.ok(event.timestamp.includes('T')); // ISO format
    assert.equal(event.playerId, 'player-1');
    assert.equal(event.correlationId, 'corr-1');
    assert.equal(event.aggregateVersion, 1);
    assert.deepEqual(event.payload, { foo: 'bar' });
  });

  it('auto-increments seq per gameId', () => {
    const e1 = createDomainEvent('A', 'game-1', null, {});
    const e2 = createDomainEvent('B', 'game-1', null, {});
    assert.equal(e1.seq, 1);
    assert.equal(e2.seq, 2);
  });

  it('maintains independent seq counters per gameId', () => {
    const eA = createDomainEvent('A', 'game-A', null, {});
    const eB = createDomainEvent('B', 'game-B', null, {});
    assert.equal(eA.seq, 1);
    assert.equal(eB.seq, 1);
  });

  it('resetSeqCounter sets the counter', () => {
    createDomainEvent('A', 'game-1', null, {});
    createDomainEvent('B', 'game-1', null, {});
    createDomainEvent('C', 'game-1', null, {});
    assert.equal(getSeqCounter('game-1'), 3);

    resetSeqCounter('game-1', 10);
    const e4 = createDomainEvent('D', 'game-1', null, {});
    assert.equal(e4.seq, 11);
  });

  it('preserves payload exactly', () => {
    const payload = {
      nested: { deep: [1, 2, 3] },
      flag: true,
      count: 42,
      label: 'hello',
    };
    const event = createDomainEvent('Test', 'game-1', null, payload);
    assert.deepEqual(event.payload, payload);
  });

  it('defaults playerId to null when not provided', () => {
    const event = createDomainEvent('Test', 'game-1', null, {});
    assert.equal(event.playerId, null);
  });

  it('defaults correlationId to null when not in meta', () => {
    const event = createDomainEvent('Test', 'game-1', null, {});
    assert.equal(event.correlationId, null);
  });

  it('defaults payload to empty object when not provided', () => {
    const event = createDomainEvent('Test', 'game-1', null, null);
    assert.deepEqual(event.payload, {});
  });

  it('uses aggregateVersion from meta when provided', () => {
    const event = createDomainEvent('Test', 'game-1', null, {}, { aggregateVersion: 99 });
    assert.equal(event.aggregateVersion, 99);
  });
});
