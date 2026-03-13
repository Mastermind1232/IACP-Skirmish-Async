import { captureSnapshot, computeDiff } from '../event-log.js';
import { translateDiffToEvents } from './diff-translator.js';
import { appendEvents } from './event-store.js';

/**
 * Wrap a handler call to emit domain events based on state diff.
 * Runs the existing handler unchanged, then translates the diff to domain events.
 * @param {Function} handlerFn - the existing handler
 * @param {object} interaction - Discord interaction
 * @param {object|null} ctx - handler context (null if no group)
 * @param {{ gameId: string, handlerKey: string, playerId: string, getGame: Function }} meta
 */
export async function dispatchWithEvents(handlerFn, interaction, ctx, meta) {
  const { gameId, handlerKey, playerId, getGame } = meta;

  // 1. Before snapshot
  const before = gameId ? captureSnapshot(getGame(gameId)) : null;

  // 2. Run existing handler unchanged
  if (ctx) await handlerFn(interaction, ctx);
  else await handlerFn(interaction);

  // 3. After snapshot + diff
  if (!before || !gameId) return;
  const after = captureSnapshot(getGame(gameId));
  const diff = computeDiff(before, after);
  if (!diff) return;

  // 4. Translate diff → domain events
  const correlationId = `${handlerKey}_${Date.now()}`;
  const events = translateDiffToEvents(handlerKey, diff, {
    gameId, playerId, before, after, correlationId,
  });

  // 5. Persist (non-blocking)
  if (events.length > 0) {
    appendEvents(gameId, events).catch(err =>
      console.error('[domain-events]', err.message));
  }

  return events;
}
