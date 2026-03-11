/**
 * DC Play Area handlers: dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { truncateLabel, getAttachmentSpecials } from '../discord/components.js';
import { bottomLeftCoord } from '../game/coords.js';
import { COLORS } from '../discord/colors.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import { getConfig } from '../game/figure-config.js';
import { getLoadoutCards } from '../data-loader.js';
import { reduceHp, awardObjectiveVp, applyCondition, filterCondition, dcNameFromFigureKey } from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId, getHandChannelId,
  getActivationsRemaining, getActivationsTotal, getActivatedDcIndices,
  setActivationsRemaining, setActivatedDcIndices,
  getCcHand, getCcDeck, getSquad,
  ccHandKey, ccDiscardKey, ccAttachmentsKey, dcAttachmentsKey, vpKey as vpKeyFn,
  opponentPlayerNum,
  getInitiativePlayerNum,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

/** Fury of Kashyyyk grants Reach to all friendly WOOKIEE DCs. */
function _hasFuryReach(game, playerNum, dcKws) {
  if (!dcKws?.some(k => k === 'WOOKIEE')) return false;
  const dcList = getDcList(game, playerNum) || [];
  return dcList.some(dc => dc.dcName === '[Fury of Kashyyyk]');
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
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
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
  const parts = interaction.customId.replace('dc_activate_', '').split('_');
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
  // Force Slow: if any figure of this DC is flagged to skip activation, block it
  if (game.forceSlowSkipActivation) {
    const _fsFigPos = game.figurePositions?.[playerNum] || {};
    for (const fk of Object.keys(_fsFigPos)) {
      if (!fk.startsWith(dcName + '-') || !_fsFigPos[fk]) continue;
      if (game.forceSlowSkipActivation[fk]) {
        delete game.forceSlowSkipActivation[fk];
        if (Object.keys(game.forceSlowSkipActivation).length === 0) delete game.forceSlowSkipActivation;
        await interaction.followUp({ content: `🐌 **Force Slow** — **${displayName}** must skip this activation.`, ephemeral: true }).catch(discordCatch);
        // Mark this DC as exhausted (skip activation counts as its activation)
        const activatedKey = `p${playerNum}ActivatedDcIndices`;
        game[activatedKey] = game[activatedKey] || [];
        if (!game[activatedKey].includes(dcIndex)) game[activatedKey].push(dcIndex);
        setActivationsRemaining(game, playerNum, getActivationsRemaining(game, playerNum) - 1);
        saveGames();
        return;
      }
    }
  }
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const isMyTurn = ownerId === turnPlayerId;
  if (!isMyTurn) {
    const playAreaCh = await client.channels.fetch(getPlayAreaId(game, playerNum));
    const promptRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_activate_${gameId}_${msgId}_${interaction.message.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_activate_${gameId}_${ownerId}`).setLabel('No').setStyle(ButtonStyle.Danger)
    );
    await playAreaCh.send({
      content: `<@${ownerId}> You are not first to act. Activate anyway?`,
      components: [promptRow],
      allowedMentions: { users: [ownerId] },
    });
    return;
  }
  try {
    const channel = await client.channels.fetch(getPlayAreaId(game, playerNum));
    const msg = await channel.messages.fetch(msgId);
    dcExhaustedState.set(msgId, true);
    const { embed, files } = await buildDcEmbedAndFiles(dcName, true, displayName, healthState, getConditionsForDcMessage?.(game, { dcName, displayName }), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
    await msg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, dcName) });
    const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
    const thread = await msg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
    game.movementBank = game.movementBank || {};
    const _pendingMp1 = game.pendingMpBonus?.[msgId] ?? 0;
    if (_pendingMp1) delete game.pendingMpBonus[msgId];
    game.movementBank[msgId] = { total: _pendingMp1, remaining: _pendingMp1, threadId: thread.id, messageId: null, displayName };
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };
    const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
    const actMinimap = await getActivationMinimapAttachment(game, msgId);
    const actionsPayload = {
      content: pingContent,
      components: getDcActionButtons(msgId, dcName, displayName, game.dcActionsData[msgId], game),
      allowedMentions: { users: [ownerId] },
    };
    if (actMinimap) actionsPayload.files = [actMinimap];
    const actionsMsg = await thread.send(actionsPayload);
    game.dcActionsData[msgId].messageId = actionsMsg.id;
    setActivationsRemaining(game, playerNum, getActivationsRemaining(game, playerNum) - 1);
    getActivatedDcIndices(game, playerNum).push(dcIndex);
    await updateActivationsMessage(game, playerNum, client);
    // Meditation: if this player has a deferred free attack (from Meditation CC) and this DC is FORCE USER, grant it
    if (game.nextActivationFreeAttack?.[playerNum]) {
      const _natEff = getDcEffects ? (getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')]) : null;
      const _natKws = (_natEff?.keywords || []).map((k) => String(k).toUpperCase());
      if (_natKws.includes('FORCE USER')) {
        const _natData = game.nextActivationFreeAttack[playerNum];
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[msgId] = true;
        if (_natData?.dice) {
          game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
          game.pendingOverrideAttackDice[msgId] = { type: _natData.melee ? 'Melee' : null, dice: _natData.dice, pierce: 0, bonusAccuracy: 0 };
        }
        delete game.nextActivationFreeAttack[playerNum];
        if (logGameAction) await logGameAction(game, client, `**Meditation** — **${displayName}** has a free Melee attack (1 red + 1 yellow) available this activation.`, { phase: 'ROUND', icon: 'card' });
      }
    }
    // Orbital Bombardment: if this DC has tokens, prompt to deplete at start of activation
    const _obTokens = game.orbitalBombardmentTokens?.[msgId] || 0;
    if (_obTokens > 0) {
      const _obAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      if (_obAtts.includes('Orbital Bombardment')) {
        const obRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ob_deplete_${gameId}_${msgId}`).setLabel(`Deplete OB: ${_obTokens} spaces, 2 dmg each`).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`ob_skip_${gameId}_${msgId}`).setLabel('Keep tokens').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({
          content: `**Orbital Bombardment** — You have **${_obTokens} Bombardment token${_obTokens > 1 ? 's' : ''}**. Deplete to choose ${_obTokens} space${_obTokens > 1 ? 's' : ''} — each figure on a chosen space suffers 2 Damage.`,
          components: [obRow],
        }).catch(discordCatch);
      }
    }
    // Overwatch: remind if token is placed (for interrupt awareness)
    const _owPos = game.overwatchTokenPosition?.[msgId];
    if (_owPos) {
      await thread.send(`**Overwatch** — Your token is at **${String(_owPos).toUpperCase()}**. Exhaust when a hostile enters a space on/adjacent to the token to interrupt and perform an attack.`).catch(discordCatch);
    }
    // Companion activation reminders (Clan of Two, Indentured Jester)
    const _cmpAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    if (_cmpAtts.includes('Clan of Two')) {
      await thread.send(`**Clan of Two** — **The Child** activates at the start or end of this activation. At the end, push The Child to your space or an adjacent space.`).catch(discordCatch);
    }
    if (_cmpAtts.includes('Indentured Jester')) {
      await thread.send(`**Indentured Jester** — **Salacious B. Crumb** activates at the start or end of this activation. (Not counted for control.)`).catch(discordCatch);
    }
    saveGames();
    const logCh = await client.channels.fetch(game.generalId);
    const icon = ACTION_ICONS.activate || '⚡';
    const pLabel = `P${playerNum}`;
    const logMsg = await logCh.send({
      content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
      allowedMentions: { users: [ownerId] },
    });
    game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
    game.dcActivationLogMessageIds[msgId] = logMsg.id;
    // Still Faster Than You: if the opponent has SFTY active, post an interrupt prompt in the thread
    if (game.stillFasterPlayerNum && game.stillFasterPlayerNum !== playerNum) {
      const sftPlayerNum = game.stillFasterPlayerNum;
      const sftOwnerId = getPlayerId(game, sftPlayerNum);
      const sftRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`still_faster_use_${gameId}_${msgId}`).setLabel('Use Still Faster Than You').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`still_faster_skip_${gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({
        content: `<@${sftOwnerId}> — **Still Faster Than You**: interrupt now (move 2 + attack a different hostile) or skip?`,
        components: [sftRow],
        allowedMentions: { users: [sftOwnerId] },
      }).catch(discordCatch);
      game.pendingStillFaster = { gameId, activatingMsgId: msgId, activatingPlayerNum: playerNum, sftPlayerNum };
    }
    // Auto-prompt opponent for hostile-activation reaction cards (Overcharged Weapons, etc.)
    try {
      const { getCcEffectsData } = await import('../data-loader.js');
      const ccCards = getCcEffectsData?.()?.cards || {};
      const oppNum = opponentPlayerNum(playerNum);
      const oppHand = getCcHand(game, oppNum) || [];
      const activationTimings = new Set(['whenEnemyFigureActivates', 'atStartOfHostileFigureActivation', 'atStartOfActivationOfHostileFigureInYourLineOfSight']);
      const reactCards = [...new Set(oppHand)].filter(c => ccCards[c]?.timing && activationTimings.has(ccCards[c].timing));
      if (reactCards.length) {
        const oppId = getPlayerId(game, oppNum);
        await thread.send({
          content: `<@${oppId}> — Hostile activated! You have ${reactCards.length} reaction card(s) playable now. Check your Hand channel.`,
          allowedMentions: { users: [oppId] },
        }).catch(discordCatch);
      }
    } catch (_actReactErr) {
      console.error('Activation reaction prompt error:', _actReactErr?.message ?? _actReactErr);
    }
    const activateRows = getActivateDcButtons(game, playerNum);
    await interaction.editReply({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(discordCatch);
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
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    updateActivationsMessage,
    saveGames,
    client,
  } = ctx;
  const msgId = interaction.customId.replace('dc_unactivate_', '');
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
  const displayName = meta.displayName || meta.dcName;
  dcExhaustedState.set(msgId, false);
  const total = getActivationsTotal(game, meta.playerNum);
  const remaining = getActivationsRemaining(game, meta.playerNum);
  if (remaining < total) {
    setActivationsRemaining(game, meta.playerNum, remaining + 1);
    const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
    if (dcIndex !== -1 && getActivatedDcIndices(game, meta.playerNum)) {
      setActivatedDcIndices(game, meta.playerNum, getActivatedDcIndices(game, meta.playerNum).filter((i) => i !== dcIndex));
    }
    await updateActivationsMessage(game, meta.playerNum, client);
  }
  const threadId = game.dcActionsData?.[msgId]?.threadId;
  if (threadId) {
    try {
      const thread = await client.channels.fetch(threadId);
      await thread.delete();
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
  if (game.pendingMissileSalvo?.[msgId]) delete game.pendingMissileSalvo[msgId];
  if (game.pendingEe3Carbine?.[msgId]) delete game.pendingEe3Carbine[msgId];
  // Stun: discarded at the end of the figure's activation
  if (game.figureConditions) {
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const stats = ctx.getDcStats ? ctx.getDcStats(meta.dcName) : {};
    const figures = stats.figures ?? 1;
    for (let f = 0; f < figures; f++) {
      const fk = `${meta.dcName}-${dgIndex}-${f}`;
      filterCondition(game, fk, 'Stun');
    }
  }
  if (game.dcActivationLogMessageIds?.[msgId]) {
    try {
      const logCh = await client.channels.fetch(game.generalId);
      const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
      await logMsg.delete().catch(discordCatch);
    } catch {}
    delete game.dcActivationLogMessageIds[msgId];
  }
  const healthState = dcHealthState.get(msgId) ?? [[null, null]];
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
  await interaction.message.edit({
    embeds: [embed],
    files,
    components: getDcPlayAreaComponents(msgId, false, game, meta.dcName),
  });
  saveGames();
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
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
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
  const msgId = interaction.customId.replace('dc_toggle_', '');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
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
      const playAreaCh = await client.channels.fetch(getPlayAreaId(game, meta.playerNum));
      const promptRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_activate_${game.gameId}_${msgId}_0`).setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_activate_${game.gameId}_${playerId}`).setLabel('No').setStyle(ButtonStyle.Danger)
      );
      await playAreaCh.send({
        content: `<@${playerId}> You are not first to act. Activate anyway?`,
        components: [promptRow],
        allowedMentions: { users: [playerId] },
      });
      return;
    }
    dcExhaustedState.set(msgId, true);
    const remaining = getActivationsRemaining(game, meta.playerNum);
    if (remaining > 0) {
      setActivationsRemaining(game, meta.playerNum, remaining - 1);
      const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
      if (dcIndex !== -1) {
        const indices = getActivatedDcIndices(game, meta.playerNum) || [];
        setActivatedDcIndices(game, meta.playerNum, indices);
        indices.push(dcIndex);
      }
      await updateActivationsMessage(game, meta.playerNum, client);
      const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
      const thread = await interaction.message.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
      game.movementBank = game.movementBank || {};
      const _pendingMp2 = game.pendingMpBonus?.[msgId] ?? 0;
      if (_pendingMp2) delete game.pendingMpBonus[msgId];
      game.movementBank[msgId] = { total: _pendingMp2, remaining: _pendingMp2, threadId: thread.id, messageId: null, displayName };
      game.dcActionsData = game.dcActionsData || {};
      game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };
      const pingContent = `<@${getPlayerId(game, meta.playerNum)}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
      const actMinimap = await getActivationMinimapAttachment(game, msgId);
      const actionsPayload = {
        content: pingContent,
        components: getDcActionButtons(msgId, meta.dcName, displayName, game.dcActionsData[msgId], game),
        allowedMentions: { users: [getPlayerId(game, meta.playerNum)] },
      };
      if (actMinimap) actionsPayload.files = [actMinimap];
      const actionsMsg = await thread.send(actionsPayload);
      game.dcActionsData[msgId].messageId = actionsMsg.id;
      const logCh = await client.channels.fetch(game.generalId);
      const icon = ACTION_ICONS.activate || '⚡';
      const pLabel = `P${meta.playerNum}`;
      const logMsg = await logCh.send({
        content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${playerId}> activated **${displayName}**!`,
        allowedMentions: { users: [playerId] },
      });
      game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
      game.dcActivationLogMessageIds[msgId] = logMsg.id;
    }
  }
  if (wasExhausted && !nowExhausted) {
    dcExhaustedState.set(msgId, false);
    const total = getActivationsTotal(game, meta.playerNum);
    const remaining = getActivationsRemaining(game, meta.playerNum);
    if (remaining < total) {
      setActivationsRemaining(game, meta.playerNum, remaining + 1);
      const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
      if (dcIndex !== -1 && getActivatedDcIndices(game, meta.playerNum)) {
        setActivatedDcIndices(game, meta.playerNum, getActivatedDcIndices(game, meta.playerNum).filter((i) => i !== dcIndex));
      }
      await updateActivationsMessage(game, meta.playerNum, client);
    }
    const threadId = game.dcActionsData?.[msgId]?.threadId;
    if (threadId) {
      try {
        const thread = await client.channels.fetch(threadId);
        await thread.delete();
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
        const logCh = await client.channels.fetch(game.generalId);
        const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
        await logMsg.delete().catch(discordCatch);
      } catch {}
      delete game.dcActivationLogMessageIds[msgId];
    }
  }
  saveGames();
  if (!nowExhausted) {
    const pLabel = `P${meta.playerNum}`;
    await logGameAction(game, client, `**${pLabel}:** <@${playerId}> readied **${displayName}**`, { allowedMentions: { users: [playerId] }, icon: 'ready' });
  }
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, nowExhausted, displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
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
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    logGameAction,
    saveGames,
    client,
  } = ctx;
  const msgId = interaction.customId.replace('dc_deplete_', '');
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
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, displayName, [], getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []));
  embed.setTitle(`REMOVED FROM GAME (Depleted) — ${displayName}`);
  embed.setDescription((embed.data.description || '') + '\n\n*This upgrade was depleted and is no longer in play (one-time use).*');
  embed.setColor(COLORS.GRAY);
  await interaction.message.edit({ embeds: [embed], files, components: [] });
  await logGameAction(game, client, `**P${meta.playerNum}:** <@${ownerId}> depleted **${displayName}** — removed from game`, { allowedMentions: { users: [ownerId] }, icon: 'deplete' });
  saveGames();
}

/**
 * Show a modal to rename figures in a multi-figure DC (deployment phase only).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcRename(interaction, ctx) {
  const { dcMessageMeta, getDcStats, FIGURE_LETTERS } = ctx;
  const msgId = interaction.customId.replace('dc_rename_', '');
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
  const rest = interaction.customId.replace(idPrefix, '');
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
  const handChannel = await interaction.client.channels.fetch(handChannelId);
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
  await updateHandVisualMessage(game, meta.playerNum, interaction.client);
  await updateDiscardPileMessage(game, meta.playerNum, interaction.client);
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
          const _logCh = await interaction.client.channels.fetch(game.generalId).catch(() => null);
          if (_logCh) await _logCh.send({ embeds: [_embed], files: [new _AB(_imgPath, { name: _fn })] }).catch(discordCatch);
        }
      } catch (err) {
        console.error('[cc-image-log]', err?.message ?? err);
      }
    }
  }
  if (enteringNegation) {
    game.pendingNegation = { playedBy: meta.playerNum, card, fromDc: true, msgId, wasAttachment: isCcAttachment(card), handChannelId };
    const oppNum = opponentPlayerNum(meta.playerNum);
    const oppHandId = getHandChannelId(game, oppNum);
    const oppHandChannel = await interaction.client.channels.fetch(oppHandId).catch(() => null);
    if (oppHandChannel) {
      const oppId = getPlayerId(game, oppNum);
      await oppHandChannel.send({
        content: `<@${oppId}> Your opponent played **${card}** (cost 0). You may play **Negation** to cancel it.`,
        components: [ctx.getNegationResponseButtons(game.gameId)],
        allowedMentions: { users: [oppId] },
      }).catch(discordCatch);
    }
    const waitingMsg = await handChannel.send({
      content: `⏳ **${card}** played — waiting for opponent to respond (Negation window open). You'll be notified here when it resolves.`,
    }).catch(() => null);
    if (waitingMsg) game.pendingNegation.waitingMsgId = waitingMsg.id;
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
    saveGames();
    return;
  }
  if (ctx.resolveAbility) {
    const abilityId = effectData?.abilityId ?? card;
    const result = ctx.resolveAbility(abilityId, { game, playerNum: meta.playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, msgId });
    if (result.requiresChoice && result.choiceOptions?.length > 0) {
      // Choice required: set up pending state and send choice buttons to hand channel
      game.pendingCcChoice = { abilityId, choiceOptions: result.choiceOptions, gameId: game.gameId, playerNum: meta.playerNum, ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}) };
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
      const handCh = await interaction.client.channels.fetch(handChannelId);
      await handCh.send({ content: `**Choose one** (for **${card}**):`, components: rows }).catch(discordCatch);
    } else {
      await applyAbilityResult(result, { game, playerNum: meta.playerNum, msgId, client: interaction.client, ctx });
      if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
        const threadId = game.dcActionsData?.[msgId]?.threadId;
        if (threadId) {
          game.pendingPowerTokenGrant.channelId = threadId;
          const ptThread = await interaction.client.channels.fetch(threadId).catch(() => null);
          if (ptThread) {
            const { grants } = game.pendingPowerTokenGrant;
            const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
            const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
            const btns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
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
  // Bleeding: trigger after action-consuming CC plays (Special Action or Double Action)
  if ((timingLabel === 'Special Action' || timingLabel === 'Double Action') && ctx.sendBleedingPrompt) {
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFigure}`;
    if ((game.figureConditions?.[figureKey] || []).includes('Bleed')) {
      await ctx.sendBleedingPrompt(game, interaction.channel, figureKey, meta.playerNum, meta.displayName || meta.dcName);
    }
  }
  saveGames();
}

/**
 * Single handler for dc_move_, dc_attack_, dc_interact_, dc_special_ (branches on customId).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 * @param {string} buttonKey - 'dc_move_' | 'dc_attack_' | 'dc_interact_' | 'dc_special_'
 */
/** Build options for the Arsenal die-selection select menu. */
function buildArsenalSelectOptions(diceCount) {
  const colors = ['red', 'blue', 'yellow', 'green'];
  const labels = { red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green' };
  const options = [];
  if (diceCount === 2) {
    for (let i = 0; i < colors.length; i++) {
      for (let j = i; j < colors.length; j++) {
        const c1 = colors[i], c2 = colors[j];
        options.push({ label: `${labels[c1]} + ${labels[c2]}`, value: `${c1},${c2}`, description: `Roll 1 ${labels[c1]} and 1 ${labels[c2]} die` });
      }
    }
  } else {
    // 3 dice, no more than 2 of same color
    for (let i = 0; i < colors.length; i++) {
      for (let j = i; j < colors.length; j++) {
        for (let k = j; k < colors.length; k++) {
          const c1 = colors[i], c2 = colors[j], c3 = colors[k];
          if (c1 === c2 && c2 === c3) continue;
          options.push({ label: `${labels[c1]} + ${labels[c2]} + ${labels[c3]}`, value: `${c1},${c2},${c3}`, description: `Roll those 3 dice` });
        }
      }
    }
  }
  return options;
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
  const abilityTextLower = (stats.abilityText || '').toLowerCase();
  const attackerIgnoresFigureBlocking =
    (abilityTextLower.includes('priority target') && abilityTextLower.includes('line of sight')) ||
    attackerKws.includes('MASSIVE');
  // Build effective mapSpaces: merge closed doors + energy shields into LOS-blocking data.
  // Doors block LOS (rules: "Doors block line of sight and adjacency", p.27).
  // Energy shields block LOS but not movement (rules: "A space containing an energy shield blocks LOS", p.29).
  let effectiveMs = ms;
  {
    const losMapId = game.selectedMap?.id;
    const allDoors = (getMapTokensData && losMapId) ? (getMapTokensData()[losMapId]?.doors || []) : [];
    const openedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
    const closedEdges = allDoors.filter(e => {
      const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
      return !openedSet.has(`${a}|${b}`) && !openedSet.has(`${b}|${a}`);
    });
    const shieldSpaces = (game.ancillaryTokens?.energyShield || []).map(s => String(s).toLowerCase());
    if (closedEdges.length > 0 || shieldSpaces.length > 0) {
      effectiveMs = {
        ...ms,
        impassableEdges: closedEdges.length > 0 ? [...(ms?.impassableEdges || []), ...closedEdges] : ms?.impassableEdges,
        blocking: shieldSpaces.length > 0 ? [...(ms?.blocking || []), ...shieldSpaces] : ms?.blocking,
      };
    }
  }
  // attackerSize needed both for figureBlockingCoords exclusion and for multi-cell LOS.
  const attackerSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
  const attackerFpCells = getFootprintCells(attackerPos, attackerSize);
  let allFigureBlockingCoords = null;
  // Marksman CC card: figures do not block LOS for this attack
  const marksmanActive = game.nextAttackIgnoreFigureLOS?.[msgId];
  if (marksmanActive) {
    delete game.nextAttackIgnoreFigureLOS[msgId];
    // allFigureBlockingCoords stays null — figures don't block LOS
  } else if (!attackerIgnoresFigureBlocking) {
    allFigureBlockingCoords = new Set();
    const attackerFpSet = new Set(attackerFpCells.map(c => String(c).toLowerCase()));
    for (const poses_ of [game.figurePositions?.[playerNum] || {}, game.figurePositions?.[enemyPlayerNum] || {}]) {
      for (const [fk, pos] of Object.entries(poses_)) {
        if (!pos || attackerFpSet.has(String(pos).toLowerCase())) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffects()[fkDcName] || getDcEffects()[fkDcName.replace(/\s*\[.*\]\s*$/, '')];
        if (fkEff?.companion === true) continue; // companions don't block LOS (rules: "non-companion figure")
        if ((fkEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) continue;
        const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDcName);
        for (const cell of getFootprintCells(pos, fkSize)) allFigureBlockingCoords.add(String(cell).toLowerCase());
      }
    }
  }
  const targets = [];
  const poses = game.figurePositions?.[enemyPlayerNum] || {};
  const dcList = getSquad(game, enemyPlayerNum)?.dcList || [];
  const totals = {};
  for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
  for (const [k, coord] of Object.entries(poses)) {
    const targetCondsList = game.figureConditions?.[k] || [];
    if (targetCondsList.includes('Hide')) continue;
    const vanishImmunity = game.vanishImmunityUntilNextActivation?.[enemyPlayerNum];
    if (vanishImmunity) {
      const vanishMeta = dcMessageMeta.get(vanishImmunity.msgId);
      if (vanishMeta && k.startsWith(`${vanishMeta.dcName}-`)) continue;
    }
    const dcName = dcNameFromFigureKey(k);
    const size = game.figureOrientations?.[k] || getFigureSize(dcName);
    const cells = getFootprintCells(coord, size);
    const dist = Math.min(...attackerFpCells.flatMap(ac => cells.map(tc => getRange(ac, tc))));
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
    const m = k.match(/-(\d+)-(\d+)$/);
    const dg = m ? parseInt(m[1], 10) : 1;
    const fi = m ? parseInt(m[2], 10) : 0;
    const figCount = getDcStats(dcName).figures ?? 1;
    const label = figCount > 1 ? `${dg}${FIGURE_LETTERS[fi] || 'a'}` : (totals[dcName] > 1 ? `${dcName} [DG ${dg}]` : dcName);
    targets.push({ figureKey: k, coord, label, hasLOS: los, dist });
  }
  // Missile Salvo: filter out already-targeted figures
  if (excludeFigureKeys?.length) {
    const excluded = new Set(excludeFigureKeys);
    targets.splice(0, targets.length, ...targets.filter(t => !excluded.has(t.figureKey)));
  }
  // NPC targets: thugs (Corellian A) and Krykna (Chopper A) — added after player targets
  // Lazy-init NPC arrays if not yet created (so players can attack them before the first EoR)
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (getMapTokensData && mapId) {
    if (!game.npcThugs && mapId === 'corellian-underground' && variant === 'a') {
      const positions = Object.values(getMapTokensData()[mapId]?.missionA?.positions || {}).flat().filter(Boolean);
      if (positions.length > 0) game.npcThugs = positions.map((coord, i) => ({ id: `thug-${i + 1}`, coord: String(coord).toLowerCase(), hp: 4, maxHp: 4, defeated: false }));
    }
    if (!game.npcKrykna && mapId === 'chopper-base-atollon' && variant === 'a') {
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
      const dist = Math.min(...attackerFpCells.map(ac => getRange(ac, coord)));
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
      const dist = Math.min(...attackerFpCells.map(ac => getRange(ac, coord)));
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
    const _chainFiltered = targets.filter(t => getRange(_chainSpace, t.coord) <= 3);
    if (_chainFiltered.length > 0) targets.splice(0, targets.length, ..._chainFiltered);
    delete game.autofireChainTargetSpace[msgId];
  }
  if (targets.length === 0) {
    await interaction.followUp({ content: 'No valid targets in range.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const displayName = meta.displayName || meta.dcName;
  const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
  const targetRows = [];
  for (let i = 0; i < targets.length; i += 5) {
    const chunk = targets.slice(i, i + 5);
    targetRows.push(
      new ActionRowBuilder().addComponents(
        chunk.map((t, idx) => {
          const targetIndex = i + idx;
          const noLOS = t.hasLOS === false;
          return new ButtonBuilder()
            .setCustomId(`attack_target_${msgId}_${figureIndex}_${targetIndex}`)
            .setLabel(`${t.label} (${t.coord.toUpperCase()})${noLOS ? ' [No LOS]' : ''}`.slice(0, 80))
            .setStyle(noLOS ? ButtonStyle.Secondary : ButtonStyle.Danger)
            .setDisabled(noLOS);
        })
      )
    );
  }
  game.attackTargets = game.attackTargets || {};
  game.attackTargets[`${msgId}_${figureIndex}`] = targets;
  await interaction.followUp({
    content: `**Attack** — Choose target for **${figLabel}**:`,
    components: targetRows.slice(0, 5),
    ephemeral: false,
  }).catch(discordCatch);
}

export async function handleDcAction(interaction, ctx, buttonKey) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    getDcStats,
    getDcEffects,
    getMapSpaces,
    getFigureSize,
    getFootprintCells,
    getRange,
    hasLineOfSight,
    getEffectiveSpeed,
    ensureMovementBankMessage,
    getBoardStateForMovement,
    getMovementProfile,
    computeMovementCache,
    buildLetterRows,
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
    getSpaceChoiceRows,
    getMapAttachmentForSpaces,
    pushUndo,
  } = ctx;

  let msgId, action, figureIndex = 0, specialIdx = -1;
  if (buttonKey === 'dc_move_') {
    const m = interaction.customId.match(/^dc_move_(.+)_f(\d+)$/);
    msgId = m ? m[1] : interaction.customId.replace('dc_move_', '');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'Move';
  } else if (buttonKey === 'dc_attack_') {
    const m = interaction.customId.match(/^dc_attack_(.+)_f(\d+)$/);
    msgId = m ? m[1] : interaction.customId.replace('dc_attack_', '');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'Attack';
  } else if (buttonKey === 'dc_interact_') {
    const m = interaction.customId.match(/^dc_interact_(.+)_f(\d+)$/);
    msgId = m ? m[1] : interaction.customId.replace('dc_interact_', '');
    figureIndex = m ? parseInt(m[2], 10) : 0;
    action = 'Interact';
  } else {
    const parts = interaction.customId.replace('dc_special_', '').split('_');
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
  if (actionsRemaining <= 0 && !hasFellSwoopFreeAttack && !hasPummelFreeAttack) {
    await interaction.followUp({ content: 'No actions remaining this activation (2 per DC).', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (buttonKey === 'dc_special_') {
    const parts = interaction.customId.replace('dc_special_', '').split('_');
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

  if (action === 'Move') {
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
      const speed = getEffectiveSpeed(meta.dcName, figureKey, game, playerNum);
      const bank = game.movementBank?.[msgId];
      const currentMp = bank?.remaining ?? 0;
      let mpRemaining = currentMp + speed;
      const displayName = meta.displayName || meta.dcName;
      const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
      game.movementBank = game.movementBank || {};
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
      const actData = game.dcActionsData?.[msgId];
      const isExecOrderFreeMove = game.pendingExecutiveOrder?.forMsgId === msgId;
      if (isExecOrderFreeMove) {
        delete game.pendingExecutiveOrder;
      } else if (actData) {
        actData.remaining = Math.max(0, actData.remaining - 1);
        await updateDcActionsMessage(game, msgId, client);
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
        pendingBleed: (game.figureConditions?.[figureKey] || []).includes('Bleed'),
      };
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
      const minimapCells = isMultiTile
        ? buttonSpaces.map((tl) => bottomLeftCoord(tl, profile.size))
        : buttonSpaces;
      const moveMinimap = await getMovementMinimapAttachment(game, msgId, figureKey, minimapCells);
      const letterRows = buildLetterRows(buttonSpaces, msgId, figureIndex);
      const manualPickRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
          .setLabel('🗺️ Pick Path Manually')
          .setStyle(ButtonStyle.Secondary)
      );
      const firstRows = [...letterRows.slice(0, 4), manualPickRow];
      const firstPayload = {
        content: `**Move** — Pick a column (**${mpRemaining}** MP remaining):${multiTileNote}`,
        components: firstRows,
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
      if (!isFreeAttack) {
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
    const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
    const [minRange, maxRange] = attackInfo.range || [1, 3];
    // Reach: melee figure can target 1–2 spaces away; no accuracy check (still counts as melee)
    const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
    // Reach from DC passives, keywords, CC-granted, loadout card (Electrostaff), or Fury of Kashyyyk (WOOKIEE)
    const _loadoutCard = getLoadoutCards()[getConfig(game, figureKey)?.loadout];
    const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[playerNum] || _loadoutCard?.passive === 'Reach' || _hasFuryReach(game, playerNum, attackerKws);
    const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
    const ms = getMapSpaces(game.selectedMap?.id);
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
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`arsenal_pick_${meta.gameId}_${msgId}_${figureIndex}`)
          .setPlaceholder(`Choose ${diceCount} attack dice…`)
          .addOptions(buildArsenalSelectOptions(diceCount))
      );
      await interaction.followUp({
        content: `**${displayName_} — ${abilityName}**: Choose your ${diceCount} attack dice:`,
        components: [selectRow],
        ephemeral: false,
      }).catch(discordCatch);
      return;
    }
    // EE-3 Carbine (Boba Fett): spend 2 MP to change one attack die to red (limit once per attack)
    const hasEe3Carbine = atkSpecialIds.includes('ee3_carbine');
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
          saveGames();
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
        saveGames();
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
    const rows = [];
    for (let i = 0; i < sorted.length; i += 5) {
      const chunk = sorted.slice(i, i + 5);
      rows.push(
        new ActionRowBuilder().addComponents(
          chunk.map((opt) =>
            new ButtonBuilder()
              .setCustomId(`interact_choice_${game.gameId}_${msgId}_${figureIndex}_${opt.id}`)
              .setLabel(truncateLabel(opt.label))
              .setStyle(opt.missionSpecific ? ButtonStyle.Primary : ButtonStyle.Secondary)
          )
        )
      );
    }
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
        saveGames();
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
      saveGames();
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
      saveGames();
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
        saveGames();
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
          if (_suUpgrades.includes(su)) {
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
        saveGames();
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
      saveGames();
      return;
    }

    // Z-6 Trooper Autofire: perform an attack (defender +1 white die, surge: chain attack within 3)
    if (_suHandler === 'Autofire') {
      game.autofireActive = game.autofireActive || {};
      game.autofireActive[msgId] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Autofire' };
      await thread.send(`**Autofire** — Your next attack: defender adds **1 white die**. Surge: **Chain attack** targeting a figure within 3 of target space.`).catch(discordCatch);
      saveGames();
      return;
    }

    // Mortar Trooper Fire Mission: double-action attack with LOS from any group figure + Blast 1
    if (_suHandler === 'Fire Mission') {
      game.fireMissionActive = game.fireMissionActive || {};
      game.fireMissionActive[msgId] = true;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Fire Mission' };
      await thread.send(`**Fire Mission** — Your next attack: LOS from **any figure in this group** (range from acting figure). **+Blast 1**.`).catch(discordCatch);
      saveGames();
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
      saveGames();
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
      saveGames();
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
        saveGames();
        return;
      }
      const mapId = game.selectedMap?.id;
      const ms = getMapSpaces(mapId);
      if (!ms?.adjacency) {
        await thread.send('**Overwatch** — Map data not available.').catch(discordCatch);
        saveGames();
        return;
      }
      // Build LOS-valid spaces (all map spaces with LOS from this figure)
      const allSpaces = Object.keys(ms.adjacency || {});
      const losValid = [];
      for (const sp of allSpaces) {
        if (sp === String(pos).toLowerCase()) continue;
        if (hasLineOfSight && hasLineOfSight(pos, sp, ms, null)) losValid.push(sp);
      }
      if (losValid.length === 0) {
        await thread.send('**Overwatch** — No valid spaces in LOS to place the token.').catch(discordCatch);
        saveGames();
        return;
      }
      // Store pending state and show space picker
      game.pendingOverwatchPlacement = game.pendingOverwatchPlacement || {};
      game.pendingOverwatchPlacement[msgId] = { playerNum: meta.playerNum, figureKey: figKey };
      const spaceRows = getSpaceChoiceRows(`overwatch_space_${game.gameId}_${msgId}_`, losValid, ms);
      const owComponents = spaceRows.overflowed
        ? [ctx.buildSpaceSelectMenu('overwatch_space_sel_', `${game.gameId}_${msgId}`, spaceRows.available)]
        : spaceRows.rows.slice(0, 5);
      await thread.send({
        content: `**Overwatch** — Choose a space within LOS to place your Overwatch token:`,
        components: owComponents,
      }).catch(discordCatch);
      saveGames();
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
      saveGames();
      return;
    }
    const pos = game.figurePositions?.[meta.playerNum]?.[figKey];
    if (!pos) {
      await thread.send('**Bomb Drop** — Figure has no position.').catch(discordCatch);
      saveGames();
      return;
    }
    const mapId = game.selectedMap?.id;
    const ms = getMapSpaces(mapId);
    if (!ms?.adjacency) {
      await thread.send('**Bomb Drop** — Map data not available.').catch(discordCatch);
      saveGames();
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
      saveGames();
      return;
    }
    game.pendingBombDrop = game.pendingBombDrop || {};
    game.pendingBombDrop[msgId] = { playerNum: meta.playerNum, figureKey: figKey };
    const spaceRows = getSpaceChoiceRows(`bomb_drop_space_${game.gameId}_${msgId}_`, validSpaces, ms);
    const bdComponents = spaceRows.overflowed
      ? [ctx.buildSpaceSelectMenu('bomb_drop_space_sel_', `${game.gameId}_${msgId}`, spaceRows.available)]
      : spaceRows.rows.slice(0, 5);
    await thread.send({
      content: `**Bomb Drop** — Choose a space within 3 to detonate (2 Damage to all figures on/adjacent):`,
      components: bdComponents,
    }).catch(discordCatch);
    saveGames();
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
    hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapSpaces: ctx.getMapSpaces,
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
    const rows = [];
    for (let i = 0; i < choiceButtons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(choiceButtons.slice(i, i + 5)));
    }
    game.pendingDcAbilityChoice = game.pendingDcAbilityChoice || {};
    game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`] = {
      gameId: game.gameId, playerNum: meta.playerNum, abilityId, msgId, figureIndex, specialIdx,
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
    await interaction.followUp({ content: `**${action}** — Choose one:`, components: rows.slice(0, 5), ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }
  // Handle space-choice abilities (e.g. Pounce teleport destination)
  if (resolveResult.requiresSpaceChoice && Array.isArray(resolveResult.validSpaces) && resolveResult.validSpaces.length > 0) {
    if (getSpaceChoiceRows && getMapAttachmentForSpaces) {
      const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
      const mapSpaces = boardState?.mapSpaces || { spaces: resolveResult.validSpaces };
      const { rows, available, overflowed } = getSpaceChoiceRows(`pounce_space_${game.gameId}_${msgId}_${figureIndex}_`, resolveResult.validSpaces, mapSpaces);
      const mapAttachment = await getMapAttachmentForSpaces(game, resolveResult.validSpaces);
      game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
      game.pendingPounceSpaceChoice[msgId] = { gameId: game.gameId, playerNum: meta.playerNum, figureIndex, msgId, abilityId, specialIdx, validSpaces: resolveResult.validSpaces, targetFigureKey: resolveResult.targetFigureKey || null };
      const spacePickLabel = resolveResult.spaceChoiceLabel || `**Pounce** — Pick a space to place your figure:`;
      const pounceComponents = overflowed
        ? [ctx.buildSpaceSelectMenu('pounce_space_sel_', `${game.gameId}_${msgId}_${figureIndex}`, available)]
        : rows.slice(0, 5);
      const payload = { content: spacePickLabel, components: pounceComponents, ephemeral: false, fetchReply: true };
      if (mapAttachment) payload.files = [mapAttachment];
      await interaction.followUp(payload).catch(discordCatch);
      saveGames();
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
      const salvoThread = threadId ? await client.channels.fetch(threadId).catch(() => null) : null;
      const salvoMsg = `<@${ownerId}> **Missile Salvo** — Choose a die for your next ranged attack (+3 Accuracy, different targets). ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining.`;
      if (salvoThread) {
        await salvoThread.send({ content: salvoMsg, components: [new AR().addComponents(btns)], allowedMentions: { users: [ownerId] } }).catch(discordCatch);
      } else {
        await interaction.followUp({ content: salvoMsg, components: [new AR().addComponents(btns)], allowedMentions: { users: [ownerId] }, ephemeral: false }).catch(discordCatch);
      }
      saveGames();
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
      const ptThread = await client.channels.fetch(threadId).catch(() => null);
      if (ptThread) {
        const { grants } = game.pendingPowerTokenGrant;
        const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
        const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
        const btns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
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
  const manualMsg = resolveResult.manualMessage || 'Resolve manually (see rules).';
  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special_done_${game.gameId}_${msgId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success)
  );
  await interaction.followUp({
    content: `**${action}** — ${resolveResult.applied ? 'Resolved.' : manualMsg} Click **Done** when finished.`,
    components: [doneRow],
    ephemeral: false,
  }).catch(discordCatch);
  // Bleeding: trigger after DC Special action resolves
  if (buttonKey === 'dc_special_' && ctx.sendBleedingPrompt) {
    const selectedFigure = actionsData?.selectedFigure ?? 0;
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFigure}`;
    if ((game.figureConditions?.[figureKey] || []).includes('Bleed')) {
      await ctx.sendBleedingPrompt(game, interaction.channel, figureKey, meta.playerNum, displayName);
    }
  }
  saveGames();
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
  const { getGame, dcMessageMeta, dcHealthState, resolveAbility, updateDcActionsMessage, saveGames, client, getSpaceChoiceRows, getMapAttachmentForSpaces, getBoardStateForMovement } = ctx;
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
    const commonCtx = { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapSpaces: ctx.getMapSpaces, findDcMessageIdForFigure: ctx.findDcMessageIdForFigure, getDcEffects: ctx.getDcEffects };
    const r0 = resolveAbility(abilityId, { ...commonCtx, choiceIndex: 0 });
    const r1 = resolveAbility(abilityId, { ...commonCtx, choiceIndex: 1 });
    delete game.wreakVengeanceActive;
    const logParts = [r0.logMessage, r1.logMessage].filter(Boolean);
    const wvLog = `**Wreak Vengeance** — Both Dual-Bladed Fury effects applied:\n${logParts.join('\n')}`;
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: wvLog, ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  const resolveResult = resolveAbility ? resolveAbility(abilityId, {
    game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, choiceIndex,
    targetFigureKey: targetFigureKeys?.[choiceIndex] || null,
    hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapSpaces: ctx.getMapSpaces,
    findDcMessageIdForFigure: ctx.findDcMessageIdForFigure, getDcEffects: ctx.getDcEffects,
  }) : { applied: false, manualMessage: 'Resolve manually.' };

  // False Orders Phase 2: figure chosen → show Move/Attack choice buttons
  if (!resolveResult.applied && resolveResult.falseOrdersActionPick) {
    const fo = game.pendingFalseOrders;
    if (!fo) {
      await interaction.followUp({ content: 'False Orders state lost.', ephemeral: true }).catch(discordCatch);
      saveGames();
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
    saveGames();
    return;
  }

  // Lure of the Dark Side Phase 2: hostile chosen → directly enter attack flow (Lure = attack only)
  if (resolveResult.applied && resolveResult.lureActionPick) {
    const lure = game.pendingLure;
    if (!lure) {
      await interaction.followUp({ content: 'Lure state lost.', ephemeral: true }).catch(discordCatch);
      saveGames();
      return;
    }
    // Convert pendingLure to pendingFalseOrders format for combat reuse
    game.pendingFalseOrders = {
      controlledFigureKey: lure.controlledFigureKey,
      controlledPlayerNum: lure.controlledPlayerNum,
      controllerPlayerNum: lure.controllerPlayerNum,
      maxRange: lure.maxRange || 4,
      postAttackStrain: lure.postAttackStrain || 2,
      isLure: true,
    };
    delete game.pendingLure;
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
      content: `**Lure of the Dark Side** — **${controlledName}** gained 2 Hit Tokens. Choose a target to attack (within 4 spaces):`,
      components: [new ActionRowBuilder().addComponents(atkBtn, skipBtn)],
      ephemeral: false,
    }).catch(discordCatch);
    saveGames();
    return;
  }

  // Push ability Phase 2: figure chosen, now pick landing space
  if (!resolveResult.applied && resolveResult.requiresSpaceChoice && Array.isArray(resolveResult.validSpaces) && resolveResult.validSpaces.length > 0) {
    if (getSpaceChoiceRows && getMapAttachmentForSpaces) {
      const boardState = getBoardStateForMovement ? getBoardStateForMovement(game, null) : null;
      const mapSpaces = boardState?.mapSpaces || {};
      const { rows, available, overflowed } = getSpaceChoiceRows(`pounce_space_${game.gameId}_${msgId}_${figureIndex}_`, resolveResult.validSpaces, mapSpaces);
      const mapAttachment = await getMapAttachmentForSpaces(game, resolveResult.validSpaces);
      game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
      game.pendingPounceSpaceChoice[msgId] = { gameId: game.gameId, playerNum, figureIndex, msgId, abilityId, validSpaces: resolveResult.validSpaces, targetFigureKey: resolveResult.targetFigureKey || null };
      const spacePickLabel = resolveResult.spaceChoiceLabel || `Pick a landing space:`;
      const pounce2Components = overflowed
        ? [ctx.buildSpaceSelectMenu('pounce_space_sel_', `${game.gameId}_${msgId}_${figureIndex}`, available)]
        : rows.slice(0, 5);
      const payload = { content: spacePickLabel, components: pounce2Components, ephemeral: false };
      if (mapAttachment) payload.files = [mapAttachment];
      await interaction.followUp(payload).catch(discordCatch);
      saveGames();
      return;
    }
    // Fallback if space choice helpers not available
    await interaction.followUp({ content: `${resolveResult.spaceChoiceLabel || 'Pick a landing space'} (resolve manually — space picker unavailable).`, ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  // Multi-step choice (e.g., Trample multi-target): re-present choice buttons if ability needs more picks
  if (!resolveResult.applied && resolveResult.requiresChoice && Array.isArray(resolveResult.choiceOptions) && resolveResult.choiceOptions.length > 0) {
    game.pendingDcAbilityChoice = game.pendingDcAbilityChoice || {};
    game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`] = {
      gameId, playerNum, abilityId, msgId, figureIndex, specialIdx,
      targetFigureKeys: resolveResult.targetFigureKeys || null,
    };
    const choiceButtons = resolveResult.choiceOptions.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`dc_ability_choice_${gameId}_${msgId}_${specialIdx}_${i}`)
        .setLabel(String(label).slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    const rows = [];
    for (let i = 0; i < choiceButtons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(choiceButtons.slice(i, i + 5)));
    }
    const prompt = resolveResult.choicePrompt || `**${abilityId}** — Choose:`;
    await interaction.followUp({ content: prompt, components: rows.slice(0, 5), ephemeral: false }).catch(discordCatch);
    saveGames();
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
  saveGames();
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
      targetFigureKeys: result.targetFigureKeys || null,
    };
    // Refresh board if figure moved during the space choice phase
    if (result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const bPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(bPayload);
      } catch (err) { console.error('Board refresh after space choice failed:', err); }
    }
    const choiceButtons = result.choiceOptions.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`dc_ability_choice_${gameId}_${msgId}_${specialIdx}_${i}`)
        .setLabel(String(label).slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    const rows = [];
    for (let i = 0; i < choiceButtons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(choiceButtons.slice(i, i + 5)));
    }
    const prompt = result.choicePrompt || `Choose a target:`;
    await interaction.followUp({ content: prompt, components: rows.slice(0, 5), ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  if (result.applied) {
    if (result.logMessage) {
      await logGameAction(game, client, result.logMessage, { phase: 'ROUND', icon: 'move' }).catch(discordCatch);
    }
    if (result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
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
  saveGames();
}

/**
 * Handle arsenal_pick_ select menu: store chosen dice in pendingOverrideAttackDice, then show target list.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx
 */
export async function handleArsenalPick(interaction, ctx) {
  // customId: arsenal_pick_{gameId}_{msgId}_{figureIndex}
  const withoutPrefix = interaction.customId.replace('arsenal_pick_', '');
  const parts = withoutPrefix.split('_');
  const gameId = parts[0];
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(1, -1).join('_');

  await interaction.deferUpdate().catch(discordCatch);

  const { getGame, dcMessageMeta, getDcStats, getDcEffects, getMapSpaces, saveGames, replyIfGameEnded } = ctx;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) { await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch); return; }
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  const chosenDice = interaction.values[0].split(',');
  game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
  game.pendingOverrideAttackDice[msgId] = { dice: chosenDice };
  saveGames();

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[meta.playerNum] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapSpaces(game.selectedMap?.id);
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
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, getMapSpaces, saveGames } = ctx;
  const withoutPrefix = interaction.customId.replace('ee3_pick_die_', '');
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
  saveGames();

  // Proceed to attack target selection
  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[meta.playerNum] || _hasFuryReach(game, meta.playerNum, attackerKws);
  const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
  const ms = getMapSpaces(game.selectedMap?.id);
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
  const { getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, getMapSpaces, saveGames } = ctx;
  const withoutPrefix = interaction.customId.replace('bo_rifle_pick_', '');
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
  saveGames();

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _loadoutCard = getLoadoutCards()[getConfig(game, `${meta.dcName}-${dgIndex}-${figureIndex}`)?.loadout];
  const hasReach = attackerKws.includes('REACH') || (attackerEffects?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || !!game.nextAttackReach?.[meta.playerNum] || _loadoutCard?.passive === 'Reach' || _hasFuryReach(game, meta.playerNum, attackerKws);
  // If Bo-Rifle mode, override range to melee
  const brOverride = game.pendingOverrideAttackDice?.[msgId];
  const effectiveMinRange = brOverride?.type === 'melee' ? 1 : minRange;
  const effectiveMaxRange_ = brOverride?.type === 'melee' ? (hasReach ? 2 : 1) : (hasReach && maxRange < 2 ? 2 : maxRange);
  const ms = getMapSpaces(game.selectedMap?.id);
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
    getGame, replyIfGameEnded, getDcStats, getDcEffects, getMapSpaces,
    getFigureSize, getFootprintCells, getRange, hasLineOfSight,
    getBoardStateForMovement, getMovementProfile, computeMovementCache,
    getSpaceChoiceRows, getMapAttachmentForSpaces,
    saveGames, FIGURE_LETTERS,
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
      const { applyStrainToFigure } = ctx;
      if (applyStrainToFigure) {
        await applyStrainToFigure(game, controlledPlayerNum, controlledFigureKey, fo.postAttackStrain, ctx.logGameAction, ctx.client, ctx.dcHealthState, ctx.dcMessageMeta);
      }
      await interaction.followUp({ content: `**Lure of the Dark Side** — Skipped attack. **${controlledName}** suffers ${fo.postAttackStrain} Strain.`, ephemeral: false }).catch(discordCatch);
    } else {
      await interaction.followUp({ content: `Skipped.`, ephemeral: false }).catch(discordCatch);
    }
    delete game.pendingFalseOrders;
    saveGames();
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
    const prefix = `false_orders_space_${gameId}_${msgId}_`;
    let rows = [];
    let foOverflowed = false;
    let foAvailable = [];
    if (getSpaceChoiceRows) {
      const mapSpaces = boardState?.mapSpaces || {};
      ({ rows, available: foAvailable, overflowed: foOverflowed } = getSpaceChoiceRows(prefix, reachableSpaces, mapSpaces));
    }
    const mapAttachment = getMapAttachmentForSpaces ? await getMapAttachmentForSpaces(game, reachableSpaces) : null;
    const foComponents = foOverflowed
      ? [ctx.buildSpaceSelectMenu('false_orders_space_sel_', `${gameId}_${msgId}`, foAvailable)]
      : rows.slice(0, 5);
    const payload = {
      content: `**False Orders** — Choose a space for **${controlledName}** to move to:`,
      components: foComponents,
      ephemeral: false,
    };
    if (mapAttachment) payload.files = [mapAttachment];
    await interaction.followUp(payload).catch(discordCatch);
    saveGames();
    return;
  }

  // Attack case
  if (!controlledPos) {
    await interaction.followUp({ content: `${controlledName} has no position — resolve manually.`, ephemeral: false }).catch(discordCatch);
    return;
  }
  const controlledAttackInfo = controlledStats?.attack || { dice: ['red'], range: [1, 3] };
  const [foMinRange, foMaxRange] = controlledAttackInfo.range || [1, 3];
  const controlledEff = getDcEffects()[controlledName] || getDcEffects()[controlledName?.replace(/\s*\[.*\]\s*$/, '')];
  const controlledKws = (controlledEff?.keywords || []).map((k) => String(k).toUpperCase());
  const foHasReach = controlledKws.includes('REACH') || (controlledEff?.passives || []).some((p) => String(p).toUpperCase() === 'REACH') || _hasFuryReach(game, controlledPlayerNum, controlledKws);
  let foEffectiveMaxRange = foHasReach && foMaxRange < 2 ? 2 : foMaxRange;
  // Lure of the Dark Side: cap range at 4 (or whatever maxRange is set)
  if (fo.isLure && fo.maxRange) foEffectiveMaxRange = Math.min(foEffectiveMaxRange, fo.maxRange);
  const ms = getMapSpaces(game.selectedMap?.id);
  if (!ms) {
    await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Collect all other figures as potential targets
  const allOtherPositions = {};
  for (const [figKey, pos] of Object.entries(game.figurePositions?.[1] || {})) {
    if (figKey !== controlledFigureKey) allOtherPositions[figKey] = pos;
  }
  for (const [figKey, pos] of Object.entries(game.figurePositions?.[2] || {})) {
    if (figKey !== controlledFigureKey) allOtherPositions[figKey] = pos;
  }
  const foTargets = [];
  for (const [figKey, targetPos] of Object.entries(allOtherPositions)) {
    const dist = getRange ? getRange(controlledPos, targetPos, ms) : 1;
    if (dist < foMinRange || dist > foEffectiveMaxRange) continue;
    const los = hasLineOfSight ? hasLineOfSight(controlledPos, targetPos, ms, []) : true;
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
  const targetRows = [];
  for (let i = 0; i < foTargets.length; i += 5) {
    const chunk = foTargets.slice(i, i + 5);
    targetRows.push(new ActionRowBuilder().addComponents(
      chunk.map((t, idx) => {
        const targetIndex = i + idx;
        const noLOS = t.hasLOS === false;
        return new ButtonBuilder()
          .setCustomId(`false_orders_atk_${gameId}_${msgId}_${targetIndex}`)
          .setLabel(`${t.label} (${String(t.coord).toUpperCase()})${noLOS ? ' [No LOS]' : ''}`.slice(0, 80))
          .setStyle(noLOS ? ButtonStyle.Secondary : ButtonStyle.Danger)
          .setDisabled(noLOS);
      })
    ));
  }
  await interaction.followUp({
    content: `**False Orders** — Choose attack target for **${controlledName}**:`,
    components: targetRows.slice(0, 5),
    ephemeral: false,
  }).catch(discordCatch);
  saveGames();
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
  delete game.pendingFalseOrders;
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
  saveGames();
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
  const { getGame, dcMessageMeta, dcHealthState, getMapSpaces, logGameAction, buildBoardMapPayload,
    updateDcActionsMessage, getSpaceChoiceRows, getMapAttachmentForSpaces, saveGames, client } = ctx;
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
    delete game.pendingRushPush;
    await interaction.message.edit({ content: '**Rush** — Target no longer on board.', components: [] }).catch(discordCatch);
    saveGames();
    return;
  }
  // Find valid landing spaces: target's current space + adjacent unoccupied
  const mapId = game.selectedMap?.id;
  const mapSpaces = mapId ? getMapSpaces(mapId) : null;
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
    const tNote = t.wasDefeated ? ' **(may be defeated)**' : '';
    const aNote = a.wasDefeated ? ' **(may be defeated)**' : '';
    const logMsg = `**Rush** — Both suffer 1 Damage: **${targetName}**${tNote}, **Onar**${aNote}. No push (no open space).`;
    if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
    delete game.pendingRushPush;
    await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
    saveGames();
    return;
  }
  // Show space picker
  pending.chosenTarget = targetFk;
  const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
  const bMapSpaces = boardState?.mapSpaces || {};
  const { rows, available: rushAvail, overflowed: rushOverflowed } = getSpaceChoiceRows(`rush_push_space_${gameId}_${msgId}_`, validSpaces, bMapSpaces);
  const mapAttachment = await getMapAttachmentForSpaces(game, validSpaces);
  const rushComponents = rushOverflowed
    ? [ctx.buildSpaceSelectMenu('rush_push_space_sel_', `${gameId}_${msgId}`, rushAvail)]
    : rows.slice(0, 5);
  const payload = {
    content: `**Rush** — Pick landing space for **${dcNameFromFigureKey(targetFk)}** (or stay at **${targetPos.toUpperCase()}**):`,
    components: rushComponents,
  };
  if (mapAttachment) payload.files = [mapAttachment];
  await interaction.message.edit({ content: '**Rush** — Choosing push destination...', components: [] }).catch(discordCatch);
  await interaction.followUp(payload).catch(discordCatch);
  saveGames();
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
    updateDcActionsMessage, saveGames, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingRushPush;
  if (!pending || pending.msgId !== msgId) {
    await interaction.followUp({ content: 'No pending Rush push.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activating player can choose.')) return;
  const targetFk = pending.chosenTarget;
  const oppNum = opponentPlayerNum(pending.playerNum);
  const prevPos = game.figurePositions?.[oppNum]?.[targetFk];
  const targetName = dcNameFromFigureKey(targetFk);
  // Move target to chosen space
  game.figurePositions[oppNum][targetFk] = chosenSpace;
  const pushed = chosenSpace !== prevPos;
  // Apply 1 damage to both
  const t = _applyHpDamage(game, dcHealthState, dcMessageMeta, targetFk, 1);
  const a = _applyHpDamage(game, dcHealthState, dcMessageMeta, pending.activatorFigureKey, 1);
  const tNote = t.wasDefeated ? ' **(may be defeated)**' : '';
  const aNote = a.wasDefeated ? ' **(may be defeated)**' : '';
  const pushNote = pushed ? ` Pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} → ${chosenSpace.toUpperCase()}.` : '';
  const logMsg = `**Rush** —${pushNote} Both suffer 1 Damage: **${targetName}**${tNote}, **Onar**${aNote}.`;
  if (logGameAction) await logGameAction(game, client, logMsg, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  // Refresh board
  if (game.boardId && game.selectedMap && buildBoardMapPayload) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const boardPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(boardPayload);
    } catch { /* ignore */ }
  }
  await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
  delete game.pendingRushPush;
  await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
  saveGames();
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
  delete game.pendingRushPush;
  await interaction.message.edit({ content: '**Rush** — Push skipped.', components: [] }).catch(discordCatch);
  saveGames();
}

/**
 * Handle shoulder_rush_fig_ button: player picks which adjacent hostile to target.
 */
export async function handleShoulderRushFig(interaction, ctx) {
  const m = interaction.customId.match(/^shoulder_rush_fig_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, msgId, choiceIdxStr] = m;
  const choiceIndex = parseInt(choiceIdxStr, 10);
  const { getGame, dcMessageMeta, dcHealthState, getMapSpaces, logGameAction, buildBoardMapPayload,
    updateDcActionsMessage, getSpaceChoiceRows, getMapAttachmentForSpaces, saveGames, client } = ctx;
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
    delete game.pendingShoulderRush;
    await interaction.message.edit({ content: '**Shoulder Rush** — Target no longer on board.', components: [] }).catch(discordCatch);
    saveGames();
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
    delete game.pendingShoulderRush;
    await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
    saveGames();
    return;
  }
  // Target is SMALL: show push space picker (adjacent to target, unoccupied)
  pending.chosenTarget = targetFk;
  const mapId = game.selectedMap?.id;
  const mapSpaces = mapId ? getMapSpaces(mapId) : null;
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
    delete game.pendingShoulderRush;
    await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
    saveGames();
    return;
  }
  // Show space picker
  const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
  const bMapSpaces = boardState?.mapSpaces || {};
  const { rows, available: srAvail, overflowed: srOverflowed } = getSpaceChoiceRows(`shoulder_rush_space_${gameId}_${msgId}_`, validSpaces, bMapSpaces);
  const mapAttachment = await getMapAttachmentForSpaces(game, validSpaces);
  const srComponents = srOverflowed
    ? [ctx.buildSpaceSelectMenu('shoulder_rush_space_sel_', `${gameId}_${msgId}`, srAvail)]
    : rows.slice(0, 5);
  const payload = {
    content: `**Shoulder Rush** — **${targetName}** is SMALL. Push to which space? (You will enter the vacated space.)`,
    components: srComponents,
  };
  if (mapAttachment) payload.files = [mapAttachment];
  await interaction.message.edit({ content: '**Shoulder Rush** — Choosing push destination...', components: [] }).catch(discordCatch);
  await interaction.followUp(payload).catch(discordCatch);
  saveGames();
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
  const pending = game.pendingShoulderRush;
  if (!pending || pending.msgId !== msgId) {
    await interaction.followUp({ content: 'No pending Shoulder Rush.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.playerNum, canActAsPlayer, 'Only the activating player can choose.')) return;
  const targetFk = pending.chosenTarget;
  const oppNum = opponentPlayerNum(pending.playerNum);
  const prevPos = game.figurePositions?.[oppNum]?.[targetFk];
  const targetName = dcNameFromFigureKey(targetFk);
  // Push target to chosen space
  game.figurePositions[oppNum][targetFk] = chosenSpace;
  // Move activator into the vacated space
  if (pending.activatorFigureKey && pending.activatorPos) {
    game.figurePositions[pending.playerNum][pending.activatorFigureKey] = prevPos;
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
      const boardChannel = await client.channels.fetch(game.boardId);
      const boardPayload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(boardPayload);
    } catch { /* ignore */ }
  }
  await updateDcActionsMessage(game, msgId, client).catch(discordCatch);
  delete game.pendingShoulderRush;
  await interaction.message.edit({ content: logMsg, components: [] }).catch(discordCatch);
  saveGames();
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
  delete game.pendingShoulderRush;
  await interaction.message.edit({ content: '**Shoulder Rush** — No target chosen.', components: [] }).catch(discordCatch);
  saveGames();
}

/** Handle Overwatch token space placement. */
export async function handleOverwatchSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^overwatch_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const chosenSpace = String(space).toLowerCase();
  game.overwatchTokenPosition = game.overwatchTokenPosition || {};
  game.overwatchTokenPosition[msgId] = chosenSpace;
  delete game.pendingOverwatchPlacement?.[msgId];
  const meta = dcMessageMeta?.get(msgId);
  const displayName = meta?.displayName || meta?.dcName || 'E-Web Engineer';
  await interaction.message.edit({ content: `**Overwatch** — Token placed at **${chosenSpace.toUpperCase()}**. When a hostile figure enters a space on or adjacent to this token, you may interrupt to attack.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Overwatch** — **${displayName}** placed token at **${chosenSpace.toUpperCase()}**.`, { phase: 'ROUND', icon: 'card' });
  saveGames();
}

/** Handle Orbital Bombardment deplete — start space selection for damage. */
export async function handleOrbitalBombardmentDeplete(interaction, ctx) {
  const m = interaction.customId.match(/^ob_deplete_([^_]+)_([^_]+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta, getMapSpaces, getSpaceChoiceRows } = ctx;
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
  game.pendingOrbitalBombardment = { msgId, playerNum, spacesRemaining: tokenCount, spacesChosen: [], gameId };
  // Show space picker (all occupied spaces)
  const mapId = game.selectedMap?.id;
  const ms = getMapSpaces?.(mapId);
  const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
  if (allSpaces.length === 0) {
    await interaction.message.edit({ content: '**Orbital Bombardment** — Map data unavailable. Choose spaces manually.', components: [] }).catch(discordCatch);
    saveGames();
    return;
  }
  const spaceRows = getSpaceChoiceRows?.(`ob_space_${gameId}_${msgId}_`, allSpaces, ms) || { rows: [] };
  await interaction.message.edit({
    content: `**Orbital Bombardment** — Choose space **1 of ${tokenCount}** for bombardment (each figure on a chosen space suffers 2 Damage):`,
    components: spaceRows.rows.slice(0, 5),
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Orbital Bombardment** — **${meta?.displayName || 'DC'}** depleted. Choosing ${tokenCount} spaces for bombardment.`, { phase: 'ROUND', icon: 'card' });
  saveGames();
}

/** Handle Orbital Bombardment skip (decline to deplete at activation start). */
export async function handleOrbitalBombardmentSkip(interaction, ctx) {
  const m = interaction.customId.match(/^ob_skip_([^_]+)_([^_]+)$/);
  if (!m) return;
  const { getGame, saveGames } = ctx;
  const game = getGame(m[1]);
  if (!game) return;
  await interaction.message.edit({ content: '**Orbital Bombardment** — Skipped (tokens remain on card).', components: [] }).catch(discordCatch);
  saveGames();
}

/** Handle Orbital Bombardment space selection (sequential picker). */
export async function handleOrbitalBombardmentSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^ob_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta, dcHealthState, getMapSpaces, getSpaceChoiceRows, findDcMessageIdForFigure } = ctx;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingOrbitalBombardment) return;
  const pending = game.pendingOrbitalBombardment;
  const chosenSpace = String(space).toLowerCase();
  pending.spacesChosen.push(chosenSpace);

  if (pending.spacesChosen.length < pending.spacesRemaining) {
    // More spaces to pick — show picker again
    const mapId = game.selectedMap?.id;
    const ms = getMapSpaces?.(mapId);
    const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
    const spaceRows = getSpaceChoiceRows?.(`ob_space_${gameId}_${msgId}_`, allSpaces, ms) || { rows: [] };
    await interaction.message.edit({
      content: `**Orbital Bombardment** — Chosen: ${pending.spacesChosen.map(s => s.toUpperCase()).join(', ')}. Choose space **${pending.spacesChosen.length + 1} of ${pending.spacesRemaining}**:`,
      components: spaceRows.rows.slice(0, 5),
    }).catch(discordCatch);
    saveGames();
    return;
  }

  // All spaces chosen — apply 2 damage to each figure on chosen spaces
  const meta = dcMessageMeta?.get(msgId);
  const attackerPlayerNum = pending.playerNum;
  const damageLog = [];
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
        if (newCur <= 0) damageLog[damageLog.length - 1] += ' *(may be defeated)*';
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
  delete game.pendingOrbitalBombardment;
  saveGames();
}

/** Handle Bomb Drop space selection — apply 2 damage to all figures on/adjacent to chosen space. */
export async function handleBombDropSpacePick(interaction, ctx) {
  const m = interaction.customId.match(/^bomb_drop_space_([^_]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId, space] = m;
  const { getGame, saveGames, logGameAction, dcMessageMeta, dcHealthState, getMapSpaces, findDcMessageIdForFigure } = ctx;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game?.pendingBombDrop?.[msgId]) return;
  const pending = game.pendingBombDrop[msgId];
  const chosenSpace = String(space).toLowerCase();

  // Discard the explosive
  if (game.figureContraband?.[pending.figureKey]) {
    delete game.figureContraband[pending.figureKey];
  }

  // Find all spaces on/adjacent to chosen space
  const mapId = game.selectedMap?.id;
  const ms = getMapSpaces?.(mapId);
  const adjSpaces = ms?.adjacency?.[chosenSpace] || [];
  const affectedSpaces = new Set([chosenSpace, ...adjSpaces.map(s => String(s).toLowerCase())]);

  // Apply 2 damage to each figure on affected spaces
  const damageLog = [];
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
      if (newCur <= 0) damageLog[damageLog.length - 1] += ' *(may be defeated)*';
    }
  }
  const resultStr = damageLog.length > 0 ? `Damage: ${damageLog.join(', ')}` : 'No figures affected.';
  await interaction.message.edit({
    content: `**Bomb Drop** — Detonated at **${chosenSpace.toUpperCase()}**. Each figure on/adjacent suffers 2 Damage.\n${resultStr}`,
    components: [],
  }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, interaction.client, `**Bomb Drop** — Detonated at **${chosenSpace.toUpperCase()}**. ${resultStr}`, { phase: 'ROUND', icon: 'attack' });
  delete game.pendingBombDrop[msgId];
  saveGames();
}
