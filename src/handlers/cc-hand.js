/**
 * CC-hand + modals: squad_modal_, deploy_modal_, cc_attach_to_, cc_play_select_, cc_discard_select_,
 * deck_illegal_play_, deck_illegal_redo_, cc_shuffle_draw_, cc_play_, cc_draw_, cc_search_discard_,
 * cc_close_discard_, cc_discard_
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
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { COLORS } from '../discord/colors.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import { setPendingCcChoice, clearPendingCcChoice, clearPendingCelebration, setPendingCcConfirmation, clearPendingCcConfirmation, setPendingCcSpaceChoice, clearPendingCcSpaceChoice, setPendingCcAttachment, clearPendingCcAttachment, setPendingIllegalCcPlay, clearPendingIllegalCcPlay, setPendingIKnowEverything, clearPendingIKnowEverything, setPendingBELReorder } from '../game/interrupts.js';
import { normalizeSquadInput } from '../game/validation.js';
import { getDcEffects, getDcKeywords, getMapData, getFigureSize } from '../data-loader.js';
import { getFootprintCells } from '../game/coords.js';
import { checkHandDiscardPassiveReshuffle, fireCcDiscarded } from '../game/cc-passive-redraw.js';
import { ADAPTIVE_SKILLS_ABILITY_ID } from '../game/adaptive-skills-helpers.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import {
  getPlayerId, getHandChannelId, getSquad, getCcDiscard, getCcDeck, getCcHand,
  getDiscardThreadId,
  ccHandKey, ccDiscardKey, ccDeckKey, ccDrawnKey, ccAttachmentsKey, vpKey as vpKeyFn,
  opponentPlayerNum,
  getInitiativePlayerNum,
  dcMatchesPlayableBy,
  getDcList, getDcMessageIds,
} from '../game/player-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { exhaustAttachment } from '../game/card-state-helpers.js';
import { findSmugglingCompartmentMsgId, setAsideFromHand, SMUGGLING_COMPARTMENT_NAME } from '../game/smuggling-compartment.js';
import { scReactionAvailable, offerScSetAside, scSetAsideSelectRow, applyScSetAside } from './sc-hand-protection.js';
// Unified CC counter-window pipeline (stack model + rules + orchestration).
// All Negate/Comms counter-window logic lives in cc-pipeline.js; cc-hand.js
// keeps only the hand-DISPLAY / play-select / deferred-effect-resume logic and
// calls into the pipeline. NOTE: cc-pipeline.js imports _offerScThenResolveDeferredCc
// back from this file (it is shared with the standalone SC handlers below) — an
// intentional ES-module cycle that is safe because all bindings are only used at
// call time, never at module-eval time.
import { openCcCounterWindow, registerCcCustomResolve, NEGATION, COMM_DISRUPTION } from './cc-pipeline.js';

/**
 * Resolve the on-board figureKey of the player's Mara Jade (the Adaptive Skills
 * / Fast Learner figure). Used to record the range anchor when a unique-figure
 * CC is played via Mara's Fast Learner — so the range references Mara, not the
 * named figure, even when both are on the board (alexanbv 2026-06-21).
 * @returns {string|null}
 */
function resolveFastLearnerFigureKey(game, playerNum) {
  const positions = game?.figurePositions?.[playerNum] || {};
  const liveKeys = Object.keys(positions).filter(fk => positions[fk]);
  const dcEffects = getDcEffects() || {};
  for (const fk of liveKeys) {
    const dn = dcNameFromFigureKey(fk);
    const eff = dcEffects[dn] || dcEffects[String(dn || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((eff?.specialAbilityIds || []).includes(ADAPTIVE_SKILLS_ABILITY_ID)) return fk;
  }
  return null;
}

import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { refreshHandAndDiscard } from '../engine/message-updaters.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows, buildRowPickerButtons, cleanupSpacePick } from '../discord/components.js';

/**
 * Unified "a CC was played" trigger subroutine (alexanbv 2026-06-14): fires
 * every on-CC-play ability for the player who just played, regardless of the
 * card's cost. Previously these fired only on the cost>0 path, so a cost-0 CC
 * never triggered Kallus Hunt Dissent / Blaise Adapt — this consolidates them
 * into one call used by every play path. (The opponent's Negate/Comms counter-
 * window is the other half of the CC-play subroutine — see openCcCounterWindow.)
 * @param {object} game
 * @param {number} playerNum  the player who played the CC
 * @param {object} deps  { client, logGameAction, dcMessageMeta, saveGames }
 */
export async function runCcPlayTriggers(game, playerNum, deps) {
  // Hunt Dissent (Agent Kallus): opponent's first CC of round → 2-Hit-Token picker.
  try {
    const { fireHuntDissentIfFirstCcOfRound } = await import('./hunt-dissent.js');
    await fireHuntDissentIfFirstCcOfRound(game, playerNum, deps);
  } catch (err) {
    console.error('[cc-hand] Hunt Dissent hook failed:', err?.message ?? err);
  }
  // Adapt (Agent Blaise): opponent's first CC of round → friendly SPY/TROOPER becomes Hidden.
  try {
    const { fireAdaptBlaiseIfFirstCcOfRound } = await import('./blaise-adapt.js');
    await fireAdaptBlaiseIfFirstCcOfRound(game, playerNum, deps);
  } catch (err) {
    console.error('[cc-hand] Adapt (Blaise) hook failed:', err?.message ?? err);
  }
}

// onCcPlayed (the old "a CC was played" subroutine with the inline Negation /
// Comm-Disruption counter-window) was deleted 2026-06-17. Every CC play now
// routes through the unified recursive counter-window (openCcCounterWindow →
// _resolveCcCounterWindow). On-play triggers live in runCcPlayTriggers (above).


// ── [Smuggling Compartment] before a hand-affecting CC's effect (post-counter-window) ──
// Resume the deferred CC effect after the owner sets aside (or skips).
async function _resumeScCcEffect(game, ctx, client) {
  const pend = game.pendingCcEffect;
  if (!pend) { ctx.saveGames(game.gameId); return; }
  delete game.pendingCcEffect;
  const { resolveAbility, dcMessageMeta, dcHealthState } = ctx;
  if (resolveAbility) {
    // Played-by anchor (alexanbv 2026-06-21): if the player chose WHO plays this
    // unique-figure CC (named figure, Mara via Fast Learner, a Force User via
    // There is Another, or any army figure via [A New Hope]), expose the chosen
    // figureKey transiently so resolveUniqueFigureCcFigureKey /
    // resolveRoundModifierAnchor anchor the CC's range on that figure (not the
    // named figure). Cleared after the synchronous effect resolution so it never
    // leaks to other CCs. `playedByFigureKey` is the general field;
    // `fastLearnerFigureKey` is kept for back-compat with older stack entries.
    const _anchorFk = pend.playedByFigureKey ?? pend.fastLearnerFigureKey ?? null;
    if (_anchorFk) game.ccPlayedByFigureKey = _anchorFk;
    let result;
    try {
      result = resolveAbility(pend.abilityId, { game, playerNum: pend.playedBy, cardName: pend.card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat, msgId: pend.msgId });
    } finally {
      if (_anchorFk) delete game.ccPlayedByFigureKey;
    }
    await applyAbilityResult(result, { game, playerNum: pend.playedBy, msgId: pend.fromDc ? pend.msgId : undefined, client, ctx });
    // Interactive effects (e.g. Intelligence Leak's looker pick) return
    // requiresChoice — stand up the choice prompt for the player who played it.
    if (result.requiresChoice && Array.isArray(result.choiceOptions) && result.choiceOptions.length > 0) {
      // Dirty-Trick-style cards route the choice to the OPPONENT's controller
      // (choiceForControllerPlayerNum) instead of the player who played the CC.
      const clickerPN = result.choiceForControllerPlayerNum ?? pend.playedBy;
      const isOpponentChoice = clickerPN !== pend.playedBy;
      setPendingCcChoice(game, {
        abilityId: pend.abilityId, gameId: game.gameId, playerNum: pend.playedBy, card: pend.card,
        choiceOptions: result.choiceOptions,
        ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}),
        ...(isOpponentChoice ? { clickerPlayerNum: clickerPN } : {}),
      });
      const chId = getHandChannelId(game, clickerPN);
      const ch = chId ? await fetchGameChannel(client, chId) : null;
      if (ch) {
        const header = isOpponentChoice
          ? `**${pend.card}** — your figure was targeted; choose one:`
          : `**Choose one** (for **${pend.card}**):`;
        const btns = result.choiceOptions.map((opt) => new ButtonBuilder().setCustomId(`cc_choice_${game.gameId}_${opt}`).setLabel(String(opt).slice(0, 80)).setStyle(ButtonStyle.Secondary));
        await ch.send({ content: header, components: chunkButtonsToRows(btns).slice(0, 5) }).catch(discordCatch);
      }
    } else if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
      // Power-token-type choice (e.g. a deferred CC granting a token).
      const ptChId = getHandChannelId(game, pend.playedBy);
      if (ptChId) {
        game.pendingPowerTokenGrant.channelId = ptChId;
        const ptCh = await fetchGameChannel(client, ptChId);
        if (ptCh) {
          const { grants } = game.pendingPowerTokenGrant;
          const totalCount = grants.reduce((s, g) => s + g.count, 0);
          const figNames = [...new Set(grants.map((g) => g.figName))].join(', ');
          const ptBtns = ['Damage', 'Surge', 'Block', 'Evade'].map((t) => new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary));
          await ptCh.send({ content: `**Choose power token type** for **${figNames}** (${totalCount > 1 ? `${totalCount} tokens` : '1 token'}):`, components: [new ActionRowBuilder().addComponents(ptBtns)] }).catch(discordCatch);
        }
      }
    } else if (result.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0 && ctx.getBoardStateForMovement && ctx.getMapAttachmentForSpaces) {
      // Space pick for a deferred CC.
      setPendingCcSpaceChoice(game, { abilityId: pend.abilityId, gameId: game.gameId, playerNum: pend.playedBy, card: pend.card, validSpaces: result.validSpaces, chosenFigureKey: result.chosenFigureKey ?? null });
      const spChId = getHandChannelId(game, pend.playedBy);
      const spCh = spChId ? await fetchGameChannel(client, spChId) : null;
      if (spCh) {
        const bs = ctx.getBoardStateForMovement(game, null);
        const mapSpaces = bs?.mapSpaces || { spaces: result.validSpaces };
        game.pendingSpacePick = game.pendingSpacePick || {};
        game.pendingSpacePick[game.gameId] = { validSpaces: result.validSpaces, cellPrefix: `cc_space_${game.gameId}_`, mapSpaces, headerText: `**Pick a space** (for **${pend.card}**)` };
        const { rows } = buildRowPickerButtons(result.validSpaces, `space_row_${game.gameId}_`);
        const att = await ctx.getMapAttachmentForSpaces(game, result.validSpaces);
        const payload = { content: `**Pick a space** (for **${pend.card}**):\nChoose a row:`, components: rows.slice(0, 5) };
        if (att) payload.files = [att];
        await spCh.send(payload).catch(discordCatch);
      }
    }
    // Behind Enemy Lines reorder (requiresReorder) — separate from the choice
    // chain; post the deck-order picker to the player's hand channel.
    if (result.requiresReorder?.cards?.length > 1) {
      setPendingBELReorder(game, { deckKey: result.requiresReorder.deckKey, cards: result.requiresReorder.cards, picked: [], playerNum: pend.playedBy, gameId: game.gameId });
      const belChId = getHandChannelId(game, pend.playedBy);
      const belCh = belChId ? await fetchGameChannel(client, belChId) : null;
      if (belCh) {
        const belBtns = result.requiresReorder.cards.map((c, i) => new ButtonBuilder().setCustomId(`bel_reorder_1_${game.gameId}_${i}`).setLabel(`1st: ${c}`.slice(0, 80)).setStyle(ButtonStyle.Primary));
        await belCh.send({ content: `**Behind Enemy Lines** — Choose which card goes **on top** of the opponent's deck:`, components: [new ActionRowBuilder().addComponents(...belBtns.slice(0, 5))] }).catch(discordCatch);
      }
    }
    // Private reveal (e.g. "look at opponent's hand") — to the player's hand
    // channel (the old eager path used an ephemeral followUp; deferred has no
    // interaction, so the hand channel is the private equivalent).
    if (result.revealToPlayer) {
      const rvChId = getHandChannelId(game, pend.playedBy);
      const rvCh = rvChId ? await fetchGameChannel(client, rvChId) : null;
      if (rvCh) await rvCh.send({ content: String(result.revealToPlayer).slice(0, 1900) }).catch(discordCatch);
    }
  }
  if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
  ctx.saveGames(game.gameId);
}

/**
 * Offer [Smuggling Compartment] to the deferred CC's target, then resolve the
 * deferred effect if SC isn't available / declined. Called from the counter-
 * window resolve path in cc-pipeline.js (imported there) and from the standalone
 * SC handlers below. Exported because cc-pipeline.js depends on it.
 */
export async function _offerScThenResolveDeferredCc(game, ctx, client) {
  const pend = game.pendingCcEffect;
  if (!pend) return;
  // Only hand-affecting CCs (scProtect) offer Smuggling Compartment; other
  // cost>0 CCs deferred only for the Comms window resolve straight away.
  if (pend.scProtect) {
    const target = opponentPlayerNum(pend.playedBy);
    if (scReactionAvailable(game, target)) {
      const offered = await offerScSetAside(game, target, client, {
        idPrefix: 'sc_cc',
        promptText: `Your opponent played **${pend.card}**, which affects your Command hand. **[Smuggling Compartment]** — you may exhaust it to set aside cards first (returned at the start of your next activation or the next phase).`,
      });
      if (offered) { ctx.saveGames(game.gameId); return; } // deferred to sc_cc handlers
    }
  }
  await _resumeScCcEffect(game, ctx, client); // resolve the effect now
}

/** Owner opted in — show the hand multi-select. */
export async function handleScCcOpen(interaction, ctx) {
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_cc_open_');
  const gameId = parts[0];
  const ownerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== getPlayerId(game, ownerNum)) {
    await interaction.followUp({ content: 'Only the card owner can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const hand = game[ccHandKey(ownerNum)] || [];
  if (hand.length === 0) {
    await interaction.message.edit({ content: '**[Smuggling Compartment]** — no cards in hand to set aside.', components: [] }).catch(discordCatch);
    await _resumeScCcEffect(game, ctx, interaction.client);
    return;
  }
  await interaction.message.edit({
    content: '**[Smuggling Compartment]** — choose Command cards to set aside (returned at the start of your next activation or the next phase):',
    components: [scSetAsideSelectRow(hand, `sc_cc_confirm_${gameId}_${ownerNum}`)],
  }).catch(discordCatch);
}

/** Owner declined — proceed with the effect. */
export async function handleScCcSkip(interaction, ctx) {
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_cc_skip_');
  const game = await requireGame(interaction, getGame, parts[0]);
  if (!game) return;
  await interaction.message.edit({ content: '**[Smuggling Compartment]** — declined; the effect proceeds.', components: [] }).catch(discordCatch);
  await _resumeScCcEffect(game, ctx, interaction.client);
}

/** Owner confirmed which CCs to set aside, then resume the effect. */
export async function handleScCcConfirm(interaction, ctx) {
  const { getGame, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_cc_confirm_');
  const gameId = parts[0];
  const ownerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== getPlayerId(game, ownerNum)) {
    await interaction.followUp({ content: 'Only the card owner can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch); // select interactions are not auto-deferred
  const count = applyScSetAside(game, ownerNum, interaction.values || []);
  if (count > 0 && logGameAction) await logGameAction(game, client, `**[Smuggling Compartment]** — P${ownerNum} set aside ${count} Command card${count === 1 ? '' : 's'}.`, { phase: 'ACTION', icon: 'card' }).catch(() => {});
  await interaction.message.edit({ content: `**[Smuggling Compartment]** — set aside ${count} card${count === 1 ? '' : 's'}. The effect proceeds.`, components: [] }).catch(discordCatch);
  await _resumeScCcEffect(game, ctx, interaction.client);
}

/** @param {import('discord.js').ModalSubmitInteraction} interaction */
export async function handleSquadModal(interaction, ctx) {
  const { getGame, validateDeckLegal, sendSquadConfirmation } = ctx;
  const parts = splitCustomId(interaction.customId, 'squad_modal_');
  const gameId = parts[0];
  const playerNum = parts[1];
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
  const parts = splitCustomId(interaction.customId, 'deploy_modal_');
  if (parts.length < 3) {
    await interaction.reply({ content: 'Invalid modal.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const flatIndex = parseInt(parts[2], 10);
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
  // Block non-MOBILE/non-MASSIVE figures from deploying on blocking terrain
  const ms = getMapData(game.selectedMap?.id);
  const blockingArr = ms?.blocking || [];
  if (blockingArr.length > 0) {
    const dcKws = getDcKeywords(game)?.[figMeta.dcName] || [];
    const kwUpper = dcKws.map(k => String(k).toUpperCase());
    const canIgnoreBlocking = kwUpper.includes('MOBILE') || kwUpper.includes('MASSIVE');
    if (!canIgnoreBlocking) {
      const figSize = getFigureSize(figMeta.dcName) || '1x1';
      const cells = getFootprintCells(space, figSize);
      const blockSet = new Set(blockingArr.map(s => String(s).toLowerCase()));
      if (cells.some(c => blockSet.has(String(c).toLowerCase()))) {
        await interaction.reply({ content: `**${space.toUpperCase()}** is blocking terrain. Only MOBILE or MASSIVE figures can deploy there.`, ephemeral: true }).catch(discordCatch);
        return;
      }
    }
  }
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figurePositions[playerNum][figureKey] = space;
  saveGames(game.gameId);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
  await updateDeployPromptMessages(game, playerNum, interaction.client);
  await interaction.reply({ content: `Deployed **${figLabel.replace(/^Deploy /, '')}** at **${space.toUpperCase()}**.`, ephemeral: true }).catch(discordCatch);
}

/** @param {import('discord.js').StringSelectMenuInteraction} interaction */
export async function handleCcAttachTo(interaction, ctx) {
  const { getGame, getCcEffect, buildHandDisplayPayload, updateAttachmentMessageForDc, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_attach_to_');
  const game = getGame(gameId);
  const pending = game ? game.pendingCcAttachment : null;
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
    clearPendingCcAttachment(game);
    await interaction.reply({ content: "That card is no longer in your hand.", ephemeral: true }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  await interaction.deferUpdate();
  hand.splice(idx, 1);
  game[handKey] = hand;
  const attachKey = ccAttachmentsKey(playerNum);
  game[attachKey] = game[attachKey] || {};
  if (!Array.isArray(game[attachKey][dcMsgId])) game[attachKey][dcMsgId] = [];
  game[attachKey][dcMsgId].push(card);
  clearPendingCcAttachment(game);
  await updateAttachmentMessageForDc(game, playerNum, dcMsgId, interaction.client);
  const handChannel = await fetchGameChannel(interaction.client, isP1Hand ? game.p1HandId : game.p2HandId);
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
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> played **${card}** as an attachment.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  saveGames(game.gameId);
}

/** After dropdown selection: show card preview + PLAY CARD / DO SOMETHING ELSE confirmation. */
export async function handleCcPlaySelect(interaction, ctx) {
  const { getGame, getCommandCardImagePath, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_play_select_');
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
  setPendingCcConfirmation(game, { playerNum, card, ts: Date.now() });
  saveGames(game.gameId);
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
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await fetchGameChannel(interaction.client, handId);
  await withDiscordRetry(() => handChannel.send({ embeds: [embed], files, components: [row] }));
}

/** PLAY CARD confirmed — execute the actual play. */
export async function handleCcConfirmPlay(interaction, ctx) {
  const { getGame, getCcEffect, isCcAttachment, isCcPlayableNow, isCcPlayLegalByRestriction, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames, getIllegalCcPlayButtons, getCommandCardImagePath, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_confirm_play_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingCcConfirmation) {
    await interaction.followUp({ content: 'No card pending. Try playing again.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const CONFIRM_TTL_MS = 10 * 60 * 1000;
  if (Date.now() - (game.pendingCcConfirmation.ts || 0) > CONFIRM_TTL_MS) {
    clearPendingCcConfirmation(game);
    saveGames(game.gameId);
    await interaction.followUp({ content: 'Card selection expired — please re-select from your hand.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, card } = game.pendingCcConfirmation;
  // Capture FL picker outcome BEFORE clearing pendingCcConfirmation. Re-entry
  // from the Fast Learner picker re-establishes pendingCcConfirmation with
  // _flResolved set to 'named' or 'mara' so this body skips the picker and
  // routes FL consumption accordingly.
  const _flResolved = game.pendingCcConfirmation._flResolved || null;
  // 5H: Verify the interacting user is the player who initiated this CC play
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Not your card to confirm.')) return;
  clearPendingCcConfirmation(game);

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
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    saveGames(game.gameId);
    return;
  }

  const isP1Hand = playerNum === 1;
  const handKey = ccHandKey(playerNum);
  const discardKey = ccDiscardKey(playerNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf(card);
  if (idx < 0) {
    await interaction.followUp({ content: "That card isn't in your hand anymore.", ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    saveGames(game.gameId);
    return;
  }
  if (!isCcPlayableNow(game, playerNum, card)) {
    await interaction.followUp({ content: "That card can't be played right now (wrong timing).", ephemeral: true }).catch(discordCatch);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    saveGames(game.gameId);
    return;
  }
  const restriction = isCcPlayLegalByRestriction(game, playerNum, card);
  if (!restriction.legal) {
    setPendingIllegalCcPlay(game, { playerNum, card, reason: restriction.reason });
    const handId = getHandChannelId(game, playerNum);
    const handChannel = await fetchGameChannel(client, handId);
    const msg = await withDiscordRetry(() => handChannel.send({
      content: `⚠️ The bot thinks playing **${card}** is illegal: ${restriction.reason}\n\nChoose **Ignore and play** to play it anyway, or **Unplay card** to cancel.`,
      components: [getIllegalCcPlayButtons(gameId)],
    }));
    game.pendingIllegalCcPlay.messageId = msg.id;
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    saveGames(game.gameId);
    return;
  }
  // Unified unique-figure-CC player picker (alexanbv 2026-06-21): when a
  // unique-figure CC can be played by MORE THAN ONE eligible on-board figure
  // (named figure, Mara via Fast Learner, a Force User via There is Another, or
  // any army figure via [A New Hope]), the player must choose WHO plays it — the
  // range always anchors on the chosen figure, and each choice applies its own
  // consumption (FL / A New Hope deplete / none). Re-entry from the picker has
  // _flResolved set (it carries the chosen figureKey + consume); skip on re-entry.
  let _pickedFigureKey = null;   // chosen playing figure (for range anchor)
  let _pickedConsume = null;     // 'none' | 'fast_learner' | 'a_new_hope'
  if (_flResolved && typeof _flResolved === 'object') {
    _pickedFigureKey = _flResolved.figureKey ?? null;
    _pickedConsume = _flResolved.consume ?? null;
  }
  if (!_flResolved) {
    const { getUniqueCcPlayerOptions } = await import('../game/unique-figure-ccs.js');
    const options = getUniqueCcPlayerOptions(game, playerNum, card);
    // Prompt when there is genuine choice: >1 distinct eligible figure, OR a
    // single non-named option whose consumption differs from playing as the
    // named figure (so the player can decline a Fast Learner / A New Hope spend).
    const needsPrompt = options.length > 1
      || (options.length === 1 && options[0].kind !== 'named');
    if (needsPrompt) {
      const { presentUniqueCcPlayerPicker } = await import('./fast-learner-picker.js');
      await presentUniqueCcPlayerPicker(interaction, game, playerNum, card, options);
      saveGames(game.gameId);
      return;
    }
    // Exactly one named option (or none): no prompt. Anchor on the named figure
    // when present so the range references it even if the legality path used an
    // enabler substitution elsewhere.
    if (options.length === 1) {
      _pickedFigureKey = options[0].figureKey;
      _pickedConsume = options[0].consume;
    }
    // Keyword-anchor picker (alexanbv 2026-06-21): for CCs whose "within N of you"
    // range anchors on the playing figure but whose play restriction is a KEYWORD
    // (e.g. Just Business = LEADER), prompt WHICH restriction-satisfying figure is
    // "you" when 2+ are on the board. Reuses the unified picker UI (kind 'anchor',
    // no consumption). Only checked when the unique-figure picker did not apply.
    if (!_pickedFigureKey) {
      const { getKeywordAnchorPlayerOptions } = await import('../game/unique-figure-ccs.js');
      const anchorOptions = getKeywordAnchorPlayerOptions(game, playerNum, card);
      if (anchorOptions.length > 1) {
        const { presentUniqueCcPlayerPicker } = await import('./fast-learner-picker.js');
        await presentUniqueCcPlayerPicker(interaction, game, playerNum, card, anchorOptions);
        saveGames(game.gameId);
        return;
      }
      if (anchorOptions.length === 1) {
        _pickedFigureKey = anchorOptions[0].figureKey;
        _pickedConsume = 'none';
      }
    }
  }

  // Assassinate / mutual-exclude CC lock: block further CCs during this attack
  const _cbt = game.combat || game.pendingCombat;
  if (_cbt?.ccLockedOut) {
    setPendingIllegalCcPlay(game, { playerNum, card, reason: 'A card with "no other Command cards this attack" (e.g. Assassinate) was already played.' });
    const handId = getHandChannelId(game, playerNum);
    const handChannel = await fetchGameChannel(client, handId);
    const msg = await withDiscordRetry(() => handChannel.send({
      content: `⚠️ **${card}** cannot be played: a mutual-exclude CC (Assassinate) is active this attack.\n\nChoose **Ignore and play** to override, or **Unplay card** to cancel.`,
      components: [getIllegalCcPlayButtons(gameId)],
    }));
    game.pendingIllegalCcPlay.messageId = msg.id;
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    saveGames(game.gameId);
    return;
  }
  // Track how many CCs played during this attack (for "first CC" conditions like Assassinate)
  if (_cbt) _cbt.attackCcCount = (_cbt.attackCcCount || 0) + 1;
  // Per destruct 2026-05-07: "Only one copy of a named Command Card can
  // be played per timing instance." Mark this card as played in the
  // current timing bucket so isCcPlayableNow rejects subsequent copies
  // (covers Aphra Excavation rule + future cards). Generalizes the
  // ad-hoc Jundland Terror / Reinforcements gates above. Only tracked
  // timings (sor / eor / status / activation / attack) participate;
  // event-bound interrupts (PB, etc.) are gated elsewhere.
  {
    const _markEffect = getCcEffect ? getCcEffect(card) : null;
    const _markTiming = _markEffect?.timing;
    if (_markTiming) {
      const { markNamedCcPlayed } = await import('../game/named-cc-tracker.js');
      markNamedCcPlayed(game, playerNum, card, _markTiming);
    }
  }
  // Fast Learner (Mara Jade): mark FL used when either (a) the legality check
  // granted FL bypass (named figure NOT in army, Mara substituted — no picker),
  // or (b) the unified picker resolved to Mara (consume === 'fast_learner').
  // Other picker choices (named / There is Another / A New Hope) do NOT spend FL.
  if (restriction.fastLearner || _pickedConsume === 'fast_learner') {
    const dcList2 = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    for (const dc of dcList2) {
      const dn = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const eff = getDcEffects()?.[dn];
      if ((eff?.specialAbilityIds || []).includes(ADAPTIVE_SKILLS_ABILITY_ID)) {
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
    setPendingCcAttachment(game, { playerNum, card });
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
      options = options.filter(o => dcMatchesPlayableBy(
        o.dcName, playableBy, getDcEffects, getDcKeywords, game, o.displayName
      ));
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

  // ── UNIFIED CC PLAY (alexanbv 2026-06-17) ──────────────────────────────────
  // Every play routes through the recursive Negate/Comms counter-window; the
  // effect resolves only if not cancelled — no snapshot, no revert. This
  // REPLACES the legacy cost-branch below (left as dead code pending a live
  // playtest, then deleted). Order: block check → commit card → on-play triggers
  // → counter-window (which folds in the Smuggling Compartment step + resolve).
  {
    // 1. Block check — a figure prevented from playing CCs (Shadow Ops, Mak).
    if (game.shadowOpsBlockedPlayer === playerNum) {
      await interaction.followUp({ content: '**Shadow Ops** — you cannot play Command cards this round.', ephemeral: true }).catch(discordCatch);
      return;
    }
    // 2. Commit the played card to discard + refresh the player's hand UI.
    const _uHand = (game[handKey] || []).slice();
    const _uIdx = _uHand.indexOf(card);
    if (_uIdx >= 0) _uHand.splice(_uIdx, 1);
    game[handKey] = _uHand;
    game[discardKey] = (game[discardKey] || []).concat(card);
    // alexanbv 2026-06-23: keep message (no delete) for traceability
    await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
    const _uLog = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
    if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: _uLog?.id });
    // 3. On-play triggers (Hunt Dissent, Adapt) fire for the played card.
    await runCcPlayTriggers(game, playerNum, { client: interaction.client, logGameAction, dcMessageMeta: ctx.dcMessageMeta, saveGames });
    // [A New Hope]: deplete it now (once per game — it enabled the play) when
    // the play actually used A New Hope. When the unified picker produced a
    // choice, the picked consumption is AUTHORITATIVE — deplete ONLY if the
    // chosen figure qualified via A New Hope (`_pickedConsume === 'a_new_hope'`).
    // This enforces TIA-over-A-New-Hope precedence: a Force User chosen via There
    // is Another carries consume 'none', so A New Hope is NOT depleted even when
    // it is also available. When the picker did NOT run (single-named or legacy
    // auto-substitution), fall back to the legality flag `restriction.aNewHope`.
    const _useANewHope = _pickedConsume != null
      ? _pickedConsume === 'a_new_hope'
      : !!restriction?.aNewHope;
    if (_useANewHope) {
      const { depleteANewHope } = await import('../game/cc-timing.js');
      if (depleteANewHope(game, playerNum)) {
        await logGameAction(game, interaction.client, `**[A New Hope]** depleted — enabled **${card}**.`, { phase: 'ACTION', icon: 'card' }).catch(() => {});
      }
    }
    // 4. Open the recursive counter-window; it resolves the effect or cancels it.
    //    Thread the played-by anchor (the CHOSEN playing figure's figureKey) so a
    //    CC with a range component references THAT figure, not the named figure
    //    (alexanbv 2026-06-21). Covers all paths: named, Mara via Fast Learner, a
    //    Force User via There is Another, any army figure via A New Hope. Survives
    //    the counter-window via the stack entry → deferred-effect resolution
    //    (see _resumeScCcEffect). When the picker did not run, fall back to the
    //    Fast-Learner figureKey for the legacy Mara-auto-substitution path.
    const _anchorFk = _pickedFigureKey
      ?? ((restriction.fastLearner) ? resolveFastLearnerFigureKey(game, playerNum) : null);
    await openCcCounterWindow(game, gameId, { card, cost, playedBy: playerNum, abilityId, playedByFigureKey: _anchorFk, fastLearnerFigureKey: _anchorFk }, ctx, interaction.client);
    saveGames(game.gameId);
    return;
  }

}

/** DO SOMETHING ELSE — cancel the pending play. */
export async function handleCcCancelPlay(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_cancel_play_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  // 5H: Verify the interacting user owns this pending confirmation
  if (game.pendingCcConfirmation?.playerNum) {
    if (!await requirePlayer(interaction, game, interaction.user.id, game.pendingCcConfirmation.playerNum, canActAsPlayer, 'Not your card to cancel.')) return;
  }
  clearPendingCcConfirmation(game);
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  saveGames(game.gameId);
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
  const handChannel = await fetchGameChannel(client, handId);
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
  await refreshHandAndDiscard(game, playerNum, client, ctx);
  const effectDesc = effectData?.effect ? `\n> *${effectData.effect}*` : '';
  await logGameAction(game, client, `Played command card **${card}**.${effectDesc}`, { phase: 'ACTION', icon: 'card' });
  // On-play triggers (Hunt Dissent, Adapt), then route through the unified
  // counter-window: ALL CCs are counterable (alexanbv 2026-06-19). The effect
  // resolves (via the deferred path) only if not cancelled. This also covers the
  // illegal-play-anyway override, which still plays a Command card.
  await runCcPlayTriggers(game, playerNum, { client, logGameAction, dcMessageMeta, saveGames: ctx.saveGames });
  const abilityId = effectData?.abilityId ?? card;
  const cost = typeof effectData?.cost === 'number' ? effectData.cost : 0;
  await openCcCounterWindow(game, game.gameId, { card, cost, playedBy: playerNum, abilityId }, ctx, client);
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
  cleanupSpacePick(game, gameId);
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
  clearPendingCcSpaceChoice(game);
  await applyAbilityResult(result, { game, playerNum, client, ctx });
  // Power token type-choice prompt (e.g. Looking for a Fight push phase)
  if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
    const handChannelId2 = getHandChannelId(game, playerNum);
    if (handChannelId2) {
      game.pendingPowerTokenGrant.channelId = handChannelId2;
      const ptCh = await fetchGameChannel(client, handChannelId2);
      if (ptCh) {
        const { grants } = game.pendingPowerTokenGrant;
        const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
        const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
        const btns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
          new ButtonBuilder().setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
        );
        await ptCh.send({
          content: `**Choose power token type** for **${figNames}** (${totalCount > 1 ? `${totalCount} tokens` : '1 token'}):`,
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
      }
    }
  }
  try {
    await interaction.message.edit({ content: 'Space chosen.', components: [] }).catch(discordCatch);
  } catch {}
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction — choice button for choose-one CC (e.g. Retaliation). */
export async function handleCcChoice(interaction, ctx) {
  const { getGame, resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, updateHandVisualMessage, updateDiscardPileMessage, updateDcActionsMessage, buildDcEmbedAndFiles, getConditionsForDcMessage, getDcPlayAreaComponents, getBoardStateForMovement, getMapAttachmentForSpaces, client, saveGames } = ctx;
  const parts = splitCustomId(interaction.customId, 'cc_choice_');
  const gameId = parts[0];
  const chosenLabel = parts.slice(1).join('_');
  if (!gameId) {
    await interaction.followUp({ content: 'Invalid choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingCcChoice;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending choice for this game.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerNum = pending.playerNum;
  // clickerPlayerNum (Dirty Trick orStunInstead): when the choice was
  // routed to the target's controller, validate clicks against that
  // player. resolveAbility still runs with `playerNum` (original card
  // player) so the figure-owner math stays correct.
  const _clickerPN = pending.clickerPlayerNum ?? playerNum;
  const _clickerErrMsg = pending.clickerPlayerNum
    ? "Only the targeted figure's controller can choose."
    : 'Only the player who played the card can choose.';
  if (!await requirePlayer(interaction, game, interaction.user.id, _clickerPN, canActAsPlayer, _clickerErrMsg)) return;
  // Match by label (new-style) or fall back to numeric index (old buttons still in flight)
  let choiceIndex = pending.choiceOptions?.findIndex(opt => String(opt) === chosenLabel);
  if (choiceIndex < 0 && /^\d+$/.test(chosenLabel)) {
    choiceIndex = parseInt(chosenLabel, 10);
  }
  if (choiceIndex == null || choiceIndex < 0 || choiceIndex >= (pending.choiceOptions?.length ?? 0)) {
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
    // Pack Alpha Phase 2: only the up-to-3 moved CREATUREs count toward damage.
    packAlphaCreatureKeys: pending.packAlphaCreatureKeys ?? null,
    combat: game.combat || game.pendingCombat,
  });
  clearPendingCcChoice(game);
  const aarResult = await applyAbilityResult(result, { game, playerNum, client, ctx });
  if (!aarResult.handled && aarResult.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
    if (!getBoardStateForMovement || !getMapAttachmentForSpaces) {
      await logGameAction(game, client, 'CC effect: Space choice not supported. Resolve manually.', { phase: 'ACTION', icon: 'card' });
      saveGames(game.gameId);
      return;
    }
    setPendingCcSpaceChoice(game, {
      abilityId: pending.abilityId,
      gameId,
      playerNum,
      card: pending.card,
      validSpaces: result.validSpaces,
      chosenFigureKey: result.chosenFigureKey ?? pending.choiceValues?.[choiceIndex] ?? null,
    });
    const handChannelId = getHandChannelId(game, playerNum);
    const handCh = await fetchGameChannel(client, handChannelId);
    if (handCh) {
      const boardState2 = getBoardStateForMovement(game, null);
      const cc2MapSpaces = boardState2?.mapSpaces || { spaces: result.validSpaces };
      const cc2Header = `**Pick a space** (for **${pending.card ?? pending.abilityId}**)`;
      const cc2ContextKey = gameId;
      game.pendingSpacePick = game.pendingSpacePick || {};
      game.pendingSpacePick[cc2ContextKey] = {
        validSpaces: result.validSpaces,
        cellPrefix: `cc_space_${gameId}_`,
        mapSpaces: cc2MapSpaces,
        headerText: cc2Header,
      };
      const { rows: cc2RowBtns } = buildRowPickerButtons(result.validSpaces, `space_row_${cc2ContextKey}_`);
      const mapAttachment2 = await getMapAttachmentForSpaces(game, result.validSpaces);
      const payload2 = { content: `${cc2Header}:\nChoose a row:`, components: cc2RowBtns.slice(0, 5) };
      if (mapAttachment2) payload2.files = [mapAttachment2];
      await handCh.send(payload2).catch(discordCatch);
    }
    try {
      await interaction.message.edit({ content: 'Figure chosen. Now pick a space.', components: [] }).catch(discordCatch);
    } catch {}
    saveGames(game.gameId);
    return;
  }
  // Chained requiresChoice: a previous CC choice resolved into another
  // requiresChoice (e.g. Lord of the Sith → Force Choke → adjacent
  // hostile picker). Stand up a fresh pendingCcChoice and post the
  // next button row so the player can complete the chain.
  if (!aarResult.handled && aarResult.requiresChoice && Array.isArray(result.choiceOptions) && result.choiceOptions.length > 0) {
    setPendingCcChoice(game, {
      abilityId: pending.abilityId,
      gameId,
      playerNum,
      card: pending.card,
      choiceOptions: result.choiceOptions,
      ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}),
    });
    const nextHandChannelId = getHandChannelId(game, playerNum);
    const nextHandCh = nextHandChannelId ? await fetchGameChannel(client, nextHandChannelId) : null;
    if (nextHandCh) {
      const nextBtns = result.choiceOptions.map((opt) => {
        const label = String(opt).slice(0, 80);
        return new ButtonBuilder()
          .setCustomId(`cc_choice_${gameId}_${opt}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary);
      });
      const nextRows = chunkButtonsToRows(nextBtns).slice(0, 5);
      await nextHandCh.send({
        content: `**Choose one** (for **${pending.card ?? pending.abilityId}**):`,
        components: nextRows,
      }).catch(discordCatch);
    }
    try {
      await interaction.message.edit({ content: 'Choice resolved — pick the next option above.', components: [] }).catch(discordCatch);
    } catch {}
    saveGames(game.gameId);
    return;
  }
  // Power token type-choice prompt (e.g. Looking for a Fight grants 1 token after Move/Push choice)
  if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
    const handChannelId2 = getHandChannelId(game, playerNum);
    if (handChannelId2) {
      game.pendingPowerTokenGrant.channelId = handChannelId2;
      const ptCh = await fetchGameChannel(client, handChannelId2);
      if (ptCh) {
        const { grants } = game.pendingPowerTokenGrant;
        const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
        const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
        const btns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
          new ButtonBuilder().setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
        );
        await ptCh.send({
          content: `**Choose power token type** for **${figNames}** (${totalCount > 1 ? `${totalCount} tokens` : '1 token'}):`,
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
      }
    }
  }
  try {
    await interaction.message.edit({ content: 'Choice resolved.', components: [] }).catch(discordCatch);
  } catch {}
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Ignore and play" for pending illegal CC. */
export async function handleIllegalCcIgnore(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'illegal_cc_ignore_');
  const game = getGame(gameId);
  if (!game || !game.pendingIllegalCcPlay) {
    await interaction.followUp({ content: 'No pending play to resolve.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, card, messageId, excavationPlay } = game.pendingIllegalCcPlay;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the player who played the card can choose.')) return;
  clearPendingIllegalCcPlay(game);
  if (excavationPlay) {
    const tgt = game.aphraExcavationTarget;
    if (tgt && !tgt.used && tgt.cardName === card) {
      await _commitExcavationPlay(game, ctx, interaction, {
        gameId, card, playerNum, sourcePN: tgt.sourcePN,
        sourceDiscardKey: ccDiscardKey(tgt.sourcePN),
      });
    } else {
      await interaction.followUp({ content: 'Excavation marker no longer valid.', ephemeral: true }).catch(discordCatch);
    }
  } else {
    await resolveCcPlay(game, playerNum, card, ctx);
  }
  if (messageId && interaction.channel?.id) {
    try {
      const msg = await interaction.channel.messages.fetch(messageId);
      await msg.edit({ content: 'Play resolved.', components: [] }).catch(discordCatch);
    } catch {}
  }
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Play Celebration" to gain 4 VP. */
export async function handleCelebrationPlay(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, client, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'celebration_play_');
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
  game[discardKey] = (game[discardKey] || []).concat('Celebration');
  clearPendingCelebration(game);
  await refreshHandAndDiscard(game, attackerPlayerNum, client, ctx);
  await interaction.message.edit({ content: `**Celebration** — played.`, components: [] }).catch(discordCatch);
  // On-play triggers, then the unified counter-window: Celebration is counterable;
  // the +4 VP lands via the 'celebration_vp' resolver only if not cancelled.
  await runCcPlayTriggers(game, attackerPlayerNum, { client, logGameAction, dcMessageMeta: ctx.dcMessageMeta, saveGames });
  await openCcCounterWindow(game, game.gameId, { card: 'Celebration', cost: 0, playedBy: attackerPlayerNum, abilityId: 'Celebration', customResolve: 'celebration_vp' }, ctx, client);
  saveGames(game.gameId);
}

/**
 * Aphra Excavation play — Aphra's player clicks "Play [card] (Excavation)"
 * on her hand channel. The card lives in the source player's discard pile
 * per `game.aphraExcavationTarget`; this handler validates legality, runs
 * the same interceptor windows hand-played cards see (Signal Jammer,
 * Negation, Comm Disruption, illegal-play prompt), then splices the card
 * out of source discard, pushes it to the game box, and resolves the
 * ability via the shared resolveAbility / applyAbilityResult path.
 *
 * customId: excavation_play_${gameId}
 */
export async function handleExcavationPlay(interaction, ctx) {
  const { getGame, isCcPlayableNow, isCcPlayLegalByRestriction, getIllegalCcPlayButtons, client, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, 'excavation_play_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const tgt = game.aphraExcavationTarget;
  if (!tgt || tgt.used) {
    await interaction.followUp({ content: 'No active Excavation card to play.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, tgt.excavatorPN, canActAsPlayer, "Only Aphra's player may play this card.")) return;
  // Rest in Peace blocks all retrievals from discard piles for the round —
  // that includes Aphra playing her excavated card from discard.
  if (game.restInPeaceActive) {
    await interaction.followUp({ content: '**Excavation** — blocked by **Rest in Peace** (cannot play from discard piles this round).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const sourceDiscardKey = ccDiscardKey(tgt.sourcePN);
  const sourceDiscard = game[sourceDiscardKey] || [];
  if (!sourceDiscard.includes(tgt.cardName)) {
    await interaction.followUp({ content: `**${tgt.cardName}** is no longer in P${tgt.sourcePN}'s discard pile (redrawn out). Excavation cannot resolve.`, ephemeral: true }).catch(discordCatch);
    await interaction.message.edit({ content: `⛏️ **Excavation** — **${tgt.cardName}** was redrawn out of discard before play. Marker lost.`, components: [] }).catch(discordCatch);
    return;
  }
  const card = tgt.cardName;
  const playerNum = tgt.excavatorPN;
  // Pre-commit legality. Wrong-timing → error + bail (player can retry
  // later in the round). Restriction violation → "Ignore and play / Unplay"
  // prompt with excavationPlay flag so handleIllegalCcIgnore routes back
  // through the excavation commit path.
  if (isCcPlayableNow && !isCcPlayableNow(game, playerNum, card)) {
    await interaction.followUp({ content: `**${card}** can't be played right now (wrong timing).`, ephemeral: true }).catch(discordCatch);
    return;
  }
  if (isCcPlayLegalByRestriction) {
    const restriction = isCcPlayLegalByRestriction(game, playerNum, card);
    if (!restriction.legal) {
      setPendingIllegalCcPlay(game, { playerNum, card, reason: restriction.reason, excavationPlay: true });
      const handId = getHandChannelId(game, playerNum);
      const handChannel = handId ? await fetchGameChannel(client, handId) : null;
      if (handChannel && getIllegalCcPlayButtons) {
        const msg = await withDiscordRetry(() => handChannel.send({
          content: `⚠️ The bot thinks playing **${card}** via **Excavation** is illegal: ${restriction.reason}\n\nChoose **Ignore and play** to play it anyway, or **Unplay card** to cancel (the marker stays — try again).`,
          components: [getIllegalCcPlayButtons(gameId)],
        })).catch(() => null);
        if (msg) game.pendingIllegalCcPlay.messageId = msg.id;
      }
      saveGames(game.gameId);
      return;
    }
  }
  await _commitExcavationPlay(game, ctx, interaction, { gameId, card, playerNum, sourcePN: tgt.sourcePN, sourceDiscardKey });
}

/**
 * Commit phase: actually splices from source discard → game box, marks
 * `aphraExcavationTarget.used`, then runs the same interceptor sequence
 * a hand-played CC sees (Signal Jammer, Negation for cost 0, Comm
 * Disruption for cost > 0). Called from handleExcavationPlay (legal path)
 * and handleIllegalCcIgnore (when pendingIllegalCcPlay.excavationPlay).
 */
async function _commitExcavationPlay(game, ctx, interaction, params) {
  const { getCcEffect, resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, updateDiscardPileMessage, getBoardStateForMovement, getMapAttachmentForSpaces, client, saveGames } = ctx;
  const { gameId, card, playerNum, sourcePN, sourceDiscardKey } = params;
  // Re-validate card still in source discard (state may have shifted
  // between prompt and click — Mastery, redraws, etc).
  const sourceDiscard = game[sourceDiscardKey] || [];
  const idx = sourceDiscard.indexOf(card);
  if (idx < 0) {
    if (interaction.message?.editable) {
      await interaction.message.edit({ content: `⛏️ **Excavation** — **${card}** was redrawn out of discard before commit. Lost.`, components: [] }).catch(discordCatch);
    }
    return;
  }
  // Splice from source discard, push to game box, mark used.
  sourceDiscard.splice(idx, 1);
  game[sourceDiscardKey] = sourceDiscard;
  game.gameBox = game.gameBox || [];
  game.gameBox.push(card);
  if (game.aphraExcavationTarget) game.aphraExcavationTarget.used = true;
  const tgt = game.aphraExcavationTarget;
  // Edit the original "Play X (Excavation)" prompt button (separate from
  // any "ignore-and-play" message the user may have just clicked).
  try {
    const playMsgId = tgt?.playButtonMessageId;
    const playChId = tgt?.playButtonChannelId;
    if (playMsgId && playChId && playMsgId !== interaction.message?.id) {
      const ch = await fetchGameChannel(client, playChId);
      const msg = ch ? await ch.messages.fetch(playMsgId).catch(() => null) : null;
      if (msg) await msg.edit({ content: `⛏️ **Excavation** — **${card}** played from P${sourcePN}'s discard, returned to game box.`, components: [] }).catch(discordCatch);
    } else if (interaction.message?.editable) {
      await interaction.message.edit({ content: `⛏️ **Excavation** — **${card}** played from P${sourcePN}'s discard, returned to game box.`, components: [] }).catch(discordCatch);
    }
  } catch {}
  await logGameAction(game, client, `<@${interaction.user.id}> played **${card}** via ⛏️ **Excavation** (from P${sourcePN}'s discard → game box).`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  if (updateDiscardPileMessage) {
    await updateDiscardPileMessage(game, sourcePN, client).catch(discordCatch);
  }
  const effectData = getCcEffect ? getCcEffect(card) : null;
  const cost = typeof effectData?.cost === 'number' ? effectData.cost : 0;
  const abilityId = effectData?.abilityId ?? card;
  // Signal Jammer intercept (mirrors handleCcConfirmPlay). Per CRR the
  // jammed card and Signal Jammer both go to discard; for excavation the
  // played card is already in game box per Aphra's "return to game box"
  // rule, so only Signal Jammer routes to its owner's discard here.
  if (game.signalJammerActive && card !== 'Signal Jammer') {
    const jammerOwnerNum = game.signalJammerActive.playerNum;
    game.signalJammerActive = null;
    const jammerDiscardKey = ccDiscardKey(jammerOwnerNum);
    game[jammerDiscardKey] = [...(game[jammerDiscardKey] || []), 'Signal Jammer'];
    await logGameAction(game, client, `**Signal Jammer** cancelled **${card}** — Signal Jammer discarded; **${card}** still routes to game box per Excavation.`, { phase: 'ACTION', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  // Route through the UNIFIED counter-window (Negate/Comms) — the same path as a
  // hand play / combat gate / DC play (alexanbv 2026-06-17). The card is already
  // in the game box (Excavation's "return to game box" disposition above); on
  // resolve the effect runs via _resumeScCcEffect (choice / space prompts +
  // choiceForControllerPlayerNum handled there), on cancel the when-discarded
  // pipeline fires. No more old Negation / Comm-Disruption window.
  await runCcPlayTriggers(game, playerNum, { client, logGameAction, dcMessageMeta, saveGames });
  await openCcCounterWindow(game, gameId, { card, cost, playedBy: playerNum, abilityId }, ctx, client);
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Pass" on Celebration. */
export async function handleCelebrationPass(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'celebration_pass_');
  const game = getGame(gameId);
  if (!game || !game.pendingCelebration) {
    await interaction.followUp({ content: 'No Celebration window open.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { attackerPlayerNum } = game.pendingCelebration;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the player who defeated the figure can pass.')) return;
  clearPendingCelebration(game);
  await interaction.message.edit({ content: 'Passed on Celebration.', components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Unplay card" for pending illegal CC. */
export async function handleIllegalCcUnplay(interaction, ctx) {
  const { getGame, client, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'illegal_cc_unplay_');
  const game = getGame(gameId);
  if (!game || !game.pendingIllegalCcPlay) {
    await interaction.followUp({ content: 'No pending play to cancel.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playerNum, messageId } = game.pendingIllegalCcPlay;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the player who played the card can choose.')) return;
  clearPendingIllegalCcPlay(game);
  if (messageId && interaction.channel?.id) {
    try {
      const msg = await interaction.channel.messages.fetch(messageId);
      await msg.edit({ content: 'Cancelled — card not played.', components: [] }).catch(discordCatch);
    } catch {}
  }
  saveGames(game.gameId);
}

/** @param {import('discord.js').StringSelectMenuInteraction} interaction */
export async function handleCcDiscardSelect(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_discard_select_');
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
  const handChannel = await fetchGameChannel(interaction.client, isP1Hand ? game.p1HandId : game.p2HandId);
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
  // When-discarded subroutine (NOT a play): re-draw passives + Windfall hooks.
  const _disc = fireCcDiscarded(game, playerNum, card, { fromDeck: false });
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
  await logGameAction(game, interaction.client, `<@${interaction.user.id}> discarded **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
  if (_disc.windfallSelfVp > 0) await logGameAction(game, interaction.client, `**Windfall** — P${playerNum} gains **1 VP** (Windfall discarded).`, { icon: 'card' });
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleSquadConfirm(interaction, ctx) {
  const { getGame, pendingSquadConfirm, PENDING_ILLEGAL_TTL_MS, applySquadSubmission } = ctx;
  const parts = splitCustomId(interaction.customId, 'squad_confirm_');
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
  const parts = splitCustomId(interaction.customId, 'squad_cancel_');
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
  const parts = splitCustomId(interaction.customId, 'deck_illegal_play_');
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
  const parts = splitCustomId(interaction.customId, 'deck_illegal_redo_');
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
  const handChannel = await fetchGameChannel(interaction.client, handChannelId);
  const handMessages = await handChannel.messages.fetch({ limit: 15 });
  const botMsg = handMessages.find((m) => m.author.bot && m.embeds?.some((e) => e.title?.includes('Your Hand')));
  if (botMsg) {
    await botMsg.edit({
      embeds: [getHandTooltipEmbed(game, playerNum)],
      components: [],
    }).catch(discordCatch);
  }
  saveGames(game.gameId);
  await interaction.message.edit({ content: 'Squad cleared. Paste your list or upload a .vsav file below to resubmit.', components: [] }).catch(discordCatch);
  await interaction.followUp({ content: 'Your squad has been cleared. Paste your army list or upload a .vsav file in this thread to resubmit.', ephemeral: true }).catch(discordCatch);
}

/**
 * If Moff Gideon (or any IKE-applicable opponent) is on the board,
 * post the I Know Everything choice prompt to whichever player's
 * deck would be searched. Per user 2026-05-09: IKE must fire AND
 * resolve BEFORE any shuffle-and-draw runs. Returns true if a
 * prompt was posted (caller must wait); false otherwise.
 */
export async function triggerStartingHandIke(game, ctx) {
  const { shuffleArray, logGameAction, saveGames, client } = ctx;
  const gameId = game.gameId;
  if (game.iKnowEverythingResolved) return false;
  if (game.pendingIKnowEverything) return true; // already pending

  // Moff Gideon's IKE searches the OPPONENT's deck. So if player N
  // has Moff, player N's opponent's deck is the search target.
  for (const targetPN of [1, 2]) {
    const oppNum = opponentPlayerNum(targetPN);
    const oppDcList = oppNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const oppHasGideon = oppDcList.some(d => (d?.dcName || d) === 'Moff Gideon');
    if (!oppHasGideon) continue;

    const squad = getSquad(game, targetPN);
    const ccList = squad?.ccList || [];
    const attachKey2 = ccAttachmentsKey(targetPN);
    const placed2 = (attachKey2 && game[attachKey2] && Object.values(game[attachKey2]).flat()) || [];
    const _ikeExistingHand = ((game[ccHandKey(targetPN)]) || []);
    const availableCards = ccList.filter(c => !placed2.includes(c) && !_ikeExistingHand.includes(c));
    if (availableCards.length < 2) continue;

    const shuffledCopy = [...availableCards];
    shuffleArray(shuffledCopy);
    const revealed = [shuffledCopy[0], shuffledCopy[1]];
    setPendingIKnowEverything(game, { targetPlayerNum: targetPN, gideonPlayerNum: oppNum, cards: revealed, gameId });
    const cardLabels = revealed.map((c, i) => `**${i + 1}.** ${c}`).join('\n');
    const keepRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ike_keep_${gameId}_0`).setLabel(`Keep: ${revealed[0].slice(0, 70)}`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ike_keep_${gameId}_1`).setLabel(`Keep: ${revealed[1].slice(0, 70)}`).setStyle(ButtonStyle.Primary),
    );
    await logGameAction(game, client, `🕵️ **I Know Everything** — **Moff Gideon** reveals 2 cards from <@${getPlayerId(game, targetPN)}>'s Command deck:\n${cardLabels}\n\n<@${getPlayerId(game, targetPN)}> — Choose which card to **keep** (the other is removed from the game). Cards will be drawn for both players after this resolves.`, { components: [keepRow], allowedMentions: { users: [getPlayerId(game, targetPN)] }, interrupt: true });
    saveGames?.(gameId);
    return true;
  }
  game.iKnowEverythingResolved = true;
  return false;
}

/**
 * Draw the starting hand for one player (no IKE check; caller has
 * already resolved IKE if applicable). Posts the hand display to
 * the player's hand channel.
 */
export async function drawStartingHandForPlayer(game, playerNum, ctx) {
  const { shuffleArray, buildHandDisplayPayload, updateHandVisualMessage, logGameAction, saveGames, client } = ctx;
  const gameId = game.gameId;
  const drawnKey = ccDrawnKey(playerNum);
  if (game[drawnKey]) return;
  const squad = getSquad(game, playerNum);
  const ccList = squad?.ccList || [];
  const attachKey = ccAttachmentsKey(playerNum);
  const placed = (game[attachKey] && Object.values(game[attachKey]).flat()) || [];
  const handKey = ccHandKey(playerNum);
  const _existingHand = (game[handKey] || []).slice();
  const deck = ccList.filter((c) => !placed.includes(c) && !_existingHand.includes(c));
  shuffleArray(deck);
  const _drawCount = Math.max(0, 3 - (game.wookieeAvengerDrawPenalty || 0));
  let hand = [..._existingHand, ...deck.splice(0, _drawCount)];
  const deckKey = ccDeckKey(playerNum);
  if (game.testScenarioPrimaryCard && playerNum === 1 && !hand.includes(game.testScenarioPrimaryCard)) {
    const replaced = hand[hand.length - 1];
    hand = [...hand.slice(0, hand.length - 1), game.testScenarioPrimaryCard].filter(Boolean);
    if (replaced) deck.push(replaced);
    const pcIdx = deck.indexOf(game.testScenarioPrimaryCard);
    if (pcIdx >= 0) deck.splice(pcIdx, 1);
  }
  game[deckKey] = deck;
  game[handKey] = hand;
  game[drawnKey] = true;
  const playerId = getPlayerId(game, playerNum);
  const _waNote = (game.wookieeAvengerDrawPenalty || 0) > 0 ? ` (1 fewer per Wookiee Avenger; Debts Repaid pre-placed in hand)` : '';
  await logGameAction(game, client, `<@${playerId}> shuffled and drew ${_drawCount} Command Cards${_waNote}.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });
  const handChannelId = playerNum === 1 ? game.p1HandId : game.p2HandId;
  if (handChannelId) {
    try {
      const handChannel = await fetchGameChannel(client, handChannelId);
      if (handChannel) {
        const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
        const sentMsg = await handChannel.send({
          content: handPayload.content,
          embeds: handPayload.embeds,
          files: handPayload.files || [],
          components: handPayload.components,
        }).catch(() => null);
        if (sentMsg) {
          if (playerNum === 1) game.p1HandMessageId = sentMsg.id;
          else game.p2HandMessageId = sentMsg.id;
        }
      }
    } catch (err) {
      console.error('drawStartingHandForPlayer: hand-channel post failed', err);
    }
  }
  await updateHandVisualMessage(game, playerNum, client);
  saveGames?.(gameId);
}

/**
 * Top-level orchestrator: fire IKE first (if applicable), then draw
 * for both players when IKE is resolved, then advance to round 1
 * SoR. Called from advanceFromDeployment after post-deploy and from
 * handleIKnowEverythingKeep after IKE resolves.
 */
export async function autoDrawAllStartingHands(game, ctx) {
  const { updatePlayAreaDcButtons, client } = ctx;
  // Phase 1: IKE before any draw (per user 2026-05-09).
  const ikePending = await triggerStartingHandIke(game, ctx);
  if (ikePending) return; // resume after IKE resolves via handleIKnowEverythingKeep
  // Phase 2: draw for both players in initiative order.
  const { getInitiativePlayerNum } = await import('../game/player-helpers.js');
  const initPN = getInitiativePlayerNum(game);
  const otherPN = initPN === 1 ? 2 : 1;
  await drawStartingHandForPlayer(game, initPN, ctx);
  await drawStartingHandForPlayer(game, otherPN, ctx);
  if (game.player1CcDrawn && game.player2CcDrawn) {
    await updatePlayAreaDcButtons(game, client);
    const { advanceFromCcDraw } = await import('./phase-gate.js');
    await advanceFromCcDraw(game, ctx);
  }
}

/**
 * Legacy export kept for compatibility — combines IKE + draw for
 * one player. Used by tests / refresh recovery paths. The auto
 * post-deploy path uses autoDrawAllStartingHands instead.
 */
export async function shuffleAndDrawForPlayer(game, playerNum, ctx) {
  const ikePending = await triggerStartingHandIke(game, ctx);
  if (ikePending) return;
  await drawStartingHandForPlayer(game, playerNum, ctx);
  if (game.player1CcDrawn && game.player2CcDrawn) {
    const { updatePlayAreaDcButtons, client } = ctx;
    await updatePlayAreaDcButtons(game, client);
    const { advanceFromCcDraw } = await import('./phase-gate.js');
    await advanceFromCcDraw(game, ctx);
  }
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcShuffleDraw(interaction, ctx) {
  const { getGame, shuffleArray, buildHandDisplayPayload, updateHandVisualMessage, updatePlayAreaDcButtons, sendRoundActivationPhaseMessage, runStartOfRoundDcEffects, logGameAction, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_shuffle_draw_');
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
    // I Know Everything searches the opponent's DECK, not their hand. With
    // Wookiee Avenger, Debts Repaid is pre-placed in hand at attachment
    // phase — it's no longer in the deck and must NOT be in Moff Gideon's
    // candidate pool. (destruct 2026-05-06: WA-DR + Moff interaction.)
    const _ikeExistingHand = ((game[ccHandKey(playerNum)]) || []);
    const availableCards = ccList.filter(c => !placed2.includes(c) && !_ikeExistingHand.includes(c));
    if (availableCards.length >= 2) {
      // Pick 2 random cards to reveal
      const shuffledCopy = [...availableCards];
      shuffleArray(shuffledCopy);
      const revealed = [shuffledCopy[0], shuffledCopy[1]];
      setPendingIKnowEverything(game, { targetPlayerNum: playerNum, gideonPlayerNum: oppNum, cards: revealed, gameId });
      const oppPlayerId = getPlayerId(game, oppNum);
      const cardLabels = revealed.map((c, i) => `**${i + 1}.** ${c}`).join('\n');
      const keepRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ike_keep_${gameId}_0`).setLabel(`Keep: ${revealed[0].slice(0, 70)}`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ike_keep_${gameId}_1`).setLabel(`Keep: ${revealed[1].slice(0, 70)}`).setStyle(ButtonStyle.Primary),
      );
      await logGameAction(game, client, `🕵️ **I Know Everything** — **Moff Gideon** reveals 2 cards from <@${getPlayerId(game, playerNum)}>'s Command deck:\n${cardLabels}\n\n<@${getPlayerId(game, playerNum)}> — Choose which card to **keep** (the other is removed from the game):`, { components: [keepRow], allowedMentions: { users: [getPlayerId(game, playerNum)] }, interrupt: true });
      saveGames(game.gameId);
      return;
    }
    // Not enough cards, skip I Know Everything
    game.iKnowEverythingResolved = true;
  }

  const attachKey = ccAttachmentsKey(playerNum);
  const placed = (game[attachKey] && Object.values(game[attachKey]).flat()) || [];
  const handKey = ccHandKey(playerNum);
  // WA setup (setup.js:267) puts Debts Repaid into hand BEFORE we draw the
  // initial hand. Preserve it: filter out cards already in hand from the
  // deck pool, and reduce the draw count by the WA penalty so the total
  // starting hand size remains correct (1 + 2 = 3 with WA).
  const _existingHand = (game[handKey] || []).slice();
  const deck = ccList.filter((c) => !placed.includes(c) && !_existingHand.includes(c));
  shuffleArray(deck);
  const _drawCount = Math.max(0, 3 - (game.wookieeAvengerDrawPenalty || 0));
  let hand = [..._existingHand, ...deck.splice(0, _drawCount)];
  const deckKey = ccDeckKey(playerNum);
  if (game.testScenarioPrimaryCard && playerNum === 1 && !hand.includes(game.testScenarioPrimaryCard)) {
    const replaced = hand[hand.length - 1];
    hand = [...hand.slice(0, hand.length - 1), game.testScenarioPrimaryCard].filter(Boolean);
    if (replaced) deck.push(replaced);
    const pcIdx = deck.indexOf(game.testScenarioPrimaryCard);
    if (pcIdx >= 0) deck.splice(pcIdx, 1);
  }
  game[deckKey] = deck;
  game[handKey] = hand;
  game[drawnKey] = true;
  const playerId = getPlayerId(game, playerNum);
  const _drewLogCount = _drawCount;
  const _waNote = (game.wookieeAvengerDrawPenalty || 0) > 0 ? ` (1 fewer per Wookiee Avenger; Debts Repaid pre-placed in hand)` : '';
  await logGameAction(game, client, `<@${playerId}> shuffled and drew ${_drewLogCount} Command Cards${_waNote}.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: [playerId] } });
  const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
  await interaction.message.edit({
    content: handPayload.content,
    embeds: handPayload.embeds,
    files: handPayload.files || [],
    components: handPayload.components,
  }).catch(discordCatch);
  // Store hand message ID for reliable future edits
  if (playerNum === 1) game.p1HandMessageId = interaction.message.id;
  else game.p2HandMessageId = interaction.message.id;
  await updateHandVisualMessage(game, playerNum, client);
  if (game.player1CcDrawn && game.player2CcDrawn) {
    await updatePlayAreaDcButtons(game, client);
    // Per user 2026-05-09: removed the cc_drawn ready check —
    // proceed directly to round 1 SoR. The SoR ability check is
    // still posted by runStartOfRoundContinuation inside
    // advanceFromCcDraw.
    const { advanceFromCcDraw } = await import('./phase-gate.js');
    await advanceFromCcDraw(game, ctx);
  }
  saveGames(game.gameId);
}

/**
 * Handle I Know Everything choice (ike_keep_ button).
 * The targeted player picks which card to keep; the other is removed from the game.
 * Then triggers the shuffle/draw for that player.
 */
export async function handleIKnowEverythingKeep(interaction, ctx) {
  const { getGame, shuffleArray, buildHandDisplayPayload, updateHandVisualMessage, updatePlayAreaDcButtons, sendRoundActivationPhaseMessage, runStartOfRoundDcEffects, logGameAction, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const match = interaction.customId.match(/^ike_keep_(.+)_(\d)$/);
  if (!match) return;
  const [, gameId, keepIdxStr] = match;
  const keepIdx = parseInt(keepIdxStr, 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game || !game.pendingIKnowEverything) {
    await interaction.followUp({ content: 'No pending I Know Everything choice.', ephemeral: true }).catch(discordCatch); return;
  }
  const pending = game.pendingIKnowEverything;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.targetPlayerNum, canActAsPlayer, 'Only the targeted player can choose.')) return;

  const keptCard = pending.cards[keepIdx];
  const removedCard = pending.cards[1 - keepIdx];
  const playerNum = pending.targetPlayerNum;

  // Remove the unchosen card from the squad's CC list and place it
  // in the shared game box (per CRR: "return the other card to the
  // game box"). Distinguishing discard pile from game box matters —
  // game box = permanently out of game, NOT recoverable via reshuffle.
  const squad = getSquad(game, playerNum);
  if (squad?.ccList) {
    const rmIdx = squad.ccList.indexOf(removedCard);
    if (rmIdx >= 0) squad.ccList.splice(rmIdx, 1);
  }
  game.gameBox = game.gameBox || [];
  game.gameBox.push(removedCard);

  clearPendingIKnowEverything(game);
  game.iKnowEverythingResolved = true;

  await logGameAction(game, client, `🕵️ **I Know Everything** — Kept **${keptCard}**. **${removedCard}** removed from the game.`, { phase: 'DEPLOYMENT', icon: 'card' });
  try { await interaction.message.edit({ components: [] }); } catch {}

  // Per user 2026-05-09: IKE resolves BEFORE any shuffle-and-draw.
  // Now that IKE is resolved, draw starting hands for both players
  // and advance to round 1 SoR.
  await autoDrawAllStartingHands(game, ctx);
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcPlay(interaction, ctx) {
  const { getGame, getPlayableCcFromHand } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_play_');
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
      const existing = await fetchGameChannel(client, existingThreadId);
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
  saveGames(game.gameId);
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
    const thread = await fetchGameChannel(client, threadId);
    await thread.delete();
  } catch (err) {
    console.error('Failed to delete discard pile thread:', err);
  }
  if (playerNum === 1) delete game.p1DiscardThreadId;
  else delete game.p2DiscardThreadId;
  await updateDiscardPileMessage(game, playerNum, client);
  saveGames(game.gameId);
}


