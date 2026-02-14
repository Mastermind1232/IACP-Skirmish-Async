/**
 * Handler registry: map handler key (prefix) to async (interaction, context) => void.
 * Single place to register all handlers; index builds context and calls getHandler(key)(interaction, context).
 */
import { handleLobbyJoin, handleLobbyStart } from './lobby.js';

const HANDLERS = new Map();

function register(key, fn) {
  if (HANDLERS.has(key)) throw new Error(`Duplicate handler: ${key}`);
  HANDLERS.set(key, fn);
}

register('lobby_join_', handleLobbyJoin);
register('lobby_start_', handleLobbyStart);

/**
 * Return the handler for the given key (prefix), or null if none.
 * @param {string} handlerKey - e.g. 'lobby_join_', 'dc_activate_'
 * @returns {((interaction: import('discord.js').Interaction, context: object) => Promise<void>)|null}
 */
export function getHandler(handlerKey) {
  return HANDLERS.get(handlerKey) ?? null;
}

export { handleLobbyJoin, handleLobbyStart } from './lobby.js';
