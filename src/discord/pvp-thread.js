/**
 * PvP Game Thread Shell — manages the single-thread-per-game lifecycle.
 *
 * Replaces the 7-channel model with:
 *   1 public thread (Game Thread) in a designated channel
 *   2 pinned messages (Board State + Turn Prompt) edited in place
 *   Ephemeral messages for private info (CC hands)
 *
 * Lifecycle:
 *   createGameThread()  → thread + pinned messages created
 *   updateGameView()    → both pinned messages edited
 *   sendEphemeralHand() → private CC hand via ephemeral followUp
 *   archiveGameThread() → thread archived when game ends
 */

import {
  ChannelType,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { renderBoardState, renderTurnPrompt } from './pvp-renderer.js';
import { getAvailableActions } from '../engine/available-actions.js';
import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import { withDiscordRetry, discordCatch } from '../error-handling.js';
import { fetchGameChannel, snowflakeUsers, isDiscordSnowflake } from './channel-helpers.js';

// ── Thread Creation ─────────────────────────────────────────────────────────

/**
 * Create a game thread and pin the two anchor messages.
 * Call this once when a PvP game starts (after both squads are submitted).
 *
 * @param {object} opts
 * @param {import('discord.js').TextChannel} opts.parentChannel - Channel to create thread in
 * @param {object} opts.game - Game state object
 * @param {object} opts.client - Discord client
 * @param {object} [opts.deps] - Dependencies for available-actions
 * @param {object} [opts.renderOpts] - Options for board rendering (getMissionVpBonus)
 * @returns {Promise<{ thread, boardStateMessageId, turnPromptMessageId }>}
 */
export async function createGameThread(opts) {
  const { parentChannel, game, client, deps = {}, renderOpts = {} } = opts;

  const gameId = game.gameId;
  const threadName = `IA Game #${gameId}`;

  // Create the thread
  const thread = await parentChannel.threads.create({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PublicThread,
    reason: `PvP game ${gameId}`,
  });

  // Add both players (skip synthetic AI IDs)
  if (isDiscordSnowflake(game.player1Id)) await thread.members.add(game.player1Id).catch(discordCatch);
  if (isDiscordSnowflake(game.player2Id)) await thread.members.add(game.player2Id).catch(discordCatch);

  // Send and pin the Board State message (Message 1 — top)
  const boardPayload = await renderBoardState(game, { client, ...renderOpts });
  const boardMsg = await withDiscordRetry(() => thread.send(boardPayload));
  await boardMsg.pin().catch(discordCatch);

  // Send and pin the Turn Prompt message (Message 2 — bottom)
  // Show for the player who has actions available
  const activePlayerNum = findActivePlayerNum(game, deps);
  const promptPayload = renderTurnPrompt(game, activePlayerNum, deps);
  const promptMsg = await withDiscordRetry(() => thread.send(promptPayload));
  await promptMsg.pin().catch(discordCatch);

  // Store IDs on game object for edit-in-place
  game.pvpThreadId = thread.id;
  game.pvpBoardStateMessageId = boardMsg.id;
  game.pvpTurnPromptMessageId = promptMsg.id;

  return {
    thread,
    boardStateMessageId: boardMsg.id,
    turnPromptMessageId: promptMsg.id,
  };
}

// ── View Update (Edit-in-Place) ─────────────────────────────────────────────

/**
 * Edit both pinned messages to reflect the current game state.
 * Call this after every game state mutation (handler completion).
 *
 * @param {object} game - Current game state (must have pvpThreadId, pvpBoardStateMessageId, pvpTurnPromptMessageId)
 * @param {import('discord.js').Client} client
 * @param {object} [deps] - Dependencies for available-actions
 * @param {object} [opts] - Options for board rendering
 */
export async function updateGameView(game, client, deps = {}, opts = {}) {
  if (!game.pvpThreadId) return; // Not a PvP thread game

  const thread = await fetchGameChannel(client, game.pvpThreadId);
  if (!thread) {
    console.error(`[pvp-thread] Thread ${game.pvpThreadId} not found for game ${game.gameId}`);
    return;
  }

  // Update Board State (Message 1)
  if (game.pvpBoardStateMessageId) {
    try {
      const boardMsg = await thread.messages.fetch(game.pvpBoardStateMessageId);
      const boardPayload = await renderBoardState(game, { client, ...opts });
      await withDiscordRetry(() => boardMsg.edit(boardPayload));
    } catch (err) {
      console.error('[pvp-thread] Failed to update board state:', err.message);
    }
  }

  // Update Turn Prompt (Message 2)
  if (game.pvpTurnPromptMessageId) {
    try {
      const promptMsg = await thread.messages.fetch(game.pvpTurnPromptMessageId);
      const activePlayerNum = findActivePlayerNum(game, deps);
      const promptPayload = renderTurnPrompt(game, activePlayerNum, deps);
      await withDiscordRetry(() => promptMsg.edit(promptPayload));
    } catch (err) {
      console.error('[pvp-thread] Failed to update turn prompt:', err.message);
    }
  }
}

// ── Game Log (Append-Only) ──────────────────────────────────────────────────

/**
 * Post a game log entry to the thread (non-pinned, append-only).
 * Used for significant events: attacks, defeats, card plays, round transitions.
 *
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {string} content - Message text
 * @param {object} [options] - { files, embeds, allowedMentions }
 */
export async function postGameLog(game, client, content, options = {}) {
  if (!game.pvpThreadId) return;

  try {
    const thread = await fetchGameChannel(client, game.pvpThreadId);
    if (!thread) return;
    const payload = { content };
    if (options.files?.length) payload.files = options.files;
    if (options.embeds?.length) payload.embeds = options.embeds;
    if (options.allowedMentions) payload.allowedMentions = options.allowedMentions;
    await withDiscordRetry(() => thread.send(payload));
  } catch (err) {
    console.error('[pvp-thread] Failed to post game log:', err.message);
  }
}

// ── Ephemeral Private Info ──────────────────────────────────────────────────

/**
 * Send an ephemeral reply showing the player's CC hand.
 * Only the requesting player can see it.
 *
 * @param {import('discord.js').Interaction} interaction - The button interaction
 * @param {string[]} hand - Card names in hand
 * @param {number} deckSize - Cards remaining in deck
 */
export async function sendEphemeralHand(interaction, hand, deckSize) {
  const content = hand.length > 0
    ? `**Your Hand (${hand.length} cards):**\n${hand.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n**Deck:** ${deckSize} remaining`
    : `**Your Hand:** (empty)\n**Deck:** ${deckSize} remaining`;

  try {
    await interaction.followUp({ content, ephemeral: true });
  } catch (err) {
    console.error('[pvp-thread] Failed to send ephemeral hand:', err.message);
  }
}

// ── Thread Archive ──────────────────────────────────────────────────────────

/**
 * Archive the game thread when the game ends.
 * Posts a final summary, then locks and archives.
 *
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} [summary] - { winner, reason }
 */
export async function archiveGameThread(game, client, summary = {}) {
  if (!game.pvpThreadId) return;

  try {
    const thread = await fetchGameChannel(client, game.pvpThreadId);
    if (!thread) return;

    // Post final summary
    const vp1 = game.player1VP?.total || 0;
    const vp2 = game.player2VP?.total || 0;
    const winnerText = summary.winner
      ? `<@${summary.winner}> wins!`
      : (vp1 > vp2 ? `<@${game.player1Id}> wins!` : (vp2 > vp1 ? `<@${game.player2Id}> wins!` : 'Draw!'));
    const reason = summary.reason || '';

    await thread.send({
      content: `**Game Over** — ${winnerText}${reason ? ` (${reason})` : ''}\nFinal score: P1 ${vp1} — P2 ${vp2}`,
      allowedMentions: { users: snowflakeUsers([game.player1Id, game.player2Id]) },
    }).catch(discordCatch);

    // Lock and archive
    await thread.setLocked(true).catch(discordCatch);
    await thread.setArchived(true).catch(discordCatch);
  } catch (err) {
    console.error('[pvp-thread] Failed to archive thread:', err.message);
  }
}

// ── Recovery ────────────────────────────────────────────────────────────────

/**
 * Recovery entry point for returning players.
 * Re-renders both pinned messages from current game state.
 * Identical to updateGameView but logs the recovery.
 *
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} [deps]
 * @param {object} [opts]
 */
export async function recoverGameView(game, client, deps = {}, opts = {}) {
  console.log(`[pvp-thread] Recovering game view for game ${game.gameId}`);
  await updateGameView(game, client, deps, opts);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find which player currently has available actions.
 * Returns 1 or 2. Defaults to 1 if neither has actions (setup states).
 */
function findActivePlayerNum(game, deps) {
  const p1Actions = getAvailableActions(game, 1, deps);
  if (p1Actions.length > 0) return 1;
  const p2Actions = getAvailableActions(game, 2, deps);
  if (p2Actions.length > 0) return 2;
  return 1; // Default: show P1's view
}
