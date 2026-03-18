/**
 * AI Discord integration: runs AI turns through the real handler pipeline
 * so that Discord messages are sent naturally.
 *
 * After a human player's action, this module checks if the game has an AI player
 * and if it's the AI's turn. If so, it loops through available actions,
 * picks the best one, and dispatches it through the registered handler.
 */

import { getAvailableActions } from '../engine/available-actions.js';
import { pickBestAction } from './strategy.js';
import { getHandlerKey } from '../router.js';
import { getHandler, getHandlerGroup } from '../handlers/index.js';
import { buildContext } from '../context-factory.js';
import { createFakeInteraction } from '../headless/fake-interaction.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { withAtomicGameLock } from '../game/action-queue.js';

/** Sentinel user ID prefix for AI players. */
export const AI_USER_PREFIX = 'ai_player_';

/**
 * Check if a game has an AI player.
 * @param {object} game
 * @returns {{ hasAi: boolean, aiPlayerNum: number|null, aiUserId: string|null }}
 */
export function getAiPlayer(game) {
  if (!game) return { hasAi: false, aiPlayerNum: null, aiUserId: null };
  if (game.aiPlayerNum) {
    const aiUserId = game.aiPlayerNum === 1 ? game.player1Id : game.player2Id;
    return { hasAi: true, aiPlayerNum: game.aiPlayerNum, aiUserId };
  }
  // Check if either player ID starts with AI prefix
  if (game.player1Id?.startsWith(AI_USER_PREFIX)) {
    return { hasAi: true, aiPlayerNum: 1, aiUserId: game.player1Id };
  }
  if (game.player2Id?.startsWith(AI_USER_PREFIX)) {
    return { hasAi: true, aiPlayerNum: 2, aiUserId: game.player2Id };
  }
  return { hasAi: false, aiPlayerNum: null, aiUserId: null };
}

/**
 * Create a live interaction that uses the real Discord client to send messages
 * but doesn't require an actual Discord interaction event.
 *
 * Handlers call interaction.deferUpdate(), followUp(), reply(), etc.
 * This fake wires followUp/reply to send messages to the game's general channel.
 *
 * @param {string} customId - The action's customId
 * @param {string} userId - The AI's user ID
 * @param {object} game - Game state (for channel IDs)
 * @param {object} client - Real Discord client
 * @returns {object} An interaction-like object
 */
export function createLiveAiInteraction(customId, userId, game, client) {
  const sentMessages = [];

  const interaction = {
    customId,
    user: { id: userId, username: 'AI Player' },
    member: { id: userId },
    message: {
      id: 'ai-action-msg',
      content: '',
      embeds: [],
      components: [],
      channel: null, // set below
      edit: async (payload) => {
        sentMessages.push({ type: 'edit', ...payload });
        return interaction.message;
      },
      delete: async () => {},
      pin: async () => {},
      react: async () => {},
    },
    channel: null, // set below
    channelId: game.generalId || 'unknown',
    guild: null, // set below
    values: [],
    fields: { getTextInputValue: () => '' },

    deferUpdate: async () => {},
    deferReply: async () => {},
    followUp: async (payload) => {
      // Send to the game's general channel for visibility
      try {
        if (game.generalId) {
          const ch = await fetchGameChannel(client, game.generalId);
          const content = typeof payload === 'string' ? payload : payload?.content;
          if (content && !payload?.ephemeral) {
            await ch.send({ content, embeds: payload?.embeds, components: payload?.components });
          }
        }
      } catch (err) {
        console.error('[AI] followUp send error:', err.message);
      }
      sentMessages.push({ type: 'followUp', ...(typeof payload === 'string' ? { content: payload } : payload) });
      return { id: 'ai-followup-msg' };
    },
    editReply: async (payload) => {
      sentMessages.push({ type: 'editReply', ...(typeof payload === 'string' ? { content: payload } : payload) });
      return { id: 'ai-editreply-msg' };
    },
    reply: async (payload) => {
      sentMessages.push({ type: 'reply', ...(typeof payload === 'string' ? { content: payload } : payload) });
      return { id: 'ai-reply-msg' };
    },

    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isRepliable: () => true,

    options: {
      getInteger: () => null,
      getString: () => null,
      getUser: () => null,
      getSubcommand: () => null,
    },

    sentMessages,
  };

  return interaction;
}

/**
 * Run AI turns for a game after a human action.
 * Loops until the AI has no more actions or the game ends.
 *
 * @param {object} game - The game state object
 * @param {object} client - Real Discord client
 * @param {function} buildAllDeps - Function to build all dependencies
 * @param {function} getGame - Function to get latest game state
 * @param {object} [options]
 * @param {number} [options.maxSteps=50] - Safety limit per AI turn
 * @param {number} [options.delayMs=1500] - Delay between actions in ms
 * @param {object} [options.deps] - Extra deps for available-actions (dcMessageMeta, etc.)
 * @param {object} [options.atomicOpts] - Options for withAtomicGameLock (getGame, setGame, commitFn, onRollback)
 * @returns {Promise<{ steps: number, actions: string[] }>}
 */
export async function runAiTurnLive(game, client, buildAllDeps, getGame, options = {}) {
  const maxSteps = options.maxSteps || 50;
  const delayMs = options.delayMs ?? 1500;
  const extraDeps = options.deps || {};
  const atomicOpts = options.atomicOpts || null;
  const { hasAi, aiPlayerNum, aiUserId } = getAiPlayer(game);
  if (!hasAi || !aiPlayerNum) return { steps: 0, actions: [] };

  const actionLog = [];

  for (let step = 0; step < maxSteps; step++) {
    // Re-read game state (handlers may have mutated it)
    const currentGame = getGame(game.gameId);
    if (!currentGame || currentGame.ended) {
      return { steps: step, actions: actionLog };
    }

    // Get available actions for the AI
    const actions = getAvailableActions(currentGame, aiPlayerNum, extraDeps);
    if (!actions || actions.length === 0) {
      return { steps: step, actions: actionLog };
    }

    // Pick the best action
    const engineLike = {
      getState: () => currentGame,
      getAvailableActions: (pn) => getAvailableActions(currentGame, pn, extraDeps),
    };
    const result = pickBestAction(engineLike, actions, aiPlayerNum);
    const chosen = result?.action || actions[0];
    if (!chosen?.customId) {
      return { steps: step, actions: actionLog };
    }

    // Add delay for natural pacing (skip on first action)
    if (step > 0 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Dispatch through the real handler pipeline
    try {
      const allDeps = buildAllDeps();
      const handlerKey = getHandlerKey(chosen.customId, 'button');
      if (!handlerKey) {
        console.warn(`[AI] No handler key for customId: ${chosen.customId}`);
        return { steps: step, actions: actionLog };
      }

      const handler = getHandler(handlerKey);
      if (!handler) {
        console.warn(`[AI] No handler for key: ${handlerKey}`);
        return { steps: step, actions: actionLog };
      }

      const group = getHandlerGroup(handlerKey);
      const interaction = createLiveAiInteraction(chosen.customId, aiUserId, currentGame, client);

      // Set up guild reference for handlers that need it
      if (currentGame.guildId) {
        try {
          interaction.guild = await client.guilds.fetch(currentGame.guildId);
        } catch {}
      }

      // Set up channel reference
      if (currentGame.generalId) {
        try {
          interaction.channel = await fetchGameChannel(client, currentGame.generalId);
          interaction.message.channel = interaction.channel;
        } catch {}
      }

      const runHandler = async () => {
        if (group) {
          const ctx = buildContext(group, allDeps);
          await handler(interaction, ctx);
        } else {
          await handler(interaction);
        }
      };

      // Acquire per-game mutex so AI handler doesn't race with human interactions
      if (atomicOpts) {
        await withAtomicGameLock(currentGame.gameId, atomicOpts, runHandler);
      } else {
        await runHandler();
      }

      actionLog.push(chosen.customId);
      console.log(`[AI] Step ${step}: ${chosen.type} → ${chosen.customId}`);
    } catch (err) {
      console.error(`[AI] Step ${step} handler error:`, err.message);
      return { steps: step, actions: actionLog, error: err.message };
    }
  }

  console.warn(`[AI] Reached safety limit of ${maxSteps} steps for game ${game.gameId}`);
  return { steps: maxSteps, actions: actionLog };
}

/**
 * Mark a game as having an AI player.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2 for which player the AI controls
 */
export function markGameAsAi(game, playerNum) {
  game.aiPlayerNum = playerNum;
  const aiUserId = `${AI_USER_PREFIX}${playerNum}`;
  if (playerNum === 1) {
    game.player1Id = aiUserId;
  } else {
    game.player2Id = aiUserId;
  }
}
