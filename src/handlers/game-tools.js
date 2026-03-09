/**
 * Game tools handlers: refresh_map_, refresh_all_, undo_, kill_game_, default_deck_.
 * Participants-only; require getGame and various helpers via context.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { deleteGameChannelsAndGame } from './botmenu.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, buildBoardMapPayload, logGameErrorToBotLogs, client
 */
export async function handleRefreshMap(interaction, ctx) {
  const { getGame, buildBoardMapPayload, logGameErrorToBotLogs, client } = ctx;
  const gameId = interaction.customId.replace('refresh_map_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can refresh the map.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!game.selectedMap) {
    await interaction.followUp({ content: 'No map selected yet.', ephemeral: true }).catch(discordCatch);
    return;
  }
  try {
    const boardChannel = await client.channels.fetch(game.boardId);
    const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
    await boardChannel.send(payload);
  } catch (err) {
    console.error('Failed to refresh map:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'refresh_map');
    await interaction.followUp({ content: 'Failed to refresh map.', ephemeral: true }).catch(discordCatch);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, refreshAllGameComponents, logGameErrorToBotLogs, client
 */
export async function handleRefreshAll(interaction, ctx) {
  const { getGame, refreshAllGameComponents, logGameErrorToBotLogs, client } = ctx;
  const gameId = interaction.customId.replace('refresh_all_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can refresh.', ephemeral: true }).catch(discordCatch);
    return;
  }
  try {
    await refreshAllGameComponents(game, client);
    await interaction.followUp({ content: '✓ Full refresh complete. Reloaded all JSON data, map renderer cache, map, DCs, hands, discard piles.', ephemeral: true }).catch(discordCatch);
  } catch (err) {
    console.error('Failed to refresh all:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'refresh_all');
    await interaction.followUp({ content: 'Failed to refresh: ' + (err?.message || String(err)), ephemeral: true }).catch(discordCatch);
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.ended) {
    await interaction.followUp({ content: 'Undo is disabled once the game has ended.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can use Undo.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const last = game.undoStack?.pop();
  if (!last) {
    await interaction.followUp({ content: 'Nothing to undo yet.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Guard: deploy_pick can only be undone during the setup phase (before game rounds begin).
  // Check BEFORE snapshot restore so we inspect current game state, not the snapshot's.
  if (last.type === 'deploy_pick' && game.currentRound) {
    game.undoStack.push(last); // put it back
    await interaction.followUp({ content: 'Deployment undo is only available before the game starts.', ephemeral: true }).catch(discordCatch);
    return;
  }

  /** F14 time-travel: remove the original action message from Game Log so it looks exactly as before. */
  if (last.gameLogMessageId && game.generalId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(last.gameLogMessageId).catch(() => null);
      if (msg) await msg.delete().catch(discordCatch);
    } catch {
      // ignore
    }
  }

  // === UNIVERSAL SNAPSHOT RESTORE ===
  // Restore entire game state from snapshot. Discord UI refresh is handled per-type below.
  if (last.snapshot) {
    const savedStack = game.undoStack; // already has `last` popped off
    for (const key of Object.keys(game)) {
      if (key !== 'undoStack') delete game[key];
    }
    Object.assign(game, last.snapshot);
    game.undoStack = savedStack;
  }
  // ===================================

  // Per-type Discord UI sync (game state is already restored above)
  if (last.type === 'pass_turn') {
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
          }).catch(discordCatch);
        }
      } catch {
        // ignore
      }
    }
    saveGames();
    await interaction.followUp({ content: 'Pass turn undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'move') {
    if (game.movementBank?.[last.msgId] != null) {
      try { await updateMovementBankMessage(game, last.msgId, client); } catch { /* ignore */ }
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
    await interaction.followUp({ content: 'Movement undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'deploy_pick') {
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
    await interaction.followUp({ content: 'Last deployment undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'interact') {
    if (updateDcActionsMessage && last.msgId) await updateDcActionsMessage(game, last.msgId, client).catch(discordCatch);
    saveGames();
    await interaction.followUp({ content: 'Interact undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'cc_play') {
    if (updateHandVisualMessage) await updateHandVisualMessage(game, last.playerNum, client).catch(discordCatch);
    if (updateDiscardPileMessage) await updateDiscardPileMessage(game, last.playerNum, client).catch(discordCatch);
    saveGames();
    await interaction.followUp({ content: 'Command card play undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'cc_play_dc') {
    if (last.previousAttachments != null && last.msgId != null) {
      if (updateAttachmentMessageForDc) await updateAttachmentMessageForDc(game, last.playerNum, last.msgId, client).catch(discordCatch);
    }
    if (updateHandVisualMessage) await updateHandVisualMessage(game, last.playerNum, client).catch(discordCatch);
    if (updateDiscardPileMessage) await updateDiscardPileMessage(game, last.playerNum, client).catch(discordCatch);
    if (updateDcActionsMessage && last.msgId) await updateDcActionsMessage(game, last.msgId, client).catch(discordCatch);
    saveGames();
    await interaction.followUp({ content: 'Command card (Special) play undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'attack' || last.type === 'dc_special' || last.type === 'end_activation') {
    // Refresh DC action counter if we have the msgId
    if (last.msgId && updateDcActionsMessage) await updateDcActionsMessage(game, last.msgId, client).catch(discordCatch);
    // Refresh board if figures may have moved (dc_special with push, etc.)
    if (last.type === 'dc_special' && game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch { /* ignore */ }
    }
    const label = last.label || last.type.replace('_', ' ');
    saveGames();
    await interaction.followUp({ content: `${label} undone.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Unknown type but snapshot was restored — still valid, just no specific Discord cleanup
  if (last.snapshot) {
    saveGames();
    await interaction.followUp({ content: `${last.label || 'Action'} undone.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.followUp({ content: 'That action cannot be undone yet.', ephemeral: true }).catch(discordCatch);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, deleteGame, saveGames, dcMessageMeta, dcExhaustedState, dcHealthState, logGameErrorToBotLogs, client, deleteGameFromDb
 */
export async function handleKillGame(interaction, ctx) {
  const { getGame, logGameErrorToBotLogs } = ctx;
  const gameId = interaction.customId.replace('kill_game_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can kill it.', ephemeral: true });
    return;
  }
  try {
    await deleteGameChannelsAndGame(game, gameId, ctx);
    await interaction.followUp({ content: `Game **IA Game #${gameId}** deleted. All channels removed.`, ephemeral: true }).catch(() => {});
  } catch (err) {
    console.error('Kill game error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'kill_game');
    await interaction.followUp({ content: `Failed to delete: ${err.message}`, ephemeral: true }).catch(discordCatch);
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = parts[2];
  const playerNum = parts[3];
  const faction = parts[4];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.mapSelected) {
    await interaction.followUp({ content: 'Map selection must be completed before you can load a squad.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const isP1 = playerNum === '1';
  const userId = isP1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== userId) {
    await interaction.followUp({ content: 'Only the owner of this hand can load a default deck.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const squadMap = { rebel: DEFAULT_DECK_REBELS, scum: DEFAULT_DECK_SCUM, imperial: DEFAULT_DECK_IMPERIAL };
  const squad = squadMap[faction];
  if (!squad) {
    await interaction.followUp({ content: 'Unknown faction.', ephemeral: true }).catch(discordCatch);
    return;
  }
  try {
    await applySquadSubmission(game, isP1, { ...squad }, client);
    await interaction.followUp({ content: `Loaded **${squad.name}** (${squad.dcCount} DCs, ${squad.ccCount} CCs).`, ephemeral: true }).catch(discordCatch);
  } catch (err) {
    console.error('Failed to apply default deck:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'default_deck');
    await interaction.followUp({ content: `Failed to load deck: ${err.message}`, ephemeral: true }).catch(discordCatch);
  }
}
