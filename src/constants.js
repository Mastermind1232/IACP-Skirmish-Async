/**
 * Shared constants for the bot. Used by index and handlers (via context or direct import).
 */

/** Max number of active (non-ended) games a player can be in. */
export const MAX_ACTIVE_GAMES_PER_PLAYER = 3;

/** TTL for pending illegal-squad resolution (e.g. "Play It Anyway" / "Redo"); after this, prompt is stale. */
export const PENDING_ILLEGAL_TTL_MS = 60 * 60 * 1000;

/** Max undo entries kept per game. Older entries are dropped when exceeded. */
export const MAX_UNDO_DEPTH = 50;
