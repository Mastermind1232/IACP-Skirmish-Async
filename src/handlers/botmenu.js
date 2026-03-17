/**
 * F16/F11: Bot Stuff menu (Kill Game, Forfeit) via /botmenu in Game Log.
 * Kill Game: participants or Admin/Bothelpers only. First confirm wins.
 * Forfeit: participants only. Ends game cleanly with opponent as winner.
 */
import {
  getBotmenuButtons,
  getBotmenuKillConfirmButtons,
  getForfeitConfirmButtons,
} from '../discord/components.js';
import { cleanupGameLock } from '../game/action-queue.js';
import { discordCatch } from '../error-handling.js';
import { clearBuffer, clearSeqCounter as clearEventLogSeqCounter } from '../event-log.js';
import { clearSeqCounter as clearDomainSeqCounter } from '../domain/events.js';
import { clearGameErrorThread } from '../discord/messages.js';
import { cleanupCompanionEmbedDeps } from './post-deploy.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';

const BOTMENU_ALLOWED_KILL_ROLES = ['Admin', 'Bothelpers'];

/** True if user can use Kill Game: participant or has role Admin/Bothelpers. */
function canKillGame(interaction, game) {
  if (game.player1Id === interaction.user.id || game.player2Id === interaction.user.id) return true;
  const member = interaction.member;
  if (!member?.roles?.cache) return false;
  return member.roles.cache.some((r) => BOTMENU_ALLOWED_KILL_ROLES.includes(r.name));
}

/** True if user is a participant in this game. */
function isParticipant(interaction, game) {
  return game.player1Id === interaction.user.id || game.player2Id === interaction.user.id;
}

/**
 * Delete game's Discord category and channels, remove from state and DB. Shared by Kill Game and Archive confirm.
 * @param {object} game - Game state (before deleteGame)
 * @param {string} gameId - game.gameId
 * @param {object} ctx - client, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState, deleteGameFromDb
 */
export async function deleteGameChannelsAndGame(game, gameId, ctx) {
  const {
    client,
    deleteGame,
    saveGames,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    deleteGameFromDb,
  } = ctx;
  let categoryId = game.gameCategoryId;
  if (!categoryId) {
    const generalCh = await fetchGameChannel(client, game.generalId);
    categoryId = generalCh?.parentId;
  }
  if (categoryId) {
    try {
      const guild = (await fetchGameChannel(client, categoryId))?.guild;
      if (guild) {
        const children = guild.channels.cache.filter((c) => c.parentId === categoryId);
        for (const ch of children.values()) await ch.delete().catch(discordCatch);
        await guild.channels.fetch(categoryId).then((cat) => cat?.delete()).catch(discordCatch);
      }
    } catch (err) {
      console.error('deleteGameChannelsAndGame:', err);
    }
  }
  deleteGame(gameId);
  cleanupGameLock(gameId);
  clearBuffer(gameId);
  clearEventLogSeqCounter(gameId);
  clearDomainSeqCounter(gameId);
  clearGameErrorThread(gameId);
  cleanupCompanionEmbedDeps(gameId);
  saveGames();
  if (deleteGameFromDb) await deleteGameFromDb(gameId).catch(discordCatch);
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId === gameId) {
      dcMessageMeta.delete(msgId);
      dcExhaustedState.delete(msgId);
      dcHealthState.delete(msgId);
    }
  }
}

/** Kill Game clicked: check permission, show confirmation. */
export async function handleBotmenuKill(interaction, ctx) {
  const { getGame } = ctx;
  const gameId = interaction.customId.replace('botmenu_kill_', '');
  const game = getGame(gameId);
  if (!game) {
    console.warn('[botmenu] Game not found for gameId:', gameId);
    await interaction.editReply({
      content: 'Game not found.',
      components: [],
    }).catch(discordCatch);
    return;
  }
  if (!canKillGame(interaction, game)) {
    await interaction.editReply({
      content: 'Only game participants or users with the **Admin** or **Bothelpers** role can kill the game.',
      components: [],
    }).catch(discordCatch);
    return;
  }
  await interaction.editReply({
    content: '**Are you sure you want to kill this game?** This will remove the game and its channels.',
    components: [getBotmenuKillConfirmButtons(gameId)],
  }).catch(discordCatch);
}

/** Kill Game Yes: delete channels and game. */
export async function handleBotmenuKillYes(interaction, ctx) {
  const { getGame, logGameErrorToBotLogs } = ctx;
  const gameId = interaction.customId.replace('botmenu_kill_yes_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.editReply({ content: 'Game not found.', components: [] }).catch(discordCatch);
    return;
  }
  if (!canKillGame(interaction, game)) {
    await interaction.editReply({ content: 'You are not allowed to kill this game.', components: [] }).catch(discordCatch);
    return;
  }
  // Update message before deletion (channel will be deleted along with it)
  await interaction.editReply({
    content: `⏳ Deleting **IA Game #${gameId}**...`,
    components: [],
  }).catch(discordCatch);
  try {
    await deleteGameChannelsAndGame(game, gameId, ctx);
  } catch (err) {
    console.error('[botmenu] Kill game error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'botmenu_kill');
  }
}

/** Kill Game No: cancel. */
export async function handleBotmenuKillNo(interaction, ctx) {
  await interaction.editReply({ content: 'Kill game cancelled.', components: [] }).catch(discordCatch);
}

// ── Forfeit ─────────────────────────────────────────────────────────────────

/** Forfeit clicked: check participant, show confirmation. */
export async function handleForfeit(interaction, ctx) {
  const { getGame } = ctx;
  const gameId = interaction.customId.replace('forfeit_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.editReply({ content: 'Game not found.', components: [] }).catch(discordCatch);
    return;
  }
  if (game.ended) {
    await interaction.editReply({ content: 'This game has already ended.', components: [] }).catch(discordCatch);
    return;
  }
  if (!isParticipant(interaction, game)) {
    await interaction.editReply({ content: 'Only game participants can forfeit.', components: [] }).catch(discordCatch);
    return;
  }
  await interaction.editReply({
    content: '**Are you sure you want to forfeit?** This will end the game and award the win to your opponent. Channels will be preserved for review.',
    components: [getForfeitConfirmButtons(gameId)],
  }).catch(discordCatch);
}

/** Forfeit Yes: end game cleanly via postGameOver. */
export async function handleForfeitYes(interaction, ctx) {
  const { getGame, postGameOver, logGameErrorToBotLogs } = ctx;
  const gameId = interaction.customId.replace('forfeit_yes_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.editReply({ content: 'Game not found.', components: [] }).catch(discordCatch);
    return;
  }
  if (game.ended) {
    await interaction.editReply({ content: 'This game has already ended.', components: [] }).catch(discordCatch);
    return;
  }
  if (!isParticipant(interaction, game)) {
    await interaction.editReply({ content: 'Only game participants can forfeit.', components: [] }).catch(discordCatch);
    return;
  }
  const forfeiterId = interaction.user.id;
  const winnerId = forfeiterId === game.player1Id ? game.player2Id : game.player1Id;
  await interaction.editReply({
    content: `<@${forfeiterId}> has forfeited. **<@${winnerId}> wins!**`,
    components: [],
    allowedMentions: { users: [forfeiterId, winnerId] },
  }).catch(discordCatch);
  try {
    await postGameOver(game, interaction.client, winnerId, 'forfeit');
  } catch (err) {
    console.error('[botmenu] Forfeit postGameOver error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'forfeit');
  }
}

/** Forfeit No: cancel. */
export async function handleForfeitNo(interaction, ctx) {
  await interaction.editReply({ content: 'Forfeit cancelled.', components: [] }).catch(discordCatch);
}
