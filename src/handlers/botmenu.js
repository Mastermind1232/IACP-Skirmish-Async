/**
 * F16/F11: Bot Stuff menu (Archive, Kill Game) via /botmenu in Game Log.
 * Archive: either player. Kill Game: participants or Admin/Bothelpers only.
 * First confirm wins for both.
 */
import {
  getBotmenuButtons,
  getBotmenuArchiveConfirmButtons,
  getBotmenuKillConfirmButtons,
} from '../discord/components.js';
import { cleanupGameLock } from '../game/action-queue.js';

const BOTMENU_ALLOWED_KILL_ROLES = ['Admin', 'Bothelpers'];

/** True if user can use Kill Game: participant or has role Admin/Bothelpers. */
function canKillGame(interaction, game) {
  if (game.player1Id === interaction.user.id || game.player2Id === interaction.user.id) return true;
  const member = interaction.member;
  if (!member?.roles?.cache) return false;
  return member.roles.cache.some((r) => BOTMENU_ALLOWED_KILL_ROLES.includes(r.name));
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
    const generalCh = await client.channels.fetch(game.generalId).catch(() => null);
    categoryId = generalCh?.parentId;
  }
  if (categoryId) {
    try {
      const guild = (await client.channels.fetch(categoryId).catch(() => null))?.guild;
      if (guild) {
        const children = guild.channels.cache.filter((c) => c.parentId === categoryId);
        for (const ch of children.values()) await ch.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
        await guild.channels.fetch(categoryId).then((cat) => cat?.delete()).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
    } catch (err) {
      console.error('deleteGameChannelsAndGame:', err);
    }
  }
  deleteGame(gameId);
  cleanupGameLock(gameId);
  saveGames();
  if (deleteGameFromDb) await deleteGameFromDb(gameId).catch((err) => { console.error('[discord]', err?.message ?? err); });
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId === gameId) {
      dcMessageMeta.delete(msgId);
      dcExhaustedState.delete(msgId);
      dcHealthState.delete(msgId);
    }
  }
}

/** Archive clicked: show confirmation. Either player can click. */
export async function handleBotmenuArchive(interaction, ctx) {
  const { getGame } = ctx;
  const gameId = interaction.customId.replace('botmenu_archive_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found or already deleted.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can archive it.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.followUp({
    content: '**Are you sure you want to archive?** This will remove the game and its channels. First to confirm wins.',
    components: [getBotmenuArchiveConfirmButtons(gameId)],
    ephemeral: false,
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** Kill Game clicked: check permission, show confirmation. */
export async function handleBotmenuKill(interaction, ctx) {
  const { getGame } = ctx;
  const gameId = interaction.customId.replace('botmenu_kill_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found or already deleted.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canKillGame(interaction, game)) {
    await interaction.followUp({
      content: 'Only game participants or users with the **Admin** or **Bothelpers** role can kill the game.',
      ephemeral: true,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.followUp({
    content: '**Are you sure you want to kill this game?** This will remove the game and its channels. First to confirm wins.',
    components: [getBotmenuKillConfirmButtons(gameId)],
    ephemeral: false,
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** Archive Yes: delete channels and game. */
export async function handleBotmenuArchiveYes(interaction, ctx) {
  const { getGame, logGameErrorToBotLogs } = ctx;
  const gameId = interaction.customId.replace('botmenu_archive_yes_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found or already deleted.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  try {
    await deleteGameChannelsAndGame(game, gameId, ctx);
    await interaction.followUp({ content: `Game **IA Game #${gameId}** archived. Channels removed.`, ephemeral: true }).catch(() => {});
  } catch (err) {
    console.error('Archive error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'botmenu_archive');
    await interaction.followUp({ content: `Failed: ${err.message}`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}

/** Archive No: cancel. */
export async function handleBotmenuArchiveNo(interaction, ctx) {
  await interaction.editReply({ content: 'Cancelled.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** Kill Game Yes: delete channels and game. */
export async function handleBotmenuKillYes(interaction, ctx) {
  const { getGame, logGameErrorToBotLogs } = ctx;
  const gameId = interaction.customId.replace('botmenu_kill_yes_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found or already deleted.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canKillGame(interaction, game)) {
    await interaction.followUp({ content: 'You are not allowed to kill this game.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  try {
    await deleteGameChannelsAndGame(game, gameId, ctx);
    await interaction.followUp({ content: `Game **IA Game #${gameId}** deleted. All channels removed.`, ephemeral: true }).catch(() => {});
  } catch (err) {
    console.error('Kill game error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'botmenu_kill');
    await interaction.followUp({ content: `Failed: ${err.message}`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}

/** Kill Game No: cancel. */
export async function handleBotmenuKillNo(interaction, ctx) {
  await interaction.editReply({ content: 'Cancelled.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}
