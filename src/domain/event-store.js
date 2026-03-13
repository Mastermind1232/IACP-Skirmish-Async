import { insertDomainEvent, getDomainEvents, getLatestDomainSeq } from '../db.js';

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
