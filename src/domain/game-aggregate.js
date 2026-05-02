import { createDomainEvent } from './events.js';

export class GameAggregate {
  constructor(gameId, state = null, version = 0) {
    this.gameId = gameId;
    this.state = state;
    this.version = version;
    this.uncommittedEvents = [];
  }

  static reconstitute(gameId, snapshot, events, reducer) {
    let state = snapshot?.state || null;
    let version = snapshot?.version || 0;
    for (const event of events) {
      state = reducer(state, event);
      version = event.seq;
    }
    return new GameAggregate(gameId, state, version);
  }

  applyEvent(event, reducer) {
    this.state = reducer(this.state, event);
    this.version = event.seq;
  }

  recordEvent(type, playerId, payload) {
    const event = createDomainEvent(type, this.gameId, playerId, payload, {
      aggregateVersion: this.version + this.uncommittedEvents.length + 1,
    });
    this.uncommittedEvents.push(event);
    return event;
  }

  flushEvents() {
    const events = [...this.uncommittedEvents];
    this.uncommittedEvents = [];
    return events;
  }

  getState() { return this.state; }
  getVersion() { return this.version; }
}
