import { insertDomainEvent, getDomainEvents, getLatestDomainSeq, isDbConfigured } from '../db.js';
import { shouldSnapshot, saveSnapshot } from './snapshot-store.js';
import { gameReducer } from './reducer/index.js';
import { resetSeqCounter, getSeqCounter } from './events.js';

/**
 * Initialize seq counters for all active games from DB.
 * Call once at startup after loadGames().
 */
export async function initSeqCounters(gameIds) {
  if (!isDbConfigured()) return;
  for (const gameId of gameIds) {
    try {
      const latestSeq = await getLatestDomainSeq(gameId);
      if (latestSeq > 0) {
        resetSeqCounter(gameId, latestSeq);
      }
    } catch (e) {
      console.warn(`[event-store] Failed to init seq for ${gameId}:`, e.message);
    }
  }
  console.log(`[event-store] Initialized seq counters for ${gameIds.length} game(s).`);
}

export async function appendEvents(gameId, events, expectedVersion = null) {
  if (expectedVersion !== null) {
    const currentSeq = await getLatestDomainSeq(gameId);
    if (currentSeq !== expectedVersion) {
      throw new Error(`Concurrency conflict: expected ${expectedVersion}, got ${currentSeq}`);
    }
  }
  for (const event of events) {
    await insertDomainEvent(gameId, event);
  }

  // Auto-snapshot: check if latest seq crosses a snapshot boundary
  if (events.length > 0) {
    const latestSeq = events[events.length - 1].seq;
    if (shouldSnapshot(latestSeq)) {
      try {
        // Replay from last snapshot to build current state
        const snapshotState = await replayToState(gameId);
        if (snapshotState) {
          await saveSnapshot(gameId, latestSeq, snapshotState);
          console.log(`[event-store] Snapshot saved for game ${gameId} at seq ${latestSeq}`);
        }
      } catch (e) {
        console.warn(`[event-store] Snapshot failed for ${gameId}:`, e.message);
      }
    }
  }
}

/**
 * Replay all events for a game to reconstruct state.
 * Uses latest snapshot as starting point for performance.
 */
export async function replayToState(gameId) {
  const { loadLatestSnapshot } = await import('./snapshot-store.js');
  const snapshot = await loadLatestSnapshot(gameId);
  let state = snapshot?.state || {};
  const afterSeq = snapshot?.version || 0;
  const events = await getDomainEvents(gameId, afterSeq, 100000);
  for (const event of events) {
    state = gameReducer(state, event);
  }
  return state;
}

export async function getEvents(gameId, { afterSeq = 0, limit = 1000 } = {}) {
  return getDomainEvents(gameId, afterSeq, limit);
}

export async function getLatestSeq(gameId) {
  return getLatestDomainSeq(gameId);
}

export async function getAllEventsSince(gameId, seq) {
  return getDomainEvents(gameId, seq, 10000);
}
