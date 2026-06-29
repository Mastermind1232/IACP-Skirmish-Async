import { discordCatch } from '../error-handling.js';
/**
 * Special action handler: special_done_
 * Clears the "Done" button and re-posts the activation modal at thread bottom.
 */
export async function handleSpecialDone(interaction, ctx) {
  const match = interaction.customId.match(/^special_done_(.+)_(.+)$/);
  if (!match) return;
  const [, gameId, msgId] = match;
  await interaction.message.edit({
    content: (interaction.message.content || '').replace('Click Done when finished.', '✓ Resolved.'),
    components: [],
  }).catch(discordCatch);
  if (ctx?.repostDcActionsMessage && ctx?.getGame && ctx?.saveGames) {
    const game = ctx.getGame(gameId);
    if (game) {
      await ctx.repostDcActionsMessage(game, msgId, interaction.client).catch(() => {});
      ctx.saveGames(gameId);
    }
  }
}
