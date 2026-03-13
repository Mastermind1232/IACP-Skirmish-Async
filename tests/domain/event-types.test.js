import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DOMAIN_EVENT_TYPES, getAllEventTypes, validateEvent } from '../../src/domain/events/index.js';
import { createDomainEvent } from '../../src/domain/events.js';

describe('Domain Event Vocabulary', () => {
  const EXPECTED_COUNT = 70;

  it(`has exactly ${EXPECTED_COUNT} event types registered`, () => {
    const types = getAllEventTypes();
    assert.equal(types.length, EXPECTED_COUNT, `Expected ${EXPECTED_COUNT} types, got ${types.length}: ${types.join(', ')}`);
  });

  it('all event types are string values matching their keys', () => {
    for (const [key, value] of Object.entries(DOMAIN_EVENT_TYPES)) {
      assert.equal(key, value, `Key ${key} should equal value ${value}`);
    }
  });

  it('each event type can be created via createDomainEvent', () => {
    for (const type of getAllEventTypes()) {
      const event = createDomainEvent(type, 'test-game', null, {});
      assert.equal(event.type, type);
      assert.equal(event.gameId, 'test-game');
      assert.ok(event.seq > 0);
    }
  });

  it('events survive JSON round-trip', () => {
    for (const type of getAllEventTypes()) {
      const event = createDomainEvent(type, 'test-game', 'p1', { data: [1, 2, 3] });
      const roundTripped = JSON.parse(JSON.stringify(event));
      assert.deepEqual(roundTripped, event);
    }
  });

  it('validateEvent accepts valid events with required payload fields', () => {
    const event = createDomainEvent('GameCreated', 'g1', 'p1', {
      player1Id: 'p1', player2Id: 'p2', generalId: 'gen1',
    });
    const result = validateEvent(event);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('validateEvent rejects unknown event type', () => {
    const event = createDomainEvent('NonExistentEvent', 'g1', null, {});
    const result = validateEvent(event);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Unknown event type')));
  });

  it('validateEvent rejects missing required payload fields', () => {
    const event = createDomainEvent('GameCreated', 'g1', null, { player1Id: 'p1' });
    const result = validateEvent(event);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('player2Id')));
    assert.ok(result.errors.some(e => e.includes('generalId')));
  });

  it('validateEvent rejects null/undefined event', () => {
    assert.equal(validateEvent(null).valid, false);
    assert.equal(validateEvent(undefined).valid, false);
    assert.equal(validateEvent({}).valid, false);
  });

  it('getAllEventTypes returns sorted array', () => {
    const types = getAllEventTypes();
    const sorted = [...types].sort();
    assert.deepEqual(types, sorted);
  });
});
