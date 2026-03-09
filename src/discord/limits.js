/**
 * Discord character limit utilities.
 * Discord limits: 2000 chars for message content, 1024 chars for embed field values,
 * 4096 chars for embed description, 256 chars for embed title.
 */

export const DISCORD_CONTENT_LIMIT = 2000;
export const DISCORD_EMBED_FIELD_LIMIT = 1024;
export const DISCORD_EMBED_DESC_LIMIT = 4096;

/**
 * Truncate a string to fit within a Discord character limit.
 * Appends an ellipsis marker if truncated.
 * @param {string} text
 * @param {number} [max=2000]
 * @returns {string}
 */
export function enforceContentLimit(text, max = DISCORD_CONTENT_LIMIT) {
  if (!text || typeof text !== 'string') return text || '';
  if (text.length <= max) return text;
  const suffix = '…';
  return text.slice(0, max - suffix.length) + suffix;
}
