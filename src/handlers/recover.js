/**
 * Recover handler: detect stuck game states and re-send missing UI prompts.
 * Invoked via botmenu_recover_ button or auto-recovery on bot startup.
 *
 * Phase 3.7.2: Now uses the available-actions system as a diagnostic layer.
 * getRecoveryPrompts() tells us which players need actions; the legacy
 * recover functions know HOW to reconstruct the Discord prompts.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getPlayerId, getDcList, getHandChannelId, getPlayAreaId,
  getActivatedDcIndices, opponentPlayerNum, ccHandKey,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { fetchGameChannel, fetchCombatThread } from '../discord/channel-helpers.js';
import { PHASE_GATE_LABELS } from '../game/phase-gate.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { getRecoveryPrompts, needsRecovery } from '../engine/recovery.js';

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
    // Include diagnostic info so the user can report what state the game is in
    const diag = `phase=${game.phase || 'none'}, round=${game.currentRound || 0}, squads=${!!game.player1Squad}/${!!game.player2Squad}, initiative=${!!game.initiativeDetermined}`;
    await interaction.editReply({ content: `No missing prompts detected. (${diag})`, components: [] }).catch(discordCatch);
  } else {
    const summary = results.map(r => `- ${r}`).join('\n');
    await interaction.editReply({ content: `**Recovered ${results.length} prompt(s):**\n${summary}`, components: [] }).catch(discordCatch);
  }
  saveGames();
}

/**
 * Core recovery logic — also called by auto-recovery on startup.
 * Returns array of description strings for each recovered prompt.
 *
 * Phase 3.7.2: Uses getRecoveryPrompts() from the available-actions system
 * as a diagnostic layer. The actions system tells us WHICH players need
 * prompts and WHAT types; the legacy recover functions know HOW to
 * reconstruct the specific Discord UI for each case.
 */
export async function runRecovery(game, gameId, ctx) {
  const results = [];
  let specificCount = 0;
  let genericCount = 0;

  // Helper: run a recovery function, collect results, log errors.
  // Each recovery fn returns null (nothing to recover), a string, or string[].
  // `source` is 'specific' or 'generic' for observability.
  async function tryRecover(name, fn, source = 'specific') {
    try {
      const r = await fn();
      if (r == null) return;
      const items = Array.isArray(r) ? r : [r];
      results.push(...items);
      if (source === 'generic') genericCount += items.length;
      else specificCount += items.length;
    } catch (err) {
      console.error(`[recover] ${name}:`, err.message);
      results.push(`[ERROR] ${name}: ${err.message}`);
    }
  }

  // ── Available-actions diagnostic ───────────────────────────────────
  let actionsDiag = [];
  try {
    const deps = { dcMessageMeta: ctx.dcMessageMeta, dcExhaustedState: ctx.dcExhaustedState };
    actionsDiag = getRecoveryPrompts(game, deps);
    if (actionsDiag.length > 0) {
      console.log(`[recover] Available-actions diagnostic for game ${gameId}:`,
        actionsDiag.map(p => `P${p.playerNum}: ${p.description}`).join('; '));
    }
  } catch (err) {
    console.error('[recover] Available-actions diagnostic failed:', err.message);
  }

  // ── Phase gate (highest priority — blocks all other actions) ───────
  await tryRecover('phaseGate', () => recoverPhaseGate(game, gameId, ctx));
  if (game.phaseGate && results.length > 0) return results;

  // ── Run all recovery functions unconditionally ─────────────────────
  // Each function has its own internal guards (e.g. recoverPendingCombat
  // checks game.pendingCombat). No phase-based dispatch needed — the
  // guards are the single source of truth for "is this recovery relevant?"
  await tryRecover('bothSquadsReady',     () => recoverBothSquadsReady(game, gameId, ctx));
  await tryRecover('pendingCombat',       () => recoverPendingCombat(game, gameId, ctx));
  await tryRecover('pendingNegation',     () => recoverPendingNegation(game, gameId, ctx));
  await tryRecover('setupAttachment',     () => recoverSetupAttachmentPhase(game, gameId, ctx));
  await tryRecover('pendingEndTurn',      () => recoverPendingEndTurn(game, gameId, ctx));
  await tryRecover('endOfRoundWhoseTurn', () => recoverEndOfRoundWhoseTurn(game, gameId, ctx));
  await tryRecover('forceVisionPending',  () => recoverForceVisionPending(game, gameId, ctx));
  await tryRecover('pendingStartOfRound', () => recoverPendingStartOfRound(game, gameId, ctx));
  await tryRecover('moveInProgress',      () => recoverMoveInProgress(game, gameId, ctx));
  await tryRecover('roundActivation',     () => recoverRoundActivationMessage(game, gameId, ctx));
  await tryRecover('ccDrawPhase',         () => recoverCcDrawPhase(game, gameId, ctx));
  await tryRecover('pendingCcConfirmation', () => recoverPendingCcConfirmation(game, gameId, ctx));
  await tryRecover('pendingCelebration',    () => recoverPendingCelebration(game, gameId, ctx));
  await tryRecover('pendingPowerToken',     () => recoverPendingPowerTokenGrant(game, gameId, ctx));

  // ── Generic fallback: use available-actions to recover unhandled states ──
  if (results.length === 0 && actionsDiag.length > 0) {
    await tryRecover('genericActions', () => recoverFromAvailableActions(game, gameId, ctx, actionsDiag), 'generic');
  }

  logRecoveryCrossCheck(actionsDiag, results, gameId);
  if (results.length > 0) {
    console.log(`[recover] Game ${gameId}: recovered=${results.length} (specific=${specificCount}, generic=${genericCount})`);
  }
  return results;
}

// ─── Recover: both squads submitted but initiative button never posted ────────

async function recoverBothSquadsReady(game, gameId, ctx) {
  const { client, saveGames } = ctx;

  // Guard: both squads must be submitted
  if (!game.player1Squad || !game.player2Squad) return null;
  // Guard: initiative already determined — no recovery needed
  if (game.initiativeDetermined || game.initiativePlayerId) return null;
  // Guard: game already in active play
  if (game.currentRound > 0) return null;

  // Check if the initiative button already exists in the game log
  if (!game.generalId) return null;
  const generalChannel = await fetchGameChannel(client, game.generalId);
  if (!generalChannel) return null;

  const recentMsgs = await generalChannel.messages.fetch({ limit: 30 });
  const hasInitiativeButton = recentMsgs.some(m =>
    m.author.bot && m.components?.some(row =>
      row.components?.some(c => c.customId?.startsWith('determine_initiative_'))
    )
  );
  if (hasInitiativeButton) return null;

  // Reuse the canonical "both squads ready" flow
  const { postBothSquadsReady } = await import('../game-creation.js');
  await postBothSquadsReady(game, client, {
    createPlayAreaChannels: ctx.createPlayAreaChannels,
    createBoardChannel: ctx.createBoardChannel,
    buildBoardMapPayload: ctx.buildBoardMapPayload,
    populatePlayAreas: ctx.populatePlayAreas,
    getDetermineInitiativeButtons: ctx.getDetermineInitiativeButtons,
  }, { tag: '[Recovered]' });
  if (saveGames) saveGames();
  return 'Re-posted "Both Squads Ready" with initiative button';
}

/**
 * Cross-check: compare available-actions diagnostic with actual recovery results.
 * Logs warnings when available-actions says players need prompts but legacy recovery
 * didn't send any. This helps identify recovery gaps over time.
 */
function logRecoveryCrossCheck(actionsDiag, results, gameId) {
  if (actionsDiag.length > 0 && results.length === 0) {
    console.warn(`[recover] Cross-check: available-actions detected needs for game ${gameId} but legacy recovery sent nothing. Players: ${actionsDiag.map(p => `P${p.playerNum}: ${p.description}`).join('; ')}`);
  }
}

// ─── Step 4: Recover pendingCombat ────────────────────────────────────────────

async function recoverPendingCombat(game, gameId, ctx) {
  if (game.phase !== 'round_active') return null;
  const { client, sendReadyToResolveRolls } = ctx;
  const combat = game.pendingCombat;
  if (!combat?.combatThreadId) return null;

  let thread;
  try {
    thread = await fetchCombatThread(client, combat.combatThreadId);
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
  if (game.phase !== 'round_active') return null;
  const { client, getNegationResponseButtons } = ctx;
  if (!game.pendingNegation) return null;

  const oppNum = opponentPlayerNum(game.pendingNegation.playedBy);
  const handId = getHandChannelId(game, oppNum);
  if (!handId) return null;

  const handCh = await fetchGameChannel(client, handId);
  const buttons = getNegationResponseButtons(gameId);
  await handCh.send({
    content: `**[Recover]** Your opponent played a Command Card. Respond with Negation or let it resolve:`,
    components: [buttons],
  });
  return 'Re-sent negation response buttons';
}

// ─── Step 6: Recover setupAttachmentPhase ─────────────────────────────────────

async function recoverSetupAttachmentPhase(game, gameId, ctx) {
  if (game.phase !== 'attachment') return [];
  const { client } = ctx;
  if (!game.setupAttachmentPhase) return [];

  const results = [];
  for (const pn of [1, 2]) {
    if (game.setupAttachmentConfirmed?.[pn]) continue;

    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    const handCh = await fetchGameChannel(client, handId);

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
  if (game.phase !== 'round_active') return [];
  const { client } = ctx;
  if (!game.pendingEndTurn || Object.keys(game.pendingEndTurn).length === 0) return [];

  const results = [];
  const generalCh = game.generalId ? await fetchGameChannel(client, game.generalId) : null;
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
  if (game.phase !== 'round_active') return null;
  const { client, updateHandChannelMessages } = ctx;
  if (!game.endOfRoundWhoseTurn) return null;

  // Refresh hand channels (includes EOR button)
  await updateHandChannelMessages(game, client);

  // Send reminder in general
  if (game.generalId) {
    const generalCh = await fetchGameChannel(client, game.generalId);
    await generalCh.send({
      content: `**[Recover]** <@${game.endOfRoundWhoseTurn}> — it's your turn in the End of Round window. Click **End 'End of Round' window** in your Hand channel when done.`,
      allowedMentions: { users: [game.endOfRoundWhoseTurn] },
    });
  }
  return 'Re-sent End of Round window reminder';
}

// ─── Step 9: Recover forceVisionPending ───────────────────────────────────────

async function recoverForceVisionPending(game, gameId, ctx) {
  if (game.phase !== 'round_active') return null;
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
  const generalCh = await fetchGameChannel(client, game.generalId);
  await generalCh.send({
    content: `**[Recover]** Force Vision — <@${ownerId}>, choose one of your ready groups to activate next:`,
    components: rows.slice(0, 5),
    allowedMentions: { users: [ownerId] },
  });
  return 'Re-sent Force Vision picker';
}

// ─── Step 10: Recover pendingStartOfRoundResolve ──────────────────────────────

async function recoverPendingStartOfRound(game, gameId, ctx) {
  if (game.phase !== 'round_active') return null;
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
        const handCh = await fetchGameChannel(client, handId);
        const pickBtns = hand.slice(0, 25).map((card, idx) => new ButtonBuilder()
          .setCustomId(`rogue_one_return_${gameId}_${pn}_${idx}`)
          .setLabel(card.length > 80 ? card.slice(0, 77) + '...' : card)
          .setStyle(ButtonStyle.Primary)
        );
        const pickRows = chunkButtonsToRows(pickBtns);
        await handCh.send({
          content: `**[Recover]** Rogue One — Choose a card to place on top of your deck (${roPending.remaining} remaining):`,
          components: pickRows,
        });
      }
    }
  }

  // Always send a fallback end_start_of_round_ button in general
  if (game.generalId) {
    const generalCh = await fetchGameChannel(client, game.generalId);
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
  if (game.phase !== 'round_active') return [];
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

    const ch = await fetchGameChannel(client, channelId);
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
  if (game.phase !== 'round_active') return null;
  const { client } = ctx;
  if (!game.roundActivationMessageId || !game.generalId) return null;
  if (!game.currentRound) return null;

  // Check if message still exists
  let generalCh;
  try {
    generalCh = await fetchGameChannel(client, game.generalId);
    await generalCh.messages.fetch(game.roundActivationMessageId);
    return null; // message exists, no recovery needed
  } catch {
    // Message is gone — re-create using current turn player (not initiative player)
    const activePlayerId = game.currentActivationTurnPlayerId || game.initiativePlayerId;
    const activePlayerNum = activePlayerId === game.player1Id ? 1 : 2;
    const round = game.currentRound;
    if (!generalCh) generalCh = await fetchGameChannel(client, game.generalId);
    const sent = await generalCh.send({
      content: `**[Recover]** <@${activePlayerId}> (**Player ${activePlayerNum}**) **Round ${round}** — Your turn!`,
      allowedMentions: { users: [activePlayerId] },
    });
    game.roundActivationMessageId = sent.id;
    return 'Re-sent round activation message';
  }
}

// ─── Step 13: Recover CC draw phase ──────────────────────────────────────────

async function recoverCcDrawPhase(game, gameId, ctx) {
  const { client } = ctx;
  // Only recover CC draw if we're actually in cc_draw phase (or round_active with undrawn CCs)
  if (game.phase !== 'cc_draw' && game.phase !== 'round_active') return [];
  if (game.player1CcDrawn && game.player2CcDrawn) return [];
  if (!game.p1HandId && !game.p2HandId) return [];

  // Dynamically import to avoid circular deps
  const { getCcShuffleDrawButton } = await import('../discord/components.js');
  const results = [];

  for (const pn of [1, 2]) {
    const drawnKey = pn === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    if (game[drawnKey]) continue;

    const handId = getHandChannelId(game, pn);
    if (!handId) continue;

    const handCh = await fetchGameChannel(client, handId);
    await handCh.send({
      content: `**[Recover]** Shuffle your deck and draw your starting hand:`,
      components: [getCcShuffleDrawButton(gameId)],
    });
    results.push(`Re-sent shuffle/draw button for P${pn}`);
  }
  return results;
}

// ─── Step 1: Recover phaseGate ────────────────────────────────────────────────

async function recoverPhaseGate(game, gameId, ctx) {
  if (!game.phaseGate) return null;
  const { client } = ctx;
  const gate = game.phaseGate;

  // Check if gate messages still exist; re-send if missing
  for (const pn of [1, 2]) {
    const handId = getHandChannelId(game, pn);
    if (!handId) continue;
    const msgId = pn === 1 ? gate.p1MsgId : gate.p2MsgId;
    let msgExists = false;
    if (msgId) {
      try {
        const handCh = await fetchGameChannel(client, handId);
        await handCh.messages.fetch(msgId);
        msgExists = true;
      } catch {}
    }
    if (!msgExists) {
      // Re-send gate message with current ready state
      const handCh = await fetchGameChannel(client, handId);
      const label = (PHASE_GATE_LABELS[gate.phase] || 'Phase gate active')
        .replace('{round}', String(game.currentRound || 1));
      const isReady = pn === 1 ? gate.p1Ready : gate.p2Ready;
      const p1s = gate.p1Ready ? 'P1 ✅' : 'P1 ⏳';
      const p2s = gate.p2Ready ? 'P2 ✅' : 'P2 ⏳';
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`phase_gate_ready_${gameId}`).setLabel('✅ Ready').setStyle(ButtonStyle.Success).setDisabled(isReady),
        new ButtonBuilder().setCustomId(`phase_gate_unready_${gameId}`).setLabel('❌ Not Ready').setStyle(ButtonStyle.Danger).setDisabled(!isReady),
      );
      const newMsg = await handCh.send({
        content: `🔔 ${label}\n${p1s} | ${p2s}`,
        components: [row],
      });
      if (pn === 1) gate.p1MsgId = newMsg.id;
      else gate.p2MsgId = newMsg.id;
    }
  }
  return 'Re-sent phase gate messages';
}

// ─── Step 14: Recover pendingCcConfirmation ───────────────────────────────────

async function recoverPendingCcConfirmation(game, gameId, ctx) {
  if (game.phase !== 'round_active') return null;
  const { client } = ctx;
  const pending = game.pendingCcConfirmation;
  if (!pending) return null;

  const { playerNum, card, ts } = pending;

  // Check 10-minute TTL — if expired, clear state instead of re-sending stale buttons
  const CONFIRM_TTL_MS = 10 * 60 * 1000;
  if (ts && Date.now() - ts > CONFIRM_TTL_MS) {
    delete game.pendingCcConfirmation;
    console.log(`[recover] Cleared expired pendingCcConfirmation (card=${card}, age=${Math.round((Date.now() - ts) / 60000)}m)`);
    return 'Cleared expired CC confirmation (TTL exceeded)';
  }

  const handId = getHandChannelId(game, playerNum);
  if (!handId) return null;

  const handCh = await fetchGameChannel(client, handId);
  if (!handCh) return null;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cc_confirm_play_${gameId}`).setLabel('PLAY CARD').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cc_cancel_play_${gameId}`).setLabel('DO SOMETHING ELSE').setStyle(ButtonStyle.Danger),
  );
  await handCh.send({
    content: `**[Recover]** Play **${card}**?`,
    components: [row],
  }).catch(discordCatch);
  return `Re-sent CC confirmation for P${playerNum}: ${card} [hand]`;
}

// ─── Step 15: Recover pendingCelebration ──────────────────────────────────────

async function recoverPendingCelebration(game, gameId, ctx) {
  if (game.phase !== 'round_active') return null;
  const { client } = ctx;
  const pending = game.pendingCelebration;
  if (!pending) return null;

  const { attackerPlayerNum, combatThreadId } = pending;
  const ownerId = getPlayerId(game, attackerPlayerNum);

  // Try combat thread first (where it was originally sent)
  let targetCh = null;
  if (combatThreadId) {
    try {
      targetCh = await fetchCombatThread(client, combatThreadId);
    } catch { /* thread gone */ }
  }
  // Fall back to general channel
  if (!targetCh && game.generalId) {
    targetCh = await fetchGameChannel(client, game.generalId);
  }
  if (!targetCh) return null;

  // Import getCelebrationButtons from components
  const { getCelebrationButtons } = await import('../discord/components.js');
  await targetCh.send({
    content: `**[Recover]** <@${ownerId}> — You defeated a unique figure. Play **Celebration** to gain 4 VP?`,
    components: [getCelebrationButtons(gameId)],
    allowedMentions: { users: [ownerId] },
  }).catch(discordCatch);
  return `Re-sent Celebration prompt for P${attackerPlayerNum}`;
}

// ─── Step 16: Recover pendingPowerTokenGrant ──────────────────────────────────

async function recoverPendingPowerTokenGrant(game, gameId, ctx) {
  if (game.phase !== 'round_active') return null;
  const { client } = ctx;
  const pending = game.pendingPowerTokenGrant;
  if (!pending || !pending.grants || pending.grants.length === 0) return null;

  const { grants, channelId, playerNum } = pending;
  const ownerId = getPlayerId(game, playerNum);

  // Use stored channelId if available, otherwise fall back to general
  let targetCh = null;
  if (channelId) {
    try {
      targetCh = await fetchGameChannel(client, channelId);
    } catch { /* channel gone */ }
  }
  if (!targetCh && game.generalId) {
    targetCh = await fetchGameChannel(client, game.generalId);
  }
  if (!targetCh) return null;

  const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
  const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
  const countLabel = totalCount > 1 ? `${totalCount} tokens` : '1 token';
  const btns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
    new ButtonBuilder()
      .setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`)
      .setLabel(t)
      .setStyle(ButtonStyle.Secondary)
  );
  await targetCh.send({
    content: `**[Recover]** <@${ownerId}> — **Choose power token type** for **${figNames}** (${countLabel}):`,
    components: [new ActionRowBuilder().addComponents(btns)],
    allowedMentions: { users: [ownerId] },
  }).catch(discordCatch);
  return `Re-sent power token choice for P${playerNum}: ${figNames}`;
}

// ─── Generic fallback: build buttons from available-actions ───────────────────

/**
 * When no specific recovery handler found anything, but available-actions says
 * players have legal actions, build generic button prompts from those actions.
 * This covers ~30 pending sub-states (pendingCoverFire, pendingCcConfirmation,
 * pendingStrainChoice, etc.) without needing a specific handler for each.
 *
 * @param {object} game
 * @param {string} gameId
 * @param {object} ctx
 * @param {Array<{ playerNum: number, playerId: string, actions: object[], description: string }>} actionsDiag
 * @returns {string[]|null}
 */
/**
 * Determine whether this player's recovery prompt should go to their hand
 * channel (true) or the general channel (false).
 */
function shouldRouteToHand(game, playerNum) {
  // Check CC pending states that are owned by this player
  if (game.pendingCcConfirmation && game.pendingCcConfirmation.playerNum === playerNum) return true;
  if (game.pendingCcChoice && game.pendingCcChoice.playerNum === playerNum) return true;
  if (game.pendingCcSpaceChoice && game.pendingCcSpaceChoice.playerNum === playerNum) return true;
  return false;
}

async function recoverFromAvailableActions(game, gameId, ctx, actionsDiag) {
  const { client } = ctx;
  if (!actionsDiag || actionsDiag.length === 0) return null;
  if (!game.generalId) return null;

  const generalCh = await fetchGameChannel(client, game.generalId);
  if (!generalCh) return null;

  const results = [];
  for (const diag of actionsDiag) {
    const { playerNum, playerId, actions, description } = diag;
    if (!actions || actions.length === 0) continue;

    // Build buttons from actions (cap at 25 = 5 rows × 5)
    const btns = [];
    for (const action of actions.slice(0, 25)) {
      if (!action.customId) continue;
      // Use description as label, truncate to Discord's 80 char limit
      const label = (action.description || action.type || 'Action').slice(0, 80);
      btns.push(
        new ButtonBuilder()
          .setCustomId(action.customId)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (btns.length === 0) continue;

    const rows = chunkButtonsToRows(btns);

    // Route CC-related states to hand channel; everything else to general
    const useHand = shouldRouteToHand(game, playerNum);
    let targetCh = generalCh;
    let channelNote = '';
    if (useHand) {
      const handId = getHandChannelId(game, playerNum);
      if (handId) {
        const handCh = await fetchGameChannel(client, handId);
        if (handCh) {
          targetCh = handCh;
          channelNote = ' [hand]';
        }
      }
    }

    await targetCh.send({
      content: `**[Recover]** <@${playerId}> (**Player ${playerNum}**) — ${description}:`,
      components: rows,
      allowedMentions: { users: [playerId] },
    }).catch(discordCatch);
    results.push(`Generic recovery for P${playerNum}: ${description}${channelNote}`);
  }
  return results.length > 0 ? results : null;
}
