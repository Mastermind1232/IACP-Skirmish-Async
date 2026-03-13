import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Saga } from '../../../src/domain/sagas/saga.js';

describe('Saga base class', () => {
  it('constructor sets all fields', () => {
    const saga = new Saga('s-1', 'test', { foo: 'bar' });
    assert.equal(saga.id, 's-1');
    assert.equal(saga.type, 'test');
    assert.deepEqual(saga.state, { foo: 'bar' });
    assert.equal(saga.status, 'active');
    assert.deepEqual(saga.steps, []);
    assert.ok(saga.createdAt);
  });

  it('recordStep adds entries with timestamp', () => {
    const saga = new Saga('s-1', 'test');
    saga.recordStep('step1', { x: 1 });
    saga.recordStep('step2');
    assert.equal(saga.steps.length, 2);
    assert.equal(saga.steps[0].stepName, 'step1');
    assert.deepEqual(saga.steps[0].data, { x: 1 });
    assert.ok(saga.steps[0].timestamp);
  });

  it('complete/cancel set status', () => {
    const saga = new Saga('s-1', 'test');
    assert.equal(saga.isActive(), true);
    saga.complete();
    assert.equal(saga.status, 'completed');
    assert.equal(saga.isActive(), false);

    const saga2 = new Saga('s-2', 'test');
    saga2.cancel();
    assert.equal(saga2.status, 'cancelled');
    assert.equal(saga2.isActive(), false);
  });

  it('toJSON/fromJSON round-trip', () => {
    const saga = new Saga('s-1', 'test', { count: 5 });
    saga.recordStep('init');
    saga.complete();

    const json = saga.toJSON();
    const restored = Saga.fromJSON(json);

    assert.equal(restored.id, 's-1');
    assert.equal(restored.type, 'test');
    assert.deepEqual(restored.state, { count: 5 });
    assert.equal(restored.status, 'completed');
    assert.equal(restored.steps.length, 1);
    assert.equal(restored.createdAt, saga.createdAt);
  });
});
