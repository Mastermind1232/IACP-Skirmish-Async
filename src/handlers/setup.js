/**
 * Setup handlers: map_selection_, draft_random_, determine_initiative_, deployment_zone_red_/blue_, deployment_fig_, deployment_orient_, deploy_pick_, deployment_done_
 * F17: map_selection_menu_ (Random/Competitive/Select Draw/Selection), map_selection_draw_, map_selection_pick_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

/**
 * Build options for mission select menus (Select Draw / Selection). Value format: "mapId:variant".
 * @param {() => { id: string, name: string, imagePath?: string }[]} getPlayReadyMaps
 * @param {() => Record<string, Record<string, { name: string }>>} getMissionCardsData
 * @returns {{ value: string, label: string }[]}
 */
export function buildPlayableMissionOptions(getPlayReadyMaps, getMissionCardsData) {
  const playReadyMaps = getPlayReadyMaps?.() ?? [];
  const missionCards = getMissionCardsData?.() ?? {};
  const options = [];
  for (const map of playReadyMaps) {
    const variants = missionCards[map.id];
    if (!variants) continue;
    for (const variant of ['a', 'b']) {
      const mission = variants[variant];
      if (!mission?.name) continue;
      options.push({
        value: `${map.id}:${variant}`,
        label: `${map.name} — ${mission.name}`,
      });
    }
  }
  return options;
}

/**
 * F17: Show Map Selection menu (Random / Competitive / Select Draw / Selection). Choice is handled by handleMapSelectionChoice.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getMapSelectionMenu, ...
 */
export async function handleMapSelection(interaction, ctx) {
  const { getGame, getMapSelectionMenu } = ctx;
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
  const playReadyMaps = ctx.getPlayReadyMaps?.() ?? [];
  if (playReadyMaps.length === 0) {
    await interaction.reply({
      content: 'No maps have deployment zones configured yet. Add zone data to `data/deployment-zones.json` for at least one map.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }
  await interaction.reply({
    content: 'Choose how to select the map:',
    components: [getMapSelectionMenu(gameId)],
    ephemeral: false,
  }).catch(() => {});
}

/**
 * F17: Apply map/mission choice (Random, Competitive, or "Not yet implemented" for Select Draw / Selection).
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - getGame, getPlayReadyMaps, getTournamentRotation, getMissionCardsData, getMapRegistry, getMissionSelectDrawMenu, getMissionSelectionPickMenu, postMissionCardAfterMapSelection, postPinnedMissionCardFromGameState, buildBoardMapPayload, logGameAction, getGeneralSetupButtons, createHandChannels, getHandTooltipEmbed, getSquadSelectEmbed, getHandSquadButtons, client, saveGames
 */
export async function handleMapSelectionChoice(interaction, ctx) {
  const {
    getGame,
    getPlayReadyMaps,
    getTournamentRotation,
    getMissionCardsData,
    getMapRegistry,
    getMissionSelectDrawMenu,
    getMissionSelectionPickMenu,
    postMissionCardAfterMapSelection,
    postPinnedMissionCardFromGameState,
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
  const gameId = interaction.customId.replace('map_selection_menu_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.mapSelected) {
    await interaction.reply({ content: 'Map already selected.', ephemeral: true }).catch(() => {});
    return;
  }
  const value = interaction.values?.[0];
  if (value === 'select_draw' || value === 'selection') {
    const options = buildPlayableMissionOptions(getPlayReadyMaps, getMissionCardsData);
    if (value === 'select_draw' && options.length < 2) {
      await interaction.reply({ content: 'Need at least 2 playable missions for Select Draw. Use **Random** or **Selection**.', ephemeral: true }).catch(() => {});
      return;
    }
    if (options.length === 0) {
      await interaction.reply({ content: 'No playable missions. Add mission data and deployment zones for at least one map.', ephemeral: true }).catch(() => {});
      return;
    }
    const content = value === 'select_draw'
      ? 'Choose at least 2 missions (we\'ll pick one at random):'
      : 'Choose one mission:';
    const components = value === 'select_draw'
      ? [getMissionSelectDrawMenu(gameId, options)]
      : [getMissionSelectionPickMenu(gameId, options)];
    await interaction.update({ content, components }).catch(() => {});
    return;
  }
  let map = null;
  if (value === 'competitive') {
    const rotation = getTournamentRotation?.();
    const missionIds = rotation?.missionIds ?? [];
    if (missionIds.length === 0) {
      await interaction.reply({ content: 'No tournament rotation configured. Use **Random** or add missions to `data/tournament-rotation.json`.', ephemeral: true }).catch(() => {});
      return;
    }
    const playReadyMapIds = new Set((getPlayReadyMaps?.() ?? []).map((m) => m.id));
    const playableFromRotation = missionIds.filter((id) => playReadyMapIds.has(String(id).split(':')[0]));
    if (playableFromRotation.length === 0) {
      await interaction.reply({ content: 'No playable missions in tournament rotation (maps need deployment zones and map-spaces). Use **Random**.', ephemeral: true }).catch(() => {});
      return;
    }
    const missionId = playableFromRotation[Math.floor(Math.random() * playableFromRotation.length)];
    const [mapId, variant] = String(missionId).split(':');
    const mapDef = getMapRegistry?.().find((m) => m.id === mapId);
    const missionData = getMissionCardsData?.()[mapId]?.[variant || 'a'];
    if (!mapDef || !missionData) {
      await interaction.reply({ content: 'Invalid mission in rotation. Use **Random**.', ephemeral: true }).catch(() => {});
      return;
    }
    map = { id: mapDef.id, name: mapDef.name, imagePath: mapDef.imagePath };
    game.selectedMap = map;
    game.selectedMission = { variant: variant || 'a', name: missionData.name, fullName: `${map.name} — ${missionData.name}` };
    game.mapSelected = true;
    await interaction.deferUpdate();
    await postPinnedMissionCardFromGameState(game, client);
  } else {
    const playReadyMaps = getPlayReadyMaps();
    if (playReadyMaps.length === 0) {
      await interaction.reply({ content: 'No play-ready maps.', ephemeral: true }).catch(() => {});
      return;
    }
    map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    await interaction.deferUpdate();
    await postMissionCardAfterMapSelection(game, client, map);
  }
  await finishMapSelectionAfterChoice(game, client, ctx);
}

/**
 * Shared post-map-selection: post to board, log, update setup message, create/populate hand channels.
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} ctx - buildBoardMapPayload, logGameAction, getGeneralSetupButtons, createHandChannels, getHandTooltipEmbed, getSquadSelectEmbed, getHandSquadButtons, saveGames
 */
async function finishMapSelectionAfterChoice(game, client, ctx) {
  const {
    buildBoardMapPayload,
    logGameAction,
    getGeneralSetupButtons,
    createHandChannels,
    getHandTooltipEmbed,
    getSquadSelectEmbed,
    getHandSquadButtons,
    saveGames,
  } = ctx;
  const map = game.selectedMap;
  if (game.boardId && map) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, map, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to post map to Board channel:', err);
    }
  }
  const mapName = map?.name ?? 'Map';
  await logGameAction(game, client, `Map selected: **${mapName}** — View in Board channel.`, { phase: 'SETUP', icon: 'map' });
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
 * Resolve a missionId ("mapId:variant") to map + mission and set game.selectedMap / selectedMission.
 * @param {object} game
 * @param {string} missionId - e.g. "mos-eisley-outskirts:a"
 * @param {() => { id: string, name: string, imagePath?: string }[]} getMapRegistry
 * @param {() => Record<string, Record<string, { name: string }>>} getMissionCardsData
 * @returns {boolean} true if resolved
 */
function applyMissionToGame(game, missionId, getMapRegistry, getMissionCardsData) {
  const [mapId, variant] = String(missionId).split(':');
  const v = variant || 'a';
  const mapDef = getMapRegistry?.().find((m) => m.id === mapId);
  const missionData = getMissionCardsData?.()[mapId]?.[v];
  if (!mapDef || !missionData) return false;
  game.selectedMap = { id: mapDef.id, name: mapDef.name, imagePath: mapDef.imagePath };
  game.selectedMission = { variant: v, name: missionData.name, fullName: `${mapDef.name} — ${missionData.name}` };
  game.mapSelected = true;
  return true;
}

/**
 * F17 Select Draw: user chose multiple missions; pick one at random and finish map selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - same as handleMapSelectionChoice
 */
export async function handleMapSelectionDraw(interaction, ctx) {
  const {
    getGame,
    getMapRegistry,
    getMissionCardsData,
    postPinnedMissionCardFromGameState,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('map_selection_draw_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.mapSelected) {
    await interaction.reply({ content: 'Map already selected.', ephemeral: true }).catch(() => {});
    return;
  }
  const values = interaction.values ?? [];
  const missionId = values[Math.floor(Math.random() * values.length)];
  if (!applyMissionToGame(game, missionId, getMapRegistry, getMissionCardsData)) {
    await interaction.reply({ content: 'Invalid mission. Try again or use Random.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  await postPinnedMissionCardFromGameState(game, client);
  await finishMapSelectionAfterChoice(game, client, ctx);
}

/**
 * F17 Selection: user chose one mission; apply and finish map selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - same as handleMapSelectionChoice
 */
export async function handleMapSelectionPick(interaction, ctx) {
  const {
    getGame,
    getMapRegistry,
    getMissionCardsData,
    postPinnedMissionCardFromGameState,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('map_selection_pick_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.mapSelected) {
    await interaction.reply({ content: 'Map already selected.', ephemeral: true }).catch(() => {});
    return;
  }
  const missionId = interaction.values?.[0];
  if (!missionId || !applyMissionToGame(game, missionId, getMapRegistry, getMissionCardsData)) {
    await interaction.reply({ content: 'Invalid mission. Try again or use Random.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  await postPinnedMissionCardFromGameState(game, client);
  await finishMapSelectionAfterChoice(game, client, ctx);
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

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, clearPreGameSetup, logGameAction, getDeploymentZoneButtons, client, saveGames
 */
export async function handleDetermineInitiative(interaction, ctx) {
  const { getGame, clearPreGameSetup, logGameAction, getDeploymentZoneButtons, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('determine_initiative_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can determine initiative.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.initiativeDetermined) {
    await interaction.reply({ content: 'Initiative was already determined.', ephemeral: true }).catch(() => {});
    return;
  }
  const missing = [];
  if (!game.player1Squad) missing.push(`<@${game.player1Id}> (Player 1)`);
  if (!game.player2Squad) missing.push(`<@${game.player2Id}> (Player 2)`);
  if (missing.length > 0) {
    await interaction.reply({ content: 'Both players must select their squads before initiative can be determined.', ephemeral: true }).catch(() => {});
    const generalChannel = await client.channels.fetch(game.generalId).catch(() => null);
    if (generalChannel) {
      await generalChannel.send({
        content: `⚠️ **Initiative blocked** — Squad selection required first.\n\nStill needed: ${missing.join(', ')}`,
        allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
      }).catch(() => {});
    }
    return;
  }
  const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
  const playerNum = winner === game.player1Id ? 1 : 2;
  game.initiativePlayerId = winner;
  game.initiativeDetermined = true;
  await interaction.deferUpdate();
  await clearPreGameSetup(game, client);
  await logGameAction(game, client, `<@${winner}> (**Player ${playerNum}**) won initiative! Chooses deployment zone and activates first each round.`, { allowedMentions: { users: [winner] }, phase: 'INITIATIVE', icon: 'initiative' });
  const generalChannel = await client.channels.fetch(game.generalId);
  const zoneMsg = await generalChannel.send({
    content: `<@${winner}> (**Player ${playerNum}**) — Pick your deployment zone:`,
    allowedMentions: { users: [winner] },
    components: [getDeploymentZoneButtons(gameId)],
  });
  game.deploymentZoneMessageId = zoneMsg.id;
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, client, saveGames
 */
export async function handleDeploymentZone(interaction, ctx) {
  const { getGame, logGameAction, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, client, saveGames } = ctx;
  const isRed = interaction.customId.startsWith('deployment_zone_red_');
  const gameId = interaction.customId.replace(isRed ? 'deployment_zone_red_' : 'deployment_zone_blue_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.initiativePlayerId) {
    await interaction.reply({ content: 'Only the player with initiative can choose the deployment zone.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.deploymentZoneChosen) {
    await interaction.reply({ content: `Deployment zone already chosen: **${game.deploymentZoneChosen}**.`, ephemeral: true }).catch(() => {});
    return;
  }
  const zone = isRed ? 'red' : 'blue';
  const otherZone = zone === 'red' ? 'blue' : 'red';
  game.deploymentZoneChosen = zone;
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  game.player1DeploymentZone = initiativePlayerNum === 1 ? zone : otherZone;
  game.player2DeploymentZone = initiativePlayerNum === 2 ? zone : otherZone;
  await interaction.deferUpdate();
  const zoneLabel = `[${zone.toUpperCase()}] `;
  await logGameAction(game, client, `<@${game.initiativePlayerId}> (${zoneLabel}**Player ${initiativePlayerNum}**) chose the **${zone}** deployment zone`, { allowedMentions: { users: [game.initiativePlayerId] }, phase: 'INITIATIVE', icon: 'zone' });
  if (game.deploymentZoneMessageId) {
    try {
      const generalChannel = await client.channels.fetch(game.generalId);
      const zoneMsg = await generalChannel.messages.fetch(game.deploymentZoneMessageId);
      await zoneMsg.edit({ content: `~~Pick your deployment zone~~ — **${zone}** chosen.`, components: [] });
    } catch (err) {
      console.error('Failed to remove deployment zone buttons:', err);
    }
  }
  const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
  const initiativeSquad = initiativePlayerNum === 1 ? game.player1Squad : game.player2Squad;
  const initiativeDcList = initiativeSquad?.dcList || [];
  const { labels: initiativeLabels, metadata: initiativeMetadata } = getDeployFigureLabels(initiativeDcList);
  const deployLabelsKey = initiativePlayerNum === 1 ? 'player1DeployLabels' : 'player2DeployLabels';
  const deployMetadataKey = initiativePlayerNum === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata';
  game[deployLabelsKey] = initiativeLabels;
  game[deployMetadataKey] = initiativeMetadata;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  try {
    const initiativeHandChannel = await client.channels.fetch(initiativeHandId);
    const { deployRows, doneRow } = getDeployButtonRows(game.gameId, initiativePlayerNum, initiativeDcList, zone, game.figurePositions);
    const DEPLOY_ROWS_PER_MSG = 4;
    game.initiativeDeployMessageIds = game.initiativeDeployMessageIds || [];
    const initiativePing = `<@${game.initiativePlayerId}>`;
    const initMapAttachment = await getDeploymentMapAttachment(game, zone);
    if (deployRows.length === 0) {
      const payload = {
        content: `${initiativePing} — You chose the **${zone}** zone. When finished, click **Deployment Completed** below.`,
        components: [doneRow],
        allowedMentions: { users: [game.initiativePlayerId] },
      };
      if (initMapAttachment) payload.files = [initMapAttachment];
      const msg = await initiativeHandChannel.send(payload);
      game.initiativeDeployMessageIds = [msg.id];
    } else {
      for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
        const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
        const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
        const components = isLastChunk ? [...chunk, doneRow] : chunk;
        const payload = {
          content: i === 0 ? `${initiativePing} — You chose the **${zone}** zone. Deploy each figure below (one per row), then click **Deployment Completed** when finished.` : null,
          components,
          allowedMentions: { users: [game.initiativePlayerId] },
        };
        if (i === 0 && initMapAttachment) payload.files = [initMapAttachment];
        const msg = await initiativeHandChannel.send(payload);
        game.initiativeDeployMessageIds.push(msg.id);
      }
    }
    game.initiativeDeployMessageId = game.initiativeDeployMessageIds[game.initiativeDeployMessageIds.length - 1];
  } catch (err) {
    console.error('Failed to send deploy prompt to initiative player:', err);
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, getDeploymentMapAttachment, client
 */
export async function handleDeploymentFig(interaction, ctx) {
  const {
    getGame,
    getDeploymentZones,
    getFigureSize,
    getFootprintCells,
    filterValidTopLeftSpaces,
    getDeploySpaceGridRows,
    getDeploymentMapAttachment,
    client,
  } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 5) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const flatIndex = parseInt(parts[4], 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
    return;
  }
  const labels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
  const label = labels?.[flatIndex];
  if (!label) {
    await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
  const figMeta = deployMeta?.[flatIndex];
  const figureKey = figMeta ? `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}` : null;
  const occupied = [];
  if (game.figurePositions) {
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        if (p === playerNum && k === figureKey) continue;
        const dcName = k.replace(/-\d+-\d+$/, '');
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
  }
  const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
  const dcName = figMeta?.dcName;
  const figureSize = dcName ? getFigureSize(dcName) : '1x1';
  const isLarge = figureSize !== '1x1';
  const needsOrientation = figureSize === '2x3';
  if (zoneSpaces.length > 0 && needsOrientation) {
    const orientationRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_2x3`)
        .setLabel('2×3 (2 wide, 3 tall)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_3x2`)
        .setLabel('3×2 (3 wide, 2 tall)')
        .setStyle(ButtonStyle.Primary)
    );
    await interaction.reply({
      content: `Choose orientation for **${label.replace(/^Deploy /, '')}** (large unit):`,
      components: [orientationRow],
      ephemeral: false,
    }).catch(() => {});
    return;
  }
  const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, figureSize);
  if (zoneSpaces.length > 0) {
    const { rows, available } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
    if (available.length === 0) {
      await interaction.reply({ content: 'No spaces left in your deployment zone (all occupied or no valid spot for this size).', ephemeral: true }).catch(() => {});
      return;
    }
    const BTM_PER_MSG = 5;
    const firstRows = rows.slice(0, BTM_PER_MSG);
    game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
    const gridKey = `${playerNum}_${flatIndex}`;
    const promptText = isLarge
      ? `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${figureSize} unit):`
      : `Pick a space for **${label.replace(/^Deploy /, '')}**:`;
    const isInitiative = playerNum === initiativePlayerNum;
    const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
    const deployMsgIds = game[idsKey] || [];
    const firstDeployMsgId = deployMsgIds[0];
    if (firstDeployMsgId) {
      try {
        const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
        const handChannel = await client.channels.fetch(handId);
        const deployMsg = await handChannel.messages.fetch(firstDeployMsgId);
        await deployMsg.edit({ attachments: [] });
      } catch {}
    }
    const mapAttachment = await getDeploymentMapAttachment(game, playerZone);
    const replyPayload = { content: promptText, components: firstRows, ephemeral: false, fetchReply: true };
    if (mapAttachment) replyPayload.files = [mapAttachment];
    const replyMsg = await interaction.reply(replyPayload).catch(() => null);
    const gridIds = [];
    if (replyMsg?.id) gridIds.push(replyMsg.id);
    for (let i = BTM_PER_MSG; i < rows.length; i += BTM_PER_MSG) {
      const more = rows.slice(i, i + BTM_PER_MSG);
      if (more.length > 0) {
        const followMsg = await interaction.followUp({ content: null, components: more, fetchReply: true }).catch(() => null);
        if (followMsg?.id) gridIds.push(followMsg.id);
      }
    }
    game.deploySpaceGridMessageIds[gridKey] = gridIds;
  } else {
    const modal = new ModalBuilder()
      .setCustomId(`deploy_modal_${gameId}_${playerNum}_${flatIndex}`)
      .setTitle('Deploy figure');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deploy_space')
          .setLabel('Space (e.g. A1)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. A1')
          .setRequired(true)
      )
    );
    await interaction.showModal(modal).catch(() => {});
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, getDeploymentMapAttachment, client
 */
export async function handleDeploymentOrient(interaction, ctx) {
  const {
    getGame,
    getDeploymentZones,
    getFigureSize,
    getFootprintCells,
    filterValidTopLeftSpaces,
    getDeploySpaceGridRows,
    getDeploymentMapAttachment,
    client,
  } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 6) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const flatIndex = parseInt(parts[4], 10);
  const orientation = parts[5];
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
    return;
  }
  const labels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
  const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
  const label = labels?.[flatIndex];
  const figMeta = deployMeta?.[flatIndex];
  if (!label || !figMeta) {
    await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
  game.pendingDeployOrientation = game.pendingDeployOrientation || {};
  game.pendingDeployOrientation[`${playerNum}_${flatIndex}`] = orientation;
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const occupied = [];
  if (game.figurePositions) {
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        if (p === playerNum && k === figureKey) continue;
        const dcName = k.replace(/-\d+-\d+$/, '');
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
  }
  const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
  const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, orientation);
  if (validSpaces.length === 0) {
    delete game.pendingDeployOrientation[`${playerNum}_${flatIndex}`];
    await interaction.reply({ content: 'No valid spots for this orientation in your zone. Try the other orientation.', ephemeral: true }).catch(() => {});
    return;
  }
  const { rows } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
  const BTM_PER_MSG = 5;
  const firstRows = rows.slice(0, BTM_PER_MSG);
  game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
  const gridKey = `${playerNum}_${flatIndex}`;
  await interaction.deferUpdate();
  const gridIds = [];
  try {
    const isInitiative = playerNum === initiativePlayerNum;
    const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
    const deployMsgIds = game[idsKey] || [];
    const firstDeployMsgId = deployMsgIds[0];
    if (firstDeployMsgId) {
      try {
        const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
        const handChannel = await client.channels.fetch(handId);
        const deployMsg = await handChannel.messages.fetch(firstDeployMsgId);
        await deployMsg.edit({ attachments: [] });
      } catch {}
    }
    const mapAttachment = await getDeploymentMapAttachment(game, playerZone);
    const editPayload = {
      content: `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${orientation} unit):`,
      components: firstRows,
    };
    if (mapAttachment) editPayload.files = [mapAttachment];
    await interaction.message.edit(editPayload);
    if (interaction.message?.id) gridIds.push(interaction.message.id);
    for (let i = BTM_PER_MSG; i < rows.length; i += BTM_PER_MSG) {
      const more = rows.slice(i, i + BTM_PER_MSG);
      if (more.length > 0) {
        const sent = await interaction.channel.send({ content: null, components: more });
        if (sent?.id) gridIds.push(sent.id);
      }
    }
  } catch (err) {
    console.error('Failed to show deploy grid after orientation:', err);
  }
  game.deploySpaceGridMessageIds[gridKey] = gridIds;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, pushUndo, updateDeployPromptMessages, buildBoardMapPayload, client, saveGames
 */
export async function handleDeployPick(interaction, ctx) {
  const { getGame, logGameAction, pushUndo, updateDeployPromptMessages, buildBoardMapPayload, client, saveGames } = ctx;
  const match = interaction.customId.match(/^deploy_pick_([^_]+)_(\d+)_(\d+)_(.+)$/);
  if (!match) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const [, gameId, playerNumStr, flatIndexStr, space] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const flatIndex = parseInt(flatIndexStr, 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(() => {});
    return;
  }
  const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
  const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
  const figMeta = deployMeta?.[flatIndex];
  const figLabel = deployLabels?.[flatIndex];
  if (!figMeta || !figLabel) {
    await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figurePositions[playerNum][figureKey] = space.toLowerCase();
  const pendingOrientation = game.pendingDeployOrientation?.[`${playerNum}_${flatIndex}`];
  if (pendingOrientation) {
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[figureKey] = pendingOrientation;
    delete game.pendingDeployOrientation[`${playerNum}_${flatIndex}`];
  }
  saveGames();
  const spaceUpper = space.toUpperCase();
  const gridKey = `${playerNum}_${flatIndex}`;
  const gridMsgIds = game.deploySpaceGridMessageIds?.[gridKey] || [];
  const clickedMsgId = interaction.message?.id;
  if (gridMsgIds.length > 0) {
    try {
      const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
      const handChannel = await client.channels.fetch(handId);
      for (const msgId of gridMsgIds) {
        if (msgId === clickedMsgId) continue;
        try {
          const msg = await handChannel.messages.fetch(msgId);
          await msg.delete();
        } catch {}
      }
    } catch (err) {
      console.error('Failed to delete space grid messages:', err);
    }
    if (game.deploySpaceGridMessageIds) {
      delete game.deploySpaceGridMessageIds[gridKey];
    }
  }
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const isInitiative = playerNum === initiativePlayerNum;
  const confirmIdsKey = isInitiative ? 'initiativeDeployedConfirmIds' : 'nonInitiativeDeployedConfirmIds';
  if (clickedMsgId) {
    game[confirmIdsKey] = game[confirmIdsKey] || [];
    game[confirmIdsKey].push(clickedMsgId);
  }
  const deployLogMsg = await logGameAction(game, client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
  pushUndo(game, {
    type: 'deploy_pick',
    playerNum,
    figureKey,
    space: spaceUpper,
    figLabel: figLabel.replace(/^Deploy /, ''),
    gameLogMessageId: deployLogMsg?.id,
  });
  await updateDeployPromptMessages(game, playerNum, client);
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after deployment:', err);
    }
  }
  await interaction.update({
    content: `✓ Deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**.`,
    components: [],
    attachments: [],
  }).catch(() => {});
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, getInitiativePlayerZoneLabel, clearPreGameSetup, getCcShuffleDrawButton, buildBoardMapPayload, client, saveGames, isDcAttachment, resolveDcName, isFigurelessDc
 */
export async function handleDeploymentDone(interaction, ctx) {
  const {
    getGame,
    logGameAction,
    getDeployFigureLabels,
    getDeployButtonRows,
    getDeploymentMapAttachment,
    getInitiativePlayerZoneLabel,
    clearPreGameSetup,
    getCcShuffleDrawButton,
    buildBoardMapPayload,
    client,
    saveGames,
    isDcAttachment,
    resolveDcName,
    isFigurelessDc,
  } = ctx;
  const gameId = interaction.customId.replace('deployment_done_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can use this.', ephemeral: true }).catch(() => {});
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.reply({ content: 'Use the Deployment Completed button in your Hand channel.', ephemeral: true }).catch(() => {});
    return;
  }
  const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const isInitiativeSide = (isP1Hand && initiativePlayerNum === 1) || (isP2Hand && initiativePlayerNum === 2);
  const otherZone = game.deploymentZoneChosen === 'red' ? 'blue' : 'red';

  if (isInitiativeSide) {
    if (game.initiativePlayerDeployed) {
      await interaction.reply({ content: "You've already marked deployed.", ephemeral: true }).catch(() => {});
      return;
    }
    game.initiativePlayerDeployed = true;
    await logGameAction(game, client, `<@${interaction.user.id}> finished deploying`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deployed' });
    await interaction.deferUpdate();
    const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
    try {
      const handChannel = await client.channels.fetch(initiativeHandId);
      const toDelete = [...(game.initiativeDeployMessageIds || []), ...(game.initiativeDeployedConfirmIds || [])];
      for (const msgId of toDelete) {
        try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
      }
      game.initiativeDeployMessageIds = [];
      game.initiativeDeployedConfirmIds = [];
      await handChannel.send({ content: '✓ **Deployed.**' });
    } catch (err) {
      console.error('Failed to update initiative deploy message:', err);
    }
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to update map after initiative deployment:', err);
      }
    }
    const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
    const nonInitiativePlayerNum = game.initiativePlayerId === game.player1Id ? 2 : 1;
    const nonInitiativeSquad = nonInitiativePlayerNum === 1 ? game.player1Squad : game.player2Squad;
    const nonInitiativeDcList = nonInitiativeSquad?.dcList || [];
    const { labels: nonInitiativeLabels, metadata: nonInitiativeMetadata } = getDeployFigureLabels(nonInitiativeDcList);
    const deployLabelsKey = nonInitiativePlayerNum === 1 ? 'player1DeployLabels' : 'player2DeployLabels';
    const deployMetadataKey = nonInitiativePlayerNum === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata';
    game[deployLabelsKey] = nonInitiativeLabels;
    game[deployMetadataKey] = nonInitiativeMetadata;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    try {
      const nonInitiativePlayerId = nonInitiativePlayerNum === 1 ? game.player1Id : game.player2Id;
      const nonInitiativeHandChannel = await client.channels.fetch(nonInitiativeHandId);
      const { deployRows, doneRow } = getDeployButtonRows(gameId, nonInitiativePlayerNum, nonInitiativeDcList, otherZone, game.figurePositions);
      const DEPLOY_ROWS_PER_MSG = 4;
      game.nonInitiativeDeployMessageIds = game.nonInitiativeDeployMessageIds || [];
      game.nonInitiativeDeployedConfirmIds = game.nonInitiativeDeployedConfirmIds || [];
      const nonInitiativePing = `<@${nonInitiativePlayerId}>`;
      const nonInitMapAttachment = await getDeploymentMapAttachment(game, otherZone);
      if (deployRows.length === 0) {
        const payload = {
          content: `${nonInitiativePing} — Your opponent has deployed. Deploy in the **${otherZone}** zone. When finished, click **Deployment Completed** below.`,
          components: [doneRow],
          allowedMentions: { users: [nonInitiativePlayerId] },
        };
        if (nonInitMapAttachment) payload.files = [nonInitMapAttachment];
        const msg = await nonInitiativeHandChannel.send(payload);
        game.nonInitiativeDeployMessageIds = [msg.id];
      } else {
        for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
          const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
          const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
          const components = isLastChunk ? [...chunk, doneRow] : chunk;
          const payload = {
            content: i === 0 ? `${nonInitiativePing} — Your opponent has deployed. Deploy each figure in the **${otherZone}** zone below (one per row), then click **Deployment Completed** when finished.` : null,
            components,
            allowedMentions: { users: [nonInitiativePlayerId] },
          };
          if (i === 0 && nonInitMapAttachment) payload.files = [nonInitMapAttachment];
          const msg = await nonInitiativeHandChannel.send(payload);
          game.nonInitiativeDeployMessageIds.push(msg.id);
        }
      }
      game.nonInitiativeDeployMessageId = game.nonInitiativeDeployMessageIds[game.nonInitiativeDeployMessageIds.length - 1];
    } catch (err) {
      console.error('Failed to send deploy prompt to non-initiative player:', err);
    }
    saveGames();
    return;
  }

  if (!game.initiativePlayerDeployed) {
    await interaction.reply({ content: 'Wait for the initiative player to deploy first.', ephemeral: true }).catch(() => {});
    return;
  }
  if (game.nonInitiativePlayerDeployed) {
    await interaction.reply({ content: "You've already marked deployed.", ephemeral: true }).catch(() => {});
    return;
  }
  game.nonInitiativePlayerDeployed = true;
  await interaction.deferUpdate();
  const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
  try {
    const handChannel = await client.channels.fetch(nonInitiativeHandId);
    const toDelete = [...(game.nonInitiativeDeployMessageIds || []), ...(game.nonInitiativeDeployedConfirmIds || [])];
    for (const msgId of toDelete) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game.nonInitiativeDeployMessageIds = [];
    game.nonInitiativeDeployedConfirmIds = [];
    await handChannel.send({ content: '✓ **Deployed.**' });
  } catch (err) {
    console.error('Failed to update non-initiative deploy message:', err);
  }

  const p1CcList = game.player1Squad?.ccList || [];
  const p2CcList = game.player2Squad?.ccList || [];
  // DC attachments (Skirmish Upgrades like [Focused on the Kill]) are always placed at start of game.
  // CC attachments stay in the command deck and are played from hand during the game when drawn.
  const p1DcListRaw = game.player1Squad?.dcList || [];
  const p2DcListRaw = game.player2Squad?.dcList || [];
  const p1SetupAttachments = p1DcListRaw.filter((entry) => isDcAttachment(resolveDcName(entry)));
  const p2SetupAttachments = p2DcListRaw.filter((entry) => isDcAttachment(resolveDcName(entry)));
  if (p1SetupAttachments.length > 0 || p2SetupAttachments.length > 0) {
    game.setupAttachmentPhase = true;
    game.setupAttachmentPending = { 1: p1SetupAttachments.map((e) => resolveDcName(e)), 2: p2SetupAttachments.map((e) => resolveDcName(e)) };
    const generalChannel = await client.channels.fetch(game.generalId);
    await generalChannel.send({
      content: '**Both players have deployed.** Place your Skirmish Upgrade card(s) on your Deployment cards (see your Hand channel). When everyone has placed them, shuffle and draw your starting hands.',
    });
    for (const pn of [1, 2]) {
      const pending = game.setupAttachmentPending[pn];
      if (pending.length === 0) continue;
      const handId = pn === 1 ? game.p1HandId : game.p2HandId;
      const handChannel = await client.channels.fetch(handId);
      const dcList = pn === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const dcMsgIds = pn === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const options = dcList.slice(0, 25).map((dc, i) => ({
        label: (dc.displayName || dc.dcName || `DC ${i + 1}`).slice(0, 100),
        value: (dcMsgIds[i] || String(i)).toString(),
      })).filter((o) => o.value);
      const select = new StringSelectMenuBuilder()
        .setCustomId(`setup_attach_to_${gameId}_${pn}`)
        .setPlaceholder('Attach to which Deployment Card?')
        .addOptions(options);
      await handChannel.send({
        content: `**Setup — place Skirmish Upgrade (1 of ${pending.length}):** **${pending[0]}**. Choose which Deployment Card to attach it to:`,
        components: [new ActionRowBuilder().addComponents(select)],
      });
    }
    saveGames();
    return;
  }

  game.currentRound = 1;
  const generalChannel = await client.channels.fetch(game.generalId);
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const deployContent = `<@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}**Player ${initPlayerNum}**) **Both players have deployed.** Both players: draw your starting hands in your Hand channel. Round 1 will begin when both have drawn.`;
  await generalChannel.send({
    content: deployContent,
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  await clearPreGameSetup(game, client);
  try {
    const p1HandChannel = await client.channels.fetch(game.p1HandId);
    const p2HandChannel = await client.channels.fetch(game.p2HandId);
    const ccDeckText = (list) => list.length ? list.join(', ') : '(no command cards)';
    await p1HandChannel.send({
      content: `**Your Command Card deck** (${p1CcList.length} cards):\n${ccDeckText(p1CcList)}\n\nWhen ready, shuffle and draw your starting 3.`,
      components: [getCcShuffleDrawButton(gameId)],
    });
    await p2HandChannel.send({
      content: `**Your Command Card deck** (${p2CcList.length} cards):\n${ccDeckText(p2CcList)}\n\nWhen ready, shuffle and draw your starting 3.`,
      components: [getCcShuffleDrawButton(gameId)],
    });
  } catch (err) {
    console.error('Failed to send CC deck prompt:', err);
  }
  saveGames();
}

/**
 * Handle setup attachment select: place one attachment CC on chosen DC. When all attachments placed, call finishSetupAttachments.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - getGame, updateAttachmentMessageForDc, StringSelectMenuBuilder, ActionRowBuilder, getCcShuffleDrawButton, clearPreGameSetup, getInitiativePlayerZoneLabel, logGameAction, client, saveGames, finishSetupAttachments
 */
export async function handleSetupAttachTo(interaction, ctx) {
  const {
    getGame,
    updateAttachmentMessageForDc,
    getCcShuffleDrawButton,
    clearPreGameSetup,
    getInitiativePlayerZoneLabel,
    logGameAction,
    client,
    saveGames,
    finishSetupAttachments,
  } = ctx;
  const match = interaction.customId.match(/^setup_attach_to_([^_]+)_([12])$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game || !game.setupAttachmentPhase || !game.setupAttachmentPending) {
    await interaction.reply({ content: 'Game or setup phase not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this hand can place setup attachments.', ephemeral: true }).catch(() => {});
    return;
  }
  const pending = game.setupAttachmentPending[playerNum];
  if (!pending || pending.length === 0) return;
  const card = pending[0];
  const dcMsgId = interaction.values[0];
  if (!dcMsgId) return;

  const attachKey = playerNum === 1 ? 'p1DcAttachments' : 'p2DcAttachments';
  game[attachKey] = game[attachKey] || {};
  if (!Array.isArray(game[attachKey][dcMsgId])) game[attachKey][dcMsgId] = [];
  game[attachKey][dcMsgId].push(card);
  pending.shift();

  await interaction.deferUpdate().catch(() => {});
  try {
    await updateAttachmentMessageForDc(game, playerNum, dcMsgId, client);
  } catch (err) {
    console.error('Failed to update attachment message after setup attach:', err);
  }
  await logGameAction(game, client, `<@${interaction.user.id}> placed **${card}** on a Deployment Card (setup).`, { phase: 'SETUP', icon: 'card', allowedMentions: { users: [interaction.user.id] } });

  const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  const handChannel = await client.channels.fetch(handId);

  if (pending.length > 0) {
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const dcMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const options = dcList.slice(0, 25).map((dc, i) => ({
      label: (dc.displayName || dc.dcName || `DC ${i + 1}`).slice(0, 100),
      value: (dcMsgIds[i] || String(i)).toString(),
    })).filter((o) => o.value);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`setup_attach_to_${gameId}_${playerNum}`)
      .setPlaceholder('Attach to which Deployment Card?')
      .addOptions(options);
    await handChannel.send({
      content: `**Setup — place Skirmish Upgrade (next):** **${pending[0]}**. Choose which Deployment Card to attach it to:`,
      components: [new ActionRowBuilder().addComponents(select)],
    });
    saveGames();
    return;
  }

  const p1Done = (game.setupAttachmentPending[1] || []).length === 0;
  const p2Done = (game.setupAttachmentPending[2] || []).length === 0;
  if (p1Done && p2Done) {
    game.setupAttachmentPhase = false;
    game.setupAttachmentPending = null;
    await finishSetupAttachments(game, client);
  }
  saveGames();
}
