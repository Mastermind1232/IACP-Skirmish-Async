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
      await refreshDcEmbedAndComponents(client, game, id, ctx, { exhausted: false, errorContext: 'Failed to update DC embed after ready:' });
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
      await refreshDcEmbedAndComponents(client, game, id, ctx, { exhausted, errorContext: 'Failed to refresh DC play area embed:' });
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
  // Slice 6.13 ext (destruct 2026-05-06): two complementary sources of
  // pending defeats:
  //   1. result.defeatedFigures — handlers that explicitly collect lethal
  //      hits during damage application (per-site retrofit pattern from
  //      slice 6.13 ext commits).
  //   2. game._pendingFigureDefeats — queue populated automatically by
  //      applyDamageWithDefeatCheck. New damage call sites should use that
  //      helper and the queue drains here without the caller plumbing
  //      defeatedFigures explicitly.
  // Dedupe by figureKey to avoid double-firing if a site happens to do both.
  const _seenDefeats = new Set();
  const _pendingFromQueue = (game._pendingFigureDefeats || []).slice();
  if (Array.isArray(_pendingFromQueue) && _pendingFromQueue.length > 0) {
    game._pendingFigureDefeats = [];
  }
  const _allDefeats = [
    ...(result.applied && result.defeatedFigures ? result.defeatedFigures : []),
    ..._pendingFromQueue,
  ];
  if (_allDefeats.length && ctx.processFigureDefeat) {
    for (const df of _allDefeats) {
      if (!df || !df.figureKey) continue;
      if (_seenDefeats.has(df.figureKey)) continue;
      _seenDefeats.add(df.figureKey);
      await ctx.processFigureDefeat(game, {
        defeatedPlayerNum: df.defeatedPlayerNum,
        figureKey: df.figureKey,
        attackerPlayerNum: df.attackerPlayerNum,
        source: df.source || '',
      });
    }
  }

  // --- Granted attack button (Emperor / Executive Order / Battlefield Leadership / Order Hit) ---
  // Per destruct 2026-05-07: granted attacks fire IMMEDIATELY in the source's
  // activation thread; clicking spawns a new combat thread for the grantee.
  // Source's activation pauses until grantee combat resolves. The button
  // wraps the existing dc_attack_ flow and the underlying pendingX state
  // (pendingEmperorInterrupt / pendingExecutiveOrder / etc.) is what marks
  // the attack as free in combat.js. See handleGrantedAttack.
  if (result.applied && result.grantedAttackButton) {
    const { granteeMsgId, granteeFigureKey, granteeName, sourceLabel } = result.grantedAttackButton;
    if (granteeMsgId && granteeFigureKey && msgId) {
      try {
        const _gabModule = await import('discord.js');
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = _gabModule;
        const _gabFkMatch = String(granteeFigureKey).match(/-(\d+)-(\d+)$/);
        const _gabFigIdx = _gabFkMatch ? _gabFkMatch[2] : '0';
        const _gabBtn = new ButtonBuilder()
          .setCustomId(`granted_attack_${game.gameId}_${granteeMsgId}_f${_gabFigIdx}`)
          .setLabel(`Declare Attack (${granteeName || 'grantee'})`)
          .setStyle(ButtonStyle.Primary);
        const _gabRow = new ActionRowBuilder().addComponents(_gabBtn);
        const data = game.dcActionsData?.[msgId];
        if (data?.threadId) {
          const thread = await fetchGameChannel(client, data.threadId);
          if (thread) {
            await withDiscordRetry(() => thread.send({
              content: enforceContentLimit(`\u{2694}\u{FE0F} **${sourceLabel || 'Granted Attack'}** — click below to declare the granted attack with **${granteeName || 'the grantee'}**. A new combat thread will open.`),
              components: [_gabRow],
            })).catch(discordCatch);
          }
        }
      } catch (err) {
        console.error('Failed to post granted-attack button:', err);
      }
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
