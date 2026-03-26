/**
 * Centralized channel-fetch helpers to replace scattered client.channels.fetch() calls.
 */

import { withDiscordRetry } from '../error-handling.js';

/** Check if a string is a valid Discord snowflake (filters synthetic AI user IDs). */
export const isDiscordSnowflake = (id) => /^\d{17,20}$/.test(id);

/** Filter an array of user IDs to only valid snowflakes (safe for allowedMentions / permissionOverwrites). */
export const snowflakeUsers = (ids) => ids.filter(isDiscordSnowflake);

/**
 * Sanitize a Discord message payload's allowedMentions.users in-place.
 * Removes non-snowflake IDs (e.g. synthetic AI user IDs) that Discord would reject.
 * Returns the same payload for chaining.
 */
export function sanitizeMentions(payload) {
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
