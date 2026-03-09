import { discordCatch } from '../error-handling.js';

export async function requireGame(interaction, getGame, gameId, opts = {}) {
  const game = getGame(gameId);
  if (!game) {
    if (!opts.silent) {
      await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
    }
    return null;
  }
  if (opts.checkEnded && game.ended) {
    if (!opts.silent) {
      await interaction.followUp({ content: 'This game has ended.', ephemeral: true }).catch(discordCatch);
    }
    return null;
  }
  return game;
}
