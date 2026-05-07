/**
 * DC Play Area handlers: dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { applyStrain, triggerBleedAfterAction } from './strain-handler.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { truncateLabel, getAttachmentSpecials, chunkButtonsToRows, buildRowPickerButtons, cleanupSpacePick } from '../discord/components.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getPlayableReactionCardsForTiming } from '../game/cc-timing.js';
import { bottomLeftCoord, edgeKey, normalizeCoord } from '../game/coords.js';
import { countSpaces } from '../game/spatial.js';
import { getBrokenWallEdges, getEffectiveMapSpaces } from '../game/movement.js';
import { COLORS } from '../discord/colors.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import { refreshHandAndDiscard } from '../engine/message-updaters.js';
import { setPendingNegation, updatePendingNegation, setPendingCcChoice, clearPendingShoulderRush, clearPendingRushPush, setPendingFalseOrders, clearPendingFalseOrders, clearPendingExecutiveOrder, setPendingOrderedMove, clearPendingOrderedMove, setPendingOrbitalBombardment, clearPendingOrbitalBombardment, clearPendingLure } from '../game/interrupts.js';
import { getConfig } from '../game/figure-config.js';
import { getLoadoutCards, hasMissionFlag } from '../data-loader.js';
import { reduceHp, awardObjectiveVp, applyCondition, filterCondition, dcNameFromFigureKey, isCompanionHostDefeated } from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getActivationsRemaining, getActivatedDcIndices,
  setActivatedDcIndices, recomputeActivationCounts,
  getCcHand, getCcDeck, getSquad,
  ccHandKey, ccDiscardKey, ccAttachmentsKey, dcAttachmentsKey, vpKey as vpKeyFn,
  opponentPlayerNum,
  getInitiativePlayerNum,
  pushFigure,
} from '../game/player-helpers.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { finalizeActivation } from '../engine/activation-setup.js';
import { cleanupActivation } from '../game/activation-state.js';
import { isAphraAlive, applyDubiousCounterpartsActionBump } from '../game/dubious-counterparts-helpers.js';

/** Fury of Kashyyyk grants Reach to all friendly WOOKIEE DCs. */
function _hasFuryReach(game, playerNum, dcKws) {
  if (!dcKws?.some(k => k === 'WOOKIEE')) return false;
  const dcList = getDcList(game, playerNum) || [];
  return dcList.some(dc => dc.dcName === '[Fury of Kashyyyk]');
}

// Ranged attacks are bounded by accuracy roll (see combat.js:~240 — totalAccuracy < distanceToTarget miss),
// not by a hard targeting pre-filter. DC data rarely sets attack.range, so the default must not cap ranged
// targets at 3 spaces. Melee stays adjacent-only; Reach is applied downstream at each call site.
export function defaultAttackRange(attackInfo) {
  if (Array.isArray(attackInfo?.range)) return attackInfo.range;
  return attackInfo?.type === 'melee' ? [1, 1] : [1, 99];
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcActivate(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcExhaustedState,
    renderDcEmbed,
    getDcPlayAreaComponents,
    getDcActionButtons,
    getActionsCounterContent,
    getActivationMinimapAttachment,
    updateActivationsMessage,
    getActivateDcButtons,
    DC_ACTIONS_PER_ACTIVATION,
    ACTION_ICONS,
    saveGames,
    client,
    logGameErrorToBotLogs,
    extractGameIdFromInteraction,
    getDcEffects,
    logGameAction,
  } = ctx;
  const parts = splitCustomId(interaction.customId, 'dc_activate_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const dcIndex = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this Play Area can activate their DCs.')) return;
  const ownerId = getPlayerId(game, playerNum);
  const dcList = getDcList(game, playerNum) || [];
  const dc = dcList[dcIndex];
  if (!dc) {
    await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { dcName, displayName, healthState } = dc;
  const remaining = getActivationsRemaining(game, playerNum);
  if (remaining <= 0) {
    await interaction.followUp({ content: 'No activations remaining this round.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Sit Tight: cannot activate when you have fewer or equal ready DCs than opponent
  if (game.sitTightPlayerNum === playerNum) {
    const oppNum = opponentPlayerNum(playerNum);
    const oppRem = getActivationsRemaining(game, oppNum) ?? 0;
    if (remaining <= oppRem) {
      await interaction.followUp({ content: '**Sit Tight** — you cannot activate until you have more ready Deployment cards than your opponent.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  const dcMessageIds = getDcMessageIds(game, playerNum) || [];
  const msgId = dcMessageIds[dcIndex];
  if (!msgId) {
    await interaction.followUp({ content: 'DC message not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Agitate: if the opponent's surge forced this player's group to activate next
  if (game.agitateNextActivation && game.agitateNextActivation.playerNum === playerNum) {
    const forcedDcName = game.agitateNextActivation.dcName;
    if (dcName !== forcedDcName) {
      const activatedKey = `p${playerNum}ActivatedDcIndices`;
      const forcedIdx = dcList.findIndex((d) => d.dcName === forcedDcName);
      if (forcedIdx >= 0 && !(game[activatedKey] || []).includes(forcedIdx)) {
        await interaction.followUp({ content: `**Agitate** — **${forcedDcName}** must be the next group to activate, if able.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      game.agitateNextActivation = null;
    } else {
      game.agitateNextActivation = null;
    }
  }
  // Force Vision (Kanan): block activation while opponent hasn't picked yet
  if (game.forceVisionPending && game.forceVisionPending === playerNum) {
    await interaction.followUp({ content: `👁️ **Force Vision** — You must first choose a group from the Force Vision prompt before activating.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Force Vision (Kanan): opponent must activate the named group next, if able
  if (game.forceVisionNextActivation && game.forceVisionNextActivation.playerNum === playerNum) {
    const _fvForcedDcName = game.forceVisionNextActivation.dcName;
    if (dcName !== _fvForcedDcName) {
      const _fvActivatedKey = `p${playerNum}ActivatedDcIndices`;
      const _fvForcedIdx = dcList.findIndex((d) => d.dcName === _fvForcedDcName);
      if (_fvForcedIdx >= 0 && !(game[_fvActivatedKey] || []).includes(_fvForcedIdx)) {
        // Check if the forced group still has alive figures
        const _fvFigs = game.figurePositions?.[playerNum] || {};
        const _fvAlive = Object.entries(_fvFigs).some(([fk, pos]) => fk.startsWith(_fvForcedDcName + '-') && pos);
        if (_fvAlive) {
          await interaction.followUp({ content: `👁️ **Force Vision** — **${_fvForcedDcName}** must be the next group to activate, if able.`, ephemeral: true }).catch(discordCatch);
          return;
        }
        // Group is defeated — clear the restriction
        game.forceVisionNextActivation = null;
      } else {
        // Group already activated or not found — clear
        game.forceVisionNextActivation = null;
      }
    } else {
      // Player is activating the forced group — clear the restriction
      game.forceVisionNextActivation = null;
    }
  }
  // Force Slow: per destruct 2026-05-07, "next activation opportunity" means
  // the player's NEXT activation click cannot land on the chosen DC. The
  // restriction is satisfied as soon as the player clicks any OTHER group:
  //   - Click on chosen group → refuse the click (do NOT consume a slot)
  //   - Click on a different group → allow + clear all of this player's
  //     forceSlowSkipActivation flags (the "next" click happened, was not
  //     the chosen group, restriction discharged)
  if (game.forceSlowSkipActivation && Object.keys(game.forceSlowSkipActivation).length > 0) {
    const _fsFigPos = game.figurePositions?.[playerNum] || {};
    let _fsBlockedThisClick = false;
    for (const fk of Object.keys(_fsFigPos)) {
      if (!fk.startsWith(dcName + '-') || !_fsFigPos[fk]) continue;
      if (game.forceSlowSkipActivation[fk]) {
        _fsBlockedThisClick = true;
        await interaction.followUp({ content: `🐌 **Force Slow** — **${displayName}** cannot be your next activation. Activate a different group first.`, ephemeral: true }).catch(discordCatch);
        return;
      }
    }
    if (!_fsBlockedThisClick) {
      // First non-chosen activation by this player — clear ALL of their flags
      let _fsCleared = false;
      for (const fk of Object.keys(game.forceSlowSkipActivation)) {
        if (_fsFigPos[fk]) { delete game.forceSlowSkipActivation[fk]; _fsCleared = true; }
      }
      if (_fsCleared && Object.keys(game.forceSlowSkipActivation).length === 0) delete game.forceSlowSkipActivation;
    }
  }
  // Companion host defeated: companion cannot activate if its host group has left play (rules: COMPANIONS L919-920)
  if (isCompanionHostDefeated(game, dcName, playerNum)) {
    await interaction.followUp({ content: `**${displayName}** cannot activate — its associated group has left play.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Strength in Numbers: enforce combined deployment cost <= 12
  const sinData = game.strengthInNumbersData;
  if (sinData && sinData.playerNum === playerNum) {
    const candidateCost = ctx.getDcStats?.(dcName)?.cost ?? 0;
    const combinedCost = (sinData.triggeringGroupCost || 0) + candidateCost;
    if (combinedCost > 12) {
      await interaction.followUp({
        content: `**Strength in Numbers** — Combined deployment cost of **${sinData.triggeringGroupName || 'previous group'}** (${sinData.triggeringGroupCost}) + **${displayName}** (${candidateCost}) = **${combinedCost}**, which exceeds the 12-point cap. Choose a cheaper group.`,
        ephemeral: true,
      }).catch(discordCatch);
      return;
    }
  }
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const isMyTurn = ownerId === turnPlayerId;
  if (!isMyTurn && !game.selfPlay) {
    const playAreaCh = await fetchGameChannel(client, getPlayAreaId(game, playerNum));
    const promptRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_activate_${gameId}_${msgId}_${interaction.message.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_activate_${gameId}_${ownerId}`).setLabel('No').setStyle(ButtonStyle.Danger)
    );
    await withDiscordRetry(() => playAreaCh.send(sanitizeMentions({
      content: `<@${ownerId}> You are not first to act. Activate anyway?`,
      components: [promptRow],
      allowedMentions: { users: [ownerId] },
    })));
    return;
  }
  try {
    const channel = await fetchGameChannel(client, getPlayAreaId(game, playerNum));
    const dcMessage = await channel.messages.fetch(msgId);
    await finalizeActivation({
      game, gameId, playerNum, dcIndex,
      dcName, displayName, msgId, ownerId,
      dcMessage,
      editActivateReplyFn: (rows) => interaction.editReply({
        content: '**Activate a Deployment Card**',
        components: rows.length > 0 ? rows : [],
      }),
      deps: {
        dcExhaustedState, dcHealthState: ctx.dcHealthState,
        dcMessageMeta: ctx.dcMessageMeta,
        buildDcEmbedAndFiles: ctx.buildDcEmbedAndFiles,
        renderDcEmbed, getDcPlayAreaComponents,
        updateActivationsMessage, getActionsCounterContent,
        getDcActionButtons, getActivationMinimapAttachment,
        getActivateDcButtons,
        DC_ACTIONS_PER_ACTIVATION, ACTION_ICONS,
        logGameAction, saveGames, client,
        findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
        hasLineOfSight: ctx.hasLineOfSight,
        getMapData: ctx.getMapData,
        getDcStats: ctx.getDcStats,
      },
    });
  } catch (err) {
    console.error('dc_activate_ error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'dc_activate');
    await interaction.followUp({ content: `Activation failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch(discordCatch);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcUnactivate(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    renderDcEmbed,
    getDcPlayAreaComponents,
    updateActivationsMessage,
    saveGames,
    client,
  } = ctx;
  const msgId = parseCustomId(interaction.customId, 'dc_unactivate_');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner can un-activate.')) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  const wasExhausted = dcExhaustedState.get(msgId) ?? false;
  if (!wasExhausted) {
    await interaction.followUp({ content: 'DC is not activated.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData && actionsData.remaining < actionsData.total) {
    await interaction.followUp({ content: 'Cannot un-activate — actions have already been performed.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Also block unactivate if MP was spent (e.g. Boba Fett's abilities cost MP, not actions)
  const bank = game.movementBank?.[msgId];
  if (bank && bank.remaining < bank.total) {
    await interaction.followUp({ content: 'Cannot un-activate — movement points have been spent.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const displayName = meta.displayName || meta.dcName;
  dcExhaustedState.set(msgId, false);
  const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
  if (dcIndex !== -1 && getActivatedDcIndices(game, meta.playerNum)) {
    setActivatedDcIndices(game, meta.playerNum, getActivatedDcIndices(game, meta.playerNum).filter((i) => i !== dcIndex));
  }
  recomputeActivationCounts(game, meta.playerNum);
  await updateActivationsMessage(game, meta.playerNum, client);
  const threadId = game.dcActionsData?.[msgId]?.threadId;
  if (threadId) {
    try {
      const thread = await fetchGameChannel(client, threadId);
      if (thread) await thread.delete();
    } catch (err) {
      console.error('Failed to delete activation thread on un-activate:', err);
    }
  }
  if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
  if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
  if (game.nextAttacksBonusHits?.[meta.playerNum]) delete game.nextAttacksBonusHits[meta.playerNum];
  if (game.nextAttacksBonusConditions?.[meta.playerNum]) delete game.nextAttacksBonusConditions[meta.playerNum];
  if (game.nextAttackBonusSurgeAbilities?.[meta.playerNum]) delete game.nextAttackBonusSurgeAbilities[meta.playerNum];
  if (game.nextAttackBonusPierce?.[meta.playerNum]) delete game.nextAttackBonusPierce[meta.playerNum];
  if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
  if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
  if (game.hitAndRunPendingMp?.msgId === msgId) delete game.hitAndRunPendingMp;
  if (game.pendingOverrideAttackDice?.[msgId]) delete game.pendingOverrideAttackDice[msgId];
  if (game.saberOrbitAttacksRemaining?.[msgId]) delete game.saberOrbitAttacksRemaining[msgId];
  if (game.pendingMissileSalvo?.[msgId]) delete game.pendingMissileSalvo[msgId];
  if (game.pendingEe3Carbine?.[msgId]) delete game.pendingEe3Carbine[msgId];
  // Wave 4: Stun is NOT auto-cleared at end of activation.
  // Stunned figures must spend 1 action (dc_remove_stun_) to discard Stun (rules: STUNNED L2759-2762).
  if (game.dcActivationLogMessageIds?.[msgId]) {
    try {
      const logCh = await fetchGameChannel(client, game.generalId);
      if (logCh) {
        const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
        await logMsg.delete().catch(discordCatch);
      }
    } catch {}
    delete game.dcActivationLogMessageIds[msgId];
  }
  // Clean all activation-scoped flags (scalars, msgId-keyed, figKey-keyed, playerNum-keyed).
  // The manual deletes above handle Discord-specific cleanup (thread, log message);
  // cleanupActivation handles the full game-state safety net.
  {
    const getDcEffects = ctx.getDcEffects;
    const _uaEff = getDcEffects?.()?.[meta.dcName];
    const _uaFigCount = _uaEff?.figures || 1;
    const _uaDgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '0';
    const _uaFigureKeys = [];
    for (let fi = 0; fi < _uaFigCount; fi++) {
      _uaFigureKeys.push(`${meta.dcName}-${_uaDgIdx}-${fi}`);
    }
    cleanupActivation(game, msgId, meta.playerNum, _uaFigureKeys);
  }
  const { embed, files } = await renderDcEmbed(game, msgId, ctx, { exhausted: false });
  await interaction.message.edit({
    embeds: [embed],
    files,
    components: getDcPlayAreaComponents(msgId, false, game, meta.dcName),
  });
  saveGames(game.gameId);
}

/**
 * Remove Stun: costs 1 action (rules: STUNNED L2759-2762).
 * customId format: dc_remove_stun_{msgId}_f{figureIndex}
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcRemoveStun(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    DC_ACTIONS_PER_ACTIVATION,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
    client,
  } = ctx;
  const m = interaction.customId.match(/^dc_remove_stun_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid remove-stun button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const msgId = m[1];
  const figureIndex = parseInt(m[2], 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this Play Area can use these actions.')) return;

  const actionsData = game.dcActionsData?.[msgId];
  const actionsRemaining = actionsData?.remaining ?? DC_ACTIONS_PER_ACTIVATION;
  if (actionsRemaining <= 0) {
    await interaction.followUp({ content: 'No actions remaining this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const conds = game.figureConditions?.[figureKey] || [];
  if (!conds.includes('Stun')) {
    await interaction.followUp({ content: 'This figure is not Stunned.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Remove Stun and spend 1 action
  filterCondition(game, figureKey, 'Stun');
  actionsData.remaining = Math.max(0, actionsData.remaining - 1);

  const displayName = meta.displayName || meta.dcName;
  await logGameAction(game, client, `⚡ **${displayName}** spent 1 action to remove **Stunned**.`, { phase: 'ACTIVATION', icon: 'condition' });

  await updateDcActionsMessage(interaction, game, msgId, meta);
  // Post-action Bleed strain: Stun-discard IS an action, so Bleed strain
  // fires after it resolves (destruct 2026-05-07). If the figure was
  // both Stunned AND Bleeding and chose to discard Stun, they still
  // suffer the Bleed strain afterward.
  await triggerBleedAfterAction(game, ctx, figureKey, meta.playerNum);
  saveGames(game.gameId);
}

/**
 * Discard a Bleed condition for 1 action — destruct 2026-05-07: parallel
 * to dc_remove_stun_. customId format: dc_remove_bleed_{msgId}_f{figureIndex}.
 * Per IACP "Recover" rule: spend 1 action to discard a Bleed condition.
 * The action itself does NOT trigger post-action Bleed strain (the very
 * Bleed condition is being removed by the action — there's nothing left
 * to fire).
 */
export async function handleDcRemoveBleed(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    DC_ACTIONS_PER_ACTIVATION,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
    client,
  } = ctx;
  const m = interaction.customId.match(/^dc_remove_bleed_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid remove-bleed button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const msgId = m[1];
  const figureIndex = parseInt(m[2], 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this Play Area can use these actions.')) return;

  const actionsData = game.dcActionsData?.[msgId];
  const actionsRemaining = actionsData?.remaining ?? DC_ACTIONS_PER_ACTIVATION;
  if (actionsRemaining <= 0) {
    await interaction.followUp({ content: 'No actions remaining this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const conds = game.figureConditions?.[figureKey] || [];
  if (!conds.includes('Bleed')) {
    await interaction.followUp({ content: 'This figure is not Bleeding.', ephemeral: true }).catch(discordCatch);
    return;
  }

  filterCondition(game, figureKey, 'Bleed');
  actionsData.remaining = Math.max(0, actionsData.remaining - 1);

  const displayName = meta.displayName || meta.dcName;
  await logGameAction(game, client, `⚡ **${displayName}** spent 1 action to remove **Bleeding**.`, { phase: 'ACTIVATION', icon: 'condition' });
  await updateDcActionsMessage(interaction, game, msgId, meta);
  // No triggerBleedAfterAction here — the Bleed was just discarded by
  // this very action.
  saveGames(game.gameId);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcToggle(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    renderDcEmbed,
    getDcPlayAreaComponents,
    getDcActionButtons,
    getActionsCounterContent,
    getActivationMinimapAttachment,
    updateActivationsMessage,
    DC_ACTIONS_PER_ACTIVATION,
    ACTION_ICONS,
    logGameAction,
    saveGames,
    client,
  } = ctx;
  const msgId = parseCustomId(interaction.customId, 'dc_toggle_');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Companions activate at the start or end of the host's activation, not independently.
  // TODO: Ugnaught Tinkerer's Junk Droid (Scrap Battalion) is a special case that activates
  // as part of the host's group — needs deeper review before allowing companion-button paths.
  if (meta.isCompanion) {
    await interaction.followUp({
      content: `**${meta.displayName || meta.dcName}** activates with **${meta.hostDcName}** — pick the host's Activate button instead.`,
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this Play Area can toggle their DCs.')) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  const wasExhausted = dcExhaustedState.get(msgId) ?? false;
  const nowExhausted = !wasExhausted;
  const healthState = dcHealthState.get(msgId) ?? [[null, null]];
  const displayName = meta.displayName || meta.dcName;
  const playerId = getPlayerId(game, meta.playerNum);

  if (!wasExhausted && nowExhausted) {
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    const isMyTurn = playerId === turnPlayerId;
    if (!isMyTurn) {
      const playAreaCh = await fetchGameChannel(client, getPlayAreaId(game, meta.playerNum));
      const promptRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_activate_${game.gameId}_${msgId}_0`).setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_activate_${game.gameId}_${playerId}`).setLabel('No').setStyle(ButtonStyle.Danger)
      );
      await withDiscordRetry(() => playAreaCh.send({
        content: `<@${playerId}> You are not first to act. Activate anyway?`,
        components: [promptRow],
        allowedMentions: { users: [playerId] },
      }));
      return;
    }
    const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
    await finalizeActivation({
      game, gameId: meta.gameId, playerNum: meta.playerNum, dcIndex,
      dcName: meta.dcName, displayName, msgId, ownerId,
      dcMessage: interaction.message,
      deps: {
        dcExhaustedState, dcHealthState,
        dcMessageMeta,
        buildDcEmbedAndFiles: ctx.buildDcEmbedAndFiles,
        renderDcEmbed, getDcPlayAreaComponents,
        updateActivationsMessage, getActionsCounterContent,
        getDcActionButtons, getActivationMinimapAttachment,
        getActivateDcButtons: ctx.getActivateDcButtons,
        DC_ACTIONS_PER_ACTIVATION, ACTION_ICONS,
        logGameAction, saveGames, client,
        findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
        hasLineOfSight: ctx.hasLineOfSight,
        getMapData: ctx.getMapData,
        getDcStats: ctx.getDcStats,
      },
    });
    return; // orchestrator handles embed re-render, save, and log
  }
  if (wasExhausted && !nowExhausted) {
    dcExhaustedState.set(msgId, false);
    const dcIdx = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
    if (dcIdx !== -1 && getActivatedDcIndices(game, meta.playerNum)) {
      setActivatedDcIndices(game, meta.playerNum, getActivatedDcIndices(game, meta.playerNum).filter((i) => i !== dcIdx));
    }
    recomputeActivationCounts(game, meta.playerNum);
    await updateActivationsMessage(game, meta.playerNum, client);
    const threadId = game.dcActionsData?.[msgId]?.threadId;
    if (threadId) {
      try {
        const thread = await fetchGameChannel(client, threadId);
        if (thread) await thread.delete();
      } catch (err) {
        console.error('Failed to delete activation thread on ready:', err);
      }
    }
    if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
    if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
    if (game.nextAttacksBonusHits?.[meta.playerNum]) delete game.nextAttacksBonusHits[meta.playerNum];
    if (game.nextAttacksBonusConditions?.[meta.playerNum]) delete game.nextAttacksBonusConditions[meta.playerNum];
    if (game.nextAttackBonusSurgeAbilities?.[meta.playerNum]) delete game.nextAttackBonusSurgeAbilities[meta.playerNum];
    if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
    if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
    if (game.dcActivationLogMessageIds?.[msgId]) {
      try {
        const logCh = await fetchGameChannel(client, game.generalId);
        if (logCh) {
          const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
          await logMsg.delete().catch(discordCatch);
        }
      } catch {}
      delete game.dcActivationLogMessageIds[msgId];
    }
  }
  saveGames(game.gameId);
  if (!nowExhausted) {
    const pLabel = `P${meta.playerNum}`;
    await logGameAction(game, client, `**${pLabel}:** <@${playerId}> readied **${displayName}**`, { allowedMentions: { users: [playerId] }, icon: 'ready' });
  }
  const { embed, files } = await renderDcEmbed(game, msgId, ctx);
  const components = getDcPlayAreaComponents(msgId, nowExhausted, game, meta.dcName);
  await interaction.editReply({
    embeds: [embed],
    files,
    components,
  });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcDeplete(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    isDepletedRemovedFromGame,
    renderDcEmbed,
    logGameAction,
    saveGames,
    client,
  } = ctx;
  const msgId = parseCustomId(interaction.customId, 'dc_deplete_');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this Play Area can Deplete their upgrade.')) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  if (isDepletedRemovedFromGame(game, msgId)) {
    await interaction.followUp({ content: 'This upgrade was already depleted and removed from the game.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (meta.playerNum === 1) {
    game.p1DepletedDcMessageIds = game.p1DepletedDcMessageIds || [];
    if (!game.p1DepletedDcMessageIds.includes(msgId)) game.p1DepletedDcMessageIds.push(msgId);
  } else {
    game.p2DepletedDcMessageIds = game.p2DepletedDcMessageIds || [];
    if (!game.p2DepletedDcMessageIds.includes(msgId)) game.p2DepletedDcMessageIds.push(msgId);
  }
  const displayName = meta.displayName || meta.dcName;
  const { embed, files } = await renderDcEmbed(game, msgId, ctx, { exhausted: false, healthState: [] });
  embed.setTitle(`REMOVED FROM GAME (Depleted) — ${displayName}`);
  embed.setDescription((embed.data.description || '') + '\n\n*This upgrade was depleted and is no longer in play (one-time use).*');
  embed.setColor(COLORS.GRAY);
  await withDiscordRetry(() => interaction.message.edit({ embeds: [embed], files, components: [] }));
  await logGameAction(game, client, `**P${meta.playerNum}:** <@${ownerId}> depleted **${displayName}** — removed from game`, { allowedMentions: { users: [ownerId] }, icon: 'deplete' });
  saveGames(game.gameId);
}

/**
 * Show a modal to rename figures in a multi-figure DC (deployment phase only).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcRename(interaction, ctx) {
  const { dcMessageMeta, getDcStats, FIGURE_LETTERS } = ctx;
  const msgId = parseCustomId(interaction.customId, 'dc_rename_');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const stats = getDcStats(meta.dcName);
  const figures = stats?.figures ?? 1;
  if (figures <= 1) {
    await interaction.reply({ content: 'This DC only has one figure.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const dgIndex = meta.displayName.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const letters = FIGURE_LETTERS || 'abcdefghij';
  const game = ctx.getGame(meta.gameId);
  game.figureNicknames = game.figureNicknames || {};

  const modal = new ModalBuilder()
    .setCustomId(`dc_rename_modal_${msgId}`)
    .setTitle(`Rename ${meta.displayName}`.slice(0, 45));

  const count = Math.min(figures, 5); // Discord modal limit: 5 text inputs
  for (let i = 0; i < count; i++) {
    const figLabel = `${dgIndex}${letters[i]}`;
    const figKey = `${meta.dcName}-${dgIndex}-${i}`;
    const currentNick = game.figureNicknames[figKey] || '';
    const input = new TextInputBuilder()
      .setCustomId(`fig_${i}`)
      .setLabel(`Figure ${figLabel}`)
      .setPlaceholder(figLabel)
      .setValue(currentNick)
      .setRequired(false)
      .setMaxLength(20)
      .setStyle(TextInputStyle.Short);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  await interaction.showModal(modal);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcCcSpecial(interaction, ctx) {
  return _playCcFromDcThread(interaction, ctx, 'dc_cc_special_', ctx.getPlayableCcSpecialsForDc, 'Special Action');
}

export async function handleDcCcEndOfActivation(interaction, ctx) {
  return _playCcFromDcThread(interaction, ctx, 'dc_cc_eoa_', ctx.getPlayableCcEndOfActivationForDc, 'End of Activation');
}

export async function handleDcCcDoubleAction(interaction, ctx) {
  return _playCcFromDcThread(interaction, ctx, 'dc_cc_double_', ctx.getPlayableCcDoubleActionsForDc, 'Double Action');
}

async function _playCcFromDcThread(interaction, ctx, idPrefix, getCardList, timingLabel) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    getCcEffect,
    resolveAbility,
    isCcAttachment,
    updateAttachmentMessageForDc,
    buildHandDisplayPayload,
    updateHandVisualMessage,
    updateDiscardPileMessage,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
    client,
  } = ctx;
  const rest = parseCustomId(interaction.customId, idPrefix);
  const lastUnderscore = rest.lastIndexOf('_');
  const msgId = rest.slice(0, lastUnderscore);
  const idx = parseInt(rest.slice(lastUnderscore + 1), 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this activation can play a CC here.')) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  const playable = getCardList(game, meta.playerNum, meta.dcName, meta.displayName);
  const card = playable[idx];
  const handKey = ccHandKey(meta.playerNum);
  const discardKey = ccDiscardKey(meta.playerNum);
  const hand = game[handKey] || [];
  if (!card || hand.indexOf(card) < 0) {
    await interaction.followUp({ content: "That card isn't in your hand or isn't playable for this figure.", ephemeral: true }).catch(discordCatch);
    return;
  }
  // F14: Snapshot for undo before mutating
  const previousHand = (game[handKey] || []).slice();
  const previousDiscard = (game[discardKey] || []).slice();
  const attachKey = ccAttachmentsKey(meta.playerNum);
  const previousAttachments = isCcAttachment(card) && game[attachKey]?.[msgId] ? game[attachKey][msgId].slice() : undefined;

  const effectData = getCcEffect(card);
  const cost = typeof effectData?.cost === 'number' ? effectData.cost : 0;
  const enteringNegation = cost === 0 && ctx.getNegationResponseButtons;
  hand.splice(hand.indexOf(card), 1);
  game[handKey] = hand;
  if (isCcAttachment(card) && !enteringNegation) {
    game[attachKey] = game[attachKey] || {};
    if (!Array.isArray(game[attachKey][msgId])) game[attachKey][msgId] = [];
    game[attachKey][msgId].push(card);
    await updateAttachmentMessageForDc(game, meta.playerNum, msgId, client);
  } else {
    game[discardKey] = game[discardKey] || [];
    game[discardKey].push(card);
  }
  const handChannelId = getHandChannelId(game, meta.playerNum);
  const handChannel = await fetchGameChannel(interaction.client, handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = getCcDeck(game, meta.playerNum) || [];
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, game.gameId, game, meta.playerNum);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}** (${timingLabel}).${effectReminder}\n\n` + (handPayload.content || '');
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds || [],
      files: handPayload.files || [],
      components: handPayload.components || [],
    }).catch(discordCatch);
  }
  await refreshHandAndDiscard(game, meta.playerNum, interaction.client, ctx);
  // Special Action CCs cost 1 action; Double Action CCs cost both actions.
  if (timingLabel === 'Special Action') {
    const data = game.dcActionsData?.[msgId];
    if (data && typeof data.remaining === 'number') data.remaining = Math.max(0, data.remaining - 1);
  } else if (timingLabel === 'Double Action') {
    const data = game.dcActionsData?.[msgId];
    if (data && typeof data.remaining === 'number') data.remaining = 0;
  }
  await updateDcActionsMessage(game, msgId, interaction.client);
  const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}** (${timingLabel}).`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  if (ctx.getCommandCardImagePath) {
    const _imgPath = ctx.getCommandCardImagePath(card);
    if (_imgPath) {
      try {
        const { existsSync: _exists } = await import('fs');
        if (_exists(_imgPath)) {
          const { AttachmentBuilder: _AB, EmbedBuilder: _EB } = await import('discord.js');
          const _ext = _imgPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
          const _fn = `cc-log-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${_ext}`;
          const _embed = new _EB().setTitle(card).setColor(COLORS.DARK_EMBED).setImage(`attachment://${_fn}`);
          const _logCh = await fetchGameChannel(interaction.client, game.generalId);
          if (_logCh) await _logCh.send({ embeds: [_embed], files: [new _AB(_imgPath, { name: _fn })] }).catch(discordCatch);
        }
      } catch (err) {
        console.error('[cc-image-log]', err?.message ?? err);
      }
    }
  }
  if (enteringNegation) {
    setPendingNegation(game, { playedBy: meta.playerNum, card, fromDc: true, msgId, wasAttachment: isCcAttachment(card), handChannelId });
    const oppNum = opponentPlayerNum(meta.playerNum);
    const oppHandId = getHandChannelId(game, oppNum);
    const oppHandChannel = await fetchGameChannel(interaction.client, oppHandId);
    if (oppHandChannel) {
      const oppId = getPlayerId(game, oppNum);
      await oppHandChannel.send({
        content: `<@${oppId}> Your opponent played **${card}** (cost 0). You may play **Negation** to cancel it.`,
        components: [ctx.getNegationResponseButtons(game.gameId)],
        allowedMentions: { users: [oppId] },
      }).catch(discordCatch);
    }
    await logGameAction(game, client, `Waiting for opponent to respond to **${card}**...`, { phase: 'ACTION', icon: 'hourglass' });
    const waitingMsg = await handChannel.send({
      content: `⏳ **${card}** played — waiting for opponent to respond (Negation window open). You'll be notified here when it resolves.`,
    }).catch(() => null);
    if (waitingMsg) updatePendingNegation(game, (p) => { p.waitingMsgId = waitingMsg.id; });
    if (ctx.pushUndo) {
      ctx.pushUndo(game, {
        type: 'cc_play_dc',
        gameId: game.gameId,
        msgId,
        playerNum: meta.playerNum,
        card,
        previousHand,
        previousDiscard,
        previousAttachments,
        gameLogMessageId: logMsg?.id,
      });
    }
    saveGames(game.gameId);
    return;
  }
  if (ctx.resolveAbility) {
    const abilityId = effectData?.abilityId ?? card;
    const result = ctx.resolveAbility(abilityId, { game, playerNum: meta.playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, msgId });
    if (result.requiresChoice && result.choiceOptions?.length > 0) {
      // Choice required: set up pending state and send choice buttons to hand channel
      setPendingCcChoice(game, { abilityId, choiceOptions: result.choiceOptions, gameId: game.gameId, playerNum: meta.playerNum, ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}) });
      const { ActionRowBuilder: _AR, ButtonBuilder: _BB, ButtonStyle: _BS } = await import('discord.js');
      const rows = [];
      const maxPerRow = 5;
      for (let i = 0; i < result.choiceOptions.length; i++) {
        if (i % maxPerRow === 0) rows.push(new _AR());
        const label = String(result.choiceOptions[i]).slice(0, 80);
        rows[rows.length - 1].addComponents(
          new _BB().setCustomId(`cc_choice_${game.gameId}_${i}`).setLabel(label).setStyle(_BS.Secondary)
        );
      }
      const handCh = await fetchGameChannel(interaction.client, handChannelId);
      if (handCh) await handCh.send({ content: `**Choose one** (for **${card}**):`, components: rows }).catch(discordCatch);
    } else {
      await applyAbilityResult(result, { game, playerNum: meta.playerNum, msgId, client: interaction.client, ctx });
      if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
        const threadId = game.dcActionsData?.[msgId]?.threadId;
        if (threadId) {
          game.pendingPowerTokenGrant.channelId = threadId;
          const ptThread = await fetchGameChannel(interaction.client, threadId);
          if (ptThread) {
            const { grants } = game.pendingPowerTokenGrant;
            const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
            const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
            const btns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
              new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
            );
            await ptThread.send({
              content: `**Choose power token type** for **${figNames}** (${totalCount > 1 ? `${totalCount} tokens` : '1 token'}):`,
              components: [new ActionRowBuilder().addComponents(btns)],
            }).catch(discordCatch);
          }
        }
      }
    }
  }
  if (ctx.pushUndo) {
    ctx.pushUndo(game, {
      type: 'cc_play_dc',
      gameId: game.gameId,
      msgId,
      playerNum: meta.playerNum,
      card,
      previousHand,
      previousDiscard,
      previousAttachments,
      gameLogMessageId: logMsg?.id,
    });
  }
  // Post-action Bleed strain (CC plays): centralized via triggerBleedAfterAction.
  if (timingLabel === 'Special Action' || timingLabel === 'Double Action') {
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFigure}`;
    await triggerBleedAfterAction(game, ctx, figureKey, meta.playerNum);
  }
  saveGames(game.gameId);
}

/**
 * Single handler for dc_move_, dc_attack_, dc_interact_, dc_special_ (branches on customId).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 * @param {string} buttonKey - 'dc_move_' | 'dc_attack_' | 'dc_interact_' | 'dc_special_'
 */
/**
 * Build options for the Arsenal die-selection select menu.
 *
 * Epic Arsenal: 3-die pool with "no more than 2 dice of any single color".
 * destruct 2026-05-06: "This restriction includes a potential focus die,
 * which would always be a green die." When the attacker is Focused at
 * declare time, the focus die (green) is appended to the chosen pool, so
 * the chosen 3 must keep total greens ≤ 2 (i.e. ≤ 1 chosen green when
 * focused).
 *
 * @param {number} diceCount  - 2 (Arsenal) or 3 (Epic Arsenal)
 * @param {object} [opts]
 * @param {string|null} [opts.extraDie] - color of an extra die that will be
 *   appended at declare time (e.g. 'green' from Focus). Counted against the
 *   max-2-same-color cap. Pass null/undefined when no extra die.
 */
export function buildArsenalSelectOptions(diceCount, opts = {}) {
  const { extraDie = null } = opts;
  const colors = ['red', 'blue', 'yellow', 'green'];
  const labels = { red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green' };
  const options = [];
  // Helper: count how many of `color` appear in `combo`, plus extraDie if matching
  const countColor = (combo, color) => combo.filter((c) => c === color).length + (extraDie === color ? 1 : 0);
  // Max-2-same-color rule applies to Epic Arsenal (3-die pool) and to any
  // future variant that opts in via extraDie. Regular Arsenal (2 dice) has
  // no same-color restriction in the canonical card.
  const enforceMaxTwo = diceCount === 3;
  const tooManySameColor = (combo) => {
    if (!enforceMaxTwo) return false;
    return colors.some((c) => countColor(combo, c) > 2);
  };
  const focusNote = extraDie === 'green' ? ' (focus die: +1 Green will be added)' : '';
  if (diceCount === 2) {
    for (let i = 0; i < colors.length; i++) {
      for (let j = i; j < colors.length; j++) {
        const c1 = colors[i], c2 = colors[j];
        const combo = [c1, c2];
        if (tooManySameColor(combo)) continue;
        options.push({ label: `${labels[c1]} + ${labels[c2]}`, value: `${c1},${c2}`, description: `Roll 1 ${labels[c1]} and 1 ${labels[c2]} die${focusNote}`.slice(0, 100) });
      }
    }
  } else {
    for (let i = 0; i < colors.length; i++) {
      for (let j = i; j < colors.length; j++) {
        for (let k = j; k < colors.length; k++) {
          const c1 = colors[i], c2 = colors[j], c3 = colors[k];
          const combo = [c1, c2, c3];
          if (tooManySameColor(combo)) continue;
          options.push({ label: `${labels[c1]} + ${labels[c2]} + ${labels[c3]}`, value: `${c1},${c2},${c3}`, description: `Roll those 3 dice${focusNote}`.slice(0, 100) });
        }
      }
    }
  }
  return options;
}

/**
 * Build the Set of figure-blocking coordinates for LOS checks.
 * Shared by buildAndSendAttackTargets and False Orders attack targeting.
 *
 * @param {object} game - game state
 * @param {number} playerNum - attacker's player number
 * @param {string} attackerPos - attacker coordinate
 * @param {string} attackerSize - attacker size (e.g. '1x1', '2x1')
 * @param {object} ctx - handler context with getDcEffects, getFigureSize, getFootprintCells
 * @param {object} [opts]
 * @param {boolean} [opts.marksmanActive] - if true, return null (figures don't block)
 * @param {boolean} [opts.ignoreBlocking] - if true, return null (attacker ignores blocking)
 * @returns {Set<string>|null}
 */
function buildFigureBlockingCoords(game, playerNum, attackerPos, attackerSize, ctx, opts) {
  if (opts?.marksmanActive || opts?.ignoreBlocking) return null;
  const { getDcEffects, getFigureSize, getFootprintCells } = ctx;
  const enemyPlayerNum = playerNum === 1 ? 2 : 1;
  const attackerFpCells = getFootprintCells(attackerPos, attackerSize);
  const attackerFpSet = new Set(attackerFpCells.map(c => String(c).toLowerCase()));
  const blocking = new Set();
  for (const poses of [game.figurePositions?.[playerNum] || {}, game.figurePositions?.[enemyPlayerNum] || {}]) {
    for (const [fk, pos] of Object.entries(poses)) {
      if (!pos || attackerFpSet.has(String(pos).toLowerCase())) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = getDcEffects()[fkDcName] || getDcEffects()[fkDcName.replace(/\s*\[.*\]\s*$/, '')];
      if (fkEff?.companion === true) continue;
      if ((fkEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) continue;
      const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDcName);
      for (const cell of getFootprintCells(pos, fkSize)) blocking.add(String(cell).toLowerCase());
    }
  }
  return blocking;
}

/** Build and display the attack target selector buttons. */
async function buildAndSendAttackTargets(
  interaction, ctx, game, meta, msgId, figureKey, figureIndex,
  { dgIndex, attackerPos, attackerKws, minRange, effectiveMaxRange, ms, playerNum, enemyPlayerNum, stats, excludeFigureKeys }
) {
  const { getDcEffects, getDcStats, getFigureSize, getFootprintCells, getRange, hasLineOfSight, dcMessageMeta, FIGURE_LETTERS, getMapTokensData } = ctx;
  // Definition: 'Love' (attackOverrideOpts.minRange) — override minRange before target filtering
  const _overrideMinRange = game.pendingOverrideAttackDice?.[msgId]?.minRange;
  if (_overrideMinRange != null && _overrideMinRange > minRange) minRange = _overrideMinRange;
  // Priority Target (LOS-ignoring): Loku Kanoloa + Rebel Saboteur Elite have it in abilityText.
  // MASSIVE figures also ignore figure blocking. (Intercept-defender PT is checked separately below.)
  // Clawdite Scout form also grants Priority Target.
  const abilityTextLower = (stats.abilityText || '').toLowerCase();
  let attackerIgnoresFigureBlocking =
    (abilityTextLower.includes('priority target') && abilityTextLower.includes('line of sight')) ||
    attackerKws.includes('MASSIVE');
  // Check Clawdite Scout form for Priority Target
  if (!attackerIgnoresFigureBlocking && figureKey) {
    const _formName = getConfig(game, figureKey)?.form;
    if (_formName === 'Scout') attackerIgnoresFigureBlocking = true;
  }
  // Build effective mapSpaces: merge closed doors + energy shields into LOS-blocking data.
  // Doors block LOS (rules: "Doors block line of sight and adjacency", p.27).
  // Energy shields block LOS but not movement (rules: "A space containing an energy shield blocks LOS", p.29).
  let effectiveMs = ms;
  let closedDoorEdges;
  {
    const losMapId = game.selectedMap?.id;
    const allDoors = (getMapTokensData && losMapId) ? (getMapTokensData()[losMapId]?.doors || []) : [];
    const openedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
    const closedEdges = allDoors.filter(e => {
      const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
      return !openedSet.has(`${a}|${b}`) && !openedSet.has(`${b}|${a}`);
    });
    closedDoorEdges = new Set(closedEdges.map(e => edgeKey(e[0], e[1])));
    const shieldSpaces = (game.ancillaryTokens?.energyShield || []).map(s => String(s).toLowerCase());
    // C54: Smoke Grenade tokens block LOS
    const smokeSpaces = (game.ancillaryTokens?.smoke || []).map(s => String(s).toLowerCase());
    const extraBlocking = [...shieldSpaces, ...smokeSpaces];
    // Wasskah breakable walls: filter out edges passable due to difficult terrain on both sides
    const brokenWalls = getBrokenWallEdges(game, ms);
    const baseImpassable = ms?.impassableEdges || [];
    const filteredImpassable = brokenWalls.size > 0
      ? baseImpassable.filter(e => !brokenWalls.has(edgeKey(e[0], e[1])))
      : baseImpassable;
    const mergedImpassable = closedEdges.length > 0 ? [...filteredImpassable, ...closedEdges] : filteredImpassable;
    const needsOverride = closedEdges.length > 0 || extraBlocking.length > 0 || brokenWalls.size > 0;
    if (needsOverride) {
      effectiveMs = {
        ...ms,
        impassableEdges: mergedImpassable,
        blocking: extraBlocking.length > 0 ? [...(ms?.blocking || []), ...extraBlocking] : ms?.blocking,
      };
    }
  }
  // attackerSize needed both for figureBlockingCoords exclusion and for multi-cell LOS.
  const attackerSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
  const attackerFpCells = getFootprintCells(attackerPos, attackerSize);
  // Marksman CC card: figures do not block LOS for this attack
  const marksmanActive = game.nextAttackIgnoreFigureLOS?.[msgId];
  if (marksmanActive) delete game.nextAttackIgnoreFigureLOS[msgId];
  const allFigureBlockingCoords = buildFigureBlockingCoords(game, playerNum, attackerPos, attackerSize, ctx, {
    marksmanActive,
    ignoreBlocking: attackerIgnoresFigureBlocking,
  });
  const targets = [];
  const poses = game.figurePositions?.[enemyPlayerNum] || {};
  const dcList = getSquad(game, enemyPlayerNum)?.dcList || [];
  const totals = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  for (const [k, coord] of Object.entries(poses)) {
    // Hide is a -2 accuracy condition per CRR (RULES_REFERENCE.md:1586), not a
    // targeting block. Hidden targets remain selectable; the -2 penalty is
    // applied at combat resolution (src/game/combat.js:221–224).
    // CRR INCP-003: incapacitated figures cannot be targeted by attacks.
    // Current skirmish substrate: The Child (childIncapacitated flag set by Force Exhaustion).
    if (dcNameFromFigureKey(k) === 'the child' && game.childIncapacitated) continue;
    // Insignificant (Dio): can't be targeted if in same space as a friendly figure
    {
      const _insigDcName = dcNameFromFigureKey(k);
      const _insigEff = getDcEffects()[_insigDcName] || getDcEffects()[_insigDcName.replace(/\s*\[.*\]\s*$/, '')];
      if ((_insigEff?.specialAbilityIds || []).includes('insignificant_dio')) {
        const _insigFriendlyPoses = game.figurePositions?.[enemyPlayerNum] || {};
        const _insigHasFriendly = Object.entries(_insigFriendlyPoses).some(([ffk, fpos]) =>
          ffk !== k && fpos && String(fpos).toLowerCase() === String(coord).toLowerCase()
        );
        if (_insigHasFriendly) continue;
      }
    }
    const vanishImmunity = game.vanishImmunityUntilNextActivation?.[enemyPlayerNum];
    if (vanishImmunity) {
      const vanishMeta = dcMessageMeta.get(vanishImmunity.msgId);
      if (vanishMeta && k.startsWith(`${vanishMeta.dcName}-`)) continue;
    }
    const dcName = dcNameFromFigureKey(k);
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    const cells = getFootprintCells(coord, size);
    const dist = Math.min(...attackerFpCells.flatMap(ac => cells.map(tc => countSpaces(ms, ac, tc, closedDoorEdges))));
    if (dist < minRange || dist > effectiveMaxRange) continue;
    const iMustGoAlone = game.roundDefenderCannotBeTargetedUnlessWithinSpaces;
    if (iMustGoAlone?.playerNum === enemyPlayerNum && dist > iMustGoAlone.spaces) continue;
    let losCoords = allFigureBlockingCoords;
    if (allFigureBlockingCoords) {
      const targetEff = getDcEffects()[dcName] || getDcEffects()[dcName.replace(/\s*\[.*\]\s*$/, '')];
      if ((targetEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) {
        losCoords = null;
      } else {
        const targetFp = new Set(getFootprintCells(coord, size).map(c => String(c).toLowerCase()));
        losCoords = new Set([...allFigureBlockingCoords].filter(c => !targetFp.has(c)));
      }
    }
    // Large figures: LOS from any attacker cell to any target cell (rules: "may be traced from any space it occupies")
    let los = false;
    outer: for (const ac of attackerFpCells) {
      for (const tc of cells) {
        if (hasLineOfSight(ac, tc, effectiveMs, losCoords)) { los = true; break outer; }
      }
    }
    // Fire Mission: LOS from any figure in the group (not just acting figure)
    if (!los && game.fireMissionActive?.[msgId]) {
      const _fmDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _fmFigCount = getDcStats(meta.dcName)?.figures ?? 1;
      const _fmSuAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _fmTotalFigs = _fmFigCount + (_fmSuAtts.some(a => ['Z-6 Trooper', 'Mortar Trooper', 'Riot Trooper'].includes(a)) ? 1 : 0);
      outer2: for (let fi2 = 0; fi2 < _fmTotalFigs; fi2++) {
        if (fi2 === figureIndex) continue; // already checked
        const otherFk = `${meta.dcName}-${_fmDgIdx}-${fi2}`;
        const otherPos = game.figurePositions?.[playerNum]?.[otherFk];
        if (!otherPos) continue;
        const otherSize = game.figureOrientations?.[otherFk] || getFigureSize(meta.dcName);
        const otherFpCells = getFootprintCells(otherPos, otherSize);
        for (const oac of otherFpCells) {
          for (const tc of cells) {
            if (hasLineOfSight(oac, tc, effectiveMs, losCoords)) { los = true; break outer2; }
          }
        }
      }
    }
    // Droid Arm (Migs Mayfeld): if no normal LOS and attacker has droid_arm_migs + power tokens, check LOS from adjacent spaces
    let droidArmLOS = false;
    if (!los && (stats.specialAbilityIds || []).includes('droid_arm_migs')) {
      const _daTokens = game.figurePowerTokens?.[figureKey] || [];
      if (_daTokens.length > 0 && ms?.adjacency) {
        const _daAdj = (ms.adjacency[String(attackerPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
        droidArmOuter: for (const adjSpace of _daAdj) {
          for (const tc of cells) {
            if (hasLineOfSight(adjSpace, tc, effectiveMs, losCoords)) { droidArmLOS = true; break droidArmOuter; }
          }
        }
        if (droidArmLOS) los = true;
      }
    }
    const m = k.match(/-(\d+)-(\d+)$/);
    const dg = m ? parseInt(m[1], 10) : 1;
    const fi = m ? parseInt(m[2], 10) : 0;
    const figCount = getDcStats(dcName).figures ?? 1;
    const label = figCount > 1 ? `${dg}${FIGURE_LETTERS[fi] || 'a'}` : (totals[dcName] > 1 ? `${dcName} [Group ${dg}]` : dcName);
    targets.push({ figureKey: k, coord, label, hasLOS: los, dist, droidArmLOS });
  }
  // Missile Salvo: filter out already-targeted figures
  if (excludeFigureKeys?.length) {
    const excluded = new Set(excludeFigureKeys);
    targets.splice(0, targets.length, ...targets.filter(t => !excluded.has(t.figureKey)));
  }
  // NPC targets: thugs (Corellian A) and Krykna (Chopper A) — added after player targets.
  // Lazy-init NPC arrays driven by mission-rules flags (data, not mapId/variant strings).
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (getMapTokensData && mapId) {
    if (!game.npcThugs && hasMissionFlag(mapId, variant, 'npcThugs')) {
      const positions = Object.values(getMapTokensData()[mapId]?.missionA?.positions || {}).flat().filter(Boolean);
      if (positions.length > 0) game.npcThugs = positions.map((coord, i) => ({ id: `thug-${i + 1}`, coord: String(coord).toLowerCase(), hp: 4, maxHp: 4, defeated: false }));
    }
    if (!game.npcKrykna && hasMissionFlag(mapId, variant, 'npcKryknaActivation')) {
      const positions = Object.values(getMapTokensData()[mapId]?.missionA?.positions || {}).flat().filter(Boolean);
      if (positions.length > 0) game.npcKrykna = positions.map((coord, i) => ({ id: `krykna-${i + 1}`, coord: String(coord).toLowerCase(), hp: 8, maxHp: 8, defeated: false }));
    }
  }
  for (const [npcArray, npcType, hpLabel] of [[game.npcThugs, 'thug', 'HP'], [game.npcKrykna, 'krykna', 'HP']]) {
    if (!Array.isArray(npcArray)) continue;
    for (let i = 0; i < npcArray.length; i++) {
      const npc = npcArray[i];
      if (npc.defeated) continue;
      const coord = String(npc.coord).toLowerCase();
      const dist = Math.min(...attackerFpCells.map(ac => countSpaces(ms, ac, coord, closedDoorEdges)));
      if (dist < minRange || dist > effectiveMaxRange) continue;
      const los = attackerFpCells.some(ac => hasLineOfSight(ac, coord, effectiveMs, allFigureBlockingCoords));
      const label = `${npcType === 'thug' ? 'Thug' : 'Krykna'} ${i + 1} (${npc.hp}/${npc.maxHp} ${hpLabel})`;
      targets.push({ figureKey: `npc_${npcType}_${i}`, coord, label, hasLOS: los, dist, isNpc: true, npcType, npcIndex: i });
    }
  }
  // Crate targets (Devaron Garrison B): cratePositions keyed by orig coord, value = current coord
  if (game.cratePositions && typeof game.cratePositions === 'object') {
    for (const [origCoord, curCoord] of Object.entries(game.cratePositions)) {
      const hp = typeof game.crateHealth?.[origCoord] === 'number' ? game.crateHealth[origCoord] : 5;
      if (hp <= 0) continue;
      const coord = String(curCoord).toLowerCase();
      const dist = Math.min(...attackerFpCells.map(ac => countSpaces(ms, ac, coord, closedDoorEdges)));
      if (dist < minRange || dist > effectiveMaxRange) continue;
      const los = attackerFpCells.some(ac => hasLineOfSight(ac, coord, effectiveMs, allFigureBlockingCoords));
      targets.push({ figureKey: `npc_crate_${origCoord}`, coord, label: `Crate @ ${coord.toUpperCase()} (${hp}/5 HP)`, hasLOS: los, dist, isNpc: true, npcType: 'crate', crateOrigCoord: origCoord });
    }
  }
  // Priority Target intercept: if any enemy figures with "Priority Target" passive are among
  // valid targets, the attacker must target those figures only (other targets suppressed).
  {
    const ptTargets = targets.filter(t => {
      if (t.isNpc) return false;
      const dcN = dcNameFromFigureKey(t.figureKey);
      const eff = getDcEffects()[dcN] || getDcEffects()[dcN.replace(/\s*\[.*\]\s*$/, '')];
      return (eff?.passives || []).some(p => String(p).toLowerCase() === 'priority target');
    });
    if (ptTargets.length > 0) targets.splice(0, targets.length, ...ptTargets);
  }
  // Autofire chain attack: restrict targets to within 3 spaces of original target
  if (game.autofireChainTargetSpace?.[msgId]) {
    const _chainSpace = game.autofireChainTargetSpace[msgId];
    const _chainFiltered = targets.filter(t => countSpaces(ms, _chainSpace, t.coord, closedDoorEdges) <= 3);
    if (_chainFiltered.length > 0) targets.splice(0, targets.length, ..._chainFiltered);
    delete game.autofireChainTargetSpace[msgId];
  }
  // Barrage (CT-1701) second attack: restrict targets to within 3 spaces of first target
  if (game.barrageTargetSpace?.[msgId]) {
    const _barrageSpace = game.barrageTargetSpace[msgId];
    const _barrageFiltered = targets.filter(t => countSpaces(ms, _barrageSpace, t.coord, closedDoorEdges) <= 3);
    if (_barrageFiltered.length > 0) targets.splice(0, targets.length, ..._barrageFiltered);
    delete game.barrageTargetSpace[msgId];
  }
  // Arcing Shot: validate each target — must be adjacent to an empty space in attacker's LOS
  if (game.arcingShotActive?.[msgId] || game.arcingShotActiveScalar) {
    // Build set of all occupied spaces (both players' figures)
    const _arcOccupied = new Set();
    for (const pn of [1, 2]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos) continue;
        const fkSize = game.figureOrientations?.[fk] || ctx.getFigureSize(dcNameFromFigureKey(fk));
        for (const cell of getFootprintCells(pos, fkSize)) _arcOccupied.add(String(cell).toLowerCase());
      }
    }
    // Also treat blocking terrain as non-empty
    const _arcBlocking = new Set((effectiveMs?.blocking || []).map(s => String(s).toLowerCase()));
    for (const t of targets) {
      // Find spaces adjacent to target (via map adjacency)
      const tAdj = (effectiveMs?.adjacency?.[String(t.coord).toLowerCase()] || []).map(s => String(s).toLowerCase());
      // Check if any adjacent space is empty AND attacker has LOS to it
      let found = false;
      for (const adjSpace of tAdj) {
        if (_arcOccupied.has(adjSpace)) continue;
        if (_arcBlocking.has(adjSpace)) continue;
        // Check attacker LOS to this empty adjacent space
        const losOk = attackerFpCells.some(ac => hasLineOfSight(ac, adjSpace, effectiveMs, allFigureBlockingCoords));
        if (losOk) { found = true; break; }
      }
      t.arcingShotValid = found;
    }
  }
  if (targets.length === 0) {
    await interaction.followUp({ content: 'No valid targets in range.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const displayName = meta.displayName || meta.dcName;
  const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
  const _arcActive = game.arcingShotActive?.[msgId] || game.arcingShotActiveScalar;
  const targetBtns = targets.map((t, targetIndex) => {
    const noLOS = t.hasLOS === false;
    const daTag = t.droidArmLOS ? ' [Droid Arm]' : '';
    const arcTag = (_arcActive && t.arcingShotValid === false) ? ' [No Arc]' : '';
    return new ButtonBuilder()
      .setCustomId(`attack_target_${msgId}_${figureIndex}_${targetIndex}`)
      .setLabel(`${t.label} (${t.coord.toUpperCase()})${noLOS ? ' [No LOS]' : daTag}${arcTag}`.slice(0, 80))
      .setStyle(noLOS ? ButtonStyle.Secondary : (arcTag ? ButtonStyle.Secondary : ButtonStyle.Danger))
      .setDisabled(noLOS);
  });
  const targetRows = chunkButtonsToRows(targetBtns);
  game.attackTargets = game.attackTargets || {};
  game.attackTargets[`${msgId}_${figureIndex}`] = targets;
  await interaction.followUp({
    content: `**Attack** — Choose target for **${figLabel}**:`,
    components: targetRows,
    ephemeral: false,
  }).catch(discordCatch);
}

/**
 * Heroic Attack (Jedi Luke) — sibling Primary/blue Attack button that costs
 * no action and is gated once-per-activation. Pre-sets:
 *   - game.heroicUsedThisActivation[msgId] = true (used flag — disables the
 *     button on subsequent renders)
 *   - game.freeAttackBonusPending[msgId] = true (zero-action cost on the
 *     follow-up Attack consumption)
 * then rewrites the customId to the standard `dc_attack_…` form and
 * re-dispatches into handleDcAction. The follow-up flow then runs identically
 * to a normal Attack click except the action cost is waived.
 *
 * destruct 2026-05-06: "Heroic is a blue button, no action cost. Usable
 * once per activation."
 */
export async function handleDcHeroicAttack(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcEffects } = ctx;
  const m = interaction.customId.match(/^dc_heroic_attack_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid Heroic button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  // Verify Heroic is on this DC (defense in depth — UI shouldn't render the
  // button otherwise, but guard against stale messages or replay).
  const eff = getDcEffects()[meta.dcName] || getDcEffects()[(meta.dcName || '').replace(/\s*\[.*\]\s*$/, '')];
  if (!(eff?.specialAbilityIds || []).includes('heroic')) {
    await interaction.followUp({ content: 'This figure does not have Heroic.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Once-per-activation gate.
  if (game.heroicUsedThisActivation?.[msgId]) {
    await interaction.followUp({ content: '**Heroic** has already been used this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Mark used + grant the zero-action follow-up Attack.
  game.heroicUsedThisActivation = game.heroicUsedThisActivation || {};
  game.heroicUsedThisActivation[msgId] = true;
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[msgId] = true;

  // Rewrite customId and forward to the standard Attack handler. Discord.js
  // ButtonInteraction has a writable customId via configurable property; if
  // the property happens to be read-only on a future version, defineProperty
  // will succeed since the underlying field is plain.
  const _newId = `dc_attack_${msgId}_f${figureIndexStr}`;
  try {
    Object.defineProperty(interaction, 'customId', { value: _newId, writable: true, configurable: true });
  } catch {
    interaction.customId = _newId;
  }
  return handleDcAction(interaction, ctx, 'dc_attack_');
}

/**
 * Bo-Rifle Staff Strike (Zeb Orrelios) — sibling Primary/blue Attack button.
 * Per destruct 2026-05-07: parity with Luke Heroic. Free attack (no action),
 * once per activation, dice replaced with [Red, Red] melee.
 *
 * Sets:
 *   - game.boRifleStaffUsedThisActivation[msgId] = true (gate)
 *   - game.freeAttackBonusPending[msgId] = true (zero-action follow-up)
 *   - game.pendingOverrideAttackDice[msgId] = { type: 'melee', dice: ['red','red'], pierce: 0, bonusAccuracy: 0 }
 * Then rewrites customId to dc_attack_ and forwards to handleDcAction.
 */
export async function handleDcBoRifleAttack(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcEffects } = ctx;
  const m = interaction.customId.match(/^dc_bo_rifle_attack_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid Bo-Rifle button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr] = m;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const eff = getDcEffects()[meta.dcName] || getDcEffects()[(meta.dcName || '').replace(/\s*\[.*\]\s*$/, '')];
  if (!(eff?.specialAbilityIds || []).includes('bo_rifle_staff_strike')) {
    await interaction.followUp({ content: 'This figure does not have Bo-Rifle Staff Strike.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.boRifleStaffUsedThisActivation?.[msgId]) {
    await interaction.followUp({ content: '**Bo-Rifle Staff Strike** has already been used this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  game.boRifleStaffUsedThisActivation = game.boRifleStaffUsedThisActivation || {};
  game.boRifleStaffUsedThisActivation[msgId] = true;
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[msgId] = true;
  game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
  game.pendingOverrideAttackDice[msgId] = { type: 'melee', dice: ['red', 'red'], pierce: 0, bonusAccuracy: 0 };
  const _newId = `dc_attack_${msgId}_f${figureIndexStr}`;
  try {
    Object.defineProperty(interaction, 'customId', { value: _newId, writable: true, configurable: true });
  } catch {
    interaction.customId = _newId;
  }
  return handleDcAction(interaction, ctx, 'dc_attack_');
}

/**
 * Granted-move button (Tactical Movement when target ≠ activator, and any
 * future ability that grants out-of-activation MP requiring immediate use).
 *
 * Per destruct 2026-05-07: when Tactical Movement targets a friendly that is
 * not Fenn, the 2 MP must be used IMMEDIATELY via interrupt (it is not that
 * figure's activation). The chosen figure's player clicks this button → the
 * standard Move flow opens for the chosen figure with their (already-granted)
 * 2 MP available in the bank. Any leftover MP after the move is the player's
 * responsibility to police; auto-clear is a follow-up slice.
 *
 * customId format: `granted_move_${gameId}_${granteeMsgId}_f${figureIndex}`
 */
export async function handleGrantedMove(interaction, ctx) {
  const m = interaction.customId.match(/^granted_move_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid granted-move button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, suffix, figureIndexStr] = m;
  const _gmUnderscore = suffix.indexOf('_');
  if (_gmUnderscore < 0) {
    await interaction.followUp({ content: 'Invalid granted-move button (malformed id).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const granteeMsgId = suffix.slice(_gmUnderscore + 1);
  const _newId = `dc_move_${granteeMsgId}_f${figureIndexStr}`;
  try {
    Object.defineProperty(interaction, 'customId', { value: _newId, writable: true, configurable: true });
  } catch {
    interaction.customId = _newId;
  }
  return handleDcAction(interaction, ctx, 'dc_move_');
}

/**
 * Granted-attack button (Emperor / Executive Order / Battlefield Leadership /
 * Order Hit). Posted in the SOURCE's activation thread by apply-ability-result
 * after the source ability resolves and a grantee is chosen.
 *
 * Per destruct 2026-05-07: granted attacks fire IMMEDIATELY during the source's
 * activation (not stored for the grantee's next activation). Click → spawns a
 * new combat thread for the grantee, source pauses until grantee combat
 * resolves. The underlying pendingX state set by the source ability
 * (pendingEmperorInterrupt / pendingExecutiveOrder / pendingBattlefieldLeadership /
 * freeAttackBonusPending for Order Hit) is what marks the attack as free in
 * combat.js — this handler just re-points the interaction at the grantee's
 * standard Attack button so the same code path runs.
 *
 * customId format: `granted_attack_${gameId}_${granteeMsgId}_f${figureIndex}`
 */
export async function handleGrantedAttack(interaction, ctx) {
  const m = interaction.customId.match(/^granted_attack_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid granted-attack button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Customid embeds gameId then granteeMsgId; extract granteeMsgId by
  // splitting the suffix on the first `_` (gameIds don't contain `_`).
  const [, suffix, figureIndexStr] = m;
  const _gaUnderscore = suffix.indexOf('_');
  if (_gaUnderscore < 0) {
    await interaction.followUp({ content: 'Invalid granted-attack button (malformed id).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const granteeMsgId = suffix.slice(_gaUnderscore + 1);
  const _newId = `dc_attack_${granteeMsgId}_f${figureIndexStr}`;
  try {
    Object.defineProperty(interaction, 'customId', { value: _newId, writable: true, configurable: true });
  } catch {
    interaction.customId = _newId;
  }
  return handleDcAction(interaction, ctx, 'dc_attack_');
}

export async function handleDcAction(interaction, ctx, buttonKey) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    getDcStats,
    getDcEffects,
    getMapData,
    getFigureSize,
    getFootprintCells,
    getRange,
    hasLineOfSight,
    getEffectiveSpeed,
    ensureMovementBankMessage,
    getBoardStateForMovement,
    getMovementProfile,
    computeMovementCache,
    getMovementMinimapAttachment,
    clearMoveGridMessages,
    getLegalInteractOptions,
    FIGURE_LETTERS,
    DC_ACTIONS_PER_ACTIVATION,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
    client,
    logGameErrorToBotLogs,
    extractGameIdFromInteraction,
    resolveAbility,
    getMapAttachmentForSpaces,
    pushUndo,
  } = ctx;

  let msgId, action, figureIndex = 0, specialIdx = -1;
  if (buttonKey === 'dc_spend_mp_') {
    const m = interaction.customId.match(/^dc_spend_mp_(.+)_f(\d+)$/);
    msgId = m ? m[1] : parseCustomId(interaction.customId, 'dc_spend_mp_');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'SpendMp';
  } else if (buttonKey === 'dc_move_') {
    const m = interaction.customId.match(/^dc_move_(.+)_f(\d+)$/);
    msgId = m ? m[1] : parseCustomId(interaction.customId, 'dc_move_');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'Move';
  } else if (buttonKey === 'dc_attack_') {
    const m = interaction.customId.match(/^dc_attack_(.+)_f(\d+)$/);
    msgId = m ? m[1] : parseCustomId(interaction.customId, 'dc_attack_');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'Attack';
  } else if (buttonKey === 'dc_interact_') {
    const m = interaction.customId.match(/^dc_interact_(.+)_f(\d+)$/);
    msgId = m ? m[1] : parseCustomId(interaction.customId, 'dc_interact_');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'Interact';
  } else {
    const parts = splitCustomId(interaction.customId, 'dc_special_');
    specialIdx = parseInt(parts[0], 10);
    msgId = parts.slice(1).join('_');
    const metaForAction = dcMessageMeta.get(msgId);
    const stats = metaForAction ? getDcStats(metaForAction.dcName) : { specials: [] };
    action = stats.specials?.[specialIdx] || 'Special';
  }

  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this Play Area can use these actions.')) return;
  // Companion-first gate (per destruct 2026-05-07): when companion was
  // chosen to activate before the host, the host's actions are refused
  // until the companion's full activation completes. The flag is set to
  // 'before' at SoA pick and flipped to 'completed' when the companion's
  // End Activation handler fires (handleDcEndActivation finds matching
  // hosts via getCompanionForDc and updates the flag).
  if (game.companionActivatedBefore?.[msgId] === 'before') {
    await interaction.followUp({
      content: '\u{23F3} **Companion must complete its activation first.** You chose for the companion to activate before this figure — finish the companion\'s 2 actions and end its activation, then return here.',
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  // Resolve attachment-injected special action names and costs
  const _baseSpecialCount = (getDcStats(meta.dcName).specials || []).length;
  let _effectiveActionCost = 1;
  if (buttonKey === 'dc_special_' && specialIdx >= _baseSpecialCount) {
    const _suAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _injected = getAttachmentSpecials(_suAtts, game, msgId);
    const _bdOffset = specialIdx - _baseSpecialCount - _injected.names.length;
    if (_bdOffset >= 0 && game?.selectedMission?.name === 'Bomb Drop') {
      action = 'Bomb Drop';
      _effectiveActionCost = 1;
    } else {
      action = _injected.names[specialIdx - _baseSpecialCount] || 'Special';
      _effectiveActionCost = _injected.costs[specialIdx - _baseSpecialCount] ?? 1;
    }
  } else if (buttonKey === 'dc_special_') {
    _effectiveActionCost = (getDcStats(meta.dcName).specialCosts || [])[specialIdx] ?? 1;
  }
  const ownerId = getPlayerId(game, meta.playerNum);
  const actionsData = game.dcActionsData?.[msgId];
  const actionsRemaining = actionsData?.remaining ?? DC_ACTIONS_PER_ACTIVATION;
  const hasFellSwoopFreeAttack = action === 'Attack' && !!game.fellSwoopFreeAttack?.[msgId];
  const hasPummelFreeAttack = action === 'Attack' && !!(game.pummelTwoAttacksThisActivation?.[msgId]);
  const isMpBasedSpecial = buttonKey === 'dc_special_' && _effectiveActionCost === 0;
  if (actionsRemaining <= 0 && action !== 'SpendMp' && !hasFellSwoopFreeAttack && !hasPummelFreeAttack && !isMpBasedSpecial) {
    await interaction.followUp({ content: 'No actions remaining this activation (2 per DC).', ephemeral: true }).catch(discordCatch);
    return;
  }
  // C75 — To the Limit: extra action cannot be Move
  if (action === 'Move' && game.activationExtraActionThenStun?.[msgId]) {
    await interaction.followUp({ content: '**To the Limit** — the extra action cannot be a Move. Choose Attack, Special, or Interact.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (buttonKey === 'dc_special_') {
    const parts = splitCustomId(interaction.customId, 'dc_special_');
    const specialIdx = parseInt(parts[0], 10);
    const specialsUsed = actionsData?.specialsUsed ?? [];
    if (specialsUsed.includes(specialIdx)) {
      await interaction.followUp({ content: "That special has already been used this activation (each special once per activation unless a card says otherwise).", ephemeral: true }).catch(discordCatch);
      return;
    }
    // Disable: cannot use Special Actions this round
    const dispNameForDisable = meta.displayName || meta.dcName;
    if (game.disabledFigures?.includes(dispNameForDisable)) {
      await interaction.followUp({ content: `**${dispNameForDisable}** is Disabled — cannot use Special Actions this round.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    if (actionsRemaining < _effectiveActionCost) {
      await interaction.followUp({ content: `**${action}** costs ${_effectiveActionCost > 1 ? 'both actions' : '1 action'} — you only have ${actionsRemaining} action(s) remaining this activation.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    // Snapshot state before any DC special changes (undo restores from this)
    if (pushUndo) pushUndo(game, { type: 'dc_special', label: action, msgId, gameLogMessageId: null });
    if (!Array.isArray(actionsData.specialsUsed)) actionsData.specialsUsed = [];
    actionsData.specialsUsed.push(specialIdx);
  }

  if (action === 'Move' || action === 'SpendMp') {
    const isSpendMp = action === 'SpendMp';
    // G36: Parting Blow / Parting Shot — reset once-per-move flag at the start of each new Move action
    if (!isSpendMp && game.partingShotTriggered) game.partingShotTriggered = {};
    try {
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
      const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
      // Stunned figures cannot Move
      const moveFigureConds = game.figureConditions?.[figureKey] || [];
      if (moveFigureConds.includes('Stun')) {
        await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** is **Stunned** and cannot Move or Attack this activation.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      // G66-G68: Massive figures cannot voluntarily move again after pushing figures this phase
      if (game.massiveMovementLocked?.[figureKey]) {
        await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** pushed figures after ending movement and cannot voluntarily move again this phase.`, ephemeral: true }).catch(discordCatch);
        return;
      }
      const playerNum = meta.playerNum;
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!pos) {
        await interaction.followUp({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch(discordCatch);
        return;
      }
      const stats = getDcStats(meta.dcName);
      const bank = game.movementBank?.[msgId];
      const currentMp = bank?.remaining ?? 0;
      let mpRemaining;
      const displayName = meta.displayName || meta.dcName;
      const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
      game.movementBank = game.movementBank || {};
      if (isSpendMp) {
        // Spending remaining MP from a previous Move action — no speed added, no action cost
        mpRemaining = currentMp;
        if (mpRemaining <= 0) {
          await interaction.followUp({ content: 'No remaining movement points to spend.', ephemeral: true }).catch(discordCatch);
          return;
        }
        // Update bank display name in case it wasn't set
        if (game.movementBank[msgId]) game.movementBank[msgId].displayName = game.movementBank[msgId].displayName || figLabel;
      } else {
        const speed = getEffectiveSpeed(meta.dcName, figureKey, game, playerNum);
        mpRemaining = currentMp + speed;
        // Vanish: grant bonus MP at the start of next activation (first Move click), then clear immunity
        // Check regardless of whether a bank already exists (CC free-move grants can pre-create a bank)
        const vanishBonus = game.vanishImmunityUntilNextActivation?.[playerNum];
        if (vanishBonus?.msgId === msgId) {
          if (vanishBonus.nextMp > 0) mpRemaining += vanishBonus.nextMp;
          delete game.vanishImmunityUntilNextActivation[playerNum];
        }
        // The General's Ranks: +2 MP when performing a non-activation move
        const _tgrMoveUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
        if (_tgrMoveUpgrades.includes("The General's Ranks") && !game.dcActionsData?.[msgId]?.threadId) {
          mpRemaining += 2;
        }
        if (!game.movementBank[msgId]) {
          game.movementBank[msgId] = {
            total: speed,
            remaining: mpRemaining,
            threadId: bank?.threadId ?? null,
            messageId: bank?.messageId ?? null,
            displayName: figLabel,
          };
        } else {
          game.movementBank[msgId].displayName = game.movementBank[msgId].displayName || figLabel;
          game.movementBank[msgId].remaining = mpRemaining;
          game.movementBank[msgId].total = (game.movementBank[msgId].total ?? 0) + speed;
        }
      }
      await ensureMovementBankMessage(game, msgId, client);
      const boardState = getBoardStateForMovement(game, figureKey);
      if (!boardState) {
        await interaction.followUp({ content: 'Map spaces data not found for this map. Run: npm run generate-map-spaces', ephemeral: true }).catch(discordCatch);
        return;
      }
      const profile = getMovementProfile(meta.dcName, figureKey, game);
      const cache = computeMovementCache(pos, mpRemaining, boardState, profile);
      if (cache.cells.size === 0) {
        await interaction.followUp({ content: 'No valid movement spaces.', ephemeral: true }).catch(discordCatch);
        return;
      }
      // SpendMp is free — no action cost. Move costs 1 action (unless Executive Order).
      if (!isSpendMp) {
        const actData = game.dcActionsData?.[msgId];
        const isExecOrderFreeMove = game.pendingExecutiveOrder?.forMsgId === msgId;
        if (isExecOrderFreeMove) {
          clearPendingExecutiveOrder(game);
        } else if (actData) {
          actData.remaining = Math.max(0, actData.remaining - 1);
          await updateDcActionsMessage(game, msgId, client);
        }
      }
      game.moveInProgress = game.moveInProgress || {};
      const moveKey = `${msgId}_${figureIndex}`;
      // Show all reachable cells directly — no MP pre-selection step.
      // cache.cells only stores topLeft cells, so no filtering needed.
      const isMultiTile = profile.size && profile.size !== '1x1';
      const buttonSpaces = [...cache.cells.keys()];
      game.moveInProgress[moveKey] = {
        figureKey,
        playerNum,
        mpRemaining,
        displayName: figLabel,
        msgId,
        movementProfile: profile,
        boardState,
        movementCache: cache,
        cacheMaxMp: mpRemaining,
        startCoord: pos,
        pendingMp: null,
        distanceMessageId: null,
        // pendingBleed retired (slice 9): Bleed strain on a Move action fires
        // when the action RESOLVES — destruct 2026-05-06: "for a move action
        // the action is considered resolved once MP are gained and before
        // they are spent." MP are granted by reaching this code path, so
        // strain fires now (before the first cell pick).
      };
      // Bleed strain: fire immediately on Move action declaration, before
      // any MP are spent (slice 9 timing). Routed through the central
      // triggerBleedAfterAction so all action sites share one code path.
      await triggerBleedAfterAction(game, ctx, figureKey, playerNum);
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
      const labelMap = {};
      if (isMultiTile) {
        for (const s of buttonSpaces) {
          const n = normalizeCoord(s);
          labelMap[n] = bottomLeftCoord(n, profile.size).toUpperCase();
        }
      }
      const minimapCells = isMultiTile
        ? buttonSpaces.map((tl) => bottomLeftCoord(tl, profile.size))
        : buttonSpaces;
      const moveMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, minimapCells);
      // Store pendingSpacePick for generic row→cell handler
      const moveContextKey = `${meta.gameId}_${moveKey}`;
      const moveHeader = `**Move** — Pick destination (**${mpRemaining}** MP remaining):${multiTileNote}`;
      const moveActionBtns = [
        { customId: `move_adjust_mp_${msgId}_${figureIndex}`, label: 'Pick Path Manually', style: ButtonStyle.Secondary },
      ];
      if (!game.urgencyMustSpendAll?.[msgId]) {
        moveActionBtns.push(
          { customId: `move_pick_${msgId}_${figureIndex}_done`, label: 'End Movement', style: ButtonStyle.Secondary }
        );
      }
      game.pendingSpacePick = game.pendingSpacePick || {};
      game.pendingSpacePick[moveContextKey] = {
        validSpaces: buttonSpaces,
        cellPrefix: `move_pick_${msgId}_${figureIndex}_`,
        mapSpaces: boardState.mapSpaces,
        labelMap,
        headerText: moveHeader,
        actionButtons: moveActionBtns,
      };
      const { rows: moveRowBtns } = buildRowPickerButtons(buttonSpaces, `space_row_${moveContextKey}_`);
      const actionBtns = moveActionBtns.map(b =>
        new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(b.style)
      );
      const actionRow = new ActionRowBuilder().addComponents(...actionBtns);
      const firstPayload = {
        content: `${moveHeader}\nChoose a row:`,
        components: [...moveRowBtns.slice(0, 4), actionRow],
        ephemeral: false,
        fetchReply: true,
      };
      if (moveMinimap) firstPayload.files = [moveMinimap];
      const gridMsg = await interaction.followUp(firstPayload).catch(() => null);
      game.moveGridMessageIds[moveKey] = gridMsg?.id ? [gridMsg.id] : [];
      return;
    } catch (err) {
      console.error('Move button error:', err);
      await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'dc_move');
      await interaction.followUp({ content: `Move failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }

  if (action === 'Attack') {
    // Non-Combatant (C-3PO): cannot attack
    const ncEff = getDcEffects()?.[meta?.dcName];
    if ((ncEff?.specialAbilityIds || []).includes('non_combatant_c3po')) {
      await interaction.followUp({ content: '**Non-Combatant** — This figure cannot attack.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    // Stunned figures cannot Attack
    const attackFigureConds = game.figureConditions?.[figureKey] || [];
    if (attackFigureConds.includes('Stun')) {
      await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** is **Stunned** and cannot Move or Attack this activation.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    // Assault rule: non-Assault DCs can only perform 1 attack per activation (free attacks exempt)
    if (game.attackPerformedThisActivation?.[msgId]) {
      const isFreeAttack = hasFellSwoopFreeAttack || hasPummelFreeAttack ||
        game.freeAttackBonusPending?.[msgId] != null || game.pounceAttackPending?.[msgId] != null;
      // Imperial Retrofitting: multi-attack bypass
      const hasIRMultiAttack = !!game.imperialRetrofittingMultiAttack?.[msgId];
      if (!isFreeAttack && !hasIRMultiAttack) {
        const dcAbilityText = getDcEffects()?.[meta.dcName]?.abilityText || '';
        let hasAssault = /\bAssault:/i.test(dcAbilityText);
        // Scavenged Walker: "You lose ASSAULT"
        const _asFigKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
        if (hasAssault && (getConfig(game, _asFigKey)?.attachments || []).includes('Scavenged Walker')) hasAssault = false;
        if (!hasAssault) {
          await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** has already attacked this activation and does not have **Assault** (only 1 attack per activation without Assault).`, ephemeral: true }).catch(discordCatch);
          return;
        }
      }
    }
    const playerNum = meta.playerNum;
    const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!attackerPos) {
      await interaction.followUp({ content: 'This figure has no position yet.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const stats = getDcStats(meta.dcName);
    const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
    const [minRange, maxRange] = defaultAttackRange(attackInfo);
    // Reach: melee figure can target 1–2 spaces away; no accuracy check (still counts as melee)
    const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
    // Reach from DC passives, keywords, CC-granted, loadout card (Electrostaff), or Fury of Kashyyyk (WOOKIEE)
    const _loadoutCard = getLoadoutCards()[getConfig(game, figureKey)?.loadout];
    const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[playerNum] || _loadoutCard?.passive === 'Reach' || _hasFuryReach(game, playerNum, attackerKws);
    const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
    const ms = getMapData(game.selectedMap?.id);
    if (!ms) {
      await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const enemyPlayerNum = opponentPlayerNum(playerNum);
    // "No Cheating": debuffed player can only make melee attacks this activation
    const noCheatingDebuff = game.roundDebuffNextHostileActivation;
    if (noCheatingDebuff && (3 - noCheatingDebuff.playerNum) === playerNum && noCheatingDebuff.melee) {
      if (stats.attack?.type === 'range') {
        await interaction.followUp({ content: '⚠️ **No Cheating** is active — this figure can only make melee attacks this activation.', ephemeral: true }).catch(discordCatch);
        return;
      }
    }
    // Arsenal / Epic Arsenal: player chooses attack dice before target selection.
    // Uses pendingOverrideAttackDice[msgId] so handleAttackTarget applies them automatically.
    const atkSpecialIds = attackerEffects?.specialAbilityIds || [];
    const hasArsenal = atkSpecialIds.includes('arsenal');
    const hasEpicArsenal = atkSpecialIds.includes('epic_arsenal');
    if ((hasArsenal || hasEpicArsenal) && !game.pendingOverrideAttackDice?.[msgId]) {
      const diceCount = hasEpicArsenal ? 3 : 2;
      const abilityName = hasEpicArsenal ? 'Epic Arsenal' : 'Arsenal';
      const displayName_ = meta.displayName || meta.dcName;
      // destruct 2026-05-06: Epic Arsenal's max-2-same-color cap includes
      // the Focus die (always green) that gets appended at declare time.
      // Pass extraDie='green' so the option set excludes combos that would
      // exceed 2 greens once the focus die is added.
      const _arsAttackerFocused = (game.figureConditions?.[figureKey] || []).includes('Focus');
      const _arsExtraDie = (_arsAttackerFocused && hasEpicArsenal) ? 'green' : null;
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`arsenal_pick_${meta.gameId}_${msgId}_${figureIndex}`)
          .setPlaceholder(`Choose ${diceCount} attack dice…`)
          .addOptions(buildArsenalSelectOptions(diceCount, { extraDie: _arsExtraDie }))
      );
      const _focusNote = _arsExtraDie === 'green' ? '\n_Focused — a Green focus die will be added; combos that would exceed 2 of any color are filtered out._' : '';
      await interaction.followUp({
        content: `**${displayName_} — ${abilityName}**: Choose your ${diceCount} attack dice:${_focusNote}`,
        components: [selectRow],
        ephemeral: false,
      }).catch(discordCatch);
      return;
    }
    // EE-3 Carbine (Boba Fett): spend 2 MP to change one attack die to red.
    // Card text: "Limit once per attack" — must be eligible on EVERY attack
    // Boba performs in his activation, not just the first one. Clear any
    // 'decided' sentinel from the previous attack so this attack's prompt
    // can fire fresh.
    const hasEe3Carbine = atkSpecialIds.includes('ee3_carbine');
    if (hasEe3Carbine && game.pendingEe3Carbine?.[msgId] === 'decided') {
      delete game.pendingEe3Carbine[msgId];
    }
    if (hasEe3Carbine && !game.pendingEe3Carbine?.[msgId]) {
      const mpRemaining = game.movementBank?.[msgId]?.remaining ?? 0;
      if (mpRemaining >= 2) {
        const baseDice = stats.attack?.dice || ['red'];
        const nonRedDice = [...new Set(baseDice.filter((d) => d !== 'red'))];
        if (nonRedDice.length > 0) {
          const dieBtns = nonRedDice.map((color) =>
            new ButtonBuilder()
              .setCustomId(`ee3_pick_die_${color}_${game.gameId}_${msgId}_${figureIndex}`)
              .setLabel(`${color.charAt(0).toUpperCase() + color.slice(1)} \u2192 Red`)
              .setStyle(ButtonStyle.Success)
          );
          dieBtns.push(
            new ButtonBuilder()
              .setCustomId(`ee3_pick_die_skip_${game.gameId}_${msgId}_${figureIndex}`)
              .setLabel('Skip EE-3 Carbine')
              .setStyle(ButtonStyle.Secondary)
          );
          game.pendingEe3Carbine = game.pendingEe3Carbine || {};
          game.pendingEe3Carbine[msgId] = { gameId: game.gameId, playerNum, figureIndex, msgId };
          await interaction.followUp({
            content: `**EE-3 Carbine** — Spend **2 MP** (${mpRemaining} remaining) to change one attack die to red:`,
            components: [new ActionRowBuilder().addComponents(dieBtns)],
            ephemeral: false,
          }).catch(discordCatch);
          saveGames(game.gameId);
          return;
        }
      }
    }
    // Bo-Rifle (Agent Kallus): before declaring attack, may switch to melee (replace blue→red)
    if (atkSpecialIds.includes('bo_rifle_kallus') && !game.pendingOverrideAttackDice?.[msgId]) {
      const baseDice = stats.attack?.dice || [];
      if (baseDice.includes('blue') && stats.attack?.type === 'range') {
        const meleeDice = baseDice.map(d => d === 'blue' ? 'red' : d);
        const brBtns = [
          new ButtonBuilder()
            .setCustomId(`bo_rifle_pick_use_${game.gameId}_${msgId}_${figureIndex}`)
            .setLabel(`Bo-Rifle (Melee: ${meleeDice.map(d => d[0].toUpperCase() + d.slice(1)).join('+')})`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`bo_rifle_pick_skip_${game.gameId}_${msgId}_${figureIndex}`)
            .setLabel('Normal (Ranged)')
            .setStyle(ButtonStyle.Secondary),
        ];
        game.pendingBoRifle = game.pendingBoRifle || {};
        game.pendingBoRifle[msgId] = { gameId: game.gameId, playerNum, figureIndex, msgId, meleeDice };
        await interaction.followUp({
          content: `**Bo-Rifle** — Treat this attack as **Melee** (swap Blue→Red die)?`,
          components: [new ActionRowBuilder().addComponents(brBtns)],
        }).catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
    }
    // Tripod: track that figure has attacked (for "cannot exit space if attacked")
    if (atkSpecialIds.includes('tripod_eweb')) {
      if (!game.tripodAttacked) game.tripodAttacked = {};
      game.tripodAttacked[figureKey] = true;
    }
    // Snapshot state before attack begins (undo restores health/VP/conditions/hand)
    if (pushUndo) pushUndo(game, { type: 'attack', label: 'Attack', msgId, gameLogMessageId: null });
    await buildAndSendAttackTargets(interaction, ctx, game, meta, msgId, figureKey, figureIndex, {
      dgIndex, attackerPos, attackerKws, minRange, effectiveMaxRange, ms, playerNum, enemyPlayerNum, stats,
      excludeFigureKeys: game.pendingMissileSalvo?.[msgId]?.targetsFired,
    });
    return;
  }

  if (action === 'Interact') {
    // Non-Sentient: creatures with this trait cannot interact unless Beast Tamer override
    const _intEff = getDcEffects()?.[meta.dcName];
    const _intAbilityText = _intEff?.abilityText || '';
    if (_intAbilityText.includes('Non-Sentient') && !game.beastTamerInteractOverride?.[msgId]) {
      await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** has the **Non-Sentient** trait and cannot interact.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    const playerNum = meta.playerNum;
    const mapId = game.selectedMap?.id;
    const pos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!pos) {
      await interaction.followUp({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch(discordCatch);
      return;
    }
    const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
    if (options.length === 0) {
      await interaction.followUp({ content: 'No valid interact options (must be on or adjacent to a terminal, door, or mission token).', ephemeral: true }).catch(discordCatch);
      return;
    }
    const missionOpts = options.filter((o) => o.missionSpecific);
    const standardOpts = options.filter((o) => !o.missionSpecific);
    const sorted = [...missionOpts, ...standardOpts];
    const interactBtns = sorted.map((opt) =>
      new ButtonBuilder()
        .setCustomId(`interact_choice_${game.gameId}_${msgId}_${figureIndex}_${opt.id}`)
        .setLabel(truncateLabel(opt.label))
        .setStyle(opt.missionSpecific ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    const rows = chunkButtonsToRows(interactBtns);
    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`interact_cancel_${game.gameId}_${msgId}_${figureIndex}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(cancelRow);
    const stats = getDcStats(meta.dcName);
    const displayName = meta.displayName || meta.dcName;
    const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
    await interaction.followUp({
      content: `**Interact** — Choose action for **${figLabel}**:`,
      components: rows.slice(0, 5),
      ephemeral: false,
    }).catch(discordCatch);
    return;
  }

  if (actionsData) {
    // Free pounce attack: Pounce special grants one free attack (already paid as special action)
    const isPounceAttack = action === 'Attack' && game.pounceAttackPending?.[msgId] != null;
    // Free heroic attack: Heroic ability grants one free attack (action restored via freeAction flag on the special)
    const isHeroicAttack = action === 'Attack' && game.freeAttackBonusPending?.[msgId] != null;
    if (isPounceAttack) {
      delete game.pounceAttackPending[msgId];
    } else if (isHeroicAttack) {
      const _fabCount = game.freeAttackBonusPending[msgId];
      if (typeof _fabCount === 'number' && _fabCount > 1) {
        game.freeAttackBonusPending[msgId] = _fabCount - 1;
      } else {
        delete game.freeAttackBonusPending[msgId];
        // Brutality / Sarlacc Sweep: clear different-target tracker once the
        // last free attack is consumed.
        if (game.freeAttackDifferentTargets?.[msgId]) delete game.freeAttackDifferentTargets[msgId];
        // Wild Fury: on the last free attack, queue postActivationConditions (Stun + Bleed) to apply after combat
        if (game.postActivationConditions?.[msgId]) {
          game.pendingPostAttackConditions = game.pendingPostAttackConditions || {};
          game.pendingPostAttackConditions[msgId] = [...game.postActivationConditions[msgId]];
          delete game.postActivationConditions[msgId];
        }
      }
      // Stay Down: apply Stun to the attacker figure when the free attack is consumed
      if (game.stayDownPendingMsgId?.[msgId]) {
        delete game.stayDownPendingMsgId[msgId];
        const _sdDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
        const _sdFigKey = `${meta.dcName}-${_sdDgIdx}-${figureIndex}`;
        // Condition Immunity: skip Stun for immune figures
        const _sdEff = getDcEffects()?.[meta.dcName] || getDcEffects()?.[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const _sdImm = (_sdEff?.specialAbilityIds || []).includes('immune_onar') || (_sdEff?.specialAbilityIds || []).includes('immune_snowtrooper_elite');
        if (!_sdImm) {
          applyCondition(game, _sdFigKey, 'Stun');
          await logGameAction(game, client, `**Stay Down** — **${meta.displayName || meta.dcName}** is now **Stunned**.`, { phase: 'ROUND', icon: 'activate' });
        } else {
          await logGameAction(game, client, `**Condition Immunity** — **${meta.displayName || meta.dcName}** is immune to Stun (Stay Down).`, { phase: 'ROUND', icon: 'card' });
        }
      }
    } else if (hasPummelFreeAttack) {
      // Pummel: grants 2 free attacks; track remaining count
      game.pummelAttacksRemaining = game.pummelAttacksRemaining || {};
      if (game.pummelAttacksRemaining[msgId] === undefined) game.pummelAttacksRemaining[msgId] = 2;
      game.pummelAttacksRemaining[msgId] = Math.max(0, game.pummelAttacksRemaining[msgId] - 1);
      if (game.pummelAttacksRemaining[msgId] <= 0) {
        delete game.pummelTwoAttacksThisActivation[msgId];
        delete game.pummelAttacksRemaining[msgId];
      }
    } else {
      const actionCost = buttonKey === 'dc_special_' ? _effectiveActionCost : 1;
      actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
      await updateDcActionsMessage(game, msgId, client);
    }
  }
  const displayName = meta.displayName || meta.dcName;
  const pLabel = `P${meta.playerNum}`;
  await logGameAction(game, client, `**${pLabel}:** <@${ownerId}> used **${action}**.`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'activate' });

  // --- Attachment Special Actions (handle before resolveAbility) ---
  if (buttonKey === 'dc_special_' && specialIdx >= _baseSpecialCount) {
    const _suHandler = action;
    const thread = interaction.channel;

    // Smuggler's Run: deplete while in opponent's deployment zone → gain 5 VP
    if (_suHandler === "Smuggler's Run") {
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
      const pos = game.figurePositions?.[meta.playerNum]?.[figKey];
      // Check position in opponent's deployment zone
      const mapId = game.selectedMap?.id;
      const getDeploymentZones = ctx.getDeploymentZones;
      const zoneData = getDeploymentZones ? getDeploymentZones()[mapId] : null;
      let inOppZone = false;
      if (zoneData && pos) {
        const initPNum = getInitiativePlayerNum(game);
        const oppZoneColor = meta.playerNum === initPNum
          ? (game.deploymentZoneChosen === 'red' ? 'blue' : 'red')
          : game.deploymentZoneChosen;
        const oppZoneSpaces = new Set((zoneData[oppZoneColor] || []).map(c => String(c).toLowerCase()));
        const getFigureSize = ctx.getFigureSize;
        const getFootprintCells = ctx.getFootprintCells;
        if (getFigureSize && getFootprintCells) {
          const size = game.figureOrientations?.[figKey] || getFigureSize(meta.dcName);
          const fp = getFootprintCells(pos, size);
          inOppZone = fp.some(c => oppZoneSpaces.has(String(c).toLowerCase()));
        } else {
          inOppZone = oppZoneSpaces.has(String(pos).toLowerCase());
        }
      }
      if (!inOppZone) {
        await thread.send(`**Smuggler's Run** — This figure is **not** in the opponent's deployment zone. Cannot deplete.`).catch(discordCatch);
        // Refund action + undo
        if (actionsData) {
          actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + _effectiveActionCost);
          actionsData.specialsUsed = (actionsData.specialsUsed || []).filter(i => i !== specialIdx);
          await updateDcActionsMessage(game, msgId, client);
        }
        saveGames(game.gameId);
        return;
      }
      // Deplete: remove card from attachments
      const attKey = dcAttachmentsKey(meta.playerNum);
      if (game[attKey]?.[msgId]) {
        game[attKey][msgId] = game[attKey][msgId].filter(c => c !== "Smuggler's Run");
      }
      // Award 5 VP
      awardObjectiveVp(game, meta.playerNum, 5);
      const vpK = vpKeyFn(meta.playerNum);
      await thread.send(`**Smuggler's Run** — Depleted! **+5 VP** (${game[vpK].total} total).`).catch(discordCatch);
      await logGameAction(game, client, `**Smuggler's Run** — **${displayName}** depleted in opponent's deployment zone. +5 VP.`, { phase: 'ROUND', icon: 'card' });
      if (ctx.updateAttachmentMessageForDc) await ctx.updateAttachmentMessageForDc(game, meta.playerNum, msgId, client).catch(discordCatch);
      if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
      saveGames(game.gameId);
      return;
    }

    // Vader's Finest: Attack+Move — perform an attack, then move up to 1 space
    if (_suHandler === 'VF: Attack+Move') {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: "Vader's Finest" };
      game.pendingMpBonus = game.pendingMpBonus || {};
      game.pendingMpBonus[msgId] = 1;
      await thread.send(`**Vader's Finest** — Your next attack is free. After attack resolves, gain **1 MP**.`).catch(discordCatch);
      await updateDcActionsMessage(game, msgId, client);
      saveGames(game.gameId);
      return;
    }

    // Vader's Finest: Focus — if < 2 dice in printed attack pool, become Focused (limit once/round/group)
    if (_suHandler === 'VF: Focus') {
      if (game.vadersFocusUsedThisRound?.[msgId]) {
        await thread.send(`**Vader's Finest** — Focus already used this round for this group.`).catch(discordCatch);
        if (actionsData) {
          actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + _effectiveActionCost);
          actionsData.specialsUsed = (actionsData.specialsUsed || []).filter(i => i !== specialIdx);
          await updateDcActionsMessage(game, msgId, client);
        }
        saveGames(game.gameId);
        return;
      }
      // Check printed attack dice count for the acting figure
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const baseDice = getDcStats(meta.dcName)?.attack?.dice || [];
      // For squad upgrade figures, check their attack dice instead
      const _suUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const baseFigCount = getDcStats(meta.dcName)?.figures ?? 1;
      let printedDiceCount = baseDice.length;
      if (selectedFig >= baseFigCount) {
        // Squad upgrade figure — check attachment stats
        const getDcEffects = ctx.getDcEffects;
        const suNames = ['Z-6 Trooper', 'Mortar Trooper', 'Riot Trooper'];
        for (const su of suNames) {
          if (cardNameIncludes(_suUpgrades, su)) {
            const suEff = getDcEffects?.()?.[`[${su}]`];
            if (suEff?.attack?.dice) { printedDiceCount = suEff.attack.dice.length; break; }
          }
        }
      }
      if (printedDiceCount >= 2) {
        await thread.send(`**Vader's Finest** — This figure has ${printedDiceCount} dice in its printed attack pool (need < 2). Cannot Focus.`).catch(discordCatch);
        if (actionsData) {
          actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + _effectiveActionCost);
          actionsData.specialsUsed = (actionsData.specialsUsed || []).filter(i => i !== specialIdx);
          await updateDcActionsMessage(game, msgId, client);
        }
        saveGames(game.gameId);
        return;
      }
      // Apply Focus
      const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figKey = `${meta.dcName}-${dgIdx}-${selectedFig}`;
      applyCondition(game, figKey, 'Focus');
      game.vadersFocusUsedThisRound = game.vadersFocusUsedThisRound || {};
      game.vadersFocusUsedThisRound[msgId] = true;
      await thread.send(`**Vader's Finest** — **${displayName}** becomes **Focused**.`).catch(discordCatch);
      await logGameAction(game, client, `**Vader's Finest** — **${displayName}** becomes Focused.`, { phase: 'ROUND', icon: 'card' });
      if (ctx.updateAttachmentMessageForDc) await ctx.updateAttachmentMessageForDc(game, meta.playerNum, msgId, client).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }

    // Z-6 Trooper Autofire: perform an attack (defender +1 white die, surge: chain attack within 3)
    if (_suHandler === 'Autofire') {
      game.autofireActive = game.autofireActive || {};
      game.autofireActive[msgId] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Autofire' };
      await thread.send(`**Autofire** — Your next attack: defender adds **1 white die**. Surge: **Chain attack** targeting a figure within 3 of target space.`).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }

    // Mortar Trooper Fire Mission: double-action attack with LOS from any group figure + Blast 1
    if (_suHandler === 'Fire Mission') {
      game.fireMissionActive = game.fireMissionActive || {};
      game.fireMissionActive[msgId] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Fire Mission' };
      await thread.send(`**Fire Mission** — Your next attack: LOS from **any figure in this group** (range from acting figure). **+Blast 1**.`).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }

    // The Darksaber: Special Action — Melee attack with 1 red die, Blast→Cleave, then may perform an attack
    if (_suHandler === 'Darksaber Strike') {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[msgId] = { dice: ['red'], type: 'melee', darksaberBlastToCleave: true };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Darksaber Strike' };
      // Grant a second free attack after this one (the "then may perform an attack")
      game.darksaberSecondAttack = game.darksaberSecondAttack || {};
      game.darksaberSecondAttack[msgId] = true;
      await thread.send(`**Darksaber Strike** — Your next attack: **1 red die, Melee**. **Blast → Cleave** conversion. Then you may perform another attack.`).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }

    // Orbital Bombardment: Special Action — Place tokens equal to current round number
    if (_suHandler === 'OB: Place Tokens') {
      const roundNum = game.currentRound || 1;
      game.orbitalBombardmentTokens = game.orbitalBombardmentTokens || {};
      game.orbitalBombardmentTokens[msgId] = (game.orbitalBombardmentTokens[msgId] || 0) + roundNum;
      await thread.send(`**Orbital Bombardment** — Placed **${roundNum} Bombardment token${roundNum > 1 ? 's' : ''}** (total: **${game.orbitalBombardmentTokens[msgId]}**). You may also perform an attack (use Attack button).`).catch(discordCatch);
      // The card says "Then, you may perform an attack" — grant free attack
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Orbital Bombardment' };
      await logGameAction(game, client, `**Orbital Bombardment** — **${displayName}** placed ${roundNum} Bombardment tokens (total: ${game.orbitalBombardmentTokens[msgId]}).`, { phase: 'ROUND', icon: 'card' });
      saveGames(game.gameId);
      return;
    }

    // Overwatch: Special Action — Place Overwatch token in a space within LOS
    if (_suHandler === 'OW: Place Token') {
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figKey = `${meta.dcName}-${dgIdx}-${selectedFig}`;
      const pos = game.figurePositions?.[meta.playerNum]?.[figKey];
      if (!pos) {
        await thread.send('**Overwatch** — Figure has no position.').catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
      const mapId = game.selectedMap?.id;
      const ms = getEffectiveMapSpaces(game, getMapData(mapId));
      if (!ms?.adjacency) {
        await thread.send('**Overwatch** — Map data not available.').catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
      // Build LOS-valid spaces (all map spaces with LOS from this figure)
      const allSpaces = Object.keys(ms.adjacency || {});
      const losValid = [];
      for (const sp of allSpaces) {
        if (sp === String(pos).toLowerCase()) continue;
        if (ctx.hasLineOfSightByCoord && ctx.hasLineOfSightByCoord(game, pos, sp, ms, ctx.getFigureSize, { blocking: null })) losValid.push(sp);
      }
      if (losValid.length === 0) {
        await thread.send('**Overwatch** — No valid spaces in LOS to place the token.').catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
      // Store pending state and show space picker
      game.pendingOverwatchPlacement = game.pendingOverwatchPlacement || {};
      game.pendingOverwatchPlacement[msgId] = { playerNum: meta.playerNum, figureKey: figKey };
      const owContextKey = `${game.gameId}_${msgId}`;
      const owHeader = `**Overwatch** — Choose a space within LOS to place your Overwatch token`;
      game.pendingSpacePick = game.pendingSpacePick || {};
      game.pendingSpacePick[owContextKey] = {
        validSpaces: losValid,
        cellPrefix: `overwatch_space_${game.gameId}_${msgId}_`,
        mapSpaces: ms,
        headerText: owHeader,
      };
      const { rows: owRowBtns } = buildRowPickerButtons(losValid, `space_row_${owContextKey}_`);
      await thread.send({
        content: `${owHeader}:\nChoose a row:`,
        components: owRowBtns.slice(0, 5),
      }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
  }

  // Bomb Drop (Hoth Battle Station B): discard 1 explosive, choose space within 3, 2 damage to all on/adjacent
  if (action === 'Bomb Drop') {
    const thread = interaction.channel;
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const figKey = `${meta.dcName}-${dgIdx}-${selectedFig}`;
    if (!game.figureContraband?.[figKey]) {
      await thread.send('**Bomb Drop** — This figure is not carrying an explosive.').catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    const pos = game.figurePositions?.[meta.playerNum]?.[figKey];
    if (!pos) {
      await thread.send('**Bomb Drop** — Figure has no position.').catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    const mapId = game.selectedMap?.id;
    const ms = getEffectiveMapSpaces(game, getMapData(mapId));
    if (!ms?.adjacency) {
      await thread.send('**Bomb Drop** — Map data not available.').catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    // Find spaces within 3 using BFS
    const startCoord = String(pos).toLowerCase();
    const visited = new Set([startCoord]);
    let frontier = [startCoord];
    for (let d = 0; d < 3; d++) {
      const next = [];
      for (const c of frontier) {
        for (const n of (ms.adjacency[c] || [])) {
          const nn = String(n).toLowerCase();
          if (!visited.has(nn)) { visited.add(nn); next.push(nn); }
        }
      }
      frontier = next;
    }
    const validSpaces = [...visited];
    if (validSpaces.length === 0) {
      await thread.send('**Bomb Drop** — No valid spaces within range.').catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    game.pendingBombDrop = game.pendingBombDrop || {};
    game.pendingBombDrop[msgId] = { playerNum: meta.playerNum, figureKey: figKey };
    const bdContextKey = `${game.gameId}_${msgId}`;
    const bdHeader = `**Bomb Drop** — Choose a space within 3 to detonate (2 Damage to all figures on/adjacent)`;
    game.pendingSpacePick = game.pendingSpacePick || {};
    game.pendingSpacePick[bdContextKey] = {
      validSpaces,
      cellPrefix: `bomb_drop_space_${game.gameId}_${msgId}_`,
      mapSpaces: ms,
      headerText: bdHeader,
    };
    const { rows: bdRowBtns } = buildRowPickerButtons(validSpaces, `space_row_${bdContextKey}_`);
    await thread.send({
      content: `${bdHeader}:\nChoose a row:`,
      components: bdRowBtns.slice(0, 5),
    }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // D1: Prefer abilityId from dc-effects (specialAbilityIds[specialIdx]) when present; else synthetic id for library lookup
  let abilityId = null;
  if (buttonKey === 'dc_special_' && specialIdx >= 0) {
    const effects = getDcEffects?.() || {};
    const effectEntry = effects[meta.dcName] || effects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    const ids = effectEntry?.specialAbilityIds;
    abilityId = Array.isArray(ids) && ids[specialIdx] != null ? ids[specialIdx] : `dc_special:${meta.dcName}:${specialIdx}`;
  }
  const resolveResult = resolveAbility ? resolveAbility(abilityId, {
    game, msgId, meta, playerNum: meta.playerNum, dcMessageMeta, dcHealthState: ctx.dcHealthState, specialLabel: action,
    hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapData: ctx.getMapData,
    findDcMessageIdForFigure: ctx.findDcMessageIdForFigure, getDcEffects,
  }) : { applied: false, manualMessage: 'Resolve manually (see rules).' };
  // Handle choice-required abilities (e.g. Dual-Bladed Fury: Focus or Reach+Cleave)
  if (!resolveResult.applied && resolveResult.requiresChoice && Array.isArray(resolveResult.choiceOptions) && resolveResult.choiceOptions.length > 0) {
    const choiceButtons = resolveResult.choiceOptions.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`dc_ability_choice_${game.gameId}_${msgId}_${specialIdx}_${i}`)
        .setLabel(String(label).slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    const rows = chunkButtonsToRows(choiceButtons);
    game.pendingDcAbilityChoice = game.pendingDcAbilityChoice || {};
    game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`] = {
      gameId: game.gameId, playerNum: meta.playerNum, abilityId, msgId, figureIndex, specialIdx,
      choiceOptions: resolveResult.choiceOptions,
      targetFigureKeys: resolveResult.targetFigureKeys || null,
    };
    // Refund the action since we haven't resolved yet — player commits when they pick
    if (actionsData) {
      actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + 1);
      await updateDcActionsMessage(game, msgId, client);
    }
    // Refresh DC embed if strain was deducted during ability activation (e.g. Force Throw)
    if (resolveResult.refreshDcEmbed && ctx.updateAttachmentMessageForDc) {
      await ctx.updateAttachmentMessageForDc(game, meta?.playerNum, msgId, client).catch(discordCatch);
    }
    await interaction.followUp({ content: `**${action}** — Choose one:`, components: rows, ephemeral: false }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Handle space-choice abilities (e.g. Pounce teleport destination)
  if (resolveResult.requiresSpaceChoice && Array.isArray(resolveResult.validSpaces) && resolveResult.validSpaces.length > 0) {
    if (getMapAttachmentForSpaces) {
      const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
      const pounceMapSpaces = boardState?.mapSpaces || { spaces: resolveResult.validSpaces };
      const mapAttachment = await getMapAttachmentForSpaces(game, resolveResult.validSpaces);
      game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
      game.pendingPounceSpaceChoice[msgId] = { gameId: game.gameId, playerNum: meta.playerNum, figureIndex, msgId, abilityId, specialIdx, validSpaces: resolveResult.validSpaces, targetFigureKey: resolveResult.targetFigureKey || null };
      const spacePickLabel = resolveResult.spaceChoiceLabel || `**Pounce** — Pick a space to place your figure:`;
      const pounceContextKey = `${game.gameId}_${msgId}_${figureIndex}`;
      game.pendingSpacePick = game.pendingSpacePick || {};
      game.pendingSpacePick[pounceContextKey] = {
        validSpaces: resolveResult.validSpaces,
        cellPrefix: `pounce_space_${game.gameId}_${msgId}_${figureIndex}_`,
        mapSpaces: pounceMapSpaces,
        headerText: spacePickLabel,
      };
      const { rows: pounceRowBtns } = buildRowPickerButtons(resolveResult.validSpaces, `space_row_${pounceContextKey}_`);
      // destruct 2026-05-06: when the resolveResult flags allowSkipPush
      // (Slam / Smash / Ram per "you MAY push"), append a separate Skip-push
      // button row so the player can decline the push entirely.
      const _allComponents = pounceRowBtns.slice(0, 4);
      if (resolveResult.allowSkipPush) {
        const _skipBtn = new ButtonBuilder()
          .setCustomId(`pounce_skip_push_${game.gameId}_${msgId}_${figureIndex}`)
          .setLabel('Skip push')
          .setStyle(ButtonStyle.Secondary);
        _allComponents.push(new ActionRowBuilder().addComponents(_skipBtn));
      }
      const payload = { content: `${spacePickLabel}\nChoose a row:`, components: _allComponents.slice(0, 5), ephemeral: false, fetchReply: true };
      if (mapAttachment) payload.files = [mapAttachment];
      await interaction.followUp(payload).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
  }
  // Missile Salvo: show die-color choice buttons in activation thread
  if (resolveResult.missileSalvoStart) {
    const ms = game.pendingMissileSalvo?.[msgId];
    if (ms?.diceAvailable?.length > 0) {
      const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = await import('discord.js');
      const colorStyle = { blue: BS.Primary, red: BS.Danger, yellow: BS.Secondary };
      const btns = ms.diceAvailable.map((c) =>
        new BB().setCustomId(`missile_salvo_die_${c}_${game.gameId}_${msgId}`).setLabel(`${c.charAt(0).toUpperCase() + c.slice(1)} Die`).setStyle(colorStyle[c] || BS.Secondary)
      );
      btns.push(new BB().setCustomId(`missile_salvo_done_${game.gameId}_${msgId}`).setLabel('End Salvo').setStyle(BS.Success));
      const threadId = ms.threadId || game.dcActionsData?.[msgId]?.threadId;
      const salvoThread = threadId ? await fetchGameChannel(client, threadId) : null;
      const salvoMsg = `<@${ownerId}> **Missile Salvo** — Choose a die for your next ranged attack (+3 Accuracy, different targets). ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining.`;
      if (salvoThread) {
        await salvoThread.send(sanitizeMentions({ content: salvoMsg, components: [new AR().addComponents(btns)], allowedMentions: { users: [ownerId] } })).catch(discordCatch);
      } else {
        await interaction.followUp(sanitizeMentions({ content: salvoMsg, components: [new AR().addComponents(btns)], allowedMentions: { users: [ownerId] }, ephemeral: false })).catch(discordCatch);
      }
      saveGames(game.gameId);
      return;
    }
  }

  // If the resolved ability grants a free action, restore the action cost we decremented above
  if (resolveResult.freeAction && actionsData) {
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + 1);
    await updateDcActionsMessage(game, msgId, client);
  }
  // Power token type-choice prompt (player chooses Hit/Surge/Block/Evade immediately upon earning)
  if (resolveResult.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
    const threadId = game.dcActionsData?.[msgId]?.threadId;
    if (threadId) {
      game.pendingPowerTokenGrant.channelId = threadId;
      const ptThread = await fetchGameChannel(client, threadId);
      if (ptThread) {
        const { grants } = game.pendingPowerTokenGrant;
        const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
        const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
        const btns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
          new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
        );
        await ptThread.send({
          content: `**Choose power token type** for **${figNames}** (${totalCount > 1 ? `${totalCount} tokens` : '1 token'}):`,
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
      }
    }
  }
  // You Have Something I Want (Moff Gideon): present opponent choice buttons
  if (resolveResult.yhsiwPending && game.pendingYHSIW) {
    const _yhsiw = game.pendingYHSIW;
    const oppOwnerId = game[`player${_yhsiw.oppPlayerNum}Id`];
    const _yhsiwRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`yhsiw_transfer_${game.gameId}`).setLabel(`Transfer ${_yhsiw.token}`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`yhsiw_damage_${game.gameId}`).setLabel('Suffer 3 Damage').setStyle(ButtonStyle.Danger),
    );
    if (logGameAction) {
      await logGameAction(game, client, `<@${oppOwnerId}> **You Have Something I Want** — **${dcNameFromFigureKey(_yhsiw.targetFk)}**'s **${_yhsiw.token}** is targeted by **Moff Gideon**. Choose: transfer the token or suffer 3 Damage.`, { components: [_yhsiwRow], allowedMentions: { users: [oppOwnerId] } });
    }
  }
  // Track special action usage for CC purposes (To the Limit, All in a Day's Work)
  if (buttonKey === 'dc_special_' && resolveResult.applied) {
    game.specialActionUsedThisActivation = game.specialActionUsedThisActivation || {};
    game.specialActionUsedThisActivation[msgId] = (game.specialActionUsedThisActivation[msgId] || 0) + 1;
  }
  // Expertise (Ko-Tun Feralo): once per activation, using a Special grants 1 extra action
  if (buttonKey === 'dc_special_' && abilityId !== 'expertise' && actionsData) {
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const expertiseFk = `${meta.dcName}-${dgIndex}-${selectedFigure}`;
    const expertiseKey = expertiseFk + '_expertise';
    const effects = getDcEffects?.() || {};
    const effectEntry = effects[meta.dcName] || effects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if ((effectEntry?.specialAbilityIds || []).includes('expertise') && !game.roundFigureAbilityUsed?.[expertiseKey]) {
      if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
      game.roundFigureAbilityUsed[expertiseKey] = true;
      actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + 1);
      await updateDcActionsMessage(game, msgId, client);
      const thread = interaction.channel;
      await thread.send(`**Expertise** — ${displayName} gains 1 extra action this activation.`).catch(discordCatch);
    }
  }
  // Dubious Counterparts (Doctor Aphra): after a friendly DROID resolves Invasive Procedure,
  // that figure may perform 1 additional action
  if (buttonKey === 'dc_special_' && abilityId === 'invasive_procedure' && resolveResult.applied && actionsData) {
    const playerNum = meta.playerNum;
    if (isAphraAlive(game, playerNum)) {
      applyDubiousCounterpartsActionBump(actionsData, DC_ACTIONS_PER_ACTIVATION);
      await updateDcActionsMessage(game, msgId, client);
      const thread = interaction.channel;
      await thread.send(`**Dubious Counterparts** (Doctor Aphra) — **${displayName}** gains 1 additional action after resolving **Invasive Procedure**.`).catch(discordCatch);
    }
  }
  const manualMsg = resolveResult.manualMessage || 'Resolve manually (see rules).';
  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special_done_${game.gameId}_${msgId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success)
  );
  // If the ability drew/searched cards, the logMessage may contain private card names — send ephemeral
  const _revealedPrivateInfo = resolveResult.drewCards?.length > 0 || resolveResult.refreshHand;
  await interaction.followUp({
    content: `**${action}** — ${resolveResult.applied ? (resolveResult.logMessage || 'Resolved.') : manualMsg} Click **Done** when finished.`,
    components: [doneRow],
    ephemeral: !!_revealedPrivateInfo,
  }).catch(discordCatch);
  // Log resolved special outcome to game-logs channel
  if (resolveResult.applied && resolveResult.logMessage && logGameAction) {
    await logGameAction(game, client, resolveResult.logMessage, { phase: 'ROUND', icon: 'activate' });
  }
  // Post-action Bleed strain (DC Special resolves): centralized via
  // triggerBleedAfterAction.
  if (buttonKey === 'dc_special_') {
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFigure}`;
    await triggerBleedAfterAction(game, ctx, figureKey, meta.playerNum);
  }
  saveGames(game.gameId);
}

/**
 * Handle dc_ability_choice_ button: completes a DC special chooseOne ability when player picks an option.
 * customId: dc_ability_choice_{gameId}_{msgId}_{specialIdx}_{choiceIndex}
 */
export async function handleDcAbilityChoice(interaction, ctx) {
  const match = interaction.customId.match(/^dc_ability_choice_([^_]+)_([^_]+)_(\d+)_(\d+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, msgId, specialIdxStr, choiceIndexStr] = match;
  const specialIdx = parseInt(specialIdxStr, 10);
  const choiceIndex = parseInt(choiceIndexStr, 10);
  const { getGame, dcMessageMeta, dcHealthState, resolveAbility, updateDcActionsMessage, saveGames, client, getMapAttachmentForSpaces, getBoardStateForMovement, logGameAction } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingDcAbilityChoice?.[`${msgId}_${specialIdx}`];
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending ability choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, abilityId, figureIndex, targetFigureKeys } = pending;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the ability owner can choose.')) return;
  delete game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`];
  const meta = dcMessageMeta.get(msgId);

  // Wreak Vengeance: when dual_bladed_fury is used and wreakVengeanceActive is set, resolve BOTH chooseOne options
  if (abilityId === 'dual_bladed_fury' && game.wreakVengeanceActive?.playerNum === playerNum && resolveAbility) {
    const commonCtx = { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapData: ctx.getMapData, findDcMessageIdForFigure: ctx.findDcMessageIdForFigure, getDcEffects: ctx.getDcEffects };
    const r0 = resolveAbility(abilityId, { ...commonCtx, choiceIndex: 0 });
    const r1 = resolveAbility(abilityId, { ...commonCtx, choiceIndex: 1 });
    delete game.wreakVengeanceActive;
    const logParts = [r0.logMessage, r1.logMessage].filter(Boolean);
    const wvLog = `**Wreak Vengeance** — Both Dual-Bladed Fury effects applied:\n${logParts.join('\n')}`;
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: wvLog, ephemeral: false }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  const resolveResult = resolveAbility ? resolveAbility(abilityId, {
    game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, choiceIndex,
    targetFigureKey: targetFigureKeys?.[choiceIndex] || null,
    hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapData: ctx.getMapData,
    findDcMessageIdForFigure: ctx.findDcMessageIdForFigure, getDcEffects: ctx.getDcEffects,
  }) : { applied: false, manualMessage: 'Resolve manually.' };

  // False Orders Phase 2: figure chosen → show Move/Attack choice buttons
  if (!resolveResult.applied && resolveResult.falseOrdersActionPick) {
    const fo = game.pendingFalseOrders;
    if (!fo) {
      await interaction.followUp({ content: 'False Orders state lost.', ephemeral: true }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    const controlledName = dcNameFromFigureKey(fo.controlledFigureKey);
    const moveBtn = new ButtonBuilder()
      .setCustomId(`false_orders_action_${gameId}_${msgId}_move`)
      .setLabel(`Move — ${controlledName}`)
      .setStyle(ButtonStyle.Primary);
    const atkBtn = new ButtonBuilder()
      .setCustomId(`false_orders_action_${gameId}_${msgId}_attack`)
      .setLabel(`Attack — ${controlledName}`)
      .setStyle(ButtonStyle.Danger);
    await interaction.followUp({
      content: `**False Orders** — Choose action for **${controlledName}**:`,
      components: [new ActionRowBuilder().addComponents(moveBtn, atkBtn)],
      ephemeral: false,
    }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // Lure of the Dark Side Phase 2: hostile chosen → directly enter attack flow (Lure = attack only)
  if (resolveResult.applied && resolveResult.lureActionPick) {
    const lure = game.pendingLure;
    if (!lure) {
      await interaction.followUp({ content: 'Lure state lost.', ephemeral: true }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    // Convert pendingLure to pendingFalseOrders format for combat reuse
    setPendingFalseOrders(game, {
      controlledFigureKey: lure.controlledFigureKey,
      controlledPlayerNum: lure.controlledPlayerNum,
      controllerPlayerNum: lure.controllerPlayerNum,
      maxRange: lure.maxRange || 4,
      postAttackStrain: lure.postAttackStrain || 2,
      isLure: true,
    });
    clearPendingLure(game);
    // Auto-trigger attack flow (skip move/attack choice — Lure is attack-only)
    const controlledName = dcNameFromFigureKey(lure.controlledFigureKey);
    const atkBtn = new ButtonBuilder()
      .setCustomId(`false_orders_action_${gameId}_${msgId}_attack`)
      .setLabel(`Attack with ${controlledName}`)
      .setStyle(ButtonStyle.Danger);
    const skipBtn = new ButtonBuilder()
      .setCustomId(`false_orders_action_${gameId}_${msgId}_skip`)
      .setLabel('Skip (no attack)')
      .setStyle(ButtonStyle.Secondary);
    await interaction.followUp({
      content: `**Lure of the Dark Side** — **${controlledName}** gained 2 Damage Tokens. Choose a target to attack (within 4 spaces):`,
      components: [new ActionRowBuilder().addComponents(atkBtn, skipBtn)],
      ephemeral: false,
    }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // Push ability Phase 2: figure chosen, now pick landing space
  if (!resolveResult.applied && resolveResult.requiresSpaceChoice && Array.isArray(resolveResult.validSpaces) && resolveResult.validSpaces.length > 0) {
    if (getMapAttachmentForSpaces) {
      const boardState = getBoardStateForMovement ? getBoardStateForMovement(game, null) : null;
      const p2MapSpaces = boardState?.mapSpaces || {};
      const mapAttachment = await getMapAttachmentForSpaces(game, resolveResult.validSpaces);
      game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
      game.pendingPounceSpaceChoice[msgId] = { gameId: game.gameId, playerNum, figureIndex, msgId, abilityId, validSpaces: resolveResult.validSpaces, targetFigureKey: resolveResult.targetFigureKey || null };
      const spacePickLabel = resolveResult.spaceChoiceLabel || `Pick a landing space:`;
      const p2ContextKey = `${game.gameId}_${msgId}_${figureIndex}`;
      game.pendingSpacePick = game.pendingSpacePick || {};
      game.pendingSpacePick[p2ContextKey] = {
        validSpaces: resolveResult.validSpaces,
        cellPrefix: `pounce_space_${game.gameId}_${msgId}_${figureIndex}_`,
        mapSpaces: p2MapSpaces,
        headerText: spacePickLabel,
      };
      const { rows: p2RowBtns } = buildRowPickerButtons(resolveResult.validSpaces, `space_row_${p2ContextKey}_`);
      const payload = { content: `${spacePickLabel}\nChoose a row:`, components: p2RowBtns.slice(0, 5), ephemeral: false };
      if (mapAttachment) payload.files = [mapAttachment];
      await interaction.followUp(payload).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    // Fallback if space choice helpers not available
    await interaction.followUp({ content: `${resolveResult.spaceChoiceLabel || 'Pick a landing space'} (resolve manually — space picker unavailable).`, ephemeral: false }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // Multi-step choice (e.g., Trample multi-target): re-present choice buttons if ability needs more picks
  if (!resolveResult.applied && resolveResult.requiresChoice && Array.isArray(resolveResult.choiceOptions) && resolveResult.choiceOptions.length > 0) {
    game.pendingDcAbilityChoice = game.pendingDcAbilityChoice || {};
    game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`] = {
      gameId, playerNum, abilityId, msgId, figureIndex, specialIdx,
      choiceOptions: resolveResult.choiceOptions,
      targetFigureKeys: resolveResult.targetFigureKeys || null,
    };
    const choiceButtons = resolveResult.choiceOptions.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`dc_ability_choice_${gameId}_${msgId}_${specialIdx}_${i}`)
        .setLabel(String(label).slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    const rows = chunkButtonsToRows(choiceButtons);
    const prompt = resolveResult.choicePrompt || `**${abilityId}** — Choose:`;
    await interaction.followUp({ content: prompt, components: rows, ephemeral: false }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // Order / Tactical Maneuver: present "Move (Figure)" button for the ordered figure
  if (resolveResult.applied && resolveResult.orderMovePrompt) {
    const omp = resolveResult.orderMovePrompt;
    setPendingOrderedMove(game, {
      figureKey: omp.figureKey,
      targetMsgId: omp.msgId,
      playerNum,
      mp: omp.mp,
      label: omp.label || 'Order',
    });
    // Deduct action
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      await updateDcActionsMessage(game, msgId, client);
    }
    const moveBtn = new ButtonBuilder()
      .setCustomId(`order_move_${gameId}_${msgId}`)
      .setLabel(`Move — ${omp.name}`)
      .setStyle(ButtonStyle.Primary);
    const skipBtn = new ButtonBuilder()
      .setCustomId(`special_done_${gameId}_${msgId}`)
      .setLabel('Done (skip move)')
      .setStyle(ButtonStyle.Secondary);
    await interaction.followUp({
      content: `**${omp.label}** — **${omp.name}** gained **${omp.mp} movement points**. Move them now or skip:`,
      components: [new ActionRowBuilder().addComponents(moveBtn, skipBtn)],
      ephemeral: false,
    }).catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, resolveResult.logMessage, { phase: 'ROUND', icon: 'activate' });
    saveGames(game.gameId);
    return;
  }

  // Deduct action (was refunded when showing choice buttons)
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    await updateDcActionsMessage(game, msgId, client);
  }
  if (resolveResult.freeAction && actionsData) {
    actionsData.remaining = Math.min(actionsData.total ?? DC_ACTIONS_PER_ACTIVATION, actionsData.remaining + 1);
    await updateDcActionsMessage(game, msgId, client);
  }
  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special_done_${gameId}_${msgId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success)
  );
  await interaction.followUp({
    content: `**Choice resolved** — ${resolveResult.logMessage || (resolveResult.applied ? 'Applied.' : resolveResult.manualMessage || 'Resolve manually.')} Click Done when finished.`,
    components: [doneRow],
    ephemeral: false,
  }).catch(discordCatch);
  // Log resolved choice outcome to game-logs channel
  if (resolveResult.applied && resolveResult.logMessage && logGameAction) {
    await logGameAction(game, client, resolveResult.logMessage, { phase: 'ROUND', icon: 'activate' });
  }
  saveGames(game.gameId);
}

/**
 * Handle pounce_space_ button: completes Nexu Pounce placement after space is chosen.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handlePounceSpacePick(interaction, ctx) {
  // pounce_space_{gameId}_{msgId}_{figureIndex}_{space}
  const match = interaction.customId.match(/^pounce_space_([^_]+)_([^_]+)_(\d+)_(.+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid pounce space choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, msgId, figureIndexStr, space] = match;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, dcMessageMeta, resolveAbility, logGameAction, updateDcActionsMessage, buildBoardMapPayload, client, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}_${figureIndexStr}`);
  const pending = game.pendingPounceSpaceChoice?.[msgId];
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending pounce space choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, abilityId, validSpaces, targetFigureKey } = pending;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the activating player can choose the destination.')) return;
  const validLower = (validSpaces || []).map((s) => String(s).toLowerCase());
  if (!validLower.includes(chosenSpace)) {
    await interaction.followUp({ content: 'That space is not a valid destination.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const meta = dcMessageMeta.get(msgId);
  const result = resolveAbility(abilityId, { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState: ctx.dcHealthState, chosenSpace, targetFigureKey: targetFigureKey || null });
  delete game.pendingPounceSpaceChoice[msgId];

  // Space choice resolved into a follow-up figure choice (e.g. Headbutt: move → pick adjacent hostile)
  if (!result.applied && result.requiresChoice && Array.isArray(result.choiceOptions) && result.choiceOptions.length > 0) {
    const specialIdx = pending.specialIdx || 0;
    game.pendingDcAbilityChoice = game.pendingDcAbilityChoice || {};
    game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`] = {
      gameId, playerNum, abilityId, msgId, figureIndex: pending.figureIndex, specialIdx,
      choiceOptions: result.choiceOptions,
      targetFigureKeys: result.targetFigureKeys || null,
    };
    // Refresh board if figure moved during the space choice phase
    if (result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const bPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(bPayload);
        }
      } catch (err) { console.error('Board refresh after space choice failed:', err); }
    }
    const choiceButtons = result.choiceOptions.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`dc_ability_choice_${gameId}_${msgId}_${specialIdx}_${i}`)
        .setLabel(String(label).slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    const rows = chunkButtonsToRows(choiceButtons);
    const prompt = result.choicePrompt || `Choose a target:`;
    await interaction.followUp({ content: prompt, components: rows, ephemeral: false }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  if (result.applied) {
    if (result.logMessage) {
      await logGameAction(game, client, result.logMessage, { phase: 'ROUND', icon: 'move' }).catch(discordCatch);
    }
    if (result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        }
      } catch (err) {
        console.error('Pounce board refresh failed:', err);
      }
    }
    await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
    const doneRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`special_done_${gameId}_${msgId}`)
        .setLabel('Done')
        .setStyle(ButtonStyle.Success)
    );
    const hasForcedTarget = game.forcedAttackTarget?.[msgId];
    const editContent = abilityId === 'pounce'
      ? `**Pounce**: placed at **${String(chosenSpace).toUpperCase()}**. Use the **Attack** button for your free pounce attack (no action cost), or press **Done** to skip.`
      : hasForcedTarget
        ? `${result.logMessage || `**${abilityId}** resolved.`} Use **Attack** to target the pushed figure (free action), or press **Done** to skip.`
        : `${result.logMessage || `**${abilityId}** resolved.`} Click **Done** when finished.`;
    await interaction.message.edit({
      content: editContent,
      components: [doneRow],
    }).catch(discordCatch);
  } else {
    await interaction.message.edit({ content: `${abilityId === 'pounce' ? 'Pounce' : 'Ability'} failed: ${result.manualMessage}`, components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

/**
 * Slam / Smash / Ram skip-push handler — destruct 2026-05-06 auto-pick rule.
 * Card text says "you MAY push" (push optional). Player can decline the
 * push entirely after the die has been rolled and damage applied.
 *
 * customId format: pounce_skip_push_<gameId>_<msgId>_<figIdx>
 */
export async function handlePounceSkipPush(interaction, ctx) {
  const m = interaction.customId.match(/^pounce_skip_push_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid skip-push button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, msgId, figureIndexStr] = m;
  const { getGame, logGameAction, client, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}_${figureIndexStr}`);
  const pending = game.pendingPounceSpaceChoice?.[msgId];
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending push to skip.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum } = pending;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the activating player can skip the push.')) return;
  // Damage was already applied during the rollOneDie phase 2 (when the die
  // was rolled). Skipping just declines the optional push and finalizes.
  delete game.pendingPounceSpaceChoice[msgId];
  if (Object.keys(game.pendingPounceSpaceChoice || {}).length === 0) delete game.pendingPounceSpaceChoice;
  await interaction.message.edit({
    content: `${interaction.message.content}\n\n✅ **Push declined** — ${pending.targetFigureKey ? `target stays in place` : `no push`}.`,
    components: [],
  }).catch(discordCatch);
  if (logGameAction) {
    await logGameAction(game, client, `Push declined (optional per card text "you may push").`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

/**
 * Handle arsenal_pick_ select menu: store chosen dice in pendingOverrideAttackDice, then show target list.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx
 */
export async function handleArsenalPick(interaction, ctx) {
  // customId: arsenal_pick_{gameId}_{msgId}_{figureIndex}
  const withoutPrefix = parseCustomId(interaction.customId, 'arsenal_pick_');
  const parts = withoutPrefix.split('_');
  const gameId = parts[0];
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(1, -1).join('_');

  await interaction.deferUpdate().catch(discordCatch);

  const { getGame, dcMessageMeta, getDcStats, getDcEffects, getMapData, saveGames, replyIfGameEnded } = ctx;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) { await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch); return; }
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  const chosenDice = interaction.values[0].split(',');
  game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
  game.pendingOverrideAttackDice[msgId] = { dice: chosenDice };
  saveGames(game.gameId);

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[meta.playerNum] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapData(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = meta.playerNum;
  const enemyPlayerNum = opponentPlayerNum(playerNum);
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!attackerPos) {
    await interaction.followUp({ content: 'Figure has no position yet.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await buildAndSendAttackTargets(interaction, ctx, game, meta, msgId, figureKey, figureIndex, {
    dgIndex, attackerPos, attackerKws, minRange, effectiveMaxRange, ms, playerNum, enemyPlayerNum, stats,
    excludeFigureKeys: game.pendingMissileSalvo?.[msgId]?.targetsFired,
  });
}

/**
 * Handle ee3_pick_die_ button: player chose which die color to upgrade to red (or skipped).
 * customId: ee3_pick_die_{color|skip}_{gameId}_{msgId}_{figureIndex}
 */
export async function handleEe3DiePick(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, getMapData, saveGames } = ctx;
  const withoutPrefix = parseCustomId(interaction.customId, 'ee3_pick_die_');
  const parts = withoutPrefix.split('_');
  const color = parts[0]; // 'blue', 'green', 'yellow', or 'skip'
  const gameId = parts[1];
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(2, -1).join('_');

  const meta = dcMessageMeta.get(msgId);
  if (!meta) return;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  game.pendingEe3Carbine = game.pendingEe3Carbine || {};

  if (color !== 'skip') {
    // Deduct 2 MP and upgrade one die of the chosen color to red
    const mp = game.movementBank?.[msgId];
    if (mp) mp.remaining = Math.max(0, mp.remaining - 2);
    const stats = getDcStats(meta.dcName);
    const baseDice = [...(stats.attack?.dice || ['red'])];
    const idx = baseDice.indexOf(color);
    if (idx !== -1) baseDice[idx] = 'red';
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { dice: baseDice };
  }
  game.pendingEe3Carbine[msgId] = 'decided';
  saveGames(game.gameId);

  // Proceed to attack target selection
  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[meta.playerNum] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapData(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = meta.playerNum;
  const enemyPlayerNum = opponentPlayerNum(playerNum);
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!attackerPos) {
    await interaction.followUp({ content: 'Figure has no position yet.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await buildAndSendAttackTargets(interaction, ctx, game, meta, msgId, figureKey, figureIndex, {
    dgIndex, attackerPos, attackerKws, minRange, effectiveMaxRange, ms, playerNum, enemyPlayerNum, stats,
    excludeFigureKeys: game.pendingMissileSalvo?.[msgId]?.targetsFired,
  });
}

/**
 * Handle bo_rifle_pick_ button: player chose to use Bo-Rifle (melee) or skip (normal ranged).
 * customId: bo_rifle_pick_{use|skip}_{gameId}_{msgId}_{figureIndex}
 */
export async function handleBoRiflePick(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, getMapData, saveGames } = ctx;
  const withoutPrefix = parseCustomId(interaction.customId, 'bo_rifle_pick_');
  const parts = withoutPrefix.split('_');
  const choice = parts[0]; // 'use' or 'skip'
  const gameId = parts[1];
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(2, -1).join('_');

  const meta = dcMessageMeta.get(msgId);
  if (!meta) return;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  if (choice === 'use' && game.pendingBoRifle?.[msgId]) {
    const meleeDice = game.pendingBoRifle[msgId].meleeDice;
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { dice: meleeDice, type: 'melee' };
    await interaction.message.edit({ content: `**Bo-Rifle** — Melee mode active (${meleeDice.map(d => d[0].toUpperCase() + d.slice(1)).join('+')}).`, components: [] }).catch(discordCatch);
  } else {
    await interaction.message.edit({ content: '**Bo-Rifle** — Skipped (normal ranged attack).', components: [] }).catch(discordCatch);
  }
  if (game.pendingBoRifle?.[msgId]) delete game.pendingBoRifle[msgId];
  saveGames(game.gameId);

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _loadoutCard = getLoadoutCards()[getConfig(game, `${meta.dcName}-${dgIndex}-${figureIndex}`)?.loadout];
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[meta.playerNum] || _loadoutCard?.passive === 'Reach' || _hasFuryReach(game, meta.playerNum, attackerKws);
  // If Bo-Rifle mode, override range to melee
  const brOverride = game.pendingOverrideAttackDice?.[msgId];
  const effectiveMinRange = brOverride?.type === 'melee' ? 1 : minRange;
  const effectiveMaxRange_ = brOverride?.type === 'melee' ? (hasReach ? 2 : 1) : (hasReach && maxRange < 2 ? 2 : maxRange);
  const ms = getMapData(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = meta.playerNum;
  const enemyPlayerNum = opponentPlayerNum(playerNum);
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!attackerPos) {
    await interaction.followUp({ content: 'Figure has no position yet.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await buildAndSendAttackTargets(interaction, ctx, game, meta, msgId, figureKey, figureIndex, {
    dgIndex, attackerPos, attackerKws, minRange: effectiveMinRange, effectiveMaxRange: effectiveMaxRange_, ms, playerNum, enemyPlayerNum, stats,
    excludeFigureKeys: game.pendingMissileSalvo?.[msgId]?.targetsFired,
  });
}

/**
 * Handle false_orders_action_ button: choose Move or Attack for the controlled figure.
 * customId: false_orders_action_{gameId}_{msgId}_{move|attack}
 */
export async function handleFalseOrdersAction(interaction, ctx) {
  const m = interaction.customId.match(/^false_orders_action_([^_]+)_([^_]+)_(move|attack|skip)$/);
  if (!m) return;
  const [, gameId, msgId, choice] = m;
  const {
    getGame, replyIfGameEnded, getDcStats, getDcEffects, getMapData,
    getFigureSize, getFootprintCells, getRange, hasLineOfSight,
    getBoardStateForMovement, getMovementProfile, computeMovementCache,
    getMapAttachmentForSpaces,
    saveGames, FIGURE_LETTERS, getMapTokensData,
  } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const fo = game.pendingFalseOrders;
  if (!fo || (!fo.isLure && fo.murneRinMsgId !== msgId)) {
    await interaction.followUp({ content: 'No pending False Orders / Lure.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { controlledFigureKey, controlledPlayerNum, controllerPlayerNum } = fo;
  if (!await requirePlayer(interaction, game, interaction.user.id, controllerPlayerNum, canActAsPlayer, 'Only the controller may choose.')) return;
  const controlledName = dcNameFromFigureKey(controlledFigureKey);
  const controlledStats = getDcStats(controlledName);
  const controlledPos = game.figurePositions?.[controlledPlayerNum]?.[controlledFigureKey];

  // Lure skip: hostile suffers 2 strain anyway (per card rules, strain happens regardless)
  if (choice === 'skip') {
    if (fo.isLure && fo.postAttackStrain > 0) {
      // Apply Lure strain directly via dcHealthState
      const _lureMsgId = ctx.findDcMessageIdForFigure?.(game.gameId, controlledPlayerNum, controlledFigureKey);
      if (_lureMsgId) {
        const _lureFigMatch = controlledFigureKey.match(/-(\d+)-(\d+)$/);
        const _lureFigIdx = _lureFigMatch ? parseInt(_lureFigMatch[2], 10) : 0;
        const _lureHs = ctx.dcHealthState?.get(_lureMsgId) || [];
        const _lureEntry = _lureHs[_lureFigIdx];
        if (_lureEntry) {
          const [_lureCur, _lureMax] = _lureEntry;
          _lureHs[_lureFigIdx] = [Math.max(0, _lureCur - fo.postAttackStrain), _lureMax];
          ctx.dcHealthState.set(_lureMsgId, _lureHs);
        }
      }
      await interaction.followUp({ content: `**Lure of the Dark Side** — Skipped attack. **${controlledName}** suffers ${fo.postAttackStrain} Strain.`, ephemeral: false }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Skipped.`, ephemeral: false }).catch(discordCatch);
    }
    clearPendingFalseOrders(game);
    saveGames(game.gameId);
    return;
  }

  if (choice === 'move') {
    if (!controlledPos) {
      await interaction.followUp({ content: `${controlledName} has no position — resolve manually.`, ephemeral: false }).catch(discordCatch);
      return;
    }
    const boardState = getBoardStateForMovement(game, controlledFigureKey);
    if (!boardState) {
      await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const moveSpeed = controlledStats?.move ?? 3;
    const profile = getMovementProfile(controlledName, controlledFigureKey, game);
    const cache = computeMovementCache(controlledPos, moveSpeed, boardState, profile);
    const reachableSpaces = [...cache.cells.keys()];
    if (reachableSpaces.length === 0) {
      await interaction.followUp({ content: `${controlledName} cannot move (no valid spaces).`, ephemeral: false }).catch(discordCatch);
      return;
    }
    const foMapSpaces = boardState?.mapSpaces || {};
    const foContextKey = `${gameId}_${msgId}`;
    const foHeader = `**False Orders** — Choose a space for **${controlledName}** to move to`;
    game.pendingSpacePick = game.pendingSpacePick || {};
    game.pendingSpacePick[foContextKey] = {
      validSpaces: reachableSpaces,
      cellPrefix: `false_orders_space_${gameId}_${msgId}_`,
      mapSpaces: foMapSpaces,
      headerText: foHeader,
    };
    const { rows: foRowBtns } = buildRowPickerButtons(reachableSpaces, `space_row_${foContextKey}_`);
    const mapAttachment = getMapAttachmentForSpaces ? await getMapAttachmentForSpaces(game, reachableSpaces) : null;
    const payload = {
      content: `${foHeader}:\nChoose a row:`,
      components: foRowBtns.slice(0, 5),
      ephemeral: false,
    };
    if (mapAttachment) payload.files = [mapAttachment];
    await interaction.followUp(payload).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // Attack case
  if (!controlledPos) {
    await interaction.followUp({ content: `${controlledName} has no position — resolve manually.`, ephemeral: false }).catch(discordCatch);
    return;
  }
  const controlledAttackInfo = controlledStats?.attack || { dice: ['red'], type: 'range' };
  const [foMinRange, foMaxRange] = defaultAttackRange(controlledAttackInfo);
  const controlledEff = getDcEffects()[controlledName] || getDcEffects()[controlledName?.replace(/\s*\[.*\]\s*$/, '')];
  const controlledKws = (controlledEff?.keywords || []).map((k) => String(k).toUpperCase());
  const foHasReach = controlledKws.includes('REACH') || (controlledEff?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || _hasFuryReach(game, controlledPlayerNum, controlledKws);
  let foEffectiveMaxRange = foHasReach && foMaxRange < 2 ? 2 : foMaxRange;
  // Lure of the Dark Side: cap range at 4 (or whatever maxRange is set)
  if (fo.isLure && fo.maxRange) foEffectiveMaxRange = Math.min(foEffectiveMaxRange, fo.maxRange);
  const ms = getEffectiveMapSpaces(game, getMapData(game.selectedMap?.id));
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Compute closed-door edges for graph-distance counting AND LOS
  const foMapId = game.selectedMap?.id;
  const foAllDoors = (getMapTokensData && foMapId) ? (getMapTokensData()[foMapId]?.doors || []) : [];
  const foOpenedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const foClosedEdges = foAllDoors.filter(e => {
    const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
    return !foOpenedSet.has(`${a}|${b}`) && !foOpenedSet.has(`${b}|${a}`);
  });
  const foClosedDoorEdges = new Set(foClosedEdges.map(e => edgeKey(e[0], e[1])));
  // Build LOS-aware mapSpaces: merge closed doors + energy shields + smoke
  let losMs = ms;
  {
    const shieldSpaces = (game.ancillaryTokens?.energyShield || []).map(s => String(s).toLowerCase());
    const smokeSpaces = (game.ancillaryTokens?.smoke || []).map(s => String(s).toLowerCase());
    const extraBlocking = [...shieldSpaces, ...smokeSpaces];
    const mergedImpassable = foClosedEdges.length > 0
      ? [...(ms?.impassableEdges || []), ...foClosedEdges]
      : ms?.impassableEdges;
    if (foClosedEdges.length > 0 || extraBlocking.length > 0) {
      losMs = {
        ...ms,
        impassableEdges: mergedImpassable || [],
        blocking: extraBlocking.length > 0 ? [...(ms?.blocking || []), ...extraBlocking] : ms?.blocking,
      };
    }
  }
  // Collect all other figures as potential targets
  const allOtherPositions = {};
  for (const [figKey, pos] of Object.entries(game.figurePositions?.[1] || {})) {
    if (figKey !== controlledFigureKey) allOtherPositions[figKey] = pos;
  }
  for (const [figKey, pos] of Object.entries(game.figurePositions?.[2] || {})) {
    if (figKey !== controlledFigureKey) allOtherPositions[figKey] = pos;
  }
  // Build figure-blocking coords for the controlled attacker (LOS-19b fix)
  const controlledSize = game.figureOrientations?.[controlledFigureKey] || getFigureSize(controlledName);
  const foBlockingCoords = buildFigureBlockingCoords(game, controlledPlayerNum, controlledPos, controlledSize, ctx);
  const foTargets = [];
  for (const [figKey, targetPos] of Object.entries(allOtherPositions)) {
    const dist = countSpaces(ms, controlledPos, targetPos, foClosedDoorEdges);
    if (dist < foMinRange || dist > foEffectiveMaxRange) continue;
    // Refine blocking set per target: remove target's own footprint, skip blocking for MASSIVE targets
    let losBlockingCoords = foBlockingCoords;
    if (foBlockingCoords) {
      const tDcName = dcNameFromFigureKey(figKey);
      const tEff = getDcEffects()[tDcName] || getDcEffects()[tDcName.replace(/\s*\[.*\]\s*$/, '')];
      if ((tEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) {
        losBlockingCoords = null;
      } else {
        const tSize = game.figureOrientations?.[figKey] || getFigureSize(tDcName);
        const tFp = getFootprintCells(targetPos, tSize).map(c => String(c).toLowerCase());
        if (tFp.some(c => foBlockingCoords.has(c))) {
          losBlockingCoords = new Set([...foBlockingCoords].filter(c => !tFp.includes(c)));
        }
      }
    }
    const los = ctx.hasLineOfSightByCoord
      ? ctx.hasLineOfSightByCoord(game, controlledPos, targetPos, losMs, ctx.getFigureSize, { blocking: losBlockingCoords })
      : true;
    const fkMatch = figKey.match(/^(.+)-(\d+)-(\d+)$/);
    const targetDcName = fkMatch ? dcNameFromFigureKey(figKey) : figKey;
    const dg = fkMatch ? fkMatch[2] : '1';
    const fi = fkMatch ? parseInt(fkMatch[3], 10) : 0;
    const figCount = getDcStats(targetDcName)?.figures ?? 1;
    const label = figCount > 1 ? `${targetDcName} ${dg}${FIGURE_LETTERS?.[fi] || 'a'}` : targetDcName;
    foTargets.push({ figureKey: figKey, label, coord: targetPos, dist, hasLOS: los });
  }
  if (foTargets.length === 0) {
    await interaction.followUp({ content: `No valid targets for **${controlledName}** in range.`, ephemeral: false }).catch(discordCatch);
    return;
  }
  game.falseOrdersAttackTargets = game.falseOrdersAttackTargets || {};
  game.falseOrdersAttackTargets[msgId] = foTargets;
  const targetBtns = foTargets.map((t, targetIndex) => {
    const noLOS = t.hasLOS === false;
    return new ButtonBuilder()
      .setCustomId(`false_orders_atk_${gameId}_${msgId}_${targetIndex}`)
      .setLabel(`${t.label} (${String(t.coord).toUpperCase()})${noLOS ? ' [No LOS]' : ''}`.slice(0, 80))
      .setStyle(noLOS ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(noLOS);
  });
  const targetRows = chunkButtonsToRows(targetBtns);
  await interaction.followUp({
    content: `**False Orders** — Choose attack target for **${controlledName}**:`,
    components: targetRows,
    ephemeral: false,
  }).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle false_orders_space_ button: complete the False Orders Move when a space is chosen.
 * customId: false_orders_space_{gameId}_{msgId}_{space}
 */
export async function handleFalseOrdersMovePick(interaction, ctx) {
  const m = interaction.customId.match(/^false_orders_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, replyIfGameEnded, logGameAction, buildBoardMapPayload, saveGames, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  if (await replyIfGameEnded(game, interaction)) return;
  const fo = game.pendingFalseOrders;
  if (!fo || fo.murneRinMsgId !== msgId) {
    await interaction.followUp({ content: 'No pending False Orders move.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { controlledFigureKey, controlledPlayerNum, controllerPlayerNum } = fo;
  if (!await requirePlayer(interaction, game, interaction.user.id, controllerPlayerNum, canActAsPlayer, 'Only the controller may choose.')) return;
  const controlledName = dcNameFromFigureKey(controlledFigureKey);
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[controlledPlayerNum] = game.figurePositions[controlledPlayerNum] || {};
  game.figurePositions[controlledPlayerNum][controlledFigureKey] = chosenSpace;
  game.figureMoved = game.figureMoved || {};
  game.figureMoved[controlledFigureKey] = true;
  clearPendingFalseOrders(game);
  if (logGameAction) await logGameAction(game, client, `🎯 **False Orders** — P${controllerPlayerNum} moved **${controlledName}** to **${chosenSpace.toUpperCase()}**.`, { phase: 'ROUND', icon: 'move' }).catch(discordCatch);
  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special_done_${gameId}_${msgId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success)
  );
  let boardPayload = null;
  if (buildBoardMapPayload) boardPayload = await buildBoardMapPayload(game).catch(() => null);
  const replyPayload = {
    content: `**False Orders** — **${controlledName}** moved to **${chosenSpace.toUpperCase()}**. Click Done when finished.`,
    components: [doneRow],
    ephemeral: false,
  };
  if (boardPayload?.files) replyPayload.files = boardPayload.files;
  await interaction.followUp(replyPayload).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle order_move_ button: player chose to move the ordered figure.
 * Computes reachable spaces and presents the space picker.
 * customId: order_move_{gameId}_{officerMsgId}
 */
export async function handleOrderMove(interaction, ctx) {
  const m = interaction.customId.match(/^order_move_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, officerMsgId] = m;
  const {
    getGame, replyIfGameEnded, getDcStats,
    getBoardStateForMovement, getMovementProfile, computeMovementCache,
    getMapAttachmentForSpaces, saveGames, client, FIGURE_LETTERS,
  } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingOrderedMove;
  if (!pending) {
    await interaction.followUp({ content: 'No pending ordered move.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the ordering player may choose.')) return;

  const { figureKey, mp, label } = pending;
  const pos = game.figurePositions?.[pending.playerNum]?.[figureKey];
  if (!pos) {
    const dcName = dcNameFromFigureKey(figureKey);
    await interaction.followUp({ content: `**${dcName}** has no position on the board.`, ephemeral: false }).catch(discordCatch);
    clearPendingOrderedMove(game);
    saveGames(game.gameId);
    return;
  }

  const dcName = dcNameFromFigureKey(figureKey);
  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = getMovementProfile(dcName, figureKey, game);
  const cache = computeMovementCache(pos, mp, boardState, profile);
  const reachableSpaces = [...cache.cells.keys()];
  if (reachableSpaces.length === 0) {
    await interaction.followUp({ content: `**${dcName}** cannot move (no valid spaces within ${mp} MP).`, ephemeral: false }).catch(discordCatch);
    clearPendingOrderedMove(game);
    saveGames(game.gameId);
    return;
  }

  const contextKey = `${gameId}_${officerMsgId}`;
  const headerText = `**${label}** — Choose a space for **${dcName}** to move to`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[contextKey] = {
    validSpaces: reachableSpaces,
    cellPrefix: `order_move_space_${gameId}_${officerMsgId}_`,
    mapSpaces: boardState.mapSpaces || {},
    headerText,
  };
  const { rows } = buildRowPickerButtons(reachableSpaces, `space_row_${contextKey}_`);
  const mapAttachment = getMapAttachmentForSpaces ? await getMapAttachmentForSpaces(game, reachableSpaces) : null;
  const payload = {
    content: `${headerText}:\nChoose a row:`,
    components: rows.slice(0, 5),
    ephemeral: false,
  };
  if (mapAttachment) payload.files = [mapAttachment];
  await interaction.followUp(payload).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle order_move_space_ button: complete the ordered figure move when a space is chosen.
 * customId: order_move_space_{gameId}_{officerMsgId}_{space}
 */
export async function handleOrderMoveSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^order_move_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, officerMsgId, space] = m;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, replyIfGameEnded, logGameAction, buildBoardMapPayload, saveGames, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${officerMsgId}`);
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingOrderedMove;
  if (!pending) {
    await interaction.followUp({ content: 'No pending ordered move.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the ordering player may choose.')) return;

  const { figureKey, targetMsgId, label } = pending;
  const dcName = dcNameFromFigureKey(figureKey);
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[pending.playerNum] = game.figurePositions[pending.playerNum] || {};
  game.figurePositions[pending.playerNum][figureKey] = chosenSpace;
  game.figureMoved = game.figureMoved || {};
  game.figureMoved[figureKey] = true;

  // Clear the movement bank since all ordered MP are spent
  if (targetMsgId && game.movementBank?.[targetMsgId]) {
    game.movementBank[targetMsgId].remaining = 0;
  }
  clearPendingOrderedMove(game);

  if (logGameAction) await logGameAction(game, client, `🎯 **${label}** — **${dcName}** moved to **${chosenSpace.toUpperCase()}**.`, { phase: 'ROUND', icon: 'move' }).catch(discordCatch);

  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special_done_${gameId}_${officerMsgId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success)
  );
  let boardPayload = null;
  if (buildBoardMapPayload) boardPayload = await buildBoardMapPayload(game).catch(() => null);
  const replyPayload = {
    content: `**${label}** — **${dcName}** moved to **${chosenSpace.toUpperCase()}**. Click Done when finished.`,
    components: [doneRow],
    ephemeral: false,
  };
  if (boardPayload?.files) replyPayload.files = boardPayload.files;
  await interaction.followUp(replyPayload).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Apply N damage to a figure via dcHealthState, syncing dcList. Returns { newHp, wasDefeated }.
 */
function _applyHpDamage(game, dcHealthState, dcMessageMeta, figureKey, damage) {
  const fkMatch = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  if (!fkMatch) return { newHp: null, wasDefeated: false };
  const [, dcName, dgIndex, figIndexStr] = fkMatch;
  const figIndex = parseInt(figIndexStr, 10);
  // Find msgId for this figure's DC
  let targetMsgId = null;
  for (const [mId, mMeta] of dcMessageMeta) {
    if (mMeta.gameId !== game.gameId) continue;
    if (mMeta.dcName !== dcName) continue;
    const dgMatch = (mMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIdx = dgMatch ? dgMatch[1] : '1';
    if (String(dgIdx) === String(dgIndex)) { targetMsgId = mId; break; }
  }
  if (!targetMsgId) return { newHp: null, wasDefeated: false };
  const meta = dcMessageMeta.get(targetMsgId);
  const playerNum = meta?.playerNum ?? 1;
  const { newHp, prevHp, wasDefeated } = reduceHp(dcHealthState, game, targetMsgId, figIndex, damage, playerNum);
  if (prevHp === 0 && newHp === 0) return { newHp: prevHp, wasDefeated: false }; // already dead or no entry
  return { newHp, wasDefeated, targetMsgId };
}

/**
 * Handle rush_push_fig_ button: player picks which adjacent SMALL hostile to push.
 */
export async function handleRushPushFig(interaction, ctx) {
  const m = interaction.customId.match(/^rush_push_fig_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, msgId, choiceIdxStr] = m;
  const choiceIndex = parseInt(choiceIdxStr, 10);
  const { getGame, dcMessageMeta, dcHealthState, getMapData, logGameAction, buildBoardMapPayload,
    updateDcActionsMessage, getMapAttachmentForSpaces, saveGames, client, processFigureDefeat } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingRushPush;
  if (!pending || pending.msgId !== msgId) {
    await interaction.followUp({ content: 'No pending Rush push.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activating player can choose.')) return;
  const targetFk = pending.targets?.[choiceIndex];
  if (!targetFk) { await interaction.followUp({ content: 'Invalid target.', ephemeral: true }).catch(discordCatch); return; }
  pending.chosenTarget = targetFk;
  const oppNum = opponentPlayerNum(pending.playerNum);
  const targetPos = game.figurePositions?.[oppNum]?.[targetFk];
  if (!targetPos) {
    clearPendingRushPush(game);
    await interaction.message.edit({ content: '**Rush** — Target no longer on board.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Find valid landing spaces: target's current space + adjacent unoccupied
  const mapId = game.selectedMap?.id;
  const mapSpaces = mapId ? getMapData(mapId) : null;
  const adjToTarget = mapSpaces?.adjacency?.[targetPos] || [];
  const occupied = new Set([
    ...Object.values(game.figurePositions?.[1] || {}),
    ...Object.values(game.figurePositions?.[2] || {}),
  ].filter(Boolean));
  occupied.delete(targetPos); // target can stay in its own space
  const validSpaces = [targetPos, ...adjToTarget.filter(s => !occupied.has(s))];
  if (validSpaces.length === 1) {
    // Only current space — auto-resolve (damage only, no actual push)
    const targetName = dcNameFromFigureKey(targetFk);
    const t = _applyHpDamage(game, dcHealthState, dcMessageMeta, targetFk, 1);
    const a = _applyHpDamage(game, dcHealthState, dcMessageMeta, pending.activatorFigureKey, 1);
    const tNote = t.wasDefeated ? ' **(defeated)**' : '';
    const aNote = a.wasDefeated ? ' **(defeated)**' : '';
    const logMsg = `**Rush** — Both suffer 1 Damage: **${targetName}**${tNote}, **Onar**${aNote}. No push (no open space).`;
    if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    if (t.wasDefeated && processFigureDefeat) {
      await processFigureDefeat(game, { defeatedPlayerNum: oppNum, figureKey: targetFk, attackerPlayerNum: pending.playerNum, source: 'Rush' });
    }
    if (a.wasDefeated && processFigureDefeat) {
      await processFigureDefeat(game, { defeatedPlayerNum: pending.playerNum, figureKey: pending.activatorFigureKey, attackerPlayerNum: oppNum, source: 'Rush' });
    }
    await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
    clearPendingRushPush(game);
    await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Show 2-step row→cell space picker via generic space_row_ handler
  pending.chosenTarget = targetFk;
  const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
  const bMapSpaces = boardState?.mapSpaces || {};
  const contextKey = `${gameId}_${msgId}`;
  const headerText = `**Rush** — Pick landing space for **${dcNameFromFigureKey(targetFk)}** (or stay at **${targetPos.toUpperCase()}**)`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[contextKey] = {
    validSpaces,
    cellPrefix: `rush_push_space_${gameId}_${msgId}_`,
    mapSpaces: bMapSpaces,
    headerText,
  };
  const { rows: rowBtns } = buildRowPickerButtons(validSpaces, `space_row_${contextKey}_`);
  const mapAttachment = await getMapAttachmentForSpaces(game, validSpaces);
  const payload = {
    content: `${headerText}:\nChoose a row:`,
    components: rowBtns.slice(0, 5),
  };
  if (mapAttachment) payload.files = [mapAttachment];
  await interaction.message.edit({ content: '**Rush** — Choosing push destination...', components: [] }).catch(discordCatch);
  await interaction.followUp(payload).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle rush_push_space_ button: finalize Rush push + apply mutual 1 Damage.
 */
export async function handleRushPushSpace(interaction, ctx) {
  const m = interaction.customId.match(/^rush_push_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, dcMessageMeta, dcHealthState, logGameAction, buildBoardMapPayload,
    updateDcActionsMessage, saveGames, client, processFigureDefeat } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  const pending = game.pendingRushPush;
  if (!pending || pending.msgId !== msgId) {
    await interaction.followUp({ content: 'No pending Rush push.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activating player can choose.')) return;
  const targetFk = pending.chosenTarget;
  const oppNum = opponentPlayerNum(pending.playerNum);
  const { prevPos } = pushFigure(game, oppNum, targetFk, chosenSpace) || { prevPos: null };
  const targetName = dcNameFromFigureKey(targetFk);
  const pushed = chosenSpace !== (prevPos ? String(prevPos).toLowerCase() : null);
  // Apply 1 damage to both
  const t = _applyHpDamage(game, dcHealthState, dcMessageMeta, targetFk, 1);
  const a = _applyHpDamage(game, dcHealthState, dcMessageMeta, pending.activatorFigureKey, 1);
  const tNote = t.wasDefeated ? ' **(defeated)**' : '';
  const aNote = a.wasDefeated ? ' **(defeated)**' : '';
  const pushNote = pushed ? ` Pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} → ${chosenSpace.toUpperCase()}.` : '';
  const logMsg = `**Rush** —${pushNote} Both suffer 1 Damage: **${targetName}**${tNote}, **Onar**${aNote}.`;
  if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  if (t.wasDefeated && processFigureDefeat) {
    await processFigureDefeat(game, { defeatedPlayerNum: oppNum, figureKey: targetFk, attackerPlayerNum: pending.playerNum, source: 'Rush' });
  }
  if (a.wasDefeated && processFigureDefeat) {
    await processFigureDefeat(game, { defeatedPlayerNum: pending.playerNum, figureKey: pending.activatorFigureKey, attackerPlayerNum: oppNum, source: 'Rush' });
  }
  // Refresh board
  if (game.boardId && game.selectedMap && buildBoardMapPayload) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      if (boardChannel) {
        const boardPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(boardPayload);
      }
    } catch { /* ignore */ }
  }
  await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
  clearPendingRushPush(game);
  await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle rush_push_skip_ button: skip Rush push.
 */
export async function handleRushPushSkip(interaction, ctx) {
  const m = interaction.customId.match(/^rush_push_skip_([^_]+)_([^_]+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const { getGame, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  clearPendingRushPush(game);
  await interaction.message.edit({ content: '**Rush** — Push skipped.', components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle shoulder_rush_fig_ button: player picks which adjacent hostile to target.
 */
export async function handleShoulderRushFig(interaction, ctx) {
  const m = interaction.customId.match(/^shoulder_rush_fig_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, msgId, choiceIdxStr] = m;
  const choiceIndex = parseInt(choiceIdxStr, 10);
  const { getGame, dcMessageMeta, dcHealthState, getMapData, logGameAction, buildBoardMapPayload,
    updateDcActionsMessage, getMapAttachmentForSpaces, saveGames, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingShoulderRush;
  if (!pending || pending.msgId !== msgId) {
    await interaction.followUp({ content: 'No pending Shoulder Rush.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activating player can choose.')) return;
  const targetFk = pending.targets?.[choiceIndex];
  if (!targetFk) { await interaction.followUp({ content: 'Invalid target.', ephemeral: true }).catch(discordCatch); return; }
  const oppNum = opponentPlayerNum(pending.playerNum);
  const targetPos = game.figurePositions?.[oppNum]?.[targetFk];
  const targetName = dcNameFromFigureKey(targetFk);
  if (!targetPos) {
    clearPendingShoulderRush(game);
    await interaction.message.edit({ content: '**Shoulder Rush** — Target no longer on board.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Check if target is SMALL
  const effects = getDcEffects();
  const targetDcName = dcNameFromFigureKey(targetFk);
  const targetEff = effects?.[targetDcName];
  const targetKw = (targetEff?.keywords || []).map(k => String(k).toUpperCase());
  const isSmall = !targetKw.includes('LARGE') && !targetKw.includes('MASSIVE');
  if (!isSmall) {
    // Not SMALL: grant free attack targeting this figure, no push
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.forcedAttackTarget = game.forcedAttackTarget || {};
    game.forcedAttackTarget[msgId] = targetFk;
    const logMsg = `**Shoulder Rush** — Targeting **${targetName}** (not SMALL, no push). Attack that figure (free action).`;
    if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
    clearPendingShoulderRush(game);
    await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Target is SMALL: show push space picker (adjacent to target, unoccupied)
  pending.chosenTarget = targetFk;
  const mapId = game.selectedMap?.id;
  const mapSpaces = mapId ? getMapData(mapId) : null;
  const adjToTarget = mapSpaces?.adjacency?.[targetPos] || [];
  const occupied = new Set([
    ...Object.values(game.figurePositions?.[1] || {}),
    ...Object.values(game.figurePositions?.[2] || {}),
  ].filter(Boolean));
  occupied.delete(targetPos); // target vacates its own space
  // Valid spaces: adjacent to target, unoccupied (not including current space — must push away)
  const validSpaces = adjToTarget.filter(s => !occupied.has(s));
  if (validSpaces.length === 0) {
    // No room to push — grant free attack without push
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.forcedAttackTarget = game.forcedAttackTarget || {};
    game.forcedAttackTarget[msgId] = targetFk;
    const logMsg = `**Shoulder Rush** — **${targetName}** is SMALL but no room to push. Attack that figure (free action).`;
    if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
    clearPendingShoulderRush(game);
    await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Show 2-step row→cell space picker via generic space_row_ handler
  const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
  const bMapSpaces = boardState?.mapSpaces || {};
  const srContextKey = `${gameId}_${msgId}`;
  const srHeader = `**Shoulder Rush** — **${targetName}** is SMALL. Push to which space? (You will enter the vacated space.)`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[srContextKey] = {
    validSpaces,
    cellPrefix: `shoulder_rush_space_${gameId}_${msgId}_`,
    mapSpaces: bMapSpaces,
    headerText: srHeader,
  };
  const { rows: srRowBtns } = buildRowPickerButtons(validSpaces, `space_row_${srContextKey}_`);
  const mapAttachment = await getMapAttachmentForSpaces(game, validSpaces);
  const payload = {
    content: `${srHeader}\nChoose a row:`,
    components: srRowBtns.slice(0, 5),
  };
  if (mapAttachment) payload.files = [mapAttachment];
  await interaction.message.edit({ content: '**Shoulder Rush** — Choosing push destination...', components: [] }).catch(discordCatch);
  await interaction.followUp(payload).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle shoulder_rush_space_ button: finalize push + enter vacated space + grant free attack.
 */
export async function handleShoulderRushSpace(interaction, ctx) {
  const m = interaction.customId.match(/^shoulder_rush_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, dcMessageMeta, logGameAction, buildBoardMapPayload,
    updateDcActionsMessage, saveGames, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  const pending = game.pendingShoulderRush;
  if (!pending || pending.msgId !== msgId) {
    await interaction.followUp({ content: 'No pending Shoulder Rush.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activating player can choose.')) return;
  const targetFk = pending.chosenTarget;
  const oppNum = opponentPlayerNum(pending.playerNum);
  const { prevPos } = pushFigure(game, oppNum, targetFk, chosenSpace) || { prevPos: null };
  const targetName = dcNameFromFigureKey(targetFk);
  // Move activator into the vacated space
  if (pending.activatorFigureKey && pending.activatorPos && prevPos) {
    pushFigure(game, pending.playerNum, pending.activatorFigureKey, prevPos);
  }
  // Grant free attack targeting the pushed figure
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[msgId] = true;
  game.forcedAttackTarget = game.forcedAttackTarget || {};
  game.forcedAttackTarget[msgId] = targetFk;
  const logMsg = `**Shoulder Rush** — Pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} → ${chosenSpace.toUpperCase()}. Entered vacated space. Attack that figure (free action).`;
  if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  // Refresh board
  if (game.boardId && game.selectedMap && buildBoardMapPayload) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      if (boardChannel) {
        const boardPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(boardPayload);
      }
    } catch { /* ignore */ }
  }
  await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
  clearPendingShoulderRush(game);
  await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Handle shoulder_rush_skip_ button: skip Shoulder Rush target selection.
 */
export async function handleShoulderRushSkip(interaction, ctx) {
  const m = interaction.customId.match(/^shoulder_rush_skip_([^_]+)_([^_]+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const { getGame, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  clearPendingShoulderRush(game);
  await interaction.message.edit({ content: '**Shoulder Rush** — No target chosen.', components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Handle Overwatch token space placement. */
export async function handleOverwatchSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^overwatch_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  const chosenSpace = String(space).toLowerCase();
  game.overwatchTokenPosition = game.overwatchTokenPosition || {};
  game.overwatchTokenPosition[msgId] = chosenSpace;
  delete game.pendingOverwatchPlacement?.[msgId];
  const meta = dcMessageMeta?.get(msgId);
  const displayName = meta?.displayName || meta?.dcName || 'E-Web Engineer';
  await interaction.message.edit({ content: `**Overwatch** — Token placed at **${chosenSpace.toUpperCase()}**. When a hostile figure enters a space on or adjacent to this token, you may interrupt to attack.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Overwatch** — **${displayName}** placed token at **${chosenSpace.toUpperCase()}**.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}

/** Handle Orbital Bombardment deplete — start space selection for damage. */
export async function handleOrbitalBombardmentDeplete(interaction, ctx) {
  const m = interaction.customId.match(/^ob_deplete_([^_]+)_([^_]+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta, getMapData } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const tokenCount = game.orbitalBombardmentTokens?.[msgId] || 0;
  if (tokenCount <= 0) {
    await interaction.followUp({ content: '**Orbital Bombardment** — No tokens on this card.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Deplete: remove card from attachments
  const meta = dcMessageMeta?.get(msgId);
  const playerNum = meta?.playerNum || 1;
  const attKey = dcAttachmentsKey(playerNum);
  if (game[attKey]?.[msgId]) {
    game[attKey][msgId] = game[attKey][msgId].filter(c => c !== 'Orbital Bombardment');
  }
  delete game.orbitalBombardmentTokens[msgId];
  // Set up multi-space selection
  setPendingOrbitalBombardment(game, { msgId, playerNum, spacesRemaining: tokenCount, spacesChosen: [], gameId });
  // Show space picker (all occupied spaces)
  const mapId = game.selectedMap?.id;
  const ms = getMapData?.(mapId);
  const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
  if (allSpaces.length === 0) {
    await interaction.message.edit({ content: '**Orbital Bombardment** — Map data unavailable. Choose spaces manually.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  const obContextKey = `${gameId}_${msgId}`;
  const obHeader = `**Orbital Bombardment** — Choose space **1 of ${tokenCount}** for bombardment (each figure on a chosen space suffers 2 Damage)`;
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[obContextKey] = {
    validSpaces: allSpaces,
    cellPrefix: `ob_space_${gameId}_${msgId}_`,
    mapSpaces: ms,
    headerText: obHeader,
  };
  const { rows: obRowBtns } = buildRowPickerButtons(allSpaces, `space_row_${obContextKey}_`);
  await interaction.message.edit({
    content: `${obHeader}:\nChoose a row:`,
    components: obRowBtns.slice(0, 5),
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Orbital Bombardment** — **${meta?.displayName || 'DC'}** depleted. Choosing ${tokenCount} spaces for bombardment.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}

/** Handle Orbital Bombardment skip (decline to deplete at activation start). */
export async function handleOrbitalBombardmentSkip(interaction, ctx) {
  const m = interaction.customId.match(/^ob_skip_([^_]+)_([^_]+)$/);
  if (!m) return;
  const { getGame, saveGames } = ctx;
  const game = getGame(m[1]);
  if (!game) return;
  await interaction.message.edit({ content: '**Orbital Bombardment** — Skipped (tokens remain on card).', components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Handle Orbital Bombardment space selection (sequential picker). */
export async function handleOrbitalBombardmentSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^ob_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta, dcHealthState, getMapData, findDcMessageIdForFigure, processFigureDefeat } = ctx;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingOrbitalBombardment) return;
  const pending = game.pendingOrbitalBombardment;
  const chosenSpace = String(space).toLowerCase();
  pending.spacesChosen.push(chosenSpace);

  if (pending.spacesChosen.length < pending.spacesRemaining) {
    // More spaces to pick — re-store pendingSpacePick and show row picker again
    const mapId = game.selectedMap?.id;
    const ms = getMapData?.(mapId);
    const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
    const obSeqContextKey = `${gameId}_${msgId}`;
    const obSeqHeader = `**Orbital Bombardment** — Chosen: ${pending.spacesChosen.map(s => s.toUpperCase()).join(', ')}. Choose space **${pending.spacesChosen.length + 1} of ${pending.spacesRemaining}**`;
    game.pendingSpacePick = game.pendingSpacePick || {};
    game.pendingSpacePick[obSeqContextKey] = {
      validSpaces: allSpaces,
      cellPrefix: `ob_space_${gameId}_${msgId}_`,
      mapSpaces: ms,
      headerText: obSeqHeader,
    };
    const { rows: obSeqRowBtns } = buildRowPickerButtons(allSpaces, `space_row_${obSeqContextKey}_`);
    await interaction.message.edit({
      content: `${obSeqHeader}:\nChoose a row:`,
      components: obSeqRowBtns.slice(0, 5),
    }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  // All spaces chosen — apply 2 damage to each figure on chosen spaces
  const meta = dcMessageMeta?.get(msgId);
  const attackerPlayerNum = pending.playerNum;
  const damageLog = [];
  const defeatedFigures = [];
  for (const sp of pending.spacesChosen) {
    // Check both players' figures
    for (const pn of [1, 2]) {
      const positions = game.figurePositions?.[pn] || {};
      for (const [fk, pos] of Object.entries(positions)) {
        if (!pos || String(pos).toLowerCase() !== sp) continue;
        // Apply 2 damage to this figure
        const fkMsgId = findDcMessageIdForFigure?.(gameId, pn, fk);
        if (!fkMsgId) continue;
        const hs = dcHealthState?.get(fkMsgId) || [];
        const figMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
        const entry = hs[figIdx];
        if (!entry) continue;
        const [cur, max] = entry;
        const newCur = Math.max(0, (cur ?? max) - 2);
        hs[figIdx] = [newCur, max ?? newCur];
        dcHealthState?.set(fkMsgId, hs);
        const dcIds = getDcMessageIds(game, pn);
        const dcList = getDcList(game, pn);
        const idx = (dcIds || []).indexOf(fkMsgId);
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
        const dcName = dcNameFromFigureKey(fk);
        damageLog.push(`**${dcName}** (${cur ?? max} → ${newCur} HP)`);
        if (newCur <= 0) {
          damageLog[damageLog.length - 1] += ' **(defeated)**';
          defeatedFigures.push({ figureKey: fk, playerNum: pn });
        }
      }
    }
  }
  const spacesStr = pending.spacesChosen.map(s => s.toUpperCase()).join(', ');
  const resultStr = damageLog.length > 0 ? `Damage: ${damageLog.join(', ')}` : 'No figures on chosen spaces.';
  await interaction.message.edit({
    content: `**Orbital Bombardment** — Spaces: ${spacesStr}. Each figure suffers 2 Damage.\n${resultStr}`,
    components: [],
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Orbital Bombardment** — Bombarded spaces: ${spacesStr}. ${resultStr}`, { phase: 'ROUND', icon: 'attack' });
  for (const df of defeatedFigures) {
    if (processFigureDefeat) {
      await processFigureDefeat(game, { defeatedPlayerNum: df.playerNum, figureKey: df.figureKey, attackerPlayerNum: opponentPlayerNum(df.playerNum), source: 'Orbital Bombardment' });
    }
  }
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  clearPendingOrbitalBombardment(game);
  saveGames(game.gameId);
}

/** Handle Bomb Drop space selection — apply 2 damage to all figures on/adjacent to chosen space. */
export async function handleBombDropSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^bomb_drop_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta, dcHealthState, getMapData, findDcMessageIdForFigure, processFigureDefeat } = ctx;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingBombDrop?.[msgId]) return;
  cleanupSpacePick(game, `${gameId}_${msgId}`);
  const pending = game.pendingBombDrop[msgId];
  const chosenSpace = String(space).toLowerCase();

  // Discard the explosive
  if (game.figureContraband?.[pending.figureKey]) {
    delete game.figureContraband[pending.figureKey];
  }

  // Find all spaces on/adjacent to chosen space
  const mapId = game.selectedMap?.id;
  const ms = getMapData?.(mapId);
  const adjSpaces = ms?.adjacency?.[chosenSpace] || [];
  const affectedSpaces = new Set([chosenSpace, ...adjSpaces.map(s => String(s).toLowerCase())]);

  // Apply 2 damage to each figure on affected spaces
  const damageLog = [];
  const defeatedFigures = [];
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn] || {};
    for (const [fk, pos] of Object.entries(positions)) {
      if (!pos || !affectedSpaces.has(String(pos).toLowerCase())) continue;
      const fkMsgId = findDcMessageIdForFigure?.(gameId, pn, fk);
      if (!fkMsgId) continue;
      const hs = dcHealthState?.get(fkMsgId) || [];
      const figMatch = fk.match(/-(\d+)-(\d+)$/);
      const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
      const entry = hs[figIdx];
      if (!entry) continue;
      const [cur, max] = entry;
      const newCur = Math.max(0, (cur ?? max) - 2);
      hs[figIdx] = [newCur, max ?? newCur];
      dcHealthState?.set(fkMsgId, hs);
      const dcIds = getDcMessageIds(game, pn);
      const dcList = getDcList(game, pn);
      const idx = (dcIds || []).indexOf(fkMsgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
      const dcName = dcNameFromFigureKey(fk);
      damageLog.push(`**${dcName}** (${cur ?? max} → ${newCur} HP)`);
      if (newCur <= 0) {
        damageLog[damageLog.length - 1] += ' **(defeated)**';
        defeatedFigures.push({ figureKey: fk, playerNum: pn });
      }
    }
  }
  const resultStr = damageLog.length > 0 ? `Damage: ${damageLog.join(', ')}` : 'No figures affected.';
  await interaction.message.edit({
    content: `**Bomb Drop** — Detonated at **${chosenSpace.toUpperCase()}**. Each figure on/adjacent suffers 2 Damage.\n${resultStr}`,
    components: [],
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Bomb Drop** — Detonated at **${chosenSpace.toUpperCase()}**. ${resultStr}`, { phase: 'ROUND', icon: 'attack' });
  for (const df of defeatedFigures) {
    if (processFigureDefeat) {
      await processFigureDefeat(game, { defeatedPlayerNum: df.playerNum, figureKey: df.figureKey, attackerPlayerNum: opponentPlayerNum(df.playerNum), source: 'Bomb Drop' });
    }
  }
  delete game.pendingBombDrop[msgId];
  saveGames(game.gameId);
}
