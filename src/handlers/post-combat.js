/**
 * Post-combat resolution handlers:
 *   bleed_accept_ / bleed_prevent_
 *   reaction_skip_
 *   reaction_use_
 *   right_back_block_ / right_back_nodmg_
 *   mastery_pick_ / mastery_skip_
 *   interrogate_pick_ / interrogate_discard_ / interrogate_skip_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getMapSpaces, getCcEffect } from '../data-loader.js';
import { ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

/**
 * bleed_accept_ / bleed_prevent_ — delegates to the existing handleBleedResolve
 * that lives in index.js (not yet extracted). For now this is a passthrough;
 * the caller in index.js already invokes handleBleedResolve(interaction) directly.
 */
export async function handleBleedResolve(interaction, ctx) {
  // The bleed handler is a standalone function in index.js with many deps.
  // The call-site in index.js already calls that function directly, so this
  // export exists only as a placeholder for future extraction.
  if (ctx && ctx.handleBleedResolveImpl) {
    await ctx.handleBleedResolveImpl(interaction);
  }
}

/**
 * reaction_skip_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution
 */
export async function handleReactionSkip(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution } = ctx;
  const gameId = interaction.customId.replace('reaction_skip_', '');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingReaction) { await interaction.followUp({ content: 'No pending reaction.', ephemeral: true }).catch(discordCatch); return; }
  const { ownerId, cardName } = game.pendingReaction;
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can skip.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(() => {});
  const pending = game.pendingReaction;
  delete game.pendingReaction;
  await interaction.message.edit({ components: [] }).catch(() => {});
  // Restore the card to hand (it was tentatively removed when prompting)
  const handKey = ccHandKey(pending.defenderPlayerNum);
  game[handKey] = game[handKey] || [];
  game[handKey].push(cardName);
  // Continue checking for more reactions or finish
  const cThread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (cThread) {
    const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), cThread, ownerId, pending.defenderPlayerNum);
    if (triggered) { saveGames(); return; }
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), client);
  saveGames();
  return;
}

/**
 * reaction_use_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, findDcMessageIdForFigure, applyDirectDamageToFigure
 */
export async function handleReactionUse(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, findDcMessageIdForFigure, applyDirectDamageToFigure } = ctx;
  const gameId = interaction.customId.replace('reaction_use_', '');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingReaction) { await interaction.followUp({ content: 'No pending reaction.', ephemeral: true }).catch(discordCatch); return; }
  const { ownerId, cardName, targetFigKey, attackerFigKey, attackerMsgId, defenderPlayerNum } = game.pendingReaction;
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can use this.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.edit({ components: [] }).catch(() => {});
  const pending = game.pendingReaction;
  delete game.pendingReaction;
  // Card was already removed from hand when prompting; discard it (add to discard pile)
  const discardKey = ccDiscardKey(defenderPlayerNum);
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(cardName);
  const combat = pending.combat;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);

  if (cardName === 'Payback') {
    // Payback: Dengar counter-attacks the attacker with +2 Surge bonus
    // Set a pending bonus surge for Dengar's next attack (keyed by Dengar's DC msgId)
    const dengarMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, targetFigKey);
    if (dengarMsgId) {
      game.paybackBonusSurge = game.paybackBonusSurge || {};
      game.paybackBonusSurge[dengarMsgId] = (game.paybackBonusSurge[dengarMsgId] || 0) + 2;
    }
    const attackerName = dcNameFromFigureKey(attackerFigKey);
    if (thread) await thread.send(`**Payback** — Dengar may now counter-attack **${attackerName}**. Use the Attack button on Dengar's DC card. **+2 Surge** will be applied automatically to that attack.`).catch(discordCatch);
  } else if (cardName === 'Dangerous Prey') {
    // Dangerous Prey: attacker suffers 1 Damage (3 if adjacent to Bossk)
    const attackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigKey];
    const bosskPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigKey];
    const ms = getMapSpaces(game.selectedMap?.id);
    const adjSet = new Set((ms?.adjacency?.[String(bosskPos).toLowerCase()] || []).map((s) => String(s).toLowerCase()));
    const isAdj = attackerPos && bosskPos && adjSet.has(String(attackerPos).toLowerCase());
    const dmg = isAdj ? 3 : 1;
    const atkMsgId = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
    const attackerName = dcNameFromFigureKey(attackerFigKey);
    if (thread) await thread.send(`**Dangerous Prey** — ${attackerName} suffers **${dmg} Damage**${isAdj ? ' (adjacent to Bossk)' : ''}. Bossk gains **2 MP**.`).catch(discordCatch);
    await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId, dmg, client, null, 'Dangerous Prey');
    // Add 2 MP to Bossk's movement bank
    const bosskMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, targetFigKey);
    if (bosskMsgId) {
      game.movementBank = game.movementBank || {};
      game.movementBank[bosskMsgId] = game.movementBank[bosskMsgId] || { remaining: 0, total: 0 };
      game.movementBank[bosskMsgId].remaining += 2;
      game.movementBank[bosskMsgId].total += 2;
    }
  } else if (cardName === "Right Back At Ya!") {
    // Right Back At Ya!: attacker suffers 1 Damage (3 if Boba spends Block Token)
    const bobaTokens = game.figurePowerTokens?.[targetFigKey] || [];
    const hasBlock = bobaTokens.includes('Block');
    if (hasBlock) {
      // Prompt for block token choice
      game.pendingRightBackAtYa = {
        gameId: game.gameId,
        combatThreadId: pending.combatThreadId,
        attackerPlayerNum,
        defenderPlayerNum,
        ownerId,
        attackerFigKey,
        attackerMsgId: attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey),
        bobaFigKey: targetFigKey,
        resultText: pending.resultText,
        combat: pending.combat,
        initialEmbedRefreshMsgIds: pending.initialEmbedRefreshMsgIds,
      };
      const btn3 = new ButtonBuilder().setCustomId(`right_back_block_${gameId}`).setLabel('Spend Block Token — 3 Damage').setStyle(ButtonStyle.Danger);
      const btn1 = new ButtonBuilder().setCustomId(`right_back_nodmg_${gameId}`).setLabel('1 Damage (no token)').setStyle(ButtonStyle.Secondary);
      if (thread) await thread.send({
        content: `<@${ownerId}> **Right Back At Ya!** — Spend your Block Token for 3 Damage, or deal 1 Damage without spending it:`,
        allowedMentions: { users: [ownerId] },
        components: [new ActionRowBuilder().addComponents(btn3, btn1)],
      }).catch(discordCatch);
      saveGames();
      return;
    }
    // No block token — just 1 damage
    const atkMsgId2 = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
    await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId2, 1, client, thread, 'Right Back At Ya!');
  }

  // Check for more reactions or finish
  if (thread) {
    const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum);
    if (triggered) { saveGames(); return; }
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), client);
  saveGames();
  return;
}

/**
 * right_back_block_ / right_back_nodmg_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, findDcMessageIdForFigure, applyDirectDamageToFigure
 */
export async function handleRightBack(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, findDcMessageIdForFigure, applyDirectDamageToFigure } = ctx;
  const buttonKey = interaction.customId.startsWith('right_back_block_') ? 'right_back_block_' : 'right_back_nodmg_';
  const isBlockVariant = buttonKey === 'right_back_block_';
  const gameId = interaction.customId.replace(buttonKey, '');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingRightBackAtYa) { await interaction.followUp({ content: 'No pending Right Back At Ya! choice.', ephemeral: true }).catch(discordCatch); return; }
  const { ownerId, attackerPlayerNum, defenderPlayerNum, attackerFigKey, attackerMsgId, bobaFigKey } = game.pendingRightBackAtYa;
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can choose.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.edit({ components: [] }).catch(() => {});
  const rbPending = game.pendingRightBackAtYa;
  delete game.pendingRightBackAtYa;
  const thread = await client.channels.fetch(rbPending.combatThreadId).catch(() => null);
  let dmg = 1;
  if (isBlockVariant) {
    // Spend Block token
    const bobaTokens = game.figurePowerTokens?.[bobaFigKey] || [];
    const blockIdx = bobaTokens.indexOf('Block');
    if (blockIdx >= 0) bobaTokens.splice(blockIdx, 1);
    if (!game.figurePowerTokens) game.figurePowerTokens = {};
    game.figurePowerTokens[bobaFigKey] = bobaTokens;
    dmg = 3;
  }
  const atkMsgId = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
  await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId, dmg, client, thread, 'Right Back At Ya!');
  // Continue checking for more reactions or finish
  if (thread) {
    const triggered = await checkPostCombatSurges(game, rbPending.combat, rbPending.resultText, new Set(rbPending.initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum);
    if (triggered) { saveGames(); return; }
  }
  await finishCombatResolution(game, rbPending.combat, rbPending.resultText, new Set(rbPending.initialEmbedRefreshMsgIds), client);
  saveGames();
  return;
}

/**
 * mastery_pick_ / mastery_skip_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, updateHandChannelMessages
 */
export async function handleMasteryPick(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, updateHandChannelMessages } = ctx;
  const buttonKey = interaction.customId.startsWith('mastery_skip_') ? 'mastery_skip_' : 'mastery_pick_';
  const isMasterySkip = buttonKey === 'mastery_skip_';
  const mastGameId = isMasterySkip ? interaction.customId.replace('mastery_skip_', '') : interaction.customId.match(/^mastery_pick_([^_]+)_\d+$/)?.[1];
  if (!mastGameId) { await interaction.followUp({ content: 'Invalid mastery interaction.', ephemeral: true }).catch(() => {}); return; }
  const mastGame = await requireGame(interaction, getGame, mastGameId, { silent: true });
  if (!mastGame) return;
  if (!mastGame.pendingMastery) { await interaction.followUp({ content: 'No pending Mastery choice.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum: mastAPN, discardKey: mastDK, eligible: mastEl, resultText: mastRT, combat: mastCombat, initialEmbedRefreshMsgIds: mastEmbed, defenderPlayerNum: mastDPN } = mastGame.pendingMastery;
  const mastOwnerId = mastAPN === 1 ? mastGame.player1Id : mastGame.player2Id;
  if (interaction.user.id !== mastOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Mastery.', ephemeral: true }).catch(() => {}); return; }
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.edit({ components: [] }).catch(() => {});
  delete mastGame.pendingMastery;
  if (!isMasterySkip) {
    const mastCardIdx = parseInt(interaction.customId.split('_').pop(), 10);
    const mastCard = mastEl[mastCardIdx];
    if (mastCard) {
      const mastDiscard = mastGame[mastDK] || [];
      const mastIdx = mastDiscard.indexOf(mastCard);
      if (mastIdx >= 0) mastDiscard.splice(mastIdx, 1);
      mastGame[mastDK] = mastDiscard;
      const mastHandKey = ccHandKey(mastAPN);
      mastGame[mastHandKey] = mastGame[mastHandKey] || [];
      mastGame[mastHandKey].push(mastCard);
      const mastThread = await client.channels.fetch(mastCombat.combatThreadId).catch(() => null);
      if (mastThread) await mastThread.send(`**Mastery** — **${mastCard}** returned from discard to hand.`).catch(discordCatch);
      await updateHandChannelMessages(mastGame, client).catch(() => {});
    }
  }
  const mastCThread = await client.channels.fetch(mastCombat.combatThreadId).catch(() => null);
  if (mastCThread) {
    const triggered = await checkPostCombatSurges(mastGame, mastCombat, mastRT, new Set(mastEmbed), mastCThread, mastOwnerId, mastDPN);
    if (triggered) { saveGames(); return; }
  }
  await finishCombatResolution(mastGame, mastCombat, mastRT, new Set(mastEmbed), client);
  saveGames();
  return;
}

/**
 * interrogate_pick_ / interrogate_discard_ / interrogate_skip_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, updateHandChannelMessages
 */
export async function handleInterrogatePick(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, updateHandChannelMessages } = ctx;
  const buttonKey = interaction.customId.startsWith('interrogate_pick_') ? 'interrogate_pick_'
    : interaction.customId.startsWith('interrogate_discard_') ? 'interrogate_discard_'
    : 'interrogate_skip_';
  const intGameId = interaction.customId.match(/^interrogate_(?:pick|discard|skip)_([^_]+)/)?.[1];
  if (!intGameId) { await interaction.followUp({ content: 'Invalid interrogate interaction.', ephemeral: true }).catch(() => {}); return; }
  const intGame = await requireGame(interaction, getGame, intGameId, { silent: true });
  if (!intGame) return;
  if (!intGame.pendingInterrogate) { await interaction.followUp({ content: 'No pending Interrogate choice.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum: intAPN, opponentPlayerNum: intOPN, opponentHandSnapshot: intOHS, chosenCardName: intChosen, ownEligibleSnapshot: intOES, resultText: intRT, combat: intCombat, initialEmbedRefreshMsgIds: intEmbed, defenderPlayerNum: intDPN } = intGame.pendingInterrogate;
  const intOwnerId = intAPN === 1 ? intGame.player1Id : intGame.player2Id;
  if (interaction.user.id !== intOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Interrogate.', ephemeral: true }).catch(() => {}); return; }
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.edit({ components: [] }).catch(() => {});
  const intThread = await client.channels.fetch(intCombat.combatThreadId).catch(() => null);

  if (buttonKey === 'interrogate_pick_') {
    // Step 1: attacker chose a card from opponent's hand. Show own hand to optionally discard.
    const intPickIdx = parseInt(interaction.customId.split('_').pop(), 10);
    const intChosenCard = intOHS[intPickIdx];
    if (!intChosenCard) { delete intGame.pendingInterrogate; saveGames(); return; }
    intGame.pendingInterrogate.chosenCardName = intChosenCard;
    const intChosenCost = getCcEffect(intChosenCard)?.cost ?? 0;
    const intHandKey = ccHandKey(intAPN);
    const intOwnHand = intGame[intHandKey] || [];
    const intEligible = intOwnHand.filter((c) => (getCcEffect(c)?.cost ?? 0) >= intChosenCost);
    if (intEligible.length === 0) {
      // Can't afford to discard — just log and finish
      if (intThread) await intThread.send(`**Interrogate** — You chose **${intChosenCard}** (cost ${intChosenCost}). No cards in your hand with equal or greater cost to force the discard.`).catch(discordCatch);
      delete intGame.pendingInterrogate;
      const triggered = intThread ? await checkPostCombatSurges(intGame, intCombat, intRT, new Set(intEmbed), intThread, intOwnerId, intDPN) : false;
      if (triggered) { saveGames(); return; }
      await finishCombatResolution(intGame, intCombat, intRT, new Set(intEmbed), client);
      saveGames();
      return;
    }
    intGame.pendingInterrogate.ownEligibleSnapshot = intEligible;
    const intStep2Btns = intEligible.slice(0, 4).map((cardName, i) =>
      new ButtonBuilder().setCustomId(`interrogate_discard_${intGameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
    );
    intStep2Btns.push(new ButtonBuilder().setCustomId(`interrogate_skip_${intGameId}`).setLabel("Skip (don't discard)").setStyle(ButtonStyle.Secondary));
    if (intThread) await intThread.send({
      content: `<@${intOwnerId}> **Interrogate** — You chose **${intChosenCard}** (cost ${intChosenCost}). Discard a card (cost ≥ ${intChosenCost}) from your hand to force-discard it?`,
      allowedMentions: { users: [intOwnerId] },
      components: [new ActionRowBuilder().addComponents(intStep2Btns)],
    }).catch(discordCatch);
    saveGames();
    return;
  }

  // Step 2: interrogate_discard_ or interrogate_skip_
  if (!intChosen) { delete intGame.pendingInterrogate; saveGames(); return; }
  if (buttonKey === 'interrogate_discard_') {
    const intDisIdx = parseInt(interaction.customId.split('_').pop(), 10);
    const intOwnCard = (intOES || [])[intDisIdx];
    if (intOwnCard) {
      // Discard attacker's card from hand
      const intHandKey = ccHandKey(intAPN);
      const intOwnHandArr = intGame[intHandKey] || [];
      const intOwnIdx = intOwnHandArr.indexOf(intOwnCard);
      if (intOwnIdx >= 0) intOwnHandArr.splice(intOwnIdx, 1);
      const intOwnDiscardKey = ccDiscardKey(intAPN);
      intGame[intOwnDiscardKey] = intGame[intOwnDiscardKey] || [];
      intGame[intOwnDiscardKey].push(intOwnCard);
      // Discard opponent's chosen card from hand
      const intOppHandKey = ccHandKey(intOPN);
      const intOppHandArr = intGame[intOppHandKey] || [];
      const intOppIdx = intOppHandArr.indexOf(intChosen);
      if (intOppIdx >= 0) intOppHandArr.splice(intOppIdx, 1);
      const intOppDiscardKey = ccDiscardKey(intOPN);
      intGame[intOppDiscardKey] = intGame[intOppDiscardKey] || [];
      intGame[intOppDiscardKey].push(intChosen);
      if (intThread) await intThread.send(`**Interrogate** — Discarded **${intOwnCard}** from your hand; **${intChosen}** removed from opponent's hand.`).catch(discordCatch);
      await updateHandChannelMessages(intGame, intAPN, client).catch(() => {});
      await updateHandChannelMessages(intGame, intOPN, client).catch(() => {});
    }
  } else {
    // Skip — just log
    if (intThread) await intThread.send(`**Interrogate** — Chose to see **${intChosen}** from opponent's hand; no discard.`).catch(discordCatch);
  }
  delete intGame.pendingInterrogate;
  const intTriggered = intThread ? await checkPostCombatSurges(intGame, intCombat, intRT, new Set(intEmbed), intThread, intOwnerId, intDPN) : false;
  if (intTriggered) { saveGames(); return; }
  await finishCombatResolution(intGame, intCombat, intRT, new Set(intEmbed), client);
  saveGames();
  return;
}
