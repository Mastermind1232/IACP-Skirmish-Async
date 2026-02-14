/**
 * Game phases, action icons, and game-log / error-log helpers.
 */
import { EmbedBuilder, ChannelType, ThreadAutoArchiveDuration } from 'discord.js';

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
const BOT_LOGS_CHANNEL_NAMES = ['bot-logs', 'bot-log', 'bot logs'];

/** Post a phase header to the game log (only when phase changes) */
export async function logPhaseHeader(game, client, phase, roundNum = null) {
  const phaseKey = 'currentPhase';
  const phaseName = roundNum ? `${phase.name} ${roundNum}` : phase.name;
  const fullKey = roundNum ? `${phase.name}_${roundNum}` : phase.name;
  if (game[phaseKey] === fullKey) return;
  game[phaseKey] = fullKey;
  try {
    const ch = await client.channels.fetch(game.generalId);
    const embed = new EmbedBuilder()
      .setTitle(`${phase.emoji}  ${phaseName}`)
      .setColor(phase.color);
    const msg = await ch.send({ embeds: [embed] });
    const setupPhases = ['SETUP', 'INITIATIVE', 'DEPLOYMENT'];
    if (setupPhases.includes(phase.name)) {
      game.setupLogMessageIds = game.setupLogMessageIds || [];
      game.setupLogMessageIds.push(msg.id);
    }
  } catch (err) {
    console.error('Phase header error:', err);
  }
}

/** Log a game action with icon and clean formatting */
export async function logGameAction(game, client, content, options = {}) {
  try {
    const ch = await client.channels.fetch(game.generalId);
    const icon = options.icon ? `${ACTION_ICONS[options.icon] || ''} ` : '';
    const phase = options.phase;
    if (phase) {
      await logPhaseHeader(game, client, GAME_PHASES[phase], options.roundNum);
    }
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
    const msgContent = `${icon}${timestamp} — ${content}`;
    const sentMsg = await ch.send({ content: msgContent, allowedMentions: options.allowedMentions });
    const setupPhases = ['SETUP', 'INITIATIVE', 'DEPLOYMENT'];
    if (phase && setupPhases.includes(phase)) {
      game.setupLogMessageIds = game.setupLogMessageIds || [];
      game.setupLogMessageIds.push(sentMsg.id);
    }
  } catch (err) {
    console.error('Game log error:', err);
  }
}

/**
 * Log a game error to the guild's bot-logs channel (optionally in a per-game thread).
 * Optionally @mention a user/role (set env BOT_LOGS_MENTION_ID) and include a jump link to the message that triggered the error.
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
    await guild.channels.fetch().catch(() => {});
    const ch = guild.channels.cache.find((c) => {
      if (c.type !== ChannelType.GuildText) return false;
      const name = (c.name || '').toLowerCase().trim();
      return BOT_LOGS_CHANNEL_NAMES.includes(name) || name.replace(/\s+/g, '-') === 'bot-logs';
    });
    if (!ch) {
      console.error(
        `Bot logs channel not found in guild "${guild.name}" (${guild.id}). Ensure your existing bot logs text channel is named one of: ${BOT_LOGS_CHANNEL_NAMES.join(', ')}.`
      );
      return;
    }
    const errMsg = error?.message || String(error);
    const stack = error?.stack ? `\n\`\`\`\n${error.stack.slice(0, 800)}\n\`\`\`` : '';
    const ctx = context ? ` (${context})` : '';
    const mentionId = typeof process.env.BOT_LOGS_MENTION_ID === 'string' && process.env.BOT_LOGS_MENTION_ID.trim()
      ? process.env.BOT_LOGS_MENTION_ID.trim()
      : null;
    const link = options.messageLink?.guildId && options.messageLink?.channelId && options.messageLink?.messageId
      ? `https://discord.com/channels/${options.messageLink.guildId}/${options.messageLink.channelId}/${options.messageLink.messageId}`
      : null;
    let content = '';
    if (mentionId) content += `<@${mentionId}> `;
    content += `⚠️ **Game Error**${gameId ? ` — IA Game #${gameId}` : ''}${ctx}\n${errMsg}${stack}`;
    if (link) content += `\n\n**Jump to message:** ${link}`;

    const sendPayload = { content };
    if (mentionId) sendPayload.allowedMentions = { parse: ['users', 'roles'] };

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
      const target = threadId ? await client.channels.fetch(threadId).catch(() => null) : ch;
      if (target) await target.send(sendPayload);
    } else {
      await ch.send(sendPayload);
    }
  } catch (e) {
    console.error('Failed to log game error to bot-logs:', e);
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
  const msgId = playerNum === 1 ? game.p1ActivationsMessageId : game.p2ActivationsMessageId;
  const remaining = playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  const total = playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
  if (msgId == null || total === 0) return;
  try {
    const channelId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit(getActivationsLine(remaining, total));
  } catch (err) {
    console.error('Failed to update activations message:', err);
  }
}
