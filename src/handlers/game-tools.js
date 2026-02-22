/**
 * Game tools handlers: refresh_map_, refresh_all_, undo_, kill_game_, default_deck_.
 * Participants-only; require getGame and various helpers via context.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { deleteGameChannelsAndGame } from './botmenu.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, buildBoardMapPayload, logGameErrorToBotLogs, client
 */
export async function handleRefreshMap(interaction, ctx) {
  const { getGame, buildBoardMapPayload, logGameErrorToBotLogs, client } = ctx;
  const gameId = interaction.customId.replace('refresh_map_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can refresh the map.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!game.selectedMap) {
    await interaction.reply({ content: 'No map selected yet.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Failed to refresh map.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can refresh.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  try {
    await refreshAllGameComponents(game, client);
    await interaction.followUp({ content: '✓ Full refresh complete. Reloaded all JSON data, map renderer cache, map, DCs, hands, discard piles.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    console.error('Failed to refresh all:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'refresh_all');
    await interaction.followUp({ content: 'Failed to refresh: ' + (err?.message || String(err)), ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, saveGames, updateMovementBankMessage, buildBoardMapPayload, updateDeployPromptMessages, updateDcActionsMessage, updateHandVisualMessage, updateDiscardPileMessage, updateAttachmentMessageForDc, client
 */
export async function handleUndo(interaction, ctx) {
  const {
    getGame,
    saveGames,
    updateMovementBankMessage,
    buildBoardMapPayload,
    updateDeployPromptMessages,
    updateDcActionsMessage,
    updateHandVisualMessage,
    updateDiscardPileMessage,
    updateAttachmentMessageForDc,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('undo_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (game.ended) {
    await interaction.reply({ content: 'Undo is disabled once the game has ended.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can use Undo.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const last = game.undoStack?.pop();
  if (!last) {
    await interaction.reply({ content: 'Nothing to undo yet.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  /** F14 time-travel: remove the original action message from Game Log so it looks exactly as before. */
  if (last.gameLogMessageId && game.generalId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(last.gameLogMessageId).catch(() => null);
      if (msg) await msg.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {
      // ignore
    }
  }

  if (last.type === 'pass_turn') {
    game.currentActivationTurnPlayerId = last.previousTurnPlayerId;
    if (last.roundMessageId && last.roundContentBefore != null && game.generalId) {
      try {
        const ch = await client.channels.fetch(game.generalId);
        const msg = await ch.messages.fetch(last.roundMessageId).catch(() => null);
        if (msg) {
          const passRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`pass_activation_turn_${last.gameId || gameId}`)
              .setLabel('Pass turn to opponent')
              .setStyle(ButtonStyle.Secondary)
          );
          await msg.edit({
            content: last.roundContentBefore,
            components: [passRow],
            allowedMentions: { users: [last.previousTurnPlayerId] },
          }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        }
      } catch {
        // ignore
      }
    }
    saveGames();
    await interaction.reply({ content: 'Pass turn undone.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    saveGames();
    await interaction.reply({ content: 'Movement undone.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (game.currentRound) {
    await interaction.reply({ content: 'Undo is only available during deployment for that action.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    saveGames();
    await interaction.reply({ content: 'Last deployment undone.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (last.type === 'interact') {
    const actionsData = game.dcActionsData?.[last.msgId];
    if (actionsData != null) actionsData.remaining = last.previousRemaining ?? (actionsData.remaining + 1);
    if (last.optionId === 'retrieve_contraband' && last.figureKey != null) {
      if (game.figureContraband) delete game.figureContraband[last.figureKey];
    }
    if (last.optionId?.startsWith('launch_panel_') && last.launchPanelCoord != null) {
      if (last.previousLaunchPanelState !== undefined) {
        game.launchPanelState = game.launchPanelState || {};
        game.launchPanelState[last.launchPanelCoord] = last.previousLaunchPanelState;
      } else if (game.launchPanelState) delete game.launchPanelState[last.launchPanelCoord];
      if (last.previousP1LaunchFlipped !== undefined) game.p1LaunchPanelFlippedThisRound = last.previousP1LaunchFlipped;
      if (last.previousP2LaunchFlipped !== undefined) game.p2LaunchPanelFlippedThisRound = last.previousP2LaunchFlipped;
    }
    if (last.optionId?.startsWith('open_door_') && last.openDoorEdgeKey != null && Array.isArray(last.previousOpenedDoors)) {
      game.openedDoors = last.previousOpenedDoors.slice();
    }
    if (updateDcActionsMessage && last.msgId) await updateDcActionsMessage(game, last.msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    await interaction.reply({ content: 'Interact undone.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (last.type === 'cc_play') {
    const handKey = last.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const discardKey = last.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const hand = (game[handKey] || []).slice();
    hand.push(last.card);
    game[handKey] = hand;
    const discard = (game[discardKey] || []).slice();
    const idx = discard.lastIndexOf(last.card);
    if (idx >= 0) discard.splice(idx, 1);
    game[discardKey] = discard;
    if (updateHandVisualMessage) await updateHandVisualMessage(game, last.playerNum, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    if (updateDiscardPileMessage) await updateDiscardPileMessage(game, last.playerNum, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    await interaction.reply({ content: 'Command card play undone.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (last.type === 'cc_play_dc') {
    const handKey = last.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const discardKey = last.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    if (last.previousHand) game[handKey] = last.previousHand.slice();
    if (last.previousDiscard) game[discardKey] = last.previousDiscard.slice();
    if (last.previousAttachments != null && last.msgId != null) {
      const attachKey = last.playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
      game[attachKey] = game[attachKey] || {};
      game[attachKey][last.msgId] = last.previousAttachments.slice();
      if (updateAttachmentMessageForDc) await updateAttachmentMessageForDc(game, last.playerNum, last.msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
    if (updateHandVisualMessage) await updateHandVisualMessage(game, last.playerNum, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    if (updateDiscardPileMessage) await updateDiscardPileMessage(game, last.playerNum, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    if (updateDcActionsMessage && last.msgId) await updateDcActionsMessage(game, last.msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    await interaction.reply({ content: 'Command card (Special) play undone.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.reply({ content: 'That action cannot be undone yet.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, logGameErrorToBotLogs, client, deleteGameFromDb
 */
export async function handleKillGame(interaction, ctx) {
  const { getGame, logGameErrorToBotLogs } = ctx;
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
    await deleteGameChannelsAndGame(game, gameId, ctx);
    try {
      await interaction.editReply({ content: `Game **IA Game #${gameId}** deleted. All channels removed.` });
    } catch {
      // Channel was deleted, reply fails - ignore
    }
  } catch (err) {
    console.error('Kill game error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'kill_game');
    try {
      await interaction.editReply({ content: `Failed to delete: ${err.message}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const gameId = parts[2];
  const playerNum = parts[3];
  const faction = parts[4];
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!game.mapSelected) {
    await interaction.reply({ content: 'Map selection must be completed before you can load a squad.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const isP1 = playerNum === '1';
  const userId = isP1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Only the owner of this hand can load a default deck.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const squadMap = { rebel: DEFAULT_DECK_REBELS, scum: DEFAULT_DECK_SCUM, imperial: DEFAULT_DECK_IMPERIAL };
  const squad = squadMap[faction];
  if (!squad) {
    await interaction.reply({ content: 'Unknown faction.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await applySquadSubmission(game, isP1, { ...squad }, client);
    await interaction.editReply({ content: `Loaded **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs).` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    console.error('Failed to apply default deck:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'default_deck');
    await interaction.editReply({ content: `Failed to load deck: ${err.message}` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
}
