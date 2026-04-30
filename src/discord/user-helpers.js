/**
 * Shared helpers for resolving player IDs to display names.
 * Single source of truth for username lookup — avoid duplicating the
 * `globalName || username || fallback` chain across the codebase.
 */
import { isAiUserId } from './channel-helpers.js';

const AI_NAME = 'SKIRBO';

/**
 * Resolve a Discord user ID to a display string.
 * Returns 'SKIRBO' for AI sentinel IDs, the user's globalName/username from
 * the client cache, or the provided fallback when the ID is unknown/missing.
 */
export function getDisplayNameFromId(client, userId, fallback = '') {
  if (!userId) return fallback;
  if (isAiUserId(userId)) return AI_NAME;
  const user = client?.users?.cache?.get(userId);
  return user?.globalName || user?.username || fallback;
}

/**
 * Resolve a player number (1 or 2) to a display name for messages.
 * Falls back to "Player N" so user-facing strings never show raw IDs.
 */
export function getPlayerDisplayName(game, playerNum, client) {
  const id = playerNum === 1 ? game?.player1Id : game?.player2Id;
  return getDisplayNameFromId(client, id, `Player ${playerNum}`);
}
