/**
 * Recover handler: detect stuck game states and re-send missing UI prompts.
 * Invoked via botmenu_recover_ button or auto-recovery on bot startup.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getPlayerId, getDcList, getHandChannelId, getPlayAreaId,
  getActivatedDcIndices, opponentPlayerNum, ccHandKey,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';

/**
 * Main recovery handler — called from botmenu Recover button.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleBotmenuRecover(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('botmenu_recover_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.editReply({ content: 'Game not found.', components: [] }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.editReply({ content: 'Only game participants can use Recover.', components: [] }).catch(discordCatch);
    return;
  }

  const results = await runRecovery(game, gameId, ctx);

  if (results.length === 0) {
    await interaction.editReply({ content: 'No missing prompts detected.', components: [] }).catch(discordCatch);
  } else {
    const summary = results.map(r => `- ${r}`).join('\n');
    await interaction.editReply({ content: `**Recovered ${results.length} prompt(s):**\n${summary}`, components: [] }).catch(discordCatch);
  }
  saveGames();
}

/**
 * Core recovery logic — also called by auto-recovery on startup.
 * Returns array of description strings for each recovered prompt.
 */
export async function runRecovery(game, gameId, ctx) {
  const { client } = ctx;
  const results = [];

  // Step 4: pendingCombat
  try {
    const r = await recoverPendingCombat(game, gameId, ctx);
    if (r) results.push(r);
  } catch (err) { console.error('[recover] pendingCombat:', err.message); }

  // Step 5: pendingNegation
  try {
    const r = await recoverPendingNegation(game, gameId, ctx);
    if (r) results.push(r);
  } catch (err) { console.error('[recover] pendingNegation:', err.message); }

  // Step 6: setupAttachmentPhase
  try {
    const r = await recoverSetupAttachmentPhase(game, gameId, ctx);
    results.push(...r);
  } catch (err) { console.error('[recover] setupAttachmentPhase:', err.message); }

  // Step 7: pendingEndTurn
  try {
    const r = await recoverPendingEndTurn(game, gameId, ctx);
    results.push(...r);
  } catch (err) { console.error('[recover] pendingEndTurn:', err.message); }

  // Step 8: endOfRoundWhoseTurn
  try {
    const r = await recoverEndOfRoundWhoseTurn(game, gameId, ctx);
    if (r) results.push(r);
  } catch (err) { console.error('[recover] endOfRoundWhoseTurn:', err.message); }

  // Step 9: forceVisionPending
  try {
    const r = await recoverForceVisionPending(game, gameId, ctx);
    if (r) results.push(r);
  } catch (err) { console.error('[recover] forceVisionPending:', err.message); }

  // Step 10: pendingStartOfRoundResolve
  try {
    const r = await recoverPendingStartOfRound(game, gameId, ctx);
    if (r) results.push(r);
  } catch (err) { console.error('[recover] pendingStartOfRound:', err.message); }

  // Step 11: moveInProgress
  try {
    const r = await recoverMoveInProgress(game, gameId, ctx);
    results.push(...r);
  } catch (err) { console.error('[recover] moveInProgress:', err.message); }

  // Step 12: roundActivationMessageId
  try {
    const r = await recoverRoundActivationMessage(game, gameId, ctx);
    if (r) results.push(r);
  } catch (err) { console.error('[recover] roundActivationMessage:', err.message); }

  // Step 13: CC draw phase
  try {
    const r = await recoverCcDrawPhase(game, gameId, ctx);
    results.push(...r);
  } catch (err) { console.error('[recover] ccDrawPhase:', err.message); }

  return results;
}

// ─── Step 4: Recover pendingCombat ────────────────────────────────────────────

async function recoverPendingCombat(game, gameId, ctx) {
  const { client, sendReadyToResolveRolls } = ctx;
  const combat = game.pendingCombat;
  if (!combat?.combatThreadId) return null;

  let thread;
  try {
    thread = await client.channels.fetch(combat.combatThreadId);
  } catch {
    return null; // thread gone — cannot recover
  }

  // No attack roll yet and not both ready → re-send combat_ready_ button
  if (!combat.attackRoll && (!combat.p1Ready || !combat.p2Ready)) {
    const readyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_ready_${gameId}`)
        .setLabel('Ready to roll combat dice')
        .setStyle(ButtonStyle.Secondary)
    );
    await thread.send({
      content: '**[Recover]** Pre-combat window — click **Ready to roll combat dice** when ready.',
      components: [readyRow],
    });
    return 'Re-sent combat ready button';
  }

  // Both ready but no roll yet → re-send combat_roll_ button
  if (!combat.attackRoll && combat.p1Ready && combat.p2Ready) {
    const rollRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_roll_${gameId}`)
        .setLabel('Roll Combat Dice')
        .setStyle(ButtonStyle.Danger)
    );
    await thread.send({
      content: '**[Recover]** Both players ready — click **Roll Combat Dice** to proceed.',
      components: [rollRow],
    });
    return 'Re-sent combat roll button';
  }

  // Reroll phase active → re-send reroll UI
  if (combat.rerollPhase) {
    // Import sendRerollUI at the call site to avoid circular dependency
    const { sendRerollUI } = await import('./combat.js');
    await sendRerollUI(thread, game, combat, combat.rerollPhase);
    return `Re-sent reroll UI (${combat.rerollPhase} phase)`;
  }

  // Attack roll set, defense roll set, no reroll phase → re-send ready to resolve
  if (combat.attackRoll && combat.defenseRoll && !combat.rerollPhase) {
    if (sendReadyToResolveRolls) {
      await sendReadyToResolveRolls(thread, gameId);
      return 'Re-sent ready-to-resolve-rolls button';
    }
  }

  // Fallback: some other sub-phase (token/surge/etc.)
  await thread.send({
    content: '**[Recover]** Combat is in progress. If stuck, check for surge spending, token usage, or other pending decisions in this thread.',
  });
  return 'Sent combat recovery guidance';
}

// ─── Step 5: Recover pendingNegation ──────────────────────────────────────────

async function recoverPendingNegation(game, gameId, ctx) {
  const { client, getNegationResponseButtons } = ctx;
  if (!game.pendingNegation) return null;

  const oppNum = opponentPlayerNum(game.pendingNegation.playedBy);
  const handId = getHandChannelId(game, oppNum);
  if (!handId) return null;

  const handCh = await client.channels.fetch(handId);
  const buttons = getNegationResponseButtons(gameId);
  await handCh.send({
    content: `**[Recover]** Your opponent played a Command Card. Respond with Negation or let it resolve:`,
    components: [buttons],
  });
  return 'Re-sent negation response buttons';
}

// ─── Step 6: Recover setupAttachmentPhase ─────────────────────────────────────

async function recoverSetupAttachmentPhase(game, gameId, ctx) {
  const { client } = ctx;
  if (!game.setupAttachmentPhase) return [];

  const results = [];
  for (const pn of [1, 2]) {
    if (game.setupAttachmentConfirmed?.[pn]) continue;

    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    const handCh = await client.channels.fetch(handId);

    // Pending confirm — re-send confirm/reselect buttons
    if (game.pendingAttachConfirm?.[pn]) {
      const pc = game.pendingAttachConfirm[pn];
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`attach_confirm_${gameId}_${pn}`)
          .setLabel('Confirm')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`attach_reselect_${gameId}_${pn}`)
          .setLabel('Choose Different Card')
          .setStyle(ButtonStyle.Secondary),
      );
      await handCh.send({
        content: `**[Recover]** Attach **${pc.card}** to **${pc.displayName || pc.dcName}**?`,
        components: [row],
      });
      results.push(`Re-sent attachment confirm for P${pn}`);
      continue;
    }

    const pending = game.setupAttachmentPending?.[pn] || [];
    if (pending.length > 0) {
      // Has pending attachments — send guidance (can't fully reconstruct dropdown without setup.js internals)
      // Use the exported recoverSetupAttachments from setup.js
      const { recoverSetupAttachments } = await import('./setup.js');
      if (recoverSetupAttachments) {
        await recoverSetupAttachments(game, gameId, pn, client);
        results.push(`Re-sent attachment dropdown for P${pn}`);
      } else {
        await handCh.send({
          content: `**[Recover]** You have ${pending.length} attachment(s) remaining to place. The dropdown should appear shortly — if not, use Undo.`,
        });
        results.push(`Sent attachment recovery guidance for P${pn}`);
      }
      continue;
    }

    // No pending, not confirmed → re-send done prompt
    const oppNum = opponentPlayerNum(pn);
    const oppConfirmed = game.setupAttachmentConfirmed?.[oppNum];
    const waitNote = !oppConfirmed ? '\nWaiting for your opponent to finish placing theirs.' : '';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`attach_done_confirm_${gameId}_${pn}`)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`attach_done_redo_${gameId}_${pn}`)
        .setLabel('Redo Attachments')
        .setStyle(ButtonStyle.Secondary),
    );
    await handCh.send({
      content: `**[Recover]** All attachments placed!${waitNote}`,
      components: [row],
    });
    results.push(`Re-sent attachment done prompt for P${pn}`);
  }
  return results;
}

// ─── Step 7: Recover pendingEndTurn ───────────────────────────────────────────

async function recoverPendingEndTurn(game, gameId, ctx) {
  const { client } = ctx;
  if (!game.pendingEndTurn || Object.keys(game.pendingEndTurn).length === 0) return [];

  const results = [];
  const generalCh = game.generalId ? await client.channels.fetch(game.generalId) : null;
  if (!generalCh) return [];

  for (const [msgId, entry] of Object.entries(game.pendingEndTurn)) {
    // Check if the original message still exists
    let exists = false;
    if (entry.messageId) {
      try {
        await generalCh.messages.fetch(entry.messageId);
        exists = true;
      } catch { /* message gone */ }
    }
    if (exists) continue;

    // Message is gone — re-send
    const ownerId = getPlayerId(game, entry.playerNum);
    const endTurnBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`end_turn_${gameId}_${msgId}`)
        .setLabel('End Turn')
        .setStyle(ButtonStyle.Primary)
    );
    const newMsg = await generalCh.send({
      content: `**[Recover]** <@${ownerId}> (**Player ${entry.playerNum}**) **${entry.displayName}** finished all actions. Press **End Turn** when ready.`,
      components: [endTurnBtn],
      allowedMentions: { users: [ownerId] },
    });
    entry.messageId = newMsg.id;
    results.push(`Re-sent End Turn for ${entry.displayName}`);
  }
  return results;
}

// ─── Step 8: Recover endOfRoundWhoseTurn ──────────────────────────────────────

async function recoverEndOfRoundWhoseTurn(game, gameId, ctx) {
  const { client, updateHandChannelMessages } = ctx;
  if (!game.endOfRoundWhoseTurn) return null;

  // Refresh hand channels (includes EOR button)
  await updateHandChannelMessages(game, client);

  // Send reminder in general
  if (game.generalId) {
    const generalCh = await client.channels.fetch(game.generalId);
    await generalCh.send({
      content: `**[Recover]** <@${game.endOfRoundWhoseTurn}> — it's your turn in the End of Round window. Click **End 'End of Round' window** in your Hand channel when done.`,
      allowedMentions: { users: [game.endOfRoundWhoseTurn] },
    });
  }
  return 'Re-sent End of Round window reminder';
}

// ─── Step 9: Recover forceVisionPending ───────────────────────────────────────

async function recoverForceVisionPending(game, gameId, ctx) {
  const { client } = ctx;
  const fvPn = game.forceVisionPending;
  if (!fvPn) return null;

  const dcList = getDcList(game, fvPn) || [];
  const activated = getActivatedDcIndices(game, fvPn) || [];
  const readyGroups = [];

  for (let i = 0; i < dcList.length; i++) {
    if (activated.includes(i)) continue;
    const dc = dcList[i];
    const figs = game.figurePositions?.[fvPn] || {};
    const alive = Object.entries(figs).some(([fk, pos]) => fk.startsWith(dc.dcName + '-') && pos);
    if (!alive) continue;
    readyGroups.push({ index: i, dcName: dc.dcName, displayName: dc.displayName || dc.dcName });
  }

  if (readyGroups.length === 0) return null;

  const rows = [];
  const btns = [];
  for (const rg of readyGroups.slice(0, 20)) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`fv_pick_${gameId}_${fvPn}_${rg.index}`)
        .setLabel(rg.displayName.length > 80 ? rg.displayName.slice(0, 77) + '...' : rg.displayName)
        .setStyle(ButtonStyle.Primary)
    );
    if (btns.length === 5) {
      rows.push(new ActionRowBuilder().addComponents(...btns.splice(0)));
    }
  }
  if (btns.length > 0) rows.push(new ActionRowBuilder().addComponents(...btns));

  const ownerId = getPlayerId(game, fvPn);
  const generalCh = await client.channels.fetch(game.generalId);
  await generalCh.send({
    content: `**[Recover]** Force Vision — <@${ownerId}>, choose one of your ready groups to activate next:`,
    components: rows.slice(0, 5),
    allowedMentions: { users: [ownerId] },
  });
  return 'Re-sent Force Vision picker';
}

// ─── Step 10: Recover pendingStartOfRoundResolve ──────────────────────────────

async function recoverPendingStartOfRound(game, gameId, ctx) {
  const { client } = ctx;
  if (!game.pendingStartOfRoundResolve || game.pendingStartOfRoundResolve <= 0) return null;

  // Check for Rogue One pending
  for (const pn of [1, 2]) {
    const roKey = `pendingRogueOne_p${pn}`;
    const roPending = game[roKey];
    if (roPending) {
      const hand = game[ccHandKey(pn)] || [];
      if (hand.length > 0) {
        const handId = getHandChannelId(game, pn);
        const handCh = await client.channels.fetch(handId);
        const pickBtns = hand.slice(0, 25).map((card, idx) => new ButtonBuilder()
          .setCustomId(`rogue_one_return_${gameId}_${pn}_${idx}`)
          .setLabel(card.length > 80 ? card.slice(0, 77) + '...' : card)
          .setStyle(ButtonStyle.Primary)
        );
        const pickRows = [];
        for (let r = 0; r < pickBtns.length; r += 5) pickRows.push(new ActionRowBuilder().addComponents(pickBtns.slice(r, r + 5)));
        await handCh.send({
          content: `**[Recover]** Rogue One — Choose a card to place on top of your deck (${roPending.remaining} remaining):`,
          components: pickRows,
        });
      }
    }
  }

  // Always send a fallback end_start_of_round_ button in general
  if (game.generalId) {
    const generalCh = await client.channels.fetch(game.generalId);
    const fallbackRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`end_start_of_round_${gameId}`)
        .setLabel('End Start of Round Window')
        .setStyle(ButtonStyle.Secondary)
    );
    await generalCh.send({
      content: `**[Recover]** Start-of-round effects are pending. Resolve any remaining effects, then click below to advance.`,
      components: [fallbackRow],
    });
  }
  return 'Re-sent start-of-round resolution prompts';
}

// ─── Step 11: Recover moveInProgress ──────────────────────────────────────────

async function recoverMoveInProgress(game, gameId, ctx) {
  const { client, getMoveMpButtonRows } = ctx;
  if (!game.moveInProgress || Object.keys(game.moveInProgress).length === 0) return [];

  const results = [];
  for (const [moveKey, moveState] of Object.entries(game.moveInProgress)) {
    if (!moveState || moveState.mpRemaining <= 0) continue;

    const channelId = getPlayAreaId(game, moveState.playerNum);
    if (!channelId) continue;

    // Clear stale cached data
    delete moveState.boardState;
    delete moveState.movementCache;
    delete moveState.distanceMessageId;
    delete moveState.moveGridMessageIds;

    // Re-send MP picker — moveKey is `${msgId}_${figureIndex}`
    const lastUnderscore = moveKey.lastIndexOf('_');
    const msgId = moveKey.slice(0, lastUnderscore);
    const figureIndex = moveKey.slice(lastUnderscore + 1);
    const mpRows = getMoveMpButtonRows(msgId, figureIndex, moveState.mpRemaining);
    if (mpRows.length === 0) continue;

    const ch = await client.channels.fetch(channelId);
    await ch.send({
      content: `**[Recover]** Movement in progress — ${moveState.mpRemaining} MP remaining. Choose how many to spend:`,
      components: mpRows,
    });
    results.push(`Re-sent MP picker (${moveState.mpRemaining} MP remaining)`);
  }
  return results;
}

// ─── Step 12: Recover roundActivationMessageId ───────────────────────────────

async function recoverRoundActivationMessage(game, gameId, ctx) {
  const { client, sendRoundActivationPhaseMessage } = ctx;
  if (!game.roundActivationMessageId || !game.generalId) return null;
  if (!game.currentRound) return null;

  // Check if message still exists
  try {
    const generalCh = await client.channels.fetch(game.generalId);
    await generalCh.messages.fetch(game.roundActivationMessageId);
    return null; // message exists, no recovery needed
  } catch {
    // Message is gone — re-send
    await sendRoundActivationPhaseMessage(game, client);
    return 'Re-sent round activation phase message';
  }
}

// ─── Step 13: Recover CC draw phase ──────────────────────────────────────────

async function recoverCcDrawPhase(game, gameId, ctx) {
  const { client } = ctx;
  if (game.player1CcDrawn && game.player2CcDrawn) return [];
  // Only relevant after deployment is done (hand channels exist)
  if (!game.p1HandId && !game.p2HandId) return [];

  // Dynamically import to avoid circular deps
  const { getCcShuffleDrawButton } = await import('../discord/components.js');
  const results = [];

  for (const pn of [1, 2]) {
    const drawnKey = pn === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    if (game[drawnKey]) continue;

    const handId = getHandChannelId(game, pn);
    if (!handId) continue;

    const handCh = await client.channels.fetch(handId);
    await handCh.send({
      content: `**[Recover]** Shuffle your deck and draw your starting hand:`,
      components: [getCcShuffleDrawButton(gameId)],
    });
    results.push(`Re-sent shuffle/draw button for P${pn}`);
  }
  return results;
}
