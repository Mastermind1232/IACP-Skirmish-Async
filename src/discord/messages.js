/**
 * Game phases, action icons, and game-log / error-log helpers.
 */
import { EmbedBuilder, ChannelType, ThreadAutoArchiveDuration, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getActivationsMessageId, getActivationsRemaining, getActivationsTotal, getPlayAreaId } from '../game/player-helpers.js';
import { enforceContentLimit, DISCORD_CONTENT_LIMIT } from './limits.js';
import { withDiscordRetry, discordCatch } from '../error-handling.js';
import { fetchGameChannel, sanitizeMentions } from './channel-helpers.js';

/** Orange sidebar color for phase embeds */
export const PHASE_COLOR = 0xf39c12;

/** Game phases for visual organization — all use orange sidebar */
export const GAME_PHASES = {
  SETUP: { name: 'PRE-GAME SETUP', emoji: '⚙️', color: PHASE_COLOR },
  INITIATIVE: { name: 'INITIATIVE', emoji: '🎲', color: PHASE_COLOR },
  DEPLOYMENT: { name: 'DEPLOYMENT', emoji: '📍', color: PHASE_COLOR },
  ROUND: { name: 'ROUND', emoji: '⚔️', color: PHASE_COLOR },
};

/** Action icons for game log */
export const ACTION_ICONS = {
  squad: '📋',
  map: '🗺️',
  initiative: '🎲',
  zone: '🏁',
  deploy: '📍',
  exhaust: '😴',
  activate: '⚡',
  ready: '✨',
  move: '🚶',
  attack: '⚔️',
  interact: '🤝',
  special: '✴️',
  deployed: '✅',
  card: '🎴',
  deplete: '🔄',
};

const gameErrorThreads = new Map();

/**
 * Delete the bot-logs error thread for a game, then clear the cached mapping.
 * Falls back to searching by thread name if the in-memory map has no entry
 * (e.g. after a bot restart).
 * @param {string} gameId
 * @param {object} [client] - Discord client. If provided, deletes the thread from Discord.
 */
export async function clearGameErrorThread(gameId, client) {
  let found = false;
  for (const [key, threadId] of gameErrorThreads.entries()) {
    if (key.endsWith(`_${gameId}`)) {
      found = true;
      if (client && threadId) {
        try {
          const thread = await fetchGameChannel(client, threadId);
          if (thread) await thread.delete();
        } catch (err) {
          if (err.code !== 10003 && err.code !== 10008) {
            console.error(`[clearGameErrorThread] Failed to delete thread for ${gameId}:`, err.message);
          }
        }
      }
      gameErrorThreads.delete(key);
    }
  }
  // Fallback: search bot-logs channel by thread name (handles bot restarts)
  if (!found && client) {
    try {
      let ch = null;
      try { ch = await fetchGameChannel(client, BOT_LOGS_CHANNEL_ID); } catch {}
      if (ch) {
        const threads = await ch.threads.fetchActive();
        const threadName = `IA${gameId} errors`;
        const match = threads.threads.find(t => t.name === threadName);
        if (match) await match.delete();
      }
    } catch (err) {
      if (err.code !== 10003 && err.code !== 10008) {
        console.error(`[clearGameErrorThread] Fallback search failed for ${gameId}:`, err.message);
      }
    }
  }
}
const BOT_LOGS_CHANNEL_NAMES = ['bot-logs', 'bot-log', 'bot logs', 'botlogs'];
const BOT_LOGS_CHANNEL_ID = '1467647184542634005';

/** Post a phase header to the game log (only when phase changes) */
export async function logPhaseHeader(game, client, phase, roundNum = null) {
  const phaseKey = 'currentPhase';
  const phaseName = roundNum ? `${phase.name} ${roundNum}` : phase.name;
  const fullKey = roundNum ? `${phase.name}_${roundNum}` : phase.name;
  if (game[phaseKey] === fullKey) return;
  game[phaseKey] = fullKey;
  try {
    const ch = await fetchGameChannel(client, game.generalId);
    const embed = new EmbedBuilder()
      .setTitle(`${phase.emoji}  ${phaseName}`)
      .setColor(phase.color);
    const msg = await withDiscordRetry(() => ch.send({ embeds: [embed] }));
    const setupPhases = ['SETUP', 'INITIATIVE', 'DEPLOYMENT'];
    if (setupPhases.includes(phase.name)) {
      game.setupLogMessageIds = game.setupLogMessageIds || [];
      game.setupLogMessageIds.push(msg.id);
    }
  } catch (err) {
    console.error('Phase header error:', err);
  }
}

/** Log a game action with icon and clean formatting. Returns the sent message (or null) so callers can store gameLogMessageId for undo (F14). */
export async function logGameAction(game, client, content, options = {}) {
  try {
    // Clear the previous ping in the game log (fire-and-forget)
    if (game._lastPingLogMsgId) {
      _clearPreviousPing(game, client);
    }

    const ch = await fetchGameChannel(client, game.generalId);
    const icon = options.icon ? `${ACTION_ICONS[options.icon] || ''} ` : '';
    const phase = options.phase;
    if (phase) {
      await logPhaseHeader(game, client, GAME_PHASES[phase], options.roundNum);
    }
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
    const msgContent = enforceContentLimit(`${icon}${timestamp} — ${content}`);
    const payload = sanitizeMentions({ content: msgContent, allowedMentions: options.allowedMentions });
    if (options.files?.length) payload.files = options.files;
    if (options.components?.length) payload.components = options.components;
    const sentMsg = await withDiscordRetry(() => ch.send(payload));
    const setupPhases = ['SETUP', 'INITIATIVE', 'DEPLOYMENT'];
    if (phase && setupPhases.includes(phase)) {
      game.setupLogMessageIds = game.setupLogMessageIds || [];
      game.setupLogMessageIds.push(sentMsg.id);
    }

    // Track this message if it pings users, so the next action can clear it
    if (options.allowedMentions?.users?.length > 0) {
      game._lastPingLogMsgId = sentMsg.id;
    } else {
      delete game._lastPingLogMsgId;
    }

    return sentMsg;
  } catch (err) {
    console.error('Game log error:', err);
    return null;
  }
}

/**
 * Edit the previous ping message in the game log to strip @mentions.
 * Replaces <@userId> with bold "P1"/"P2" so the mention highlight disappears.
 */
function _clearPreviousPing(game, client) {
  const msgId = game._lastPingLogMsgId;
  delete game._lastPingLogMsgId;
  if (!msgId || !game.generalId) return;
  fetchGameChannel(client, game.generalId).then(ch =>
    ch?.messages.fetch(msgId).then(msg => {
      let text = msg.content;
      if (game.player1Id) text = text.replaceAll(`<@${game.player1Id}>`, '**P1**');
      if (game.player2Id) text = text.replaceAll(`<@${game.player2Id}>`, '**P2**');
      if (text !== msg.content) {
        msg.edit({ content: text, allowedMentions: { parse: [] } }).catch(discordCatch);
      }
    })
  ).catch(discordCatch);
}

const BOTHELPERS_ROLE_NAME = 'bothelpers';

/**
 * Log a game error to the guild's bot-logs channel (optionally in a per-game thread).
 * @mentions the **Bothelpers** role (by name) so the team is notified. Optionally include a jump link to the message that triggered the error.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild|null} guild
 * @param {string|null} gameId - IA game id (e.g. "123"); included in message and used for per-game thread
 * @param {Error|unknown} error
 * @param {string} [context] - e.g. 'interactionCreate', 'dc_activate'
 * @param {{ messageLink?: { guildId: string, channelId: string, messageId: string } }} [options] - when provided, adds "Jump to message" link
 */
export async function logGameErrorToBotLogs(client, guild, gameId, error, context = '', options = {}) {
  try {
    if (!guild) {
      console.error('logGameErrorToBotLogs: no guild (interaction may be in DMs)');
      return;
    }
    await guild.roles.fetch().catch(discordCatch);
    // Try fetching by known channel ID first, fall back to name search
    let ch = null;
    try { ch = await fetchGameChannel(client, BOT_LOGS_CHANNEL_ID); } catch {}
    if (!ch) {
      await guild.channels.fetch().catch(discordCatch);
      ch = guild.channels.cache.find((c) => {
        if (c.type !== ChannelType.GuildText) return false;
        const name = (c.name || '').toLowerCase().trim();
        return BOT_LOGS_CHANNEL_NAMES.includes(name) || name.replace(/\s+/g, '-') === 'bot-logs';
      });
    }
    if (!ch) {
      console.error(
        `Bot logs channel not found in guild "${guild.name}" (${guild.id}). Ensure your existing bot logs text channel is named one of: ${BOT_LOGS_CHANNEL_NAMES.join(', ')}, or has ID ${BOT_LOGS_CHANNEL_ID}.`
      );
      return;
    }
    const errMsg = error?.message || String(error);
    const stack = error?.stack ? `\n\`\`\`\n${error.stack.slice(0, 800)}\n\`\`\`` : '';
    const ctx = context ? ` (${context})` : '';
    const bothelpersRole = guild.roles.cache.find((r) => (r.name || '').toLowerCase() === BOTHELPERS_ROLE_NAME.toLowerCase());
    const link = options.messageLink?.guildId && options.messageLink?.channelId && options.messageLink?.messageId
      ? `https://discord.com/channels/${options.messageLink.guildId}/${options.messageLink.channelId}/${options.messageLink.messageId}`
      : null;
    let content = '';
    if (bothelpersRole) content += `<@&${bothelpersRole.id}> `;
    const channelRef = options.messageLink?.channelId ? ` | <#${options.messageLink.channelId}>` : '';
    content += `⚠️ **Game Error**${gameId ? ` — IA Game #${gameId}` : ''}${channelRef}${ctx}\n${errMsg}${stack}`;
    if (link) content += `\n\n**Jump to message:** ${link}`;

    const resolveRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('botlog_resolve_')
        .setLabel('Resolve')
        .setStyle(ButtonStyle.Secondary),
    );
    const sendPayload = { content, components: [resolveRow] };
    if (bothelpersRole) sendPayload.allowedMentions = { roles: [bothelpersRole.id] };

    if (gameId) {
      const key = `${guild.id}_${gameId}`;
      let threadId = gameErrorThreads.get(key);
      if (!threadId) {
        try {
          const thread = await ch.threads.create({
            name: `IA${gameId} errors`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
          });
          threadId = thread.id;
          gameErrorThreads.set(key, threadId);
        } catch {
          threadId = null;
        }
      }
      let target = threadId ? await fetchGameChannel(client, threadId) : null;
      if (!target) {
        // Thread gone/archived or no gameId thread yet — clear stale cache and fall back to channel
        if (threadId) gameErrorThreads.delete(key);
        target = ch;
      }
      if (sendPayload.content.length > 2000) sendPayload.content = sendPayload.content.slice(0, 1997) + '...';
      await withDiscordRetry(() => target.send(sendPayload));
    } else {
      if (sendPayload.content.length > 2000) sendPayload.content = sendPayload.content.slice(0, 1997) + '...';
      await withDiscordRetry(() => ch.send(sendPayload));
    }
  } catch (e) {
    console.error('Failed to log game error to bot-logs:', e?.message ?? e);
  }
}

/** Thread name from lobby state; fetches usernames. */
export async function getThreadName(thread, lobby) {
  const truncate = (s) => (s.length > 18 ? s.slice(0, 15) + '…' : s);
  let p1Name = 'Creator';
  let p2Name = lobby.joinedId ? 'Joiner' : '(waiting)';
  try {
    const p1 = await thread.client.users.fetch(lobby.creatorId);
    p1Name = truncate(p1.username || p1.globalName || 'P1');
    if (lobby.joinedId) {
      const p2 = await thread.client.users.fetch(lobby.joinedId);
      p2Name = truncate(p2.username || p2.globalName || 'P2');
    }
  } catch {
    // fallback to IDs if fetch fails
  }
  const status = lobby.status || (lobby.joinedId ? 'Full' : 'LFG');
  return `[${status}] ${p1Name} vs ${p2Name}`;
}

/** Update thread name to reflect lobby (e.g. [LFG] Creator vs (waiting)). */
export async function updateThreadName(thread, lobby) {
  try {
    const name = await getThreadName(thread, lobby);
    await thread.setName(name.slice(0, 100));
  } catch (err) {
    console.error('Failed to update thread name:', err);
  }
}

/** Content string for the activations header in Play Area (green/red circles). */
export function getActivationsLine(remaining, total) {
  const green = '🟢';
  const red = '🔴';
  const used = Math.max(0, total - remaining);
  const circles = green.repeat(remaining) + red.repeat(used);
  return `**Activations:** ${circles} (${remaining}/${total} remaining)`;
}

/** Default actions per activation (2). */
export const DC_ACTIONS_PER_ACTIVATION = 2;

/** Returns "X/2 Actions Remaining" with green/red square visual (🟩=remaining, 🟥=used). */
export function getActionsCounterContent(remaining, total = DC_ACTIONS_PER_ACTIVATION) {
  const r = Math.max(0, Math.min(remaining, total));
  const used = total - r;
  const green = '🟩'.repeat(r);
  const red = '🟥'.repeat(used);
  return `**Actions** • ${r}/${total} ${green}${red}`;
}

/** Call after changing game.p1ActivationsRemaining or game.p2ActivationsRemaining to refresh the Play Area header. */
export async function updateActivationsMessage(game, playerNum, client) {
  const msgId = getActivationsMessageId(game, playerNum);
  const remaining = getActivationsRemaining(game, playerNum);
  const total = getActivationsTotal(game, playerNum);
  if (msgId == null || total === 0) return;
  try {
    const channelId = getPlayAreaId(game, playerNum);
    const channel = await fetchGameChannel(client, channelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(msgId);
    await msg.edit(getActivationsLine(remaining, total));
  } catch (err) {
    console.error('Failed to update activations message:', err);
  }
}
