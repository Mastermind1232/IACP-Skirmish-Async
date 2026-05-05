/**
 * Power token overflow Discord UI prompt.
 * Lives in src/discord/ so engine code can use it without importing from handlers/.
 */
import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { chunkButtonsToRows } from './components.js';
import { discordCatch } from '../error-handling.js';
import { dcNameFromFigureKey, getMaxPowerTokens } from '../game/index.js';

/** Token-type emoji map for display. */
export const TOKEN_EMOJI = { Damage: '🔴', Hit: '🔴', Surge: '⚡', Block: '🛡️', Evade: '🟢' };

/**
 * Check whether game.pendingPowerTokenOverflow has any entries and, if so,
 * send discard-choice buttons for the first figure that is over its cap.
 *
 * @param {object} game
 * @param {string} gameId
 * @param {object} channel - Discord TextChannel / ThreadChannel to send the prompt in
 * @param {number} playerNum - player who owns the figure (for access control)
 * @param {Function} saveGames
 * @returns {Promise<boolean>} true if an overflow prompt was sent
 */
export async function sendPowerTokenOverflowUI(game, gameId, channel, playerNum, saveGames) {
  const overflowArr = game.pendingPowerTokenOverflow;
  if (!overflowArr?.length) return false;
  const entry = overflowArr[0];
  const { figureKey, discardCount } = entry;
  const tokens = game.figurePowerTokens?.[figureKey] || [];
  const max = getMaxPowerTokens(figureKey);
  const figName = dcNameFromFigureKey(figureKey);

  const btns = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const emoji = TOKEN_EMOJI[t] || '';
    btns.push(
      new ButtonBuilder()
        .setCustomId(`pt_overflow_${gameId}_${playerNum}_${figureKey}_${i}`)
        .setLabel(`${emoji} ${t}`.trim())
        .setStyle(ButtonStyle.Secondary)
    );
  }
  const rows = chunkButtonsToRows(btns);

  entry.playerNum = playerNum;
  entry.channelId = channel.id;

  const tokenList = tokens.map(t => `${TOKEN_EMOJI[t] || ''} ${t}`).join(', ');
  await channel.send({
    content: `⚠️ **Power Token Overflow** — **${figName}** has **${tokens.length}** tokens (max ${max}). ` +
      `Discard **${discardCount}** token${discardCount > 1 ? 's' : ''}.\n` +
      `Current tokens: ${tokenList}\n` +
      `Choose which token to discard:`,
    components: rows,
  }).catch(discordCatch);

  if (saveGames) saveGames(game.gameId);
  return true;
}
