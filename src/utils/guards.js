import { discordCatch } from '../error-handling.js';

export async function requireGame(interaction, getGame, gameId, opts = {}) {
  const game = getGame(gameId);
  const respond = opts.useReply ? interaction.reply.bind(interaction) : interaction.followUp.bind(interaction);
  if (!game) {
    if (!opts.silent) {
      await respond({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
    }
    return null;
  }
  if (opts.checkEnded && game.ended) {
    if (!opts.silent) {
      await respond({ content: 'This game has ended.', ephemeral: true }).catch(discordCatch);
    }
    return null;
  }
  return game;
}

export async function requirePlayer(interaction, game, userId, playerNum, canActAsPlayer, message, opts = {}) {
  if (!canActAsPlayer(game, userId, playerNum)) {
    const respond = opts.useReply ? interaction.reply.bind(interaction) : interaction.followUp.bind(interaction);
    await respond({
      content: message || 'Only the owner can perform this action.',
      ephemeral: true,
    }).catch(discordCatch);
    return false;
  }
  return true;
}

/**
 * Reject the interaction if the user isn't player1 or player2 of the game.
 * Returns true to continue, false (and replies) to bail.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} game
 * @param {string} action - present-tense verb phrase, e.g. "save checkpoints",
 *   "select the map", "use Undo". Inserted into "Only players in this {scope}
 *   can {action}."
 * @param {object} [opts]
 * @param {boolean} [opts.useReply] - use reply() instead of followUp()
 * @param {'game'|'lobby'} [opts.scope] - defaults to 'game'
 * @returns {Promise<boolean>}
 */
export async function requireParticipant(interaction, game, action, opts = {}) {
  const userId = interaction.user.id;
  if (userId === game.player1Id || userId === game.player2Id) return true;
  const scope = opts.scope || 'game';
  const respond = opts.useReply ? interaction.reply.bind(interaction) : interaction.followUp.bind(interaction);
  await respond({
    content: `Only players in this ${scope} can ${action}.`,
    ephemeral: true,
  }).catch(discordCatch);
  return false;
}
