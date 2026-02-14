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
