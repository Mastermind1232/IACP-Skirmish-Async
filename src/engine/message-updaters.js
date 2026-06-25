/**
 * Message updater functions extracted from index.js.
 * Each function takes an explicit `deps` parameter for closed-over dependencies.
 */
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { isActivationActionInProgress, figureActionsRemaining } from '../game/activation-state.js';
import { DC_ACTIONS_PER_ACTIVATION } from '../discord/messages.js';
import { withDiscordRetry, discordCatch } from '../error-handling.js';
import { getPlayAreaId } from '../game/player-helpers.js';
import { groupEffectiveFigures, groupSuFigureHealth } from '../game/squad-upgrades.js';
import { getMovementBankForFigure } from '../game/game-helpers.js';
import { runWithLimit, DISCORD_REFRESH_CONCURRENCY } from '../utils/concurrency.js';

/**
 * Re-fetch a DC's Play Area message and rewrite its embed + components.
 *
 * Single source of truth for "DC card refresh after side-effect" — shared
 * by ready/un-exhaust paths, end-of-turn exhaust, ability triggers, and
 * health/condition stat refreshes.
 *
 * @param {object} opts
 * @param {boolean} [opts.exhausted] - Override exhausted state. When omitted,
 *   reads current state from `ctx.dcExhaustedState`. Pass explicitly only
 *   when transitioning state (e.g. exhausting a DC that's still readied).
 * @param {string} [opts.dcName] - Override dcName for component rendering.
 *   Used for synthetic DCs like Imperial Citadel where meta.dcName ≠ the
 *   label `getDcPlayAreaComponents` expects.
 * @param {string} [opts.errorContext] - Custom error message prefix on failure.
 */
export async function updateDcCardMessage(client, game, msgId, ctx, opts = {}) {
  const { dcMessageMeta, dcExhaustedState, renderDcEmbed, getDcPlayAreaComponents } = ctx;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta || !renderDcEmbed || !getDcPlayAreaComponents) return;
  const exhausted = opts.exhausted !== undefined
    ? opts.exhausted
    : (dcExhaustedState?.get(msgId) ?? false);
  const dcName = opts.dcName ?? meta.dcName;
  try {
    const chId = getPlayAreaId(game, meta.playerNum);
    const ch = await fetchGameChannel(client, chId);
    if (!ch) return;
    const msg = await ch.messages.fetch(msgId);
    const { embed, files } = await renderDcEmbed(game, msgId, ctx, { exhausted });
    const components = getDcPlayAreaComponents(msgId, exhausted, game, dcName);
    await withDiscordRetry(() => msg.edit({ embeds: [embed], files, components })).catch(discordCatch);
  } catch (err) {
    console.error(opts.errorContext || 'updateDcCardMessage failed:', err);
  }
}

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
      // alexanbv 2026-06-23: keep message (no delete) for traceability
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
  // alexanbv 2026-06-23: keep message (no delete) for traceability
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
  const { threadId, messageId, displayName } = bank;
  const _figIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
  const _figBank = getMovementBankForFigure(game, msgId, _figIdx);
  const remaining = _figBank?.remaining ?? 0;
  const total = _figBank?.total ?? 0;
  if (!threadId) return;
  try {
    if (remaining <= 0 && messageId) {
      // alexanbv 2026-06-23: keep message (no delete) for traceability
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
    const _figIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _figBank = getMovementBankForFigure(game, msgId, _figIdx);
    const msg = await thread.send({ content: deps.getMovementBankText(bank.displayName, _figBank?.remaining ?? 0, _figBank?.total ?? 0) });
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

  // Per destruct 2026-05-07: each figure has individual EoA. When a
  // figure auto-locks (perFigureRemaining hits 0 via
  // consumeActionForCurrentFigure), this is the natural fan-out point
  // to fire that figure's EoA effects. handleDcEndFigure (manual
  // forfeit) fires its own EoA and sets figureEoaFired before this
  // runs, so this loop is a no-op in that path.
  if (data.figureLocked && meta) {
    data.figureEoaFired = data.figureEoaFired || {};
    for (const figIdxStr of Object.keys(data.figureLocked)) {
      const figIdx = parseInt(figIdxStr, 10);
      if (!data.figureLocked[figIdx]) continue;
      if (data.figureEoaFired[figIdx]) continue;
      try {
        const { applyEndOfActivationEffects } = await import('./activation-effects.js');
        const { applied: _figEoa } = applyEndOfActivationEffects(game, {
          dcName: meta.dcName,
          playerNum: meta.playerNum,
          displayName,
          msgId,
          figureIndex: figIdx,
        });
        if (Array.isArray(_figEoa) && deps.logGameAction) {
          for (const eff of _figEoa) {
            await deps.logGameAction(game, client, eff.message, { phase: 'ROUND', icon: 'activate' }).catch(() => {});
          }
        }
      } catch { /* non-fatal */ }
      data.figureEoaFired[figIdx] = true;
    }
  }

  // Per alexanbv 2026-05-12: run the activation-thread edit and the
  // play-area DC embed edit in parallel — they touch independent
  // channels + messages and Discord's API serializes per-channel
  // anyway. Cuts the round-trip cost roughly in half.
  const _activationEditTask = (async () => {
    if (!data?.messageId) return;
    try {
      const thread = await fetchGameChannel(client, data.threadId);
      const msg = await thread.messages.fetch(data.messageId);
      const components = meta && game ? deps.getDcActionButtons(msgId, meta.dcName, displayName, data, game) : [];
      // Per-figure activation (alexanbv 2026-06-13): the old top-level
      // data.remaining/data.total were removed, so reading them here gave
      // Math.min(undefined, 2) === NaN ("NaN/2"). Show the SELECTED figure's
      // remaining out of its per-figure budget (alexanbv 2026-06-25).
      const _selFig = data.selectedFigure ?? 0;
      const editPayload = {
        content: deps.getActionsCounterContent(figureActionsRemaining(data, _selFig), DC_ACTIONS_PER_ACTIVATION),
        components,
      };
      // Per alexanbv 2026-05-12: only render the minimap PNG when map
      // state has actually changed (move / damage / defeat / door /
      // map-token). Otherwise omit files/attachments from the edit so
      // the existing image stays attached on Discord's side. Cuts the
      // dominant per-click cost (800px canvas render + upload) on every
      // click that doesn't move a figure or apply damage. Users can
      // call refresh_map manually if a render is ever needed.
      const _mapVersion = game?._mapStateVersion || 0;
      const _renderedVersion = data._minimapRenderedVersion || 0;
      const _renderedForMsg = data._minimapRenderedForMessageId || null;
      const _minimapStale = (
        !data._minimapEverRendered
        || _renderedVersion !== _mapVersion
        || _renderedForMsg !== data.messageId
      );
      if (_minimapStale) {
        const actMinimap = await deps.getActivationMinimapAttachment(game, msgId);
        if (actMinimap) {
          editPayload.files = [actMinimap];
          editPayload.attachments = []; // replace old minimap image rather than accumulating
          data._minimapEverRendered = true;
          data._minimapRenderedVersion = _mapVersion;
          data._minimapRenderedForMessageId = data.messageId;
        }
      }
      await msg.edit(editPayload).catch(deps.discordCatch);
    } catch (err) {
      console.error('Failed to update DC actions message:', err);
    }
  })();

  // P4/P5: Refresh the DC embed in the play area with live action count + power tokens
  const _playAreaEditTask = (async () => {
    if (!(meta && game)) return;
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
  })();

  await Promise.all([_activationEditTask, _playAreaEditTask]);

  // Defer End Activation prompt while any action (combat / move grid / space pick) is mid-resolution.
  // The action cost is decremented at button-press time, so remaining can be 0 before the action
  // actually finishes. Re-firing happens automatically when the resolution path calls
  // updateDcActionsMessage again (after combat resolution / move pick / space pick clear).
  // suppressFinishedPrompt: per alexanbv 2026-05-10 — dc_special_ click consumes the action
  // BEFORE resolveAbility decides if a target picker is needed (requiresChoice path refunds
  // the action). Skipping the "finished" prompt during that window prevents firing before
  // the ability has actually resolved. The refund path calls updateDcActionsMessage again
  // without this flag, which re-evaluates with remaining=1 (no spurious fire).
  if (deps.suppressFinishedPrompt) {
    // Skip the finished-prompt branch entirely.
  } else if (data?.remaining === 0 && meta && !isActivationActionInProgress(game, msgId)) {
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

/**
 * Single source of truth for the round-activation message in general
 * channel. Handles BOTH variants:
 *
 *  - "Activation phase" — current turn-player + optional Pass button
 *  - "End-Phase" — both players done; "End R<n> Activation Phase" button
 *
 * Auto-clears the sticky `roundActivationButtonShown` flag if the
 * End-Phase variant no longer applies (counts changed).
 *
 * Called from every site that mutates turn state or activation balance:
 * pass, LiA placement, end-turn, end-activation, refresh-all.
 *
 * Idempotent. Safe to call from any handler.
 */
export async function updateRoundActivationMessage(game, gameId, client, deps) {
  // Sticky-flag rebalance: if the End-Phase variant was shown but no
  // longer fits (counts changed since), clear so we re-render the
  // Activation variant.
  if (game.roundActivationButtonShown
      && deps.shouldShowEndActivationPhaseButton
      && !deps.shouldShowEndActivationPhaseButton(game, gameId)) {
    game.roundActivationButtonShown = false;
  }
  if (!game.roundActivationMessageId || !game.generalId) return;

  // If the End-Phase variant should be shown and isn't yet, route through
  // maybeShowEndActivationPhaseButton (it owns posting the End-Phase body
  // + setting roundActivationButtonShown=true).
  if (deps.shouldShowEndActivationPhaseButton
      && deps.shouldShowEndActivationPhaseButton(game, gameId)
      && !game.roundActivationButtonShown) {
    await maybeShowEndActivationPhaseButton(game, client, deps);
    return;
  }
  // If End-Phase is currently shown, leave it alone.
  if (game.roundActivationButtonShown) return;

  // Activation variant: edit message with current turn-player + pass button.
  try {
    const ch = await fetchGameChannel(client, game.generalId);
    const msg = await ch.messages.fetch(game.roundActivationMessageId);
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    const turnPlayerNum = turnPlayerId === game.player1Id ? 1 : 2;
    const otherNum = turnPlayerNum === 1 ? 2 : 1;
    const myRem = (turnPlayerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining) ?? 0;
    const otherRem = (otherNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining) ?? 0;
    const round = game.currentRound || 1;
    const passRows = [];
    if (otherRem > myRem && myRem > 0) {
      passRows.push(new deps.ActionRowBuilder().addComponents(
        new deps.ButtonBuilder()
          .setCustomId(`pass_activation_turn_${gameId}`)
          .setLabel(`Pass (opponent has ${otherRem - myRem} more activation${otherRem - myRem !== 1 ? 's' : ''} than you)`)
          .setStyle(deps.ButtonStyle.Secondary)
      ));
    }
    const turnZone = turnPlayerId === game.player1Id ? 'red' : 'blue';
    const passHint = passRows.length ? ' You may pass (opponent has more activations).' : '';
    await msg.edit({
      content: `<@${turnPlayerId}> (${turnZone === 'red' ? '🔴 ' : '🔵 '}**Player ${turnPlayerNum}**) **Round ${round}** — Your turn to activate!${passHint}`,
      components: passRows,
      allowedMentions: { users: [turnPlayerId] },
    }).catch(deps.discordCatch);
  } catch (err) {
    console.error('updateRoundActivationMessage: edit failed', err);
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
      embeds: [],
      components: [endBtn],
      allowedMentions: { users: [game.initiativePlayerId] },
    })).catch(deps.discordCatch);
    game.roundActivationButtonShown = true;
    deps.saveGames(game.gameId);
  } catch (err) {
    console.error('Failed to show End Activation Phase button:', err);
  }
}

/**
 * Delete the existing round activation message and post a fresh one at the
 * bottom of #general. Used on REAL turn changes (DC activation completes,
 * pass clicked, end-phase swap) so the activation prompt + pass button
 * stay visible to the player whose turn it is, instead of being buried
 * above accumulating action logs.
 *
 * Mid-turn state shifts (CC effects, pass-eligibility flips, refresh on
 * restart) should keep using updateRoundActivationMessage / refresh paths
 * which edit in place.
 */
export async function repostRoundActivationMessage(game, gameId, client, deps) {
  if (!game.generalId) return;
  const ch = await fetchGameChannel(client, game.generalId).catch(() => null);
  if (!ch) return;

  // Per user 2026-05-09: do NOT delete log-channel records. Edit
  // the prior activation message to remove its buttons (preserves
  // the text/embed as a clear round-by-round record) instead of
  // deleting it.
  if (game.roundActivationMessageId) {
    try {
      const oldMsg = await ch.messages.fetch(game.roundActivationMessageId).catch(() => null);
      if (oldMsg) await oldMsg.edit({ components: [] }).catch(() => {});
    } catch {}
  }

  const round = game.currentRound || 1;
  const useEndPhase = !!(deps.shouldShowEndActivationPhaseButton
    && deps.shouldShowEndActivationPhaseButton(game, gameId));

  let payload;
  if (useEndPhase) {
    const endBtn = new deps.ActionRowBuilder().addComponents(
      new deps.ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(deps.ButtonStyle.Secondary)
    );
    const initPlayerNum = deps.getInitiativePlayerNum(game);
    const initZone = deps.getInitiativePlayerZoneLabel(game);
    payload = sanitizeMentions({
      content: `<@${game.initiativePlayerId}> (${initZone}**Player ${initPlayerNum}**) **Round ${round}** — Both players have used all activations and actions. Both players: click **End R${round} Activation Phase** when done with any end-of-activation effects.`,
      components: [endBtn],
      allowedMentions: { users: [game.initiativePlayerId] },
    });
    game.roundActivationButtonShown = true;
  } else {
    const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
    const turnPlayerNum = turnPlayerId === game.player1Id ? 1 : 2;
    const otherNum = turnPlayerNum === 1 ? 2 : 1;
    const myRem = (turnPlayerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining) ?? 0;
    const otherRem = (otherNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining) ?? 0;
    const passRows = [];
    if (otherRem > myRem && myRem > 0) {
      passRows.push(new deps.ActionRowBuilder().addComponents(
        new deps.ButtonBuilder()
          .setCustomId(`pass_activation_turn_${gameId}`)
          .setLabel(`Pass (opponent has ${otherRem - myRem} more activation${otherRem - myRem !== 1 ? 's' : ''} than you)`)
          .setStyle(deps.ButtonStyle.Secondary)
      ));
    }
    const turnZone = turnPlayerId === game.player1Id ? 'red' : 'blue';
    const passHint = passRows.length ? ' You may pass (opponent has more activations).' : '';
    payload = sanitizeMentions({
      content: `<@${turnPlayerId}> (${turnZone === 'red' ? '🔴 ' : '🔵 '}**Player ${turnPlayerNum}**) **Round ${round}** — Your turn to activate!${passHint}`,
      components: passRows,
      allowedMentions: { users: [turnPlayerId] },
    });
    game.roundActivationButtonShown = false;
  }

  try {
    const sent = await ch.send(payload);
    game.roundActivationMessageId = sent.id;
  } catch (err) {
    console.error('repostRoundActivationMessage: send failed', err);
  }
  if (deps.saveGames) deps.saveGames(game.gameId);
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

/**
 * Refresh the hand visual + discard pile for a player as a pair. The two
 * messages live next to each other in the play area and are nearly always
 * updated together (CC played, drawn, discarded — any change to one almost
 * always changes the other). One call replaces the duo at ~12 sites.
 *
 * Takes the wrapped updaters via ctx (closed-over deps) so callers don't
 * have to thread `deps` separately.
 */
export async function refreshHandAndDiscard(game, playerNum, client, ctx) {
  await ctx.updateHandVisualMessage(game, playerNum, client);
  await ctx.updateDiscardPileMessage(game, playerNum, client);
  // Also refresh the player's HAND CHANNEL (the actual list of cards + Play
  // buttons) — not just the play-area count. Without this, a played/drawn/
  // discarded card stayed visible in the hand after a CC resolved (alexanbv
  // 2026-06-23: "the hand of CCs displayed was not updated" after Planning /
  // Element). updateHandChannelMessages refreshes both players' hands.
  if (ctx.updateHandChannelMessages) {
    await ctx.updateHandChannelMessages(game, client);
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

  // DC card refresh — bounded-parallel. Independent per msgId (each
  // edits a different Discord message), so wall time scales 1/concurrency.
  // The healthState normalization MUST happen before the parallel batch
  // because dcHealthState.set + read pattern shares state.
  const allDcMsgIds = [...(game.p1DcMessageIds || []), ...(game.p2DcMessageIds || [])];
  const dcRefreshTasks = [];
  for (const msgId of allDcMsgIds) {
    const meta = deps.dcMessageMeta.get(msgId);
    if (!meta || meta.gameId !== gameId) continue;
    if (deps.isDepletedRemovedFromGame(game, msgId)) continue;
    const exhausted = deps.dcExhaustedState.get(msgId) ?? false;
    let healthState = deps.dcHealthState.get(msgId) ?? [];
    const stats = deps.getDcStats(meta.dcName);
    const figureless = deps.isFigurelessDc(meta.dcName);
    if (!figureless && stats.health != null) {
      const baseFigures = stats.figures ?? 1;
      // A Squad Upgrade adds one figure with its OWN health box — size to
      // base+SU and default the SU box to the SU figure's health, not the base
      // group's. Don't truncate an already-extended state. alexanbv 2026-06-17.
      const figures = groupEffectiveFigures(game, msgId, baseFigures);
      const suHealth = groupSuFigureHealth(game, msgId, deps.getDcStats);
      healthState = Array.from({ length: figures }, (_, i) => {
        const existing = healthState[i];
        const defHealth = (suHealth != null && i >= baseFigures) ? suHealth : stats.health;
        const cur = existing?.[0] != null ? existing[0] : defHealth;
        const max = existing?.[1] != null ? existing[1] : defHealth;
        return [cur, max];
      });
      deps.dcHealthState.set(msgId, healthState);
    }
    dcRefreshTasks.push({ msgId, meta, exhausted });
  }
  await runWithLimit(DISCORD_REFRESH_CONCURRENCY, dcRefreshTasks, async ({ msgId, meta, exhausted }) => {
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
  });

  // Update Companion embeds from dc-effects (so figure DC companions show after edit + Refresh All)
  const p1PlayAreaId = game.p1PlayAreaId;
  const p2PlayAreaId = game.p2PlayAreaId;
  const p1CompanionIds = game.p1DcCompanionMessageIds || [];
  const p2CompanionIds = game.p2DcCompanionMessageIds || [];
  const p1DcList = game.p1DcList || [];
  const p2DcList = game.p2DcList || [];
  // Companion embed refresh — bounded-parallel. Each companion is in a
  // different message; independent edits.
  const companionTasks = [];
  for (let i = 0; i < p1CompanionIds.length; i++) {
    if (!p1CompanionIds[i]) continue;
    const dcName = p1DcList[i]?.dcName;
    if (!dcName) continue;
    companionTasks.push({ playerNum: 1, msgId: p1CompanionIds[i], dcName, playAreaId: p1PlayAreaId });
  }
  for (let i = 0; i < p2CompanionIds.length; i++) {
    if (!p2CompanionIds[i]) continue;
    const dcName = p2DcList[i]?.dcName;
    if (!dcName) continue;
    companionTasks.push({ playerNum: 2, msgId: p2CompanionIds[i], dcName, playAreaId: p2PlayAreaId });
  }
  await runWithLimit(DISCORD_REFRESH_CONCURRENCY, companionTasks, async ({ playerNum, msgId, dcName, playAreaId }) => {
    try {
      const ch = await fetchGameChannel(client, playAreaId);
      const companionMsg = await ch.messages.fetch(msgId);
      const desc = deps.getCompanionDescriptionForDc(dcName);
      await companionMsg.edit({ embeds: [new deps.EmbedBuilder().setTitle('Companion').setDescription(desc).setColor(deps.COLORS.DARK_EMBED)] });
    } catch (err) {
      console.error(`Refresh All: P${playerNum} companion message failed`, msgId, err);
    }
  });

  // Refresh any active activation threads (dcActionsData) — bounded-parallel.
  if (game.dcActionsData) {
    const activationMsgIds = Object.keys(game.dcActionsData)
      .filter((msgId) => game.dcActionsData[msgId]?.threadId);
    await runWithLimit(DISCORD_REFRESH_CONCURRENCY, activationMsgIds, async (msgId) => {
      try {
        await updateDcActionsMessage(game, msgId, client, deps);
      } catch (err) {
        console.error('Refresh All: activation thread failed', msgId, err);
      }
    });
  }

  // Recompute activation counts from board state (single source of truth)
  for (const pn of [1, 2]) {
    deps.recomputeActivationCounts(game, pn);
    if (deps.updateActivationsMessage) {
      await deps.updateActivationsMessage(game, pn, client);
    }
  }

  // Re-render the round-activation message in the general channel with the
  // CURRENT pass-button state. This message holds the "Pass" button and is
  // normally only updated by activation/pass/LiA-placement handlers — meaning
  // a stuck state (e.g. corrupted activation counts that hid the pass button)
  // can leave the button missing even after the underlying counts are fixed.
  // Refresh All re-renders it from current state so the button reflects truth.
  //
  // If the End Activation Phase button was previously shown but the round
  // is no longer over (counts changed since), clear the sticky flag so we
  // can re-render the normal turn message.
  if (game.roundActivationButtonShown
      && deps.shouldShowEndActivationPhaseButton
      && !deps.shouldShowEndActivationPhaseButton(game, gameId)) {
    game.roundActivationButtonShown = false;
  }
  if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
    try {
      const ch = await fetchGameChannel(client, game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
      const turnPlayerNum = turnPlayerId === game.player1Id ? 1 : 2;
      const otherNum = turnPlayerNum === 1 ? 2 : 1;
      const myRem = (turnPlayerNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining) ?? 0;
      const otherRem = (otherNum === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining) ?? 0;
      const round = game.currentRound || 1;
      const passRows = [];
      if (otherRem > myRem && myRem > 0) {
        passRows.push(new deps.ActionRowBuilder().addComponents(
          new deps.ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel(`Pass (opponent has ${otherRem - myRem} more activation${otherRem - myRem !== 1 ? 's' : ''} than you)`)
            .setStyle(deps.ButtonStyle.Secondary)
        ));
      }
      const turnZone = turnPlayerId === game.player1Id ? 'red' : 'blue';
      const passHint = passRows.length ? ' You may pass (opponent has more activations).' : '';
      await msg.edit({
        content: `<@${turnPlayerId}> (${turnZone === 'red' ? '🔴 ' : '🔵 '}**Player ${turnPlayerNum}**) **Round ${round}** — Your turn to activate!${passHint}`,
        components: passRows,
        allowedMentions: { users: [turnPlayerId] },
      }).catch(deps.discordCatch);
    } catch (err) {
      console.error('Refresh All: round-activation message refresh failed', err);
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
      if (deps.saveGames) deps.saveGames(game.gameId);
    }
  } catch (err) {
    console.error('Refresh All: activation-phase safety net failed', err);
  }

  // Attachment-phase recovery (audit gap 7): a checkpoint saved during
  // setup attachment phase carries the pending-card state, but the
  // dropdown / done-prompt UI is not in the players' hand channels.
  // Re-post for each player who still has work — pending cards get a
  // dropdown for the next card, players with empty pending get the
  // "all done" prompt. Players already confirmed are skipped.
  try {
    if (game.setupAttachmentPhase && game.setupAttachmentPending && deps.sendAttachmentDropdown && deps.sendAttachDonePrompt) {
      const confirmedMap = game.setupAttachmentConfirmed || {};
      for (const pn of [1, 2]) {
        if (confirmedMap[pn]) continue;
        const pending = game.setupAttachmentPending[pn] || [];
        if (pending.length === 0) {
          await deps.sendAttachDonePrompt(game, gameId, pn, client);
        } else {
          await deps.sendAttachmentDropdown(game, gameId, pn, pending[0], client);
        }
      }
    }
  } catch (err) {
    console.error('Refresh All: attachment-phase safety net failed', err);
  }
}
