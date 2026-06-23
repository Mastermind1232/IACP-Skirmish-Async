/**
 * Game tools handlers: refresh_map_, refresh_all_, undo_, kill_game_, default_deck_.
 * Participants-only; require getGame and various helpers via context.
 */
import { PermissionFlagsBits } from 'discord.js';
import { deleteGameChannelsAndGame } from './botmenu.js';
import { discordCatch } from '../error-handling.js';
import { logGameAction } from '../discord/messages.js';
import { requireGame, requireParticipant } from '../utils/guards.js';
import { getInitiativePlayerNum, getPlayAreaId, getPlayerId } from '../game/player-helpers.js';
import { PHASES } from '../game/phase.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { captureManualKillDiagnostic } from '../ai/self-play.js';
import { restoreGameStateInPlace } from './checkpoint.js';
import { repopulateDcMapsForGame } from '../game-state.js';
import { resolvePendingCombat } from '../game/combat-stack.js';

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
 * Force-clear a stale pendingCombat. Exposed via the End Activation
 * refusal message when the blocker is `pendingCombat` and the user
 * suspects the combat is left over from an interrupted rebuild. Wipes
 * game.pendingCombat (popping any nested frame), logs the discard to
 * the game log, and tells the user to retry End Activation.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, saveGames, client
 */
export async function handleClearStaleCombat(interaction, ctx) {
  const { getGame, client } = ctx;
  const customId = interaction.customId; // clear_stale_combat_${gameId}_${msgId}
  const rest = customId.slice('clear_stale_combat_'.length);
  const underscore = rest.indexOf('_');
  const gameId = underscore === -1 ? rest : rest.slice(0, underscore);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'force-clear stale combat')) return;
  if (!game.pendingCombat) {
    await interaction.followUp({ content: 'No pending combat to clear. Try End Activation again.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _atk = game.pendingCombat.attackerDcName || 'attacker';
  const _def = game.pendingCombat.target?.label || game.pendingCombat.defenderDcName || 'target';
  resolvePendingCombat(game);
  game._pendingSave = true;
  await logGameAction(game, client, `🧹 Stale pending combat discarded (**${_atk}** → **${_def}**). Use this if a rebuild interrupted an attack.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  await interaction.followUp({ content: '✓ Stale combat cleared. Click **End Activation** again.', ephemeral: true }).catch(discordCatch);
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
  if (!await requireParticipant(interaction, game, 'refresh the map')) return;
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
  const { getGame, refreshAllGameComponents, logGameErrorToBotLogs, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'refresh_all_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'refresh')) return;
  try {
    await refreshAllGameComponents(game, client);
    saveGames(game.gameId);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    await interaction.followUp({ content: '✓ Full refresh complete. Reloaded all JSON data, map renderer cache, map, DCs, hands, discard piles.', ephemeral: true }).catch(discordCatch);
  } catch (err) {
    console.error('Failed to refresh all:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, gameId, err, 'refresh_all');
    await interaction.followUp({ content: 'Failed to refresh: ' + (err?.message || String(err)), ephemeral: true }).catch(discordCatch);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, saveGames, updateMovementBankMessage, buildBoardMapPayload, updateDeployPromptMessages, refreshAllGameComponents, sendPhaseGateMessages, getDeploymentZoneButtons, dcExhaustedState, client
 */
export async function handleUndo(interaction, ctx) {
  const {
    getGame,
    saveGames,
    updateMovementBankMessage,
    buildBoardMapPayload,
    updateDeployPromptMessages,
    getDeploymentZoneButtons,
    refreshAllGameComponents,
    dcExhaustedState,
    client,
  } = ctx;
  const gameId = parseCustomId(interaction.customId, 'undo_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.ended) {
    await interaction.followUp({ content: 'Undo is disabled once the game has ended.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requireParticipant(interaction, game, 'use Undo')) return;
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
    // alexanbv 2026-06-23: keep message (no delete) for traceability
  }

  // === UNIVERSAL SNAPSHOT RESTORE ===
  // Restore entire game state from snapshot. Discord UI refresh routes
  // through refreshAllGameComponents below (Phase-3 renderer wiring) —
  // per-type hooks now only handle surfaces that refreshAll doesn't own
  // (combat/activation thread archives, movement bank, deployment zone
  // post-or-repost, deploy prompts).
  if (last.snapshot) {
    const savedStack = game.undoStack; // already has `last` popped off
    restoreGameStateInPlace(game, last.snapshot);
    game.undoStack = savedStack;

    // Post-Phase-4: dcMessageMeta / dcExhaustedState / dcHealthState are now
    // derived views over canonical game state, so the snapshot restore above
    // already makes them correct. Repopulate is kept as defensive
    // initialization (sets [[null, null]] default for any dcList[i] missing
    // a healthState — possible on legacy save formats).
    try {
      repopulateDcMapsForGame(gameId);
    } catch (err) {
      console.error('Failed to repopulate DC maps after undo:', err);
    }

    // If restored snapshot has an active phase gate, re-send gate messages
    // (old Discord messages are stale after undo).
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

  // Per-type cleanup that the renderer doesn't own:
  //   - thread archives (combat / activation threads)
  //   - movement bank embed (per-DC, not in refreshAll)
  //   - deploy prompts in initiative player's hand (one-shot UI)
  //   - deployment zone picker (delete-and-repost at bottom; surface
  //     not in refreshAll's set)
  // Everything else (DC cards, hand visuals, discard piles, activation
  // counters, round activation message, board map, attachments, DC
  // companions, dcActionsData threads) is rebuilt by refreshAllGameComponents.
  let undoLabel2 = last.label || last.type?.replace(/_/g, ' ') || 'action';
  if (last.type === 'activation' && last.activationThreadId) {
    try {
      const activationThread = await fetchGameChannel(client, last.activationThreadId);
      if (activationThread) {
        await activationThread.send('Activation cancelled (undo).').catch(discordCatch);
        await activationThread.setArchived(true).catch(discordCatch);
      }
    } catch { /* thread gone */ }
    // Pre-refresh: explicitly mark the DC un-exhausted so the refresh
    // re-renders the Activate button. dcExhaustedState is derived view
    // post-Phase-4, but the snapshot may not perfectly mirror it for
    // legacy save formats — be defensive.
    if (last.msgId && dcExhaustedState) dcExhaustedState.set(last.msgId, false);
  } else if (last.type === 'attack' && last.snapshot?.pendingCombat?.combatThreadId) {
    try {
      const combatThread = await fetchGameChannel(client, last.snapshot.pendingCombat.combatThreadId);
      if (combatThread) {
        await combatThread.send('Combat cancelled (undo).').catch(discordCatch);
        await combatThread.setArchived(true).catch(discordCatch);
      }
    } catch { /* thread gone */ }
  } else if (last.type === 'move') {
    if (game.movementBank?.[last.msgId] != null) {
      try { await updateMovementBankMessage(game, last.msgId, client); } catch { /* ignore */ }
    }
  } else if (last.type === 'deploy_pick') {
    if (updateDeployPromptMessages) {
      await updateDeployPromptMessages(game, last.playerNum, client).catch(() => {});
    }
  } else if (last.type === 'deployment_zone') {
    // alexanbv 2026-06-23: keep message (no delete) for traceability — leave
    // the deploy-prompt messages in place.
    // Repost zone picker fresh at the bottom of chat
    if (game.generalId && getDeploymentZoneButtons) {
      try {
        const generalChannel = await fetchGameChannel(client, game.generalId);
        if (game.deploymentZoneMessageId) {
          // alexanbv 2026-06-23: keep old zone picker (no delete) for traceability
          const oldMsg = await generalChannel.messages.fetch(game.deploymentZoneMessageId).catch(() => null);
          if (oldMsg) await oldMsg.edit({ components: [] }).catch(discordCatch);
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
  }

  // Renderer pass — rebuild every owned UI surface from current (post-restore)
  // game state. Replaces ~8 inline updateX calls that the per-type branches
  // used to maintain by hand. Skipped for deploy_pick + deployment_zone
  // because those run pre-game (no DC/hand/round-activation surfaces yet).
  if (refreshAllGameComponents
      && last.type !== 'deploy_pick'
      && last.type !== 'deployment_zone') {
    try {
      await refreshAllGameComponents(game, client);
    } catch (err) {
      console.error('handleUndo: refreshAllGameComponents failed', err);
    }
  } else if (last.type === 'deploy_pick' || last.type === 'deployment_zone') {
    // Pre-game undos still need a board map render.
    if (game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        }
      } catch { /* ignore */ }
    }
  }

  saveGames(game.gameId);
  await interaction.followUp({ content: `${undoLabel2} undone.`, ephemeral: true }).catch(discordCatch);
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
