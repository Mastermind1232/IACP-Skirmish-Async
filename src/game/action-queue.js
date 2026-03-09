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

/**
 * Run a handler under the per-game mutex.
 * If gameId is null/undefined, runs without a lock.
 * @param {string|null} gameId
 * @param {() => Promise<void>} fn
 */
export async function withGameLock(gameId, fn) {
  if (!gameId) return fn();
  const lock = getGameLock(gameId);
  return lock.runExclusive(fn);
}
