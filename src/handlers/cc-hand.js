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
import { COLORS } from '../discord/colors.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import { normalizeSquadInput } from '../game/validation.js';
import { getDcEffects, getDcKeywords } from '../data-loader.js';
import { awardObjectiveVp } from '../game/index.js';
import {
  getPlayerId, getHandChannelId, getSquad, getCcDiscard, getCcDeck,
  getDiscardThreadId,
  ccHandKey, ccDiscardKey, ccDeckKey, ccDrawnKey, ccAttachmentsKey, vpKey as vpKeyFn,
  opponentPlayerNum,
  getInitiativePlayerNum,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

/** @param {import('discord.js').ModalSubmitInteraction} interaction */
export async function handleSquadModal(interaction, ctx) {
  const { getGame, validateDeckLegal, sendSquadConfirmation } = ctx;
  const [, , gameId, playerNum] = interaction.customId.split('_');
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  if (!game.mapSelected) {
    await interaction.reply({ content: 'Map selection must be completed before you can submit your squad.', ephemeral: true });
    return;
  }
  const isP1 = playerNum === '1';
  const pn = isP1 ? 1 : 2;
  if (!await requirePlayer(interaction, game, interaction.user.id, pn, canActAsPlayer, 'Only the player for this hand can submit.', { useReply: true })) return;
  const name = interaction.fields.getTextInputValue('squad_name').trim() || 'Unnamed Squad';
  const dcText = interaction.fields.getTextInputValue('squad_dc').trim();
  const ccText = interaction.fields.getTextInputValue('squad_cc').trim();
  const dcList = dcText ? dcText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const ccList = ccText ? ccText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const squad = { name, dcList, ccList, dcCount: dcList.length, ccCount: ccList.length };
  normalizeSquadInput(squad);
  const validation = validateDeckLegal(squad);
  await sendSquadConfirmation(game, isP1, squad, validation, interaction.client);
  await interaction.reply({ content: `Parsed **${name}** (${dcList.length} DCs, ${ccList.length} CCs). Review your list in the hand channel and confirm.`, ephemeral: true });
}

/** @param {import('discord.js').ModalSubmitInteraction} interaction */
export async function handleDeployModal(interaction, ctx) {
  const { getGame, getDeploymentZones, updateDeployPromptMessages, logGameAction, saveGames } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 5) {
    await interaction.reply({ content: 'Invalid modal.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const flatIndex = parseInt(parts[4], 10);
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this deck can deploy.', { useReply: true })) return;
  const deployMeta = playerNum === 1 ? game.player1DeployMetadata : game.player2DeployMetadata;
  const deployLabels = playerNum === 1 ? game.player1DeployLabels : game.player2DeployLabels;
  const figMeta = deployMeta?.[flatIndex];
  const figLabel = deployLabels?.[flatIndex];
  if (!figMeta || !figLabel) {
    await interaction.reply({ content: 'Figure not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const space = (interaction.fields.getTextInputValue('deploy_space') || '').trim().toLowerCase();
  if (!space) {
    await interaction.reply({ content: 'Please enter a space (e.g. A1).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  if (zones) {
    const initiativePlayerNum = getInitiativePlayerNum(game);
    const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
    const validSpaces = (zones[playerZone] || []).map((s) => String(s).toLowerCase());
    if (validSpaces.length > 0 && !validSpaces.includes(space)) {
      await interaction.reply({ content: `**${space.toUpperCase()}** is not in your deployment zone. Check the map for valid cells (e.g. A1, B2).`, ephemeral: true }).catch(discordCatch);
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
  await interaction.reply({ content: `Deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**.`, ephemeral: true }).catch(discordCatch);
}

/** @param {import('discord.js').StringSelectMenuInteraction} interaction */
export async function handleCcAttachTo(interaction, ctx) {
  const { getGame, getCcEffect, buildHandDisplayPayload, updateAttachmentMessageForDc, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_attach_to_', '');
  const game = getGame(gameId);
  const pending = game?.pendingCcAttachment;
  if (!game || !pending) {
    await interaction.reply({ content: 'No attachment pending or game not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, card } = pending;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if ((isP1Hand && playerNum !== 1) || (isP2Hand && playerNum !== 2)) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const dcMsgId = interaction.values[0];
  const handKey = ccHandKey(playerNum);
  const discardKey = ccDiscardKey(playerNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    delete game.pendingCcAttachment;
    await interaction.reply({ content: "That card is no longer in your hand.", ephemeral: true }).catch(discordCatch);
    saveGames();
    return;
  }
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  const attachKey = ccAttachmentsKey(playerNum);
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
    }).catch(discordCatch);
  }
  await interaction.message.delete().catch(discordCatch);
  await updateHandVisualMessage(game, playerNum, interaction.client);
  await updateDiscardPileMessage(game, playerNum, interaction.client);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> played **${card}** as an attachment.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  saveGames();
}

/** After dropdown selection: show card preview + PLAY CARD / DO SOMETHING ELSE confirmation. */
export async function handleCcPlaySelect(interaction, ctx) {
  const { getGame, getCommandCardImagePath, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_play_select_', '');
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  if (!isP1Hand && channelId !== game.p2HandId) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const hand = game[ccHandKey(playerNum)] || [];
  const card = interaction.values[0];
  if (!hand.includes(card)) {
    await interaction.reply({ content: "That card isn't in your hand.", ephemeral: true }).catch(discordCatch);
    return;
  }
  game.pendingCcConfirmation = { playerNum, card, ts: Date.now() };
  saveGames();
  const { existsSync } = await import('fs');
  const { AttachmentBuilder } = await import('discord.js');
  const embed = new EmbedBuilder().setTitle(card).setDescription(`Play **${card}**?`).setColor(COLORS.DARK_EMBED);
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
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.delete().catch(discordCatch);
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await interaction.client.channels.fetch(handId);
  await handChannel.send({ embeds: [embed], files, components: [row] });
}

/** PLAY CARD confirmed — execute the actual play. */
export async function handleCcConfirmPlay(interaction, ctx) {
  const { getGame, getCcEffect, isCcAttachment, isCcPlayableNow, isCcPlayLegalByRestriction, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames, getIllegalCcPlayButtons, getCommandCardImagePath, client } = ctx;
  const gameId = interaction.customId.replace('cc_confirm_play_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingCcConfirmation) {
    await interaction.followUp({ content: 'No card pending. Try playing again.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const CONFIRM_TTL_MS = 10 * 60 * 1000;
  if (Date.now() - (game.pendingCcConfirmation.ts || 0) > CONFIRM_TTL_MS) {
    delete game.pendingCcConfirmation;
    saveGames();
    await interaction.followUp({ content: 'Card selection expired — please re-select from your hand.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, card } = game.pendingCcConfirmation;
  // 5H: Verify the interacting user is the player who initiated this CC play
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Not your card to confirm.')) return;
  delete game.pendingCcConfirmation;

  // Signal Jammer intercept: cancel this CC and discard both it and Signal Jammer
  if (game.signalJammerActive && card !== 'Signal Jammer') {
    const jammerOwnerNum = game.signalJammerActive.playerNum;
    game.signalJammerActive = null;
    const playedHandKey = ccHandKey(playerNum);
    const playedDiscardKey = ccDiscardKey(playerNum);
    const playedHand = game[playedHandKey] || [];
    const playedIdx = playedHand.indexOf(card);
    if (playedIdx >= 0) {
      playedHand.splice(playedIdx, 1);
      game[playedHandKey] = playedHand;
      game[playedDiscardKey] = [...(game[playedDiscardKey] || []), card];
    }
    const jammerDiscardKey = ccDiscardKey(jammerOwnerNum);
    game[jammerDiscardKey] = [...(game[jammerDiscardKey] || []), 'Signal Jammer'];
    await logGameAction(game, client, `**Signal Jammer** cancelled **${card}** — both cards discarded.`, { phase: 'ACTION', icon: 'card' });
    await interaction.message.delete().catch(discordCatch);
    saveGames();
    return;
  }

  const isP1Hand = playerNum === 1;
  const handKey = ccHandKey(playerNum);
  const discardKey = ccDiscardKey(playerNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    await interaction.followUp({ content: "That card isn't in your hand anymore.", ephemeral: true }).catch(discordCatch);
    await interaction.message.delete().catch(discordCatch);
    saveGames();
    return;
  }
  if (!isCcPlayableNow(game, playerNum, card)) {
    await interaction.followUp({ content: "That card can't be played right now (wrong timing).", ephemeral: true }).catch(discordCatch);
    await interaction.message.delete().catch(discordCatch);
    saveGames();
    return;
  }
  const restriction = isCcPlayLegalByRestriction(game, playerNum, card);
  if (!restriction.legal) {
    game.pendingIllegalCcPlay = { playerNum, card, reason: restriction.reason };
    const handId = getHandChannelId(game, playerNum);
    const handChannel = await client.channels.fetch(handId);
    const msg = await handChannel.send({
      content: `⚠️ The bot thinks playing **${card}** is illegal: ${restriction.reason}\n\nChoose **Ignore and play** to play it anyway, or **Unplay card** to cancel.`,
      components: [getIllegalCcPlayButtons(gameId)],
    });
    game.pendingIllegalCcPlay.messageId = msg.id;
    await interaction.message.delete().catch(discordCatch);
    saveGames();
    return;
  }
  // Fast Learner (Mara Jade): if CC was played via Fast Learner bypass, mark ability as used for the round
  if (restriction.fastLearner) {
    const dcList2 = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    for (const dc of dcList2) {
      const dn = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const eff = getDcEffects()?.[dn];
      if ((eff?.specialAbilityIds || []).includes('adaptive_skills_mara_jade')) {
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        game.roundFigureAbilityUsed[`${dn}_fast_learner`] = true;
        break;
      }
    }
  }
  if (isCcAttachment(card)) {
    const dcMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    if (dcMsgIds.length === 0 || dcList.length === 0) {
      await interaction.followUp({ content: 'No Deployment cards to attach to.', ephemeral: true }).catch(discordCatch);
      return;
    }
    game.pendingCcAttachment = { playerNum, card };
    // Filter DCs by playableBy restriction
    const ccEffect = getCcEffect(card);
    const playableBy = (ccEffect?.playableBy || '').trim();
    const hasRestriction = playableBy && playableBy.toLowerCase() !== 'any figure';
    let options = dcList.slice(0, 25).map((d, i) => ({
      label: (d.displayName || d.dcName || `DC ${i + 1}`).slice(0, 100),
      value: dcMsgIds[i] || String(i),
      dcName: typeof d === 'object' ? (d.dcName || d.displayName) : d,
      displayName: typeof d === 'object' ? (d.displayName || d.dcName) : d,
    })).filter((o) => o.value);
    if (hasRestriction) {
      const allKeywords = getDcKeywords() || {};
      const allDcEffects = getDcEffects() || {};
      const alternatives = playableBy.split(/\s+or\s+/i).map(a => a.trim().replace(/^"|"$/g, '').toLowerCase());
      const AFFILIATIONS = new Set(['imperial', 'rebel', 'scum', 'mercenary']);
      options = options.filter(o => {
        const dcBase = String(o.dcName || '')
          .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
          .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
          .trim();
        const dispBase = String(o.displayName || dcBase)
          .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
          .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
          .trim();
        const dcData = allDcEffects[o.dcName] || allDcEffects[dcBase];
        const affiliationLower = (dcData?.affiliation || '').toLowerCase();
        const kw = allKeywords[o.dcName] || allKeywords[dcBase] || [];
        const kwLower = kw.map(k => String(k).toLowerCase());
        for (const alt of alternatives) {
          // "Unique" check
          if (alt === 'unique' || alt === 'any unique figure') {
            if (dcData?.unique) return true;
            continue;
          }
          // "Any Small Figure" check
          if (alt === 'any small figure') {
            if (kwLower.includes('small')) return true;
            continue;
          }
          // Name match
          const dcLow = dcBase.toLowerCase();
          const dispLow = dispBase.toLowerCase();
          if (dcLow.includes(alt) || alt.includes(dcLow) || dispLow.includes(alt) || alt.includes(dispLow))
            return true;
          // Decompose into affiliation + keyword parts
          const words = alt.split(/\s+/);
          let reqAff = null;
          const reqKwWords = [];
          for (const w of words) {
            if (AFFILIATIONS.has(w) && !reqAff) reqAff = w;
            else reqKwWords.push(w);
          }
          const reqKw = reqKwWords.join(' ');
          if (reqAff && affiliationLower !== reqAff && affiliationLower !== 'any') continue;
          if (reqKw && !kwLower.includes(reqKw)) continue;
          if (reqAff || reqKw) return true;
        }
        return false;
      });
    }
    // Remove internal fields before building select menu
    options = options.map(({ label, value }) => ({ label, value }));
    if (options.length === 0) {
      await interaction.followUp({ content: `No eligible Deployment Cards for **${card}** (playable by: ${playableBy}).`, ephemeral: true }).catch(discordCatch);
      return;
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId(`cc_attach_to_${gameId}`)
      .setPlaceholder('Attach to which Deployment Card?')
      .addOptions(options);
    // Build CC card image if available
    const followUpPayload = {
      content: `**${card}** is an Attachment. Choose which Deployment Card to attach it to:`,
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: false,
    };
    if (getCommandCardImagePath) {
      const { existsSync } = await import('fs');
      const { AttachmentBuilder } = await import('discord.js');
      const imgPath = getCommandCardImagePath(card);
      if (imgPath && existsSync(imgPath)) {
        const ext = imgPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        const fileName = `cc-attach-${(card || '').replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
        followUpPayload.files = [new AttachmentBuilder(imgPath, { name: fileName })];
      }
    }
    await interaction.followUp(followUpPayload).catch(discordCatch);
    return;
  }
  const effectData = getCcEffect(card);
  const cost = typeof effectData?.cost === 'number' ? effectData.cost : 0;
  const abilityId = effectData?.abilityId ?? card;

  // For cost > 0 with an ability: try to resolve before moving the card. If we can't apply (timing/context),
  // prompt "We don't think you can do this right now" with [Play anyway] / [Unplay] so the card isn't consumed.
  if (cost !== 0 && ctx.resolveAbility) {
    const result = ctx.resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, dcExhaustedState: ctx.dcExhaustedState, combat: game.combat || game.pendingCombat });
    if (result.requiresChoice && result.choiceOptions?.length > 0) {
      // Choice required: we must commit the play first, then send choice buttons.
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
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch(discordCatch);
      }
      await interaction.message.delete().catch(discordCatch);
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      const effectDesc = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card });
      game.pendingCcChoice = { abilityId, choiceOptions: result.choiceOptions, gameId, playerNum, card, ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}) };
      const rows = [];
      const maxPerRow = 5;
      for (let i = 0; i < result.choiceOptions.length; i++) {
        if (i % maxPerRow === 0) rows.push(new ActionRowBuilder());
        const label = String(result.choiceOptions[i]).slice(0, 80);
        rows[rows.length - 1].addComponents(
          new ButtonBuilder().setCustomId(`cc_choice_${gameId}_${i}`).setLabel(label).setStyle(ButtonStyle.Secondary)
        );
      }
      await handChannel.send({ content: `**Choose one** (for **${card}**):`, components: rows }).catch(discordCatch);
      saveGames();
      return;
    }
    if (result.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
      // Space choice required: commit play, then send space grid + map (reusable pick-a-space pattern).
      const { getBoardStateForMovement, getSpaceChoiceRows, getMapAttachmentForSpaces } = ctx;
      if (!getBoardStateForMovement || !getSpaceChoiceRows || !getMapAttachmentForSpaces) {
        await interaction.followUp({ content: 'Space choice not supported (missing helpers). Resolve manually.', ephemeral: true }).catch(discordCatch);
        return;
      }
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
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch(discordCatch);
      }
      await interaction.message.delete().catch(discordCatch);
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      const effectDesc2 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc2}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card });
      game.pendingCcSpaceChoice = { abilityId, gameId, playerNum, card, validSpaces: result.validSpaces, chosenFigureKey: result.chosenFigureKey ?? null };
      const boardState = getBoardStateForMovement(game, null);
      const mapSpaces = boardState?.mapSpaces || { spaces: result.validSpaces };
      const { rows, available: ccAvail, overflowed: ccOverflowed } = getSpaceChoiceRows(`cc_space_${gameId}_`, result.validSpaces, mapSpaces);
      const mapAttachment = await getMapAttachmentForSpaces(game, result.validSpaces);
      const ccComponents = ccOverflowed
        ? [ctx.buildSpaceSelectMenu('cc_space_sel_', gameId, ccAvail)]
        : rows.slice(0, 5);
      const payload = { content: `**Pick a space** (for **${card}**):`, components: ccComponents, fetchReply: true };
      if (mapAttachment) payload.files = [mapAttachment];
      await handChannel.send(payload).catch(discordCatch);
      saveGames();
      return;
    }
    if (result.applied) {
      // Effect applied: resolveAbility already mutated game (e.g. drew cards); remove played card from current hand and add to discard.
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
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch(discordCatch);
      }
      await interaction.message.delete().catch(discordCatch);
      await updateHandVisualMessage(game, playerNum, interaction.client);
      await updateDiscardPileMessage(game, playerNum, interaction.client);
      const effectDesc3 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc3}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      await applyAbilityResult(result, { game, playerNum, client: interaction.client, ctx });
      if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
        const handChannelId2 = getHandChannelId(game, playerNum);
        if (handChannelId2) {
          game.pendingPowerTokenGrant.channelId = handChannelId2;
          const ptCh = await interaction.client.channels.fetch(handChannelId2).catch(() => null);
          if (ptCh) {
            const { grants } = game.pendingPowerTokenGrant;
            const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
            const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
            const btns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
              new ButtonBuilder().setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
            );
            await ptCh.send({
              content: `**Choose power token type** for **${figNames}** (${totalCount > 1 ? `${totalCount} tokens` : '1 token'}):`,
              components: [new ActionRowBuilder().addComponents(btns)],
            }).catch(discordCatch);
          }
        }
      }
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
      if (result.revealToPlayer) {
        await interaction.followUp({ content: result.revealToPlayer, ephemeral: true }).catch(discordCatch);
      }
      // Behind Enemy Lines reorder: if result has requiresReorder, post card-order picker buttons
      if (result.requiresReorder?.cards?.length > 1) {
        const _belCards = result.requiresReorder.cards;
        const _belDeckKey = result.requiresReorder.deckKey;
        game.pendingBELReorder = { deckKey: _belDeckKey, cards: _belCards, picked: [], playerNum, gameId };
        const _belBtns = _belCards.map((c, i) =>
          new ButtonBuilder()
            .setCustomId(`bel_reorder_1_${gameId}_${i}`)
            .setLabel(`1st: ${c}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        const _belHandId = getHandChannelId(game, playerNum);
        const _belHandCh = await interaction.client.channels.fetch(_belHandId);
        await _belHandCh.send({
          content: `**Behind Enemy Lines** — Choose which card goes **on top** of the opponent's deck:`,
          components: [new ActionRowBuilder().addComponents(..._belBtns.slice(0, 5))],
        }).catch(discordCatch);
      }
      // Windfall: award VP to windfall owner when a cost > 0 card is played (skip when Windfall itself is played)
      if (game.windfallActive && cost > 0 && card !== 'Windfall') {
        const wfNum = game.windfallActive.playerNum;
        const wfKey = vpKeyFn(wfNum);
        game[wfKey] = game[wfKey] || { total: 0, kills: 0, objectives: 0 };
        game[wfKey].total = (game[wfKey].total || 0) + cost;
        await logGameAction(game, interaction.client, `**Windfall**: P${wfNum} gains +${cost} VP.`, { icon: 'card' });
      }
      saveGames();
      return;
    }
    if (!result.applied && result.manualMessage) {
      // Timing/context mismatch: don't move the card; ping in hand with Play anyway / Unplay (same as illegal-CC flow).
      game.pendingIllegalCcPlay = { playerNum, card, reason: result.manualMessage, fromContext: true };
      const handId = getHandChannelId(game, playerNum);
      const handChannel = await client.channels.fetch(handId);
      const msg = await handChannel.send({
        content: `We don't think you can do this right now: ${result.manualMessage}\n\nChoose **Ignore and play** to play it anyway (resolve manually), or **Unplay** to cancel.`,
        components: [getIllegalCcPlayButtons(gameId)],
      });
      game.pendingIllegalCcPlay.messageId = msg.id;
      await interaction.message.delete().catch(discordCatch);
      saveGames();
      return;
    }
  }

  // Cost 0 (negation flow) or no resolveAbility / effect didn't need pre-check: move card first, then resolve/log as before.
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
    }).catch(discordCatch);
  }
  await interaction.message.delete().catch(discordCatch);
  await updateHandVisualMessage(game, playerNum, interaction.client);
  await updateDiscardPileMessage(game, playerNum, interaction.client);
  const effectDesc4 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
  const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc4}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  if (cost === 0 && ctx.getNegationResponseButtons) {
    game.pendingNegation = { playedBy: playerNum, card, fromDc: false, handChannelId: handChannel.id };
    const oppNum = opponentPlayerNum(playerNum);
    const oppHandId = getHandChannelId(game, oppNum);
    const oppHandChannel = await interaction.client.channels.fetch(oppHandId).catch(() => null);
    if (oppHandChannel) {
      const oppId = getPlayerId(game, oppNum);
      await oppHandChannel.send({
        content: `Your opponent played **${card}** (cost 0). You may play **Negation** to cancel it.`,
        components: [ctx.getNegationResponseButtons(gameId)],
        allowedMentions: { users: [oppId] },
      }).catch(discordCatch);
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
    const result = ctx.resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, dcExhaustedState: ctx.dcExhaustedState, combat: game.combat || game.pendingCombat });
    await applyAbilityResult(result, { game, playerNum, client: interaction.client, ctx });
    if (result.revealToPlayer) {
      await interaction.followUp({ content: result.revealToPlayer, ephemeral: true }).catch(discordCatch);
    }
  }
  // Windfall: award VP to windfall owner when a cost > 0 card is played (skip when Windfall itself is played)
  if (game.windfallActive && cost > 0 && card !== 'Windfall') {
    const wfNum = game.windfallActive.playerNum;
    const wfKey = vpKeyFn(wfNum);
    game[wfKey] = game[wfKey] || { total: 0, kills: 0, objectives: 0 };
    game[wfKey].total = (game[wfKey].total || 0) + cost;
    await logGameAction(game, interaction.client, `**Windfall**: P${wfNum} gains +${cost} VP.`, { icon: 'card' });
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  // 5H: Verify the interacting user owns this pending confirmation
  if (game.pendingCcConfirmation?.playerNum) {
    if (!await requirePlayer(interaction, game, interaction.user.id, game.pendingCcConfirmation.playerNum, canActAsPlayer, 'Not your card to cancel.')) return;
  }
  delete game.pendingCcConfirmation;
  await interaction.message.delete().catch(discordCatch);
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
  const handKey = ccHandKey(playerNum);
  const discardKey = ccDiscardKey(playerNum);
  const hand = (game[handKey] || []).slice();
  const idx = hand.indexOf(card);
  if (idx >= 0) hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await client.channels.fetch(handId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = getCcDeck(game, playerNum) || [];
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
    }).catch(discordCatch);
  }
  await updateHandVisualMessage(game, playerNum, client);
  await updateDiscardPileMessage(game, playerNum, client);
  const effectDesc = effectData?.effect ? `\n> *${effectData.effect}*` : '';
  await logGameAction(game, client, `Played command card **${card}**.${effectDesc}`, { phase: 'ACTION', icon: 'card' });
  if (resolveAbility) {
    const abilityId = effectData?.abilityId ?? card;
    const result = resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat });
    await applyAbilityResult(result, { game, playerNum, client, ctx });
  }
}

/** @param {import('discord.js').ButtonInteraction} interaction — space button for pick-a-space CC (e.g. Smoke Grenade, placement). */
export async function handleCcSpacePick(interaction, ctx) {
  const match = interaction.customId.match(/^cc_space_([^_]+)_(.+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid space choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, space] = match;
  const chosenSpace = String(space).toLowerCase();
  const { getGame, resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, updateHandVisualMessage, updateDiscardPileMessage, updateDcActionsMessage, buildBoardMapPayload, client, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingCcSpaceChoice;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending space choice for this game.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = pending.playerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the player who played the card can choose.')) return;
  const validLower = (pending.validSpaces || []).map((s) => String(s).toLowerCase());
  if (!validLower.includes(chosenSpace)) {
    await interaction.followUp({ content: 'That space is not a valid choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const result = resolveAbility(pending.abilityId, {
    game,
    playerNum,
    dcMessageMeta,
    dcHealthState,
    dcExhaustedState,
    chosenSpace,
    chosenFigureKey: pending.chosenFigureKey ?? null,
    combat: game.combat || game.pendingCombat,
  });
  delete game.pendingCcSpaceChoice;
  await applyAbilityResult(result, { game, playerNum, client, ctx });
  try {
    await interaction.message.edit({ content: 'Space chosen.', components: [] }).catch(discordCatch);
  } catch {}
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — choice button for choose-one CC (e.g. Retaliation). */
export async function handleCcChoice(interaction, ctx) {
  const match = interaction.customId.match(/^cc_choice_(.+)_(\d+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, choiceIndexStr] = match;
  const choiceIndex = parseInt(choiceIndexStr, 10);
  const { getGame, resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, updateHandVisualMessage, updateDiscardPileMessage, updateDcActionsMessage, buildDcEmbedAndFiles, getConditionsForDcMessage, getDcPlayAreaComponents, getBoardStateForMovement, getSpaceChoiceRows, getMapAttachmentForSpaces, client, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingCcChoice;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending choice for this game.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = pending.playerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the player who played the card can choose.')) return;
  if (choiceIndex < 0 || choiceIndex >= (pending.choiceOptions?.length ?? 0)) {
    await interaction.followUp({ content: 'Invalid option.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const chosenOption = pending.choiceOptions?.[choiceIndex];
  const result = resolveAbility(pending.abilityId, {
    game,
    playerNum,
    dcMessageMeta,
    dcHealthState,
    dcExhaustedState,
    choiceIndex,
    chosenOption,
    chosenFigureKey: pending.choiceValues?.[choiceIndex] ?? null,
    combat: game.combat || game.pendingCombat,
  });
  delete game.pendingCcChoice;
  const aarResult = await applyAbilityResult(result, { game, playerNum, client, ctx });
  if (!aarResult.handled && aarResult.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
    if (!getBoardStateForMovement || !getSpaceChoiceRows || !getMapAttachmentForSpaces) {
      await logGameAction(game, client, 'CC effect: Space choice not supported. Resolve manually.', { phase: 'ACTION', icon: 'card' });
      saveGames();
      return;
    }
    game.pendingCcSpaceChoice = {
      abilityId: pending.abilityId,
      gameId,
      playerNum,
      card: pending.card,
      validSpaces: result.validSpaces,
      chosenFigureKey: result.chosenFigureKey ?? pending.choiceValues?.[choiceIndex] ?? null,
    };
    const handChannelId = getHandChannelId(game, playerNum);
    const handCh = await client.channels.fetch(handChannelId).catch(() => null);
    if (handCh) {
      const boardState2 = getBoardStateForMovement(game, null);
      const mapSpaces2 = boardState2?.mapSpaces || { spaces: result.validSpaces };
      const { rows: spaceRows, available: ccAvail2, overflowed: ccOverflowed2 } = getSpaceChoiceRows(`cc_space_${gameId}_`, result.validSpaces, mapSpaces2);
      const mapAttachment2 = await getMapAttachmentForSpaces(game, result.validSpaces);
      const ccComponents2 = ccOverflowed2
        ? [ctx.buildSpaceSelectMenu('cc_space_sel_', gameId, ccAvail2)]
        : spaceRows.slice(0, 5);
      const payload2 = { content: `**Pick a space** (for **${pending.card ?? pending.abilityId}**):`, components: ccComponents2 };
      if (mapAttachment2) payload2.files = [mapAttachment2];
      await handCh.send(payload2).catch(discordCatch);
    }
    try {
      await interaction.message.edit({ content: 'Figure chosen. Now pick a space.', components: [] }).catch(discordCatch);
    } catch {}
    saveGames();
    return;
  }
  try {
    await interaction.message.edit({ content: 'Choice resolved.', components: [] }).catch(discordCatch);
  } catch {}
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Ignore and play" for pending illegal CC. */
export async function handleIllegalCcIgnore(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('illegal_cc_ignore_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingIllegalCcPlay) {
    await interaction.followUp({ content: 'No pending play to resolve.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, card, messageId } = game.pendingIllegalCcPlay;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the player who played the card can choose.')) return;
  await resolveCcPlay(game, playerNum, card, ctx);
  delete game.pendingIllegalCcPlay;
  if (messageId && interaction.channel?.id) {
    try {
      const msg = await interaction.channel.messages.fetch(messageId);
      await msg.edit({ content: 'Play resolved.', components: [] }).catch(discordCatch);
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
    await interaction.followUp({ content: 'No pending play to negate.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playedBy, card, waitingMsgId, handChannelId } = game.pendingNegation;
  const oppNum = opponentPlayerNum(playedBy);
  if (!await requirePlayer(interaction, game, interaction.user.id, oppNum, canActAsPlayer, 'Only the opponent can play Negation.')) return;
  const handKey = ccHandKey(oppNum);
  const discardKey = ccDiscardKey(oppNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf('Negation');
  if (idx < 0) {
    await interaction.followUp({ content: "You don't have Negation in your hand.", ephemeral: true }).catch(discordCatch);
    return;
  }
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Negation');
  delete game.pendingNegation;
  await updateHandVisualMessage(game, oppNum, client);
  await updateDiscardPileMessage(game, oppNum, client);
  await interaction.message.edit({ content: `**Negation** cancelled **${card}**.`, components: [] }).catch(discordCatch);
  const negPlayerId = getPlayerId(game, oppNum);
  await logGameAction(game, client, `<@${negPlayerId}> played **Negation** — cancelled **${card}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [negPlayerId] } });
  // Notify the player whose card was cancelled
  if (waitingMsgId && handChannelId) {
    const playingHandChannel = await client.channels.fetch(handChannelId).catch(() => null);
    if (playingHandChannel) {
      const waitingMsg = await playingHandChannel.messages.fetch(waitingMsgId).catch(() => null);
      const playedById = getPlayerId(game, playedBy);
      if (waitingMsg) await waitingMsg.edit({ content: `❌ Your **${card}** was cancelled by your opponent's **Negation**. <@${playedById}>` }).catch(discordCatch);
    }
  }
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Let it resolve" for pending cost-0 CC. */
export async function handleNegationLetResolve(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames, resolveAbility, dcMessageMeta, dcHealthState, updateDcActionsMessage, updateAttachmentMessageForDc, isCcAttachment, ensureMovementBankMessage, updateMovementBankMessage } = ctx;
  const gameId = interaction.customId.replace('negation_let_resolve_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingNegation) {
    await interaction.followUp({ content: 'No pending play to resolve.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playedBy, card, fromDc, msgId, wasAttachment, waitingMsgId, handChannelId } = game.pendingNegation;
  const oppNum = opponentPlayerNum(playedBy);
  if (!await requirePlayer(interaction, game, interaction.user.id, oppNum, canActAsPlayer, 'Only the opponent can choose to let it resolve.')) return;
  delete game.pendingNegation;
  await interaction.message.edit({ content: `**${card}** resolves.`, components: [] }).catch(discordCatch);
  if (fromDc && msgId && wasAttachment && updateAttachmentMessageForDc && isCcAttachment?.(card)) {
    const attachKey = ccAttachmentsKey(playedBy);
    const discardKey = ccDiscardKey(playedBy);
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
    await applyAbilityResult(result, { game, playerNum: playedBy, msgId: fromDc ? msgId : undefined, client, ctx });
  }
  // Notify the player whose card resolved
  if (waitingMsgId && handChannelId) {
    const playingHandChannel = await client.channels.fetch(handChannelId).catch(() => null);
    if (playingHandChannel) {
      const waitingMsg = await playingHandChannel.messages.fetch(waitingMsgId).catch(() => null);
      const playedById = getPlayerId(game, playedBy);
      if (waitingMsg) await waitingMsg.edit({ content: `✅ **${card}** resolved! <@${playedById}>` }).catch(discordCatch);
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
    await interaction.followUp({ content: 'No Celebration window open.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { attackerPlayerNum } = game.pendingCelebration;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the player who defeated the figure can play Celebration.')) return;
  const handKey = ccHandKey(attackerPlayerNum);
  const discardKey = ccDiscardKey(attackerPlayerNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf('Celebration');
  if (idx < 0) {
    await interaction.followUp({ content: "You don't have Celebration in your hand.", ephemeral: true }).catch(discordCatch);
    return;
  }
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Celebration');
  awardObjectiveVp(game, attackerPlayerNum, 4);
  delete game.pendingCelebration;
  await updateHandVisualMessage(game, attackerPlayerNum, client);
  await updateDiscardPileMessage(game, attackerPlayerNum, client);
  await interaction.message.edit({ content: `**Celebration** — +4 VP.`, components: [] }).catch(discordCatch);
  const celPlayerId = getPlayerId(game, attackerPlayerNum);
  await logGameAction(game, client, `<@${celPlayerId}> played **Celebration** — gained 4 VP.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [celPlayerId] } });
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Pass" on Celebration. */
export async function handleCelebrationPass(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('celebration_pass_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingCelebration) {
    await interaction.followUp({ content: 'No Celebration window open.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { attackerPlayerNum } = game.pendingCelebration;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the player who defeated the figure can pass.')) return;
  delete game.pendingCelebration;
  await interaction.message.edit({ content: 'Passed on Celebration.', components: [] }).catch(discordCatch);
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Unplay card" for pending illegal CC. */
export async function handleIllegalCcUnplay(interaction, ctx) {
  const { getGame, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('illegal_cc_unplay_', '');
  const game = getGame(gameId);
  if (!game || !game.pendingIllegalCcPlay) {
    await interaction.followUp({ content: 'No pending play to cancel.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, messageId } = game.pendingIllegalCcPlay;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the player who played the card can choose.')) return;
  delete game.pendingIllegalCcPlay;
  if (messageId && interaction.channel?.id) {
    try {
      const msg = await interaction.channel.messages.fetch(messageId);
      await msg.edit({ content: 'Cancelled — card not played.', components: [] }).catch(discordCatch);
    } catch {}
  }
  saveGames();
}

/** @param {import('discord.js').StringSelectMenuInteraction} interaction */
export async function handleCcDiscardSelect(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames } = ctx;
  const gameId = interaction.customId.replace('cc_discard_select_', '');
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && channelId !== game.p2HandId) {
    await interaction.reply({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const handKey = ccHandKey(playerNum);
  const discardKey = ccDiscardKey(playerNum);
  const hand = game[handKey] || [];
  const card = interaction.values[0];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    await interaction.reply({ content: "That card isn't in your hand.", ephemeral: true }).catch(discordCatch);
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
    }).catch(discordCatch);
  }
  await interaction.message.delete().catch(discordCatch);
  await updateHandVisualMessage(game, playerNum, interaction.client);
  await updateDiscardPileMessage(game, playerNum, interaction.client);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> discarded **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleSquadConfirm(interaction, ctx) {
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS, applySquadSubmission } = ctx;
  const parts = interaction.customId.replace('squad_confirm_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const isP1 = playerNum === 1;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can confirm.')) return;
  const key = `${gameId}_${playerNum}`;
  const pending = pendingSquadConfirm.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    pendingSquadConfirm.delete(key);
    await interaction.followUp({ content: 'This squad confirmation has expired. Please submit your squad again.', ephemeral: true }).catch(discordCatch);
    return;
  }
  pendingSquadConfirm.delete(key);
  await applySquadSubmission(game, isP1, pending.squad, interaction.client);
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);
  await interaction.followUp({ content: `Squad **${pending.squad.name || 'Unnamed'}** confirmed.`, ephemeral: true }).catch(discordCatch);
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleSquadCancel(interaction, ctx) {
  const { getGame, pendingSquadConfirm } = ctx;
  const parts = interaction.customId.replace('squad_cancel_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can cancel.')) return;
  const key = `${gameId}_${playerNum}`;
  pendingSquadConfirm.delete(key);
  await interaction.message.edit({ content: 'Squad submission cancelled. Paste your list or upload a .vsav file to try again.', components: [] }).catch(discordCatch);
  await interaction.followUp({ content: 'Cancelled. Paste or upload again to resubmit.', ephemeral: true }).catch(discordCatch);
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleDeckIllegalPlay(interaction, ctx) {
  const { getGame, pendingIllegalSquad, PENDING_ILLEGAL_TTL_MS, applySquadSubmission } = ctx;
  const parts = interaction.customId.replace('deck_illegal_play_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const isP1 = playerNum === 1;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can choose Play It Anyway.')) return;
  const key = `${gameId}_${playerNum}`;
  const pending = pendingIllegalSquad.get(key);
  if (!pending || (Date.now() - pending.timestamp > PENDING_ILLEGAL_TTL_MS)) {
    pendingIllegalSquad.delete(key);
    await interaction.followUp({ content: 'This deck choice has expired. Please submit your squad again.', ephemeral: true }).catch(discordCatch);
    return;
  }
  pendingIllegalSquad.delete(key);
  await applySquadSubmission(game, isP1, pending.squad, interaction.client);
  await interaction.followUp({ content: `Squad **${pending.squad.name || 'Unnamed'}** accepted (Play It Anyway).`, ephemeral: true }).catch(discordCatch);
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleDeckIllegalRedo(interaction, ctx) {
  const { getGame, pendingIllegalSquad, getHandTooltipEmbed, saveGames } = ctx;
  const parts = interaction.customId.replace('deck_illegal_redo_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const isP1 = playerNum === 1;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this hand can choose Redo.')) return;
  const key = `${gameId}_${playerNum}`;
  pendingIllegalSquad.delete(key);
  if (isP1) game.player1Squad = null;
  else game.player2Squad = null;
  if (game.bothReadyPosted) game.bothReadyPosted = false;
  const handChannelId = isP1 ? game.p1HandId : game.p2HandId;
  const handChannel = await interaction.client.channels.fetch(handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 15 });
  const botMsg = handMessages.find((m) => m.author.bot && m.embeds?.some((e) => e.title?.includes('Your Hand')));
  if (botMsg) {
    await botMsg.edit({
      embeds: [getHandTooltipEmbed(game, playerNum)],
      components: [],
    }).catch(discordCatch);
  }
  saveGames();
  await interaction.message.edit({ content: 'Squad cleared. Paste your list or upload a .vsav file below to resubmit.', components: [] }).catch(discordCatch);
  await interaction.followUp({ content: 'Your squad has been cleared. Paste your army list or upload a .vsav file in this thread to resubmit.', ephemeral: true }).catch(discordCatch);
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcShuffleDraw(interaction, ctx) {
  const { getGame, shuffleArray, buildHandDisplayPayload, updateHandVisualMessage, updatePlayAreaDcButtons, sendRoundActivationPhaseMessage, runStartOfRoundDcEffects, logGameAction, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('cc_shuffle_draw_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.followUp({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const squad = getSquad(game, playerNum);
  const ccList = squad?.ccList || [];
  const drawnKey = ccDrawnKey(playerNum);
  if (game[drawnKey]) {
    await interaction.followUp({ content: "You've already drawn your starting hand.", ephemeral: true }).catch(discordCatch);
    return;
  }
  // I Know Everything (Moff Gideon): before drawing, opponent searches this player's deck
  const oppNum = opponentPlayerNum(playerNum);
  const oppDcList = oppNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const oppHasGideon = oppDcList.some(d => (d?.dcName || d) === 'Moff Gideon');
  if (oppHasGideon && !game.iKnowEverythingResolved) {
    const attachKey2 = ccAttachmentsKey(playerNum);
    const placed2 = (attachKey2 && game[attachKey2] && Object.values(game[attachKey2]).flat()) || [];
    const availableCards = ccList.filter(c => !placed2.includes(c));
    if (availableCards.length >= 2) {
      // Pick 2 random cards to reveal
      const shuffledCopy = [...availableCards];
      shuffleArray(shuffledCopy);
      const revealed = [shuffledCopy[0], shuffledCopy[1]];
      game.pendingIKnowEverything = { targetPlayerNum: playerNum, gideonPlayerNum: oppNum, cards: revealed, gameId };
      const oppPlayerId = getPlayerId(game, oppNum);
      const cardLabels = revealed.map((c, i) => `**${i + 1}.** ${c}`).join('\n');
      const keepRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ike_keep_${gameId}_0`).setLabel(`Keep: ${revealed[0].slice(0, 70)}`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ike_keep_${gameId}_1`).setLabel(`Keep: ${revealed[1].slice(0, 70)}`).setStyle(ButtonStyle.Primary),
      );
      await logGameAction(game, client, `🕵️ **I Know Everything** — **Moff Gideon** reveals 2 cards from <@${getPlayerId(game, playerNum)}>'s Command deck:\n${cardLabels}\n\n<@${getPlayerId(game, playerNum)}> — Choose which card to **keep** (the other is removed from the game):`, { components: [keepRow], allowedMentions: { users: [getPlayerId(game, playerNum)] } });
      saveGames();
      return;
    }
    // Not enough cards, skip I Know Everything
    game.iKnowEverythingResolved = true;
  }

  const attachKey = ccAttachmentsKey(playerNum);
  const placed = (game[attachKey] && Object.values(game[attachKey]).flat()) || [];
  const deck = ccList.filter((c) => !placed.includes(c));
  shuffleArray(deck);
  let hand = deck.splice(0, 3);
  const deckKey = ccDeckKey(playerNum);
  const handKey = ccHandKey(playerNum);
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
  const playerId = getPlayerId(game, playerNum);
  await logGameAction(game, client, `<@${playerId}> shuffled and drew 3 Command Cards.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });
  const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
  await interaction.message.edit({
    content: handPayload.content,
    embeds: handPayload.embeds,
    files: handPayload.files || [],
    components: handPayload.components,
  }).catch(discordCatch);
  await updateHandVisualMessage(game, playerNum, client);
  if (game.player1CcDrawn && game.player2CcDrawn) {
    await updatePlayAreaDcButtons(game, client);
    if (runStartOfRoundDcEffects) await runStartOfRoundDcEffects(game, gameId, client, { logGameAction });
    await sendRoundActivationPhaseMessage(game, client);
  }
  saveGames();
}

/**
 * Handle I Know Everything choice (ike_keep_ button).
 * The targeted player picks which card to keep; the other is removed from the game.
 * Then triggers the shuffle/draw for that player.
 */
export async function handleIKnowEverythingKeep(interaction, ctx) {
  const { getGame, shuffleArray, buildHandDisplayPayload, updateHandVisualMessage, updatePlayAreaDcButtons, sendRoundActivationPhaseMessage, runStartOfRoundDcEffects, logGameAction, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(() => {});
  const match = interaction.customId.match(/^ike_keep_(.+)_(\d)$/);
  if (!match) return;
  const [, gameId, keepIdxStr] = match;
  const keepIdx = parseInt(keepIdxStr, 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game || !game.pendingIKnowEverything) {
    await interaction.followUp({ content: 'No pending I Know Everything choice.', ephemeral: true }).catch(() => {}); return;
  }
  const pending = game.pendingIKnowEverything;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.targetPlayerNum, canActAsPlayer, 'Only the targeted player can choose.')) return;

  const keptCard = pending.cards[keepIdx];
  const removedCard = pending.cards[1 - keepIdx];
  const playerNum = pending.targetPlayerNum;

  // Remove the unchosen card from the squad's CC list
  const squad = getSquad(game, playerNum);
  if (squad?.ccList) {
    const rmIdx = squad.ccList.indexOf(removedCard);
    if (rmIdx >= 0) squad.ccList.splice(rmIdx, 1);
  }

  delete game.pendingIKnowEverything;
  game.iKnowEverythingResolved = true;

  await logGameAction(game, client, `🕵️ **I Know Everything** — Kept **${keptCard}**. **${removedCard}** removed from the game.`, { phase: 'DEPLOYMENT', icon: 'card' });
  try { await interaction.message.edit({ components: [] }); } catch {}

  // Now perform the shuffle and draw for the targeted player
  const ccList = squad?.ccList || [];
  const attachKey = ccAttachmentsKey(playerNum);
  const placed = (game[attachKey] && Object.values(game[attachKey]).flat()) || [];
  const deck = ccList.filter(c => !placed.includes(c));
  shuffleArray(deck);
  let hand = deck.splice(0, 3);
  const deckKey = ccDeckKey(playerNum);
  const handKey = ccHandKey(playerNum);
  game[deckKey] = deck;
  game[handKey] = hand;
  const drawnKey = ccDrawnKey(playerNum);
  game[drawnKey] = true;
  const playerId = getPlayerId(game, playerNum);
  await logGameAction(game, client, `<@${playerId}> shuffled and drew 3 Command Cards.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });

  // Update hand display in the player's hand thread
  const handChannelId = getHandChannelId(game, playerNum);
  if (handChannelId) {
    try {
      const handChannel = await client.channels.fetch(handChannelId);
      const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
      await handChannel.send(handPayload);
    } catch {}
  }
  await updateHandVisualMessage(game, playerNum, client);
  if (game.player1CcDrawn && game.player2CcDrawn) {
    await updatePlayAreaDcButtons(game, client);
    if (runStartOfRoundDcEffects) await runStartOfRoundDcEffects(game, gameId, client, { logGameAction });
    await sendRoundActivationPhaseMessage(game, client);
  }
  saveGames();
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcPlay(interaction, ctx) {
  const { getGame, getPlayableCcFromHand } = ctx;
  const gameId = interaction.customId.replace('cc_play_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.followUp({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  if (hand.length === 0) {
    await interaction.followUp({ content: 'No cards in hand to play.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playable = getPlayableCcFromHand(game, playerNum, hand);
  if (playable.length === 0) {
    await interaction.followUp({
      content: "No command cards can be played right now (wrong timing). Play cards during your activation, at start/end of round, or during an attack as appropriate.",
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cc_play_select_${gameId}`)
    .setPlaceholder('Choose a card to play')
    .addOptions(playable.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
  await interaction.followUp({
    content: '**Play CC** — Select a card:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: false,
  });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcDraw(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, logGameAction, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('cc_draw_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.followUp({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const deckKey = ccDeckKey(playerNum);
  const handKey = ccHandKey(playerNum);
  let deck = (game[deckKey] || []).slice();
  const hand = (game[handKey] || []).slice();
  if (deck.length === 0) {
    await interaction.followUp({ content: 'No cards in deck to draw.', ephemeral: true }).catch(discordCatch);
    return;
  }
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
  }).catch(discordCatch);
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Area = channelId === game.p1PlayAreaId;
  const isP2Area = channelId === game.p2PlayAreaId;
  if ((!isP1Area && !isP2Area) || (isP1Area && playerNum !== 1) || (isP2Area && playerNum !== 2)) {
    await interaction.followUp({ content: 'Use this in your Play Area.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner of this Play Area can search their discard pile.')) return;
  const existingThreadId = getDiscardThreadId(game, playerNum);
  if (existingThreadId) {
    try {
      const existing = await client.channels.fetch(existingThreadId);
      if (existing) {
        await interaction.followUp({ content: 'Discard pile thread is already open. Close it first.', ephemeral: true }).catch(discordCatch);
        return;
      }
    } catch { /* thread was deleted */ }
    if (playerNum === 1) delete game.p1DiscardThreadId;
    else delete game.p2DiscardThreadId;
  }
  const discard = getCcDiscard(game, playerNum) || [];
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
      embeds: [new EmbedBuilder().setTitle('Command Cards in Discard Pile').setDescription('*Empty*').setColor(COLORS.DARK_EMBED)],
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const threadId = getDiscardThreadId(game, playerNum);
  if (!threadId) {
    await interaction.followUp({ content: 'No discard pile thread is open.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the owner can close the discard pile thread.')) return;
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.followUp({ content: 'Use this in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = isP1Hand ? 1 : 2;
  const hand = playerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  if (hand.length === 0) {
    await interaction.followUp({ content: 'No cards in hand to discard.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cc_discard_select_${gameId}`)
    .setPlaceholder('Choose a card to discard')
    .addOptions(hand.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
  await interaction.followUp({
    content: '**Discard CC** — Select a card to discard:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: false,
  });
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleSquadSelect(interaction, ctx) {
  const { getGame } = ctx;
  const [, , gameId, playerNum] = interaction.customId.split('_');
  const game = await requireGame(interaction, getGame, gameId, { useReply: true });
  if (!game) return;
  if (!game.mapSelected) {
    await interaction.followUp({ content: 'Map selection must be completed before you can select your squad.', ephemeral: true });
    return;
  }
  const isP1 = playerNum === '1';
  const pn = isP1 ? 1 : 2;
  if (!await requirePlayer(interaction, game, interaction.user.id, pn, canActAsPlayer, 'Only the owner of this hand can select a squad.')) return;
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
