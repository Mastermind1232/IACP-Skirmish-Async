import { GameAggregate } from './game-aggregate.js';
import * as eventStore from './event-store.js';
import * as snapshotStore from './snapshot-store.js';

export class GameRepository {
  constructor(reducer) {
    this.reducer = reducer;
  }

  async load(gameId) {
    const snapshot = await snapshotStore.loadLatestSnapshot(gameId);
    const afterSeq = snapshot?.version || 0;
    const events = await eventStore.getAllEventsSince(gameId, afterSeq);
    return GameAggregate.reconstitute(gameId, snapshot, events, this.reducer);
  }

  async save(aggregate) {
    const events = aggregate.flushEvents();
    if (events.length === 0) return;
    await eventStore.appendEvents(aggregate.gameId, events, null);
    const lastEvent = events[events.length - 1];
    const newVersion = lastEvent.seq;
    if (snapshotStore.shouldSnapshot(newVersion)) {
      await snapshotStore.saveSnapshot(aggregate.gameId, newVersion, aggregate.getState());
    }
  }
}
