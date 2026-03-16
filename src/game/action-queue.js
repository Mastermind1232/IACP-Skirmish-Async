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

/**
 * Run a handler under the per-game mutex with snapshot/rollback atomicity.
 * Before executing fn, snapshots the current game state. If fn throws,
 * restores the snapshot so partial mutations never persist.
 * After successful execution, calls commitFn (typically await saveGames()).
 *
 * @param {string|null} gameId
 * @param {object} opts
 * @param {(id: string) => object} opts.getGame - retrieve game from Map
 * @param {(id: string, game: object) => void} opts.setGame - replace game in Map
 * @param {() => Promise<void>} opts.commitFn - called after success (e.g. saveGames)
 * @param {(id: string) => void} [opts.onRollback] - called after rollback (e.g. rebuild DC maps)
 * @param {() => Promise<void>} fn - the handler to execute
 */
export async function withAtomicGameLock(gameId, opts, fn) {
  if (!gameId) return fn();
  const lock = getGameLock(gameId);
  return lock.runExclusive(async () => {
    const game = opts.getGame(gameId);
    let snapshot = null;
    if (game) {
      try {
        snapshot = JSON.parse(JSON.stringify(game));
      } catch (cloneErr) {
        console.error(`[atomicity] Failed to snapshot game ${gameId}:`, cloneErr.message);
        // Fall through without snapshot — better to run without rollback than to block
      }
    }
    try {
      await fn();
      // Commit: persist after successful handler
      if (opts.commitFn) {
        await opts.commitFn();
      }
    } catch (err) {
      // Rollback: restore pre-handler state
      if (snapshot && opts.setGame) {
        console.error(`[atomicity] Handler threw for game ${gameId} — rolling back to pre-handler snapshot.`);
        opts.setGame(gameId, snapshot);
        if (opts.onRollback) {
          try { opts.onRollback(gameId); } catch (rbErr) {
            console.error(`[atomicity] onRollback failed for ${gameId}:`, rbErr.message);
          }
        }
      }
      throw err; // re-throw so outer catch can log/report
    }
  });
}
