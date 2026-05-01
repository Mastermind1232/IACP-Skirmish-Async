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
import { getHandVisualEmbed } from '../discord/embeds.js';
import { getCcHand, getCcDeck } from '../game/player-helpers.js';
import { buildHandDisplayPayload } from '../rendering.js';

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

/**
 * Ensure player `playerNum`'s hand-visual message in the play area shows the
 * current hand size. Embed-only (no components, no files) so edit-vs-post is
 * cheap.
 *
 * Branches:
 *   - msgId valid + Discord has it → edit embed to current count
 *   - msgId missing OR 404 → post fresh, store new id
 *
 * Mutates: game[`p${playerNum}HandVisualMessageId`] on creation.
 *
 * @param {object} game
 * @param {1|2} playerNum
 * @param {import('discord.js').Client} client
 * @param {object} [_ctx] - reserved
 * @returns {Promise<{ posted: boolean, edited: boolean, msgId: string | null }>}
 */
export async function renderHandVisual(game, playerNum, client, _ctx) {
  const msgIdField = playerNum === 1 ? 'p1HandVisualMessageId' : 'p2HandVisualMessageId';
  const playAreaIdField = playerNum === 1 ? 'p1PlayAreaId' : 'p2PlayAreaId';

  const playAreaId = game[playAreaIdField];
  if (!playAreaId) {
    console.warn(`[renderer] renderHandVisual: game ${game.gameId} missing ${playAreaIdField}; skipping player ${playerNum}`);
    return { posted: false, edited: false, msgId: null };
  }
  const channel = await fetchGameChannel(client, playAreaId).catch(() => null);
  if (!channel) {
    console.warn(`[renderer] renderHandVisual: play area ${playAreaId} not found; skipping player ${playerNum}`);
    return { posted: false, edited: false, msgId: null };
  }

  const handLength = (getCcHand(game, playerNum) || []).length;
  const embed = getHandVisualEmbed(handLength);

  const existingId = game[msgIdField];
  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ embeds: [embed] }).catch(discordCatch);
      return { posted: false, edited: true, msgId: existingId };
    } catch {
      // 404 — fall through to post
    }
  }
  const newMsg = await channel.send({ embeds: [embed] });
  game[msgIdField] = newMsg.id;
  return { posted: true, edited: false, msgId: newMsg.id };
}

/**
 * Ensure player `playerNum`'s hand-payload message — the actual "Command
 * Cards in Hand" embed list inside the private hand thread — exists and
 * reflects the current hand.
 *
 * Distinct from `renderHandVisual`: that one is the card-count summary in
 * the public play area; this one is the full card list inside the private
 * thread. The two surfaces have different msgIds.
 *
 * Branches:
 *   - msgId valid + Discord has it → edit to current hand contents
 *   - msgId missing OR 404 → post into the hand thread, store new id
 *
 * Requires the hand thread to exist (caller should run `renderHandThread`
 * first). Returns gracefully if it doesn't.
 *
 * Mutates: game[`p${playerNum}HandMessageId`] on creation.
 *
 * @returns {Promise<{ posted: boolean, edited: boolean, msgId: string | null }>}
 */
export async function renderHandPayload(game, playerNum, client, _ctx) {
  const msgIdField = playerNum === 1 ? 'p1HandMessageId' : 'p2HandMessageId';
  const handIdField = playerNum === 1 ? 'p1HandId' : 'p2HandId';

  const handThreadId = game[handIdField];
  if (!handThreadId) {
    console.warn(`[renderer] renderHandPayload: game ${game.gameId} missing ${handIdField}; run renderHandThread first`);
    return { posted: false, edited: false, msgId: null };
  }
  const handChannel = await fetchGameChannel(client, handThreadId).catch(() => null);
  if (!handChannel) {
    console.warn(`[renderer] renderHandPayload: hand thread ${handThreadId} not found on Discord; skipping player ${playerNum}`);
    return { posted: false, edited: false, msgId: null };
  }

  const hand = getCcHand(game, playerNum) || [];
  const deck = getCcDeck(game, playerNum) || [];
  const payload = buildHandDisplayPayload(hand, deck, game.gameId, game, playerNum);

  const existingId = game[msgIdField];
  if (existingId) {
    try {
      const msg = await handChannel.messages.fetch(existingId);
      await msg.edit({
        content: payload.content,
        embeds: payload.embeds,
        files: payload.files || [],
        components: payload.components || [],
      }).catch(discordCatch);
      return { posted: false, edited: true, msgId: existingId };
    } catch {
      // 404 — fall through to post
    }
  }
  const newMsg = await handChannel.send({
    content: payload.content,
    embeds: payload.embeds,
    files: payload.files || [],
    components: payload.components || [],
  });
  game[msgIdField] = newMsg.id;
  return { posted: true, edited: false, msgId: newMsg.id };
}

/**
 * Ensure the round-activation message ("Round N — your turn!") exists in the
 * general channel when (and only when) the game is actively in round_active
 * phase.
 *
 * Phase gate is the audit's confirmed-bug 2 fix: the previous loader logic
 * gated on `currentRound > 0`, which fires during deployment too because
 * setup-bridge bumps currentRound to 1 before deployment finishes. The
 * correct gate is `phase === 'round_active'`.
 *
 * Branches:
 *   - phase !== round_active → no-op (returns posted/edited false)
 *   - msgId valid + Discord has it → no-op (existing message stays)
 *   - msgId missing OR 404 → post via ctx.sendRoundActivationPhaseMessage,
 *     which sets game.roundActivationMessageId and game.activationPhaseMessagePosted
 *
 * Mutates: game.roundActivationMessageId via the canonical poster.
 *
 * @param {object} ctx - { sendRoundActivationPhaseMessage } required for the post branch
 * @returns {Promise<{ posted: boolean, edited: boolean, msgId: string | null }>}
 */
export async function renderRoundActivationMessage(game, client, ctx = {}) {
  if (game.phase !== 'round_active') {
    return { posted: false, edited: false, msgId: null };
  }
  if (!game.generalId) {
    console.warn(`[renderer] renderRoundActivationMessage: game ${game.gameId} missing generalId`);
    return { posted: false, edited: false, msgId: null };
  }

  const existingId = game.roundActivationMessageId;
  if (existingId) {
    const channel = await fetchGameChannel(client, game.generalId).catch(() => null);
    if (channel) {
      try {
        await channel.messages.fetch(existingId);
        return { posted: false, edited: false, msgId: existingId };
      } catch {
        // 404 — fall through to post
      }
    }
  }

  if (typeof ctx.sendRoundActivationPhaseMessage !== 'function') {
    console.warn(`[renderer] renderRoundActivationMessage: ctx.sendRoundActivationPhaseMessage missing; cannot post for game ${game.gameId}`);
    return { posted: false, edited: false, msgId: null };
  }
  // The canonical poster sets game.roundActivationMessageId +
  // game.activationPhaseMessagePosted = true and calls updateHandChannelMessages.
  // Re-using it keeps the bot's invariants consistent without duplication.
  await ctx.sendRoundActivationPhaseMessage(game, client);
  return { posted: true, edited: false, msgId: game.roundActivationMessageId ?? null };
}
