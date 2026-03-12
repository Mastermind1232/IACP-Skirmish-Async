/**
 * Hand/discard UI helper functions extracted from index.js.
 * Build Discord UI elements for hand display, squad selection, and deck legality.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { COLORS } from '../discord/colors.js';

/**
 * Build the "End 'End of Round' window" button row for the hand channel.
 * @param {object} game
 * @param {number} playerNum
 * @param {string} gameId
 * @param {object} deps - { getPlayerId }
 * @returns {ActionRowBuilder|null}
 */
export function getHandWindowButtonRow(game, playerNum, gameId, deps) {
  if (!game) return null;
  const whoseTurn = game.endOfRoundWhoseTurn;
  const playerId = deps.getPlayerId(game, playerNum);
  if (!whoseTurn || whoseTurn !== playerId) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`end_end_of_round_${gameId}`)
      .setLabel(`End 'End of Round' window`)
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Build hand channel message payload (delegates to renderFn, injecting local getHandWindowButtonRow).
 * @param {Function} renderFn - the _buildHandDisplayPayload from src/rendering.js
 * @param {Array} hand
 * @param {Array} deck
 * @param {string} gameId
 * @param {object|null} game
 * @param {number} playerNum
 * @param {object} deps - { getPlayerId }
 * @returns {object}
 */
export function buildHandDisplayPayload(renderFn, hand, deck, gameId, game, playerNum, deps) {
  const boundGetHandWindowButtonRow = (g, pn, gid) => getHandWindowButtonRow(g, pn, gid, deps);
  return renderFn(hand, deck, gameId, game, playerNum, { getHandWindowButtonRow: boundGetHandWindowButtonRow });
}

/**
 * Build the squad selection embed for a player.
 * @param {number} playerNum
 * @param {object|null} squad
 * @returns {EmbedBuilder}
 */
export function getSquadSelectEmbed(playerNum, squad) {
  const embed = new EmbedBuilder()
    .setTitle(`Player ${playerNum} – Deck Selection`)
    .setDescription(
      squad
        ? `**Squad:** ${squad.name}\n**Deployment Cards:** ${squad.dcCount ?? '—'} cards\n**Command Cards:** ${squad.ccCount ?? '—'} cards\n\n✓ Squad submitted.`
        : 'Submit your squad using any of these methods:\n' +
          '1. **Select Squad** — fill out the form\n' +
          '2. **Upload a .vsav file** — export from [IACP List Builder](https://iacp-list-builder.onrender.com/)\n' +
          '3. **Copy-paste your list** — from the IACP builder, press the **Share** button and paste the full list below'
    )
    .setColor(COLORS.DARK_EMBED);
  return embed;
}

/**
 * Build a formatted squad confirmation message showing DCs and CCs sorted by cost.
 * @param {object} squad - { dcList, ccList, name }
 * @param {object} validation - { legal, errors, dcTotal, ccCount, ccCost }
 * @param {object} deps - { getDcStats, getCcEffect, DC_POINTS_LEGAL, CC_COST_LEGAL, validateUpgradeWarnings, validateArmyAffiliation }
 * @returns {string}
 */
export function buildSquadConfirmText(squad, validation, deps) {
  const { getDcStats, getCcEffect, DC_POINTS_LEGAL, CC_COST_LEGAL, validateUpgradeWarnings, validateArmyAffiliation } = deps;
  const dcList = squad.dcList || [];
  const ccList = squad.ccList || [];

  // Build DC lines sorted by cost (descending), then name
  const dcEntries = dcList.map(name => {
    const stats = getDcStats(name);
    return { name, cost: stats?.cost ?? 0 };
  });
  dcEntries.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  const dcLines = dcEntries.map(e => `\u2022 ${e.name} — ${e.cost}pt`).join('\n');

  // Build CC lines sorted by cost (descending), then name
  const ccEntries = ccList.map(name => {
    const effect = getCcEffect(name) || getCcEffect(name + '!');
    return { name, cost: effect?.cost ?? 0 };
  });
  ccEntries.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  const ccLines = ccEntries.map(e => `\u2022 ${e.name} — ${e.cost}pt`).join('\n');

  let text = `**${squad.name || 'Unnamed'}**\n\n`;
  text += `**Deployment Cards** (${validation.dcTotal}/${DC_POINTS_LEGAL}pt)\n${dcLines}\n\n`;
  text += `**Command Cards** (${ccList.length} cards, ${validation.ccCost}/${CC_COST_LEGAL}pt)\n${ccLines}`;

  if (!validation.legal) {
    const errorList = validation.errors.map(e => `\u2022 ${e}`).join('\n');
    text += `\n\n\u26a0\ufe0f **Issues detected:**\n${errorList}`;
  }

  // Informational warnings (non-blocking): upgrade expectations + affiliation
  const upgradeWarnings = validateUpgradeWarnings(squad);
  const { warnings: affiliationWarnings } = validateArmyAffiliation(squad);
  const allWarnings = [...upgradeWarnings, ...affiliationWarnings];
  if (allWarnings.length) {
    const warnList = allWarnings.map(w => `\u2022 ${w}`).join('\n');
    text += `\n\n\u2139\ufe0f **Warnings:**\n${warnList}`;
  }

  return text;
}

/**
 * Build the customId for the "PLAY IT ANYWAY" button on an illegal deck alert.
 * @param {string} gameId
 * @param {number} playerNum
 * @returns {string}
 */
export function getDeckIllegalPlayCustomId(gameId, playerNum) {
  return `deck_illegal_play_${gameId}_${playerNum}`;
}

/**
 * Build the customId for the "REDO" button on an illegal deck alert.
 * @param {string} gameId
 * @param {number} playerNum
 * @returns {string}
 */
export function getDeckIllegalRedoCustomId(gameId, playerNum) {
  return `deck_illegal_redo_${gameId}_${playerNum}`;
}
