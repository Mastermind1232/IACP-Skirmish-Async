/**
 * Activation handlers: status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, hasActionsRemainingInGame, GAME_PHASES, PHASE_COLOR, getInitiativePlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, client
 */
export async function handleStatusPhase(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    hasActionsRemainingInGame,
    GAME_PHASES,
    PHASE_COLOR,
    getInitiativePlayerZoneLabel,
    logGameAction,
    updateHandChannelMessages,
    saveGames,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('status_phase_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.reply({ content: 'Only players in this game can end the activation phase.', ephemeral: true }).catch(() => {});
    return;
  }
  const r1 = game.p1ActivationsRemaining ?? 0;
  const r2 = game.p2ActivationsRemaining ?? 0;
  const hasActions = hasActionsRemainingInGame(game, gameId);
  if (r1 > 0 || r2 > 0 || hasActions) {
    const parts = [];
    if (r1 > 0 || r2 > 0) parts.push(`P1: ${r1} activations left, P2: ${r2} activations left`);
    if (hasActions) parts.push('some DCs still have actions to spend');
    await interaction.reply({
      content: `Both players must use all activations and actions first. (${parts.join('; ')})`,
      ephemeral: true,
    }).catch(() => {});
    return;
  }
  const round = game.currentRound || 1;
  const clickerIsP1 = interaction.user.id === game.player1Id;
  game.p1ActivationPhaseEnded = game.p1ActivationPhaseEnded || false;
  game.p2ActivationPhaseEnded = game.p2ActivationPhaseEnded || false;
  if (clickerIsP1) game.p1ActivationPhaseEnded = true;
  else game.p2ActivationPhaseEnded = true;
  const bothEnded = game.p1ActivationPhaseEnded && game.p2ActivationPhaseEnded;
  if (!bothEnded) {
    const waiting = !game.p1ActivationPhaseEnded ? 'P1' : 'P2';
    await interaction.reply({
      content: `${clickerIsP1 ? 'P1' : 'P2'} has ended activation. Waiting for **${waiting}** to click **End R${round} Activation Phase**.`,
      ephemeral: true,
    }).catch(() => {});
    const generalChannel = await client.channels.fetch(game.generalId);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Activation Phase`)
      .setColor(PHASE_COLOR);
    const endBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.message.edit({
      content: `**Round ${round}** — ${game.p1ActivationPhaseEnded ? '✓ P1' : 'P1'} ended activation. ${game.p2ActivationPhaseEnded ? '✓ P2' : 'P2'} ended activation. Both players must click the button when done with activations and any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
    }).catch(() => {});
    saveGames();
    return;
  }
  game.p1ActivationPhaseEnded = false;
  game.p2ActivationPhaseEnded = false;
  await interaction.deferUpdate();
  game.endOfRoundWhoseTurn = game.initiativePlayerId;
  const initPlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
  const otherPlayerId = game.initiativePlayerId === game.player1Id ? game.player2Id : game.player1Id;
  const initZone = getInitiativePlayerZoneLabel(game);
  await logGameAction(game, client, `**End of Round** — 1. Mission Rules/Effects (resolve as needed). 2. <@${game.initiativePlayerId}> (${initZone}Initiative). 3. <@${otherPlayerId}>. 4. Next phase. Initiative player: play any end-of-round effects or CCs, then click **End 'End of Round' window** in your Hand.`, { phase: 'ROUND', icon: 'round', allowedMentions: { users: [game.initiativePlayerId, otherPlayerId] } });
  const generalChannel = await client.channels.fetch(game.generalId);
  const roundEmbed = new EmbedBuilder()
    .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Status Phase`)
    .setDescription(`1. Mission Rules/Effects 2. <@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}Initiative) 3. <@${otherPlayerId}> 4. Go. Both must click **End 'End of Round' window** in their Hand.`)
    .setColor(PHASE_COLOR);
  await generalChannel.send({
    content: `**End of Round window** — <@${game.initiativePlayerId}> (${getInitiativePlayerZoneLabel(game)}Player ${initPlayerNum}), play any end-of-round effects/CCs, then click the button in your Hand.`,
    embeds: [roundEmbed],
    allowedMentions: { users: [game.initiativePlayerId] },
  });
  await interaction.message.edit({ components: [] }).catch(() => {});
  await updateHandChannelMessages(game, client);
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames
 */
export async function handlePassActivationTurn(interaction, ctx) {
  const { getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('pass_activation_turn_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  if (interaction.user.id !== turnPlayerId) {
    await interaction.reply({ content: "It's not your turn to pass.", ephemeral: true }).catch(() => {});
    return;
  }
  const myRem = turnPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRem = turnPlayerId === game.player1Id ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
  if (otherRem <= myRem) {
    await interaction.reply({ content: 'The other player does not have more activations than you.', ephemeral: true }).catch(() => {});
    return;
  }
  const otherPlayerId = turnPlayerId === game.player1Id ? game.player2Id : game.player1Id;
  const otherPlayerNum = otherPlayerId === game.player1Id ? 1 : 2;
  const round = game.currentRound || 1;
  const turnNum = turnPlayerId === game.player1Id ? 1 : 2;
  const turnZone = getPlayerZoneLabel(game, turnPlayerId);
  const roundContentBefore = `<@${turnPlayerId}> (${turnZone}**Player ${turnNum}**) **Round ${round}** — Your turn to activate! You may pass back if the other player has more activations.`;
  game.currentActivationTurnPlayerId = otherPlayerId;
  await interaction.deferUpdate();
  const passLogMsg = await logGameAction(game, client, `<@${turnPlayerId}> passed the turn to <@${otherPlayerId}> (Player ${otherPlayerNum} has more activations remaining).`, { phase: 'ROUND', icon: 'activate', allowedMentions: { users: [otherPlayerId] } });
  pushUndo(game, {
    type: 'pass_turn',
    previousTurnPlayerId: turnPlayerId,
    gameLogMessageId: passLogMsg?.id,
    roundMessageId: game.roundActivationMessageId,
    roundContentBefore,
    gameId,
  });
  if (game.roundActivationMessageId && game.generalId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const initNum = otherPlayerId === game.player1Id ? 1 : 2;
      const newCurrentRem = otherPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const justPassedRem = turnPlayerId === game.player1Id ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const passRows = [];
      if (justPassedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      const otherZone = getPlayerZoneLabel(game, otherPlayerId);
      await msg.edit({
        content: `<@${otherPlayerId}> (${otherZone}**Player ${initNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back if the other player has more activations.' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to update round message for pass:', err);
    }
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcMessageMeta, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, logGameAction, maybeShowEndActivationPhaseButton, client, saveGames
 */
export async function handleEndTurn(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    client,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^end_turn_([^_]+)_(.+)$/);
  if (!match) return;
  const gameId = match[1];
  const dcMsgId = match[2];
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  const meta = dcMessageMeta.get(dcMsgId);
  if (!meta || meta.gameId !== gameId) {
    await interaction.reply({ content: 'Invalid End Turn.', ephemeral: true }).catch(() => {});
    return;
  }
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the player who finished that activation can end the turn.', ephemeral: true }).catch(() => {});
    return;
  }
  const pending = game.pendingEndTurn?.[dcMsgId];
  if (!pending) {
    await interaction.reply({ content: 'This turn was already ended.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  const otherPlayerId = meta.playerNum === 1 ? game.player2Id : game.player1Id;
  const otherPlayerNum = meta.playerNum === 1 ? 2 : 1;
  game.dcFinishedPinged = game.dcFinishedPinged || {};
  game.dcFinishedPinged[dcMsgId] = true;
  delete game.pendingEndTurn[dcMsgId];
  if (pending.messageId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const endTurnMsg = await ch.messages.fetch(pending.messageId);
      await endTurnMsg.edit({ components: [] }).catch(() => {});
    } catch {}
  }
  const actionsData = game.dcActionsData?.[dcMsgId];
  if (actionsData?.threadId) {
    try {
      const thread = await client.channels.fetch(actionsData.threadId);
      await thread.delete();
    } catch (err) {
      console.error('Failed to delete DC activation thread:', err);
    }
    if (game.dcActionsData?.[dcMsgId]) delete game.dcActionsData[dcMsgId];
    if (game.nextAttacksBonusHits?.[meta.playerNum]) delete game.nextAttacksBonusHits[meta.playerNum];
    if (game.movementBank?.[dcMsgId]) delete game.movementBank[dcMsgId];
  }
  try {
    const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
    const playChannel = await client.channels.fetch(playAreaId);
    const dcMsg = await playChannel.messages.fetch(dcMsgId);
    const healthState = dcHealthState.get(dcMsgId) ?? [[null, null]];
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta));
    const components = getDcPlayAreaComponents(dcMsgId, true, game, meta.dcName);
    await dcMsg.edit({
      embeds: [embed],
      files,
      components,
    }).catch(() => {});
  } catch (err) {
    console.error('Failed to update DC card after End Turn:', err);
  }
  game.currentActivationTurnPlayerId = otherPlayerId;
  await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${pending.displayName}** finished all actions — your turn to activate a figure!`, {
    allowedMentions: { users: [otherPlayerId] },
    phase: 'ROUND',
    icon: 'activate',
  });
  if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const round = game.currentRound || 1;
      const newCurrentRem = otherPlayerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const justActedRem = meta.playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      const passRows = [];
      if (justActedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      await msg.edit({
        content: `<@${otherPlayerId}> (**Player ${otherPlayerNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back (opponent has more activations).' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to update round message after end turn:', err);
    }
  }
  await maybeShowEndActivationPhaseButton(game, client);
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, dcExhaustedState, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, updateActivationsMessage, getActionsCounterContent, getDcActionButtons, getActivationMinimapAttachment, getActivateDcButtons, DC_ACTIONS_PER_ACTIVATION, ThreadAutoArchiveDuration, ACTION_ICONS, client, saveGames
 */
export async function handleConfirmActivate(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    updateActivationsMessage,
    getActionsCounterContent,
    getDcActionButtons,
    getActivationMinimapAttachment,
    getActivateDcButtons,
    DC_ACTIONS_PER_ACTIVATION,
    ThreadAutoArchiveDuration,
    ACTION_ICONS,
    client,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^confirm_activate_([^_]+)_(.+)_(\d+)$/);
  if (!match) return;
  const [, gameId, msgId, activateCardMsgIdStr] = match;
  const activateCardMsgId = activateCardMsgIdStr === '0' ? null : activateCardMsgIdStr;
  const game = getGame(gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) return;
  const ownerId = meta.playerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) return;
  const remaining = meta.playerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;
  if (remaining <= 0) {
    await interaction.reply({ content: 'No activations remaining.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});
  dcExhaustedState.set(msgId, true);
  if (meta.playerNum === 1) {
    game.p1ActivationsRemaining--;
    const dcIndex = (game.p1DcMessageIds || []).indexOf(msgId);
    if (dcIndex !== -1) { game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || []; game.p1ActivatedDcIndices.push(dcIndex); }
  } else {
    game.p2ActivationsRemaining--;
    const dcIndex = (game.p2DcMessageIds || []).indexOf(msgId);
    if (dcIndex !== -1) { game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || []; game.p2ActivatedDcIndices.push(dcIndex); }
  }
  await updateActivationsMessage(game, meta.playerNum, client);
  const displayName = meta.displayName || meta.dcName;
  const playAreaId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
  const playChannel = await client.channels.fetch(playAreaId);
  const dcMsg = await playChannel.messages.fetch(msgId);
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, displayName, dcHealthState.get(msgId) ?? [[null, null]], getConditionsForDcMessage?.(game, meta));
  await dcMsg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, meta.dcName) });
  const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
  const thread = await dcMsg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
  game.movementBank = game.movementBank || {};
  game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };
  const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
  const actMinimap = await getActivationMinimapAttachment(game, msgId);
  const actionsPayload = {
    content: pingContent,
    components: getDcActionButtons(msgId, meta.dcName, displayName, game.dcActionsData[msgId], game),
    allowedMentions: { users: [ownerId] },
  };
  if (actMinimap) actionsPayload.files = [actMinimap];
  const actionsMsg = await thread.send(actionsPayload);
  game.dcActionsData[msgId].messageId = actionsMsg.id;
  const logCh = await client.channels.fetch(game.generalId);
  const icon = ACTION_ICONS.activate || '⚡';
  const pLabel = `P${meta.playerNum}`;
  const logMsg = await logCh.send({
    content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
    allowedMentions: { users: [ownerId] },
  });
  game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
  game.dcActivationLogMessageIds[msgId] = logMsg.id;
  if (activateCardMsgId) {
    try {
      const activateCardMsg = await logCh.messages.fetch(activateCardMsgId);
      const activateRows = getActivateDcButtons(game, meta.playerNum);
      await activateCardMsg.edit({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(() => {});
    } catch {}
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - (none required; just deferUpdate and edit)
 */
export async function handleCancelActivate(interaction, _ctx) {
  const match = interaction.customId.match(/^cancel_activate_([^_]+)_(.+)$/);
  if (!match) return;
  const [, gameId, ownerId] = match;
  if (interaction.user.id !== ownerId) return;
  await interaction.deferUpdate();
  await interaction.message.edit({ components: [] }).catch(() => {});
}
