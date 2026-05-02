import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameAggregate } from '../../src/domain/game-aggregate.js';
import { resetSeqCounter } from '../../src/domain/events.js';

const trivialReducer = (state, event) => ({
  ...(state || {}),
  [event.type]: (event.payload?.value ?? true),
  lastSeq: event.seq,
});

describe('GameAggregate', () => {
  beforeEach(() => {
    resetSeqCounter('test-game', 0);
  });

  it('constructor sets fields correctly', () => {
    const agg = new GameAggregate('game-1', { hp: 5 }, 3);
    assert.equal(agg.gameId, 'game-1');
    assert.deepEqual(agg.state, { hp: 5 });
    assert.equal(agg.version, 3);
    assert.deepEqual(agg.uncommittedEvents, []);
  });

  it('constructor defaults state to null and version to 0', () => {
    const agg = new GameAggregate('game-1');
    assert.equal(agg.state, null);
    assert.equal(agg.version, 0);
  });

  it('recordEvent adds to uncommittedEvents with auto-increment version', () => {
    const agg = new GameAggregate('test-game', {}, 5);
    const e1 = agg.recordEvent('Move', 'p1', { x: 1 });
    const e2 = agg.recordEvent('Attack', 'p1', { target: 'fig2' });

    assert.equal(agg.uncommittedEvents.length, 2);
    assert.equal(e1.type, 'Move');
    assert.equal(e1.aggregateVersion, 6);
    assert.equal(e2.aggregateVersion, 7);
    assert.deepEqual(e1.payload, { x: 1 });
  });

  it('flushEvents returns and clears uncommittedEvents', () => {
    const agg = new GameAggregate('test-game', {}, 0);
    agg.recordEvent('A', null, {});
    agg.recordEvent('B', null, {});

    const flushed = agg.flushEvents();
    assert.equal(flushed.length, 2);
    assert.equal(flushed[0].type, 'A');
    assert.equal(flushed[1].type, 'B');
    assert.deepEqual(agg.uncommittedEvents, []);
  });

  it('reconstitute replays events through reducer to build state', () => {
    const events = [
      { type: 'Init', seq: 1, payload: { value: 'started' } },
      { type: 'Update', seq: 2, payload: { value: 'updated' } },
      { type: 'Finish', seq: 3, payload: { value: 'done' } },
    ];

    const agg = GameAggregate.reconstitute('game-1', null, events, trivialReducer);
    assert.equal(agg.gameId, 'game-1');
    assert.equal(agg.version, 3);
    assert.equal(agg.state.Init, 'started');
    assert.equal(agg.state.Update, 'updated');
    assert.equal(agg.state.Finish, 'done');
    assert.equal(agg.state.lastSeq, 3);
  });

  it('reconstitute starts from snapshot when provided', () => {
    const snapshot = { version: 2, state: { Init: 'started', Update: 'updated', lastSeq: 2 } };
    const events = [
      { type: 'Finish', seq: 3, payload: { value: 'done' } },
    ];

    const agg = GameAggregate.reconstitute('game-1', snapshot, events, trivialReducer);
    assert.equal(agg.version, 3);
    assert.equal(agg.state.Init, 'started');
    assert.equal(agg.state.Finish, 'done');
  });

  it('reconstitute with no events and no snapshot returns empty aggregate', () => {
    const agg = GameAggregate.reconstitute('game-1', null, [], trivialReducer);
    assert.equal(agg.version, 0);
    assert.equal(agg.state, null);
  });

  it('applyEvent updates state and version', () => {
    const agg = new GameAggregate('game-1', { count: 0 }, 0);
    const event = { type: 'Increment', seq: 1, payload: { value: 1 } };
    agg.applyEvent(event, trivialReducer);

    assert.equal(agg.version, 1);
    assert.equal(agg.state.Increment, 1);
    assert.equal(agg.state.lastSeq, 1);
  });

  it('getState and getVersion return current values', () => {
    const agg = new GameAggregate('game-1', { x: 42 }, 7);
    assert.deepEqual(agg.getState(), { x: 42 });
    assert.equal(agg.getVersion(), 7);
  });
});
