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

/**
 * Format health block for DC embed (single or multi-figure).
 * @param {number} dgIndex - Deployment group index (e.g. 1)
 * @param {[number, number][]} healthState - Per-figure [cur, max]
 * @param {string[][]} [conditionsByFigure] - Optional per-figure condition names (e.g. [['Stun'], ['Weaken']])
 */
export function formatHealthSection(dgIndex, healthState, conditionsByFigure) {
  if (!healthState?.length) return 'Health\n—/—';
  const labels = 'abcdefghij';
  const lines = healthState.map(([cur, max], i) => {
    const c = cur != null ? cur : (max != null ? max : '?');
    const m = max != null ? max : '?';
    if (healthState.length === 1) return `${c}/${m}`;
    return `${dgIndex}${labels[i]}: ${c}/${m}`;
  });
  let out = `Health\n${lines.join('\n')}`;
  if (conditionsByFigure?.length) {
    const condLines = conditionsByFigure
      .map((list, i) => {
        if (!list?.length) return null;
        const label = healthState.length === 1 ? 'Conditions' : `Conditions (${dgIndex}${labels[i]})`;
        return `${label}: ${list.join(', ')}`;
      })
      .filter(Boolean);
    if (condLines.length) out += '\n\n' + condLines.join('\n');
  }
  return out;
}

/** Card-back character for hand/discard visual. */
export const CARD_BACK_CHAR = '▮';

/** Tooltip embed at top of Play Area: player, CC count, DC list. */
export function getPlayAreaTooltipEmbed(game, playerNum) {
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const deckCount = (playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || [])).length;
  const dcList = playerNum === 1 ? (game.p1DcList || game.player1Squad?.dcList || []) : (game.p2DcList || game.player2Squad?.dcList || []);
  const dcNames = Array.isArray(dcList) ? dcList.map((d) => (typeof d === 'object' ? d.dcName || d.displayName : d)).filter(Boolean) : [];
  const dcText = dcNames.length > 0 ? dcNames.join(', ') : '—';
  return new EmbedBuilder()
    .setTitle(`This is Player ${playerNum}'s Play Area`)
    .setDescription(
      `**Player:** <@${playerId}>\n` +
      `**Command Cards in Deck:** ${deckCount}\n` +
      `**Deployment Cards:** ${dcText}`
    )
    .setColor(0x5865f2);
}

/** Tooltip embed for Hand channel. */
export function getHandTooltipEmbed(game, playerNum) {
  return new EmbedBuilder()
    .setTitle('Your Hand')
    .setDescription(
      'Your private channel for **Command Cards** and squad selection. Only you can see this channel.\n\n' +
      '• Select your squad below (form), **upload a .vsav file**, or **copy-paste** your list from the IACP builder Share button\n' +
      '• During the game, your hand is shown here — played cards will show up in the **Game Log**'
    )
    .setColor(0x5865f2);
}

/** Embed showing command cards in hand as card backs. */
export function getHandVisualEmbed(handCount) {
  const count = Math.max(0, handCount ?? 0);
  const cards = CARD_BACK_CHAR.repeat(count) || '—';
  return new EmbedBuilder()
    .setTitle('Command Cards in Hand')
    .setDescription(`**${count}** cards\n${cards}`)
    .setColor(0x2f3136);
}

/** Embed showing discard pile count. */
export function getDiscardPileEmbed(discardCount) {
  const count = Math.max(0, discardCount ?? 0);
  const cards = CARD_BACK_CHAR.repeat(count) || '—';
  return new EmbedBuilder()
    .setTitle('Command Cards in Discard Pile')
    .setDescription(`**${count}** cards\n${cards}`)
    .setColor(0x2f3136);
}

/** Roster text for lobby (Player 1 / Player 2). */
export function getLobbyRosterText(lobby) {
  const p1 = `1. **Player 1:** <@${lobby.creatorId}>`;
  const p2 = lobby.joinedId
    ? `2. **Player 2:** <@${lobby.joinedId}>`
    : `2. **Player 2:** *(not yet joined)*`;
  return `${p1}\n${p2}`;
}

/** Game Lobby embed. */
export function getLobbyEmbed(lobby) {
  const roster = getLobbyRosterText(lobby);
  const isReady = !!lobby.joinedId;
  return new EmbedBuilder()
    .setTitle('Game Lobby')
    .setDescription(`${roster}\n\n${isReady ? 'Both players ready! Click **Start Game** to begin.' : 'Click **Join Game** to play!'}`)
    .setColor(0x2f3136);
}

/** Display names for deploy list: duplicate DCs get [DG 1], [DG 2], etc. */
export function getDeployDisplayNames(dcList) {
  if (!dcList?.length) return [];
  const totals = {};
  const counts = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  return dcList.map((dcName) => {
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    return totals[dcName] > 1 ? `${dcName} [DG ${dgIndex}]` : dcName;
  });
}

/** Max embeds per Discord message (chunking). */
export const EMBEDS_PER_MESSAGE = 10;
