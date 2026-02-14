/**
 * Setup handlers: map_selection_, draft_random_ (more setup handlers to be added: determine_initiative_, deployment_zone_*, deployment_fig_, deployment_orient_, deploy_pick_, deployment_done_)
 */

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getPlayReadyMaps, postMissionCardAfterMapSelection, buildBoardMapPayload, logGameAction, getGeneralSetupButtons, createHandChannels, getHandTooltipEmbed, getSquadSelectEmbed, getHandSquadButtons, client, saveGames
 */
export async function handleMapSelection(interaction, ctx) {
  const {
    getGame,
    getPlayReadyMaps,
    postMissionCardAfterMapSelection,
    buildBoardMapPayload,
    logGameAction,
    getGeneralSetupButtons,
    createHandChannels,
    getHandTooltipEmbed,
    getSquadSelectEmbed,
    getHandSquadButtons,
    client,
    saveGames,
  } = ctx;
  const gameId = interaction.customId.replace('map_selection_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can select the map.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.mapSelected) {
    await interaction.reply({ content: `Map already selected: **${game.selectedMap?.name ?? 'Unknown'}**.`, ephemeral: true }).catch(() => {});
    return;
  }
  const playReadyMaps = getPlayReadyMaps();
  if (playReadyMaps.length === 0) {
    await interaction.reply({
      content: 'No maps have deployment zones configured yet. Add zone data to `data/deployment-zones.json` for at least one map.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }
  const map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
  game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
  game.mapSelected = true;
  await interaction.deferUpdate();
  await postMissionCardAfterMapSelection(game, client, map);
  if (game.boardId) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, map, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to post map to Board channel:', err);
    }
  }
  await logGameAction(game, client, `Map selected: **${map.name}** — View in Board channel.`, { phase: 'SETUP', icon: 'map' });
  if (game.generalSetupMessageId) {
    try {
      const generalChannel = await client.channels.fetch(game.generalId);
      const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
      await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
    } catch (err) {
      console.error('Failed to remove Map Selection button:', err);
    }
  }
  try {
    if (!game.p1HandId || !game.p2HandId) {
      const generalCh = await client.channels.fetch(game.generalId);
      const guild = generalCh.guild;
      const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalCh.parentId);
      const prefix = `IA${game.gameId}`;
      const { p1HandChannel, p2HandChannel } = await createHandChannels(
        guild, gameCategory, prefix, game.player1Id, game.player2Id
      );
      game.p1HandId = p1HandChannel.id;
      game.p2HandId = p2HandChannel.id;
    }
    const p1Hand = await client.channels.fetch(game.p1HandId);
    const p2Hand = await client.channels.fetch(game.p2HandId);
    const isTest = game.player1Id === game.player2Id;
    const p1Id = game.player1Id;
    const p2Id = game.player2Id;
    await p1Hand.send({
      content: `<@${p1Id}>, this is your hand — pick your squad below!${isTest ? ' *(Test — use Select Squad or Default deck buttons for each side.)*' : ''}`,
      allowedMentions: { users: [p1Id] },
      embeds: [getHandTooltipEmbed(game, 1), getSquadSelectEmbed(1, null)],
      components: [getHandSquadButtons(game.gameId, 1)],
    });
    await p2Hand.send({
      content: `<@${p2Id}>, this is your hand — pick your squad below!${isTest ? ' *(Test — use Select Squad or Default deck buttons for each side.)*' : ''}`,
      allowedMentions: { users: [p2Id] },
      embeds: [getHandTooltipEmbed(game, 2), getSquadSelectEmbed(2, null)],
      components: [getHandSquadButtons(game.gameId, 2)],
    });
  } catch (err) {
    console.error('Failed to create/populate Hand channels:', err);
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, runDraftRandom, getGeneralSetupButtons, logGameErrorToBotLogs, extractGameIdFromInteraction, client, saveGames
 */
export async function handleDraftRandom(interaction, ctx) {
  const {
    getGame,
    runDraftRandom,
    getGeneralSetupButtons,
    logGameErrorToBotLogs,
    extractGameIdFromInteraction,
    client,
    saveGames,
  } = ctx;
  const gameId = interaction.customId.replace('draft_random_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can use Draft Random.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.draftRandomUsed || game.currentRound || game.initiativeDetermined || game.deploymentZoneChosen) {
    await interaction.reply({ content: 'Draft Random is only available at game setup.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  try {
    await runDraftRandom(game, client);
    game.draftRandomUsed = true;
    if (game.generalSetupMessageId) {
      try {
        const generalChannel = await client.channels.fetch(game.generalId);
        const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
        await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
      } catch (err) {
        console.error('Failed to update setup buttons after Draft Random:', err);
      }
    }
    saveGames();
  } catch (err) {
    console.error('Draft Random error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'draft_random');
    await interaction.followUp({ content: `Draft Random failed: ${err.message}`, ephemeral: true }).catch(() => {});
  }
}
