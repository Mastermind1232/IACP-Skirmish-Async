/**
 * Centralized channel-fetch helpers to replace scattered client.channels.fetch() calls.
 */

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
 * Fetch a combat thread by its ID. Returns null on missing/deleted threads.
 * @param {import('discord.js').Client} client
 * @param {string|null|undefined} threadId
 * @returns {Promise<import('discord.js').ThreadChannel|null>}
 */
export async function fetchCombatThread(client, threadId) {
  if (!client?.channels?.fetch) return null;
  return client.channels.fetch(threadId).catch(() => null);
}

/**
 * Fetch any game channel (general, play-area, hand, etc.). Returns null on failure.
 * @param {import('discord.js').Client} client
 * @param {string|null|undefined} channelId
 * @returns {Promise<import('discord.js').TextChannel|null>}
 */
export async function fetchGameChannel(client, channelId) {
  if (!client?.channels?.fetch) return null;
  return client.channels.fetch(channelId).catch(() => null);
}
