/**
 * Bounded-parallel async iteration. Caps in-flight work at `concurrency`
 * to avoid Discord rate-limit pile-ups while still parallelizing
 * independent operations like /resync DC-card edits.
 *
 * Usage:
 *   await runWithLimit(5, msgIds, async (msgId, i) => {
 *     await editDcMessage(msgId);
 *   });
 *
 * Semantics:
 *   - Each worker pulls items off a shared cursor until exhausted.
 *   - Errors from `fn` propagate (Promise.all rejects on first throw,
 *     remaining in-flight workers settle but their failures are lost).
 *     Callers that want per-item resilience must wrap fn in try/catch
 *     internally — same as existing sequential-loop call sites do.
 *   - `results[i]` matches input order (assigned by index, not by
 *     completion order).
 *
 * Why not Promise.all + naive concurrency? With 30 simultaneous Discord
 * edits across a single channel, the bot trips 429s and stalls behind
 * retry-after waits. Concurrency=5 stays under the per-channel limit
 * while still cutting wall time ~5× vs. fully-sequential.
 *
 * @param {number} concurrency - max in-flight work; ≥1
 * @param {Array<T>} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function runWithLimit(concurrency, items, fn) {
  if (!items || items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency | 0, items.length));
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Concurrency cap for Discord message-edit batches. Discord's per-channel
 * rate-limit window is roughly 5 requests / 2 seconds (varies per route
 * and can be lower for cross-channel work). Keep batches conservative —
 * burning the rate budget on one /resync delays every other ongoing
 * interaction in the same channel.
 */
export const DISCORD_REFRESH_CONCURRENCY = 5;
