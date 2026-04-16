/**
 * Message updater functions extracted from index.js.
 * Each function takes an explicit `deps` parameter for closed-over dependencies.
 */
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';

/**
 * Update the Play Area "Attachments" message for a DC (CC + DC Skirmish Upgrade attachments).
 * Creates the message on demand when first attachment is added; deletes when last is removed.
 */
export async function updateAttachmentMessageForDc(game, playerNum, dcMsgId, client, deps) {
  const ccKey = deps.ccAttachmentsKey(playerNum);
  const dcKey = deps.dcAttachmentsKey(playerNum);
  const msgIds = deps.getDcMessageIds(game, playerNum) || [];
  const attachMsgIdsKey = deps.dcAttachmentMessageIdsKey(playerNum);
  game[attachMsgIdsKey] = game[attachMsgIdsKey] || [];
  const attachMsgIds = game[attachMsgIdsKey];
  const idx = msgIds.indexOf(dcMsgId);
  if (idx < 0) return;
  while (attachMsgIds.length <= idx) attachMsgIds.push(null);
  const attachMsgId = attachMsgIds[idx];
  const channelId = deps.getPlayAreaId(game, playerNum);
  const ccList = (game[ccKey] || {})[dcMsgId] || [];
  const dcList = (game[dcKey] || {})[dcMsgId] || [];
  const hasContent = ccList.length > 0 || dcList.length > 0;
  const dcDisplayName = deps.dcMessageMeta.get(dcMsgId)?.displayName || null;
  try {
    const channel = await fetchGameChannel(client, channelId);
    if (!attachMsgId) {
      if (!hasContent) return;
      const { embeds, files } = await deps.buildAttachmentEmbedsAndFiles(ccList, dcList, dcDisplayName);
      const newMsg = await channel.send({ embeds, files });
      attachMsgIds[idx] = newMsg.id;
      return;
    }
    if (!hasContent) {
      const msg = await channel.messages.fetch(attachMsgId);
      await msg.delete().catch(deps.discordCatch);
      attachMsgIds[idx] = null;
      return;
    }
    const msg = await channel.messages.fetch(attachMsgId);
    const { embeds, files } = await deps.buildAttachmentEmbedsAndFiles(ccList, dcList, dcDisplayName);
    await msg.edit({ embeds, files });
  } catch (err) {
    console.error('Failed to update attachment message for DC:', err);
  }
}

/** Delete move-grid messages for a given moveKey. */
export async function clearMoveGridMessages(game, moveKey, channel) {
  if (!channel) return;
  const ids = game.moveGridMessageIds?.[moveKey] || [];
  for (const id of ids) {
    try {
      const msg = await channel.messages.fetch(id);
      await msg.delete();
    } catch {
      // ignore missing messages
    }
  }
  if (game.moveGridMessageIds) delete game.moveGridMessageIds[moveKey];
}

/** Edit the distance message in a movement thread. */
export async function editDistanceMessage(moveState, channel, content, components) {
  if (!moveState?.distanceMessageId || !channel) return;
  try {
    const msg = await channel.messages.fetch(moveState.distanceMessageId);
    await msg.edit({ content, components });
  } catch {
    // ignore
  }
}

/** Update (or delete) the movement bank message in a thread. */
export async function updateMovementBankMessage(game, msgId, client, deps) {
  const bank = game.movementBank?.[msgId];
  if (!bank) return;
  const { threadId, messageId, remaining, total, displayName } = bank;
  if (!threadId) return;
  try {
    if (remaining <= 0 && messageId) {
      const thread = await fetchGameChannel(client, threadId);
      const msg = await thread.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete().catch(deps.discordCatch);
      bank.messageId = null;
      return;
    }
    if (!messageId) return;
    const thread = await fetchGameChannel(client, threadId);
    const msg = await thread.messages.fetch(messageId);
    await msg.edit({ content: deps.getMovementBankText(displayName, remaining, total) });
  } catch {}
}

/** Ensure a movement bank message exists; create one if missing. */
export async function ensureMovementBankMessage(game, msgId, client, deps) {
  const bank = game.movementBank?.[msgId];
  if (!bank) return null;
  if (bank.messageId) return bank;
  if (!bank.threadId) return bank;
  try {
    const thread = await fetchGameChannel(client, bank.threadId);
    const msg = await thread.send({ content: deps.getMovementBankText(bank.displayName, bank.remaining, bank.total) });
    bank.messageId = msg.id;
  } catch (err) {
    console.error('Failed to create movement bank message:', err);
  }
  return bank;
}

/** Update the DC thread's Actions message with current counter. If all actions exhausted, @ the other player to activate. */
export async function updateDcActionsMessage(game, msgId, client, deps) {
  const data = game.dcActionsData?.[msgId];
  if (!data?.threadId) return;
  const meta = deps.dcMessageMeta.get(msgId);
  const displayName = meta?.displayName || meta?.dcName || '';

  if (data?.messageId) {
    try {
      const thread = await fetchGameChannel(client, data.threadId);
      const msg = await thread.messages.fetch(data.messageId);
      const components = meta && game ? deps.getDcActionButtons(msgId, meta.dcName, displayName, data, game) : [];
      const editPayload = {
        content: deps.getActionsCounterContent(data.remaining, data.total),
        components,
      };
      const actMinimap = await deps.getActivationMinimapAttachment(game, msgId);
      if (actMinimap) {
        editPayload.files = [actMinimap];
        editPayload.attachments = []; // replace old minimap image rather than accumulating
      }
      await msg.edit(editPayload).catch(deps.discordCatch);
    } catch (err) {
      console.error('Failed to update DC actions message:', err);
    }
  }
  // P4/P5: Refresh the DC embed in the play area with live action count + power tokens
  if (meta && game) {
    try {
      const _chId = deps.getPlayAreaId(game, meta.playerNum);
      const _ch = await fetchGameChannel(client, _chId);
      const _dcMsg = await _ch.messages.fetch(msgId);
      const { embed: _emb, files: _files } = await deps.renderDcEmbed(game, msgId, deps, { exhausted: true, actionsData: data });
      const _comps = deps.getDcPlayAreaComponents(msgId, true, game, meta.dcName);
      await _dcMsg.edit({ embeds: [_emb], files: _files, components: _comps }).catch(deps.discordCatch);
    } catch (_err) {
      console.error('Failed to update DC embed with action count/tokens:', _err);
    }
  }

  // Defer End Activation prompt while combat is resolving — it will re-trigger after finishCombatResolution
  if (data?.remaining === 0 && meta && !game.pendingCombat) {
    game.dcFinishedPinged = game.dcFinishedPinged || {};
    if (!game.dcFinishedPinged[msgId] && !game.pendingEndTurn?.[msgId]) {
      const ownerId = deps.getPlayerId(game, meta.playerNum);
      const initPlayerNum = meta.playerNum;
      try {
        const ch = await fetchGameChannel(client, game.generalId);
        const icon = deps.ACTION_ICONS.activate || '\u26A1';
        const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
        await ch.send(sanitizeMentions({
          content: `${icon} ${timestamp} — <@${ownerId}> (**Player ${initPlayerNum}**) **${displayName}** finished all actions. Press **End Activation** in the activation thread when ready.`,
          allowedMentions: { users: [ownerId] },
        }));
        game.dcFinishedPinged[msgId] = true;
      } catch (err) {
        console.error('Failed to send End Activation prompt:', err);
      }
    }
  }
}

/** Edit the round message to add the End Activation Phase button when conditions are met. */
export async function maybeShowEndActivationPhaseButton(game, client, deps) {
  const gameId = game.gameId;
  if (!deps.shouldShowEndActivationPhaseButton(game, gameId)) return;
  if (game.roundActivationButtonShown) return;
    const roundMsgId = game.roundActivationMessageId;
  if (!roundMsgId || !game.generalId) return;
  try {
    const ch = await fetchGameChannel(client, game.generalId);
    const msg = await ch.messages.fetch(roundMsgId);
    const round = game.currentRound || 1;
    const roundEmbed = new deps.EmbedBuilder()
      .setTitle(`${deps.GAME_PHASES.ROUND.emoji}  ROUND ${round} - Activation Phase`)
      .setColor(deps.PHASE_COLOR);
    const endBtn = new deps.ActionRowBuilder().addComponents(
      new deps.ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(deps.ButtonStyle.Secondary)
    );
    const initPlayerNum = deps.getInitiativePlayerNum(game);
    const initZone = deps.getInitiativePlayerZoneLabel(game);
    await msg.edit(sanitizeMentions({
      content: `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Both players have used all activations and actions. Both players: click **End R${round} Activation Phase** when done with any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
      allowedMentions: { users: [game.initiativePlayerId] },
    })).catch(deps.discordCatch);
    game.roundActivationButtonShown = true;
    deps.saveGames();
  } catch (err) {
    console.error('Failed to show End Activation Phase button:', err);
  }
}

/** Update both Hand channel messages (for window buttons). Call when entering/exiting Start or End of Round window. */
export async function updateHandChannelMessages(game, client, deps) {
  for (const pn of [1, 2]) {
    const hand = deps.getCcHand(game, pn) || [];
    const deck = deps.getCcDeck(game, pn) || [];
    const handId = deps.getHandChannelId(game, pn);
    if (!handId) continue;
    try {
      const handCh = await fetchGameChannel(client, handId);
      // Try stored message ID first (reliable path)
      const storedMsgId = pn === 1 ? game.p1HandMessageId : game.p2HandMessageId;
      let handMsg = null;
      if (storedMsgId) {
        handMsg = await handCh.messages.fetch(storedMsgId).catch(() => null);
      }
      // Fallback: heuristic search with raised limit for legacy games
      if (!handMsg) {
        const msgs = await handCh.messages.fetch({ limit: 50 });
        handMsg = msgs.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
        // Repair: store the found ID for future fetches
        if (handMsg) {
          if (pn === 1) game.p1HandMessageId = handMsg.id;
          else game.p2HandMessageId = handMsg.id;
        }
      }
      if (handMsg) {
        const payload = deps.buildHandDisplayPayload(hand, deck, game.gameId, game, pn);
        await handMsg.edit({ content: payload.content, embeds: payload.embeds, files: payload.files || [], components: payload.components }).catch(deps.discordCatch);
      }
    } catch (err) {
      console.error('Failed to update hand channel message:', err);
    }
  }
}

/** Call after changing player1CcHand/player2CcHand to refresh the Play Area hand visual. */
export async function updateHandVisualMessage(game, playerNum, client, deps) {
  const msgId = playerNum === 1 ? game.p1HandVisualMessageId : game.p2HandVisualMessageId;
  const hand = deps.getCcHand(game, playerNum) || [];
  if (msgId == null) return;
  try {
    const channelId = deps.getPlayAreaId(game, playerNum);
    const channel = await fetchGameChannel(client, channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit({ embeds: [deps.getHandVisualEmbed(hand.length)] });
  } catch (err) {
    console.error('Failed to update hand visual message:', err);
  }
}

/** Call after changing discard pile to refresh the Play Area discard embed and buttons. */
export async function updateDiscardPileMessage(game, playerNum, client, deps) {
  const msgId = playerNum === 1 ? game.p1DiscardPileMessageId : game.p2DiscardPileMessageId;
  if (msgId == null) return;
  const discard = deps.getCcDiscard(game, playerNum) || [];
  const threadId = deps.getDiscardThreadId(game, playerNum);
  const hasOpenThread = !!threadId;
  try {
    const channelId = deps.getPlayAreaId(game, playerNum);
    const channel = await fetchGameChannel(client, channelId);
    const msg = await channel.messages.fetch(msgId);
    await msg.edit({
      embeds: [deps.getDiscardPileEmbed(discard.length)],
      components: [deps.getDiscardPileButtons(game.gameId, playerNum, hasOpenThread)],
    });
  } catch (err) {
    console.error('Failed to update discard pile message:', err);
  }
}

/** Update all DC messages in both Play Areas to show Activate buttons (when both players have drawn). */
export async function updatePlayAreaDcButtons(game, client, deps) {
  if (!game.player1CcDrawn || !game.player2CcDrawn) return;
  for (const playerNum of [1, 2]) {
    const msgIds = deps.getDcMessageIds(game, playerNum) || [];
    const channelId = deps.getPlayAreaId(game, playerNum);
    if (!channelId || msgIds.length === 0) continue;
    try {
      const channel = await fetchGameChannel(client, channelId);
      for (const msgId of msgIds) {
        const meta = deps.dcMessageMeta.get(msgId);
        if (!meta || meta.gameId !== game.gameId) continue;
        if (deps.isDepletedRemovedFromGame(game, msgId)) continue;
        const exhausted = deps.dcExhaustedState.get(msgId) ?? false;
        const components = deps.getDcPlayAreaComponents(msgId, exhausted, game, meta.dcName);
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ components }).catch(deps.discordCatch);
      }
    } catch (err) {
      console.error('Failed to update Play Area DC buttons:', err);
    }
  }
}

/** Full refresh of all game messages (board, DC embeds, companions, hands, discard). */
export async function refreshAllGameComponents(game, client, deps) {
  await deps.reloadGameData();
  const gameId = game.gameId;

  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      const payload = await deps.buildBoardMapPayload(gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Refresh All: board failed', err);
    }
  }

  const allDcMsgIds = [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])];
  for (const msgId of allDcMsgIds) {
    const meta = deps.dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) continue;
    if (deps.isDepletedRemovedFromGame(game, msgId)) continue;
    const exhausted = deps.dcExhaustedState.get(msgId) ?? false;
    const displayName = meta.displayName || meta.dcName;
    let healthState = deps.dcHealthState.get(msgId) ?? [];
    const stats = deps.getDcStats(meta.dcName);
    const figureless = deps.isFigurelessDc(meta.dcName);
    if (!figureless && stats.health != null) {
      const figures = stats.figures ?? 1;
      healthState = Array.from({ length: figures }, (_, i) => {
        const existing = healthState[i];
        const cur = existing?.[0] != null ? existing[0] : stats.health;
        const max = existing?.[1] != null ? existing[1] : stats.health;
        return [cur, max];
      });
      deps.dcHealthState.set(msgId, healthState);
    }
    try {
      const channelId = deps.getPlayAreaId(game, meta.playerNum);
      const channel = await fetchGameChannel(client, channelId);
      const msg = await channel.messages.fetch(msgId);
      const { embed, files } = await deps.renderDcEmbed(game, msgId, deps);
      const components = deps.getDcPlayAreaComponents(msgId, exhausted, game, meta.dcName);
      await msg.edit({ embeds: [embed], files: files?.length ? files : [], components });
    } catch (err) {
      console.error('Refresh All: DC message failed', msgId, err);
    }
  }

  // Update Companion embeds from dc-effects (so figure DC companions show after edit + Refresh All)
  const p1PlayAreaId = game.p1PlayAreaId;
  const p2PlayAreaId = game.p2PlayAreaId;
  const p1CompanionIds = game.p1DcCompanionMessageIds || [];
  const p2CompanionIds = game.p2DcCompanionMessageIds || [];
  const p1DcList = game.p1DcList || [];
  const p2DcList = game.p2DcList || [];
  for (let i = 0; i < p1CompanionIds.length; i++) {
    if (!p1CompanionIds[i]) continue;
    const dcName = p1DcList[i]?.dcName;
    if (!dcName) continue;
    try {
      const ch = await fetchGameChannel(client, p1PlayAreaId);
      const companionMsg = await ch.messages.fetch(p1CompanionIds[i]);
      const desc = deps.getCompanionDescriptionForDc(dcName);
      await companionMsg.edit({ embeds: [new deps.EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(deps.COLORS.DARK_EMBED)] });
    } catch (err) {
      console.error('Refresh All: P1 companion message failed', p1CompanionIds[i], err);
    }
  }
  for (let i = 0; i < p2CompanionIds.length; i++) {
    if (!p2CompanionIds[i]) continue;
    const dcName = p2DcList[i]?.dcName;
    if (!dcName) continue;
    try {
      const ch = await fetchGameChannel(client, p2PlayAreaId);
      const companionMsg = await ch.messages.fetch(p2CompanionIds[i]);
      const desc = deps.getCompanionDescriptionForDc(dcName);
      await companionMsg.edit({ embeds: [new deps.EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(deps.COLORS.DARK_EMBED)] });
    } catch (err) {
      console.error('Refresh All: P2 companion message failed', p2CompanionIds[i], err);
    }
  }

  // Refresh any active activation threads (dcActionsData)
  if (game.dcActionsData) {
    for (const msgId of Object.keys(game.dcActionsData)) {
      const data = game.dcActionsData[msgId];
      if (!data?.threadId) continue;
      try {
        await updateDcActionsMessage(game, msgId, client, deps);
      } catch (err) {
        console.error('Refresh All: activation thread failed', msgId, err);
      }
    }
  }

  // Recompute activation counts from board state (single source of truth)
  for (const pn of [1, 2]) {
    deps.recomputeActivationCounts(game, pn);
    if (deps.updateActivationsMessage) {
      await deps.updateActivationsMessage(game, pn, client);
    }
  }

  await updateHandChannelMessages(game, client, deps);
  for (const pn of [1, 2]) {
    await updateHandVisualMessage(game, pn, client, deps);
    await updateDiscardPileMessage(game, pn, client, deps);
  }

  // Reconcile narrow set of tracked prompts (Walker/massive-push recovery path).
  // Deletes stale tracked prompts and re-posts missing ones from game state.
  try {
    const { reconcilePrompts } = await import('./prompt-reconciler.js');
    await reconcilePrompts(game, gameId, client, deps);
  } catch (err) {
    console.error('Refresh All: prompt reconcile failed', err);
  }

  // CC-draw safety net: if post-deploy finished but CC shuffle/draw prompts were
  // never posted (e.g. bot restart dropped the in-memory completion callback),
  // post them now from pure game state. Idempotent via ccShuffleDrawPromptsPosted.
  try {
    if (
      game.phase === 'cc_draw'
      && game.postDeployEffectsFired
      && !game.ccShuffleDrawPromptsPosted
      && !(game.player1CcDrawn && game.player2CcDrawn)
      && deps.getCcShuffleDrawButton
      && deps.getInitiativePlayerZoneLabel
    ) {
      const { sendCcShuffleDrawPrompts } = await import('./cc-draw-prompts.js');
      await sendCcShuffleDrawPrompts(game, client, {
        getCcShuffleDrawButton: deps.getCcShuffleDrawButton,
        getInitiativePlayerZoneLabel: deps.getInitiativePlayerZoneLabel,
        saveGames: deps.saveGames,
      });
    }
  } catch (err) {
    console.error('Refresh All: CC-draw safety net failed', err);
  }

  // Draft Random activation-phase safety net: Draft Random enters
  // ROUND_ACTIVE/START_OF_ROUND, then runs post-deploy and (via an in-memory
  // callback) transitions to ACTIVATION + posts the round activation message.
  // If a restart dropped that callback after post-deploy effects fired, the
  // game stalls here. Re-post the activation message from pure state.
  // Idempotent via activationPhaseMessagePosted.
  try {
    if (
      game.phase === 'round_active'
      && game.roundPhase === 'start_of_round'
      && game.postDeployEffectsFired
      && !game.activationPhaseMessagePosted
      && deps.sendRoundActivationPhaseMessage
      && deps.setRoundPhase
      && deps.ROUND_PHASES
    ) {
      deps.setRoundPhase(game, deps.ROUND_PHASES.ACTIVATION);
      await deps.sendRoundActivationPhaseMessage(game, client);
      if (deps.saveGames) deps.saveGames();
    }
  } catch (err) {
    console.error('Refresh All: activation-phase safety net failed', err);
  }
}
