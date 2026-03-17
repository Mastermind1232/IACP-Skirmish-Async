/**
 * Centralized channel-fetch helpers to replace scattered client.channels.fetch() calls.
 */

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
