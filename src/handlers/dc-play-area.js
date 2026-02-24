/**
 * DC Play Area handlers: dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration } from 'discord.js';
import { truncateLabel } from '../discord/components.js';
import { bottomLeftCoord } from '../game/coords.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';

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
  } = ctx;
  const parts = interaction.customId.replace('dc_activate_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const dcIndex = parseInt(parts[2], 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owner of this Play Area can activate their DCs.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const dc = dcList[dcIndex];
  if (!dc) {
    await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { dcName, displayName, healthState } = dc;
  const remaining = playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  if (remaining <= 0) {
    await interaction.followUp({ content: 'No activations remaining this round.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const msgId = dcMessageIds[dcIndex];
  if (!msgId) {
    await interaction.followUp({ content: 'DC message not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const isMyTurn = ownerId === turnPlayerId;
  if (!isMyTurn) {
    const playAreaCh = await client.channels.fetch(playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
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
    const channel = await client.channels.fetch(playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
    const msg = await channel.messages.fetch(msgId);
    dcExhaustedState.set(msgId, true);
    const { embed, files } = await buildDcEmbedAndFiles(dcName, true, displayName, healthState, getConditionsForDcMessage?.(game, { dcName, displayName }));
    await msg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, dcName) });
    const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
    const thread = await msg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
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
    if (playerNum === 1) { game.p1ActivationsRemaining--; game.p1ActivatedDcIndices.push(dcIndex); }
    else { game.p2ActivationsRemaining--; game.p2ActivatedDcIndices.push(dcIndex); }
    await updateActivationsMessage(game, playerNum, client);
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
    const activateRows = getActivateDcButtons(game, playerNum);
    await interaction.editReply({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch (err) {
    console.error('dc_activate_ error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'dc_activate');
    await interaction.followUp({ content: `Activation failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) {
    await interaction.followUp({ content: 'Only the owner can un-activate.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  const wasExhausted = dcExhaustedState.get(msgId) ?? false;
  if (!wasExhausted) {
    await interaction.followUp({ content: 'DC is not activated.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const displayName = meta.displayName || meta.dcName;
  dcExhaustedState.set(msgId, false);
  const total = meta.playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
  const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  if (remaining < total) {
    if (meta.playerNum === 1) {
      game.p1ActivationsRemaining++;
      const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
      if (dcIndex !== -1 && game.p1ActivatedDcIndices) game.p1ActivatedDcIndices = game.p1ActivatedDcIndices.filter((i) => i !== dcIndex);
    } else {
      game.p2ActivationsRemaining++;
      const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
      if (dcIndex !== -1 && game.p2ActivatedDcIndices) game.p2ActivatedDcIndices = game.p2ActivatedDcIndices.filter((i) => i !== dcIndex);
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
  // Stun: discarded at the end of the figure's activation
  if (game.figureConditions) {
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const stats = ctx.getDcStats ? ctx.getDcStats(meta.dcName) : {};
    const figures = stats.figures ?? 1;
    for (let f = 0; f < figures; f++) {
      const fk = `${meta.dcName}-${dgIndex}-${f}`;
      if (game.figureConditions[fk]) {
        game.figureConditions[fk] = game.figureConditions[fk].filter((c) => c !== 'Stun');
      }
    }
  }
  if (game.dcActivationLogMessageIds?.[msgId]) {
    try {
      const logCh = await client.channels.fetch(game.generalId);
      const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
      await logMsg.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {}
    delete game.dcActivationLogMessageIds[msgId];
  }
  const healthState = dcHealthState.get(msgId) ?? [[null, null]];
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, displayName, healthState, getConditionsForDcMessage?.(game, meta));
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
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) {
    await interaction.followUp({ content: 'Only the owner of this Play Area can toggle their DCs.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  const wasExhausted = dcExhaustedState.get(msgId) ?? false;
  const nowExhausted = !wasExhausted;
  const healthState = dcHealthState.get(msgId) ?? [[null, null]];
  const displayName = meta.displayName || meta.dcName;
  const playerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;

  if (!wasExhausted && nowExhausted) {
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    const isMyTurn = playerId === turnPlayerId;
    if (!isMyTurn) {
      const playAreaCh = await client.channels.fetch(meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId);
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
    const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
    if (remaining > 0) {
      if (meta.playerNum === 1) {
        game.p1ActivationsRemaining--;
        const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
        if (dcIndex !== -1) {
          game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || [];
          game.p1ActivatedDcIndices.push(dcIndex);
        }
      } else {
        game.p2ActivationsRemaining--;
        const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
        if (dcIndex !== -1) {
          game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || [];
          game.p2ActivatedDcIndices.push(dcIndex);
        }
      }
      await updateActivationsMessage(game, meta.playerNum, client);
      const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
      const thread = await interaction.message.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
      game.dcActionsData = game.dcActionsData || {};
      game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };
      const pingContent = `<@${meta.playerNum === 1 ? game.player1Id : game.player2Id}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
      const actMinimap = await getActivationMinimapAttachment(game, msgId);
      const actionsPayload = {
        content: pingContent,
        components: getDcActionButtons(msgId, meta.dcName, displayName, game.dcActionsData[msgId], game),
        allowedMentions: { users: [meta.playerNum === 1 ? game.player1Id : game.player2Id] },
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
    const total = meta.playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
    const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
    if (remaining < total) {
      if (meta.playerNum === 1) {
        game.p1ActivationsRemaining++;
        const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
        if (dcIndex !== -1 && game.p1ActivatedDcIndices) game.p1ActivatedDcIndices = game.p1ActivatedDcIndices.filter((i) => i !== dcIndex);
      } else {
        game.p2ActivationsRemaining++;
        const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
        if (dcIndex !== -1 && game.p2ActivatedDcIndices) game.p2ActivatedDcIndices = game.p2ActivatedDcIndices.filter((i) => i !== dcIndex);
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
        await logMsg.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
      } catch {}
      delete game.dcActivationLogMessageIds[msgId];
    }
  }
  saveGames();
  if (!nowExhausted) {
    const pLabel = `P${meta.playerNum}`;
    await logGameAction(game, client, `**${pLabel}:** <@${playerId}> readied **${displayName}**`, { allowedMentions: { users: [playerId] }, icon: 'ready' });
  }
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, nowExhausted, displayName, healthState, getConditionsForDcMessage?.(game, meta));
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
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) {
    await interaction.followUp({ content: 'Only the owner of this Play Area can Deplete their upgrade.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (isDepletedRemovedFromGame(game, msgId)) {
    await interaction.followUp({ content: 'This upgrade was already depleted and removed from the game.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, displayName, [], getConditionsForDcMessage?.(game, meta));
  embed.setTitle(`REMOVED FROM GAME (Depleted) — ${displayName}`);
  embed.setDescription((embed.data.description || '') + '\n\n*This upgrade was depleted and is no longer in play (one-time use).*');
  embed.setColor(0x95a5a6);
  await interaction.message.edit({ embeds: [embed], files, components: [] });
  await logGameAction(game, client, `**P${meta.playerNum}:** <@${ownerId}> depleted **${displayName}** — removed from game`, { allowedMentions: { users: [ownerId] }, icon: 'deplete' });
  saveGames();
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
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) {
    await interaction.followUp({ content: 'Only the owner of this activation can play a CC here.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  const playable = getCardList(game, meta.playerNum, meta.dcName, meta.displayName);
  const card = playable[idx];
  const handKey = meta.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = meta.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  if (!card || hand.indexOf(card) < 0) {
    await interaction.followUp({ content: "That card isn't in your hand or isn't playable for this figure.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  // F14: Snapshot for undo before mutating
  const previousHand = (game[handKey] || []).slice();
  const previousDiscard = (game[discardKey] || []).slice();
  const attachKey = meta.playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
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
  const handChannelId = meta.playerNum === 1 ? game.p1HandId : game.p2HandId;
  const handChannel = await interaction.client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = meta.playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, game.gameId, game, meta.playerNum);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}** (${timingLabel}).${effectReminder}\n\n` + (handPayload.content || '');
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds || [],
      files: handPayload.files || [],
      components: handPayload.components || [],
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
          const _embed = new _EB().setTitle(card).setColor(0x2f3136).setImage(`attachment://${_fn}`);
          const _logCh = await interaction.client.channels.fetch(game.generalId).catch(() => null);
          if (_logCh) await _logCh.send({ embeds: [_embed], files: [new _AB(_imgPath, { name: _fn })] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        }
      } catch (err) {
        console.error('[cc-image-log]', err?.message ?? err);
      }
    }
  }
  if (enteringNegation) {
    game.pendingNegation = { playedBy: meta.playerNum, card, fromDc: true, msgId, wasAttachment: isCcAttachment(card), handChannelId };
    const oppNum = meta.playerNum === 1 ? 2 : 1;
    const oppHandId = oppNum === 1 ? game.p1HandId : game.p2HandId;
    const oppHandChannel = await interaction.client.channels.fetch(oppHandId).catch(() => null);
    if (oppHandChannel) {
      const oppId = oppNum === 1 ? game.player1Id : game.player2Id;
      await oppHandChannel.send({
        content: `<@${oppId}> Your opponent played **${card}** (cost 0). You may play **Negation** to cancel it.`,
        components: [ctx.getNegationResponseButtons(game.gameId)],
        allowedMentions: { users: [oppId] },
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await handCh.send({ content: `**Choose one** (for **${card}**):`, components: rows }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
            }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (!canActAsPlayer(game, interaction.user.id, meta.playerNum)) {
    await interaction.followUp({ content: 'Only the owner of this Play Area can use these actions.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  const actionsData = game.dcActionsData?.[msgId];
  const actionsRemaining = actionsData?.remaining ?? DC_ACTIONS_PER_ACTIVATION;
  if (actionsRemaining <= 0) {
    await interaction.followUp({ content: 'No actions remaining this activation (2 per DC).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (buttonKey === 'dc_special_') {
    const parts = interaction.customId.replace('dc_special_', '').split('_');
    const specialIdx = parseInt(parts[0], 10);
    const specialsUsed = actionsData?.specialsUsed ?? [];
    if (specialsUsed.includes(specialIdx)) {
      await interaction.followUp({ content: "That special has already been used this activation (each special once per activation unless a card says otherwise).", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const specialCosts = getDcStats(meta.dcName).specialCosts || [];
    const actionCost = specialCosts[specialIdx] ?? 1;
    if (actionsRemaining < actionCost) {
      await interaction.followUp({ content: `**${action}** costs both actions — you only have ${actionsRemaining} action(s) remaining this activation.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
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
        await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** is **Stunned** and cannot Move or Attack this activation.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      const playerNum = meta.playerNum;
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!pos) {
        await interaction.followUp({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      // Vanish: grant bonus MP on first Move of the next activation, then clear immunity
      if (!bank) {
        const vanishBonus = game.vanishImmunityUntilNextActivation?.[playerNum];
        if (vanishBonus?.msgId === msgId && vanishBonus.nextMp > 0) {
          mpRemaining += vanishBonus.nextMp;
          delete game.vanishImmunityUntilNextActivation[playerNum];
        }
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
        await interaction.followUp({ content: 'Map spaces data not found for this map. Run: npm run generate-map-spaces', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      const profile = getMovementProfile(meta.dcName, figureKey, game);
      const cache = computeMovementCache(pos, mpRemaining, boardState, profile);
      if (cache.cells.size === 0) {
        await interaction.followUp({ content: 'No valid movement spaces.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      const actData = game.dcActionsData?.[msgId];
      if (actData) {
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
      await interaction.followUp({ content: `Move failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
  }

  if (action === 'Attack') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    // Stunned figures cannot Attack
    const attackFigureConds = game.figureConditions?.[figureKey] || [];
    if (attackFigureConds.includes('Stun')) {
      await interaction.followUp({ content: `**${meta.displayName || meta.dcName}** is **Stunned** and cannot Move or Attack this activation.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const playerNum = meta.playerNum;
    const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!attackerPos) {
      await interaction.followUp({ content: 'This figure has no position yet.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const stats = getDcStats(meta.dcName);
    const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
    const [minRange, maxRange] = attackInfo.range || [1, 3];
    // Reach: melee figure can target 1–2 spaces away; no accuracy check (still counts as melee)
    const attackerEffects = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
    const attackerKws = (attackerEffects?.keywords || []).map((k) => String(k).toUpperCase());
    const hasReach = attackerKws.includes('REACH') || !!game.nextAttackReach?.[playerNum];
    const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;
    const ms = getMapSpaces(game.selectedMap?.id);
    if (!ms) {
      await interaction.followUp({ content: 'Map spaces not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const enemyPlayerNum = playerNum === 1 ? 2 : 1;
    // "No Cheating": debuffed player can only make melee attacks this activation
    const noCheatingDebuff = game.roundDebuffNextHostileActivation;
    if (noCheatingDebuff && (3 - noCheatingDebuff.playerNum) === playerNum && noCheatingDebuff.melee) {
      if (stats.attack?.type === 'range') {
        await interaction.followUp({ content: '⚠️ **No Cheating** is active — this figure can only make melee attacks this activation.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
    }
    const targets = [];
    const poses = game.figurePositions?.[enemyPlayerNum] || {};
    const dcList = enemyPlayerNum === 1 ? game.player1Squad?.dcList : game.player2Squad?.dcList || [];
    const totals = {};
    for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
    for (const [k, coord] of Object.entries(poses)) {
      // Hidden figures cannot be declared as attack targets
      const targetCondsList = game.figureConditions?.[k] || [];
      if (targetCondsList.includes('Hide')) continue;
      // Vanish: figure cannot be targeted until their next activation
      const vanishImmunity = game.vanishImmunityUntilNextActivation?.[enemyPlayerNum];
      if (vanishImmunity) {
        const vanishMeta = dcMessageMeta.get(vanishImmunity.msgId);
        if (vanishMeta && k.startsWith(`${vanishMeta.dcName}-`)) continue;
      }
      const dcName = k.replace(/-\d+-\d+$/, '');
      const size = game.figureOrientations?.[k] || getFigureSize(dcName);
      const cells = getFootprintCells(coord, size);
      const dist = Math.min(...cells.map((c) => getRange(attackerPos, c)));
      if (dist < minRange || dist > effectiveMaxRange) continue;
      // "I Must Go Alone": protected player's figures cannot be targeted from beyond N spaces
      const iMustGoAlone = game.roundDefenderCannotBeTargetedUnlessWithinSpaces;
      if (iMustGoAlone?.playerNum === enemyPlayerNum && dist > iMustGoAlone.spaces) continue;
      const los = hasLineOfSight(attackerPos, coord, ms);
      const m = k.match(/-(\d+)-(\d+)$/);
      const dg = m ? parseInt(m[1], 10) : 1;
      const fi = m ? parseInt(m[2], 10) : 0;
      const figCount = getDcStats(dcName).figures ?? 1;
      const label = figCount > 1 ? `${dg}${FIGURE_LETTERS[fi] || 'a'}` : (totals[dcName] > 1 ? `${dcName} [DG ${dg}]` : dcName);
      targets.push({ figureKey: k, coord, label, hasLOS: los, dist });
    }
    if (targets.length === 0) {
      await interaction.followUp({ content: 'No valid targets in range.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  if (action === 'Interact') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    const playerNum = meta.playerNum;
    const mapId = game.selectedMap?.id;
    const pos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!pos) {
      await interaction.followUp({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
    if (options.length === 0) {
      await interaction.followUp({ content: 'No valid interact options (must be on or adjacent to a terminal, door, or mission token).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      delete game.freeAttackBonusPending[msgId];
    } else {
      const actionCost = buttonKey === 'dc_special_' ? (getDcStats(meta.dcName).specialCosts?.[specialIdx] ?? 1) : 1;
      actionsData.remaining = Math.max(0, actionsData.remaining - actionCost);
      await updateDcActionsMessage(game, msgId, client);
    }
  }
  const displayName = meta.displayName || meta.dcName;
  const pLabel = `P${meta.playerNum}`;
  await logGameAction(game, client, `**${pLabel}:** <@${ownerId}> used **${action}**.`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'activate' });
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
    findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
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
    await interaction.followUp({ content: `**${action}** — Choose one:`, components: rows.slice(0, 5), ephemeral: false }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }
  // Handle space-choice abilities (e.g. Pounce teleport destination)
  if (resolveResult.requiresSpaceChoice && Array.isArray(resolveResult.validSpaces) && resolveResult.validSpaces.length > 0) {
    if (getSpaceChoiceRows && getMapAttachmentForSpaces) {
      const boardState = ctx.getBoardStateForMovement ? ctx.getBoardStateForMovement(game, null) : null;
      const mapSpaces = boardState?.mapSpaces || { spaces: resolveResult.validSpaces };
      const { rows } = getSpaceChoiceRows(`pounce_space_${game.gameId}_${msgId}_${figureIndex}_`, resolveResult.validSpaces, mapSpaces);
      const mapAttachment = await getMapAttachmentForSpaces(game, resolveResult.validSpaces);
      game.pendingPounceSpaceChoice = game.pendingPounceSpaceChoice || {};
      game.pendingPounceSpaceChoice[msgId] = { gameId: game.gameId, playerNum: meta.playerNum, figureIndex, msgId, abilityId, validSpaces: resolveResult.validSpaces };
      const payload = { content: `**Pounce** — Pick a space to place your figure:`, components: rows.slice(0, 5), ephemeral: false, fetchReply: true };
      if (mapAttachment) payload.files = [mapAttachment];
      await interaction.followUp(payload).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
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
      await thread.send(`**Expertise** — ${displayName} gains 1 extra action this activation.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Invalid choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, gameId, msgId, specialIdxStr, choiceIndexStr] = match;
  const specialIdx = parseInt(specialIdxStr, 10);
  const choiceIndex = parseInt(choiceIndexStr, 10);
  const { getGame, dcMessageMeta, dcHealthState, resolveAbility, updateDcActionsMessage, saveGames, client } = ctx;
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const pending = game.pendingDcAbilityChoice?.[`${msgId}_${specialIdx}`];
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending ability choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, abilityId, figureIndex, targetFigureKeys } = pending;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the ability owner can choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  delete game.pendingDcAbilityChoice[`${msgId}_${specialIdx}`];
  const meta = dcMessageMeta.get(msgId);
  const resolveResult = resolveAbility ? resolveAbility(abilityId, {
    game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, choiceIndex,
    targetFigureKey: targetFigureKeys?.[choiceIndex] || null,
    hasLineOfSight: ctx.hasLineOfSight, getRange: ctx.getRange, getMapSpaces: ctx.getMapSpaces,
    findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
  }) : { applied: false, manualMessage: 'Resolve manually.' };
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
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.followUp({ content: 'Invalid pounce space choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, gameId, msgId, figureIndexStr, space] = match;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, dcMessageMeta, resolveAbility, logGameAction, updateDcActionsMessage, buildBoardMapPayload, client, saveGames } = ctx;
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const pending = game.pendingPounceSpaceChoice?.[msgId];
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending pounce space choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, abilityId, validSpaces } = pending;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the activating player can choose the pounce destination.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const validLower = (validSpaces || []).map((s) => String(s).toLowerCase());
  if (!validLower.includes(chosenSpace)) {
    await interaction.followUp({ content: 'That space is not a valid pounce destination.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const meta = dcMessageMeta.get(msgId);
  const result = resolveAbility(abilityId, { game, msgId, meta, playerNum, dcMessageMeta, chosenSpace });
  delete game.pendingPounceSpaceChoice[msgId];
  if (result.applied) {
    if (result.logMessage) {
      await logGameAction(game, client, result.logMessage, { phase: 'ROUND', icon: 'move' }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await updateDcActionsMessage(game, msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    const doneRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`special_done_${gameId}_${msgId}`)
        .setLabel('Done')
        .setStyle(ButtonStyle.Success)
    );
    await interaction.message.edit({
      content: `**Pounce**: placed at **${String(chosenSpace).toUpperCase()}**. Use the **Attack** button for your free pounce attack (no action cost), or press **Done** to skip.`,
      components: [doneRow],
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } else {
    await interaction.message.edit({ content: `Pounce failed: ${result.manualMessage}`, components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  saveGames();
}
