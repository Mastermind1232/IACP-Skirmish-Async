/**
 * Lobby state: per-thread lobbies and sent-embed tracking. Used by index (messageCreate) and handlers/lobby.js.
 */

const lobbies = new Map();
const lobbyEmbedSent = new Set();

export function getLobby(threadId) {
  return lobbies.get(threadId);
}

export function setLobby(threadId, lobby) {
  lobbies.set(threadId, lobby);
}

export function hasLobby(threadId) {
  return lobbies.has(threadId);
}

/**
 * Remove a lobby's in-memory state once it's no longer needed.
 * Called when a lobby is converted into a real game (the lobby data
 * has been copied into the game record), and from killgame in case
 * the lobby was killed before transitioning to a game.
 *
 * Without this, `lobbies` accumulates one entry per ever-created
 * lobby thread for the lifetime of the bot process — small but
 * unbounded growth.
 */
export function deleteLobby(threadId) {
  lobbies.delete(threadId);
  lobbyEmbedSent.delete(threadId);
}

export function hasLobbyEmbedSent(threadId) {
  return lobbyEmbedSent.has(threadId);
}

export function markLobbyEmbedSent(threadId) {
  lobbyEmbedSent.add(threadId);
}

/** For handlers that need the Map (e.g. lobby.get(threadId)); prefer getLobby(threadId) where possible. */
export function getLobbiesMap() {
  return lobbies;
}
