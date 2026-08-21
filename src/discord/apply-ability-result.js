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
    updateHandChannelMessages,
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

  // --- Inline CC redraw (Rebel Graffiti when Sabine plays it) ---
  // Per CRR 2026-05-09: certain CCs grant a redraw at end of their
  // own resolution. result.pendingRedraw = { card, playerNum }.
  if (result.applied && result.pendingRedraw?.card && result.pendingRedraw?.playerNum) {
    try {
      const { moveDiscardToHand } = await import('../game/cc-passive-redraw.js');
      const _moved = moveDiscardToHand(game, result.pendingRedraw.playerNum, result.pendingRedraw.card);
      if (_moved && logGameAction) {
        await logGameAction(game, client, `**Passive Redraw** — **${result.pendingRedraw.card}** re-drawn from discard to hand.`, { phase: 'ROUND', icon: 'card' });
      }
    } catch (err) {
      console.error('[apply-ability-result] pendingRedraw failed:', err?.message ?? err);
    }
  }

  // --- Companion deploy directive (Droid Mastery → J4X-7) ---
  // A resolver with no Discord client (sync ccEffect) returns
  // result.deployCompanion = { companionName, atFigureKey, playerNum }; the async
  // apply layer (which HAS the client) deploys the companion via the SAME
  // companion-deploy routine The Child / other companions use (alexanbv 2026-06-20).
  if (result.applied && result.deployCompanion?.companionName && result.deployCompanion?.atFigureKey) {
    try {
      const dc = result.deployCompanion;
      const { deployCompanionFigure } = await import('../handlers/post-deploy.js');
      await deployCompanionFigure(
        game,
        { companionName: dc.companionName, hostFigureKey: dc.atFigureKey, playerNum: dc.playerNum ?? playerNum },
        client,
        {
          buildDcEmbedAndFiles: ctx.buildDcEmbedAndFiles,
          dcMessageMeta, dcExhaustedState, dcHealthState,
          getDcPlayAreaComponents,
          getNicknamesForDcMessage: ctx.getNicknamesForDcMessage,
          logGameAction,
        },
      );
    } catch (err) {
      console.error('[apply-ability-result] deployCompanion failed:', err?.message ?? err);
    }
  }

  // --- Unhandled routing: caller must set up pendingCcChoice/pendingCcSpaceChoice themselves ---
  if (!result.applied && result.requiresChoice && result.choiceOptions?.length > 0) {
    return { handled: false, requiresChoice: true, requiresSpaceChoice: false };
  }
  if (!result.applied && result.requiresSpaceChoice && result.validSpaces?.length > 0) {
    return { handled: false, requiresChoice: false, requiresSpaceChoice: true };
  }

  // --- Deferred side-effects in canonical order (alexanbv 2026-06-23) ---
  // resolveAbility() is SYNC so it can't await the pipelines; it QUEUES strain
  // cost / damage / dealt strain / conditions and we drain them here in the one
  // canonical order: strain COST → DAMAGE → dealt STRAIN → CONDITIONS. Damage
  // routes through the SAME applyDamage combat uses (combat:false) so every
  // ability/CC damage fires the identical WHEN_DAMAGED / BEFORE_DEFEATED /
  // WHEN_DEFEATED hooks + Vanish / Clan-of-Two; strain routes through applyStrain
  // (Fireproof / Under Duress / Paz). Drained BEFORE _pendingFigureDefeats since
  // applyDamage finalizes its own defeats internally.
  if (result.applied) {
    try {
      const { applyDeferredAbilityEffects } = await import('../game/damage-pipeline.js');
      await applyDeferredAbilityEffects(game, ctx, result);
    } catch (err) {
      console.error('[apply-ability-result] deferred-effects pipeline failed:', err?.message ?? err);
    }
  }

  // --- Ready figures: unexhaust and rebuild DC embed ---
  if (result.applied && result.readyDcMsgIds?.length && dcExhaustedState) {
    for (const id of result.readyDcMsgIds) {
      dcExhaustedState.set(id, false);
      await refreshDcEmbedAndComponents(client, game, id, ctx, { exhausted: false, errorContext: 'Failed to update DC embed after ready:' });
    }
  }

  // --- Exhaust DCs: mark exhausted and rebuild DC embed (Take Initiative cost) ---
  if (result.applied && result.exhaustDcMsgIds?.length && dcExhaustedState) {
    for (const id of result.exhaustDcMsgIds) {
      dcExhaustedState.set(id, true);
      await refreshDcEmbedAndComponents(client, game, id, ctx, { exhausted: true, errorContext: 'Failed to update DC embed after exhaust:' });
    }
  }

  // --- Drew cards (refresh both players' hands since draw effects can affect either) ---
  // Per alexanbv 2026-05-13: Command cards are SECRET. Never list drawn
  // card names in the public game log — they only become visible to the
  // drawing player via their private hand visual. Reveal abilities are
  // the only legitimate exception (and they handle their own logging).
  if (result.applied && result.drewCards?.length) {
    // Public count visual (number-only in play area).
    if (updateHandVisualMessage) {
      await updateHandVisualMessage(game, 1, client);
      await updateHandVisualMessage(game, 2, client);
    }
    // Private hand channel (actual card buttons for the drawing
    // player). Per alexanbv 2026-05-13: every draw path must refresh
    // BOTH the public count AND the private hand UI, or the player
    // can't see their newly-drawn cards.
    if (updateHandChannelMessages) {
      await updateHandChannelMessages(game, client);
    }
    // A draw effect almost always also touches the discard pile (Planning /
    // mulligan-style draw-then-discard), so refresh both players' discard
    // visuals too — otherwise the discard count goes stale (alexanbv 2026-06-23).
    if (updateDiscardPileMessage) {
      await updateDiscardPileMessage(game, 1, client);
      await updateDiscardPileMessage(game, 2, client);
    }
  }

  // --- Log message (applied) ---
  // If resolveAbility returned a logMessage, prefer that — the ability
  // author knows what to expose (e.g. Black Market Prices names the
  // DISCARDED card + VP swing, but drewCards stays count-only inside
  // that message). Otherwise fall back to a generic "Drew N" line.
  if (result.applied) {
    if (result.logMessage && logGameAction) {
      await logGameAction(game, client, `CC effect: ${result.logMessage}`, { phase: 'ACTION', icon: 'card' });
    } else if (result.drewCards?.length && logGameAction) {
      const drewCount = result.drewCards.length;
      await logGameAction(game, client, `CC effect: Drew ${drewCount} Command card${drewCount === 1 ? '' : 's'}.`, { phase: 'ACTION', icon: 'card' });
    }
  }

  // --- Discarded-CC public reveal ---
  // CCs are normally SECRET, but a card DISCARDED as a cost/effect (Black Market
  // Prices, Planning, Forbidden Knowledge) becomes public knowledge — both
  // players see what left the hand (so they know which when-discarded passives,
  // e.g. Built on Hope / De Wanna Wanga / Windfall, may have fired). The resolver
  // already fired fireCcDiscarded() synchronously; here we only surface the names.
  if (result.applied && Array.isArray(result.discardedCcs) && result.discardedCcs.length && logGameAction) {
    for (const _dc of result.discardedCcs) {
      if (!_dc) continue;
      await logGameAction(game, client, `🃏 discarded **${_dc}** — revealed.`, { phase: 'ACTION', icon: 'card' }).catch(() => {});
    }
  }

  // --- Manual message (not applied) ---
  if (!result.applied && result.manualMessage) {
    if (logGameAction) {
      await logGameAction(game, client, `CC effect: ${result.manualMessage}`, { phase: 'ACTION', icon: 'card' });
    }
  }

  // --- Refresh player hand / discard ---
  if (result.applied && result.refreshHand) {
    if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client);
    // Also refresh the actual hand-channel cards, not just the count.
    if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
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

  // --- Move-X picker (single figure) ---
  // Abilities that stamp pendingMoveX synchronously surface the msgId
  // via result.pendingMoveXMsgId. Post the picker now (async, needs
  // client + logGameAction). Mirror of the dc-play-area consumer.
  if (result.applied && result.pendingMoveXMsgId) {
    try {
      const { postMoveXPicker } = await import('../handlers/move-x-handler.js');
      const { saveGames, logGameAction } = ctx || {};
      await postMoveXPicker(game, { client, logGameAction, saveGames }, result.pendingMoveXMsgId);
    } catch (err) {
      console.error('Failed to post Move-X picker:', err?.message ?? err);
    }
  }

  // --- Move-X sequence (multi figure) ---
  // Abilities that need to orchestrate multiple figures (e.g. Pack
  // Alpha) return a payload describing the sequence. Stand it up now
  // so the order picker is posted.
  if (result.applied && result.pendingMoveXSequenceSetup) {
    try {
      const { setupPendingMoveXSequence } = await import('../handlers/move-x-handler.js');
      const { saveGames, logGameAction } = ctx || {};
      await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, result.pendingMoveXSequenceSetup);
    } catch (err) {
      console.error('Failed to set up Move-X sequence:', err?.message ?? err);
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
    // Out-of-combat die rolls (Neurostim, Headbutt, Trample, Telekinetic Throw,
    // Terminal Protocol, Set the Charge, Force cards, etc.) attach the rolled
    // faces on result.rollImageDice so we can SHOW THE DIE FACE here, mirroring
    // combat. Render only ONCE (first notified thread); other threads get text.
    const _rollDice = Array.isArray(result.rollImageDice) && result.rollImageDice.length
      ? result.rollImageDice
      : null;
    let _rollImagePosted = false;
    for (const id of idsToNotify) {
      const data = game.dcActionsData?.[id];
      if (!data?.threadId) continue;
      try {
        const thread = await fetchGameChannel(client, data.threadId);
        if (!thread) continue;
        const content = enforceContentLimit(`💡 ${result.logMessage}`);
        if (_rollDice && !_rollImagePosted) {
          const { postDieRollResult } = await import('./dice-renderer.js');
          await postDieRollResult(thread, { content, dice: _rollDice });
          _rollImagePosted = true;
        } else {
          await withDiscordRetry(() => thread.send({ content })).catch(discordCatch);
        }
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
  // FUTURE — PLAYER-CHOSEN RESOLUTION ORDER (alexanbv 2026-06-23, NOT YET BUILT):
  // when an ability/effect would defeat MULTIPLE figures, the CONTROLLER OF THE
  // AFFECTED FIGURES chooses the order they are defeated (in theory every time
  // 2+). Today this drains in FIXED queue order. When implemented, group these
  // defeats by defeatedPlayerNum and prompt that controller to order any group
  // of 2+ before finalizing. Search tag: "PLAYER-CHOSEN RESOLUTION ORDER".
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

  // --- Direct defeats (Cassian IWBA, Voracious, Evacuate, etc.) ---
  // Per IACP, these abilities skip WHEN_DAMAGED + BEFORE_DEFEATED
  // entirely (the figure does NOT suffer damage). applyDirectDefeat
  // records HP=0, fires WHEN_DEFEATED hooks, and finalizes via
  // processFigureDefeat. Each entry: { figureKey, msgId, figIndex,
  // controllerPlayerNum, attackerPlayerNum?, dcName?, displayName?, source }.
  if (result.applied && Array.isArray(result.directDefeats) && result.directDefeats.length > 0) {
    try {
      const { applyDirectDefeat } = await import('../game/damage-pipeline.js');
      for (const dd of result.directDefeats) {
        if (!dd || !dd.figureKey || !dd.msgId) continue;
        if (_seenDefeats.has(dd.figureKey)) continue;
        _seenDefeats.add(dd.figureKey);
        await applyDirectDefeat(game, ctx, dd);
      }
    } catch (err) {
      console.error('[apply-ability-result] directDefeats failed:', err?.message ?? err);
    }
  }

  // --- Granted attack button (Emperor / Executive Order / Battlefield Leadership / Order Hit) ---
  // Per destruct 2026-05-07: granted attacks fire IMMEDIATELY in the source's
  // activation thread; clicking spawns a new combat thread for the grantee.
  // Source's activation pauses until grantee combat resolves. The button
  // wraps the existing dc_attack_ flow and the underlying pendingX state
  // (pendingEmperorInterrupt / pendingExecutiveOrder / etc.) is what marks
  // the attack as free in combat.js. See handleGrantedAttack.
  // Granted ACTION menu (alexanbv 2026-08-21) — the wide sibling of
  // grantedAttackButton. "perform an action" means any action, so the grantee
  // gets a menu of everything they could legally do: move, attack, interact,
  // native and mission-injected Special Actions, and discarding Stun or Bleed.
  // See handlers/granted-action.js for why this is separate from the narrow
  // granted-attack primitive.
  if (result.applied && result.grantedActionMenu) {
    const _gamOpts = result.grantedActionMenu;
    try {
      const { postGrantedActionMenu } = await import('../handlers/granted-action.js');
      await postGrantedActionMenu(game, ctx, _gamOpts);
    } catch (err) {
      console.error('Failed to post granted-action menu:', err);
    }
  }

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
        const _gabBtns = [_gabBtn];
        // Wild Beast (Bantha Rider) — alexanbv 2026-05-10: when an attack
        // is granted to Bantha, may perform a Special Action (Trample)
        // instead. Limit once per activation AND once per status phase
        // (two separate counters). Button shown only if neither counter
        // is set for the grantee msgId.
        const _wbIsBantha = String(granteeFigureKey).startsWith('Bantha Rider-');
        const _wbActivationUsed = !!game?.wildBeastUsedThisActivation?.[granteeMsgId];
        const _wbStatusUsed = !!game?.wildBeastUsedThisStatusPhase?.[granteeMsgId];
        if (_wbIsBantha && !_wbActivationUsed && !_wbStatusUsed) {
          _gabBtns.push(
            new ButtonBuilder()
              .setCustomId(`wild_beast_trample_${game.gameId}_${granteeMsgId}_f${_gabFigIdx}`)
              .setLabel('Wild Beast: Trample instead')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        const _gabRow = new ActionRowBuilder().addComponents(..._gabBtns);
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

  // Standalone granted-attack button: like grantedAttackButton, but posted to
  // the GAME-LOG channel (not the source's activation thread). Used by
  // opponent-turn interrupt CCs (Overcharged Weapons, Parting Blow) where the
  // holder has NO active activation thread — there is no game.dcActionsData
  // entry for the grantee. The figure-level free-attack flags
  // (freeAttackBonusPending / forcedAttackTarget / pendingOverrideAttackDice)
  // are already armed by the resolver; clicking the button rewrites to
  // dc_attack_ via handleGrantedAttack and combat.js consumes those flags.
  if (result.applied && result.grantedAttackButtonStandalone) {
    const sa = result.grantedAttackButtonStandalone;
    if (sa.granteeMsgId && sa.granteeFigureKey) {
      try {
        const _saModule = await import('discord.js');
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = _saModule;
        const _saFkMatch = String(sa.granteeFigureKey).match(/-(\d+)-(\d+)$/);
        const _saFigIdx = _saFkMatch ? _saFkMatch[2] : '0';
        const _saBtn = new ButtonBuilder()
          .setCustomId(`granted_attack_${game.gameId}_${sa.granteeMsgId}_f${_saFigIdx}`)
          .setLabel(`Declare Attack (${sa.granteeName || 'grantee'})`)
          .setStyle(ButtonStyle.Danger);
        const _saRow = new ActionRowBuilder().addComponents(_saBtn);
        const { getPlayerId } = await import('../game/player-helpers.js');
        const _saOwnerId = sa.granteePlayerNum ? getPlayerId(game, sa.granteePlayerNum) : null;
        if (logGameAction) {
          await logGameAction(game, client, enforceContentLimit(
            `${_saOwnerId ? `<@${_saOwnerId}> ` : ''}\u{2694}\u{FE0F} **${sa.sourceLabel || 'Granted Attack'}** — click below to declare the free attack with **${sa.granteeName || 'the grantee'}**. A new combat thread will open.`
          ), {
            phase: 'ROUND', icon: 'attack',
            components: [_saRow],
            ...(_saOwnerId ? { allowedMentions: { users: [_saOwnerId] } } : {}),
          });
        }
      } catch (err) {
        console.error('Failed to post standalone granted-attack button:', err);
      }
    }
  }

  // Granted Move-X button: companion to grantedAttackButton for cards
  // (Executive Order, etc.) that also offer the grantee a free move.
  // Posts in the source's activation thread alongside the attack
  // button; clicking stamps pendingMoveX on the grantee with
  // bypassCosts: false so the picker honors terrain/figure adders.
  if (result.applied && result.grantedMoveXButton) {
    const gmx = result.grantedMoveXButton;
    if (gmx.granteeMsgId && gmx.granteeFigureKey && msgId) {
      try {
        const _gmxModule = await import('discord.js');
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = _gmxModule;
        const _gmxBtn = new ButtonBuilder()
          .setCustomId(`granted_move_x_${game.gameId}_${gmx.granteeMsgId}_${gmx.spaces}`)
          .setLabel(`Move (up to ${gmx.spaces} MP) — ${gmx.granteeName || 'grantee'}`)
          .setStyle(ButtonStyle.Success);
        const _gmxRow = new ActionRowBuilder().addComponents(_gmxBtn);
        const data = game.dcActionsData?.[msgId];
        if (data?.threadId) {
          const thread = await fetchGameChannel(client, data.threadId);
          if (thread) {
            await withDiscordRetry(() => thread.send({
              content: enforceContentLimit(`\u{1F9BF} **${gmx.sourceLabel || 'Granted Move'}** — click below to take a free move with **${gmx.granteeName || 'the grantee'}** (up to ${gmx.spaces} MP, no bank, remainder discarded).`),
              components: [_gmxRow],
            })).catch(discordCatch);
          }
        }
      } catch (err) {
        console.error('Failed to post granted-move-x button:', err);
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
