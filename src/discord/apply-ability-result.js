import { getPlayAreaId, opponentPlayerNum } from '../game/player-helpers.js';
import { enforceContentLimit } from './limits.js';
import { withDiscordRetry, discordCatch } from '../error-handling.js';
import { fetchGameChannel } from './channel-helpers.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';

/**
 * Local alias to the canonical updater. Older call sites in this file
 * use `refreshDcEmbedAndComponents` — the engine-layer helper has the
 * same shape, so this is a thin pass-through. Future migrations should
 * call `updateDcCardMessage` directly.
 */
const refreshDcEmbedAndComponents = updateDcCardMessage;

/**
 * Unified handler for resolveAbility() result fields.
 * Ensures ALL CC play paths (hand, DC thread, negation, space-pick, choice) handle
 * every result field identically — no more "field handled in one path but not another" bugs.
 *
 * Callers still own: hand mutation, discard, card image log, pendingNegation, undo push,
 * requiresChoice button send, requiresSpaceChoice button send.
 *
 * @param {object} result - returned by resolveAbility()
 * @param {object} opts
 * @param {object} opts.game
 * @param {number} opts.playerNum - 1 or 2
 * @param {string} [opts.msgId] - DC message ID when played from activation thread
 * @param {import('discord.js').Client} opts.client
 * @param {object} opts.ctx - full handler context with all helper functions
 * @returns {{ handled: boolean, requiresChoice: boolean, requiresSpaceChoice: boolean }}
 */
export async function applyAbilityResult(result, opts) {
  const { game, playerNum, msgId, client, ctx } = opts;
  const {
    logGameAction,
    updateHandVisualMessage,
    updateDiscardPileMessage,
    updateDcActionsMessage,
    ensureMovementBankMessage,
    updateMovementBankMessage,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    renderDcEmbed,
    getDcPlayAreaComponents,
    buildBoardMapPayload,
    getConditionCardPath,
  } = ctx;

  // --- Unhandled routing: caller must set up pendingCcChoice/pendingCcSpaceChoice themselves ---
  if (!result.applied && result.requiresChoice && result.choiceOptions?.length > 0) {
    return { handled: false, requiresChoice: true, requiresSpaceChoice: false };
  }
  if (!result.applied && result.requiresSpaceChoice && result.validSpaces?.length > 0) {
    return { handled: false, requiresChoice: false, requiresSpaceChoice: true };
  }

  // --- Ready figures: unexhaust and rebuild DC embed ---
  if (result.applied && result.readyDcMsgIds?.length && dcExhaustedState) {
    for (const id of result.readyDcMsgIds) {
      dcExhaustedState.set(id, false);
      await refreshDcEmbedAndComponents(client, game, id, ctx, false, 'Failed to update DC embed after ready:');
    }
  }

  // --- Drew cards (refresh both players' hands since draw effects can affect either) ---
  if (result.applied && result.drewCards?.length) {
    if (updateHandVisualMessage) {
      await updateHandVisualMessage(game, 1, client);
      await updateHandVisualMessage(game, 2, client);
    }
    const drewList = result.drewCards.map((c) => `**${c}**`).join(', ');
    if (logGameAction) {
      await logGameAction(game, client, `CC effect: Drew ${drewList}.`, { phase: 'ACTION', icon: 'card' });
    }
  }

  // --- Log message (applied) ---
  if (result.applied && result.logMessage && !result.drewCards?.length) {
    if (logGameAction) {
      await logGameAction(game, client, `CC effect: ${result.logMessage}`, { phase: 'ACTION', icon: 'card' });
    }
  }

  // --- Manual message (not applied) ---
  if (!result.applied && result.manualMessage) {
    if (logGameAction) {
      await logGameAction(game, client, `CC effect: ${result.manualMessage}`, { phase: 'ACTION', icon: 'card' });
    }
  }

  // --- Refresh player hand / discard ---
  if (result.applied && result.refreshHand && updateHandVisualMessage) {
    await updateHandVisualMessage(game, playerNum, client);
  }
  if (result.applied && result.refreshDiscard && updateDiscardPileMessage) {
    await updateDiscardPileMessage(game, playerNum, client);
  }

  // --- Refresh opponent discard ---
  if (result.applied && result.refreshOpponentDiscard && updateDiscardPileMessage) {
    const oppNum = opponentPlayerNum(playerNum);
    await updateDiscardPileMessage(game, oppNum, client);
  }

  // --- Refresh DC embed ---
  if (result.applied && result.refreshDcEmbed && updateDcActionsMessage) {
    const idsToRefresh = [...(result.refreshDcEmbedMsgIds || []), ...(result.readyDcMsgIds || [])];
    // Always include the activating DC's own message if played from DC thread
    if (msgId && !idsToRefresh.includes(msgId)) idsToRefresh.push(msgId);
    const seen = new Set();
    for (const id of idsToRefresh) {
      if (seen.has(id)) continue;
      seen.add(id);
      await updateDcActionsMessage(game, id, client).catch(discordCatch);
    }
    // Also rebuild the DC play area embed for each refreshed ID so conditions/health show up there too.
    // readyDcMsgIds already rebuilds with exhausted=false; here we rebuild with the current exhausted state.
    const readySet = new Set(result.readyDcMsgIds || []);
    for (const id of idsToRefresh) {
      if (readySet.has(id)) continue; // already handled by readyDcMsgIds section above
      const exhausted = dcExhaustedState?.get(id) || false;
      await refreshDcEmbedAndComponents(client, game, id, ctx, exhausted, 'Failed to refresh DC play area embed:');
    }
  }

  // --- Refresh movement bank ---
  if (result.applied && result.refreshMovementBank && result.activeMsgId) {
    if (ensureMovementBankMessage) {
      await ensureMovementBankMessage(game, result.activeMsgId, client).catch(discordCatch);
    }
    if (updateMovementBankMessage) {
      await updateMovementBankMessage(game, result.activeMsgId, client).catch(discordCatch);
    }
  }

  // --- Refresh board map (e.g. after token placement) ---
  if (result.applied && result.refreshBoard && game.boardId && game.selectedMap && buildBoardMapPayload) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      if (!boardChannel) throw new Error('Board channel not found');
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to refresh board after CC effect:', err);
    }
  }

  // --- Notify DC activation thread of conditions/effects (new message, not just minimap update) ---
  if (result.applied && result.refreshDcEmbed && result.logMessage) {
    const idsToNotify = [...new Set([...(result.refreshDcEmbedMsgIds || []), ...(msgId ? [msgId] : [])])];
    for (const id of idsToNotify) {
      const data = game.dcActionsData?.[id];
      if (!data?.threadId) continue;
      try {
        const thread = await fetchGameChannel(client, data.threadId);
        if (!thread) continue;
        await withDiscordRetry(() => thread.send({ content: enforceContentLimit(`💡 ${result.logMessage}`) })).catch(discordCatch);
      } catch (err) {
        console.error('Failed to send CC effect to DC thread:', err);
      }
    }
  }

  // --- Process figure defeats routed through processFigureDefeat pipeline ---
  if (result.applied && result.defeatedFigures?.length && ctx.processFigureDefeat) {
    for (const df of result.defeatedFigures) {
      await ctx.processFigureDefeat(game, {
        defeatedPlayerNum: df.defeatedPlayerNum,
        figureKey: df.figureKey,
        attackerPlayerNum: df.attackerPlayerNum,
        source: df.source || '',
      });
    }
  }

  // --- Post condition card images to game log ---
  if (result.applied && result.conditionCardsToPost?.length && getConditionCardPath && logGameAction) {
    const seen = new Set();
    for (const cond of result.conditionCardsToPost) {
      if (seen.has(cond)) continue;
      seen.add(cond);
      const imgPath = getConditionCardPath(cond);
      if (imgPath) {
        await logGameAction(game, client, `📋 **${cond}** condition card:`, { phase: 'ACTION', icon: 'card', files: [imgPath] }).catch(discordCatch);
      }
    }
  }

  return { handled: true, requiresChoice: false, requiresSpaceChoice: false };
}
