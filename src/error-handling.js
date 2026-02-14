/**
 * A8 error-handling pattern: retry for Discord API, log + user message.
 * Use withDiscordRetry for critical Discord API calls (reply, edit, etc.).
 * Use replyOrFollowUpWithRetry in top-level catch to send error message with retry.
 */

/** True if the error is retryable (429 rate limit, 5xx, or network). */
export function isRetryableDiscordError(err) {
  if (!err) return false;
  const code = err.code ?? err.status ?? err.httpStatus;
  const status = typeof code === 'number' ? code : null;
  if (status === 429) return true;
  if (status != null && status >= 500 && status < 600) return true;
  const nodeCode = err.code ?? err.errno;
  if (nodeCode === 'ECONNRESET' || nodeCode === 'ETIMEDOUT' || nodeCode === 'ECONNREFUSED') return true;
  return false;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 1000;

/**
 * Run an async fn; on retryable Discord/network error, wait and retry with exponential backoff.
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, baseMs?: number }} options
 * @returns {Promise<T>}
 */
export async function withDiscordRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryableDiscordError(err)) throw err;
      const delay = baseMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Message shown when Discord API fails after retries (retryable). */
export const DISCORD_RETRY_EXHAUSTED_MESSAGE = 'Something went wrong on our side. Please try again in 2–3 minutes.';

/**
 * Send reply or followUp with retry. On final failure after retries, uses DISCORD_RETRY_EXHAUSTED_MESSAGE.
 * Use when you must notify the user (e.g. top-level interaction error).
 * @param {import('discord.js').Interaction} interaction
 * @param {{ content: string, ephemeral?: boolean }} payload
 * @param {{ maxAttempts?: number }} options
 */
export async function replyOrFollowUpWithRetry(interaction, payload, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  try {
    await withDiscordRetry(
      async () => {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ ...payload, ephemeral: payload.ephemeral !== false });
        } else {
          await interaction.reply({ ...payload, ephemeral: payload.ephemeral !== false });
        }
      },
      { maxAttempts }
    );
  } catch (err) {
    const fallback = isRetryableDiscordError(err)
      ? DISCORD_RETRY_EXHAUSTED_MESSAGE
      : (payload.content || 'An error occurred.');
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: fallback, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: fallback, ephemeral: true }).catch(() => {});
      }
    } catch {
      // Best effort; avoid crashing
    }
  }
}
