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
import { parseCustomId } from '../discord/custom-id.js';
import { cleanupCompanionEmbedDeps } from './post-deploy.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { getIncidentMirrorsForGame, markIncidentMirrorsCleaned } from '../db.js';

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
 * Clean up Discord mirrors for all incidents associated with a game.
 * Queries the incidents table for posted mirrors, deletes threads/messages, marks cleaned.
 */
async function cleanupIncidentMirrors(gameId, client) {
  try {
    const mirrors = await getIncidentMirrorsForGame(gameId);
    if (!mirrors.length) return;
    const threadIds = new Set();
    const cleanedIds = [];
    for (const m of mirrors) {
      cleanedIds.push(m.id);
      // Collect unique thread IDs for deletion (threads contain all messages)
      if (m.discord_thread_id) {
        threadIds.add(m.discord_thread_id);
      } else if (m.discord_message_id) {
        // Standalone message in bot-logs channel (no thread) — delete individually
        try {
          const ch = await fetchGameChannel(client, BOT_LOGS_CHANNEL_ID);
          if (ch) {
            const msg = await ch.messages.fetch(m.discord_message_id).catch(() => null);
            if (msg) await msg.delete().catch(discordCatch);
          }
        } catch {}
      }
    }
    // Delete error threads (each thread delete removes all messages in it)
    for (const threadId of threadIds) {
      let parentChannel = null;
      try {
        const thread = await fetchGameChannel(client, threadId);
        if (thread) {
          parentChannel = thread.parent;
          await thread.delete().catch(discordCatch);
        }
      } catch (err) {
        if (err.code !== 10003 && err.code !== 10008) {
          console.error(`[cleanupIncidentMirrors] Thread delete failed:`, err.message);
        }
      }
      // For message-based threads, thread ID === header message ID.
      // Delete the header message so bot-logs stays clean.
      if (parentChannel) {
        try {
          const headerMsg = await parentChannel.messages.fetch(threadId).catch(() => null);
          if (headerMsg) await headerMsg.delete();
        } catch {}
      }
    }
    await markIncidentMirrorsCleaned(cleanedIds);
  } catch (err) {
    console.error(`[cleanupIncidentMirrors] Failed for game ${gameId}:`, err.message);
  }
}

const BOT_LOGS_CHANNEL_ID = '1467647184542634005';

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
    channelDeleteGuard,
  } = ctx;
  // Mark this game so the channelDelete listener ignores bot-initiated deletions
  if (channelDeleteGuard) channelDeleteGuard.add(gameId);

  // Resolve category ID with a self-healing fallback. Historically `game.gameCategoryId`
  // could be stale on checkpoint-loaded games (it pointed at the SAVED game's
  // category, not the new lobby's). The fix in applyCheckpointToNewLobby preserves
  // the new lobby's gameCategoryId, but we keep this defensive fallback so any
  // future drift self-heals: if the stored category fetch fails OR the category
  // has zero children matching this lobby's known channels, fall back to the
  // generalId's actual parent.
  let categoryId = game.gameCategoryId;
  let categoryChannel = categoryId ? await fetchGameChannel(client, categoryId).catch(() => null) : null;
  if (!categoryChannel) {
    const generalCh = game.generalId ? await fetchGameChannel(client, game.generalId).catch(() => null) : null;
    if (generalCh?.parentId && generalCh.parentId !== categoryId) {
      console.warn(`[killgame] gameCategoryId=${categoryId} did not resolve; falling back to generalId.parentId=${generalCh.parentId} for game ${gameId}`);
      categoryId = generalCh.parentId;
      categoryChannel = await fetchGameChannel(client, categoryId).catch(() => null);
    }
  }

  if (categoryId && categoryChannel) {
    try {
      const guild = categoryChannel.guild;
      if (guild) {
        const children = guild.channels.cache.filter((c) => c.parentId === categoryId);
        for (const ch of children.values()) await ch.delete().catch(discordCatch);
        await guild.channels.fetch(categoryId).then((cat) => cat?.delete()).catch(discordCatch);
      }
    } catch (err) {
      console.error('deleteGameChannelsAndGame:', err);
    }
  }
  if (channelDeleteGuard) channelDeleteGuard.delete(gameId);
  deleteGame(gameId);
  cleanupGameLock(gameId);
  clearBuffer(gameId);
  clearEventLogSeqCounter(gameId);
  clearDomainSeqCounter(gameId);
  await clearGameErrorThread(gameId, client);
  await cleanupIncidentMirrors(gameId, client);
  cleanupCompanionEmbedDeps(gameId);
  saveGames(game.gameId);
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
  const gameId = parseCustomId(interaction.customId, 'botmenu_kill_');
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
  // Diagnostic instrumentation for the recurring silent-fail (project_killgame_silent_fail.md).
  // Killgame has intermittently no-op'd 3× with no observable error. Logging every
  // branch here means next failure leaves a Railway-log trail showing whether the
  // handler fired at all, which gate it tripped, or where the deletion stalled.
  const _diagGameId = parseCustomId(interaction.customId, 'botmenu_kill_yes_');
  const _diagUserId = interaction.user?.id ?? 'unknown';
  console.log(`[killgame-diag] Yes clicked: game=${_diagGameId} user=${_diagUserId}`);
  const { getGame, logGameErrorToBotLogs } = ctx;
  const gameId = _diagGameId;
  const game = getGame(gameId);
  if (!game) {
    console.log(`[killgame-diag] Game not found in memory: ${gameId} — bailing`);
    await interaction.editReply({ content: 'Game not found.', components: [] }).catch(discordCatch);
    return;
  }
  if (!canKillGame(interaction, game)) {
    console.log(`[killgame-diag] Permission denied for user ${_diagUserId} on game ${gameId} — bailing`);
    await interaction.editReply({ content: 'You are not allowed to kill this game.', components: [] }).catch(discordCatch);
    return;
  }
  console.log(`[killgame-diag] Passed checks for game ${gameId} — about to editReply Deleting...`);
  // Update message before deletion (channel will be deleted along with it)
  await interaction.editReply({
    content: `⏳ Deleting **IA Game #${gameId}**...`,
    components: [],
  }).catch(discordCatch);
  console.log(`[killgame-diag] editReply done for game ${gameId} — calling deleteGameChannelsAndGame`);
  try {
    await deleteGameChannelsAndGame(game, gameId, ctx);
    console.log(`[killgame-diag] deleteGameChannelsAndGame returned cleanly for game ${gameId}`);
  } catch (err) {
    console.error('[botmenu] Kill game error:', err);
    console.log(`[killgame-diag] deleteGameChannelsAndGame THREW for game ${gameId}: ${err?.message ?? err}`);
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
  const gameId = parseCustomId(interaction.customId, 'forfeit_');
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
  const gameId = parseCustomId(interaction.customId, 'forfeit_yes_');
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
