/**
 * Game tools handlers: refresh_map_, refresh_all_, undo_, kill_game_, default_deck_.
 * Participants-only; require getGame and various helpers via context.
 */

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, buildBoardMapPayload, logGameErrorToBotLogs, client
 */
export async function handleRefreshMap(interaction, ctx) {
  const { getGame, buildBoardMapPayload, logGameErrorToBotLogs, client } = ctx;
  const gameId = interaction.customId.replace('refresh_map_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can refresh the map.', ephemeral: true }).catch(() => {});
    return;
  }
  if (!game.selectedMap) {
    await interaction.reply({ content: 'No map selected yet.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  try {
    const boardChannel = await client.channels.fetch(game.boardId);
    const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
    await boardChannel.send(payload);
  } catch (err) {
    console.error('Failed to refresh map:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'refresh_map');
    await interaction.followUp({ content: 'Failed to refresh map.', ephemeral: true }).catch(() => {});
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, refreshAllGameComponents, logGameErrorToBotLogs, client
 */
export async function handleRefreshAll(interaction, ctx) {
  const { getGame, refreshAllGameComponents, logGameErrorToBotLogs, client } = ctx;
  const gameId = interaction.customId.replace('refresh_all_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can refresh.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  try {
    await refreshAllGameComponents(game, client);
    await interaction.followUp({ content: '✓ Full refresh complete. Reloaded all JSON data, map renderer cache, map, DCs, hands, discard piles.', ephemeral: true }).catch(() => {});
  } catch (err) {
    console.error('Failed to refresh all:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'refresh_all');
    await interaction.followUp({ content: 'Failed to refresh: ' + (err?.message || String(err)), ephemeral: true }).catch(() => {});
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, saveGames, updateMovementBankMessage, buildBoardMapPayload, logGameAction, updateDeployPromptMessages, client
 */
export async function handleUndo(interaction, ctx) {
  const {
    getGame,
    saveGames,
    updateMovementBankMessage,
    buildBoardMapPayload,
    logGameAction,
    updateDeployPromptMessages,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('undo_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can use Undo.', ephemeral: true }).catch(() => {});
    return;
  }
  const last = game.undoStack?.pop();
  if (!last) {
    await interaction.reply({ content: 'Nothing to undo yet.', ephemeral: true }).catch(() => {});
    return;
  }
  if (last.type === 'move') {
    if (game.figurePositions?.[last.playerNum]) {
      game.figurePositions[last.playerNum][last.figureKey] = last.previousTopLeft;
    }
    if (last.previousSize && game.figureOrientations) {
      game.figureOrientations[last.figureKey] = last.previousSize;
    }
    const moveKey = `${last.msgId}_${last.figureIndex}`;
    delete game.moveInProgress?.[moveKey];
    if (game.movementBank?.[last.msgId] != null && last.mpRemainingBefore != null) {
      game.movementBank[last.msgId].remaining = last.mpRemainingBefore;
      try {
        await updateMovementBankMessage(game, last.msgId, client);
      } catch (e) { /* ignore */ }
    }
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to update map after undo move:', err);
      }
    }
    await logGameAction(game, client, `<@${interaction.user.id}> undid movement of **${last.displayName}** (back to **${String(last.previousTopLeft).toUpperCase()}**)`, { allowedMentions: { users: [interaction.user.id] }, phase: 'ROUND', icon: 'move' });
    saveGames();
    await interaction.reply({ content: 'Movement undone.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.currentRound) {
    await interaction.reply({ content: 'Undo is only available during deployment for that action.', ephemeral: true }).catch(() => {});
    return;
  }
  if (last.type === 'deploy_pick') {
    if (game.figurePositions?.[last.playerNum]) {
      delete game.figurePositions[last.playerNum][last.figureKey];
    }
    if (game.figureOrientations?.[last.figureKey]) {
      delete game.figureOrientations[last.figureKey];
    }
    await updateDeployPromptMessages(game, last.playerNum, client);
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to update map after undo:', err);
      }
    }
    await logGameAction(game, client, `<@${interaction.user.id}> undid deployment of **${last.figLabel}** at **${last.space}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
    saveGames();
    await interaction.reply({ content: 'Last deployment undone.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.reply({ content: 'That action cannot be undone yet.', ephemeral: true }).catch(() => {});
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, logGameErrorToBotLogs, client
 */
export async function handleKillGame(interaction, ctx) {
  const {
    getGame,
    deleteGame,
    saveGames,
    dcMessageMeta,
    dcExhaustedState,
    dcDepletedState,
    dcHealthState,
    logGameErrorToBotLogs,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('kill_game_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found or already deleted.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can kill it.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    let categoryId = game.gameCategoryId;
    if (!categoryId) {
      const generalCh = await client.channels.fetch(game.generalId).catch(() => null);
      categoryId = generalCh?.parentId;
    }
    if (!categoryId) {
      await interaction.editReply({ content: 'Could not find game category.' });
      return;
    }
    const guild = interaction.guild;
    const category = await guild.channels.fetch(categoryId);
    const children = guild.channels.cache.filter((c) => c.parentId === categoryId);
    for (const ch of children.values()) {
      await ch.delete().catch(() => {});
    }
    await category.delete();
    deleteGame(gameId);
    saveGames();
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === gameId) {
        dcMessageMeta.delete(msgId);
        dcExhaustedState.delete(msgId);
        dcDepletedState.delete(msgId);
        dcHealthState.delete(msgId);
      }
    }
    try {
      await interaction.editReply({ content: `Game **IA Game #${gameId}** deleted. All channels removed.` });
    } catch {
      // Channel was deleted, reply fails - ignore
    }
  } catch (err) {
    console.error('Kill game error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'kill_game');
    try {
      await interaction.editReply({ content: `Failed to delete: ${err.message}` }).catch(() => {});
    } catch {
      // ignore
    }
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, applySquadSubmission, logGameErrorToBotLogs, DEFAULT_DECK_REBELS, DEFAULT_DECK_SCUM, DEFAULT_DECK_IMPERIAL, client
 */
export async function handleDefaultDeck(interaction, ctx) {
  const {
    getGame,
    applySquadSubmission,
    logGameErrorToBotLogs,
    DEFAULT_DECK_REBELS,
    DEFAULT_DECK_SCUM,
    DEFAULT_DECK_IMPERIAL,
    client,
  } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 5) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const gameId = parts[2];
  const playerNum = parts[3];
  const faction = parts[4];
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (!game.mapSelected) {
    await interaction.reply({ content: 'Map selection must be completed before you can load a squad.', ephemeral: true }).catch(() => {});
    return;
  }
  const isP1 = playerNum === '1';
  const userId = isP1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Only the owner of this hand can load a default deck.', ephemeral: true }).catch(() => {});
    return;
  }
  const squadMap = { rebel: DEFAULT_DECK_REBELS, scum: DEFAULT_DECK_SCUM, imperial: DEFAULT_DECK_IMPERIAL };
  const squad = squadMap[faction];
  if (!squad) {
    await interaction.reply({ content: 'Unknown faction.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await applySquadSubmission(game, isP1, { ...squad }, client);
    await interaction.editReply({ content: `Loaded **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs).` }).catch(() => {});
  } catch (err) {
    console.error('Failed to apply default deck:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'default_deck');
    await interaction.editReply({ content: `Failed to load deck: ${err.message}` }).catch(() => {});
  }
}
