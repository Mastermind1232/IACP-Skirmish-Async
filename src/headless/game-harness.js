/**
 * Game harness: executes handler actions headlessly.
 *
 * Ties together:
 * - Router (customId → handler key)
 * - Handler registry (key → handler function)
 * - Context factory (group → context from deps)
 * - Fake interactions (capture Discord output)
 *
 * Usage:
 *   const harness = createHarness(initialGame, options);
 *   const result = await harness.submitAction(customId, userId);
 *   console.log(harness.getGame());
 */

import { getHandlerKey } from '../router.js';
import { getHandler, getHandlerGroup } from '../handlers/index.js';
import { buildContext } from '../context-factory.js';
import { buildHeadlessDeps } from './headless-deps.js';
import { createFakeInteraction } from './fake-interaction.js';
import { createFakeClient } from './fake-client.js';
import { captureSnapshot, computeDiff } from '../event-log.js';
import { translateDiffToEvents } from '../domain/diff-translator.js';

/**
 * Create a headless game harness for testing.
 *
 * @param {object} initialGame - The starting game state
 * @param {object} [options]
 * @param {object} [options.deps] - Pre-built headless deps (created if omitted)
 * @param {Map} [options.dcMessageMeta] - DC message metadata
 * @param {Map} [options.dcExhaustedState] - DC exhausted state
 * @param {Map} [options.dcHealthState] - DC health state
 * @returns {object} Harness with submitAction, getGame, getMessages, getDeps
 */
export function createHarness(initialGame, options = {}) {
  const lightweight = !!options.lightweight;
  const gamesMap = new Map();
  if (initialGame) {
    gamesMap.set(initialGame.gameId, structuredClone(initialGame));
  }

  const client = createFakeClient();

  const deps = options.deps || buildHeadlessDeps({
    gamesMap,
    client,
    dcMessageMeta: options.dcMessageMeta || new Map(),
    dcExhaustedState: options.dcExhaustedState || new Map(),
    dcHealthState: options.dcHealthState || new Map(),
  });

  // Override getGame/setGame/saveGames to use our local gamesMap
  deps.getGame = (id) => gamesMap.get(id) || null;
  deps.setGame = (id, game) => { gamesMap.set(id, game); };
  deps.saveGames = () => {};
  deps.client = client;

  const allMessages = [];

  function _translateEvents(gameId, handlerKey, playerId, beforeSnap, gamesMap) {
    if (!beforeSnap || !gameId) return [];
    const afterSnap = captureSnapshot(gamesMap.get(gameId));
    const diff = computeDiff(beforeSnap, afterSnap);
    if (!diff) return [];
    return translateDiffToEvents(handlerKey, diff, {
      gameId, playerId, before: beforeSnap, after: afterSnap,
    });
  }

  return {
    /**
     * Submit a handler action headlessly.
     * @param {string} customId - The button/select customId
     * @param {string} userId - The user submitting the action
     * @param {object} [actionOpts] - Additional options (type, values, etc.)
     * @returns {Promise<{ game: object, messages: Array, error?: string }>}
     */
    async submitAction(customId, userId, actionOpts = {}) {
      const type = actionOpts.type || 'button';
      const handlerKey = getHandlerKey(customId, type);

      if (!handlerKey) {
        return {
          game: gamesMap.get(initialGame?.gameId),
          messages: [],
          error: `No handler found for customId: ${customId}`,
        };
      }

      const handler = getHandler(handlerKey);
      if (!handler) {
        return {
          game: gamesMap.get(initialGame?.gameId),
          messages: [],
          error: `No handler function for key: ${handlerKey}`,
        };
      }

      const gameId = initialGame?.gameId;
      const beforeSnap = lightweight ? null : (gameId ? captureSnapshot(gamesMap.get(gameId)) : null);

      const group = getHandlerGroup(handlerKey);
      if (!group) {
        // Handler with no group — call with no context
        const interaction = createFakeInteraction(customId, userId, {
          ...actionOpts,
          client,
          channel: client._channelCache.values().next().value,
        });
        try {
          await handler(interaction);
          if (!lightweight) {
            allMessages.push(...interaction.sentMessages);
            const events = _translateEvents(gameId, handlerKey, userId, beforeSnap, gamesMap);
            return { game: gamesMap.get(gameId), messages: interaction.sentMessages, events };
          }
          return { game: gamesMap.get(gameId), messages: [], events: [] };
        } catch (err) {
          return {
            game: gamesMap.get(gameId),
            messages: lightweight ? [] : interaction.sentMessages,
            error: err.message,
            events: [],
          };
        }
      }

      const context = buildContext(group, deps);
      const interaction = createFakeInteraction(customId, userId, { ...actionOpts, client });

      try {
        await handler(interaction, context);
        if (!lightweight) {
          allMessages.push(...interaction.sentMessages);
          const events = _translateEvents(gameId, handlerKey, userId, beforeSnap, gamesMap);
          return { game: gamesMap.get(gameId), messages: interaction.sentMessages, events };
        }
        return { game: gamesMap.get(gameId), messages: [], events: [] };
      } catch (err) {
        return {
          game: gamesMap.get(gameId),
          messages: lightweight ? [] : interaction.sentMessages,
          error: err.message,
          events: [],
        };
      }
    },

    /**
     * Get the current game state.
     * @param {string} [gameId] - Defaults to initialGame.gameId
     * @returns {object|null}
     */
    getGame(gameId) {
      return gamesMap.get(gameId || initialGame?.gameId) || null;
    },

    /**
     * Get all captured messages across all actions.
     * @returns {Array}
     */
    getMessages() {
      return allMessages;
    },

    /**
     * Get the deps bag (for inspection/override in tests).
     * @returns {object}
     */
    getDeps() {
      return deps;
    },

    /**
     * Get the in-memory games map.
     * @returns {Map}
     */
    getGamesMap() {
      return gamesMap;
    },
  };
}
