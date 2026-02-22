/**
 * CC-hand + modals: squad_modal_, deploy_modal_, cc_attach_to_, cc_play_select_, cc_discard_select_,
 * deck_illegal_play_, deck_illegal_redo_, cc_shuffle_draw_, cc_play_, cc_draw_, cc_search_discard_,
 * cc_close_discard_, cc_discard_, squad_select_
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';

/** @param {import('discord.js').ModalSubmitInteraction} interaction */
export async function handleSquadModal(interaction, ctx) {
  const { getGame, validateDeckLegal, sendDeckIllegalAlert, applySquadSubmission } = ctx;
  const [, , gameId, playerNum] = interaction.customId.split('_');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
    return;
  }
  if (!game.mapSelected) {
    await interaction.reply({ content: 'Map selection must be completed before you can submit your squad.', ephemeral: true });
    return;
  }
  const isP1 = playerNum === '1';
  const pn = isP1 ? 1 : 2;
  if (!canActAsPlayer(game, interaction.user.id, pn)) {
    await interaction.reply({ content: 'Only the player for this hand can submit.', ephemeral: true });
    return;
  }
  const name = interaction.fields.getTextInputValue('squad_name').trim() || 'Unnamed Squad';
  const dcText = interaction.fields.getTextInputValue('squad_dc').trim();
  const ccText = interaction.fields.getTextInputValue('squad_cc').trim();
  const dcList = dcText ? dcText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const ccList = ccText ? ccText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const squad = { name, dcList, ccList, dcCount: dcList.length, ccCount: ccList.length };
  const validation = validateDeckLegal(squad);
  if (!validation.legal) {
    await sendDeckIllegalAlert(game, isP1, squad, validation, interaction.client);
    await interaction.reply({ content: 'Your deck did not pass validation. Check your **Your Hand** thread for details and choose **PLAY IT ANYWAY** or **REDO**.', ephemeral: true });
    return;
  }
  await applySquadSubmission(game, isP1, squad, interaction.client);
  await interaction.reply({ content: `Squad **${name}** submitted. (${dcList.length} DCs, ${ccList.length} CCs)`, ephemeral: true });
}

/** @param {import('discord.js').ModalSubmitInteraction} interaction */
export async function handleDeployModal(interaction, ctx) {
  const { getGame, getDeploymentZones, updateDeployPromptMessages, logGameAction, saveGames } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 5) {
    await interaction.reply({ content: 'Invalid modal.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const flatIndex = parseInt(parts[4], 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
  const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
  const figMeta = deployMeta?.[flatIndex];
  const figLabel = deployLabels?.[flatIndex];
  if (!figMeta || !figLabel) {
    await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const space = (interaction.fields.getTextInputValue('deploy_space') || '').trim().toLowerCase();
  if (!space) {
    await interaction.reply({ content: 'Please enter a space (e.g. A1).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  if (zones) {
    const initiativePlayerNum = game.initiativePlayerId === game.player1Id ? 1 : 2;
    const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
    const validSpaces = (zones[playerZone] || []).map((s) => String(s).toLowerCase());
    if (validSpaces.length > 0 && !validSpaces.includes(space)) {
      await interaction.reply({ content: `**${space.toUpperCase()}** is not in your deployment zone. Check the map for valid cells (e.g. A1, B2).`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
  }
  const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figurePositions[playerNum][figureKey] = space;
  saveGames();
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
  await updateDeployPromptMessages(game, playerNum, interaction.client);
  await interaction.reply({ content: `Deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** @param {import('discord.js').StringSelectMenuInteraction} interaction */
export async function handleCcAttachTo(interaction, ctx) {
  const { getGame, getCcEffect, buildHandDisplayPayload, updateAttachmentMessageForDc, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_attach_to_', '');
  const game = getGame(gameId);
  const pending = game?.pendingCcAttachment;
  if (!game || !pending) {
    await interaction.reply({ content: 'No attachment pending or game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, card } = pending;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if ((isP1Hand && playerNum !== 1) || (isP2Hand && playerNum !== 2)) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const dcMsgId = interaction.values[0];
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    delete game.pendingCcAttachment;
    await interaction.reply({ content: "That card is no longer in your hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  const attachKey = playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
  game[attachKey] = game[attachKey] || {};
  if (!Array.isArray(game[attachKey][dcMsgId])) game[attachKey][dcMsgId] = [];
  game[attachKey][dcMsgId].push(card);
  delete game.pendingCcAttachment;
  await updateAttachmentMessageForDc(game, playerNum, dcMsgId, interaction.client);
  const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
    const effectData = getCcEffect(card);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}** (Attachment).${effectReminder}\n\n` + handPayload.content;
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await updateHandVisualMessage(game, playerNum, interaction.client);
  await updateDiscardPileMessage(game, playerNum, interaction.client);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> played **${card}** as an attachment.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  saveGames();
}

/** After dropdown selection: show card preview + PLAY CARD / DO SOMETHING ELSE confirmation. */
export async function handleCcPlaySelect(interaction, ctx) {
  const { getGame, getCommandCardImagePath, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_play_select_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  if (!isP1Hand && channelId !== game.p2HandId) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const hand = game[playerNum === 1 ? 'player1CcHand' : 'player2CcHand'] || [];
  const card = interaction.values[0];
  if (!hand.includes(card)) {
    await interaction.reply({ content: "That card isn't in your hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  game.pendingCcConfirmation = { playerNum, card, ts: Date.now() };
  saveGames();
  const { existsSync } = await import('fs');
  const { AttachmentBuilder } = await import('discord.js');
  const embed = new EmbedBuilder().setTitle(card).setDescription(`Play **${card}**?`).setColor(0x2f3136);
  const files = [];
  if (getCommandCardImagePath) {
    const imgPath = getCommandCardImagePath(card);
    if (imgPath && existsSync(imgPath)) {
      const ext = imgPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      const fileName = `cc-confirm-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
      files.push(new AttachmentBuilder(imgPath, { name: fileName }));
      embed.setImage(`attachment://${fileName}`);
    }
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cc_confirm_play_${gameId}`).setLabel('PLAY CARD').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cc_cancel_play_${gameId}`).setLabel('DO SOMETHING ELSE').setStyle(ButtonStyle.Danger),
  );
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
  const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  const handChannel = await interaction.client.channels.fetch(handId);
  await handChannel.send({ embeds: [embed], files, components: [row] });
}

/** PLAY CARD confirmed — execute the actual play. */
export async function handleCcConfirmPlay(interaction, ctx) {
  const { getGame, getCcEffect, isCcAttachment, isCcPlayableNow, isCcPlayLegalByRestriction, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames, getIllegalCcPlayButtons, client } = ctx;
  const gameId = interaction.customId.replace('cc_confirm_play_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!game.pendingCcConfirmation) {
    await interaction.reply({ content: 'No card pending. Try playing again.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const CONFIRM_TTL_MS = 10 * 60 * 1000;
  if (Date.now() - (game.pendingCcConfirmation.ts || 0) > CONFIRM_TTL_MS) {
    delete game.pendingCcConfirmation;
    saveGames();
    await interaction.reply({ content: 'Card selection expired — please re-select from your hand.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, card } = game.pendingCcConfirmation;
  delete game.pendingCcConfirmation;

  // Signal Jammer intercept: cancel this CC and discard both it and Signal Jammer
  if (game.signalJammerActive && card !== 'Signal Jammer') {
    const jammerOwnerNum = game.signalJammerActive.playerNum;
    game.signalJammerActive = null;
    const playedHandKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const playedDiscardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const playedHand = game[playedHandKey] || [];
    const playedIdx = playedHand.indexOf(card);
    if (playedIdx >= 0) {
      playedHand.splice(playedIdx, 1);
      game[playedHandKey] = playedHand;
      game[playedDiscardKey] = [...(game[playedDiscardKey] || []), card];
    }
    const jammerDiscardKey = jammerOwnerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    game[jammerDiscardKey] = [...(game[jammerDiscardKey] || []), 'Signal Jammer'];
    await logGameAction(game, client, `**Signal Jammer** cancelled **${card}** — both cards discarded.`, { phase: 'ACTION', icon: 'card' });
    await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
    await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }

  const isP1Hand = playerNum === 1;
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    await interaction.reply({ content: "That card isn't in your hand anymore.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }
  if (!isCcPlayableNow(game, playerNum, card)) {
    await interaction.reply({ content: "That card can't be played right now (wrong timing).", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }
  const restriction = isCcPlayLegalByRestriction(game, playerNum, card);
  if (!restriction.legal) {
    game.pendingIllegalCcPlay = { playerNum, card, reason: restriction.reason };
    const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
    const handChannel = await client.channels.fetch(handId);
    const msg = await handChannel.send({
      content: `⚠️ The bot thinks playing **${card}** is illegal: ${restriction.reason}\n\nChoose **Ignore and play** to play it anyway, or **Unplay card** to cancel.`,
      components: [getIllegalCcPlayButtons(gameId)],
    });
    game.pendingIllegalCcPlay.messageId = msg.id;
    await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
    await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
    saveGames();
    return;
  }
  if (isCcAttachment(card)) {
    const dcMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    if (dcMsgIds.length === 0 || dcList.length === 0) {
      await interaction.reply({ content: 'No Deployment cards to attach to.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    game.pendingCcAttachment = { playerNum, card };
    const options = dcList.slice(0, 25).map((d, i) => ({
      label: (d.displayName || d.dcName || `DC ${i + 1}`).slice(0, 100),
      value: dcMsgIds[i] || String(i),
    })).filter((o) => o.value);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`cc_attach_to_${gameId}`)
      .setPlaceholder('Attach to which Deployment Card?')
      .addOptions(options);
    await interaction.reply({
      content: `**${card}** is an Attachment. Choose which Deployment Card to attach it to:`,
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: false,
    });
    return;
  }
  const effectData = getCcEffect(card);
  const cost = typeof effectData?.cost === 'number' ? effectData.cost : 0;
  const abilityId = effectData?.abilityId ?? card;

  // For cost > 0 with an ability: try to resolve before moving the card. If we can't apply (timing/context),
  // prompt "We don't think you can do this right now" with [Play anyway] / [Unplay] so the card isn't consumed.
  if (cost !== 0 && ctx.resolveAbility) {
    const result = ctx.resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, combat: game.combat || game.pendingCombat });
    if (result.requiresChoice && result.choiceOptions?.length > 0) {
      // Choice required: we must commit the play first, then send choice buttons.
      await interaction.deferUpdate();
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = game[discardKey] || [];
      game[discardKey].push(card);
      const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(game[handKey], deck, gameId, game, playerNum);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
      await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      const effectDesc = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card });
      game.pendingCcChoice = { abilityId, choiceOptions: result.choiceOptions, gameId, playerNum };
      const rows = [];
      const maxPerRow = 5;
      for (let i = 0; i < result.choiceOptions.length; i++) {
        if (i % maxPerRow === 0) rows.push(new ActionRowBuilder());
        const label = String(result.choiceOptions[i]).slice(0, 80);
        rows[rows.length - 1].addComponents(
          new ButtonBuilder().setCustomId(`cc_choice_${gameId}_${i}`).setLabel(label).setStyle(ButtonStyle.Secondary)
        );
      }
      await handChannel.send({ content: `**Choose one** (for **${card}**):`, components: rows }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }
    if (result.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
      // Space choice required: commit play, then send space grid + map (reusable pick-a-space pattern).
      const { getBoardStateForMovement, getSpaceChoiceRows, getMapAttachmentForSpaces } = ctx;
      if (!getBoardStateForMovement || !getSpaceChoiceRows || !getMapAttachmentForSpaces) {
        await interaction.reply({ content: 'Space choice not supported (missing helpers). Resolve manually.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
      await interaction.deferUpdate();
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = game[discardKey] || [];
      game[discardKey].push(card);
      const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(game[handKey], deck, gameId, game, playerNum);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
      await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      const effectDesc2 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc2}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card });
      game.pendingCcSpaceChoice = { abilityId, gameId, playerNum, card, validSpaces: result.validSpaces };
      const boardState = getBoardStateForMovement(game, null);
      const mapSpaces = boardState?.mapSpaces || { spaces: result.validSpaces };
      const { rows } = getSpaceChoiceRows(`cc_space_${gameId}_`, result.validSpaces, mapSpaces);
      const mapAttachment = await getMapAttachmentForSpaces(game, result.validSpaces);
      const payload = { content: `**Pick a space** (for **${card}**):`, components: rows.slice(0, 5), fetchReply: true };
      if (mapAttachment) payload.files = [mapAttachment];
      await handChannel.send(payload).catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }
    if (result.applied) {
      // Effect applied: resolveAbility already mutated game (e.g. drew cards); remove played card from current hand and add to discard.
      await interaction.deferUpdate();
      const handNow = (game[handKey] || []).slice();
      const idxNow = handNow.indexOf(card);
      if (idxNow >= 0) handNow.splice(idxNow, 1);
      game[handKey] = handNow;
      game[discardKey] = (game[discardKey] || []).concat(card);
      const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(game[handKey], deck, gameId, game, playerNum);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
      await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      const effectDesc3 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc3}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (result.drewCards?.length) {
        await updateHandVisualMessage(game, playerNum, interaction.client);
        const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
        await ctx.logGameAction(game, interaction.client, `CC resolved: Drew ${drewList}.`, { icon: 'card' });
      } else if (result.logMessage) {
        await ctx.logGameAction(game, interaction.client, `CC resolved: ${result.logMessage}`, { icon: 'card' });
      }
      if (result.refreshHand || result.refreshDiscard) {
        if (result.refreshHand) await updateHandVisualMessage(game, playerNum, interaction.client);
        if (result.refreshDiscard) await updateDiscardPileMessage(game, playerNum, interaction.client);
      }
      if (result.refreshBoard && game.boardId && game.selectedMap && ctx.buildBoardMapPayload) {
        try {
          const boardChannel = await interaction.client.channels.fetch(game.boardId);
          const payload = await ctx.buildBoardMapPayload(gameId, game.selectedMap, game);
          await boardChannel.send(payload);
        } catch (err) {
          console.error('Failed to refresh board after token placement:', err);
        }
      }
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
      if (result.revealToPlayer) {
        await interaction.followUp({ content: result.revealToPlayer, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
      saveGames();
      return;
    }
    if (!result.applied && result.manualMessage) {
      // Timing/context mismatch: don't move the card; ping in hand with Play anyway / Unplay (same as illegal-CC flow).
      game.pendingIllegalCcPlay = { playerNum, card, reason: result.manualMessage, fromContext: true };
      const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
      const handChannel = await client.channels.fetch(handId);
      const msg = await handChannel.send({
        content: `We don't think you can do this right now: ${result.manualMessage}\n\nChoose **Ignore and play** to play it anyway (resolve manually), or **Unplay** to cancel.`,
        components: [getIllegalCcPlayButtons(gameId)],
      });
      game.pendingIllegalCcPlay.messageId = msg.id;
      await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
      await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
      saveGames();
      return;
    }
  }

  // Cost 0 (negation flow) or no resolveAbility / effect didn't need pre-check: move card first, then resolve/log as before.
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);
  const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await updateHandVisualMessage(game, playerNum, interaction.client);
  await updateDiscardPileMessage(game, playerNum, interaction.client);
  const effectDesc4 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
  const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc4}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  if (cost === 0 && ctx.getNegationResponseButtons) {
    game.pendingNegation = { playedBy: playerNum, card, fromDc: false, handChannelId: handChannel.id };
    const oppNum = playerNum === 1 ? 2 : 1;
    const oppHandId = oppNum === 1 ? game.p1HandId : game.p2HandId;
    const oppHandChannel = await interaction.client.channels.fetch(oppHandId).catch(() => null);
    if (oppHandChannel) {
      const oppId = oppNum === 1 ? game.player1Id : game.player2Id;
      await oppHandChannel.send({
        content: `Your opponent played **${card}** (cost 0). You may play **Negation** to cancel it.`,
        components: [ctx.getNegationResponseButtons(gameId)],
        allowedMentions: { users: [oppId] },
      }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
    const waitingMsg = await handChannel.send({
      content: `⏳ **${card}** played — waiting for opponent to respond (Negation window open). You'll be notified here when it resolves.`,
    }).catch(() => null);
    if (waitingMsg) game.pendingNegation.waitingMsgId = waitingMsg.id;
    if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
    saveGames();
    return;
  }
  if (ctx.resolveAbility) {
    const result = ctx.resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, combat: game.combat || game.pendingCombat });
    if (result.applied && result.drewCards?.length) {
      await updateHandVisualMessage(game, playerNum, interaction.client);
      const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
      await ctx.logGameAction(game, interaction.client, `CC resolved: Drew ${drewList}.`, { icon: 'card' });
    } else if (result.applied && result.logMessage) {
      await ctx.logGameAction(game, interaction.client, `CC resolved: ${result.logMessage}`, { icon: 'card' });
    } else if (!result.applied && result.manualMessage) {
      await ctx.logGameAction(game, interaction.client, `CC resolved: ${result.manualMessage}`, { icon: 'card' });
    }
    if (result.applied && (result.refreshHand || result.refreshDiscard)) {
      if (result.refreshHand) await updateHandVisualMessage(game, playerNum, interaction.client);
      if (result.refreshDiscard) await updateDiscardPileMessage(game, playerNum, interaction.client);
    }
    if (result.applied && result.revealToPlayer) {
      await interaction.followUp({ content: result.revealToPlayer, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  if (ctx.pushUndo) {
    ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
  }
  saveGames();
}

/** DO SOMETHING ELSE — cancel the pending play. */
export async function handleCcCancelPlay(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_cancel_play_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  delete game.pendingCcConfirmation;
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/**
 * Resolve a CC play: remove from hand, add to discard, update messages, log. Used by normal play and illegal_cc_ignore.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} card - CC name
 * @param {object} ctx - buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client
 */
async function resolveCcPlay(game, playerNum, card, ctx) {
  const { buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, resolveAbility, dcMessageMeta, dcHealthState } = ctx;
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = (game[handKey] || []).slice();
  const idx = hand.indexOf(card);
  if (idx >= 0) hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);
  const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  const handChannel = await client.channels.fetch(handId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  const effectData = getCcEffect(card);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, game.gameId, game, playerNum);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  await updateHandVisualMessage(game, playerNum, client);
  await updateDiscardPileMessage(game, playerNum, client);
  const effectDesc = effectData?.effect ? `\n> *${effectData.effect}*` : '';
  await logGameAction(game, client, `Played command card **${card}**.${effectDesc}`, { phase: 'ACTION', icon: 'card' });
  if (resolveAbility) {
    const abilityId = effectData?.abilityId ?? card;
    const result = resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat });
    if (result.applied && result.drewCards?.length) {
      await updateHandVisualMessage(game, playerNum, client);
    }
    if (result.applied && result.refreshOpponentDiscard) {
      const oppNum = playerNum === 1 ? 2 : 1;
      await updateDiscardPileMessage(game, oppNum, client);
    }
    if (result.applied && (result.refreshHand || result.refreshDiscard)) {
      if (result.refreshHand) await updateHandVisualMessage(game, playerNum, client);
      if (result.refreshDiscard) await updateDiscardPileMessage(game, playerNum, client);
    }
    if (result.applied && result.logMessage) {
      await logGameAction(game, client, `CC resolved: ${result.logMessage}`, { icon: 'card' });
    } else if (result.applied && result.drewCards?.length) {
      const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
      await logGameAction(game, client, `CC resolved: Drew ${drewList}.`, { icon: 'card' });
    } else if (!result.applied && result.manualMessage) {
      await logGameAction(game, client, `CC resolved: ${result.manualMessage}`, { icon: 'card' });
    }
  }
}

/** @param {import('discord.js').ButtonInteraction} interaction — space button for pick-a-space CC (e.g. Smoke Grenade, placement). */
export async function handleCcSpacePick(interaction, ctx) {
  const match = interaction.customId.match(/^cc_space_([^_]+)_(.+)$/);
  if (!match) {
    await interaction.reply({ content: 'Invalid space choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, gameId, space] = match;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, resolveAbility, dcMessageMeta, dcHealthState, logGameAction, updateHandVisualMessage, updateDiscardPileMessage, updateDcActionsMessage, buildBoardMapPayload, client, saveGames } = ctx;
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const pending = game.pendingCcSpaceChoice;
  if (!pending || pending.gameId !== gameId) {
    await interaction.reply({ content: 'No pending space choice for this game.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = pending.playerNum;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the player who played the card can choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const validLower = (pending.validSpaces || []).map((s) => String(s).toLowerCase());
  if (!validLower.includes(chosenSpace)) {
    await interaction.reply({ content: 'That space is not a valid choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  const result = resolveAbility(pending.abilityId, {
    game,
    playerNum,
    dcMessageMeta,
    dcHealthState,
    chosenSpace,
    combat: game.combat || game.pendingCombat,
  });
  delete game.pendingCcSpaceChoice;
  if (result.applied && result.drewCards?.length) {
    await updateHandVisualMessage(game, 1, client);
    await updateHandVisualMessage(game, 2, client);
    const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
    await logGameAction(game, client, `CC effect: Drew ${drewList}.`, { phase: 'ACTION', icon: 'card' });
  } else if (result.applied && result.logMessage) {
    await logGameAction(game, client, `CC effect: ${result.logMessage}`, { phase: 'ACTION', icon: 'card' });
  }
  if (result.applied && (result.refreshHand || result.refreshDiscard)) {
    if (result.refreshHand) await updateHandVisualMessage(game, playerNum, client);
    if (result.refreshDiscard) await updateDiscardPileMessage(game, playerNum, client);
  }
  if (result.applied && result.refreshDcEmbed && result.refreshDcEmbedMsgIds?.length) {
    for (const msgId of result.refreshDcEmbedMsgIds) {
      await updateDcActionsMessage(game, msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  if (result.applied && result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to refresh board after token placement:', err);
    }
  }
  try {
    await interaction.message.edit({ content: 'Space chosen.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch {}
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — choice button for choose-one CC (e.g. Retaliation). */
export async function handleCcChoice(interaction, ctx) {
  const match = interaction.customId.match(/^cc_choice_(.+)_(\d+)$/);
  if (!match) {
    await interaction.reply({ content: 'Invalid choice.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, gameId, choiceIndexStr] = match;
  const choiceIndex = parseInt(choiceIndexStr, 10);
  const { getGame, resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, updateHandVisualMessage, updateDiscardPileMessage, updateDcActionsMessage, buildDcEmbedAndFiles, getConditionsForDcMessage, getDcPlayAreaComponents, client, saveGames } = ctx;
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const pending = game.pendingCcChoice;
  if (!pending || pending.gameId !== gameId) {
    await interaction.reply({ content: 'No pending choice for this game.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = pending.playerNum;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the player who played the card can choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (choiceIndex < 0 || choiceIndex >= (pending.choiceOptions?.length ?? 0)) {
    await interaction.reply({ content: 'Invalid option.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const chosenOption = pending.choiceOptions?.[choiceIndex];
  await interaction.deferUpdate();
  const result = resolveAbility(pending.abilityId, {
    game,
    playerNum,
    dcMessageMeta,
    dcHealthState,
    choiceIndex,
    chosenOption,
    combat: game.combat || game.pendingCombat,
  });
  delete game.pendingCcChoice;
  if (result.applied && result.readyDcMsgIds?.length && dcExhaustedState) {
    for (const msgId of result.readyDcMsgIds) {
      dcExhaustedState.set(msgId, false);
      const meta = dcMessageMeta.get(msgId);
      if (meta && buildDcEmbedAndFiles && getDcPlayAreaComponents) {
        try {
          const chId = meta.playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
          const ch = await client.channels.fetch(chId);
          const msg = await ch.messages.fetch(msgId);
          const healthState = dcHealthState.get(msgId) || [];
          const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, false, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta));
          const components = getDcPlayAreaComponents(msgId, false, game, meta.dcName);
          await msg.edit({ embeds: [embed], files, components }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        } catch (err) {
          console.error('Failed to update DC embed after ready:', err);
        }
      }
    }
  }
  if (result.applied && result.drewCards?.length) {
    await updateHandVisualMessage(game, 1, client);
    await updateHandVisualMessage(game, 2, client);
    const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
    await logGameAction(game, client, `CC effect: Drew ${drewList}.`, { phase: 'ACTION', icon: 'card' });
  } else if (result.applied && result.logMessage) {
    await logGameAction(game, client, `CC effect: ${result.logMessage}`, { phase: 'ACTION', icon: 'card' });
  }
  if (result.applied && (result.refreshHand || result.refreshDiscard)) {
    if (result.refreshHand) await updateHandVisualMessage(game, playerNum, client);
    if (result.refreshDiscard) await updateDiscardPileMessage(game, playerNum, client);
  }
  if (result.applied && result.refreshDcEmbed && (result.refreshDcEmbedMsgIds?.length || result.readyDcMsgIds?.length)) {
    const msgIds = result.refreshDcEmbedMsgIds || result.readyDcMsgIds || [];
    for (const msgId of msgIds) {
      await updateDcActionsMessage(game, msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  if (!result.applied && result.manualMessage) {
    await logGameAction(game, client, `CC effect: ${result.manualMessage}`, { phase: 'ACTION', icon: 'card' });
  }
  try {
    await interaction.message.edit({ content: 'Choice resolved.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch {}
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Ignore and play" for pending illegal CC. */
export async function handleIllegalCcIgnore(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('illegal_cc_ignore_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingIllegalCcPlay) {
    await interaction.reply({ content: 'No pending play to resolve.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, card, messageId } = game.pendingIllegalCcPlay;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the player who played the card can choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  await resolveCcPlay(game, playerNum, card, ctx);
  delete game.pendingIllegalCcPlay;
  if (messageId && interaction.channel?.id) {
    try {
      const msg = await interaction.channel.messages.fetch(messageId);
      await msg.edit({ content: 'Play resolved.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {}
  }
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Play Negation" to cancel opponent's cost-0 CC. */
export async function handleNegationPlay(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('negation_play_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingNegation) {
    await interaction.reply({ content: 'No pending play to negate.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playedBy, card, waitingMsgId, handChannelId } = game.pendingNegation;
  const oppNum = playedBy === 1 ? 2 : 1;
  if (!canActAsPlayer(game, interaction.user.id, oppNum)) {
    await interaction.reply({ content: 'Only the opponent can play Negation.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const handKey = oppNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = oppNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  const idx = hand.indexOf('Negation');
  if (idx < 0) {
    await interaction.reply({ content: "You don't have Negation in your hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Negation');
  delete game.pendingNegation;
  await updateHandVisualMessage(game, oppNum, client);
  await updateDiscardPileMessage(game, oppNum, client);
  await interaction.message.edit({ content: `**Negation** cancelled **${card}**.`, components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  const negPlayerId = oppNum === 1 ? game.player1Id : game.player2Id;
  await logGameAction(game, client, `<@${negPlayerId}> played **Negation** — cancelled **${card}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [negPlayerId] } });
  // Notify the player whose card was cancelled
  if (waitingMsgId && handChannelId) {
    const playingHandChannel = await client.channels.fetch(handChannelId).catch(() => null);
    if (playingHandChannel) {
      const waitingMsg = await playingHandChannel.messages.fetch(waitingMsgId).catch(() => null);
      const playedById = playedBy === 1 ? game.player1Id : game.player2Id;
      if (waitingMsg) await waitingMsg.edit({ content: `❌ Your **${card}** was cancelled by your opponent's **Negation**. <@${playedById}>` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Let it resolve" for pending cost-0 CC. */
export async function handleNegationLetResolve(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames, resolveAbility, dcMessageMeta, dcHealthState, updateDcActionsMessage, updateAttachmentMessageForDc, isCcAttachment } = ctx;
  const gameId = interaction.customId.replace('negation_let_resolve_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingNegation) {
    await interaction.reply({ content: 'No pending play to resolve.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playedBy, card, fromDc, msgId, wasAttachment, waitingMsgId, handChannelId } = game.pendingNegation;
  const oppNum = playedBy === 1 ? 2 : 1;
  if (!canActAsPlayer(game, interaction.user.id, oppNum)) {
    await interaction.reply({ content: 'Only the opponent can choose to let it resolve.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  delete game.pendingNegation;
  await interaction.message.edit({ content: `**${card}** resolves.`, components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  if (fromDc && msgId && wasAttachment && updateAttachmentMessageForDc && isCcAttachment?.(card)) {
    const attachKey = playedBy === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
    const discardKey = playedBy === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const discard = game[discardKey] || [];
    const idx = discard.indexOf(card);
    if (idx >= 0) {
      discard.splice(idx, 1);
      game[discardKey] = discard;
    }
    game[attachKey] = game[attachKey] || {};
    if (!Array.isArray(game[attachKey][msgId])) game[attachKey][msgId] = [];
    game[attachKey][msgId].push(card);
    await updateAttachmentMessageForDc(game, playedBy, msgId, client);
  }
  if (resolveAbility) {
    const effectData = getCcEffect(card);
    const abilityId = effectData?.abilityId ?? card;
    const result = resolveAbility(abilityId, { game, playerNum: playedBy, cardName: card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat, msgId });
    if (result.applied && result.drewCards?.length) {
      await updateHandVisualMessage(game, playedBy, client);
      const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
      await logGameAction(game, client, `CC effect: Drew ${drewList}.`, { phase: 'ACTION', icon: 'card' });
    } else if (result.applied && result.logMessage) {
      await logGameAction(game, client, `CC effect: ${result.logMessage}`, { phase: 'ACTION', icon: 'card' });
      if (result.refreshDcEmbed && fromDc && msgId && updateDcActionsMessage) {
        await updateDcActionsMessage(game, msgId, client).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
    } else if (result.applied && result.refreshOpponentDiscard) {
      const opp = playedBy === 1 ? 2 : 1;
      await updateDiscardPileMessage(game, opp, client);
    } else if (!result.applied && result.manualMessage) {
      await logGameAction(game, client, `CC effect: ${result.manualMessage}`, { phase: 'ACTION', icon: 'card' });
    }
  }
  // Notify the player whose card resolved
  if (waitingMsgId && handChannelId) {
    const playingHandChannel = await client.channels.fetch(handChannelId).catch(() => null);
    if (playingHandChannel) {
      const waitingMsg = await playingHandChannel.messages.fetch(waitingMsgId).catch(() => null);
      const playedById = playedBy === 1 ? game.player1Id : game.player2Id;
      if (waitingMsg) await waitingMsg.edit({ content: `✅ **${card}** resolved! <@${playedById}>` }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Play Celebration" to gain 4 VP. */
export async function handleCelebrationPlay(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('celebration_play_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingCelebration) {
    await interaction.reply({ content: 'No Celebration window open.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { attackerPlayerNum } = game.pendingCelebration;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.reply({ content: 'Only the player who defeated the figure can play Celebration.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const handKey = attackerPlayerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = attackerPlayerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  const idx = hand.indexOf('Celebration');
  if (idx < 0) {
    await interaction.reply({ content: "You don't have Celebration in your hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Celebration');
  const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
  game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
  game[vpKey].total += 4;
  game[vpKey].objectives = (game[vpKey].objectives || 0) + 4;
  delete game.pendingCelebration;
  await updateHandVisualMessage(game, attackerPlayerNum, client);
  await updateDiscardPileMessage(game, attackerPlayerNum, client);
  await interaction.message.edit({ content: `**Celebration** — +4 VP.`, components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  const celPlayerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
  await logGameAction(game, client, `<@${celPlayerId}> played **Celebration** — gained 4 VP.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [celPlayerId] } });
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Pass" on Celebration. */
export async function handleCelebrationPass(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('celebration_pass_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingCelebration) {
    await interaction.reply({ content: 'No Celebration window open.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { attackerPlayerNum } = game.pendingCelebration;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.reply({ content: 'Only the player who defeated the figure can pass.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  delete game.pendingCelebration;
  await interaction.message.edit({ content: 'Passed on Celebration.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Unplay card" for pending illegal CC. */
export async function handleIllegalCcUnplay(interaction, ctx) {
  const { getGame, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('illegal_cc_unplay_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingIllegalCcPlay) {
    await interaction.reply({ content: 'No pending play to cancel.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { playerNum, messageId } = game.pendingIllegalCcPlay;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the player who played the card can choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  delete game.pendingIllegalCcPlay;
  if (messageId && interaction.channel?.id) {
    try {
      const msg = await interaction.channel.messages.fetch(messageId);
      await msg.edit({ content: 'Cancelled — card not played.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    } catch {}
  }
  saveGames();
}

/** @param {import('discord.js').StringSelectMenuInteraction} interaction */
export async function handleCcDiscardSelect(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_discard_select_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && channelId !== game.p2HandId) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];
  const card = interaction.values[0];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    await interaction.reply({ content: "That card isn't in your hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);
  const handChannel = await interaction.client.channels.fetch(isP1Hand ? game.p1HandId : game.p2HandId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')));
  const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
    handPayload.content = `**Discard CC** — Discarded **${card}**.\n\n` + handPayload.content;
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  await interaction.message.delete().catch((err) => { console.error('[discord]', err?.message ?? err); });
  await updateHandVisualMessage(game, playerNum, interaction.client);
  await updateDiscardPileMessage(game, playerNum, interaction.client);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> discarded **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleDeckIllegalPlay(interaction, ctx) {
  const { getGame, pendingIllegalSquad, PENDING_ILLEGAL_TTL_MS, applySquadSubmission } = ctx;
  const parts = interaction.customId.replace('deck_illegal_play_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const isP1 = playerNum === 1;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner of this hand can choose Play It Anyway.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const key = `${gameId}_${playerNum}`;
  const pending = pendingIllegalSquad.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    pendingIllegalSquad.delete(key);
    await interaction.reply({ content: 'This deck choice has expired. Please submit your squad again.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  pendingIllegalSquad.delete(key);
  await interaction.deferUpdate();
  await applySquadSubmission(game, isP1, pending.squad, interaction.client);
  await interaction.followUp({ content: `Squad **${pending.squad.name || 'Unnamed'}** accepted (Play It Anyway).`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleDeckIllegalRedo(interaction, ctx) {
  const { getGame, pendingIllegalSquad, getHandTooltipEmbed, getSquadSelectEmbed, getHandSquadButtons, saveGames } = ctx;
  const parts = interaction.customId.replace('deck_illegal_redo_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const isP1 = playerNum === 1;
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner of this hand can choose Redo.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const key = `${gameId}_${playerNum}`;
  pendingIllegalSquad.delete(key);
  if (isP1) game.player1Squad = null;
  else game.player2Squad = null;
  if (game.bothReadyPosted) game.bothReadyPosted = false;
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await interaction.client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 15 });
  const botMsg = handMessages.find((m) => m.author.bot && m.embeds?.some((e) => e.title?.includes('Deck Selection')));
  if (botMsg) {
    await botMsg.edit({
      embeds: [getHandTooltipEmbed(game, playerNum), getSquadSelectEmbed(playerNum, null)],
      components: [getHandSquadButtons(game.gameId, playerNum)],
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  saveGames();
  await interaction.deferUpdate();
  await interaction.message.edit({ content: 'Squad cleared. Please submit again using Select Squad, .vsav upload, or pasted list.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await interaction.followUp({ content: 'Your squad has been cleared. Submit a new squad using **Select Squad**, upload a .vsav file, or paste your list.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcShuffleDraw(interaction, ctx) {
  const { getGame, shuffleArray, buildHandDisplayPayload, updateHandVisualMessage, updatePlayAreaDcButtons, sendRoundActivationPhaseMessage, logGameAction, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('cc_shuffle_draw_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const squad = playerNum === 1 ? game.player1Squad : game.player2Squad;
  const ccList = squad?.ccList || [];
  const drawnKey = playerNum === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
  if (game[drawnKey]) {
    await interaction.reply({ content: "You've already drawn your starting hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  const attachKey = playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
  const placed = (game[attachKey] && Object.values(game[attachKey]).flat()) || [];
  const deck = ccList.filter((c) => !placed.includes(c));
  shuffleArray(deck);
  let hand = deck.splice(0, 3);
  const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  if (game.testScenarioPrimaryCard && playerNum === 1 && !hand.includes(game.testScenarioPrimaryCard)) {
    const replaced = hand[0];
    hand = [game.testScenarioPrimaryCard, hand[1], hand[2]].filter(Boolean);
    if (replaced) deck.push(replaced);
    const pcIdx = deck.indexOf(game.testScenarioPrimaryCard);
    if (pcIdx >= 0) deck.splice(pcIdx, 1);
  }
  game[deckKey] = deck;
  game[handKey] = hand;
  game[drawnKey] = true;
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  await logGameAction(game, client, `<@${playerId}> shuffled and drew 3 Command Cards.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });
  const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
  await interaction.message.edit({
    content: handPayload.content,
    embeds: handPayload.embeds,
    files: handPayload.files || [],
    components: handPayload.components,
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await updateHandVisualMessage(game, playerNum, client);
  if (game.player1CcDrawn && game.player2CcDrawn) {
    await updatePlayAreaDcButtons(game, client);
    await sendRoundActivationPhaseMessage(game, client);
  }
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcPlay(interaction, ctx) {
  const { getGame, getPlayableCcFromHand } = ctx;
  const gameId = interaction.customId.replace('cc_play_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  if (hand.length === 0) {
    await interaction.reply({ content: 'No cards in hand to play.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playable = getPlayableCcFromHand(game, playerNum, hand);
  if (playable.length === 0) {
    await interaction.reply({
      content: "No command cards can be played right now (wrong timing). Play cards during your activation, at start/end of round, or during an attack as appropriate.",
      ephemeral: true,
    }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cc_play_select_${gameId}`)
    .setPlaceholder('Choose a card to play')
    .addOptions(playable.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
  await interaction.reply({
    content: '**Play CC** — Select a card:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: false,
  });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcDraw(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, logGameAction, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('cc_draw_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  let deck = (game[deckKey] || []).slice();
  const hand = (game[handKey] || []).slice();
  if (deck.length === 0) {
    await interaction.reply({ content: 'No cards in deck to draw.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  const card = deck.shift();
  hand.push(card);
  game[deckKey] = deck;
  game[handKey] = hand;
  const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
  handPayload.content = `**Draw CC** — Drew **${card}**.\n\n` + handPayload.content;
  await interaction.message.edit({
    content: handPayload.content,
    embeds: handPayload.embeds,
    files: handPayload.files || [],
    components: handPayload.components,
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  await updateHandVisualMessage(game, playerNum, client);
  await logGameAction(game, client, `<@${interaction.user.id}> drew **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcSearchDiscard(interaction, ctx) {
  const { getGame, buildDiscardPileDisplayPayload, updateDiscardPileMessage, saveGames, client } = ctx;
  const match = interaction.customId.match(/^cc_search_discard_([^_]+)_(\d+)$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Area = channelId === game.p1PlayAreaId;
  const isP2Area = channelId === game.p2PlayAreaId;
  if ((!isP1Area && !isP2Area) || (isP1Area && playerNum !== 1) || (isP2Area && playerNum !== 2)) {
    await interaction.reply({ content: 'Use this in your Play Area.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner of this Play Area can search their discard pile.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const existingThreadId = playerNum === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId;
  if (existingThreadId) {
    try {
      const existing = await client.channels.fetch(existingThreadId);
      if (existing) {
        await interaction.reply({ content: 'Discard pile thread is already open. Close it first.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        return;
      }
    } catch { /* thread was deleted */ }
    if (playerNum === 1) delete game.p1DiscardThreadId;
    else delete game.p2DiscardThreadId;
  }
  await interaction.deferUpdate();
  const discard = playerNum === 1 ? (game.player1CcDiscard || []) : (game.player2CcDiscard || []);
  const threadName = `Discard Pile (${discard.length} cards)`;
  const thread = await interaction.message.startThread({
    name: threadName.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
  });
  if (playerNum === 1) game.p1DiscardThreadId = thread.id;
  else game.p2DiscardThreadId = thread.id;
  const chunks = buildDiscardPileDisplayPayload(discard);
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_close_discard_${gameId}_${playerNum}`)
      .setLabel('Close Discard Pile')
      .setStyle(ButtonStyle.Danger)
  );
  if (chunks.length === 0) {
    await thread.send({
      content: 'Discard pile is empty.',
      embeds: [new EmbedBuilder().setTitle('Command Cards in Discard Pile').setDescription('*Empty*').setColor(0x2f3136)],
      components: [closeRow],
    });
  } else {
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      await thread.send({
        embeds: chunks[i].embeds,
        files: chunks[i].files,
        components: isLast ? [closeRow] : [],
      });
    }
  }
  await updateDiscardPileMessage(game, playerNum, client);
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcCloseDiscard(interaction, ctx) {
  const { getGame, updateDiscardPileMessage, saveGames, client } = ctx;
  const match = interaction.customId.match(/^cc_close_discard_([^_]+)_(\d+)$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const threadId = playerNum === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId;
  if (!threadId) {
    await interaction.reply({ content: 'No discard pile thread is open.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.reply({ content: 'Only the owner can close the discard pile thread.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate();
  try {
    const thread = await client.channels.fetch(threadId);
    await thread.delete();
  } catch (err) {
    console.error('Failed to delete discard pile thread:', err);
  }
  if (playerNum === 1) delete game.p1DiscardThreadId;
  else delete game.p2DiscardThreadId;
  await updateDiscardPileMessage(game, playerNum, client);
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcDiscard(interaction, ctx) {
  const { getGame } = ctx;
  const gameId = interaction.customId.replace('cc_discard_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  if (hand.length === 0) {
    await interaction.reply({ content: 'No cards in hand to discard.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cc_discard_select_${gameId}`)
    .setPlaceholder('Choose a card to discard')
    .addOptions(hand.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
  await interaction.reply({
    content: '**Discard CC** — Select a card to discard:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: false,
  });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleSquadSelect(interaction, ctx) {
  const { getGame } = ctx;
  const [, , gameId, playerNum] = interaction.customId.split('_');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
    return;
  }
  if (!game.mapSelected) {
    await interaction.reply({ content: 'Map selection must be completed before you can select your squad.', ephemeral: true });
    return;
  }
  const isP1 = playerNum === '1';
  const pn = isP1 ? 1 : 2;
  if (!canActAsPlayer(game, interaction.user.id, pn)) {
    await interaction.reply({ content: 'Only the owner of this hand can select a squad.', ephemeral: true });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`squad_modal_${gameId}_${playerNum}`)
    .setTitle('Submit Squad');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('squad_name')
        .setLabel('Squad name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Vader's Fist")
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('squad_dc')
        .setLabel('Deployment Cards (one per line, max 40 pts)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Darth Vader\nStormtrooper\nStormtrooper\n...')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('squad_cc')
        .setLabel('Command Cards (one per line, exactly 15)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Force Lightning\nBurst Fire\n...')
        .setRequired(true)
    )
  );
  await interaction.showModal(modal);
}
