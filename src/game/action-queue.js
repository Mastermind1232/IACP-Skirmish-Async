/**
 * Per-game mutex locks using async-mutex.
 * Ensures that only one interaction handler runs per game at a time (FIFO).
 * Different games execute concurrently.
 */
import { Mutex } from 'async-mutex';

/** @type {Map<string, import('async-mutex').Mutex>} */
const gameLocks = new Map();

/**
 * Get (or create) the Mutex for a given gameId.
 * @param {string} gameId
 * @returns {import('async-mutex').Mutex}
 */
export function getGameLock(gameId) {
  if (!gameLocks.has(gameId)) gameLocks.set(gameId, new Mutex());
  return gameLocks.get(gameId);
}

/**
 * Remove the Mutex for a game (call when game ends/is deleted).
 * @param {string} gameId
 */
export function cleanupGameLock(gameId) {
  gameLocks.delete(gameId);
}

/** Lock acquisition timeout (30 seconds). Prevents indefinite hangs if a handler never resolves. */
const LOCK_TIMEOUT_MS = 30_000;

/**
 * Run a handler under the per-game mutex.
 * If gameId is null/undefined, runs without a lock.
 * Times out after LOCK_TIMEOUT_MS to prevent deadlocks.
 * @param {string|null} gameId
 * @param {() => Promise<void>} fn
 */
export async function withGameLock(gameId, fn) {
  if (!gameId) return fn();
  const lock = getGameLock(gameId);
  const release = await Promise.race([
    lock.acquire(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Game lock timeout after ${LOCK_TIMEOUT_MS}ms for ${gameId}`)), LOCK_TIMEOUT_MS)
    ),
  ]);
  try {
    return await fn();
  } finally {
    release();
  }
}
