// DomainEvent shape:
// { type, gameId, seq, timestamp, playerId, correlationId, aggregateVersion, payload }

const seqCounters = new Map(); // gameId → next seq (in-memory, loaded from DB in 4.1.3)

export function createDomainEvent(type, gameId, playerId, payload, meta = {}) {
  const seq = (seqCounters.get(gameId) || 0) + 1;
  seqCounters.set(gameId, seq);
  return {
    type,
    gameId,
    seq,
    timestamp: new Date().toISOString(),
    playerId: playerId || null,
    correlationId: meta.correlationId || null,
    aggregateVersion: meta.aggregateVersion || seq,
    payload: payload || {},
  };
}

export function resetSeqCounter(gameId, startSeq) { seqCounters.set(gameId, startSeq); }
export function getSeqCounter(gameId) { return seqCounters.get(gameId) || 0; }
export function clearSeqCounter(gameId) { seqCounters.delete(gameId); }
