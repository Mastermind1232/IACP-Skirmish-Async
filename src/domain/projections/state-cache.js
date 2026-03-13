import { gameReducer } from '../reducer/index.js';

export class StateCacheProjection {
  constructor() {
    this._cache = new Map();
  }

  apply(event) {
    const gameId = event.gameId;
    let state = this._cache.get(gameId) || {};
    state = gameReducer(state, event);
    this._cache.set(gameId, state);
    return state;
  }

  applyBatch(events) {
    let state;
    for (const event of events) {
      state = this.apply(event);
    }
    return state;
  }

  get(gameId) {
    return this._cache.get(gameId) || null;
  }

  set(gameId, state) {
    this._cache.set(gameId, state);
  }

  delete(gameId) {
    this._cache.delete(gameId);
  }
}
