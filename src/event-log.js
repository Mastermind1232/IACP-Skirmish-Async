/**
 * Event log: captures before/after game state snapshots around handler dispatch.
 * Provides in-memory ring buffer + DB persistence for audit trail.
 */

/** Fields to strip from snapshots (transient/large, not part of game logic). */
const TRANSIENT_FIELDS = ['undoStack', 'moveGridMessageIds'];

/**
 * Deep-clone a game object, stripping transient fields.
 * @param {object} game
 * @returns {object}
 */
export function captureSnapshot(game) {
  if (!game) return null;
  const clone = JSON.parse(JSON.stringify(game, (key, value) => {
    if (TRANSIENT_FIELDS.includes(key)) return undefined;
    return value;
  }));
  return clone;
}

/**
 * Compute a diff between two game snapshots.
 * Returns { set: {key: newValue}, deleted: [key] } for changed top-level keys.
 * Returns null if nothing changed.
 * @param {object} before
 * @param {object} after
 * @returns {{ set: object, deleted: string[] } | null}
 */
export function computeDiff(before, after) {
  if (!before || !after) return null;
  const set = {};
  const deleted = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let hasChanges = false;

  for (const key of allKeys) {
    const bStr = JSON.stringify(before[key]);
    const aStr = JSON.stringify(after[key]);
    if (bStr !== aStr) {
      hasChanges = true;
      if (key in after) {
        set[key] = after[key];
      } else {
        deleted.push(key);
      }
    }
  }

  return hasChanges ? { set, deleted } : null;
}

// ── Per-game sequence counter ────────────────────────────────────────────────

const seqCounters = new Map();

function nextSeq(gameId) {
  const current = seqCounters.get(gameId) || 0;
  const next = current + 1;
  seqCounters.set(gameId, next);
  return next;
}

/**
 * Create an event object with auto-incrementing seq per gameId.
 * @param {string} gameId
 * @param {string} handlerKey
 * @param {string} customId
 * @param {string} playerId
 * @param {object} diff
 * @returns {object}
 */
export function createEvent(gameId, handlerKey, customId, playerId, diff) {
  return {
    gameId,
    seq: nextSeq(gameId),
    handlerKey,
    customId,
    playerId,
    timestamp: new Date().toISOString(),
    diff,
    metadata: null,
  };
}

// ── In-memory ring buffer (last 500 events per game) ─────────────────────────

const MAX_BUFFER_SIZE = 500;
const eventBuffers = new Map();

/**
 * Append an event to the in-memory ring buffer for its game.
 * @param {object} event
 */
export function appendToBuffer(event) {
  const { gameId } = event;
  if (!eventBuffers.has(gameId)) {
    eventBuffers.set(gameId, []);
  }
  const buf = eventBuffers.get(gameId);
  buf.push(event);
  if (buf.length > MAX_BUFFER_SIZE) {
    buf.splice(0, buf.length - MAX_BUFFER_SIZE);
  }
}

/**
 * Get recent events from the in-memory buffer.
 * @param {string} gameId
 * @param {number} count - max events to return (default 10)
 * @returns {object[]}
 */
export function getRecentEvents(gameId, count = 10) {
  const buf = eventBuffers.get(gameId);
  if (!buf || buf.length === 0) return [];
  return buf.slice(-count);
}

/**
 * Clear the buffer for a game (e.g. when game is deleted).
 * @param {string} gameId
 */
export function clearBuffer(gameId) {
  eventBuffers.delete(gameId);
}
