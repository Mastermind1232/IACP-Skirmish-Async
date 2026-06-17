/**
 * Post-combat resolution handlers:
 *   bleed_accept_ / bleed_prevent_
 *   reaction_skip_
 *   reaction_use_
 *   right_back_block_ / right_back_nodmg_
 *   mastery_pick_ / mastery_skip_
 *   interrogate_pick_ / interrogate_discard_ / interrogate_skip_
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { getMapData, getCcEffect } from '../data-loader.js';
import { ccHandKey, ccDiscardKey, ccDeckKey, getPlayerId, getHandChannelId, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { dcNameFromFigureKey, grantMovementBank } from '../game/index.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';
import { clearPendingReaction, setPendingRightBackAtYa, clearPendingRightBackAtYa, clearPendingMastery, clearPendingMilitaryEfficiency, clearPendingInterrogate } from '../game/interrupts.js';
import { fetchCombatThread, fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { cardNameIncludes } from '../game/card-names.js';
import { exhaustAttachment } from '../game/card-state-helpers.js';
import { findSmugglingCompartmentMsgId, setAsideFromHand } from '../game/smuggling-compartment.js';

/**
 * reaction_skip_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution
 */
export async function handleReactionSkip(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution } = ctx;
  const gameId = parseCustomId(interaction.customId, 'reaction_skip_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingReaction) { await interaction.followUp({ content: 'No pending reaction.', ephemeral: true }).catch(discordCatch); return; }
  const { ownerId, cardName } = game.pendingReaction;
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can skip.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(discordCatch);
  const pending = game.pendingReaction;
  clearPendingReaction(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  // Restore the card to hand (it was tentatively removed when prompting)
  const handKey = ccHandKey(pending.defenderPlayerNum);
  game[handKey] = game[handKey] || [];
  game[handKey].push(cardName);
  // Continue checking for more reactions or finish
  const cThread = await fetchCombatThread(client, pending.combatThreadId);
  if (cThread) {
    const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), cThread, ownerId, pending.defenderPlayerNum);
    if (triggered) { saveGames(game.gameId); return; }
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), client);
  saveGames(game.gameId);
  return;
}

/**
 * reaction_use_
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, findDcMessageIdForFigure, applyDirectDamageToFigure
 */
export async function handleReactionUse(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution, findDcMessageIdForFigure, applyDirectDamageToFigure } = ctx;
  const gameId = parseCustomId(interaction.customId, 'reaction_use_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingReaction) { await interaction.followUp({ content: 'No pending reaction.', ephemeral: true }).catch(discordCatch); return; }
  const { ownerId, cardName, targetFigKey, attackerFigKey, attackerMsgId, defenderPlayerNum } = game.pendingReaction;
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can use this.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const pending = game.pendingReaction;
  clearPendingReaction(game);
  // Card was already removed from hand when prompting; discard it (add to discard pile)
  const discardKey = ccDiscardKey(defenderPlayerNum);
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(cardName);
  const combat = pending.combat;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const thread = await fetchCombatThread(client, pending.combatThreadId);

  if (cardName === 'Payback') {
    // Payback: Dengar counter-attacks the attacker with +2 Surge bonus.
    // Per alexanbv 2026-05-13: per-figureKey (Dengar's figureKey).
    if (targetFigKey) {
      game.paybackBonusSurge = game.paybackBonusSurge || {};
      game.paybackBonusSurge[targetFigKey] = (game.paybackBonusSurge[targetFigKey] || 0) + 2;
    }
    const attackerName = dcNameFromFigureKey(attackerFigKey);
    if (thread) await thread.send(`**Payback** — Dengar may now counter-attack **${attackerName}**. Use the Attack button on Dengar's DC card. **+2 Surge** will be applied automatically to that attack.`).catch(discordCatch);
  } else if (cardName === 'Dangerous Prey') {
    // Dangerous Prey: attacker suffers 1 Damage (3 if adjacent), THEN
    // move up to 2 spaces. Per alexanbv 2026-05-11: "move up to N
    // spaces" is the Move-X-spaces pipeline (bypassCosts: true),
    // NOT a bank grant. Fires out of own activation (defender side
    // during attacker's turn).
    const attackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigKey];
    const bosskPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigKey];
    const ms = getMapData(game.selectedMap?.id);
    const adjSet = new Set((ms?.adjacency?.[String(bosskPos).toLowerCase()] || []).map((s) => String(s).toLowerCase()));
    const isAdj = attackerPos && bosskPos && adjSet.has(String(attackerPos).toLowerCase());
    const dmg = isAdj ? 3 : 1;
    const atkMsgId = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
    const attackerName = dcNameFromFigureKey(attackerFigKey);
    const defenderName = dcNameFromFigureKey(targetFigKey);
    if (thread) await thread.send(`**Dangerous Prey** — ${attackerName} suffers **${dmg} Damage**${isAdj ? ` (adjacent to ${defenderName})` : ''}. ${defenderName} may move up to 2 spaces.`).catch(discordCatch);
    await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId, dmg, client, null, 'Dangerous Prey');
    // Stamp Move-X picker: 2 spaces, bypassCosts=true (per CRR MOVE-017)
    const defMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, targetFigKey);
    if (defMsgId) {
      try {
        const { setupPendingMoveX } = await import('./move-x-handler.js');
        await setupPendingMoveX(game, { client, logGameAction: ctx.logGameAction, saveGames }, {
          msgId: defMsgId,
          figureKey: targetFigKey,
          playerNum: defenderPlayerNum,
          spaces: 2,
          source: 'Dangerous Prey',
          threadId: thread?.id || null,
          bypassCosts: true,
        });
      } catch (err) {
        console.error('[post-combat] Dangerous Prey Move-X stamp failed:', err?.message ?? err);
      }
    }
  } else if (cardName === "Right Back At Ya!") {
    // Right Back At Ya! (Ahsoka): attacker suffers 1 Damage (3 if defender spends Block Token)
    const defTokens = game.figurePowerTokens?.[targetFigKey] || [];
    const hasBlock = defTokens.includes('Block');
    if (hasBlock) {
      // Prompt for block token choice
      setPendingRightBackAtYa(game, {
        gameId: game.gameId,
        combatThreadId: pending.combatThreadId,
        attackerPlayerNum,
        defenderPlayerNum,
        ownerId,
        attackerFigKey,
        attackerMsgId: attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey),
        defenderFigKey: targetFigKey,
        resultText: pending.resultText,
        combat: pending.combat,
        initialEmbedRefreshMsgIds: pending.initialEmbedRefreshMsgIds,
      });
      const btn3 = new ButtonBuilder().setCustomId(`right_back_block_${gameId}`).setLabel('Spend Block Token — 3 Damage').setStyle(ButtonStyle.Danger);
      const btn1 = new ButtonBuilder().setCustomId(`right_back_nodmg_${gameId}`).setLabel('1 Damage (no token)').setStyle(ButtonStyle.Secondary);
      if (thread) await thread.send({
        content: `<@${ownerId}> **Right Back At Ya!** — Spend your Block Token for 3 Damage, or deal 1 Damage without spending it:`,
        allowedMentions: { users: [ownerId] },
        components: [new ActionRowBuilder().addComponents(btn3, btn1)],
      }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    // No block token — just 1 damage
    const atkMsgId2 = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
    await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId2, 1, client, thread, 'Right Back At Ya!');
  }

  // Check for more reactions or finish
  if (thread) {
    const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum);
    if (triggered) { saveGames(game.gameId); return; }
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds), client);
  saveGames(game.gameId);
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
  const gameId = parseCustomId(interaction.customId, buttonKey);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingRightBackAtYa) { await interaction.followUp({ content: 'No pending Right Back At Ya! choice.', ephemeral: true }).catch(discordCatch); return; }
  const { ownerId, attackerPlayerNum, defenderPlayerNum, attackerFigKey, attackerMsgId, defenderFigKey } = game.pendingRightBackAtYa;
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the reaction player can choose.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const rbPending = game.pendingRightBackAtYa;
  clearPendingRightBackAtYa(game);
  const thread = await fetchCombatThread(client, rbPending.combatThreadId);
  let dmg = 1;
  if (isBlockVariant) {
    // Spend Block token
    const defTokens = game.figurePowerTokens?.[defenderFigKey] || [];
    const blockIdx = defTokens.indexOf('Block');
    if (blockIdx >= 0) defTokens.splice(blockIdx, 1);
    if (!game.figurePowerTokens) game.figurePowerTokens = {};
    game.figurePowerTokens[defenderFigKey] = defTokens;
    dmg = 3;
  }
  const atkMsgId = attackerMsgId || findDcMessageIdForFigure(game.gameId, attackerPlayerNum, attackerFigKey);
  await applyDirectDamageToFigure(game, attackerPlayerNum, attackerFigKey, atkMsgId, dmg, client, thread, 'Right Back At Ya!');
  // Continue checking for more reactions or finish
  if (thread) {
    const triggered = await checkPostCombatSurges(game, rbPending.combat, rbPending.resultText, new Set(rbPending.initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum);
    if (triggered) { saveGames(game.gameId); return; }
  }
  await finishCombatResolution(game, rbPending.combat, rbPending.resultText, new Set(rbPending.initialEmbedRefreshMsgIds), client);
  saveGames(game.gameId);
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
  const mastGameId = isMasterySkip ? parseCustomId(interaction.customId, 'mastery_skip_') : interaction.customId.match(/^mastery_pick_([^_]+)_\d+$/)?.[1];
  if (!mastGameId) { await interaction.followUp({ content: 'Invalid mastery interaction.', ephemeral: true }).catch(discordCatch); return; }
  const mastGame = await requireGame(interaction, getGame, mastGameId, { silent: true });
  if (!mastGame) return;
  if (!mastGame.pendingMastery) { await interaction.followUp({ content: 'No pending Mastery choice.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum: mastAPN, discardKey: mastDK, eligible: mastEl, resultText: mastRT, combat: mastCombat, initialEmbedRefreshMsgIds: mastEmbed, defenderPlayerNum: mastDPN } = mastGame.pendingMastery;
  const mastOwnerId = mastAPN === 1 ? mastGame.player1Id : mastGame.player2Id;
  if (interaction.user.id !== mastOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Mastery.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  clearPendingMastery(mastGame);
  if (!isMasterySkip) {
    // Rest in Peace: block discard-pile retrieval
    if (mastGame.restInPeaceActive) {
      const mastThread = await fetchCombatThread(client, mastCombat.combatThreadId);
      if (mastThread) await mastThread.send('**Mastery** — Blocked by **Rest in Peace** (cannot retrieve from discard piles this round).').catch(discordCatch);
    } else {
    const mastCardIdx = parseInt(splitCustomId(interaction.customId, 'mastery_pick_')[1], 10);
    const mastCard = mastEl[mastCardIdx];
    if (mastCard) {
      const mastDiscard = mastGame[mastDK] || [];
      const mastIdx = mastDiscard.indexOf(mastCard);
      if (mastIdx >= 0) mastDiscard.splice(mastIdx, 1);
      mastGame[mastDK] = mastDiscard;
      const mastHandKey = ccHandKey(mastAPN);
      mastGame[mastHandKey] = mastGame[mastHandKey] || [];
      mastGame[mastHandKey].push(mastCard);
      const mastThread = await fetchCombatThread(client, mastCombat.combatThreadId);
      if (mastThread) await mastThread.send(`**Mastery** — **${mastCard}** returned from discard to hand.`).catch(discordCatch);
      await updateHandChannelMessages(mastGame, client).catch(discordCatch);
    }
    }
  }
  const mastCThread = await fetchCombatThread(client, mastCombat.combatThreadId);
  if (mastCThread) {
    const triggered = await checkPostCombatSurges(mastGame, mastCombat, mastRT, new Set(mastEmbed), mastCThread, mastOwnerId, mastDPN);
    if (triggered) { saveGames(game.gameId); return; }
  }
  await finishCombatResolution(mastGame, mastCombat, mastRT, new Set(mastEmbed), client);
  saveGames(game.gameId);
  return;
}

/**
 * me_pick_ / me_skip_ — Military Efficiency (Leia Organa)
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution
 */
export async function handleMilitaryEfficiencyPick(interaction, ctx) {
  const { getGame, client, saveGames, checkPostCombatSurges, finishCombatResolution } = ctx;
  const isMeSkip = interaction.customId.startsWith('me_skip_');
  const meGameId = isMeSkip ? parseCustomId(interaction.customId, 'me_skip_') : interaction.customId.match(/^me_pick_([^_]+)_\d+$/)?.[1];
  if (!meGameId) { await interaction.followUp({ content: 'Invalid Military Efficiency interaction.', ephemeral: true }).catch(discordCatch); return; }
  const meGame = await requireGame(interaction, getGame, meGameId, { silent: true });
  if (!meGame) return;
  if (!meGame.pendingMilitaryEfficiency) { await interaction.followUp({ content: 'No pending Military Efficiency choice.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum: meAPN, discardKey: meDK, eligible: meEl, resultText: meRT, combat: meCombat, initialEmbedRefreshMsgIds: meEmbed, defenderPlayerNum: meDPN } = meGame.pendingMilitaryEfficiency;
  const meOwnerId = meAPN === 1 ? meGame.player1Id : meGame.player2Id;
  if (interaction.user.id !== meOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Military Efficiency.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  clearPendingMilitaryEfficiency(meGame);
  if (!isMeSkip) {
    if (meGame.restInPeaceActive) {
      const meThread = await fetchCombatThread(client, meCombat.combatThreadId);
      if (meThread) await meThread.send('**Military Efficiency** — Blocked by **Rest in Peace** (cannot retrieve from discard piles this round).').catch(discordCatch);
    } else {
      const meCardIdx = parseInt(splitCustomId(interaction.customId, 'me_pick_')[1], 10);
      const meCard = meEl[meCardIdx];
      if (meCard) {
        const meDiscard = meGame[meDK] || [];
        const meIdx = meDiscard.indexOf(meCard);
        if (meIdx >= 0) meDiscard.splice(meIdx, 1);
        meGame[meDK] = meDiscard;
        const meDeckK = ccDeckKey(meAPN);
        const meDeck = [...(meGame[meDeckK] || [])];
        const meInsertIdx = Math.floor(Math.random() * (meDeck.length + 1));
        meDeck.splice(meInsertIdx, 0, meCard);
        meGame[meDeckK] = meDeck;
        const meThread = await fetchCombatThread(client, meCombat.combatThreadId);
        if (meThread) await meThread.send(`**Military Efficiency** — **${meCard}** shuffled from discard back into your Command deck.`).catch(discordCatch);
      }
    }
  }
  const meCThread = await fetchCombatThread(client, meCombat.combatThreadId);
  if (meCThread) {
    const triggered = await checkPostCombatSurges(meGame, meCombat, meRT, new Set(meEmbed), meCThread, meOwnerId, meDPN);
    if (triggered) { saveGames(meGame.gameId); return; }
  }
  await finishCombatResolution(meGame, meCombat, meRT, new Set(meEmbed), client);
  saveGames(meGame.gameId);
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
  if (!intGameId) { await interaction.followUp({ content: 'Invalid interrogate interaction.', ephemeral: true }).catch(discordCatch); return; }
  const intGame = await requireGame(interaction, getGame, intGameId, { silent: true });
  if (!intGame) return;
  if (!intGame.pendingInterrogate) { await interaction.followUp({ content: 'No pending Interrogate choice.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum: intAPN, opponentPlayerNum: intOPN, opponentHandSnapshot: intOHS, chosenCardName: intChosen, ownEligibleSnapshot: intOES, resultText: intRT, combat: intCombat, initialEmbedRefreshMsgIds: intEmbed, defenderPlayerNum: intDPN } = intGame.pendingInterrogate;
  const intOwnerId = intAPN === 1 ? intGame.player1Id : intGame.player2Id;
  if (interaction.user.id !== intOwnerId) { await interaction.followUp({ content: 'Only the attacker can resolve Interrogate.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const intThread = await fetchCombatThread(client, intCombat.combatThreadId);

  if (buttonKey === 'interrogate_pick_') {
    // Step 1: attacker chose a card from opponent's hand. Show own hand to optionally discard.
    const intPickIdx = parseInt(splitCustomId(interaction.customId, 'interrogate_pick_')[1], 10);
    const intChosenCard = intOHS[intPickIdx];
    if (!intChosenCard) { clearPendingInterrogate(intGame); saveGames(game.gameId); return; }
    intGame.pendingInterrogate.chosenCardName = intChosenCard;
    const intChosenCost = getCcEffect(intChosenCard)?.cost ?? 0;
    const intHandKey = ccHandKey(intAPN);
    const intOwnHand = intGame[intHandKey] || [];
    const intEligible = intOwnHand.filter((c) => (getCcEffect(c)?.cost ?? 0) >= intChosenCost);
    if (intEligible.length === 0) {
      // Can't afford to discard — just log and finish
      if (intThread) await intThread.send(`**Interrogate** — You chose **${intChosenCard}** (cost ${intChosenCost}). No cards in your hand with equal or greater cost to force the discard.`).catch(discordCatch);
      clearPendingInterrogate(intGame);
      const triggered = intThread ? await checkPostCombatSurges(intGame, intCombat, intRT, new Set(intEmbed), intThread, intOwnerId, intDPN) : false;
      if (triggered) { saveGames(game.gameId); return; }
      await finishCombatResolution(intGame, intCombat, intRT, new Set(intEmbed), client);
      saveGames(game.gameId);
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
    saveGames(game.gameId);
    return;
  }

  // Step 2: interrogate_discard_ or interrogate_skip_
  if (!intChosen) { clearPendingInterrogate(intGame); saveGames(game.gameId); return; }
  if (buttonKey === 'interrogate_discard_') {
    const intDisIdx = parseInt(splitCustomId(interaction.customId, 'interrogate_discard_')[1], 10);
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
      // When-discarded subroutine (both forced discards): re-draw passives + Windfall hooks.
      const { fireCcDiscarded } = await import('../game/cc-passive-redraw.js');
      const _intDiscA = fireCcDiscarded(intGame, intAPN, intOwnCard, { fromDeck: false });
      const _intDiscB = fireCcDiscarded(intGame, intOPN, intChosen, { fromDeck: false });
      if (intThread) await intThread.send(`**Interrogate** — Discarded **${intOwnCard}** from your hand; **${intChosen}** removed from opponent's hand.`).catch(discordCatch);
      if (_intDiscA.windfallSelfVp > 0 && intThread) await intThread.send(`**Windfall** — P${intAPN} gains **1 VP** (Windfall discarded).`).catch(discordCatch);
      if (_intDiscB.windfallSelfVp > 0 && intThread) await intThread.send(`**Windfall** — P${intOPN} gains **1 VP** (Windfall discarded).`).catch(discordCatch);
      await updateHandChannelMessages(intGame, client).catch(discordCatch);
    }
  } else {
    // Skip — just log
    if (intThread) await intThread.send(`**Interrogate** — Chose to see **${intChosen}** from opponent's hand; no discard.`).catch(discordCatch);
  }
  clearPendingInterrogate(intGame);
  const intTriggered = intThread ? await checkPostCombatSurges(intGame, intCombat, intRT, new Set(intEmbed), intThread, intOwnerId, intDPN) : false;
  if (intTriggered) { saveGames(game.gameId); return; }
  await finishCombatResolution(intGame, intCombat, intRT, new Set(intEmbed), client);
  saveGames(game.gameId);
  return;
}

/**
 * [Smuggling Compartment] vs Interrogate — present Blaise's hand picker from the
 * CURRENT opponent hand (after any set-aside). Returns true if the picker was
 * posted, false if the opponent's hand is now empty (caller finishes combat).
 */
async function presentInterrogatePicker(game, client) {
  const pend = game.pendingInterrogate;
  if (!pend) return false;
  const thread = await fetchCombatThread(client, pend.combatThreadId || pend.combat?.combatThreadId);
  const oppHand = game[ccHandKey(pend.opponentPlayerNum)] || [];
  if (oppHand.length === 0) {
    if (thread) await thread.send(`**Interrogate** — Opponent's hand is empty after **[Smuggling Compartment]**; no card to choose.`).catch(discordCatch);
    return false;
  }
  pend.opponentHandSnapshot = [...oppHand];
  pend.awaitingSc = false;
  const ownerId = getPlayerId(game, pend.attackerPlayerNum);
  const btns = oppHand.slice(0, 4).map((cardName, i) =>
    new ButtonBuilder().setCustomId(`interrogate_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger));
  if (thread) await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Interrogate** — ⚠️ *Opponent: look away!* Pick the card you want to target:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
  return true;
}

/** After the SC reaction resolves, resume Interrogate (or finish combat if the hand emptied). */
async function _resumeInterrogateAfterSc(game, ctx) {
  const { client, saveGames, checkPostCombatSurges, finishCombatResolution } = ctx;
  const pend = game.pendingInterrogate;
  if (!pend) { saveGames(game.gameId); return; }
  const posted = await presentInterrogatePicker(game, client);
  if (!posted) {
    const { combat, resultText, initialEmbedRefreshMsgIds, defenderPlayerNum, attackerPlayerNum } = pend;
    const ownerId = getPlayerId(game, attackerPlayerNum);
    clearPendingInterrogate(game);
    const thread = await fetchCombatThread(client, pend.combatThreadId || combat?.combatThreadId);
    const triggered = thread ? await checkPostCombatSurges(game, combat, resultText, new Set(initialEmbedRefreshMsgIds), thread, ownerId, defenderPlayerNum) : false;
    if (!triggered) await finishCombatResolution(game, combat, resultText, new Set(initialEmbedRefreshMsgIds), client);
  }
  saveGames(game.gameId);
}

/** [Smuggling Compartment] vs Interrogate — owner opted in: show a multi-select of their hand. */
export async function handleScInterrogateOpen(interaction, ctx) {
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_int_open_');
  const gameId = parts[0];
  const oppNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (interaction.user.id !== getPlayerId(game, oppNum)) {
    await interaction.followUp({ content: 'Only the card owner can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const hand = game[ccHandKey(oppNum)] || [];
  if (hand.length === 0) {
    await interaction.message.edit({ content: '**[Smuggling Compartment]** — no cards in hand to set aside.', components: [] }).catch(discordCatch);
    await _resumeInterrogateAfterSc(game, ctx);
    return;
  }
  const seen = new Set();
  const opts = [];
  for (const c of hand) {
    if (seen.has(c)) continue;
    seen.add(c);
    opts.push(new StringSelectMenuOptionBuilder().setLabel(c.slice(0, 100)).setValue(c));
    if (opts.length >= 25) break;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`sc_int_confirm_${gameId}_${oppNum}`)
    .setPlaceholder('Choose Command cards to set aside')
    .setMinValues(1)
    .setMaxValues(opts.length)
    .addOptions(opts);
  await interaction.message.edit({
    content: '**[Smuggling Compartment]** — choose Command cards to set aside before Interrogate (returned at the start of your next activation or the next phase):',
    components: [new ActionRowBuilder().addComponents(select)],
  }).catch(discordCatch);
}

/** [Smuggling Compartment] vs Interrogate — owner declined: proceed with Interrogate. */
export async function handleScInterrogateSkip(interaction, ctx) {
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_int_skip_');
  const game = await requireGame(interaction, getGame, parts[0], { silent: true });
  if (!game) return;
  await interaction.message.edit({ content: '**[Smuggling Compartment]** — declined; Interrogate proceeds.', components: [] }).catch(discordCatch);
  await _resumeInterrogateAfterSc(game, ctx);
}

/** [Smuggling Compartment] vs Interrogate — owner confirmed which CCs to set aside, then resume. */
export async function handleScInterrogateConfirm(interaction, ctx) {
  const { getGame, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_int_confirm_');
  const gameId = parts[0];
  const oppNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (interaction.user.id !== getPlayerId(game, oppNum)) {
    await interaction.followUp({ content: 'Only the card owner can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch); // select interactions are not auto-deferred
  const chosen = interaction.values || [];
  const handKey = ccHandKey(oppNum);
  const { hand: newHand, setAside } = setAsideFromHand(game[handKey] || [], chosen);
  if (setAside.length > 0) {
    const scMid = findSmugglingCompartmentMsgId(getDcList(game, oppNum), getDcMessageIds(game, oppNum));
    if (scMid) exhaustAttachment(game, scMid, 'Smuggling Compartment');
    game[handKey] = newHand;
    game.smugglingCompartmentSetAside = game.smugglingCompartmentSetAside || {};
    game.smugglingCompartmentSetAside[oppNum] = [...(game.smugglingCompartmentSetAside[oppNum] || []), ...setAside];
    if (logGameAction) await logGameAction(game, client, `**[Smuggling Compartment]** — P${oppNum} set aside ${setAside.length} Command card${setAside.length === 1 ? '' : 's'} before Interrogate.`, { phase: 'COMBAT', icon: 'card' }).catch(() => {});
  }
  await interaction.message.edit({ content: `**[Smuggling Compartment]** — set aside ${setAside.length} card${setAside.length === 1 ? '' : 's'}. Interrogate proceeds.`, components: [] }).catch(discordCatch);
  await _resumeInterrogateAfterSc(game, ctx);
}
