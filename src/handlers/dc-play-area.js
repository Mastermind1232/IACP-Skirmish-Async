/**
 * DC Play Area handlers: dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration } from 'discord.js';
import { truncateLabel } from '../discord/components.js';

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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this Play Area can activate their DCs.', ephemeral: true }).catch(() => {});
    return;
  }
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const dc = dcList[dcIndex];
  if (!dc) {
    await interaction.reply({ content: 'DC not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const { dcName, displayName, healthState } = dc;
  const remaining = playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  if (remaining <= 0) {
    await interaction.reply({ content: 'No activations remaining this round.', ephemeral: true }).catch(() => {});
    return;
  }
  const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const msgId = dcMessageIds[dcIndex];
  if (!msgId) {
    await interaction.reply({ content: 'DC message not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const isMyTurn = ownerId === turnPlayerId;
  if (!isMyTurn) {
    await interaction.deferUpdate().catch(() => {});
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
  await interaction.deferUpdate().catch((e) => {
    console.error('dc_activate_ deferUpdate failed:', e?.message || e);
  });
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
    await interaction.update({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(() => interaction.deferUpdate().catch(() => {}));
  } catch (err) {
    console.error('dc_activate_ error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'dc_activate');
    await interaction.followUp({ content: `Activation failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch(() => {});
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
    await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner can un-activate.', ephemeral: true }).catch(() => {});
    return;
  }
  const wasExhausted = dcExhaustedState.get(msgId) ?? false;
  if (!wasExhausted) {
    await interaction.reply({ content: 'DC is not activated.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
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
  if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
  if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
  if (game.dcActivationLogMessageIds?.[msgId]) {
    try {
      const logCh = await client.channels.fetch(game.generalId);
      const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
      await logMsg.delete().catch(() => {});
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
    await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this Play Area can toggle their DCs.', ephemeral: true }).catch(() => {});
    return;
  }
  const wasExhausted = dcExhaustedState.get(msgId) ?? false;
  const nowExhausted = !wasExhausted;
  const healthState = dcHealthState.get(msgId) ?? [[null, null]];
  const displayName = meta.displayName || meta.dcName;
  const playerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;

  if (!wasExhausted && nowExhausted) {
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    const isMyTurn = playerId === turnPlayerId;
    if (!isMyTurn) {
      await interaction.deferUpdate().catch(() => {});
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
    if (game.dcFinishedPinged?.[msgId]) delete game.dcFinishedPinged[msgId];
    if (game.pendingEndTurn?.[msgId]) delete game.pendingEndTurn[msgId];
    if (game.dcActivationLogMessageIds?.[msgId]) {
      try {
        const logCh = await client.channels.fetch(game.generalId);
        const logMsg = await logCh.messages.fetch(game.dcActivationLogMessageIds[msgId]);
        await logMsg.delete().catch(() => {});
      } catch {}
      delete game.dcActivationLogMessageIds[msgId];
    }
  }
  saveGames();
  const actionIcon = nowExhausted ? 'activate' : 'ready';
  const pLabel = `P${meta.playerNum}`;
  const actionText = nowExhausted ? `**${pLabel}:** <@${playerId}> activated **${displayName}**!` : `**${pLabel}:** <@${playerId}> readied **${displayName}**`;
  await logGameAction(game, client, actionText, { allowedMentions: { users: [playerId] }, icon: actionIcon });
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, nowExhausted, displayName, healthState, getConditionsForDcMessage?.(game, meta));
  const components = getDcPlayAreaComponents(msgId, nowExhausted, game, meta.dcName);
  await interaction.update({
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
    await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this Play Area can Deplete their upgrade.', ephemeral: true }).catch(() => {});
    return;
  }
  if (isDepletedRemovedFromGame(game, msgId)) {
    await interaction.reply({ content: 'This upgrade was already depleted and removed from the game.', ephemeral: true }).catch(() => {});
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
  await interaction.deferUpdate();
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
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    getPlayableCcSpecialsForDc,
    getCcEffect,
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
  const rest = interaction.customId.replace('dc_cc_special_', '');
  const lastUnderscore = rest.lastIndexOf('_');
  const msgId = rest.slice(0, lastUnderscore);
  const idx = parseInt(rest.slice(lastUnderscore + 1), 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this activation can play a CC here.', ephemeral: true }).catch(() => {});
    return;
  }
  const playable = getPlayableCcSpecialsForDc(game, meta.playerNum, meta.dcName, meta.displayName);
  const card = playable[idx];
  const handKey = meta.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = meta.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  if (!card || hand.indexOf(card) < 0) {
    await interaction.reply({ content: "That card isn't in your hand or isn't playable for this figure.", ephemeral: true }).catch(() => {});
    return;
  }
  // F14: Snapshot for undo before mutating
  const previousHand = (game[handKey] || []).slice();
  const previousDiscard = (game[discardKey] || []).slice();
  const attachKey = meta.playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
  const previousAttachments = isCcAttachment(card) && game[attachKey]?.[msgId] ? game[attachKey][msgId].slice() : undefined;

  await interaction.deferUpdate();
  hand.splice(hand.indexOf(card), 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);
  if (isCcAttachment(card)) {
    game[attachKey] = game[attachKey] || {};
    if (!Array.isArray(game[attachKey][msgId])) game[attachKey][msgId] = [];
    game[attachKey][msgId].push(card);
    await updateAttachmentMessageForDc(game, meta.playerNum, msgId, client);
  }
  const handChannelId = meta.playerNum === 1 ? game.p1HandId : game.p2HandId;
  const handChannel = await interaction.client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = meta.playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, game.gameId, game, meta.playerNum);
    const effectData = getCcEffect(card);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}** (Special Action).${effectReminder}\n\n` + (handPayload.content || '');
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds || [],
      files: handPayload.files || [],
      components: handPayload.components || [],
    }).catch(() => {});
  }
  await updateHandVisualMessage(game, meta.playerNum, interaction.client);
  await updateDiscardPileMessage(game, meta.playerNum, interaction.client);
  await updateDcActionsMessage(game, msgId, interaction.client);
  const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}** (Special Action).`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
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
    getMoveMpButtonRows,
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
    await interaction.reply({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner of this Play Area can use these actions.', ephemeral: true }).catch(() => {});
    return;
  }
  const actionsData = game.dcActionsData?.[msgId];
  const actionsRemaining = actionsData?.remaining ?? DC_ACTIONS_PER_ACTIVATION;
  if (actionsRemaining <= 0) {
    await interaction.reply({ content: 'No actions remaining this activation (2 per DC).', ephemeral: true }).catch(() => {});
    return;
  }
  if (buttonKey === 'dc_special_') {
    const parts = interaction.customId.replace('dc_special_', '').split('_');
    const specialIdx = parseInt(parts[0], 10);
    const specialsUsed = actionsData?.specialsUsed ?? [];
    if (specialsUsed.includes(specialIdx)) {
      await interaction.reply({ content: "That special has already been used this activation (each special once per activation unless a card says otherwise).", ephemeral: true }).catch(() => {});
      return;
    }
    if (!Array.isArray(actionsData.specialsUsed)) actionsData.specialsUsed = [];
    actionsData.specialsUsed.push(specialIdx);
  }

  if (action === 'Move') {
    try {
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
      const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
      const playerNum = meta.playerNum;
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (!pos) {
        await interaction.reply({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch(() => {});
        return;
      }
      const stats = getDcStats(meta.dcName);
      const speed = getEffectiveSpeed(meta.dcName, figureKey, game);
      const bank = game.movementBank?.[msgId];
      const currentMp = bank?.remaining ?? 0;
      const mpRemaining = currentMp + speed;
      const displayName = meta.displayName || meta.dcName;
      const figLabel = (stats.figures ?? 1) > 1 ? `${displayName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : displayName;
      game.movementBank = game.movementBank || {};
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
        await interaction.reply({ content: 'Map spaces data not found for this map. Run: npm run generate-map-spaces', ephemeral: true }).catch(() => {});
        return;
      }
      const profile = getMovementProfile(meta.dcName, figureKey, game);
      const cache = computeMovementCache(pos, mpRemaining, boardState, profile);
      if (cache.cells.size === 0) {
        await interaction.reply({ content: 'No valid movement spaces.', ephemeral: true }).catch(() => {});
        return;
      }
      const actData = game.dcActionsData?.[msgId];
      if (actData) {
        actData.remaining = Math.max(0, actData.remaining - 1);
        await updateDcActionsMessage(game, msgId, client);
      }
      game.moveInProgress = game.moveInProgress || {};
      const moveKey = `${msgId}_${figureIndex}`;
      const mpRows = getMoveMpButtonRows(msgId, figureIndex, mpRemaining);
      const replyMsg = await interaction.reply({
        content: `**Move** — Pick distance (**${mpRemaining}** MP remaining):`,
        components: mpRows,
        ephemeral: false,
        fetchReply: true,
      }).catch(() => null);
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
        distanceMessageId: replyMsg?.id || null,
      };
      game.moveGridMessageIds = game.moveGridMessageIds || {};
      game.moveGridMessageIds[moveKey] = [];
      return;
    } catch (err) {
      console.error('Move button error:', err);
      await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'dc_move');
      await interaction.reply({ content: `Move failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch(() => {});
      return;
    }
  }

  if (action === 'Attack') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    const playerNum = meta.playerNum;
    const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!attackerPos) {
      await interaction.reply({ content: 'This figure has no position yet.', ephemeral: true }).catch(() => {});
      return;
    }
    const stats = getDcStats(meta.dcName);
    const attackInfo = stats.attack || { dice: ['red'], range: [1, 3] };
    const [minRange, maxRange] = attackInfo.range || [1, 3];
    const ms = getMapSpaces(game.selectedMap?.id);
    if (!ms) {
      await interaction.reply({ content: 'Map spaces not found.', ephemeral: true }).catch(() => {});
      return;
    }
    const enemyPlayerNum = playerNum === 1 ? 2 : 1;
    const targets = [];
    const poses = game.figurePositions?.[enemyPlayerNum] || {};
    const dcList = enemyPlayerNum === 1 ? game.player1Squad?.dcList : game.player2Squad?.dcList || [];
    const totals = {};
    for (const d of dcList) totals[d] = (totals[d] || 0) + 1;
    for (const [k, coord] of Object.entries(poses)) {
      const dcName = k.replace(/-\d+-\d+$/, '');
      const size = game.figureOrientations?.[k] || getFigureSize(dcName);
      const cells = getFootprintCells(coord, size);
      const dist = Math.min(...cells.map((c) => getRange(attackerPos, c)));
      if (dist < minRange || dist > maxRange) continue;
      const los = hasLineOfSight(attackerPos, coord, ms);
      const m = k.match(/-(\d+)-(\d+)$/);
      const dg = m ? parseInt(m[1], 10) : 1;
      const fi = m ? parseInt(m[2], 10) : 0;
      const figCount = getDcStats(dcName).figures ?? 1;
      const label = figCount > 1 ? `${dg}${FIGURE_LETTERS[fi] || 'a'}` : (totals[dcName] > 1 ? `${dcName} [DG ${dg}]` : dcName);
      targets.push({ figureKey: k, coord, label, hasLOS: los });
    }
    if (targets.length === 0) {
      await interaction.reply({ content: 'No valid targets in range.', ephemeral: true }).catch(() => {});
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
            return new ButtonBuilder()
              .setCustomId(`attack_target_${msgId}_${figureIndex}_${targetIndex}`)
              .setLabel(`${t.label} (${t.coord.toUpperCase()})`.slice(0, 80))
              .setStyle(ButtonStyle.Danger);
          })
        )
      );
    }
    game.attackTargets = game.attackTargets || {};
    game.attackTargets[`${msgId}_${figureIndex}`] = targets;
    await interaction.reply({
      content: `**Attack** — Choose target for **${figLabel}**:`,
      components: targetRows.slice(0, 5),
      ephemeral: false,
    }).catch(() => {});
    return;
  }

  if (action === 'Interact') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
    const playerNum = meta.playerNum;
    const mapId = game.selectedMap?.id;
    const pos = game.figurePositions?.[playerNum]?.[figureKey];
    if (!pos) {
      await interaction.reply({ content: 'This figure has no position yet (deploy first).', ephemeral: true }).catch(() => {});
      return;
    }
    const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
    if (options.length === 0) {
      await interaction.reply({ content: 'No valid interact options (must be on or adjacent to terminal, door, contraband, or launch panel).', ephemeral: true }).catch(() => {});
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
    await interaction.reply({
      content: `**Interact** — Choose action for **${figLabel}**:`,
      components: rows.slice(0, 5),
      ephemeral: false,
    }).catch(() => {});
    return;
  }

  if (actionsData) {
    actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    await updateDcActionsMessage(game, msgId, client);
  }
  const displayName = meta.displayName || meta.dcName;
  const pLabel = `P${meta.playerNum}`;
  await logGameAction(game, client, `**${pLabel}:** <@${ownerId}> used **${action}**.`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'activate' });
  const abilityId = buttonKey === 'dc_special_' && specialIdx >= 0 ? `dc_special:${meta.dcName}:${specialIdx}` : null;
  const resolveResult = resolveAbility ? resolveAbility(abilityId, { game, msgId, meta, specialLabel: action }) : { applied: false, manualMessage: 'Resolve manually (see rules).' };
  const manualMsg = resolveResult.manualMessage || 'Resolve manually (see rules).';
  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special_done_${game.gameId}_${msgId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success)
  );
  await interaction.reply({
    content: `**${action}** — ${resolveResult.applied ? 'Resolved.' : manualMsg} Click **Done** when finished.`,
    components: [doneRow],
    ephemeral: false,
  }).catch(() => {});
  saveGames();
}
