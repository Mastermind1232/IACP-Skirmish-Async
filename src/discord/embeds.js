import { EmbedBuilder } from 'discord.js';

/**
 * Initiative zone label for scorecard (e.g. "[RED] P1 has the initiative!").
 * @param {object} game
 * @returns {string}
 */
export function getInitiativePlayerZoneLabel(game) {
  if (!game?.initiativeDetermined || !game?.deploymentZoneChosen) return '';
  const playerId = game.initiativePlayerId;
  let zone = '';
  if (playerId === game.player1Id || playerId === game.player2Id) {
    zone = (playerId === game.initiativePlayerId) ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  }
  return zone ? `[${zone.toUpperCase()}] ` : '';
}

/** Build Scorecard embed with VP breakdown per player. Initiative shown via bullet row (no token image). */
export function buildScorecardEmbed(game) {
  const vp1 = game.player1VP || { total: 0, kills: 0, objectives: 0 };
  const vp2 = game.player2VP || { total: 0, kills: 0, objectives: 0 };
  const p1HasInitiative = game.initiativeDetermined && game.initiativePlayerId === game.player1Id;
  const p2HasInitiative = game.initiativeDetermined && game.initiativePlayerId === game.player2Id;

  const fields = [
    { name: 'Player 1', value: `<@${game.player1Id}>`, inline: true },
    { name: 'Player 2', value: `<@${game.player2Id}>`, inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
    { name: 'Total VP', value: `${vp1.total}`, inline: true },
    { name: 'Total VP', value: `${vp2.total}`, inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
    { name: 'Kills', value: `${vp1.kills}`, inline: true },
    { name: 'Kills', value: `${vp2.kills}`, inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
    { name: 'Objectives', value: `${vp1.objectives}`, inline: true },
    { name: 'Objectives', value: `${vp2.objectives}`, inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
  ];
  if (game.initiativeDetermined) {
    const zoneLabel = getInitiativePlayerZoneLabel(game);
    const initiativeValue = p1HasInitiative
      ? `● ${zoneLabel}P1 <@${game.player1Id}> has the initiative!`
      : `● ${zoneLabel}P2 <@${game.player2Id}> has the initiative!`;
    fields.push({ name: 'Initiative', value: initiativeValue, inline: false });
  }

  return new EmbedBuilder().setTitle('Scorecard').setColor(0x2f3136).addFields(fields);
}
