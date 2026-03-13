import { gameReducer } from '../reducer/index.js';

/**
 * Recovers game state by replaying events from a snapshot.
 * Used for disaster recovery or state verification.
 *
 * @param {Object} options
 * @param {Object|null} options.snapshot - { state, version } or null
 * @param {Array} options.events - domain events to replay (post-snapshot)
 * @returns {{ state: Object, version: number }}
 */
export function recoverGameFromEvents({ snapshot, events }) {
  let state = snapshot?.state ? structuredClone(snapshot.state) : {};
  let version = snapshot?.version || 0;

  for (const event of events) {
    state = gameReducer(state, event);
    version = event.aggregateVersion || event.seq || version + 1;
  }

  return { state, version };
}
