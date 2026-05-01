/**
 * Renderer — single source of "Discord UI matches game state."
 *
 * Each sub-function in this module owns one UI surface tied to game state.
 * The contract for every sub-function is the same:
 *
 *   1. Read the tracked msgId from game state (e.g. game.p1HandId).
 *   2. If the msgId is null/missing OR Discord 404s when fetched, post a
 *      fresh message/channel/thread and store the new id on game state.
 *   3. Otherwise (msgId valid + Discord has it), edit if content needs to
 *      change, or no-op if content already matches.
 *
 * The renderer is the SOLE writer of msgIds for surfaces it owns. That's
 * what lets the side-channel Maps eventually become derived views of game
 * state (see project_renderer_consolidation_plan.md, Phase 4).
 *
 * Idempotency contract:
 *   - Each sub-function reads its msgId fresh every call (no caching).
 *   - Concurrent renders within the same atomic lock are safe to re-run.
 *   - Sub-functions mutate `game` (storing new msgIds), so callers must
 *     run inside `withAtomicGameLock` for the persistence to commit.
 */
import { ThreadAutoArchiveDuration, ChannelType } from 'discord.js';
import { fetchGameChannel, isDiscordSnowflake } from '../discord/channel-helpers.js';
import { discordCatch } from '../error-handling.js';

/**
 * Ensure player `playerNum`'s "Your Hand" private thread exists inside their
 * play-area channel, and that the player + (for test games) Admin members
 * are added to it.
 *
 * Pure post-if-missing — threads don't get edited the way messages do, so
 * the only branches are:
 *   - msgId valid and Discord still has it → no-op
 *   - msgId missing OR 404 → create thread, store id on game
 *
 * Mutates: game[`p${playerNum}HandId`] on creation.
 *
 * @param {object} game
 * @param {1|2} playerNum
 * @param {import('discord.js').Client} client
 * @param {object} [_ctx] - reserved for future renderer ctx (currently unused)
 * @returns {Promise<{ created: boolean, threadId: string | null }>}
 */
export async function renderHandThread(game, playerNum, client, _ctx) {
  const handIdField = playerNum === 1 ? 'p1HandId' : 'p2HandId';
  const playAreaIdField = playerNum === 1 ? 'p1PlayAreaId' : 'p2PlayAreaId';
  const playerIdField = playerNum === 1 ? 'player1Id' : 'player2Id';

  const existingId = game[handIdField];
  if (existingId) {
    const existing = await fetchGameChannel(client, existingId).catch(() => null);
    if (existing) return { created: false, threadId: existingId };
    // Discord 404 — fall through to recreate
  }

  const playAreaId = game[playAreaIdField];
  if (!playAreaId) {
    console.warn(`[renderer] renderHandThread: game ${game.gameId} missing ${playAreaIdField}; cannot create hand thread for player ${playerNum}`);
    return { created: false, threadId: null };
  }
  const playArea = await fetchGameChannel(client, playAreaId);
  if (!playArea) {
    console.warn(`[renderer] renderHandThread: play-area channel ${playAreaId} not found; cannot create hand thread for player ${playerNum}`);
    return { created: false, threadId: null };
  }

  const thread = await playArea.threads.create({
    name: 'Your Hand',
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PrivateThread,
    invitable: false,
  });

  const playerId = game[playerIdField];
  if (isDiscordSnowflake(playerId)) {
    await thread.members.add(playerId).catch(discordCatch);
  }

  // Test games get Admin role members added so admins can observe; competitive
  // games stay strictly private.
  if (game.isTestGame) {
    const adminRole = playArea.guild?.roles?.cache?.find((r) => r.name === 'Admin');
    if (adminRole) {
      for (const [memberId] of adminRole.members) {
        await thread.members.add(memberId).catch(discordCatch);
      }
    }
  }

  game[handIdField] = thread.id;
  return { created: true, threadId: thread.id };
}
