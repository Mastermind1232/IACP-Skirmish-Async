import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MovementSaga, MOVEMENT_STATES } from '../../../src/domain/sagas/movement-saga.js';

describe('MovementSaga', () => {
  it('start → choose spaces → complete', () => {
    const saga = new MovementSaga('m-1');
    saga.startMovement('Trooper-0-0', 4);
    assert.equal(saga.state.phase, MOVEMENT_STATES.CHOOSING_SPACE);
    assert.equal(saga.state.remaining, 4);

    saga.moveToSpace('A2', 1);
    assert.equal(saga.state.remaining, 3);
    assert.deepEqual(saga.state.path, ['A2']);

    saga.moveToSpace('A3', 1);
    saga.moveToSpace('B3', 1);
    assert.equal(saga.state.remaining, 1);

    saga.complete();
    assert.equal(saga.state.phase, MOVEMENT_STATES.COMPLETED);
    assert.equal(saga.status, 'completed');
  });

  it('interrupt handling', () => {
    const saga = new MovementSaga('m-1');
    saga.startMovement('Trooper-0-0', 4);
    saga.moveToSpace('A2', 1);

    saga.interrupt('bleeding');
    assert.equal(saga.state.phase, MOVEMENT_STATES.INTERRUPTED);
    assert.equal(saga.state.interruptType, 'bleeding');
    assert.deepEqual(saga.getExpectedActions(), []);

    saga.resumeAfterInterrupt();
    assert.equal(saga.state.phase, MOVEMENT_STATES.CHOOSING_SPACE);
    assert.equal(saga.state.interruptType, undefined);
  });

  it('getExpectedActions per phase', () => {
    const saga = new MovementSaga('m-1');
    assert.deepEqual(saga.getExpectedActions(), ['move_mp']);

    saga.state.phase = MOVEMENT_STATES.CHOOSING_SPACE;
    assert.ok(saga.getExpectedActions().includes('move_pick'));

    saga.state.phase = MOVEMENT_STATES.COMPLETED;
    assert.deepEqual(saga.getExpectedActions(), []);
  });
});
