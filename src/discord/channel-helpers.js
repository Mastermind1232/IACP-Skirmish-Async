/**
 * Centralized channel-fetch helpers to replace scattered client.channels.fetch() calls.
 */

import {
  TextChannel, NewsChannel, ThreadChannel, DMChannel, VoiceChannel,
  ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction,
  StringSelectMenuInteraction, UserSelectMenuInteraction,
  RoleSelectMenuInteraction, MentionableSelectMenuInteraction,
  ChannelSelectMenuInteraction, AutocompleteInteraction, Message,
} from 'discord.js';
import { withDiscordRetry } from '../error-handling.js';

/** Check if a string is a valid Discord snowflake (filters synthetic AI user IDs). */
export const isDiscordSnowflake = (id) => /^\d{17,20}$/.test(id);

/** Filter an array of user IDs to only valid snowflakes (safe for allowedMentions / permissionOverwrites). */
export const snowflakeUsers = (ids) => ids.filter(isDiscordSnowflake);

/**
 * Pattern: literal AI-sentinel mentions like `<@ai_player_2>` that creep
 * into log messages and embed text. Discord renders these as a dead/literal
 * mention. Rewrite to a clear display name instead.
 */
const AI_MENTION_RE = /<@ai_player_\d+>/g;
const AI_DISPLAY = '**SKIRBO**';

function rewriteAi(s) {
  return typeof s === 'string' && s.includes('<@ai_player_')
    ? s.replace(AI_MENTION_RE, AI_DISPLAY)
    : s;
}

/** Apply the AI-mention rewrite to any outbound payload (string or object). */
export function sanitizeOut(input) {
  if (input == null) return input;
  if (typeof input === 'string') return rewriteAi(input);
  return sanitizeMentions(input);
}

/**
 * Sanitize a Discord message payload in-place:
 *  - Rewrites literal AI mentions in content / embeds → "**SKIRBO**"
 *  - Removes non-snowflake IDs from allowedMentions.users so Discord
 *    doesn't reject the message
 * Returns the same payload for chaining.
 */
export function sanitizeMentions(payload) {
  if (!payload) return payload;
  if (typeof payload.content === 'string') {
    payload.content = rewriteAi(payload.content);
  }
  if (Array.isArray(payload.embeds)) {
    for (const embed of payload.embeds) {
      // EmbedBuilder stores in embed.data; plain dict embeds store at top level.
      const target = embed?.data || embed;
      if (!target) continue;
      if (typeof target.title === 'string') target.title = rewriteAi(target.title);
      if (typeof target.description === 'string') target.description = rewriteAi(target.description);
      if (Array.isArray(target.fields)) {
        for (const f of target.fields) {
          if (typeof f.name === 'string') f.name = rewriteAi(f.name);
          if (typeof f.value === 'string') f.value = rewriteAi(f.value);
        }
      }
      if (typeof target.footer?.text === 'string') target.footer.text = rewriteAi(target.footer.text);
    }
  }
  if (payload?.allowedMentions?.users) {
    payload.allowedMentions.users = payload.allowedMentions.users.filter(isDiscordSnowflake);
  }
  return payload;
}

/**
 * Fetch a combat thread by its ID. Retries on transient Discord errors (rate
 * limits, 5xx, network). Returns null only when the channel genuinely doesn't
 * exist (e.g. 404 Not Found / Unknown Channel).
 * @param {import('discord.js').Client} client
 * @param {string|null|undefined} threadId
 * @returns {Promise<import('discord.js').ThreadChannel|null>}
 */
export async function fetchCombatThread(client, threadId) {
  if (!client?.channels?.fetch || !threadId) return null;
  try {
    return await withDiscordRetry(() => client.channels.fetch(threadId));
  } catch {
    // Non-retryable error (404/10003 Unknown Channel, invalid ID, etc.)
    return null;
  }
}

/**
 * Fetch any game channel (general, play-area, hand, etc.). Retries on transient
 * Discord errors. Returns null only when the channel genuinely doesn't exist.
 * @param {import('discord.js').Client} client
 * @param {string|null|undefined} channelId
 * @returns {Promise<import('discord.js').TextChannel|null>}
 */
export async function fetchGameChannel(client, channelId) {
  if (!client?.channels?.fetch || !channelId) return null;
  try {
    return await withDiscordRetry(() => client.channels.fetch(channelId));
  } catch {
    // Non-retryable error (channel deleted, invalid ID, etc.)
    return null;
  }
}

/**
 * Monkey-patch every Discord channel + interaction send method so that
 * outbound payloads always run through sanitizeOut. This catches direct
 * `channel.send(...)`, `interaction.followUp(...)`, etc. that bypass our
 * own helpers — the audit found ~22 such call sites with player-mention
 * interpolation, and there's no way to be sure we found them all.
 *
 * Idempotent: a `__skirboSanitized` flag on the prototype prevents
 * double-wrapping.
 */
export function installAiSanitizer() {
  const channelClasses = [TextChannel, NewsChannel, ThreadChannel, DMChannel, VoiceChannel];
  for (const cls of channelClasses) {
    const proto = cls?.prototype;
    if (!proto || proto.__skirboSanitized) continue;
    if (typeof proto.send === 'function') {
      const orig = proto.send;
      proto.send = function patchedSend(payload) {
        return orig.call(this, sanitizeOut(payload));
      };
    }
    proto.__skirboSanitized = true;
  }
  const interactionClasses = [
    ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction,
    StringSelectMenuInteraction, UserSelectMenuInteraction,
    RoleSelectMenuInteraction, MentionableSelectMenuInteraction,
    ChannelSelectMenuInteraction, AutocompleteInteraction,
  ];
  for (const cls of interactionClasses) {
    const proto = cls?.prototype;
    if (!proto || proto.__skirboSanitized) continue;
    for (const method of ['reply', 'followUp', 'editReply', 'update', 'deferReply', 'showModal']) {
      if (typeof proto[method] !== 'function') continue;
      const orig = proto[method];
      // deferReply / showModal don't carry user content; skip rewriting their
      // payloads but still trace the override path is set.
      if (method === 'deferReply' || method === 'showModal') continue;
      proto[method] = function patchedInteraction(payload) {
        return orig.call(this, sanitizeOut(payload));
      };
    }
    proto.__skirboSanitized = true;
  }
  // Also patch Message.edit (used in many lobby/board refresh paths)
  if (Message?.prototype && !Message.prototype.__skirboSanitized) {
    if (typeof Message.prototype.edit === 'function') {
      const orig = Message.prototype.edit;
      Message.prototype.edit = function patchedMessageEdit(payload) {
        return orig.call(this, sanitizeOut(payload));
      };
    }
    Message.prototype.__skirboSanitized = true;
  }
}
