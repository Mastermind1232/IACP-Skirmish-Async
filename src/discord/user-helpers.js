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

/**
 * Pre-fetch both players into client.users.cache so subsequent sync
 * getDisplayNameFromId calls resolve to real names instead of falling
 * back to "Player 1" / "Player 2". Call from async render entry points
 * before building scorecard / map payloads.
 *
 * Silently skips AI sentinel IDs and any IDs already cached. Network
 * errors are swallowed — caller will get the fallback name on render,
 * same as before this helper existed.
 */
export async function ensurePlayersCached(client, game) {
  if (!client?.users?.fetch) return;
  const ids = [game?.player1Id, game?.player2Id].filter(Boolean);
  for (const id of ids) {
    if (isAiUserId(id)) continue;
    if (client.users.cache?.has(id)) continue;
    try { await client.users.fetch(id); } catch { /* offline / unknown user */ }
  }
}
