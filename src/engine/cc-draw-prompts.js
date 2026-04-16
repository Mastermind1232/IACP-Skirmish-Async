/**
 * CC shuffle/draw prompt dispatch.
 *
 * Pure, idempotent helper that posts the "Both players have deployed" note
 * to the general channel and the "Shuffle and draw your starting 3" buttons
 * to each hand channel. Sets `game.ccShuffleDrawPromptsPosted = true` so it
 * can be safely called from both finishPostDeploy (normal flow) and the
 * refresh safety net (post-restart recovery) without producing duplicates.
 */

import { getInitiativePlayerNum, getPlayerId } from '../game/player-helpers.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';

/**
 * Post CC shuffle/draw prompts if not already posted and not already drawn.
 *
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} deps - { getCcShuffleDrawButton, getInitiativePlayerZoneLabel, saveGames? }
 * @returns {Promise<boolean>} true if prompts were posted this call; false if skipped (idempotent).
 */
export async function sendCcShuffleDrawPrompts(game, client, deps) {
  if (game.ccShuffleDrawPromptsPosted) return false;
  if (game.player1CcDrawn && game.player2CcDrawn) return false;
  if (!game.p1HandId || !game.p2HandId || !game.generalId) return false;

  const { getCcShuffleDrawButton, getInitiativePlayerZoneLabel, saveGames } = deps;
  const gameId = game.gameId;
  const initPlayerNum = getInitiativePlayerNum(game);
  const zoneLabel = getInitiativePlayerZoneLabel ? getInitiativePlayerZoneLabel(game) : '';
  const deployContent = `<@${game.initiativePlayerId}> (${zoneLabel}**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands in the **Your Hand** thread (inside your Play Area). Round 1 will begin when both have drawn.`;

  try {
    const generalChannel = await fetchGameChannel(client, game.generalId);
    if (!generalChannel) return false;
    await generalChannel.send(sanitizeMentions({
      content: deployContent,
      allowedMentions: { users: [game.initiativePlayerId] },
    }));

    const p1CcList = game.player1Squad?.ccList || [];
    const p2CcList = game.player2Squad?.ccList || [];
    const p1Placed = (game.p1CcAttachments && Object.values(game.p1CcAttachments).flat()) || [];
    const p2Placed = (game.p2CcAttachments && Object.values(game.p2CcAttachments).flat()) || [];
    const p1DeckList = p1CcList.filter((c) => !p1Placed.includes(c));
    const p2DeckList = p2CcList.filter((c) => !p2Placed.includes(c));
    const ccDeckText = (list) => list.length ? list.join(', ') : '(no command cards)';
    const p1Id = getPlayerId(game, 1);
    const p2Id = getPlayerId(game, 2);

    const p1HandChannel = await fetchGameChannel(client, game.p1HandId);
    const p2HandChannel = await fetchGameChannel(client, game.p2HandId);

    if (!game.player1CcDrawn && p1HandChannel) {
      await p1HandChannel.send(sanitizeMentions({
        content: `${p1Id ? `<@${p1Id}> ` : ''}**Your Command Card deck** (${p1DeckList.length} cards):\n${ccDeckText(p1DeckList)}\n\nWhen ready, shuffle and draw your starting 3.`,
        components: [getCcShuffleDrawButton(gameId)],
        ...(p1Id && { allowedMentions: { users: [p1Id] } }),
      }));
    }
    if (!game.player2CcDrawn && p2HandChannel) {
      await p2HandChannel.send(sanitizeMentions({
        content: `${p2Id ? `<@${p2Id}> ` : ''}**Your Command Card deck** (${p2DeckList.length} cards):\n${ccDeckText(p2DeckList)}\n\nWhen ready, shuffle and draw your starting 3.`,
        components: [getCcShuffleDrawButton(gameId)],
        ...(p2Id && { allowedMentions: { users: [p2Id] } }),
      }));
    }

    game.ccShuffleDrawPromptsPosted = true;
    if (saveGames) saveGames();
    return true;
  } catch (err) {
    console.error('sendCcShuffleDrawPrompts failed:', err);
    return false;
  }
}
