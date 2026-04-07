/**
 * Game tools handlers: refresh_map_, refresh_all_, undo_, kill_game_, default_deck_.
 * Participants-only; require getGame and various helpers via context.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { deleteGameChannelsAndGame } from './botmenu.js';
import { discordCatch } from '../error-handling.js';
import { logGameAction } from '../discord/messages.js';
import { requireGame } from '../utils/guards.js';
import { getInitiativePlayerNum, getPlayAreaId, getPlayerId } from '../game/player-helpers.js';
import { PHASES } from '../game/phase.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { captureManualKillDiagnostic } from '../ai/self-play.js';

/** Build a short description of the current game state after an undo, so players know what to do next. */
function describeGameState(game) {
  // Phase-based dispatch
  if (game.phase) {
    switch (game.phase) {
      case 'zone_selection': {
        const chooserId = game.deviousSchemeZoneChooser || game.initiativePlayerId;
        return `Waiting for <@${chooserId}> to pick a deployment zone.`;
      }
      case 'deployment': {
        if (!game.initiativePlayerDeployed) {
          const initPn = getInitiativePlayerNum(game);
          return `Waiting for <@${getPlayerId(game, initPn)}> (initiative) to deploy figures.`;
        }
        if (!game.nonInitiativePlayerDeployed) {
          const otherPn = getInitiativePlayerNum(game) === 1 ? 2 : 1;
          return `Waiting for <@${getPlayerId(game, otherPn)}> to deploy figures.`;
        }
        return null;
      }
      case 'attachment':
        return 'Place Skirmish Upgrade attachments, then confirm.';
      case 'cc_draw': {
        const waiting = [];
        if (!game.player1CcDrawn) waiting.push(`<@${game.player1Id}>`);
        if (!game.player2CcDrawn) waiting.push(`<@${game.player2Id}>`);
        return waiting.length
          ? `Waiting for ${waiting.join(' and ')} to shuffle and draw starting hand.`
          : null;
      }
      case 'round_active':
        if (game.currentRound && game.currentActivationTurnPlayerId) {
          return `Round ${game.currentRound} — <@${game.currentActivationTurnPlayerId}>'s turn.`;
        }
        return null;
      default:
        return null;
    }
  }

  // Legacy fallback for unmigrated games
  if (!game.deploymentZoneChosen) {
    const chooserId = game.deviousSchemeZoneChooser || game.initiativePlayerId;
    return `Waiting for <@${chooserId}> to pick a deployment zone.`;
  }
  if (!game.initiativePlayerDeployed) {
    const initPn = getInitiativePlayerNum(game);
    return `Waiting for <@${getPlayerId(game, initPn)}> (initiative) to deploy figures.`;
  }
  if (!game.nonInitiativePlayerDeployed) {
    const otherPn = getInitiativePlayerNum(game) === 1 ? 2 : 1;
    return `Waiting for <@${getPlayerId(game, otherPn)}> to deploy figures.`;
  }
  if (game.setupAttachmentPhase) {
    return 'Place Skirmish Upgrade attachments, then confirm.';
  }
  if (!game.player1CcDrawn || !game.player2CcDrawn) {
    const waiting = [];
    if (!game.player1CcDrawn) waiting.push(`<@${game.player1Id}>`);
    if (!game.player2CcDrawn) waiting.push(`<@${game.player2Id}>`);
    return `Waiting for ${waiting.join(' and ')} to shuffle and draw starting hand.`;
  }
  if (game.currentRound && game.currentActivationTurnPlayerId) {
    return `Round ${game.currentRound} — <@${game.currentActivationTurnPlayerId}>'s turn.`;
  }
  return null;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, buildBoardMapPayload, logGameErrorToBotLogs, client
 */
export async function handleRefreshMap(interaction, ctx) {
  const { getGame, buildBoardMapPayload, logGameErrorToBotLogs, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'refresh_map_');
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
    const boardChannel = await fetchGameChannel(client, game.boardId);
    if (!boardChannel) throw new Error('Board channel not found');
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
  const gameId = parseCustomId(interaction.customId, 'refresh_all_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can refresh.', ephemeral: true }).catch(discordCatch);
    return;
  }
  try {
    await refreshAllGameComponents(game, client);
    await interaction.message.delete().catch(discordCatch);
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
    getDeploymentZoneButtons,
    dcExhaustedState,
    dcMessageMeta,
    renderDcEmbed,
    getDcPlayAreaComponents,
    updateActivationsMessage,
    client,
  } = ctx;
  const gameId = parseCustomId(interaction.customId, 'undo_');
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
      const ch = await fetchGameChannel(client, game.generalId);
      if (!ch) throw new Error('Channel not found');
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

    // If restored snapshot has an active phase gate, re-send gate messages
    // (old Discord messages are stale after undo)
    if (game.phaseGate) {
      const { sendPhaseGateMessages } = ctx;
      if (sendPhaseGateMessages) {
        try {
          await sendPhaseGateMessages(game, game.phaseGate.phase, ctx);
        } catch (err) {
          console.error('Failed to re-send phase gate after undo:', err);
        }
      }
    }
  }
  // ===================================

  // Log undo to game log so both players can see what was reverted + current state
  const undoLabel = last.label || last.card || last.type?.replace(/_/g, ' ') || 'action';
  const undoUser = interaction.user.username;
  const stateDesc = describeGameState(game);
  const undoLogMsg = stateDesc
    ? `**${undoUser}** undid: ${undoLabel}\n**Current state:** ${stateDesc}`
    : `**${undoUser}** undid: ${undoLabel}`;
  logGameAction(game, client, undoLogMsg).catch(discordCatch);

  // Per-type Discord UI sync (game state is already restored above)
  if (last.type === 'pass_turn') {
    if (last.roundMessageId && last.roundContentBefore != null && game.generalId) {
      try {
        const ch = await fetchGameChannel(client, game.generalId);
        const msg = await ch.messages.fetch(last.roundMessageId).catch(() => null);
        if (msg) {
          const _undoMyRem = game.p1ActivationsRemaining ?? 0;
          const _undoOppRem = game.p2ActivationsRemaining ?? 0;
          const prevPlayerNum = last.previousTurnPlayerId === game.player1Id ? 1 : 2;
          const _myAct = prevPlayerNum === 1 ? _undoMyRem : _undoOppRem;
          const _theirAct = prevPlayerNum === 1 ? _undoOppRem : _undoMyRem;
          const passRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`pass_activation_turn_${last.gameId || gameId}`)
              .setLabel(`Pass (opponent has ${_theirAct - _myAct} more activation${_theirAct - _myAct !== 1 ? 's' : ''} than you)`)
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
  if (last.type === 'activation') {
    // Archive the activation thread
    if (last.activationThreadId) {
      try {
        const activationThread = await fetchGameChannel(client, last.activationThreadId);
        if (activationThread) {
          await activationThread.send('Activation cancelled (undo).').catch(discordCatch);
          await activationThread.setArchived(true).catch(discordCatch);
        }
      } catch { /* thread already gone or inaccessible */ }
    }
    // Un-exhaust the DC and refresh its play area embed
    if (last.msgId && dcExhaustedState && dcMessageMeta) {
      dcExhaustedState.set(last.msgId, false);
      const meta = dcMessageMeta.get(last.msgId);
      if (meta && renderDcEmbed && getDcPlayAreaComponents) {
        try {
          const playAreaId = getPlayAreaId(game, last.playerNum);
          const playChannel = await fetchGameChannel(client, playAreaId);
          const dcMsg = await playChannel.messages.fetch(last.msgId).catch(() => null);
          if (dcMsg) {
            const { embed, files } = await renderDcEmbed(game, last.msgId, ctx, { exhausted: false });
            await dcMsg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(last.msgId, false, game, meta.dcName) });
          }
        } catch (err) {
          console.error('Failed to refresh DC embed after activation undo:', err);
        }
      }
    }
    // Refresh activations message
    if (updateActivationsMessage) {
      try { await updateActivationsMessage(game, last.playerNum, client); } catch { /* ignore */ }
    }
    saveGames();
    await interaction.followUp({ content: 'Activation undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'move') {
    if (game.movementBank?.[last.msgId] != null) {
      try { await updateMovementBankMessage(game, last.msgId, client); } catch { /* ignore */ }
    }
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        }
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
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const payload = await buildBoardMapPayload(gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        }
      } catch (err) {
        console.error('Failed to update map after undo:', err);
      }
    }
    saveGames();
    await interaction.followUp({ content: 'Last deployment undone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (last.type === 'deployment_zone') {
    // Delete the deploy prompt messages that were sent to initiative player's hand
    if (last.deployMessageIds?.length && last.deployHandChannelId) {
      try {
        const handCh = await fetchGameChannel(client, last.deployHandChannelId);
        for (const msgId of last.deployMessageIds) {
          const msg = await handCh.messages.fetch(msgId).catch(() => null);
          if (msg) await msg.delete().catch(discordCatch);
        }
      } catch { /* ignore */ }
    }
    // Delete old zone picker message and send a new one at the bottom of chat
    if (game.generalId && getDeploymentZoneButtons) {
      try {
        const generalChannel = await fetchGameChannel(client, game.generalId);
        if (game.deploymentZoneMessageId) {
          const oldMsg = await generalChannel.messages.fetch(game.deploymentZoneMessageId).catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(discordCatch);
        }
        const zoneChooserId = game.deviousSchemeZoneChooser || game.initiativePlayerId;
        const zoneChooserPlayerNum = zoneChooserId === game.player1Id ? 1 : 2;
        const newMsg = await generalChannel.send({
          content: `<@${zoneChooserId}> (**Player ${zoneChooserPlayerNum}**) — Pick your deployment zone:`,
          components: [getDeploymentZoneButtons(last.gameId || gameId)],
        });
        game.deploymentZoneMessageId = newMsg.id;
      } catch { /* ignore */ }
    }
    saveGames();
    await interaction.followUp({ content: 'Deployment zone selection undone.', ephemeral: true }).catch(discordCatch);
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
    // Step 15: Attack undo — clean up the combat thread
    if (last.type === 'attack' && last.snapshot?.pendingCombat?.combatThreadId) {
      try {
        const combatThread = await fetchGameChannel(client, last.snapshot.pendingCombat.combatThreadId);
        if (combatThread) {
          await combatThread.send('Combat cancelled (undo).').catch(discordCatch);
          await combatThread.setArchived(true).catch(discordCatch);
        }
      } catch { /* thread already gone or inaccessible */ }
    }
    // Step 16: Always refresh board for attack, dc_special, and end_activation undos
    if (game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        }
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
  const gameId = parseCustomId(interaction.customId, 'kill_game_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const isPlayer = interaction.user.id === game.player1Id || interaction.user.id === game.player2Id;
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
  if (!isPlayer && !isAdmin) {
    await interaction.followUp({ content: 'Only players in this game (or server admins) can kill it.', ephemeral: true });
    return;
  }
  try {
    try { await captureManualKillDiagnostic(game, gameId); } catch (e) { console.warn('[kill_game] Pre-kill dump failed:', e.message); }
    await deleteGameChannelsAndGame(game, gameId, ctx);
    await interaction.followUp({ content: `Game **IA Game #${gameId}** deleted. All channels removed.`, ephemeral: true }).catch(discordCatch);
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
  const parts = splitCustomId(interaction.customId, 'default_deck_');
  if (parts.length < 3) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = parts[0];
  const playerNum = parts[1];
  const faction = parts[2];
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
