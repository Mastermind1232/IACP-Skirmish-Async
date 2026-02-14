/**
 * Interact handlers: interact_cancel_, interact_choice_
 */
const FIGURE_LETTERS = 'abcdefghij';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta
 */
export async function handleInteractCancel(interaction, ctx) {
  const { getGame, dcMessageMeta } = ctx;
  const match = interaction.customId.match(/^interact_cancel_([^_]+)_(.+)_(\d+)$/);
  if (!match) return;
  const [, gameId, msgId, figureIdxStr] = match;
  const game = getGame(gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) return;
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) return;
  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, getLegalInteractOptions, getDcStats, updateDcActionsMessage, logGameAction, saveGames
 */
export async function handleInteractChoice(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    getLegalInteractOptions,
    getDcStats,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^interact_choice_([^_]+)_(.+)_(\d+)_(.+)$/);
  if (!match) return;
  const [, gameId, msgId, figureIdxStr, optionId] = match;
  const figureIndex = parseInt(figureIdxStr, 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) {
    await interaction.reply({ content: 'Invalid.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner can perform this action.', ephemeral: true }).catch(() => {});
    return;
  }
  const actionsData = game.dcActionsData?.[msgId];
  if ((actionsData?.remaining ?? 2) <= 0) {
    await interaction.reply({ content: 'No actions remaining this activation.', ephemeral: true }).catch(() => {});
    return;
  }
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const playerNum = meta.playerNum;
  const mapId = game.selectedMap?.id;
  const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
  const opt = options.find((o) => o.id === optionId);
  if (!opt) {
    await interaction.reply({ content: 'That interact is no longer valid.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});

  actionsData.remaining = Math.max(0, (actionsData?.remaining ?? 2) - 1);
  await updateDcActionsMessage(game, msgId, interaction.client);

  const stats = getDcStats(meta.dcName);
  const displayName = meta.displayName || meta.dcName;
  const shortName = (displayName || meta.dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const figLabel = (stats.figures ?? 1) > 1 ? `${shortName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : shortName;
  const pLabel = `P${playerNum}`;

  if (optionId === 'retrieve_contraband') {
    game.figureContraband = game.figureContraband || {};
    game.figureContraband[figureKey] = true;
    await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** retrieved contraband!`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('launch_panel_')) {
    const parts = optionId.replace('launch_panel_', '').split('_');
    const coord = parts[0];
    const side = parts[1];
    game.launchPanelState = game.launchPanelState || {};
    game.launchPanelState[coord.toLowerCase()] = side;
    if (playerNum === 1) game.p1LaunchPanelFlippedThisRound = true;
    else game.p2LaunchPanelFlippedThisRound = true;
    const upper = String(coord).toUpperCase();
    await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** flipped Launch Panel (${upper}) to **${side}**.`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId === 'use_terminal') {
    await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** used terminal.`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('open_door_')) {
    const edgeKey = optionId.replace('open_door_', '');
    game.openedDoors = game.openedDoors || [];
    if (!game.openedDoors.includes(edgeKey)) game.openedDoors.push(edgeKey);
    const doorLabel = edgeKey.split('|').map((s) => s.toUpperCase()).join('–');
    await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** opened door (${doorLabel}).`, { phase: 'ROUND', icon: 'deploy' });
  } else {
    await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** — ${opt.label}.`, { phase: 'ROUND', icon: 'deploy' });
  }
  saveGames();
}
