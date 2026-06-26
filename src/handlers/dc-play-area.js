/**
 * DC Play Area handlers: dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { applyStrain, triggerBleedAfterAction } from './strain-handler.js';
import { runCcPlayTriggers } from './cc-hand.js';
import { openCcCounterWindow } from './cc-pipeline.js';
import { postMoveXPicker } from './move-x-handler.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { truncateLabel, getAttachmentSpecials, chunkButtonsToRows, buildRowPickerButtons, cleanupSpacePick } from '../discord/components.js';
import { cardNameIncludes } from '../game/card-names.js';
import { squadUpgradeOnGroup, effectiveFigureCount } from '../game/squad-upgrades.js';
import { getPlayableReactionCardsForTiming } from '../game/cc-timing.js';
import { bottomLeftCoord, edgeKey, normalizeCoord, getFootprintCells } from '../game/coords.js';
import { countSpaces } from '../game/spatial.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { getBrokenWallEdges, getEffectiveMapSpaces, getImmediateStepSpaces } from '../game/movement.js';
import { isForcedStepByStepForFigure } from '../game/forced-step-movement.js';
import { COLORS } from '../discord/colors.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { refreshHandAndDiscard } from '../engine/message-updaters.js';
import { clearPendingShoulderRush, clearPendingRushPush, setPendingFalseOrders, clearPendingFalseOrders, clearPendingExecutiveOrder, setPendingOrbitalBombardment, clearPendingOrbitalBombardment, clearPendingLure } from '../game/interrupts.js';
import { getConfig } from '../game/figure-config.js';
import { getLoadoutCards, hasMissionFlag, hasChooseASideFlamethrower, getFigureSize } from '../data-loader.js';
import { depleteDc } from '../game/card-state-helpers.js';
import { reduceHp, awardObjectiveVp, applyCondition, filterCondition, dcNameFromFigureKey, isCompanionHostDefeated, figureChoiceLabels, figureHasInTheShadows } from '../game/index.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
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
import { cleanupActivation, consumeActionForCurrentFigure, figureKeyForActivation, figureActionsRemaining, grantActionToFigure, isCompanionOrderPending } from '../game/activation-state.js';
import { isAphraAlive, applyDubiousCounterpartsActionBump } from '../game/dubious-counterparts-helpers.js';

import { getDcEffect, figureHasPriorityTarget } from '../game/dc-helpers.js';
import { figureMpRemaining, grantMovementBank, consumeMovementPoints } from '../game/game-helpers.js';
/** Fury of Kashyyyk grants Reach to all friendly WOOKIEE DCs. */
function _hasFuryReach(game, playerNum, dcKws) {
  if (!dcKws?.some(k => k === 'WOOKIEE')) return false;
  const dcList = getDcList(game, playerNum) || [];
  return dcList.some(dc => dc.dcName === '[Fury of Kashyyyk]');
}

// Drain the deferred side-effects a sync resolveAbility() produced in the one
// canonical order: strain COST → DAMAGE → dealt STRAIN → CONDITIONS (alexanbv
// 2026-06-23). The dcSpecial path never went through applyAbilityResult, so
// without this dcSpecial strain/damage/conditions silently never applied in
// Discord. The handler ctx carries dcHealthState / processFigureDefeat /
// logGameAction / client. Idempotent.
async function _drainAbilityDamage(game, ctx, result) {
  if (!game) return;
  const { applyDeferredAbilityEffects } = await import('../game/damage-pipeline.js');
  await applyDeferredAbilityEffects(game, ctx, result);
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
  // I Make My Own Luck (Han Solo): "Han Solo must activate first this round".
  // The named figure's group must be the player's FIRST activation this round.
  // Modeled on Force Vision above: refuse clicks on any other group while the
  // named group is still alive and has not yet activated; clear the flag once
  // the named group activates, is defeated, or has already activated. Matches
  // the figure name by prefix so DC-name bracket suffixes (e.g. "Han Solo
  // [Scoundrel]") still resolve.
  if (game.firstActivationFigureName && game.firstActivationPlayerNum === playerNum) {
    const _imlName = game.firstActivationFigureName;
    // Match a DC name to the named figure, tolerating bracket suffixes
    // (e.g. "Han Solo [Scoundrel]"). The name is dynamic game state, not a
    // hardcoded DC string.
    const _imlNameMatch = (nm) => {
      const s = String(nm || '');
      return s === _imlName || s.indexOf(_imlName + ' ') === 0;
    };
    const _imlMatchesClicked = _imlNameMatch(dcName);
    if (!_imlMatchesClicked) {
      const _imlActivatedKey = `p${playerNum}ActivatedDcIndices`;
      const _imlActivated = game[_imlActivatedKey] || [];
      const _imlForcedIdx = dcList.findIndex((d) => _imlNameMatch(d.dcName));
      if (_imlForcedIdx >= 0 && !_imlActivated.includes(_imlForcedIdx)) {
        // Forced group still ready — is it alive on the board?
        const _imlFigs = game.figurePositions?.[playerNum] || {};
        const _imlAlive = Object.entries(_imlFigs).some(([fk, pos]) => fk.startsWith(_imlName + '-') && pos);
        if (_imlAlive) {
          await interaction.followUp({ content: `🍀 **I Make My Own Luck** — **${_imlName}** must activate first this round.`, ephemeral: true }).catch(discordCatch);
          return;
        }
        // Named group defeated — restriction discharged.
        game.firstActivationFigureName = null;
        game.firstActivationPlayerNum = null;
      } else {
        // Already activated or not found — clear.
        game.firstActivationFigureName = null;
        game.firstActivationPlayerNum = null;
      }
    } else {
      // Player is activating the named group — restriction satisfied.
      game.firstActivationFigureName = null;
      game.firstActivationPlayerNum = null;
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
    DC_ACTIONS_PER_ACTIVATION,
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
  // Per alexanbv 2026-06-13: actions are strictly per-figure. "Actions
  // performed" = the active figure has spent any of its budget (remaining
  // below the full DC_ACTIONS_PER_ACTIVATION).
  {
    const _uaActFig = actionsData?.selectedFigure ?? 0;
    if (actionsData && figureActionsRemaining(actionsData, _uaActFig) < DC_ACTIONS_PER_ACTIVATION) {
      await interaction.followUp({ content: 'Cannot un-activate — actions have already been performed.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Also block unactivate if MP was spent (e.g. Boba Fett's abilities cost MP, not actions)
  // MP bank is strictly per-figure: check the active figure's sub-bank.
  {
    const _uaFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _uaSub = game.movementBank?.[msgId]?.perFig?.[_uaFig];
    if (_uaSub && figureMpRemaining(game, msgId, _uaFig) < (_uaSub.total ?? 0)) {
      await interaction.followUp({ content: 'Cannot un-activate — movement points have been spent.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  const displayName = meta.displayName || meta.dcName;
  dcExhaustedState.set(msgId, false);
  const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
  if (dcIndex !== -1 && getActivatedDcIndices(game, meta.playerNum)) {
    setActivatedDcIndices(game, meta.playerNum, getActivatedDcIndices(game, meta.playerNum).filter((i) => i !== dcIndex));
  }
  recomputeActivationCounts(game, meta.playerNum);
  await updateActivationsMessage(game, meta.playerNum, client);
  // alexanbv 2026-06-23: keep activation thread (no delete) for traceability
  if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
  if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
  // next-attack bonuses + Vet Instincts: per-figure 2026-05-09 (multifigure-
  // independent-activation rule). Sweep all figureKeys for this DG so an
  // un-activate clears every figure's pending buff cleanly.
  {
    const _uaDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const _uaPrefix = `${meta.dcName}-${_uaDgIdx}-`;
    const _uaFkSweep = Object.keys(game.figurePositions?.[meta.playerNum] || {})
      .filter((k) => k.startsWith(_uaPrefix));
    for (const _ufk of _uaFkSweep) {
      if (game.nextAttacksBonusHits?.[_ufk]) delete game.nextAttacksBonusHits[_ufk];
      if (game.nextAttacksBonusConditions?.[_ufk]) delete game.nextAttacksBonusConditions[_ufk];
      if (game.nextAttackBonusSurgeAbilities?.[_ufk]) delete game.nextAttackBonusSurgeAbilities[_ufk];
      if (game.nextAttackBonusPierce?.[_ufk]) delete game.nextAttackBonusPierce[_ufk];
      if (game.nextAttackBonusAccuracy?.[_ufk]) delete game.nextAttackBonusAccuracy[_ufk];
      if (game.nextAttackReach?.[_ufk]) delete game.nextAttackReach[_ufk];
      if (game.vetInstinctsActiveThisActivation?.[_ufk]) delete game.vetInstinctsActiveThisActivation[_ufk];
    }
  }
  if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
  if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
  if (game.hitAndRunPendingMp?.msgId === msgId) delete game.hitAndRunPendingMp;
  // pendingOverrideAttackDice migrated to figureKey-keyed 2026-05-13.
  // cleanupActivation below wipes via ACTIVATION_FIGKEY_FLAGS for each
  // figure of this DC, so no explicit per-msgId delete is needed here.
  // saberOrbitAttacksRemaining is figureKey-keyed (2026-05-09) and
  // cleared by ACTIVATION_FIGKEY_FLAGS in cleanupActivation; no manual
  // msgId sweep here.
  if (game.pendingMissileSalvo?.[msgId]) delete game.pendingMissileSalvo[msgId];
  if (game.pendingEe3Carbine?.[msgId]) delete game.pendingEe3Carbine[msgId];
  // Wave 4: Stun is NOT auto-cleared at end of activation.
  // Stunned figures must spend 1 action (dc_remove_stun_) to discard Stun (rules: STUNNED L2759-2762).
  // Per user 2026-05-09: preserve game-log records — do NOT delete
  // the DC activation log message at activation end. Just clear the
  // tracker so a future activation can re-post a new log entry.
  if (game.dcActivationLogMessageIds?.[msgId]) {
    delete game.dcActivationLogMessageIds[msgId];
  }
  // Clean all activation-scoped flags (scalars, msgId-keyed, figKey-keyed, playerNum-keyed).
  // The manual deletes above handle Discord-specific cleanup (thread);
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
  const actionsRemaining = figureActionsRemaining(actionsData, actionsData?.selectedFigure ?? 0);
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
  consumeActionForCurrentFigure(actionsData, 1, game, msgId);

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
 * Close an immediate-spend MP window — destruct/alexanbv 2026-06-12.
 * customId format: dc_done_immediate_mp_{msgId}.
 *
 * Out-of-activation MP (Order Hit grant) and special-action MP (Urgency)
 * must be spent at once on movement or MP-cost abilities (Wrist Cord,
 * Super Commando rockets); leftover is lost. The player spends via the
 * normal "Spend Remaining MP" button + the MP-cost ability buttons (both
 * read movementBank), then clicks "Done spending" here to discard the
 * remainder. expireImmediateMp only clears bank entries flagged
 * _mustSpendImmediately, so a normal banked activation is never touched.
 */
export async function handleDcDoneImmediateMp(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, updateDcActionsMessage, logGameAction, saveGames, client } = ctx;
  // customId: dc_done_immediate_mp_{msgId}  OR  ..._{msgId}_f{figureIndex}
  const _raw = parseCustomId(interaction.customId, 'dc_done_immediate_mp_');
  const _figMatch = /^(.+)_f(\d+)$/.exec(_raw);
  const msgId = _figMatch ? _figMatch[1] : _raw;
  const figureIndex = _figMatch ? parseInt(_figMatch[2], 10) : undefined;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the owner of this Play Area can use these actions.')) return;

  const { expireImmediateMp } = await import('../game/game-helpers.js');
  const discarded = expireImmediateMp(game, msgId, figureIndex);
  const displayName = meta.displayName || meta.dcName;
  if (discarded > 0) {
    await logGameAction(game, client, `🦿 **${displayName}** — ${discarded} unspent MP discarded (must-spend-now).`, { phase: 'ROUND', icon: 'move' });
  }
  await updateDcActionsMessage(interaction, game, msgId, meta);
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
  const actionsRemaining = figureActionsRemaining(actionsData, actionsData?.selectedFigure ?? 0);
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
  consumeActionForCurrentFigure(actionsData, 1, game, msgId);

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
    // alexanbv 2026-06-23: keep activation thread (no delete) for traceability
    if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
    if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
    // next-attack bonuses + Vet Instincts: per-figure 2026-05-09 (multifigure-
    // independent-activation rule). Sweep all figureKeys for this DG.
    {
      const _toDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
      const _toPrefix = `${meta.dcName}-${_toDgIdx}-`;
      const _toFkSweep = Object.keys(game.figurePositions?.[meta.playerNum] || {})
        .filter((k) => k.startsWith(_toPrefix));
      for (const _tfk of _toFkSweep) {
        if (game.nextAttacksBonusHits?.[_tfk]) delete game.nextAttacksBonusHits[_tfk];
        if (game.nextAttacksBonusConditions?.[_tfk]) delete game.nextAttacksBonusConditions[_tfk];
        if (game.nextAttackBonusSurgeAbilities?.[_tfk]) delete game.nextAttackBonusSurgeAbilities[_tfk];
        if (game.nextAttackBonusPierce?.[_tfk]) delete game.nextAttackBonusPierce[_tfk];
        if (game.nextAttackBonusAccuracy?.[_tfk]) delete game.nextAttackBonusAccuracy[_tfk];
        if (game.nextAttackReach?.[_tfk]) delete game.nextAttackReach[_tfk];
        if (game.vetInstinctsActiveThisActivation?.[_tfk]) delete game.vetInstinctsActiveThisActivation[_tfk];
      }
    }
    if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
    if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
    // Per user 2026-05-09: preserve game-log records on un-activate
    // (no delete; just drop the tracker reference).
    if (game.dcActivationLogMessageIds?.[msgId]) {
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
  depleteDc(game, msgId, meta.playerNum);
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
  // alexanbv 2026-06-26: for a MULTI-FIGURE group, a figure must be selected
  // before any CC (Urgency etc.) can be played — that figure activates first
  // and completes its whole activation. The UI hides these buttons pre-select;
  // this is the defense-in-depth guard against a stale/raced click. perFigure-
  // Remaining holds one key per EFFECTIVE figure (base + Squad Upgrade), so its
  // key-count is the figure count. Single-figure groups (implicit figure 0) pass.
  {
    const _ad = game.dcActionsData?.[msgId];
    const _figCount = _ad?.perFigureRemaining ? Object.keys(_ad.perFigureRemaining).length : 1;
    if (_figCount > 1 && (_ad?.selectedFigure == null || _ad.selectedFigure >= _figCount)) {
      await interaction.followUp({ content: 'Select which figure is activating first — that figure completes its activation before the next is chosen.', ephemeral: true }).catch(discordCatch);
      return;
    }
    // Host+companion: the activation order must be chosen before any CC is played
    // (alexanbv 2026-06-26). Mirrors the figure-select-first guard above.
    if (isCompanionOrderPending(game, msgId)) {
      await interaction.followUp({ content: 'Choose which activates first (host or companion) before playing a Command Card.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
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
  const abilityId = effectData?.abilityId ?? card;
  hand.splice(hand.indexOf(card), 1);
  game[handKey] = hand;
  if (isCcAttachment(card)) {
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
    // Free-action exemption: some Special-Action CCs cost no action when the
    // playing figure has a given trait (Repair: free for a TECHNICIAN —
    // CSV row 795, alexanbv 2026-06-19).
    const _freeTrait = effectData?.freeActionForTrait;
    let _isFreeAction = false;
    if (_freeTrait) {
      const _playerKw = (getDcEffect(meta.dcName)?.keywords || []).map((k) => String(k).toUpperCase());
      _isFreeAction = _playerKw.includes(String(_freeTrait).toUpperCase());
    }
    // Per alexanbv 2026-06-13: per-figure consume (1 action from active figure).
    if (data && !_isFreeAction) consumeActionForCurrentFigure(data, 1, game, msgId);
  } else if (timingLabel === 'Double Action') {
    const data = game.dcActionsData?.[msgId];
    // Double Action uses both of the active figure's actions.
    if (data) consumeActionForCurrentFigure(data, DC_ACTIONS_PER_ACTIVATION, game, msgId);
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
  // Route through the UNIFIED counter-window (Negate/Comms) — the same path as a
  // hand play and the combat gate (alexanbv 2026-06-17). The card's disposition
  // (attachment vs discard) already happened above; on resolve the effect runs
  // via _resumeScCcEffect (msgId + fromDc are threaded, so PowerToken / choice /
  // space prompts route correctly), on cancel the when-discarded pipeline fires.
  // No more old Negation / Comm-Disruption window.
  await runCcPlayTriggers(game, meta.playerNum, { client, logGameAction, dcMessageMeta, saveGames });
  await openCcCounterWindow(game, game.gameId, { card, cost, playedBy: meta.playerNum, abilityId, msgId, fromDc: true }, ctx, interaction.client);
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
export function buildFigureBlockingCoords(game, playerNum, attackerPos, attackerSize, ctx, opts) {
  if (opts?.marksmanActive || opts?.ignoreBlocking) return null;
  const { getDcEffects, getFigureSize, getFootprintCells, getMapData } = ctx;
  const enemyPlayerNum = playerNum === 1 ? 2 : 1;
  const attackerFpCells = getFootprintCells(attackerPos, attackerSize);
  const attackerFpSet = new Set(attackerFpCells.map(c => String(c).toLowerCase()));
  const blocking = new Set();
  // Camo reciprocal (Mak / Scout Trooper Elite): "You do not block line of
  // sight for [hostile figures 4+ spaces away]." When the attacker is 4+
  // spaces from a hostile Camo figure, that Camo figure's cells are
  // excluded from the blocking set.
  const CAMO_IDS = new Set(['camouflage_mak', 'camouflage_scout_trooper']);
  const _mapId = game.selectedMap?.id;
  const _camoMs = (_mapId && typeof getMapData === 'function') ? getMapData(_mapId) : null;
  for (const [thisPn, poses] of [[playerNum, game.figurePositions?.[playerNum] || {}], [enemyPlayerNum, game.figurePositions?.[enemyPlayerNum] || {}]]) {
    for (const [fk, pos] of Object.entries(poses)) {
      if (!pos || attackerFpSet.has(String(pos).toLowerCase())) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = getDcEffect(fkDcName);
      if (fkEff?.companion === true) continue;
      if ((fkEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) continue;
      // Camo reciprocal: skip hostile Camo figures 4+ from attacker.
      // In the Shadows (CC) rides the same reciprocal: the In-the-Shadows
      // figure does not block LOS for hostiles 4+ away.
      if (thisPn === enemyPlayerNum && _camoMs
          && ((fkEff?.specialAbilityIds || []).some(id => CAMO_IDS.has(id)) || figureHasInTheShadows(game, fk))) {
        const fkPosLc = String(pos).toLowerCase();
        const dist = Math.min(...attackerFpCells.map(ac => countSpaces(_camoMs, ac, fkPosLc)));
        if (dist >= 4) continue;
      }
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
  // Definition: 'Love' (attackOverrideOpts.minRange) — override minRange before target filtering.
  // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
  const _overrideMinRange = game.pendingOverrideAttackDice?.[figureKey]?.minRange;
  if (_overrideMinRange != null && _overrideMinRange > minRange) minRange = _overrideMinRange;
  // Priority Target (LOS-ignoring): "Figures do not block line of sight for this
  // figure's attacks" (CSV docs/combat-spec.csv:347/407/901/961/985). Detection
  // is delegated to the single shared predicate figureHasPriorityTarget() so the
  // keyword is recognized whether it lives in passives, abilityText, or the
  // named-abilities bucket — covering all 5 PT figures. MASSIVE figures also
  // ignore figure blocking. Clawdite Scout form too.
  let attackerIgnoresFigureBlocking =
    figureHasPriorityTarget(game, figureKey) ||
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
  // Marksman CC card: figures do not block LOS for this attack.
  // Two states matter:
  //   - marksmanActive: card was already played (flag set) — figures don't block.
  //   - marksmanInHand: card is in the player's hand and could be played — also
  //     compute the no-figures-block LOS so figures-out-of-LOS can be offered
  //     as Marksman targets (button labeled [Marksman]; clicking auto-plays
  //     the card before resolving the attack). Ranged-only per card text.
  const marksmanActive = game.nextAttackIgnoreFigureLOS?.[figureKey];
  // Note: nextAttackIgnoreFigureLOS is consumed by handleDcAttackTarget on the
  // actual attack, not here at target-render time. Re-rendering must not
  // wipe it. (The previous delete here is a known bug; deferring its fix to
  // the attack-target click handler.)
  const _ccHand = game[ccHandKey(playerNum)] || [];
  const marksmanInHand = !marksmanActive
    && (stats?.attack?.type === 'range' || (game.pendingOverrideAttackDice?.[figureKey]?.type === 'range'))
    && cardNameIncludes(_ccHand, 'Marksman');
  const allFigureBlockingCoords = buildFigureBlockingCoords(game, playerNum, attackerPos, attackerSize, ctx, {
    marksmanActive,
    ignoreBlocking: attackerIgnoresFigureBlocking,
  });
  // Alternate LOS coords when Marksman would be played: figures don't block.
  const marksmanLOSCoords = marksmanInHand
    ? buildFigureBlockingCoords(game, playerNum, attackerPos, attackerSize, ctx, { marksmanActive: true })
    : null;
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
      const _insigEff = getDcEffect(_insigDcName);
      if ((_insigEff?.specialAbilityIds || []).includes('insignificant_dio')) {
        const _insigFriendlyPoses = game.figurePositions?.[enemyPlayerNum] || {};
        const _insigHasFriendly = Object.entries(_insigFriendlyPoses).some(([ffk, fpos]) =>
          ffk !== k && fpos && String(fpos).toLowerCase() === String(coord).toLowerCase()
        );
        if (_insigHasFriendly) continue;
      }
    }
    // Vanish does NOT prevent targeting (alexanbv 2026-06-19): a Vanished figure
    // is still a legal target (the player may want to attack it anyway). The
    // immunity blocks the Damage/conditions in the pipelines, not the target
    // list. (This is unlike Blend In, which affects targeting.)
    const dcName = dcNameFromFigureKey(k);
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    const cells = getFootprintCells(coord, size);
    const dist = Math.min(...attackerFpCells.flatMap(ac => cells.map(tc => countSpaces(ms, ac, tc, closedDoorEdges))));
    if (dist < minRange || dist > effectiveMaxRange) continue;
    // I Must Go Alone (alexanbv 2026-06-20): shields ONLY the one figure that
    // played it (figureKey), not every friendly figure. Filter beyond `spaces`
    // only when this target IS that figure.
    const iMustGoAlone = game.roundDefenderCannotBeTargetedUnlessWithinSpaces;
    if (iMustGoAlone?.playerNum === enemyPlayerNum
        && (!iMustGoAlone.figureKey || iMustGoAlone.figureKey === k)
        && dist > iMustGoAlone.spaces) continue;

    // In the Shadows (CC) — hostile figures 4+ spaces away have no LOS to this
    // figure, so it isn't a legal target for them. (alexanbv 2026-06-20.)
    if (figureHasInTheShadows(game, k) && dist >= 4) continue;

    // Blend In (K-2SO): the attached figure cannot be the target of an attack.
    if (game.blendInUntargetable?.[k]) continue;
    // Hide in Plain Sight: untargetable until end of round.
    if (game.untargetableUntilRoundEnd?.[k]) continue;
    let losCoords = allFigureBlockingCoords;
    if (allFigureBlockingCoords) {
      const targetEff = getDcEffect(dcName);
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
    // Marksman-in-hand path: also probe LOS with figures NOT blocking, so
    // figures-out-of-LOS can still be offered as Marksman targets. Walls /
    // doors / shields still block (Marksman only ignores figure-blocking).
    let losWithMarksman = false;
    if (marksmanInHand && !los) {
      let losCoordsMM = marksmanLOSCoords;
      if (losCoordsMM) {
        const targetFpMM = new Set(cells.map(c => String(c).toLowerCase()));
        losCoordsMM = new Set([...losCoordsMM].filter(c => !targetFpMM.has(c)));
      }
      mmOuter: for (const ac of attackerFpCells) {
        for (const tc of cells) {
          if (hasLineOfSight(ac, tc, effectiveMs, losCoordsMM)) { losWithMarksman = true; break mmOuter; }
        }
      }
    }
    // Fire Mission: LOS from any figure in the group (not just acting figure)
    if (!los && game.fireMissionActive?.[figureKey]) {
      const _fmDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _fmFigCount = getDcStats(meta.dcName)?.figures ?? 1;
      const _fmSuAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _fmTotalFigs = effectiveFigureCount(_fmFigCount, _fmSuAtts);
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
    // Sniper Configuration: "draw line of sight from any FRIENDLY figure" (range
    // still measured from the attacker — dist is unchanged). Mirrors Fire Mission
    // above, but iterates ALL friendly figures, not just the acting group.
    if (!los && game.sniperConfigLosAnyFriendly?.[figureKey]) {
      scOuter: for (const [otherFk, otherPos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (!otherPos || otherFk === figureKey) continue;
        const otherSize = game.figureOrientations?.[otherFk] || getFigureSize(dcNameFromFigureKey(otherFk));
        const otherFpCells = getFootprintCells(otherPos, otherSize);
        for (const oac of otherFpCells) {
          for (const tc of cells) {
            if (hasLineOfSight(oac, tc, effectiveMs, losCoords)) { los = true; break scOuter; }
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
    targets.push({ figureKey: k, coord, label, hasLOS: los, dist, droidArmLOS, requiresMarksman: !los && losWithMarksman });
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
  // Damageable-object targets (Slice 4, alexanbv 2026-05-10): iterate
  // game.objectMeta for entries with targetable:true. Replaces the
  // legacy cratePositions loop. The npcType='crate'/crateOrigCoord
  // target shape is retained for resolver back-compat (the resolver
  // path was migrated in Slice 3 to applyDamageToObject keyed on
  // `crate-${origCoord}`). Future generic targetable objects can be
  // added by mission rules without code changes.
  if (game.objectMeta && typeof game.objectMeta === 'object') {
    for (const [objId, meta] of Object.entries(game.objectMeta)) {
      if (!meta?.targetable) continue;
      const hp = (game.objectHealth?.[objId] || [0])[0] ?? 0;
      if (hp <= 0) continue;
      const objPos = game.objectPositions?.[objId];
      if (!objPos) continue;
      const coord = String(objPos).toLowerCase();
      const dist = Math.min(...attackerFpCells.map(ac => countSpaces(ms, ac, coord, closedDoorEdges)));
      if (dist < minRange || dist > effectiveMaxRange) continue;
      const los = attackerFpCells.some(ac => hasLineOfSight(ac, coord, effectiveMs, allFigureBlockingCoords));
      const maxHp = (game.objectHealth?.[objId] || [0, 0])[1] ?? 0;
      // Crate id shape: crate-{origCoord}. Other targetable objects can
      // use a generic id; resolver checks crateOrigCoord truthiness.
      const crateOrigCoord = objId.startsWith('crate-') ? objId.slice('crate-'.length) : null;
      targets.push({
        figureKey: `npc_crate_${crateOrigCoord || objId}`,
        coord,
        label: `${meta.name || objId} (${hp}/${maxHp} HP)`,
        hasLOS: los,
        dist,
        isNpc: true,
        npcType: 'crate',
        crateOrigCoord,
        objectId: objId,
      });
    }
  }
  // NOTE: Priority Target is an ATTACKER-side LOS-bypass keyword ("Figures do not
  // block line of sight for THIS figure's attacks", CSV docs/combat-spec.csv:901/961/985)
  // — NOT a defender-side taunt. The old "Priority Target intercept" here wrongly
  // forced the attacker to target PT-passive enemy figures (a taunt), the opposite
  // of the card. It has been removed; the keyword is now honored on the attacker
  // side via figureHasPriorityTarget() in the figure-blocking bypass above.
  // Autofire chain attack: restrict targets to within 3 spaces of original target
  // Per alexanbv 2026-05-13: per-figureKey.
  if (game.autofireChainTargetSpace?.[figureKey]) {
    const _chainSpace = game.autofireChainTargetSpace[figureKey];
    const _chainFiltered = targets.filter(t => countSpaces(ms, _chainSpace, t.coord, closedDoorEdges) <= 3);
    if (_chainFiltered.length > 0) targets.splice(0, targets.length, ..._chainFiltered);
    delete game.autofireChainTargetSpace[figureKey];
  }
  // Barrage (CT-1701) second attack: restrict targets to within 3 spaces of first target.
  // Per-figureKey 2026-05-13 (alexanbv).
  if (game.barrageTargetSpace?.[figureKey]) {
    const _barrageSpace = game.barrageTargetSpace[figureKey];
    const _barrageFiltered = targets.filter(t => countSpaces(ms, _barrageSpace, t.coord, closedDoorEdges) <= 3);
    if (_barrageFiltered.length > 0) targets.splice(0, targets.length, ..._barrageFiltered);
    delete game.barrageTargetSpace[figureKey];
  }
  // Arcing Shot: validate each target — must be adjacent to an empty space in attacker's LOS
  if (game.arcingShotActive?.[figureKey] || game.arcingShotActiveScalar) {
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
  const _arcActive = game.arcingShotActive?.[figureKey] || game.arcingShotActiveScalar;
  const targetBtns = targets.map((t, targetIndex) => {
    const noLOS = t.hasLOS === false;
    const marksmanTag = t.requiresMarksman ? ' [Marksman]' : '';
    const daTag = t.droidArmLOS ? ' [Droid Arm]' : '';
    const arcTag = (_arcActive && t.arcingShotValid === false) ? ' [No Arc]' : '';
    // Marksman-only targets are selectable: clicking will auto-play Marksman
    // before resolving the attack (handleDcAttackTarget consumes the card).
    // Arcing Shot: a target with no direct LOS is selectable when it is adjacent
    // to an empty space in the attacker's LOS (arcingShotValid) — that is the
    // whole point of the card (alexanbv 2026-06-19).
    const selectable = !noLOS || t.requiresMarksman || (_arcActive && t.arcingShotValid === true);
    return new ButtonBuilder()
      .setCustomId(`attack_target_${msgId}_${figureIndex}_${targetIndex}`)
      .setLabel(`${t.label} (${t.coord.toUpperCase()})${noLOS ? (t.requiresMarksman ? marksmanTag : ' [No LOS]') : daTag}${arcTag}`.slice(0, 80))
      .setStyle(t.requiresMarksman ? ButtonStyle.Primary : (noLOS ? ButtonStyle.Secondary : (arcTag ? ButtonStyle.Secondary : ButtonStyle.Danger)))
      .setDisabled(!selectable);
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
 *   - game.heroicUsedThisActivation[figureKey] = true (used flag — disables the
 *     button on subsequent renders)
 *   - game.freeAttackBonusPending[figureKey] = true (zero-action cost on the
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
  const eff = getDcEffect(meta.dcName);
  if (!(eff?.specialAbilityIds || []).includes('heroic')) {
    await interaction.followUp({ content: 'This figure does not have Heroic.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Once-per-activation gate. Per IACP rule clarification 2026-05-09:
  // "once per activation" applies to each FIGURE'S activation in a
  // multifigure group, not the group as a whole. Key by figureKey.
  const _heroicDgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const _heroicDgIdx = _heroicDgMatch ? _heroicDgMatch[1] : '1';
  const _heroicFigureKey = `${meta.dcName}-${_heroicDgIdx}-${figureIndexStr}`;
  if (game.heroicUsedThisActivation?.[_heroicFigureKey]) {
    await interaction.followUp({ content: '**Heroic** has already been used this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Mark used + grant the zero-action follow-up Attack.
  game.heroicUsedThisActivation = game.heroicUsedThisActivation || {};
  game.heroicUsedThisActivation[_heroicFigureKey] = true;
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[_heroicFigureKey] = true;

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
 * Pick a figure to act with in a multi-figure group activation.
 * Per destruct 2026-05-08: each figure is its own separate activation.
 * Selecting a new figure resets BOTH the action bank and the MP bank
 * so the figure starts fresh: 2 actions + Speed-MP granted on its
 * next Move click. Start-of-Activation effects fire once per figure
 * (figureSoaFired tracks per-index).
 *
 * customId: `dc_fig_pick_<msgId>_f<figureIndex>`
 */
export async function handleDcFigPick(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, updateDcActionsMessage, saveGames, client } = ctx;
  const m = interaction.customId.match(/^dc_fig_pick_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid figure-pick button.', ephemeral: true }).catch(discordCatch);
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
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can pick a figure.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const figIdx = parseInt(figureIndexStr, 10);
  await interaction.deferUpdate().catch(discordCatch);
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = game.dcActionsData[msgId] || {};
  const _ad = game.dcActionsData[msgId];
  // Refuse picking a locked figure
  if (_ad.figureLocked?.[figIdx]) return;
  // Refuse picking when an activation lock is held by a DIFFERENT msgId
  // (the paired host/companion is still mid-activation).
  if (game.activationLockKey && !game.activationLockKey.startsWith(`${msgId}_f`)) {
    await interaction.followUp({ content: 'The paired figure must finish its activation first.', ephemeral: true }).catch(discordCatch);
    return;
  }
  _ad.selectedFigure = figIdx;
  // Picker is BINDING (alexanbv 2026-05-10): acquire the unified
  // activation lock on this exact figure so other figures' rows + the
  // paired companion/host are gated until this figure ends.
  game.activationLockKey = `${msgId}_f${figIdx}`;
  // Per-figure separate activation (alexanbv 2026-05-09 + 2026-05-13:
  // multifigure groups behave the same as host+companion; nothing
  // carries between figures). specialsUsedByFig is per-figure so no wipe
  // needed across figure-switch — figure B's specials list is empty until
  // B uses one.
  // Per alexanbv 2026-06-13: actions are STRICTLY per-figure. There is no
  // top-level _ad.remaining mirror to sync on figure-switch anymore — each
  // figure's budget lives in _ad.perFigureRemaining[figIdx] and is read via
  // figureActionsRemaining.
  // Per alexanbv 2026-06-13: MP bank is STRICTLY per-figure. There is no
  // top-level remaining/total mirror to sync on figure-switch anymore —
  // the UI reads each figure's MP directly from perFig[figIdx] (via
  // figureMpRemaining). Each figure's MP persists across switches in its
  // own sub-bank, so nothing needs to be copied here.
  // Wipe msgId-keyed per-activation flags for this msgId so they don't
  // leak from figure A's activation into figure B's. Excludes group-level
  // state (perFigureRemaining, figureLocked, figureSoaFired/figureEoaFired,
  // companionActivatedBefore, dcActivationLogMessageIds) and pending
  // interrupt-state buckets which span figures by design.
  // Per alexanbv 2026-05-13: this block previously wiped 20+ msgId-
  // keyed per-activation flags on figure-switch. All but 2 have since
  // migrated to ACTIVATION_FIGKEY_FLAGS / PLAYERNUM_FLAGS / ROUND_*,
  // so each new figure starts with figure-scoped state by construction
  // (msgId-delete on figureKey-keyed maps is a no-op). The remaining
  // genuinely msgId-keyed flags (falseOrdersAttackTargets,
  // falseOrdersUpgrade) span figures by design and shouldn't be wiped
  // on figure-switch. Block removed.
  // Per destruct 2026-05-07: each figure has individual SoA. Fire
  // figure-scoped start-of-activation effects once per figure.
  _ad.figureSoaFired = _ad.figureSoaFired || {};
  if (!_ad.figureSoaFired[figIdx]) {
    try {
      const { enumerateActivatorSoaDescriptors, startSoaResolution, describeChooserPrompt } = await import('../game/soa-orchestrator.js');
      const _soaDesc = enumerateActivatorSoaDescriptors(game, {
        dcName: meta.dcName,
        playerNum: meta.playerNum,
        msgId,
        figureIndex: figIdx,
      });
      if (_soaDesc.length > 0) {
        const initPN = (game.initiative ?? game.firstPlayer ?? meta.playerNum);
        const _started = startSoaResolution(game, _soaDesc, initPN, { activatorPlayerNum: meta.playerNum, activatorMsgId: msgId });
        if (_started) {
          const _soaShape = describeChooserPrompt(game.pendingSoaResolution, game.gameId);
          if (_soaShape) {
            const _soaButtons = _soaShape.choices.map((c) => {
              const style = c.descId === '__skip_all__' ? ButtonStyle.Secondary : ButtonStyle.Primary;
              return new ButtonBuilder().setCustomId(c.customId).setLabel(c.label).setStyle(style);
            });
            const _soaRows = chunkButtonsToRows(_soaButtons);
            const _threadId = _ad.threadId;
            if (_threadId) {
              try {
                const _thread = await client.channels.fetch(_threadId);
                if (_thread) {
                  await _thread.send({
                    content: `\u{2728} **Start-of-Activation** (figure ${figIdx + 1}) — Player ${_soaShape.ownerPlayerNum}: choose which effect to resolve next, or skip all remaining.`,
                    components: _soaRows,
                  }).catch(discordCatch);
                }
              } catch { /* non-fatal */ }
            }
          }
        }
      }
    } catch { /* non-fatal: SoA prompt failure leaves figure usable */ }
    _ad.figureSoaFired[figIdx] = true;
  }
  if (saveGames) saveGames(game.gameId);
  await updateDcActionsMessage(game, msgId, client);
}

/**
 * End Figure: voluntarily forfeit the current figure's remaining
 * actions and lock it so the next figure of a multi-figure group can
 * begin. Per destruct 2026-05-07: "complete one figure before the
 * other" — once a figure ends its turn it cannot return.
 *
 * customId: `dc_end_figure_<msgId>_f<figureIndex>`
 */
export async function handleDcEndFigure(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, updateDcActionsMessage, client } = ctx;
  const m = interaction.customId.match(/^dc_end_figure_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid End Figure button.', ephemeral: true }).catch(discordCatch);
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
  const figIdx = parseInt(figureIndexStr, 10);
  const actionsData = game.dcActionsData?.[msgId];
  if (!actionsData) {
    await interaction.followUp({ content: 'No active activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Forfeit this figure's remaining actions: zero its per-figure budget,
  // lock the figure, clear selection. Per alexanbv 2026-06-13 actions are
  // strictly per-figure — there is no group total to decrement; zeroing
  // the figure's own budget is the whole forfeit.
  actionsData.perFigureRemaining = actionsData.perFigureRemaining || {};
  actionsData.perFigureRemaining[figIdx] = 0;
  actionsData.figureLocked = actionsData.figureLocked || {};
  actionsData.figureLocked[figIdx] = true;
  actionsData.selectedFigure = null;
  // Unified activation lock release: forfeiting this figure releases the
  // lock so the next figure pick (or paired companion) can acquire on
  // its first action.
  if (game.activationLockKey === `${msgId}_f${figIdx}`) delete game.activationLockKey;
  // Per destruct 2026-05-07: each figure has individual EoA. Fire EoA
  // for the just-locked figure scoped to that figureIndex (single-
  // figure groups continue to fire group-wide EoA via
  // handleDcEndActivation; multi-figure groups fire here per figure
  // and skip the whole-group EoA at the end).
  actionsData.figureEoaFired = actionsData.figureEoaFired || {};
  if (!actionsData.figureEoaFired[figIdx]) {
    try {
      const { applyEndOfActivationEffects } = await import('../engine/activation-effects.js');
      const { applied: _figEoa } = applyEndOfActivationEffects(game, {
        dcName: meta.dcName,
        playerNum: meta.playerNum,
        displayName: meta.displayName || meta.dcName,
        msgId,
        figureIndex: figIdx,
      });
      if (Array.isArray(_figEoa) && ctx.logGameAction) {
        for (const eff of _figEoa) {
          await ctx.logGameAction(game, client, eff.message, { phase: 'ROUND', icon: 'activate' }).catch(() => {});
        }
      }
    } catch { /* non-fatal */ }
    actionsData.figureEoaFired[figIdx] = true;
  }
  await interaction.deferUpdate().catch(discordCatch);
  await updateDcActionsMessage(game, msgId, client);
  if (ctx.saveGames) ctx.saveGames(game.gameId);
}

/**
 * [Wookiee Avenger] free Slam — anytime-during-activation button.
 * Per alexanbv 2026-05-10: card text says "Once during your activation,
 * you may use Slam without spending an action." The SoA picker was
 * wrong; this handler fires when the player clicks the action-row
 * button. Posts the adjacent-hostile picker using the existing
 * `act_passive_..._wookslam_*` flow, which marks `wookieeAvengerSlamUsed[msgId]`
 * + Slam specialsUsed + specialActionUsedThisActivation + rolls 1 red die.
 */
export async function handleDcWaSlam(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, logGameAction, client, saveGames, getMapData: getMs, getDcEffects } = ctx;
  const m = interaction.customId.match(/^dc_wa_slam_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid Wookiee Avenger Slam button.', ephemeral: true }).catch(discordCatch);
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
  const figIdx = parseInt(figureIndexStr, 10);
  const playerNum = meta.playerNum;
  // Verify upgrade still attached + not used this activation
  const _waUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (!cardNameIncludes(_waUpgrades, 'Wookiee Avenger')) {
    await interaction.followUp({ content: 'Wookiee Avenger is not attached.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Per alexanbv 2026-05-13: wookieeAvengerSlamUsed is per-figureKey.
  // Derive the slam-attempting figure's key from the click params.
  const _waDgMatch_early = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const _waSelfFk_early = `${meta.dcName}-${_waDgMatch_early ? _waDgMatch_early[1] : '1'}-${figIdx}`;
  if (game.wookieeAvengerSlamUsed?.[_waSelfFk_early]) {
    await interaction.followUp({ content: 'Free Slam was already used this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);
  // Activation lock: refuse if lock is held by another (figure or msgId).
  const _waLockKey = `${msgId}_f${figIdx}`;
  if (game.activationLockKey && game.activationLockKey !== _waLockKey) {
    await interaction.followUp({ content: 'Another figure is mid-activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _waDgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const _waDgIdx = _waDgMatch ? _waDgMatch[1] : '1';
  const _waSelfFk = `${meta.dcName}-${_waDgIdx}-${figIdx}`;
  const _waSelfPos = game.figurePositions?.[playerNum]?.[_waSelfFk];
  if (!_waSelfPos) {
    await interaction.followUp({ content: 'Cannot locate Chewbacca on the board.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _waMapId = game.selectedMap?.id;
  const _waMs = _waMapId ? (typeof getMs === 'function' ? getMs(_waMapId) : null) : null;
  if (!_waMs) {
    await interaction.followUp({ content: 'Map data unavailable for Wookiee Avenger Slam.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _waAdj = (_waMs.adjacency?.[String(_waSelfPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
  const _waEnemyNum = playerNum === 1 ? 2 : 1;
  const _waHostiles = Object.entries(game.figurePositions?.[_waEnemyNum] || {})
    .filter(([, fp]) => fp && _waAdj.includes(String(fp).toLowerCase()));
  if (_waHostiles.length === 0) {
    await interaction.followUp({ content: '**Wookiee Avenger** — no adjacent hostile to Slam right now.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Post the adjacent-hostile picker. The existing act_passive wookslam
  // handler does the die roll, damage, push prompt, and marks the
  // wookieeAvengerSlamUsed[msgId] flag on resolution.
  const gameId = game.gameId;
  const _waSlice = _waHostiles.slice(0, 4);
  const _waLabels = figureChoiceLabels(_waSlice.map(([fk]) => fk));
  const btns = _waSlice.map(([fk], i) =>
    new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslam_${fk}`).setLabel(_waLabels[i]).setStyle(ButtonStyle.Primary)
  );
  btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslam_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  const threadId = game.dcActionsData?.[msgId]?.threadId;
  if (threadId) {
    const thread = await fetchGameChannel(client, threadId);
    if (thread) {
      await withDiscordRetry(() => thread.send({ content: `**Wookiee Avenger** — **${meta.dcName}** may use **Slam** without an action. Choose an adjacent hostile figure:`, components: [new ActionRowBuilder().addComponents(btns)] }));
    }
  } else if (logGameAction) {
    await logGameAction(game, client, `**Wookiee Avenger** — **${meta.dcName}** may use **Slam** without an action. Choose an adjacent hostile figure:`, { components: [new ActionRowBuilder().addComponents(btns)], phase: 'ACTIVATION', icon: 'attack', interrupt: true });
  }
  if (saveGames) saveGames(game.gameId);
}

/**
 * Bo-Rifle Staff Strike (Zeb Orrelios) — sibling Primary/blue Attack button.
 * Per destruct 2026-05-07: parity with Luke Heroic. Free attack (no action),
 * once per activation, dice replaced with [Red, Red] melee.
 *
 * Sets:
 *   - game.boRifleStaffUsedThisActivation[figureKey] = true (gate)
 *   - game.freeAttackBonusPending[figureKey] = true (zero-action follow-up)
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
  const eff = getDcEffect(meta.dcName);
  if (!(eff?.specialAbilityIds || []).includes('bo_rifle_staff_strike')) {
    await interaction.followUp({ content: 'This figure does not have Bo-Rifle Staff Strike.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Once-per-figure-activation gate (per IACP rule clarification
  // 2026-05-09): keyed by figureKey, not msgId, so other figures in
  // the same multifigure group can use Bo-Rifle Staff Strike in their
  // own activations.
  const _brDgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const _brDgIdx = _brDgMatch ? _brDgMatch[1] : '1';
  const _brFigureKey = `${meta.dcName}-${_brDgIdx}-${figureIndexStr}`;
  if (game.boRifleStaffUsedThisActivation?.[_brFigureKey]) {
    await interaction.followUp({ content: '**Bo-Rifle Staff Strike** has already been used this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  game.boRifleStaffUsedThisActivation = game.boRifleStaffUsedThisActivation || {};
  game.boRifleStaffUsedThisActivation[_brFigureKey] = true;
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[_brFigureKey] = true;
  // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
  game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
  game.pendingOverrideAttackDice[_brFigureKey] = { type: 'melee', dice: ['red', 'red'], pierce: 0, bonusAccuracy: 0 };
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

/**
 * Out-of-activation free Special Action interrupt (Jundland Terror, and any
 * future "interrupt to perform a Special Action" effect).
 *
 * customId: jt_special_<gameId>_<msgId>_<specialIdx>
 *
 * Resolves the chosen NATIVE Special Action for the grantee figure NOW, at 0
 * action cost, WITHOUT an active activation. Rather than re-implement the
 * dozens of special-resolution branches, it synthesizes a minimal activation
 * context — game.dcActionsData[msgId] (selectedFigure = the figure's index,
 * no threadId so updateDcActionsMessage no-ops) + a freeSpecialActionPending
 * marker (which handleDcAction already treats as a 0-cost, marker-consuming
 * special) — then re-dispatches dc_special_<idx>_<msgId> into the standard
 * handleDcAction special pipeline (mirrors handleGrantedAttack). Attack-specials
 * (Tusken Cycler), multi-target picks (Trample), pounce/space-pick, etc. all
 * flow through the existing pipeline. The marker is consumed by handleDcAction
 * after the special resolves, so it never lingers onto a real next activation.
 */
export async function handleJtSpecial(interaction, ctx) {
  // customId: jt_special_<gameId>_<msgId>_f<figIdx>_<specialIdx>
  const m = interaction.customId.match(/^jt_special_(.+)_f(\d+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid free-special button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // suffix = <gameId>_<msgId>; gameIds don't contain `_`, so split on the first.
  const suffix = m[1];
  const _jtFigIdx = parseInt(m[2], 10);
  const specialIdx = parseInt(m[3], 10);
  const _u = suffix.indexOf('_');
  if (_u < 0) {
    await interaction.followUp({ content: 'Invalid free-special button (malformed id).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = suffix.slice(0, _u);
  const msgId = suffix.slice(_u + 1);
  const { getGame, dcMessageMeta } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // The chosen figure index is threaded in the customId (Tusken Raiders deploy
  // as a multi-figure group, so the special must run as the EXACT figure picked
  // in Phase 1 — not group-figure 0).
  const figIdx = _jtFigIdx;
  const _dgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKey = `${meta.dcName}-${_dgIdx}-${figIdx}`;
  // Synthesize a minimal, out-of-activation activation context so the standard
  // special pipeline can run. No threadId → updateDcActionsMessage no-ops.
  game.dcActionsData = game.dcActionsData || {};
  if (!game.dcActionsData[msgId]) {
    game.dcActionsData[msgId] = { selectedFigure: figIdx };
  } else {
    game.dcActionsData[msgId].selectedFigure = figIdx;
  }
  // 0-cost marker: handleDcAction reads freeSpecialActionPending to set the
  // effective action cost to 0 and consumes it after the special resolves.
  game.freeSpecialActionPending = game.freeSpecialActionPending || {};
  game.freeSpecialActionPending[figureKey] = { from: 'Jundland Terror' };
  // Re-dispatch as a normal native special action click.
  const _newId = `dc_special_${specialIdx}_${msgId}`;
  try {
    Object.defineProperty(interaction, 'customId', { value: _newId, writable: true, configurable: true });
  } catch {
    interaction.customId = _newId;
  }
  return handleDcAction(interaction, ctx, 'dc_special_');
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
  // Choose a Side (IMPERIAL): the Gar Saxon's Flamethrower special is injected
  // LAST in the render path (after attachment specials + Bomb Drop +
  // Experimental Weapons). Detect it here by eligibility so the index/dispatch
  // stays aligned with the render-side injection (both gated by the shared
  // hasChooseASideFlamethrower helper). When matched, action is set to the
  // library label and the abilityId override below routes to the existing
  // gar_saxon_flamethrower resolver with the eligible figure as activator.
  let _isChooseASideFlamethrower = false;
  if (buttonKey === 'dc_special_' && specialIdx >= _baseSpecialCount) {
    const _casSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _casDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _casFk = `${meta.dcName}-${_casDgIdx}-${_casSelFig}`;
    if (hasChooseASideFlamethrower(game, meta.playerNum, _casFk)) {
      // Count all injected specials that precede the flamethrower (which is
      // always appended last) to locate its slot exactly.
      const _suAtts2 = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _inj2 = getAttachmentSpecials(_suAtts2, game, msgId);
      let _precount = _inj2.names.length;
      if (game?.selectedMission?.name === 'Bomb Drop' && game.figureContraband?.[_casFk]) _precount += 1;
      if (game?.selectedMission?.name === 'Experimental Weapons') {
        const _wpActs = game?.selectedMission?.rules?.persistent?.weaponPrototypeCarrierActions || [];
        if (game.figureContraband?.[_casFk]) _precount += _wpActs.filter((a) => a?.label).length;
      }
      if (specialIdx === _baseSpecialCount + _precount) {
        _isChooseASideFlamethrower = true;
        action = "Gar Saxon's Flamethrower";
        _effectiveActionCost = 1;
      }
    }
  }
  if (_isChooseASideFlamethrower) {
    // resolved above; skip the attachment-name resolution
  } else if (buttonKey === 'dc_special_' && specialIdx >= _baseSpecialCount) {
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
  // Jundland Terror free Special Action (CSV row 706): if the activating figure
  // has the freeSpecialActionPending marker and this is one of its NATIVE
  // specials, charge 0 actions. Marker is consumed after the special resolves
  // (see below). Mirrors the Choose-a-Side flamethrower 0-cost handling.
  let _isJundlandFreeSpecial = false;
  if (buttonKey === 'dc_special_' && specialIdx < _baseSpecialCount) {
    const _jtSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _jtDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _jtFk = `${meta.dcName}-${_jtDgIdx}-${_jtSelFig}`;
    if (game.freeSpecialActionPending?.[_jtFk]) {
      _isJundlandFreeSpecial = true;
      _effectiveActionCost = 0;
    }
  }
  const ownerId = getPlayerId(game, meta.playerNum);
  const actionsData = game.dcActionsData?.[msgId];
  const actionsRemaining = figureActionsRemaining(actionsData, actionsData?.selectedFigure ?? 0);
  // Per alexanbv 2026-05-13: Pounce / Fell Swoop / Pummel / IR multi-
  // attack grants are figureKey-keyed (default per-figure scope unless
  // card text says "group"). Derive the current activating figure's
  // figureKey from the action data.
  const _curActFigKey = figureKeyForActivation(game, msgId);
  const hasFellSwoopFreeAttack = action === 'Attack' && !!game.fellSwoopFreeAttack?.[_curActFigKey];
  const hasPummelFreeAttack = action === 'Attack' && !!(game.pummelTwoAttacksThisActivation?.[_curActFigKey]);
  const isMpBasedSpecial = buttonKey === 'dc_special_' && _effectiveActionCost === 0;
  if (actionsRemaining <= 0 && action !== 'SpendMp' && !hasFellSwoopFreeAttack && !hasPummelFreeAttack && !isMpBasedSpecial) {
    await interaction.followUp({ content: 'No actions remaining this activation (2 per DC).', ephemeral: true }).catch(discordCatch);
    return;
  }
  // C75 — To the Limit: extra action cannot be Move
  if (action === 'Move' && game.activationExtraActionThenStun?.[_curActFigKey]) {
    await interaction.followUp({ content: '**To the Limit** — the extra action cannot be a Move. Choose Attack, Special, or Interact.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (buttonKey === 'dc_special_') {
    const parts = splitCustomId(interaction.customId, 'dc_special_');
    const specialIdx = parseInt(parts[0], 10);
    // Per alexanbv 2026-05-13: specialsUsed is per-figure. Each figure
    // in a multifigure group can use the same special action once on
    // its own turn. We track via specialsUsedByFig[figureIndex] and
    // keep the legacy flat specialsUsed array as a back-compat mirror
    // for any reader not yet migrated.
    const _suFigIdx = actionsData?.selectedFigure ?? 0;
    const _suByFig = actionsData?.specialsUsedByFig?.[_suFigIdx] ?? [];
    if (_suByFig.includes(specialIdx)) {
      // Single Purpose (ccEffect activationDoubleSpecialAction): the activating
      // figure may use the SAME special action up to twice this activation.
      // Allow a second use if the grant is set for this figure and this special
      // has been used only once so far, then consume the grant (one special
      // may be doubled per activation). A third use is still rejected.
      const _spDouble = game.activationDoubleSpecialAction?.[_curActFigKey];
      const _spUsedCount = _suByFig.filter((x) => x === specialIdx).length;
      if (_spDouble && _spUsedCount < 2) {
        game.activationDoubleSpecialAction[_curActFigKey] = false;
      } else {
        await interaction.followUp({ content: "That special has already been used this activation (each special once per activation unless a card says otherwise).", ephemeral: true }).catch(discordCatch);
        return;
      }
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
    if (!actionsData.specialsUsedByFig) actionsData.specialsUsedByFig = {};
    if (!Array.isArray(actionsData.specialsUsedByFig[_suFigIdx])) actionsData.specialsUsedByFig[_suFigIdx] = [];
    actionsData.specialsUsedByFig[_suFigIdx].push(specialIdx);
  }

  if (action === 'Move' || action === 'SpendMp') {
    const isSpendMp = action === 'SpendMp';
    // G36: Parting Blow / Parting Shot — reset once-per-move flag at the start of each new Move action
    if (!isSpendMp && game.partingShotTriggered) game.partingShotTriggered = {};
    // Stale Parting Blow stash is for a prior move's exit window — clear it so a
    // new move re-stashes fresh adjacency context.
    if (!isSpendMp && game.pendingPartingBlow) delete game.pendingPartingBlow;
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
      // Per alexanbv 2026-06-13: MP is strictly per-figure. Read the
      // activating figure's own per-figure sub-bank; the top-level entry
      // holds only UI metadata (threadId/messageId/displayName).
      const topBank = game.movementBank?.[msgId];
      const currentMp = topBank?.perFig?.[figureIndex]?.remaining ?? 0;
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
        // Init top-level entry (UI metadata only) if absent.
        if (!game.movementBank[msgId]) {
          game.movementBank[msgId] = {
            threadId: topBank?.threadId ?? null,
            messageId: topBank?.messageId ?? null,
            displayName: figLabel,
          };
        } else {
          game.movementBank[msgId].displayName = game.movementBank[msgId].displayName || figLabel;
        }
        // Write to the activating figure's per-figure bank — no top-level
        // mirror (alexanbv 2026-06-13: no shared bank).
        const _top = game.movementBank[msgId];
        _top.perFig = _top.perFig || {};
        _top.perFig[figureIndex] = _top.perFig[figureIndex] || { total: 0, remaining: 0 };
        _top.perFig[figureIndex].remaining = mpRemaining;
        _top.perFig[figureIndex].total = (_top.perFig[figureIndex].total ?? 0) + speed;
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
          consumeActionForCurrentFigure(actData, 1, game, msgId);
          await updateDcActionsMessage(game, msgId, client);
        }
        // Per alexanbv 2026-05-10: the Move action is RESOLVED once MP
        // are added to the bank, before they are spent. The actual
        // movement happens via the separate Spend MP click. Fire the
        // Bleed-on-action trigger now (action has resolved) and return
        // without opening the movement picker.
        await triggerBleedAfterAction(game, ctx, figureKey, playerNum);
        await interaction.followUp({
          content: `🚶 **${figLabel}** — Move action resolved: **${mpRemaining}** MP added to bank. Click **Spend Remaining MP** to move.`,
          ephemeral: false,
        }).catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
      game.moveInProgress = game.moveInProgress || {};
      const moveKey = `${msgId}_${figureIndex}`;
      // Forced step-by-step figures (e.g. Iden Versio + Dio; or Kuiil while a
      // Hop On designation is active) must move one space at a time so a
      // per-step follow/interrupt/push trigger fires after EACH step
      // (alexanbv 2026-06-21). Start in step-by-step mode and show only
      // immediate neighbours.
      const forcedStep = isForcedStepByStepForFigure(meta.dcName, game, figureKey);
      // Show all reachable cells directly — no MP pre-selection step.
      // cache.cells only stores topLeft cells, so no filtering needed.
      const isMultiTile = profile.size && profile.size !== '1x1';
      const buttonSpaces = forcedStep
        ? getImmediateStepSpaces(pos, boardState, profile, mpRemaining)
        : [...cache.cells.keys()];
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
        // Iden Versio (Dio) is locked into step-by-step (forcedStep) so the
        // toggle and Pick-Path-Manually are suppressed below.
        stepByStep: forcedStep,
        forcedStepByStep: forcedStep,
        // pendingBleed retired (slice 9): Bleed strain on a Move action fires
        // when the action RESOLVES — destruct 2026-05-06: "for a move action
        // the action is considered resolved once MP are gained and before
        // they are spent." MP are granted by reaching this code path, so
        // strain fires now (before the first cell pick).
      };
      // Bleed strain fires only on the SpendMp path (the Move-only path
      // above already triggered it after the action resolved). This path
      // is reached only when isSpendMp === true — no bleed re-fire here
      // since Spend MP is not a separate "action" per CRR.
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
      const forcedStepNote = forcedStep
        ? `\n👣 **Step-by-step** (locked) — pick an adjacent space (one at a time).`
        : '';
      const moveHeader = `**Move** — Pick destination (**${mpRemaining}** MP remaining):${multiTileNote}${forcedStepNote}`;
      // Forced step-by-step DCs cannot use the auto A→B path picker (it would
      // skip the per-step follow trigger), so suppress Pick Path Manually.
      const moveActionBtns = forcedStep ? [] : [
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
      const actionRowComponents = actionBtns.length > 0
        ? [new ActionRowBuilder().addComponents(...actionBtns)]
        : [];
      const firstPayload = {
        content: `${moveHeader}\nChoose a row:`,
        components: [...moveRowBtns.slice(0, 4), ...actionRowComponents],
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
    // Line of Fire (Anchorhead B): a small figure carrying a crate cannot
    // attack. Per persistent rule smallFigureCarryNoAttack.
    const _lofRule = (game?.selectedMission?.rules?.persistent?.smallFigureCarryNoAttack === true)
      || (game?.selectedMap?.id === 'anchorhead-cantina-bar' && game?.selectedMission?.variant === 'b');
    if (_lofRule && game.figureContraband?.[figureKey]) {
      // Resolve size via ctx.getFigureSize + figureOrientations override.
      const _lofRawSize = ctx.getFigureSize ? ctx.getFigureSize(meta.dcName) : null;
      const _lofSize = game.figureOrientations?.[figureKey] || _lofRawSize;
      const _lofIsSmall = Array.isArray(_lofSize) ? (_lofSize[0] === 1 && _lofSize[1] === 1) : true;
      if (_lofIsSmall) {
        await interaction.followUp({ content: '**Line of Fire** — A small figure carrying a crate cannot attack.', ephemeral: true }).catch(discordCatch);
        return;
      }
    }
    // Stunned figures cannot Attack
    const attackFigureConds = game.figureConditions?.[figureKey] || [];
    if (attackFigureConds.includes('Stun')) {
      await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** is **Stunned** and cannot Move or Attack this activation.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    // Assault rule: non-Assault DCs can only perform 1 attack per
    // activation, per figure (alexanbv 2026-05-13: keyed by figureKey
    // so siblings in a multifigure group each get their own attack).
    // Free attacks bypass.
    if (game.attackPerformedThisActivation?.[figureKey]) {
      // Per alexanbv 2026-05-13: every bypass flag below is per-figureKey.
      const isFreeAttack = hasFellSwoopFreeAttack || hasPummelFreeAttack ||
        game.freeAttackBonusPending?.[figureKey] != null || game.pounceAttackPending?.[figureKey] != null;
      // Imperial Retrofitting: multi-attack bypass (per-figure).
      const hasIRMultiAttack = !!game.imperialRetrofittingMultiAttack?.[figureKey];
      if (!isFreeAttack && !hasIRMultiAttack) {
        const dcAbilityText = getDcEffects()?.[meta.dcName]?.abilityText || '';
        let hasAssault = /\bAssault:/i.test(dcAbilityText);
        // Wild Fury (alexanbv 2026-06-21): grants Assault for this activation
        // via a per-figure flag (the figure may take a second attack).
        if (game.activationAssaultGranted?.[figureKey]) hasAssault = true;
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
    const attackerEffects = getDcEffect(meta.dcName);
    const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
    // Reach from DC passives, keywords, CC-granted (per-figure 2026-05-09), loadout card (Electrostaff), or Fury of Kashyyyk (WOOKIEE)
    const _loadoutCard = getLoadoutCards()[getConfig(game, figureKey)?.loadout];
    const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[figureKey] || _loadoutCard?.passive === 'Reach' || _hasFuryReach(game, playerNum, attackerKws);
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
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    if ((hasArsenal || hasEpicArsenal) && !game.pendingOverrideAttackDice?.[figureKey]) {
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
    // EE-3 Carbine (Boba Fett) + Vanguard (AT-RT) die-swap moved to the
    // on-declare window in combat.js per alexanbv 2026-05-10 — see
    // _postOnDeclareDieSwapPrompts + handleOnDeclareDieSwap. The legacy
    // pre-target pickers below are retired (kept as `if (false)` blocks
    // until reviewed for stale state cleanup).
    // Bo-Rifle (Agent Kallus): before declaring attack, may switch to melee (replace blue→red)
    if (atkSpecialIds.includes('bo_rifle_kallus') && !game.pendingOverrideAttackDice?.[figureKey]) {
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
    if (_intAbilityText.includes('Non-Sentient') && !game.beastTamerInteractOverride?.[figureKey]) {
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
    // Compute attacker figureKey (the figure currently performing the action).
    // Per IACP rule 2026-05-09: freeAttackBonusPending is figureKey-keyed so
    // each figure in a multifigure group has its own pending free-attack flag.
    const _ahDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const _ahFigureKey = `${meta.dcName}-${_ahDgIndex}-${figureIndex}`;
    // Free pounce attack: Pounce special grants one free attack to the
    // POUNCING FIGURE (alexanbv 2026-05-13: per-figureKey, not per-group).
    const isPounceAttack = action === 'Attack' && game.pounceAttackPending?.[_ahFigureKey] != null;
    // Free heroic attack: Heroic ability grants one free attack (action restored via freeAction flag on the special)
    const isHeroicAttack = action === 'Attack' && game.freeAttackBonusPending?.[_ahFigureKey] != null;
    if (isPounceAttack) {
      delete game.pounceAttackPending[_ahFigureKey];
    } else if (isHeroicAttack) {
      // Guild Programming (IG-11): "Before you declare each [Rapid Fire] attack,
      // you become Focused." Re-apply Focus before EACH free attack — the first
      // attack's Focus came from the card-play; this covers the second (and any
      // further) Rapid Fire attack even if the first attack spent the Focus.
      if (game.guildProgrammingRefocus?.[_ahFigureKey]) {
        applyCondition(game, _ahFigureKey, 'Focus');
      }
      const _fabCount = game.freeAttackBonusPending[_ahFigureKey];
      if (typeof _fabCount === 'number' && _fabCount > 1) {
        game.freeAttackBonusPending[_ahFigureKey] = _fabCount - 1;
      } else {
        delete game.freeAttackBonusPending[_ahFigureKey];
        // Rapid Fire's last free attack consumed → drop the re-Focus arm.
        if (game.guildProgrammingRefocus?.[_ahFigureKey]) delete game.guildProgrammingRefocus[_ahFigureKey];
        // Brutality / Sarlacc Sweep: clear different-target tracker once the
        // last free attack is consumed.
        // Per alexanbv 2026-05-13: per-figureKey.
        if (game.freeAttackDifferentTargets?.[_ahFigureKey]) delete game.freeAttackDifferentTargets[_ahFigureKey];
        // Wild Fury REMOVED 2026-05-09: post-activation conditions now
        // apply at end of activation (handleDcEndActivation), not on the
        // last free attack click. The original conversion to
        // pendingPostAttackConditions + the after-attack apply were
        // both wrong-timing per CRR + user clarification.
      }
      // Stay Down: apply Stun to the attacker figure when the free attack is
      // consumed. Keyed by the activating figureKey (matching the setter at
      // abilities.js:2481) — was wrongly read by msgId so it never fired
      // (alexanbv 2026-06-20).
      if (game.stayDownPendingMsgId?.[_ahFigureKey]) {
        delete game.stayDownPendingMsgId[_ahFigureKey];
        const _sdDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
        const _sdFigKey = `${meta.dcName}-${_sdDgIdx}-${figureIndex}`;
        // Condition Immunity: skip Stun for immune figures
        const _sdEff = getDcEffect(meta.dcName);
        const _sdImm = (_sdEff?.specialAbilityIds || []).includes('immune_onar') || (_sdEff?.specialAbilityIds || []).includes('immune_snowtrooper_elite');
        if (!_sdImm) {
          applyCondition(game, _sdFigKey, 'Stun');
          await logGameAction(game, client, `**Stay Down** — **${meta.displayName || meta.dcName}** is now **Stunned**.`, { phase: 'ROUND', icon: 'activate' });
        } else {
          await logGameAction(game, client, `**Condition Immunity** — **${meta.displayName || meta.dcName}** is immune to Stun (Stay Down).`, { phase: 'ROUND', icon: 'card' });
        }
      }
    } else if (hasPummelFreeAttack) {
      // Pummel: grants 2 free attacks to this FIGURE (alexanbv 2026-05-13:
      // per-figureKey, not per-group). Track remaining count per figure.
      game.pummelAttacksRemaining = game.pummelAttacksRemaining || {};
      if (game.pummelAttacksRemaining[_ahFigureKey] === undefined) game.pummelAttacksRemaining[_ahFigureKey] = 2;
      game.pummelAttacksRemaining[_ahFigureKey] = Math.max(0, game.pummelAttacksRemaining[_ahFigureKey] - 1);
      if (game.pummelAttacksRemaining[_ahFigureKey] <= 0) {
        delete game.pummelTwoAttacksThisActivation[_ahFigureKey];
        delete game.pummelAttacksRemaining[_ahFigureKey];
      }
    } else {
      const actionCost = buttonKey === 'dc_special_' ? _effectiveActionCost : 1;
      consumeActionForCurrentFigure(actionsData, actionCost, game, msgId);
      // Jundland Terror: the free Special Action is one-shot — consume the
      // per-figure marker now that the special has been used.
      if (_isJundlandFreeSpecial) {
        const _jtSelFig2 = actionsData?.selectedFigure ?? 0;
        const _jtDgIdx2 = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _jtFk2 = `${meta.dcName}-${_jtDgIdx2}-${_jtSelFig2}`;
        if (game.freeSpecialActionPending) delete game.freeSpecialActionPending[_jtFk2];
      }
      // All in a Day's Work (CC) timing: a Special Action has been used during
      // this activation. Set the per-activation flag the card's timing gate reads
      // ("after you resolve a Special or Interact during your activation").
      if (buttonKey === 'dc_special_') game.specialOrInteractResolvedThisActivation = true;
      // Per alexanbv 2026-05-10/12: defer the "finished all actions"
      // prompt for any multi-step interactive action button. The action
      // cost is decremented at click time, so remaining can hit 0 before
      // the action actually resolves (target pick, attack roll, move
      // grid). Firing "finished" between the click and the resolution
      // produces the BT-1 bug class (final notice posted before the
      // attack log line). Downstream resolution paths
      // (combat-bridge end / movement finalize / requiresChoice refund)
      // call updateDcActionsMessage again without this suppression.
      const _suppressFinished = (
        buttonKey === 'dc_special_'
        || buttonKey === 'dc_attack_'
        || buttonKey === 'dc_move_'
      );
      await updateDcActionsMessage(game, msgId, client, { suppressFinishedPrompt: _suppressFinished });
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
          grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, _effectiveActionCost, DC_ACTIONS_PER_ACTIVATION);
          // Per alexanbv 2026-05-13: specialsUsedByFig per-figure.
          {
            const _refFigIdx = actionsData.selectedFigure ?? 0;
            if (actionsData.specialsUsedByFig?.[_refFigIdx]) {
              actionsData.specialsUsedByFig[_refFigIdx] = actionsData.specialsUsedByFig[_refFigIdx].filter(i => i !== specialIdx);
            }
          }
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

    // Vader's Finest: Attack+Move — perform an attack, then move up
    // to 1 space (CRR MOVE-017 picker after the attack resolves).
    if (_suHandler === 'VF: Attack+Move') {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      const _vfFk = figureKeyForActivation(game, msgId, figureIndex);
      if (_vfFk) game.freeAttackBonusPending[_vfFk] = { from: "Vader's Finest" };
      game.vadersFinestPostAttackMove = game.vadersFinestPostAttackMove || {};
      game.vadersFinestPostAttackMove[msgId] = true;
      await thread.send(`**Vader's Finest** — Your next attack is free. After attack resolves, you may move up to **1 space** (Move-X picker).`).catch(discordCatch);
      await updateDcActionsMessage(game, msgId, client);
      saveGames(game.gameId);
      return;
    }

    // Vader's Finest: Focus — if < 2 dice in printed attack pool, become Focused (limit once/round/group)
    if (_suHandler === 'VF: Focus') {
      if (game.vadersFocusUsedThisRound?.[msgId]) {
        await thread.send(`**Vader's Finest** — Focus already used this round for this group.`).catch(discordCatch);
        if (actionsData) {
          grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, _effectiveActionCost, DC_ACTIONS_PER_ACTIVATION);
          // Per alexanbv 2026-05-13: specialsUsedByFig per-figure.
          {
            const _refFigIdx = actionsData.selectedFigure ?? 0;
            if (actionsData.specialsUsedByFig?.[_refFigIdx]) {
              actionsData.specialsUsedByFig[_refFigIdx] = actionsData.specialsUsedByFig[_refFigIdx].filter(i => i !== specialIdx);
            }
          }
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
        const su = squadUpgradeOnGroup(_suUpgrades);
        if (su) {
          const suEff = getDcEffects?.()?.[`[${su}]`] || getDcEffects?.()?.[su];
          if (suEff?.attack?.dice) printedDiceCount = suEff.attack.dice.length;
        }
      }
      if (printedDiceCount >= 2) {
        await thread.send(`**Vader's Finest** — This figure has ${printedDiceCount} dice in its printed attack pool (need < 2). Cannot Focus.`).catch(discordCatch);
        if (actionsData) {
          grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, _effectiveActionCost, DC_ACTIONS_PER_ACTIVATION);
          // Per alexanbv 2026-05-13: specialsUsedByFig per-figure.
          {
            const _refFigIdx = actionsData.selectedFigure ?? 0;
            if (actionsData.specialsUsedByFig?.[_refFigIdx]) {
              actionsData.specialsUsedByFig[_refFigIdx] = actionsData.specialsUsedByFig[_refFigIdx].filter(i => i !== specialIdx);
            }
          }
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

    // Z-6 Trooper Autofire: perform an attack (defender +1 white die, surge: chain attack within 3).
    // Per alexanbv 2026-05-13: per-figureKey.
    if (_suHandler === 'Autofire') {
      const _afFk = figureKeyForActivation(game, msgId, figureIndex);
      game.autofireActive = game.autofireActive || {};
      if (_afFk) game.autofireActive[_afFk] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      if (_afFk) game.freeAttackBonusPending[_afFk] = { from: 'Autofire' };
      await thread.send(`**Autofire** — Your next attack: defender adds **1 white die**. Surge: **Chain attack** targeting a figure within 3 of target space.`).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }

    // Mortar Trooper Fire Mission: double-action attack with LOS from
    // any group figure + Blast 1. Per alexanbv 2026-05-13: per-figureKey.
    if (_suHandler === 'Fire Mission') {
      const _fmFk2 = figureKeyForActivation(game, msgId, figureIndex);
      game.fireMissionActive = game.fireMissionActive || {};
      if (_fmFk2) game.fireMissionActive[_fmFk2] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      if (_fmFk2) game.freeAttackBonusPending[_fmFk2] = { from: 'Fire Mission' };
      await thread.send(`**Fire Mission** — Your next attack: LOS from **any figure in this group** (range from acting figure). **+Blast 1**.`).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }

    // The Darksaber: Special Action — Melee attack with 1 red die, Blast→Cleave, then may perform an attack
    if (_suHandler === 'Darksaber Strike') {
      const _dsFk = figureKeyForActivation(game, msgId, figureIndex);
      // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
      if (_dsFk) {
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[_dsFk] = { dice: ['red'], type: 'melee', darksaberBlastToCleave: true };
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[_dsFk] = { from: 'Darksaber Strike' };
      }
      // Grant a second free attack after this one (the "then may perform
      // an attack"). Per alexanbv 2026-05-13: per-figureKey.
      game.darksaberSecondAttack = game.darksaberSecondAttack || {};
      if (_dsFk) game.darksaberSecondAttack[_dsFk] = true;
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
      const _obFk = figureKeyForActivation(game, msgId, figureIndex);
      if (_obFk) game.freeAttackBonusPending[_obFk] = { from: 'Orbital Bombardment' };
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

  // Experimental Weapons (Development Facility B): three carrier
  // specials. Per destruct 2026-05-08 they're plain action buttons.
  if (action === 'Attack (auto-Focus)' || action === 'Gain 3 VP' || action === 'Move 4 + Recover 3 Damage') {
    const _wpDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _wpSelFig = actionsData?.selectedFigure ?? 0;
    const _wpFk = `${meta.dcName}-${_wpDgIdx}-${_wpSelFig}`;
    if (!game.figureContraband?.[_wpFk]) {
      await interaction.followUp({ content: 'Figure is no longer carrying a weapon prototype.', ephemeral: true }).catch(discordCatch);
      return;
    }
    if (action === 'Attack (auto-Focus)') {
      // Per destruct 2026-05-08: focus + attack is one action; user
      // does not click Attack again. We:
      //   1) Mark the figure Focused (carrier-only effect; does not
      //      stack with normal Focus tokens that the figure may already
      //      have, since IA Focus is a binary "focused/not" state).
      //   2) Inline the Attack-flow prep work and post target buttons
      //      directly (so this single button click drives the attack).
      // The 1 action cost was already consumed by the parent special-
      // action dispatch (mission-cards weaponPrototypeCarrierActions
      // entry actionCost: 1).
      game.figureFocused = game.figureFocused || {};
      game.figureFocused[_wpFk] = true;
      await logGameAction(game, interaction.client, `🔫 **Experimental Weapons** — **${meta.displayName || meta.dcName}** becomes Focused and performs an attack.`, { phase: 'ROUND', icon: 'attack' });
      const _wpPlayerNum = meta.playerNum;
      const _wpAttackerPos = game.figurePositions?.[_wpPlayerNum]?.[_wpFk];
      if (!_wpAttackerPos) {
        await interaction.followUp({ content: 'Carrier has no position yet.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const _wpStats = getDcStats(meta.dcName);
      const _wpAttackInfo = _wpStats.attack || { dice: ['red'], type: 'range' };
      const [_wpMinRange, _wpMaxRange] = defaultAttackRange(_wpAttackInfo);
      const _wpAtkEff = getDcEffect(meta.dcName);
      const _wpAtkKws = (_wpAtkEff?.keywords || []).map((k) => String(k).toUpperCase());
      const _wpHasReach = _wpAtkKws.includes('REACH') || (_wpAtkEff?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[_wpFk];
      const _wpEffMax = _wpHasReach && _wpMaxRange < 2 ? 2 : _wpMaxRange;
      const _wpMs = getMapData(game.selectedMap?.id);
      if (!_wpMs) {
        await interaction.followUp({ content: 'Map data unavailable for attack flow.', ephemeral: true }).catch(discordCatch);
        return;
      }
      const _wpEnemyPn = _wpPlayerNum === 1 ? 2 : 1;
      const _wpDgIdxNum = parseInt(_wpDgIdx, 10) || 1;
      if (pushUndo) pushUndo(game, { type: 'attack', label: 'Attack (auto-Focus)', msgId, gameLogMessageId: null });
      await buildAndSendAttackTargets(interaction, ctx, game, meta, msgId, _wpFk, _wpSelFig, {
        dgIndex: _wpDgIdxNum, attackerPos: _wpAttackerPos, attackerKws: _wpAtkKws,
        minRange: _wpMinRange, effectiveMaxRange: _wpEffMax, ms: _wpMs,
        playerNum: _wpPlayerNum, enemyPlayerNum: _wpEnemyPn, stats: _wpStats,
      });
      saveGames(game.gameId);
      return;
    }
    if (action === 'Gain 3 VP') {
      const { awardObjectiveVp } = await import('../game/vp-helpers.js');
      awardObjectiveVp(game, meta.playerNum, 3);
      await logGameAction(game, interaction.client, `🔫 **Experimental Weapons** — **${meta.displayName || meta.dcName}** gains **+3 VP**.`, { phase: 'ROUND', icon: 'attack' });
      saveGames(game.gameId);
      return;
    }
    if (action === 'Move 4 + Recover 3 Damage') {
      // Per destruct 2026-05-08: recover *damage* (heal HP), not strain.
      // Grant 4 MP to the activating figure's per-figure bank (never a
      // top-level number — that clobbers the metadata entry).
      grantMovementBank(game, msgId, 4, _wpSelFig);
      const _wpHs = ctx.dcHealthState?.get(msgId) || [];
      const _wpEntry = _wpHs[_wpSelFig];
      if (_wpEntry) {
        const [_wpCur, _wpMax] = _wpEntry;
        const _wpNew = Math.min(_wpMax || _wpCur, (_wpCur || 0) + 3);
        _wpHs[_wpSelFig] = [_wpNew, _wpMax || _wpNew];
        ctx.dcHealthState?.set(msgId, _wpHs);
      }
      await logGameAction(game, interaction.client, `🔫 **Experimental Weapons** — **${meta.displayName || meta.dcName}** gains **+4 MP** and recovers **3 damage**.`, { phase: 'ROUND', icon: 'move' });
      saveGames(game.gameId);
      return;
    }
  }

  // D1: Prefer abilityId from dc-effects (specialAbilityIds[specialIdx]) when present; else synthetic id for library lookup
  let abilityId = null;
  if (_isChooseASideFlamethrower) {
    // Choose a Side (IMPERIAL): route the injected special (which is NOT in this
    // figure's native specialAbilityIds) to Gar Saxon's existing area resolver.
    // The resolver derives the activating figure from meta + dcActionsData
    // selectedFigure, so the eligible figure (NOT Gar Saxon) is the source.
    abilityId = 'gar_saxon_flamethrower';
  } else if (buttonKey === 'dc_special_' && specialIdx >= 0) {
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
  // Damage from the special routes through the ONE applyDamage pipeline
  // (alexanbv 2026-06-23). resolveAbility is sync and queues onto
  // game._pendingDamage; drain it here so when-damaged / before-defeated /
  // when-defeated hooks + Vanish / Clan-of-Two fire. Idempotent (clears the
  // queue) so a later applyAbilityResult drain is a no-op.
  await _drainAbilityDamage(game, ctx, resolveResult);
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
      grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, 1, DC_ACTIONS_PER_ACTIVATION);
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
      // Compound rollOneDie + freeMoveBonus is now strict-sequenced:
      // the dispatcher returns pendingMoveXMsgId WITHOUT
      // requiresSpaceChoice, so this path no longer co-fires the
      // Move-X picker; the deferred space-pick lives on
      // pendingMoveX.nextAction and runs from move-x-handler when
      // the picker completes.
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
    grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, 1, DC_ACTIONS_PER_ACTIVATION);
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
      await logGameAction(game, client, `<@${oppOwnerId}> **You Have Something I Want** — **${dcNameFromFigureKey(_yhsiw.targetFk)}**'s **${_yhsiw.token}** is targeted by **Moff Gideon**. Choose: transfer the token or suffer 3 Damage.`, { components: [_yhsiwRow], allowedMentions: { users: [oppOwnerId] }, interrupt: true });
    }
  }
  // Track special action usage for CC purposes (To the Limit, All in a
  // Day's Work). Per alexanbv 2026-05-13: per-figureKey.
  if (buttonKey === 'dc_special_' && resolveResult.applied) {
    const _sauFk = figureKeyForActivation(game, msgId);
    game.specialActionUsedThisActivation = game.specialActionUsedThisActivation || {};
    if (_sauFk) game.specialActionUsedThisActivation[_sauFk] = (game.specialActionUsedThisActivation[_sauFk] || 0) + 1;
  }
  // Expertise (Ko-Tun Feralo): once per activation, using a Special grants 1 extra action.
  // Tracked on the per-activation actionsData (expertiseUsedByFig, keyed by figure
  // index) so the limit resets each activation — NOT round-scoped, so a figure
  // granted a second activation in the same round can use Expertise again.
  if (buttonKey === 'dc_special_' && abilityId !== 'expertise' && actionsData) {
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const effects = getDcEffects?.() || {};
    const effectEntry = effects[meta.dcName] || effects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    const expertiseUsedThisActivation = !!actionsData.expertiseUsedByFig?.[selectedFigure];
    if ((effectEntry?.specialAbilityIds || []).includes('expertise') && !expertiseUsedThisActivation) {
      if (!actionsData.expertiseUsedByFig) actionsData.expertiseUsedByFig = {};
      actionsData.expertiseUsedByFig[selectedFigure] = true;
      grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, 1, DC_ACTIONS_PER_ACTIVATION);
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
  // Move-X picker — abilities.js stamped pendingMoveX synchronously
  // and surfaced the msgId via resolveResult.pendingMoveXMsgId. Post
  // the picker now (async, needs ctx.client + logGameAction).
  if (resolveResult.pendingMoveXMsgId) {
    await postMoveXPicker(game, { client, logGameAction, saveGames }, resolveResult.pendingMoveXMsgId);
  }
  // ERG per-figure choices prompt (alexanbv 2026-05-11). Each affected
  // TROOPER with BOTH options viable gets a Recover/Discard pair.
  if (resolveResult.ergPostChoicesPrompt && game.pendingErgChoices?.figures?.length) {
    try {
      const _ergPending = game.pendingErgChoices;
      const _ergOwnerId = game[`player${_ergPending.controllerPlayerNum}Id`];
      const _ergButtons = [];
      for (const f of _ergPending.figures) {
        _ergButtons.push(new ButtonBuilder()
          .setCustomId(`erg_pick_${game.gameId}_${f.figureKey}_recover`)
          .setLabel(`${f.dcName}: Recover 1`)
          .setStyle(ButtonStyle.Success));
        _ergButtons.push(new ButtonBuilder()
          .setCustomId(`erg_pick_${game.gameId}_${f.figureKey}_discard`)
          .setLabel(`${f.dcName}: Discard ${f.harmful[0]}`)
          .setStyle(ButtonStyle.Primary));
      }
      _ergButtons.push(new ButtonBuilder()
        .setCustomId(`erg_pick_${game.gameId}_skip_all`)
        .setLabel('Skip remaining')
        .setStyle(ButtonStyle.Secondary));
      const _ergRows = [];
      for (let i = 0; i < _ergButtons.length; i += 5) {
        _ergRows.push(new ActionRowBuilder().addComponents(_ergButtons.slice(i, i + 5)));
      }
      await interaction.followUp({
        content: `🧰 <@${_ergOwnerId}> **${_ergPending.sourceLabel}** — Pick per figure (each TROOPER may Recover 1 OR Discard their harmful condition):`,
        components: _ergRows.slice(0, 5),
        allowedMentions: { users: _ergOwnerId ? [_ergOwnerId] : [] },
      }).catch(discordCatch);
    } catch (err) {
      console.error('ERG choices prompt failed:', err?.message ?? err);
    }
  }
  // Post-action Bleed strain (DC Special resolves): centralized via
  // triggerBleedAfterAction.
  if (buttonKey === 'dc_special_') {
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFigure}`;
    await triggerBleedAfterAction(game, ctx, figureKey, meta.playerNum);
    // Per alexanbv 2026-05-10: the "finished all actions" prompt for
    // dc_special_ clicks was suppressed at the consume step (because
    // requiresChoice paths refund the action). Now that the ability
    // has settled (applied / requiresChoice already handled their own
    // updates), re-evaluate WITHOUT suppression so the prompt fires
    // for auto-applied dcSpecials whose action is genuinely consumed.
    if (resolveResult.applied && !resolveResult.requiresChoice && !resolveResult.requiresSpaceChoice) {
      await updateDcActionsMessage(game, msgId, client).catch(() => {});
    }
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
  if (abilityId === 'dual_bladed_fury' && game.wreakVengeanceActive?.[playerNum] && resolveAbility) {
    const commonCtx = { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapData: ctx.getMapData, findDcMessageIdForFigure: ctx.findDcMessageIdForFigure, getDcEffects: ctx.getDcEffects };
    const r0 = resolveAbility(abilityId, { ...commonCtx, choiceIndex: 0 });
    const r1 = resolveAbility(abilityId, { ...commonCtx, choiceIndex: 1 });
    if (game.wreakVengeanceActive) delete game.wreakVengeanceActive[playerNum];
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
  await _drainAbilityDamage(game, ctx, resolveResult);

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

  // Order / Tactical Maneuver: hand the ordered figure directly to
  // the move-x picker (Phase 2 migration 2026-05-09 — skip the
  // intermediate Move/Skip prompt; player can decline by clicking the
  // picker's Stop button without moving).
  if (resolveResult.applied && resolveResult.orderMovePrompt) {
    const omp = resolveResult.orderMovePrompt;
    // Deduct action
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      consumeActionForCurrentFigure(actionsData, 1, game, msgId);
      await updateDcActionsMessage(game, msgId, client);
    }
    if (logGameAction) await logGameAction(game, client, resolveResult.logMessage, { phase: 'ROUND', icon: 'activate' });
    const { setupPendingMoveX } = await import('./move-x-handler.js');
    await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
      msgId: omp.msgId,
      figureKey: omp.figureKey,
      playerNum,
      spaces: omp.mp,
      source: omp.label || 'Order',
      threadId: null,
      bypassCosts: false,
    });
    saveGames(game.gameId);
    return;
  }

  // pendingMoveXMsgId: abilities that stamp pendingMoveX synchronously
  // (Officer Order, Bombardment grant-move variants, etc.) surface the
  // grantee's msgId via resolveResult.pendingMoveXMsgId. Mirror the
  // handleDcAction path (line ~3240) so the Move-X picker is posted
  // when the chooser arrives via dc_ability_choice_ — without this
  // block the figure-pick succeeds but the destination picker never
  // appears (alexanbv 2026-05-17 Order bug report).
  if (resolveResult.applied && resolveResult.pendingMoveXMsgId) {
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      const actionCost = resolveResult.doubleAction ? 2 : 1;
      consumeActionForCurrentFigure(actionsData, actionCost, game, msgId);
      await updateDcActionsMessage(game, msgId, client);
    }
    if (logGameAction) await logGameAction(game, client, resolveResult.logMessage, { phase: 'ROUND', icon: 'activate' });
    const { postMoveXPicker } = await import('./move-x-handler.js');
    await postMoveXPicker(game, { client, logGameAction, saveGames }, resolveResult.pendingMoveXMsgId);
    saveGames(game.gameId);
    return;
  }

  // Deduct action (was refunded when showing choice buttons).
  // Per alexanbv 2026-05-12: suppress the "finished all actions"
  // prompt while the action consumption + resolveResult logging are
  // still in progress. Without the suppress, the prompt fires BEFORE
  // the ability's own log line (e.g. "Inform — Baze became Focused")
  // posts. The trailing un-suppressed updateDcActionsMessage fires
  // the prompt at the correct moment.
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    // Double Action Specials (BD-1 Terminal Slicing, etc.) cost both
    // actions; standard Special Action costs 1.
    const actionCost = resolveResult.doubleAction ? 2 : 1;
    consumeActionForCurrentFigure(actionsData, actionCost, game, msgId);
    await updateDcActionsMessage(game, msgId, client, { suppressFinishedPrompt: true });
  }
  if (resolveResult.freeAction && actionsData) {
    grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, 1, DC_ACTIONS_PER_ACTIVATION);
    await updateDcActionsMessage(game, msgId, client, { suppressFinishedPrompt: true });
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
  // Now that the ability has fully resolved + logged, re-evaluate the
  // "finished all actions" prompt at its true post-resolution timing.
  if (actionsData) {
    await updateDcActionsMessage(game, msgId, client);
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
  await _drainAbilityDamage(game, ctx, result);
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

  // Iterative space choice: a resolver pushed a figure and, if more pushes
  // remain, returns another requiresSpaceChoice to push again. Re-prompt the
  // next push pick with a Skip button to stop. (Kuiil's Hop On no longer uses
  // this path — it now designates only; its pushes fire during movement.)
  if (!result.applied && result.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
    const figureIndex = pending.figureIndex;
    // Refresh the board so Kuiil's / the figure's new positions are visible.
    if (result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await fetchGameChannel(client, game.boardId);
        if (boardChannel) {
          const bPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
          await boardChannel.send(bPayload);
        }
      } catch (err) { console.error('Hop On board refresh failed:', err); }
    }
    const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
    const itMapSpaces = boardState?.mapSpaces || {};
    game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
    game.pendingPounceSpaceChoice[msgId] = {
      gameId: game.gameId, playerNum, figureIndex, msgId, abilityId,
      validSpaces: result.validSpaces, targetFigureKey: result.chosenFigureKey || targetFigureKey || null,
      specialIdx: pending.specialIdx || 0,
    };
    const itContextKey = `${game.gameId}_${msgId}_${figureIndex}`;
    game.pendingSpacePick = game.pendingSpacePick || {};
    game.pendingSpacePick[itContextKey] = {
      validSpaces: result.validSpaces,
      cellPrefix: `pounce_space_${game.gameId}_${msgId}_${figureIndex}_`,
      mapSpaces: itMapSpaces,
      headerText: result.spaceChoiceLabel || 'Push again:',
    };
    const { rows: itRowBtns } = buildRowPickerButtons(result.validSpaces, `space_row_${itContextKey}_`);
    const itSkipRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pounce_skip_push_${game.gameId}_${msgId}_${figureIndex}`)
        .setLabel('Skip (stop Hop On)')
        .setStyle(ButtonStyle.Secondary)
    );
    const itAttachment = ctx.getMapAttachmentForSpaces ? await ctx.getMapAttachmentForSpaces(game, result.validSpaces) : null;
    const itPayload = {
      content: `${result.spaceChoiceLabel || 'Push again:'}\nChoose a row:`,
      components: [...itRowBtns.slice(0, 4), itSkipRow],
      ephemeral: false,
    };
    if (itAttachment) itPayload.files = [itAttachment];
    await interaction.followUp(itPayload).catch(discordCatch);
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
    // Per alexanbv 2026-05-13: forcedAttackTarget keyed by activator
    // figureKey post-migration. Read by the activator's figureKey.
    const _ftActFk = figureKeyForActivation(game, msgId);
    const hasForcedTarget = _ftActFk ? game.forcedAttackTarget?.[_ftActFk] : null;
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
  // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
  const _arsFk = figureKeyForActivation(game, msgId, figureIndex);
  if (_arsFk) {
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[_arsFk] = { dice: chosenDice };
  }
  saveGames(game.gameId);

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffect(meta.dcName);
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const _attDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _attFigKey = `${meta.dcName}-${_attDgIdx}-${figureIndex}`;
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[_attFigKey] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapData(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = meta.playerNum;
  const enemyPlayerNum = opponentPlayerNum(playerNum);
  const dgIndex = _attDgIdx;
  const figureKey = _attFigKey;
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
    // Deduct 2 MP (per-figure bank) and upgrade one die of the chosen color to red
    consumeMovementPoints(game, msgId, 2, figureIndex);
    const stats = getDcStats(meta.dcName);
    const baseDice = [...(stats.attack?.dice || ['red'])];
    const idx = baseDice.indexOf(color);
    if (idx !== -1) baseDice[idx] = 'red';
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    const _ee3Fk = figureKeyForActivation(game, msgId, figureIndex);
    if (_ee3Fk) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_ee3Fk] = { dice: baseDice };
    }
  }
  game.pendingEe3Carbine[msgId] = 'decided';
  saveGames(game.gameId);

  // Proceed to attack target selection
  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffect(meta.dcName);
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const _ee3DgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _ee3FigKey = `${meta.dcName}-${_ee3DgIdx}-${figureIndex}`;
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[_ee3FigKey] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapData(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = meta.playerNum;
  const enemyPlayerNum = opponentPlayerNum(playerNum);
  const dgIndex = _ee3DgIdx;
  const figureKey = _ee3FigKey;
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
 * Handle vanguard_pick_ button: player chose which die color to swap to red
 * (or skipped). Mirrors handleEe3DiePick — same pattern, no MP cost.
 * customId: vanguard_pick_{color|skip}_{gameId}_{msgId}_{figureIndex}
 */
export async function handleVanguardDiePick(interaction, ctx) {
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, getMapData, saveGames } = ctx;
  const withoutPrefix = parseCustomId(interaction.customId, 'vanguard_pick_');
  const parts = withoutPrefix.split('_');
  const color = parts[0]; // 'blue' / 'green' / 'yellow' / 'skip'
  const gameId = parts[1];
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(2, -1).join('_');

  const meta = dcMessageMeta.get(msgId);
  if (!meta) return;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  game.pendingVanguardSwap = game.pendingVanguardSwap || {};

  if (color !== 'skip') {
    const stats = getDcStats(meta.dcName);
    const baseDice = [...(stats.attack?.dice || ['red'])];
    const idx = baseDice.indexOf(color);
    if (idx !== -1) baseDice[idx] = 'red';
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    const _vgFk = figureKeyForActivation(game, msgId, figureIndex);
    if (_vgFk) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_vgFk] = { dice: baseDice };
    }
    // Tag so the post-target check can revert if target ends up >3 spaces.
    game.pendingVanguardSwap[msgId] = 'swapped';
    await interaction.message.edit({ content: `**Vanguard** — ${color[0].toUpperCase() + color.slice(1)} → Red.`, components: [] }).catch(discordCatch);
  } else {
    game.pendingVanguardSwap[msgId] = 'decided';
    await interaction.message.edit({ content: '**Vanguard** — Skipped.', components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);

  // Proceed to attack target selection (same pattern as EE-3).
  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffect(meta.dcName);
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const _vgDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _vgFigKey = `${meta.dcName}-${_vgDgIdx}-${figureIndex}`;
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[_vgFigKey] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapData(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = meta.playerNum;
  const enemyPlayerNum = opponentPlayerNum(playerNum);
  const dgIndex = _vgDgIdx;
  const figureKey = _vgFigKey;
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

  // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
  const _brHandlerFk = figureKeyForActivation(game, msgId, figureIndex);
  if (choice === 'use' && game.pendingBoRifle?.[msgId]) {
    const meleeDice = game.pendingBoRifle[msgId].meleeDice;
    if (_brHandlerFk) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_brHandlerFk] = { dice: meleeDice, type: 'melee' };
    }
    await interaction.message.edit({ content: `**Bo-Rifle** — Melee mode active (${meleeDice.map(d => d[0].toUpperCase() + d.slice(1)).join('+')}).`, components: [] }).catch(discordCatch);
  } else {
    await interaction.message.edit({ content: '**Bo-Rifle** — Skipped (normal ranged attack).', components: [] }).catch(discordCatch);
  }
  if (game.pendingBoRifle?.[msgId]) delete game.pendingBoRifle[msgId];
  saveGames(game.gameId);

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], type: 'range' };
  const [minRange, maxRange] = defaultAttackRange(attackInfo);
  const attackerEffects = getDcEffect(meta.dcName);
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _brFigKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const _loadoutCard = getLoadoutCards()[getConfig(game, _brFigKey)?.loadout];
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[_brFigKey] || _loadoutCard?.passive === 'Reach' || _hasFuryReach(game, meta.playerNum, attackerKws);
  // If Bo-Rifle mode, override range to melee.
  // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
  const brOverride = game.pendingOverrideAttackDice?.[_brHandlerFk];
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
      // Route Lure post-attack strain through applyStrain (Fireproof /
      // Headhunter / per-strain choice / Under Duress / Paz).
      const { applyStrain } = await import('./strain-handler.js');
      await applyStrain(game, ctx, {
        figureKey: controlledFigureKey,
        controllerPlayerNum: controlledPlayerNum,
        amount: fo.postAttackStrain,
        source: 'Lure of the Dark Side',
      });
      await interaction.followUp({ content: `**Lure of the Dark Side** — Skipped attack. **${controlledName}** suffers ${fo.postAttackStrain} Strain (queued).`, ephemeral: false }).catch(discordCatch);
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
  const controlledEff = getDcEffect(controlledName);
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
      const tEff = getDcEffect(tDcName);
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
  // Per alexanbv 2026-05-13: keyed by controlledFigureKey (the figure
  // being controlled), not the group msgId. False Orders targets the
  // controlled figure's attack — for multifig groups this lock belongs
  // to that one figure.
  game.falseOrdersAttackTargets = game.falseOrdersAttackTargets || {};
  game.falseOrdersAttackTargets[controlledFigureKey] = foTargets;
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
 * Apply N damage to a figure via dcHealthState, syncing dcList. Returns { newHp, wasDefeated }.
 */
async function _applyHpDamage(game, dcHealthState, dcMessageMeta, figureKey, damage, ctx) {
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
  const { newHp, prevHp, wasDefeated } = await _applyDamage(game, { dcHealthState, logGameAction: ctx?.logGameAction, client: ctx?.client }, {
    figureKey, msgId: targetMsgId, figIndex,
    amount: damage, controllerPlayerNum: playerNum,
    source: 'Direct Damage',
  });
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
  // Rush may push a friendly OR hostile SMALL figure; resolve the target's
  // actual owning player rather than assuming it's the opponent.
  const oppNum = game.figurePositions?.[pending.playerNum]?.[targetFk]
    ? pending.playerNum
    : opponentPlayerNum(pending.playerNum);
  pending.targetPlayerNum = oppNum;
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
    const t = await _applyHpDamage(game, dcHealthState, dcMessageMeta, targetFk, 1, ctx);
    const a = await _applyHpDamage(game, dcHealthState, dcMessageMeta, pending.activatorFigureKey, 1, ctx);
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
  // Rush target may be friendly; use the resolved owner (set in
  // handleRushPushFig), falling back to a fresh lookup.
  const oppNum = pending.targetPlayerNum
    ?? (game.figurePositions?.[pending.playerNum]?.[targetFk] ? pending.playerNum : opponentPlayerNum(pending.playerNum));
  const { prevPos } = pushFigure(game, oppNum, targetFk, chosenSpace) || { prevPos: null };
  const targetName = dcNameFromFigureKey(targetFk);
  const pushed = chosenSpace !== (prevPos ? String(prevPos).toLowerCase() : null);
  // Apply 1 damage to both
  const t = await _applyHpDamage(game, dcHealthState, dcMessageMeta, targetFk, 1, ctx);
  const a = await _applyHpDamage(game, dcHealthState, dcMessageMeta, pending.activatorFigureKey, 1, ctx);
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
  // Check if target is SMALL AND push-eligible. Push-immune figures
  // (snowtroopers via Spiked Boots; Take Position round-flagged) are
  // immune to all push abilities except those from MASSIVE figures.
  // The activating figure (Shoulder Rush user) is the pusher; if
  // they're not MASSIVE the immunity blocks the push step (the
  // attack still happens).
  const effects = getDcEffects();
  const targetDcName = dcNameFromFigureKey(targetFk);
  const targetEff = effects?.[targetDcName];
  const targetKw = (targetEff?.keywords || []).map(k => String(k).toUpperCase());
  const isSmall = !targetKw.includes('LARGE') && !targetKw.includes('MASSIVE');
  // Pusher = activating figure on Shoulder Rush msgId.
  const activatorMeta = dcMessageMeta?.get?.(msgId);
  const pusherEff = activatorMeta?.dcName ? effects?.[activatorMeta.dcName] : null;
  const pusherIsMassive = (pusherEff?.keywords || []).some(k => String(k).toUpperCase() === 'MASSIVE');
  const targetSpikedBoots = (targetEff?.specialAbilityIds || []).includes('spiked_boots_snowtrooper');
  const targetTakePosition = !!game.roundPushImmuneUnlessMassive?.[targetFk];
  const pushImmune = (targetSpikedBoots || targetTakePosition) && !pusherIsMassive;
  if (!isSmall || pushImmune) {
    // Not SMALL or push-immune: grant free attack targeting this
    // figure, no push.
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    if (pending.activatorFigureKey) game.freeAttackBonusPending[pending.activatorFigureKey] = true;
    // Per alexanbv 2026-05-13: keyed by activator figureKey.
    game.forcedAttackTarget = game.forcedAttackTarget || {};
    if (pending.activatorFigureKey) game.forcedAttackTarget[pending.activatorFigureKey] = targetFk;
    const reason = !isSmall ? 'not SMALL' : 'push-immune';
    const logMsg = `**Shoulder Rush** — Targeting **${targetName}** (${reason}, no push). Attack that figure (free action).`;
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
    if (pending.activatorFigureKey) game.freeAttackBonusPending[pending.activatorFigureKey] = true;
    // Per alexanbv 2026-05-13: keyed by activator figureKey.
    game.forcedAttackTarget = game.forcedAttackTarget || {};
    if (pending.activatorFigureKey) game.forcedAttackTarget[pending.activatorFigureKey] = targetFk;
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
  // Grant free attack targeting the pushed figure.
  // Per alexanbv 2026-05-13: keyed by activator figureKey.
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  if (pending.activatorFigureKey) game.freeAttackBonusPending[pending.activatorFigureKey] = true;
  game.forcedAttackTarget = game.forcedAttackTarget || {};
  if (pending.activatorFigureKey) game.forcedAttackTarget[pending.activatorFigureKey] = targetFk;
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
  // Match figures by FOOTPRINT (Large/Massive figures occupy multiple cells, not
  // just their stored anchor) — spec: "each figure ON a chosen space suffers 2
  // Damage". Each figure is damaged at most once even if it covers multiple chosen
  // spaces. Mirror getFootprintCells usage elsewhere in this file.
  const chosenSet = new Set(pending.spacesChosen.map(s => String(s).toLowerCase()));
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn] || {};
    for (const [fk, pos] of Object.entries(positions)) {
      if (!pos) continue;
      const fkSize = game.figureOrientations?.[fk] || getFigureSize(dcNameFromFigureKey(fk)) || '1x1';
      const fpCells = getFootprintCells(String(pos).toLowerCase(), fkSize).map(c => String(c).toLowerCase());
      if (!fpCells.some(c => chosenSet.has(c))) continue;
      // Apply 2 damage to this figure
      const fkMsgId = findDcMessageIdForFigure?.(gameId, pn, fk);
      if (!fkMsgId) continue;
      const hs = dcHealthState?.get(fkMsgId) || [];
      const figMatch = fk.match(/-(\d+)-(\d+)$/);
      const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
      if (!hs[figIdx]) continue;
      // Full damage pipeline (alexanbv 2026-06-22): HP + defeat + when-damaged /
      // when-defeated timings (applyDamage finalizes defeat internally).
      const _ob = await _applyDamage(game, { dcHealthState, logGameAction, client: interaction.client }, {
        figureKey: fk, msgId: fkMsgId, figIndex: figIdx, amount: 2,
        controllerPlayerNum: pn, attackerPlayerNum,
        source: 'Orbital Bombardment',
      });
      const dcName = dcNameFromFigureKey(fk);
      damageLog.push(`**${dcName}** (${_ob.prevHp} → ${_ob.newHp} HP)${_ob.wasDefeated ? ' **(defeated)**' : ''}`);
    }
  }
  const spacesStr = pending.spacesChosen.map(s => s.toUpperCase()).join(', ');
  const resultStr = damageLog.length > 0 ? `Damage: ${damageLog.join(', ')}` : 'No figures on chosen spaces.';
  await interaction.message.edit({
    content: `**Orbital Bombardment** — Spaces: ${spacesStr}. Each figure suffers 2 Damage.\n${resultStr}`,
    components: [],
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Orbital Bombardment** — Bombarded spaces: ${spacesStr}. ${resultStr}`, { phase: 'ROUND', icon: 'attack' });
  // Defeats are finalized inside _applyDamage (full pipeline) — no manual loop.
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

  // Discard 1 explosive (per Bomb Drop card text). Figures may carry
  // multiple — decrement count, only fully delete the entry at zero.
  if (game.figureContraband?.[pending.figureKey]) {
    const _bdCur = typeof game.figureContraband[pending.figureKey] === 'number'
      ? game.figureContraband[pending.figureKey]
      : 1;
    if (_bdCur <= 1) delete game.figureContraband[pending.figureKey];
    else game.figureContraband[pending.figureKey] = _bdCur - 1;
  }

  // Find all spaces on/adjacent to chosen space
  const mapId = game.selectedMap?.id;
  const ms = getMapData?.(mapId);
  const adjSpaces = ms?.adjacency?.[chosenSpace] || [];
  const affectedSpaces = new Set([chosenSpace, ...adjSpaces.map(s => String(s).toLowerCase())]);

  // Apply 2 damage to each figure on affected spaces
  const damageLog = [];
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn] || {};
    for (const [fk, pos] of Object.entries(positions)) {
      if (!pos) continue;
      // Match by footprint so Large/Massive figures on/adjacent to the blast are hit.
      const fkSize = game.figureOrientations?.[fk] || getFigureSize(dcNameFromFigureKey(fk)) || '1x1';
      const fpCells = getFootprintCells(String(pos).toLowerCase(), fkSize).map(c => String(c).toLowerCase());
      if (!fpCells.some(c => affectedSpaces.has(c))) continue;
      const fkMsgId = findDcMessageIdForFigure?.(gameId, pn, fk);
      if (!fkMsgId) continue;
      const hs = dcHealthState?.get(fkMsgId) || [];
      const figMatch = fk.match(/-(\d+)-(\d+)$/);
      const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
      if (!hs[figIdx]) continue;
      // Full damage pipeline (alexanbv 2026-06-22): HP + defeat + timings.
      const _bd = await _applyDamage(game, { dcHealthState, logGameAction, client: interaction.client }, {
        figureKey: fk, msgId: fkMsgId, figIndex: figIdx, amount: 2,
        controllerPlayerNum: pn, attackerPlayerNum: pending.playerNum,
        source: 'Bomb Drop',
      });
      const dcName = dcNameFromFigureKey(fk);
      damageLog.push(`**${dcName}** (${_bd.prevHp} → ${_bd.newHp} HP)${_bd.wasDefeated ? ' **(defeated)**' : ''}`);
    }
  }
  const resultStr = damageLog.length > 0 ? `Damage: ${damageLog.join(', ')}` : 'No figures affected.';
  await interaction.message.edit({
    content: `**Bomb Drop** — Detonated at **${chosenSpace.toUpperCase()}**. Each figure on/adjacent suffers 2 Damage.\n${resultStr}`,
    components: [],
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Bomb Drop** — Detonated at **${chosenSpace.toUpperCase()}**. ${resultStr}`, { phase: 'ROUND', icon: 'attack' });
  // Defeats are finalized inside _applyDamage (full pipeline) — no manual loop.
  delete game.pendingBombDrop[msgId];
  saveGames(game.gameId);
}
