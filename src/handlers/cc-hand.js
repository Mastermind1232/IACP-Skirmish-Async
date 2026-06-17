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
import { setPendingNegation, updatePendingNegation, clearPendingNegation, setPendingCcChoice, clearPendingCcChoice, clearPendingCelebration, setPendingCcConfirmation, clearPendingCcConfirmation, setPendingCcSpaceChoice, clearPendingCcSpaceChoice, setPendingCcAttachment, clearPendingCcAttachment, setPendingIllegalCcPlay, clearPendingIllegalCcPlay, setPendingCommDisruptionPrompt, clearPendingCommDisruptionPrompt, setPendingIKnowEverything, clearPendingIKnowEverything, setPendingBELReorder } from '../game/interrupts.js';
import { normalizeSquadInput } from '../game/validation.js';
import { getDcEffects, getDcKeywords, getMapData, getFigureSize } from '../data-loader.js';
import { getFootprintCells } from '../game/coords.js';
import { checkHandDiscardPassiveReshuffle, fireCcDiscarded } from '../game/cc-passive-redraw.js';
import { ADAPTIVE_SKILLS_ABILITY_ID } from '../game/adaptive-skills-helpers.js';
import { awardObjectiveVp } from '../game/index.js';
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

// Hand-affecting CCs whose effect must let the target exhaust [Smuggling
// Compartment] AFTER the Negate/Comms window resolves, before the effect.
// alexanbv 2026-06-17. Cost-0 (deferred past Negation) is wired here; the
// cost>0 cards need their effect deferred past Comm Disruption (follow-up).
const SC_HAND_CCS = new Set(['Stall for Time']);
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { refreshHandAndDiscard } from '../engine/message-updaters.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows, buildRowPickerButtons, cleanupSpacePick } from '../discord/components.js';
import { classifyCcStep } from '../engine/combat-order-validator.js';
import { pushCcPlay } from '../engine/combat-counter-window.js';

/**
 * Slice 5.1: push a CC play onto the combat-scoped counter-window stack.
 *
 * Per destruct's 2026-05-05 audit: every CC play opens an opponent-only
 * counter-window. Cancellation suppresses ALL of the canceled CC's effects,
 * including "when discarded" triggers. The stack is recursive — Negation on
 * Brace, Comm Disruption on Negation, etc.
 *
 * Slice 5.1 is data-only: we record the play onto pendingCombat.ccPlayStack.
 * Subsequent slices (5.2+) wire prompts and resolution against this stack.
 *
 * No-op when there is no active combat (counter-window for non-combat CC
 * plays is deferred — Comm Disruption already has a tailored helper).
 */
function recordCcOnCombatStack(game, playerNum, card) {
  const cbt = game?.combat || game?.pendingCombat;
  if (!cbt) return;
  cbt.ccPlayStack = cbt.ccPlayStack || [];
  try {
    const { stack } = pushCcPlay(cbt.ccPlayStack, { ccName: card, playerNum });
    cbt.ccPlayStack = stack;
  } catch (_e) {
    // pushCcPlay refuses same-player counter — surfaces a stale stack
    // rather than the user's intended new play. Reset to a fresh top-level.
    cbt.ccPlayStack = [];
    const { stack } = pushCcPlay(cbt.ccPlayStack, { ccName: card, playerNum });
    cbt.ccPlayStack = stack;
  }
}

/**
 * Slice 5.7: mark the most-recently-played CC as canceled so downstream
 * effect-firing code skips it. Also tags game.canceledCcs[card] for
 * out-of-combat consumers (legacy promptCommDisruption + Negation paths).
 *
 * Per destruct 2026-05-05: cancellation suppresses ALL effects of the
 * canceled CC including "when discarded" triggers.
 */
function markTopCcCanceled(game, card) {
  const cbt = game?.combat || game?.pendingCombat;
  const stack = cbt?.ccPlayStack;
  if (Array.isArray(stack) && stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top && top.ccName === card) top.canceled = true;
  }
  game.canceledCcs = game.canceledCcs || {};
  game.canceledCcs[card] = true;
}

/**
 * Slice 5.7: read whether a card's most recent play was canceled. Used by
 * handleNegationLetResolve to skip resolveAbility when CD already canceled
 * the same card (dual-prompt race fix).
 */
function isCcCanceled(game, card) {
  return Boolean(game?.canceledCcs?.[card]);
}

/** Clear the canceled flag for a card. Called when the play resolves cleanly. */
function clearCcCanceled(game, card) {
  if (game?.canceledCcs) delete game.canceledCcs[card];
}

/**
 * Slice 5.6 (destruct 2026-05-05 — counter-on-counter recursion):
 * undo a top-of-stack cancel for `card`. Used when a counter-Negation
 * cancels the Negation that targeted `card`, restoring the original
 * play's effects. Walks the stack from top to find the most recent
 * play of `card` and clears its canceled flag; also clears the global
 * canceledCcs marker.
 */
function unmarkTopCcCanceled(game, card) {
  const cbt = game?.combat || game?.pendingCombat;
  const stack = cbt?.ccPlayStack;
  if (Array.isArray(stack)) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].ccName === card && stack[i].canceled) {
        stack[i].canceled = false;
        break;
      }
    }
  }
  if (game?.canceledCcs) delete game.canceledCcs[card];
}

/**
 * C14: After a CC is played, check if opponent has Comm Disruption in hand
 * and prompt them to play it reactively.
 * @param {object} game - Game state
 * @param {string} gameId - Game ID
 * @param {number} playerNum - Player who just played a CC
 * @param {string} card - Name of the CC that was just played
 * @param {object} client - Discord client
 * @param {Function} logGameAction
 * @param {Function} saveGames
 */
/**
 * Optional `combatSnapshot` arg (slice 5.7 / #77 follow-up): a deep clone of
 * `game.pendingCombat` taken BEFORE the CC's effects mutated combat state.
 * If the opponent plays CD, handleCommDisruptionPlay restores from this
 * snapshot to revert combat-flag mutations (Brace, Tools for the Job, Aim,
 * etc.). Other game state (VP, drawn cards) is not snapshotted — those
 * cost > 0 effects survive cancellation as a known gap.
 */
async function promptCommDisruption(game, gameId, playerNum, card, client, logGameAction, saveGames, combatSnapshot) {
  // Don't prompt for Comm Disruption itself or Negation
  if (card === 'Comm Disruption' || card === 'Negation') return;
  const oppNum = opponentPlayerNum(playerNum);
  // Slice 5.5 (hidden info, destruct 2026-05-05): we used to gate the prompt
  // on `oppHand.includes('Comm Disruption')`, which leaked hand contents —
  // the absence of a prompt told the playing player their opponent did NOT
  // hold CD. Per CRR hidden-info rules the opponent must always be given
  // the option to respond. The click handler already validates hand
  // contents at click time ("Comm Disruption is no longer in your hand").
  // SPY-count and cost gates remain — those use visible board info.
  const dcEffectsData = getDcEffects() || {};
  const oppDcList = (oppNum === 1 ? game.p1DcList : game.p2DcList) || [];
  const spyCount = oppDcList.filter((dc) => {
    if (!dc || dc.defeated) return false;
    const kws = (dcEffectsData[dc.dcName]?.keywords || []).map((k) => String(k).toUpperCase());
    return kws.includes('SPY');
  }).length;
  if (spyCount <= 0) return;
  // Get the played card's cost
  const getCcEffect = (await import('../data-loader.js')).getCcEffect;
  const playedEffect = getCcEffect(card);
  const playedCost = typeof playedEffect?.cost === 'number' ? playedEffect.cost : 0;
  if (playedCost > spyCount) return; // can't cancel — cost too high
  // Prompt the opponent in their hand channel
  const oppHandId = getHandChannelId(game, oppNum);
  if (!oppHandId) return;
  try {
    const oppHandChannel = await fetchGameChannel(client, oppHandId);
    const oppId = getPlayerId(game, oppNum);
    setPendingCommDisruptionPrompt(game, { targetPlayerNum: oppNum, playedCard: card, playedBy: playerNum, gameId, combatSnapshot: combatSnapshot ?? null });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`comm_disruption_play_${gameId}`).setLabel('Play Comm Disruption').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`comm_disruption_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await withDiscordRetry(() => oppHandChannel.send(sanitizeMentions({
      content: `<@${oppId}> Your opponent played **${card}** (cost ${playedCost}). You have **${spyCount}** friendly SPY group${spyCount !== 1 ? 's' : ''}. Play **Comm Disruption** to cancel it?`,
      components: [row],
      allowedMentions: { users: [oppId] },
    })));
    saveGames(game.gameId);
  } catch (err) {
    // Non-fatal: if we can't prompt, the game continues
    console.error('[Comm Disruption] Failed to prompt opponent:', err.message);
  }
}

/**
 * Unified "a CC was played" trigger subroutine (alexanbv 2026-06-14): fires
 * every on-CC-play ability for the player who just played, regardless of the
 * card's cost. Previously these fired only on the cost>0 path, so a cost-0 CC
 * never triggered Kallus Hunt Dissent / Blaise Adapt — this consolidates them
 * into one call used by both paths. (The Negation/Comm-Disruption counter-
 * window is the other half of the CC-play subroutine — see the cost-gated
 * Negation block + promptCommDisruption.)
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

/**
 * The single "a CC was played" subroutine (alexanbv 2026-06-14): run on EVERY
 * CC play, in order — (1) fire on-CC-play triggers, then (2) open the opponent's
 * counter-window: Negation when the card cost 0, and Comm Disruption when the
 * card's cost ≤ the opponent's friendly SPY groups. The CC's own effect is
 * resolved by the caller (immediately for cost>0; deferred until the Negation
 * window closes for cost-0).
 * @param {object} deps { handChannel, logMsg }
 */
export async function onCcPlayed(game, gameId, playerNum, card, cost, interaction, ctx, { handChannel, logMsg, combatSnapshot = null } = {}) {
  const { logGameAction, saveGames } = ctx;
  // (1) on-CC-play triggers
  await runCcPlayTriggers(game, playerNum, { client: interaction.client, logGameAction, dcMessageMeta: ctx.dcMessageMeta, saveGames });
  // (1b) [Smuggling Compartment] Part 1: before this CC resolves, its owner's
  // opponent — if they field an un-exhausted [Smuggling Compartment] — may
  // exhaust it to set aside Command cards from hand (returned at the start of
  // their next activation or the next phase). alexanbv 2026-06-17.
  await offerSmugglingCompartmentSetAside(game, gameId, opponentPlayerNum(playerNum), card, interaction.client);
  // (2) counter-window — Negation (cost 0)
  if (cost === 0 && ctx.getNegationResponseButtons) {
    setPendingNegation(game, { playedBy: playerNum, card, fromDc: false, handChannelId: handChannel?.id });
    const oppNum = opponentPlayerNum(playerNum);
    const oppHandChannel = await fetchGameChannel(interaction.client, getHandChannelId(game, oppNum));
    if (oppHandChannel) {
      await oppHandChannel.send(sanitizeMentions({
        content: `Your opponent played **${card}** (cost 0). You may play **Negation** to cancel it.`,
        components: [ctx.getNegationResponseButtons(gameId)],
        allowedMentions: { users: [getPlayerId(game, oppNum)] },
      })).catch(discordCatch);
    }
    await logGameAction(game, interaction.client, `Waiting for opponent to respond to **${card}**...`, { phase: 'ACTION', icon: 'hourglass' });
    const waitingMsg = handChannel ? await withDiscordRetry(() => handChannel.send({
      content: `⏳ **${card}** played — waiting for opponent to respond (Negation window open). You'll be notified here when it resolves.`,
    })).catch(() => null) : null;
    if (waitingMsg) updatePendingNegation(game, (p) => { p.waitingMsgId = waitingMsg.id; });
  }
  // (2) counter-window — Comm Disruption (cost ≤ opponent's friendly SPY groups;
  // gated inside). combatSnapshot lets a CD-cancel revert combat-modifying CCs
  // (Wild Attack's dice, etc.) played from the combat gate (alexanbv 2026-06-16).
  await promptCommDisruption(game, gameId, playerNum, card, interaction.client, logGameAction, saveGames, combatSnapshot);
}

/**
 * [Smuggling Compartment] Part 1 — offer the owner a reaction to set aside CCs
 * from hand before an opponent's Command card resolves. Posted privately to the
 * owner's hand channel; gated on an un-exhausted, alive copy and a non-empty
 * hand. The owner clicks → picks cards → they leave hand until the next
 * activation/phase. alexanbv 2026-06-17.
 * @param {object} game
 * @param {string} gameId
 * @param {number} ownerNum - the [Smuggling Compartment] owner (opponent of the player who played)
 * @param {string} card - the CC the opponent just played
 * @param {import('discord.js').Client} client
 */
export async function offerSmugglingCompartmentSetAside(game, gameId, ownerNum, card, client) {
  const scMid = findSmugglingCompartmentMsgId(getDcList(game, ownerNum), getDcMessageIds(game, ownerNum));
  if (!scMid) return;
  if (cardNameIncludes(game.exhaustedSkirmishUpgrades?.[scMid], 'Smuggling Compartment')) return; // already exhausted
  const hand = game[ccHandKey(ownerNum)] || [];
  if (hand.length === 0) return;
  const handChId = getHandChannelId(game, ownerNum);
  if (!handChId) return;
  try {
    const ch = await fetchGameChannel(client, handChId);
    if (!ch) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sc_setaside_${gameId}_${ownerNum}`).setLabel('Set aside CCs (Smuggling Compartment)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`sc_setaside_skip_${gameId}_${ownerNum}`).setLabel('No').setStyle(ButtonStyle.Secondary),
    );
    await ch.send(sanitizeMentions({
      content: `Your opponent played **${card}**. **[Smuggling Compartment]** — you may exhaust it to set aside any number of Command cards from your hand (returned to hand at the start of your next activation or the next phase).`,
      components: [row],
      allowedMentions: { users: [getPlayerId(game, ownerNum)] },
    })).catch(discordCatch);
  } catch (err) {
    console.error('Smuggling Compartment set-aside offer error:', err);
  }
}

/** [Smuggling Compartment] Part 1 — owner declined the set-aside reaction. */
export async function handleScSetAsideSkip(interaction, ctx) {
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_setaside_skip_');
  const game = await requireGame(interaction, getGame, parts[0]);
  if (!game) return;
  await interaction.message.edit({ content: '**[Smuggling Compartment]** — set-aside declined.', components: [] }).catch(discordCatch);
}

/**
 * [Smuggling Compartment] Part 1 — owner opted to set aside: present a
 * multi-select of their hand. The card is exhausted on confirm, not on open, so
 * a cancel/empty pick costs nothing.
 */
export async function handleScSetAsideOpen(interaction, ctx) {
  const { getGame } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_setaside_');
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
    return;
  }
  // De-duplicate option values (a hand can hold duplicates) so the select is valid.
  const seen = new Set();
  const opts = [];
  for (const c of hand) {
    if (seen.has(c)) continue;
    seen.add(c);
    opts.push(new StringSelectMenuOptionBuilder().setLabel(c.slice(0, 100)).setValue(c));
    if (opts.length >= 25) break;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`sc_setaside_confirm_${gameId}_${ownerNum}`)
    .setPlaceholder('Choose Command cards to set aside')
    .setMinValues(1)
    .setMaxValues(opts.length)
    .addOptions(opts);
  await interaction.message.edit({
    content: '**[Smuggling Compartment]** — choose Command cards to set aside (returned at the start of your next activation or the next phase):',
    components: [new ActionRowBuilder().addComponents(select)],
  }).catch(discordCatch);
}

/**
 * [Smuggling Compartment] Part 1 — owner confirmed which CCs to set aside.
 * Exhaust the card, move the chosen cards out of hand into the set-aside pile,
 * and refresh the hand. Returned by handleConfirmActivate / setRoundPhase.
 */
export async function handleScSetAsideConfirm(interaction, ctx) {
  const { getGame, saveGames, logGameAction } = ctx;
  const parts = splitCustomId(interaction.customId, 'sc_setaside_confirm_');
  const gameId = parts[0];
  const ownerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== getPlayerId(game, ownerNum)) {
    await interaction.followUp({ content: 'Only the card owner can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch); // select interactions are not auto-deferred
  const chosen = interaction.values || [];
  const handKey = ccHandKey(ownerNum);
  const { hand: newHand, setAside } = setAsideFromHand(game[handKey] || [], chosen);
  if (setAside.length === 0) {
    await interaction.message.edit({ content: '**[Smuggling Compartment]** — nothing set aside.', components: [] }).catch(discordCatch);
    return;
  }
  // Exhaust the card now that the reaction is committed.
  const scMid = findSmugglingCompartmentMsgId(getDcList(game, ownerNum), getDcMessageIds(game, ownerNum));
  if (scMid) exhaustAttachment(game, scMid, 'Smuggling Compartment');
  game[handKey] = newHand;
  game.smugglingCompartmentSetAside = game.smugglingCompartmentSetAside || {};
  game.smugglingCompartmentSetAside[ownerNum] = [...(game.smugglingCompartmentSetAside[ownerNum] || []), ...setAside];
  await interaction.message.edit({
    content: `**[Smuggling Compartment]** — set aside **${setAside.length}** Command card${setAside.length === 1 ? '' : 's'}. They return to your hand at the start of your next activation or the next phase.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, interaction.client, `**[Smuggling Compartment]** — P${ownerNum} exhausted to set aside ${setAside.length} Command card${setAside.length === 1 ? '' : 's'}.`, { phase: 'ACTION', icon: 'card' });
  try { await refreshHandAndDiscard(game, ownerNum, interaction.client); } catch { /* best-effort */ }
  saveGames(game.gameId);
}

// ── [Smuggling Compartment] before a hand-affecting CC's effect (post-counter-window) ──
// Resume the deferred CC effect after the owner sets aside (or skips).
async function _resumeScCcEffect(game, ctx, client) {
  const pend = game.pendingScCc;
  if (!pend) { ctx.saveGames(game.gameId); return; }
  delete game.pendingScCc;
  const { resolveAbility, dcMessageMeta, dcHealthState } = ctx;
  if (resolveAbility) {
    const result = resolveAbility(pend.abilityId, { game, playerNum: pend.playedBy, cardName: pend.card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat, msgId: pend.msgId });
    await applyAbilityResult(result, { game, playerNum: pend.playedBy, msgId: pend.fromDc ? pend.msgId : undefined, client, ctx });
  }
  if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
  ctx.saveGames(game.gameId);
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
  await interaction.message.delete().catch(discordCatch);
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
  await interaction.message.delete().catch(discordCatch);
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
    await interaction.message.delete().catch(discordCatch);
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
    await interaction.message.delete().catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  if (!isCcPlayableNow(game, playerNum, card)) {
    await interaction.followUp({ content: "That card can't be played right now (wrong timing).", ephemeral: true }).catch(discordCatch);
    await interaction.message.delete().catch(discordCatch);
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
    await interaction.message.delete().catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Mara Jade Fast Learner picker: when both the named figure AND Mara are
  // in army with FL unused this round, the player must choose who plays the
  // CC. Re-entry from the picker has _flResolved set; skip on re-entry.
  if (!_flResolved) {
    const { getFastLearnerPickerEligibility } = await import('../game/unique-figure-ccs.js');
    const eligibility = getFastLearnerPickerEligibility(game, playerNum, card);
    if (eligibility.shouldPrompt) {
      const { presentFastLearnerPicker } = await import('./fast-learner-picker.js');
      await presentFastLearnerPicker(interaction, game, playerNum, card, eligibility);
      saveGames(game.gameId);
      return;
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
    await interaction.message.delete().catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Track how many CCs played during this attack (for "first CC" conditions like Assassinate)
  if (_cbt) _cbt.attackCcCount = (_cbt.attackCcCount || 0) + 1;
  // Slice 5.1: push the CC onto the counter-window stack so future
  // Negation/CD/recursive counters can resolve against it. Combat-scoped
  // for now; non-combat CC counter-window deferred.
  recordCcOnCombatStack(game, playerNum, card);
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
  // Combat-order telemetry (slice 4.13, soft-warn mode): classify the CC
  // against the canonical CRR step it should fire at per destruct's
  // 2026-05-05 audit, and log a mismatch when pendingCombat.currentStep
  // disagrees. The warning is now ALSO surfaced to the game log channel (not
  // just console) so destruct + adam can see real-game telemetry.
  //
  // Why this is soft-warn rather than validate-or-throw: the registry is
  // currently 27 cards (out of ~200 in the game). Unregistered cards are
  // benign-skipped here. For registered cards with nuanced sub-step timing
  // (Hunter Protocol declares Step 4, effect persists Step 5; Lando trio's
  // pre/post-reroll split; etc.) the validator is intentionally permissive
  // — escalating to throw without finishing the registry + a clean
  // sim:discord shadow run would block legitimate plays. Escalation queued
  // for the slice that completes the registry + parallel-shadow sim.
  if (_cbt) {
    const _classification = classifyCcStep(card);
    if (_classification) {
      const _legacyStep = _cbt.currentStep || '(unknown)';
      const _matches = _classification.step === 'counter-window'
        || _classification.step === _legacyStep;
      const _tag = _matches ? 'ok' : 'WARN';
      console.log(`[combat-order ${_tag}] CC '${card}' played at legacy step '${_legacyStep}' — canonical step '${_classification.step}' (${_classification.side}). reason: ${_classification.reason}`);
      // Slice 4.13 (destruct 2026-05-06): the canonical step transitions
      // are now wired (slices 4.7-4.12) and locked by audit test
      // currentstep-transition-audit.test.js. Surface mismatches both as
      // a console warn AND a game-log entry. Strict-throw mode is
      // available via env IACP_COMBAT_ORDER_STRICT=1 (used in CI / tests
      // but NOT default in production — a runtime throw would break
      // legitimate plays of cards we haven't audited yet, since the
      // registry is currently 27/~200 cards).
      if (!_matches && logGameAction && client) {
        await logGameAction(game, client,
          `⚠️ **[combat-order]** \`${card}\` played at \`${_legacyStep}\` — canonical step is \`${_classification.step}\` (${_classification.side}). reason: ${_classification.reason}`,
          { phase: 'ROUND', icon: 'card' }
        ).catch(discordCatch);
      }
      if (!_matches && process.env.IACP_COMBAT_ORDER_STRICT === '1') {
        throw new Error(
          `[combat-order strict] CC '${card}' played at '${_legacyStep}' but canonical step is '${_classification.step}'. ${_classification.reason}`,
        );
      }
    }
  }
  // Fast Learner (Mara Jade): mark FL used when either (a) the legality
  // check granted FL bypass (named figure NOT in army, Mara substituted) or
  // (b) the picker resolved to Mara when both figures were in army.
  if (restriction.fastLearner || _flResolved === 'mara') {
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

  // For cost > 0 with an ability: try to resolve before moving the card. If we can't apply (timing/context),
  // prompt "We don't think you can do this right now" with [Play anyway] / [Unplay] so the card isn't consumed.
  if (cost !== 0 && ctx.resolveAbility) {
    // Slice #77 (destruct 2026-05-06): snapshot pendingCombat BEFORE
    // resolveAbility mutates combat-flag state. If opponent CDs the play,
    // handleCommDisruptionPlay restores from this snapshot — undoing
    // Brace's added die, Tools for the Job's flag, Aim's bonus, etc.
    // VP / drawn cards aren't snapshotted (known gap).
    const _ccPreSnap = game.pendingCombat
      ? JSON.parse(JSON.stringify(game.pendingCombat))
      : null;
    const result = ctx.resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, dcExhaustedState: ctx.dcExhaustedState, combat: game.combat || game.pendingCombat });
    if (result.requiresChoice && result.choiceOptions?.length > 0) {
      // Choice required: we must commit the play first, then send choice buttons.
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = game[discardKey] || [];
      game[discardKey].push(card);
      // C57: De Wanna Wanga passive reshuffle
      { const _dww = checkHandDiscardPassiveReshuffle(game, playerNum, card);
        if (_dww.reshuffled && logGameAction) await logGameAction(game, interaction.client, `**De Wanna Wanga** (passive) — Shuffled back into command deck.`, { phase: 'ROUND', icon: 'card' }); }
      const handChannel = await fetchGameChannel(interaction.client, isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(game[handKey], deck, gameId, game, playerNum);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch(discordCatch);
      }
      await interaction.message.delete().catch(discordCatch);
      await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
      const effectDesc = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card });
      // choiceForControllerPlayerNum (Dirty Trick): per CRR, the choice
      // belongs to the TARGET'S CONTROLLER (opponent of the card player).
      // Route the prompt to that player's hand channel and stamp
      // clickerPlayerNum so the click handler validates against the
      // opponent rather than the card player.
      const _clickerPN = result.choiceForControllerPlayerNum ?? playerNum;
      const _isOpponentChoice = _clickerPN !== playerNum;
      setPendingCcChoice(game, {
        abilityId,
        choiceOptions: result.choiceOptions,
        gameId,
        playerNum,
        card,
        ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}),
        ...(_isOpponentChoice ? { clickerPlayerNum: _clickerPN } : {}),
      });
      const btns = result.choiceOptions.map((opt) => {
        const label = String(opt).slice(0, 80);
        return new ButtonBuilder().setCustomId(`cc_choice_${gameId}_${opt}`).setLabel(label).setStyle(ButtonStyle.Secondary);
      });
      const rows = chunkButtonsToRows(btns);
      const _promptChannel = _isOpponentChoice
        ? await fetchGameChannel(interaction.client, _clickerPN === 1 ? game.p1HandId : game.p2HandId).catch(() => handChannel)
        : handChannel;
      const _promptHeader = _isOpponentChoice
        ? `**${card}** — your figure was targeted; choose one:`
        : `**Choose one** (for **${card}**):`;
      await _promptChannel.send({ content: _promptHeader, components: rows }).catch(discordCatch);
      // C14: Comm Disruption — prompt opponent. Pass pre-resolveAbility
      // combat snapshot so CD-cancel can revert combat-flag mutations.
      await promptCommDisruption(game, gameId, playerNum, card, interaction.client, logGameAction, saveGames, _ccPreSnap);
      saveGames(game.gameId);
      return;
    }
    if (result.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
      // Space choice required: commit play, then send space grid + map (reusable pick-a-space pattern).
      const { getBoardStateForMovement, getMapAttachmentForSpaces } = ctx;
      if (!getBoardStateForMovement || !getMapAttachmentForSpaces) {
        await interaction.followUp({ content: 'Space choice not supported (missing helpers). Resolve manually.', ephemeral: true }).catch(discordCatch);
        return;
      }
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = game[discardKey] || [];
      game[discardKey].push(card);
      // C57: De Wanna Wanga passive reshuffle
      { const _dww = checkHandDiscardPassiveReshuffle(game, playerNum, card);
        if (_dww.reshuffled && logGameAction) await logGameAction(game, interaction.client, `**De Wanna Wanga** (passive) — Shuffled back into command deck.`, { phase: 'ROUND', icon: 'card' }); }
      const handChannel = await fetchGameChannel(interaction.client, isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(game[handKey], deck, gameId, game, playerNum);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch(discordCatch);
      }
      await interaction.message.delete().catch(discordCatch);
      await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
      const effectDesc2 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc2}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card });
      setPendingCcSpaceChoice(game, { abilityId, gameId, playerNum, card, validSpaces: result.validSpaces, chosenFigureKey: result.chosenFigureKey ?? null });
      const boardState = getBoardStateForMovement(game, null);
      const ccMapSpaces = boardState?.mapSpaces || { spaces: result.validSpaces };
      const ccHeader = `**Pick a space** (for **${card}**)`;
      const ccContextKey = gameId;
      game.pendingSpacePick = game.pendingSpacePick || {};
      game.pendingSpacePick[ccContextKey] = {
        validSpaces: result.validSpaces,
        cellPrefix: `cc_space_${gameId}_`,
        mapSpaces: ccMapSpaces,
        headerText: ccHeader,
      };
      const { rows: ccRowBtns } = buildRowPickerButtons(result.validSpaces, `space_row_${ccContextKey}_`);
      const mapAttachment = await getMapAttachmentForSpaces(game, result.validSpaces);
      const payload = { content: `${ccHeader}:\nChoose a row:`, components: ccRowBtns.slice(0, 5), fetchReply: true };
      if (mapAttachment) payload.files = [mapAttachment];
      await handChannel.send(payload).catch(discordCatch);
      // C14: Comm Disruption — prompt opponent. Pass pre-resolveAbility
      // combat snapshot so CD-cancel can revert combat-flag mutations.
      await promptCommDisruption(game, gameId, playerNum, card, interaction.client, logGameAction, saveGames, _ccPreSnap);
      saveGames(game.gameId);
      return;
    }
    if (result.applied) {
      // Effect applied: resolveAbility already mutated game (e.g. drew cards); remove played card from current hand and add to discard.
      const handNow = (game[handKey] || []).slice();
      const idxNow = handNow.indexOf(card);
      if (idxNow >= 0) handNow.splice(idxNow, 1);
      game[handKey] = handNow;
      game[discardKey] = (game[discardKey] || []).concat(card);
      const handChannel = await fetchGameChannel(interaction.client, isP1Hand ? game.p1HandId : game.p2HandId);
      const handMessages = await handChannel.messages.fetch({ limit: 20 });
      const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
      const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
      if (handMsg) {
        const handPayload = buildHandDisplayPayload(game[handKey], deck, gameId, game, playerNum);
        const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
        handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
        await handMsg.edit({ content: handPayload.content, embeds: handPayload.embeds, files: handPayload.files || [], components: handPayload.components }).catch(discordCatch);
      }
      await interaction.message.delete().catch(discordCatch);
      await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
      const effectDesc3 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
      const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc3}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
      await applyAbilityResult(result, { game, playerNum, client: interaction.client, ctx });
      if (result.requiresPowerTokenChoice && game.pendingPowerTokenGrant?.channelId === null) {
        const handChannelId2 = getHandChannelId(game, playerNum);
        if (handChannelId2) {
          game.pendingPowerTokenGrant.channelId = handChannelId2;
          const ptCh = await fetchGameChannel(interaction.client, handChannelId2);
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
      if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
      if (result.revealToPlayer) {
        await interaction.followUp({ content: result.revealToPlayer, ephemeral: true }).catch(discordCatch);
      }
      // Behind Enemy Lines reorder: if result has requiresReorder, post card-order picker buttons
      if (result.requiresReorder?.cards?.length > 1) {
        const _belCards = result.requiresReorder.cards;
        const _belDeckKey = result.requiresReorder.deckKey;
        setPendingBELReorder(game, { deckKey: _belDeckKey, cards: _belCards, picked: [], playerNum, gameId });
        const _belBtns = _belCards.map((c, i) =>
          new ButtonBuilder()
            .setCustomId(`bel_reorder_1_${gameId}_${i}`)
            .setLabel(`1st: ${c}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        const _belHandId = getHandChannelId(game, playerNum);
        const _belHandCh = await fetchGameChannel(interaction.client, _belHandId);
        await _belHandCh.send({
          content: `**Behind Enemy Lines** — Choose which card goes **on top** of the opponent's deck:`,
          components: [new ActionRowBuilder().addComponents(..._belBtns.slice(0, 5))],
        }).catch(discordCatch);
      }
      // Windfall is discard-triggered now (fireCcDiscarded), not play-triggered —
      // the old windfallActive VP-on-every-play logic was removed (alexanbv 2026-06-17).
      // C14: Comm Disruption — prompt opponent. Pass pre-resolveAbility
      // combat snapshot so CD-cancel can revert combat-flag mutations
      // (Brace, Tools for the Job, Aim, etc.).
      await promptCommDisruption(game, gameId, playerNum, card, interaction.client, logGameAction, saveGames, _ccPreSnap);
      saveGames(game.gameId);
      return;
    }
    if (!result.applied && result.manualMessage) {
      // Timing/context mismatch: don't move the card; ping in hand with Play anyway / Unplay (same as illegal-CC flow).
      setPendingIllegalCcPlay(game, { playerNum, card, reason: result.manualMessage, fromContext: true });
      const handId = getHandChannelId(game, playerNum);
      const handChannel = await fetchGameChannel(client, handId);
      const msg = await withDiscordRetry(() => handChannel.send({
        content: `We don't think you can do this right now: ${result.manualMessage}\n\nChoose **Ignore and play** to play it anyway (resolve manually), or **Unplay** to cancel.`,
        components: [getIllegalCcPlayButtons(gameId)],
      }));
      game.pendingIllegalCcPlay.messageId = msg.id;
      await interaction.message.delete().catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
  }

  // Cost 0 (negation flow) or no resolveAbility / effect didn't need pre-check: move card first, then resolve/log as before.
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);
  // C57: De Wanna Wanga passive — once per round, when discarded from hand, shuffle into deck instead
  const _dwwResult = checkHandDiscardPassiveReshuffle(game, playerNum, card);
  if (_dwwResult.reshuffled && logGameAction) {
    await logGameAction(game, interaction.client, `**De Wanna Wanga** (passive) — Shuffled back into command deck instead of staying in discard.`, { phase: 'ROUND', icon: 'card' });
  }
  const handChannel = await fetchGameChannel(interaction.client, isP1Hand ? game.p1HandId : game.p2HandId);
  const handMessages = await handChannel.messages.fetch({ limit: 20 });
  const handMsg = handMessages.find((m) => m.author.bot && (m.content?.includes('Hand:') || m.content?.includes('Hand (')) && (m.components?.length > 0 || m.embeds?.some((e) => e.title?.includes('Command Cards'))));
  const deck = playerNum === 1 ? (game.player1CcDeck || []) : (game.player2CcDeck || []);
  if (handMsg) {
    const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
    const effectReminder = effectData?.effect ? `\n**Apply effect:** ${effectData.effect}` : '';
    handPayload.content = `**Command Cards** — Played **${card}**.${effectReminder}\n\n` + handPayload.content;
    await handMsg.edit({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    }).catch(discordCatch);
  }
  await interaction.message.delete().catch(discordCatch);
  await refreshHandAndDiscard(game, playerNum, interaction.client, ctx);
  const effectDesc4 = effectData?.effect ? `\n> *${effectData.effect}*` : '';
  const logMsg = await logGameAction(game, interaction.client, `<@${interaction.user.id}> played command card **${card}**.${effectDesc4}`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  if (cost === 0 && ctx.getNegationResponseButtons) {
    // Cost-0: effect is DEFERRED until the Negation window closes. Record undo,
    // then run the unified CC-play subroutine (triggers + Negation/Comms).
    if (ctx.pushUndo) ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
    await onCcPlayed(game, gameId, playerNum, card, cost, interaction, ctx, { handChannel, logMsg });
    saveGames(game.gameId);
    return;
  }
  if (ctx.resolveAbility) {
    const result = ctx.resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, dcExhaustedState: ctx.dcExhaustedState, combat: game.combat || game.pendingCombat });
    await applyAbilityResult(result, { game, playerNum, client: interaction.client, ctx });
    if (result.revealToPlayer) {
      await interaction.followUp({ content: result.revealToPlayer, ephemeral: true }).catch(discordCatch);
    }
  }
  // Windfall is now a discard-triggered effect (fireCcDiscarded), not a
  // play-time flag — the old windfallActive VP-on-every-play logic was removed
  // (alexanbv 2026-06-17: "Windfall should not need a flag... does NOT count
  // when a CC is used/played").
  if (ctx.pushUndo) {
    ctx.pushUndo(game, { type: 'cc_play', gameId, playerNum, card, gameLogMessageId: logMsg?.id });
  }
  // Cost>0: effect already resolved above. Run the unified CC-play subroutine
  // (triggers + counter-window; Negation is skipped since cost>0).
  await onCcPlayed(game, gameId, playerNum, card, cost, interaction, ctx, { handChannel, logMsg });
  saveGames(game.gameId);
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
  await interaction.message.delete().catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * C14: Handler for "Play Comm Disruption" button.
 * Plays Comm Disruption from the opponent's hand to cancel the played card.
 */
export async function handleCommDisruptionPlay(interaction, ctx) {
  const { getGame, getCcEffect, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'comm_disruption_play_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingCommDisruptionPrompt;
  if (!pending) {
    await interaction.followUp({ content: 'No Comm Disruption prompt pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { targetPlayerNum, playedCard, playedBy } = pending;
  if (!await requirePlayer(interaction, game, interaction.user.id, targetPlayerNum, canActAsPlayer, 'Only the prompted player can respond.')) return;
  clearPendingCommDisruptionPrompt(game);

  // Remove Comm Disruption from hand and add to discard
  const handKey = ccHandKey(targetPlayerNum);
  const discardKey = ccDiscardKey(targetPlayerNum);
  const hand = (game[handKey] || []).slice();
  const cdIdx = hand.indexOf('Comm Disruption');
  if (cdIdx < 0) {
    await interaction.followUp({ content: 'Comm Disruption is no longer in your hand.', ephemeral: true }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Slice 5.8 (destruct 2026-05-05, "SPY count locked at play time"):
  // re-validate SPY count + cost AT CLICK TIME, not at prompt-post time.
  // SPYs may have died between prompt and click — the rule is that the
  // CD player's count is whatever it is the moment they decide to play
  // it, then locked through resolution.
  const dcEffectsData = getDcEffects() || {};
  const cdDcList = (targetPlayerNum === 1 ? game.p1DcList : game.p2DcList) || [];
  const cdSpyCount = cdDcList.filter((dc) => {
    if (!dc || dc.defeated) return false;
    const kws = (dcEffectsData[dc.dcName]?.keywords || []).map((k) => String(k).toUpperCase());
    return kws.includes('SPY');
  }).length;
  const playedEffectAtClick = getCcEffect ? getCcEffect(playedCard) : null;
  const playedCostAtClick = typeof playedEffectAtClick?.cost === 'number' ? playedEffectAtClick.cost : 0;
  if (cdSpyCount <= 0 || playedCostAtClick > cdSpyCount) {
    await interaction.followUp({ content: `Cannot play Comm Disruption: cost ${playedCostAtClick} exceeds your **${cdSpyCount}** friendly SPY group${cdSpyCount === 1 ? '' : 's'}.`, ephemeral: true }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  hand.splice(cdIdx, 1);
  game[handKey] = hand;
  game[discardKey] = (game[discardKey] || []).concat('Comm Disruption');

  // Slice 5.7: mark the canceled CC so downstream code (Negation
  // let-resolve, applyAbilityResult callers, "when discarded" hooks)
  // can skip ALL its effects per destruct 2026-05-05.
  markTopCcCanceled(game, playedCard);
  // Slice #77: revert combat-flag mutations baked in by resolveAbility
  // before the CD prompt opened. The snapshot was taken pre-resolve in
  // handleCcConfirmPlay's cost > 0 path. Brace's added die, Tools for
  // the Job's flag, Aim's bonus etc. live on pendingCombat — restoring
  // the pre-resolve snapshot reverts them. VP / drawn-card mutations
  // are NOT reverted (known gap).
  if (pending.combatSnapshot && game.pendingCombat) {
    game.pendingCombat = pending.combatSnapshot;
  }
  // Dual-prompt race fix: a cost-0 CC can be targeted by both Negation
  // and Comm Disruption simultaneously. CD canceling means Negation must
  // not subsequently resolveAbility on let-resolve. Clear pendingNegation
  // here; handleNegationLetResolve also reads isCcCanceled as a backstop.
  if (game.pendingNegation && game.pendingNegation.card === playedCard) {
    clearPendingNegation(game);
  }
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await refreshHandAndDiscard(game, targetPlayerNum, interaction.client, ctx);
  await logGameAction(game, interaction.client, `**Comm Disruption** — <@${interaction.user.id}> cancelled **${playedCard}** (locked at ${cdSpyCount} SPY)! Discard that card and cancel ALL its effects (including any "when discarded" triggers).`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  saveGames(game.gameId);
}

/**
 * C14: Handler for "Skip" Comm Disruption button.
 */
export async function handleCommDisruptionSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'comm_disruption_skip_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  clearPendingCommDisruptionPrompt(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
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
  if (resolveAbility) {
    const abilityId = effectData?.abilityId ?? card;
    const result = resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat });
    await applyAbilityResult(result, { game, playerNum, client, ctx });
  }
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
  // Slice 5.7 follow-up: suppress effect-firing if a counter (Negation/CD)
  // canceled this CC while the space-pick prompt was open.
  if (pending.card && isCcCanceled(game, pending.card)) {
    clearPendingCcSpaceChoice(game);
    clearCcCanceled(game, pending.card);
    if (logGameAction) {
      await logGameAction(game, client, `**${pending.card}** space choice ignored — card was cancelled by a counter.`, { phase: 'ACTION', icon: 'card' }).catch(discordCatch);
    }
    saveGames(game.gameId);
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
  // Slice 5.7 follow-up (destruct 2026-05-06): if a counter-window play
  // (Negation or CD) canceled this CC while the choice prompt was still
  // open, suppress effect-firing entirely. Without this, a slow user
  // could click the choice button after the cancel and re-fire the
  // effect that should have been suppressed.
  if (pending.card && isCcCanceled(game, pending.card)) {
    clearPendingCcChoice(game);
    clearCcCanceled(game, pending.card);
    await interaction.message.edit({
      content: `**${pending.card}** was cancelled by a counter — choice ignored, no effect.`,
      components: [],
    }).catch(discordCatch);
    if (logGameAction) {
      await logGameAction(game, client, `**${pending.card}** choice ignored — card was cancelled by a counter before the choice resolved.`, { phase: 'ACTION', icon: 'card' }).catch(discordCatch);
    }
    saveGames(game.gameId);
    return;
  }
  const result = resolveAbility(pending.abilityId, {
    game,
    playerNum,
    dcMessageMeta,
    dcHealthState,
    dcExhaustedState,
    choiceIndex,
    chosenOption,
    chosenFigureKey: pending.choiceValues?.[choiceIndex] ?? null,
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

/** @param {import('discord.js').ButtonInteraction} interaction — "Play Negation" to cancel opponent's cost-0 CC. */
export async function handleNegationPlay(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames, resolveAbility, dcMessageMeta, dcHealthState } = ctx;
  const gameId = parseCustomId(interaction.customId, 'negation_play_');
  const game = getGame(gameId);
  if (!game || !game.pendingNegation) {
    await interaction.followUp({ content: 'No pending play to negate.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playedBy, card, waitingMsgId, handChannelId, counterTargetCard, counterTargetPlayedBy } = game.pendingNegation;
  const oppNum = opponentPlayerNum(playedBy);
  // Slice 5.6: detect counter-Negation. If this pending was set up as a
  // counter against opponent's Negation, the player clicking is the
  // ORIGINAL playedBy (counterTargetPlayedBy) — they're countering the
  // counter. Effect: cancel the Negation (which was canceling
  // counterTargetCard), uncancel counterTargetCard, resolve it normally.
  const _isCounterNegation = card === 'Negation' && counterTargetCard != null;
  if (!await requirePlayer(interaction, game, interaction.user.id, oppNum, canActAsPlayer, 'Only the opponent can play Negation.')) return;
  const handKey = ccHandKey(oppNum);
  const discardKey = ccDiscardKey(oppNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf('Negation');
  if (idx < 0) {
    await interaction.followUp({ content: "You don't have Negation in your hand.", ephemeral: true }).catch(discordCatch);
    return;
  }
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Negation');
  clearPendingNegation(game);
  // Slice 5.6: counter-Negation — the previously-played Negation gets
  // canceled, restoring the originally-targeted CC. Resolve that CC's
  // effect now via resolveAbility.
  if (_isCounterNegation && counterTargetCard) {
    unmarkTopCcCanceled(game, counterTargetCard);
    await refreshHandAndDiscard(game, oppNum, client, ctx);
    await interaction.message.edit({ content: `**Counter-Negation** — your **Negation** was countered. **${counterTargetCard}** resolves.`, components: [] }).catch(discordCatch);
    const _negPlayerId2 = getPlayerId(game, oppNum);
    await logGameAction(game, client, `<@${_negPlayerId2}> played **Negation** to counter — **${counterTargetCard}** resolves.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [_negPlayerId2] } });
    if (resolveAbility) {
      const effectData = getCcEffect ? getCcEffect(counterTargetCard) : null;
      const abilityId = effectData?.abilityId ?? counterTargetCard;
      const result = resolveAbility(abilityId, { game, playerNum: counterTargetPlayedBy, cardName: counterTargetCard, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat });
      await applyAbilityResult(result, { game, playerNum: counterTargetPlayedBy, client, ctx });
    }
    // Counter-Negation resolved a CC that may have granted VP. Re-check
    // win conditions (deferred while negation prompt was pending).
    if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
    saveGames(game.gameId);
    return;
  }
  // Slice 5.7: mark the canceled CC so downstream effect-firing code
  // skips ALL its effects (including "when discarded" triggers) per
  // destruct 2026-05-05.
  markTopCcCanceled(game, card);
  // Dual-prompt race fix: clear any pending CD prompt for the same card.
  if (game.pendingCommDisruptionPrompt && game.pendingCommDisruptionPrompt.playedCard === card) {
    clearPendingCommDisruptionPrompt(game);
  }
  await refreshHandAndDiscard(game, oppNum, client, ctx);
  await interaction.message.edit({ content: `**Negation** cancelled **${card}**.`, components: [] }).catch(discordCatch);
  const negPlayerId = getPlayerId(game, oppNum);
  await logGameAction(game, client, `<@${negPlayerId}> played **Negation** — cancelled **${card}** (all effects suppressed).`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [negPlayerId] } });
  // Notify the player whose card was cancelled
  if (waitingMsgId && handChannelId) {
    const playingHandChannel = await fetchGameChannel(client, handChannelId);
    if (playingHandChannel) {
      const waitingMsg = await playingHandChannel.messages.fetch(waitingMsgId).catch(() => null);
      const playedById = getPlayerId(game, playedBy);
      if (waitingMsg) await waitingMsg.edit({ content: `❌ Your **${card}** was cancelled by your opponent's **Negation**. <@${playedById}>` }).catch(discordCatch);
    }
  }
  // Slice 5.6 (destruct 2026-05-05 — counter-on-counter recursion):
  // Negation itself is a cost-0 Command card. Per CRR + destruct, the
  // original player may respond to the opponent's Negation with their
  // own Negation (a counter-Negation), which would cancel the
  // counter-CC and restore the original card's effects.
  //
  // Re-call promptForNegation targeting the ORIGINAL player (playedBy)
  // with `card='Negation'` so the existing setPendingNegation /
  // handleNegationPlay flow handles it. The counter-Negation context
  // is captured in pendingNegation.counterTargetCard so handleNegationPlay
  // can detect this is a counter-counter case and uncancel the
  // originally-cancelled CC instead of just marking 'Negation' canceled.
  // Limit depth to 1: if the counter-Negation gets countered itself,
  // the next level falls through (rare in practice; tracked by
  // counterDepth on pendingNegation).
  const _origHandKey = ccHandKey(playedBy);
  const _origHand = game[_origHandKey] || [];
  if (_origHand.includes('Negation') || true) {
    // Hidden-info compliance: prompt regardless of hand (player may have
    // received a card via reaction etc.). Consistent with promptCommDisruption.
    setPendingNegation(game, {
      playedBy: oppNum,
      card: 'Negation',
      fromDc: false,
      msgId: null,
      wasAttachment: false,
      handChannelId: null,
      counterTargetCard: card,
      counterTargetPlayedBy: playedBy,
    });
    try {
      const _origHandId = getHandChannelId(game, playedBy);
      if (_origHandId) {
        const _origHandChannel = await fetchGameChannel(client, _origHandId);
        const _origPlayerId = getPlayerId(game, playedBy);
        await _origHandChannel.send({
          content: `<@${_origPlayerId}> Opponent played **Negation** to cancel your **${card}**. You may play your own **Negation** to counter and restore your card.`,
          components: [ctx.getNegationResponseButtons ? ctx.getNegationResponseButtons(game.gameId) : new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`negation_play_${game.gameId}`).setLabel('Play Negation (Counter)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`negation_let_resolve_${game.gameId}`).setLabel('Let it resolve').setStyle(ButtonStyle.Secondary),
          )],
          allowedMentions: { users: [_origPlayerId] },
        }).catch(discordCatch);
      }
    } catch (_e) { /* non-fatal: prompt failure leaves CC canceled */ }
  }
  saveGames(game.gameId);
}

/** @param {import('discord.js').ButtonInteraction} interaction — "Let it resolve" for pending cost-0 CC. */
export async function handleNegationLetResolve(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, updateDiscardPileMessage, logGameAction, getCcEffect, client, saveGames, resolveAbility, dcMessageMeta, dcHealthState, updateDcActionsMessage, updateAttachmentMessageForDc, isCcAttachment, ensureMovementBankMessage, updateMovementBankMessage } = ctx;
  const gameId = parseCustomId(interaction.customId, 'negation_let_resolve_');
  const game = getGame(gameId);
  if (!game || !game.pendingNegation) {
    await interaction.followUp({ content: 'No pending play to resolve.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { playedBy, card, fromDc, msgId, wasAttachment, waitingMsgId, handChannelId, counterTargetCard } = game.pendingNegation;
  const oppNum = opponentPlayerNum(playedBy);
  if (!await requirePlayer(interaction, game, interaction.user.id, oppNum, canActAsPlayer, 'Only the opponent can choose to let it resolve.')) return;
  clearPendingNegation(game);
  // Slice 5.6: counter-Negation let-resolve. The opponent's Negation
  // (canceling counterTargetCard) resolves uncountered → counterTargetCard
  // stays canceled. No resolveAbility needed — the cancel was already
  // applied by the first handleNegationPlay; we just confirm.
  if (card === 'Negation' && counterTargetCard) {
    await interaction.message.edit({ content: `**${counterTargetCard}** stays cancelled — Negation was not countered.`, components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  await interaction.message.edit({ content: `**${card}** resolves.`, components: [] }).catch(discordCatch);
  if (fromDc && msgId && wasAttachment && updateAttachmentMessageForDc && isCcAttachment?.(card)) {
    const attachKey = ccAttachmentsKey(playedBy);
    const discardKey = ccDiscardKey(playedBy);
    const discard = game[discardKey] || [];
    const idx = discard.indexOf(card);
    if (idx >= 0) {
      discard.splice(idx, 1);
      game[discardKey] = discard;
    }
    game[attachKey] = game[attachKey] || {};
    if (!Array.isArray(game[attachKey][msgId])) game[attachKey][msgId] = [];
    game[attachKey][msgId].push(card);
    await updateAttachmentMessageForDc(game, playedBy, msgId, client);
  }
  // Slice 5.7: skip resolveAbility if a parallel counter (CD) already
  // canceled this card. Without this, the dual-prompt race lets a
  // canceled CC's effects fire when Negation's "let resolve" is clicked
  // after CD already canceled.
  if (resolveAbility && !isCcCanceled(game, card)) {
    const effectData = getCcEffect(card);
    const abilityId = effectData?.abilityId ?? card;
    // [Smuggling Compartment] — for hand-affecting CCs, the target may exhaust SC
    // to set aside cards AFTER the Negate window resolves, before the effect.
    const _scTarget = opponentPlayerNum(playedBy);
    if (SC_HAND_CCS.has(card) && !game.pendingScCc && scReactionAvailable(game, _scTarget)) {
      game.pendingScCc = { abilityId, card, playedBy, msgId, fromDc };
      const offered = await offerScSetAside(game, _scTarget, client, {
        idPrefix: 'sc_cc',
        promptText: `Your opponent played **${card}**, which affects your Command hand. **[Smuggling Compartment]** — you may exhaust it to set aside cards first (returned at the start of your next activation or the next phase).`,
      });
      if (offered) { saveGames(game.gameId); return; }
      delete game.pendingScCc;
    }
    const result = resolveAbility(abilityId, { game, playerNum: playedBy, cardName: card, dcMessageMeta, dcHealthState, combat: game.combat || game.pendingCombat, msgId });
    await applyAbilityResult(result, { game, playerNum: playedBy, msgId: fromDc ? msgId : undefined, client, ctx });
  } else if (isCcCanceled(game, card)) {
    await logGameAction(game, client, `**${card}** had already been cancelled by another counter — effects suppressed.`, { phase: 'ACTION', icon: 'card' }).catch(discordCatch);
  }
  clearCcCanceled(game, card);
  // Notify the player whose card resolved
  if (waitingMsgId && handChannelId) {
    const playingHandChannel = await fetchGameChannel(client, handChannelId);
    if (playingHandChannel) {
      const waitingMsg = await playingHandChannel.messages.fetch(waitingMsgId).catch(() => null);
      const playedById = getPlayerId(game, playedBy);
      if (waitingMsg) await waitingMsg.edit({ content: `✅ **${card}** resolved! <@${playedById}>` }).catch(discordCatch);
    }
  }
  // Re-check win conditions: the resolved CC may have granted VP that
  // would end the game (was deferred while the negation prompt was
  // pending). Per alexanbv 2026-05-11.
  if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
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
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push('Celebration');
  awardObjectiveVp(game, attackerPlayerNum, 4);
  clearPendingCelebration(game);
  await refreshHandAndDiscard(game, attackerPlayerNum, client, ctx);
  await interaction.message.edit({ content: `**Celebration** — +4 VP.`, components: [] }).catch(discordCatch);
  const celPlayerId = getPlayerId(game, attackerPlayerNum);
  await logGameAction(game, client, `<@${celPlayerId}> played **Celebration** — gained 4 VP.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [celPlayerId] } });
  if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
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
  const { getCcEffect, resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState, logGameAction, updateDiscardPileMessage, getBoardStateForMovement, getMapAttachmentForSpaces, getNegationResponseButtons, client, saveGames } = ctx;
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
  // Cost 0: open the Negation window before resolving. handleNegationPlay
  // (cancels) marks the card via markTopCcCanceled — the played card stays
  // wherever it currently is (game box for excavation), per CRR. Comm
  // Disruption can also fire on cost-0 plays.
  if (cost === 0 && getNegationResponseButtons) {
    setPendingNegation(game, { playedBy: playerNum, card, fromDc: false, handChannelId: getHandChannelId(game, playerNum) });
    const oppNum = opponentPlayerNum(playerNum);
    const oppHandId = getHandChannelId(game, oppNum);
    const oppHandChannel = oppHandId ? await fetchGameChannel(client, oppHandId) : null;
    if (oppHandChannel) {
      const oppId = getPlayerId(game, oppNum);
      await oppHandChannel.send(sanitizeMentions({
        content: `Your opponent played **${card}** via **Excavation** (cost 0). You may play **Negation** to cancel it.`,
        components: [getNegationResponseButtons(gameId)],
        allowedMentions: { users: [oppId] },
      })).catch(discordCatch);
    }
    await logGameAction(game, client, `Waiting for opponent to respond to **${card}**...`, { phase: 'ACTION', icon: 'hourglass' });
    await promptCommDisruption(game, gameId, playerNum, card, client, logGameAction, saveGames);
    saveGames(game.gameId);
    return;
  }
  // Cost > 0: resolveAbility immediately, then prompt Comm Disruption.
  if (resolveAbility) {
    const _ccPreSnap = game.pendingCombat ? JSON.parse(JSON.stringify(game.pendingCombat)) : null;
    const result = resolveAbility(abilityId, { game, playerNum, cardName: card, dcMessageMeta, dcHealthState, dcExhaustedState, combat: game.combat || game.pendingCombat });
    const aarResult = await applyAbilityResult(result, { game, playerNum, client, ctx });
    if (!aarResult.handled && result.requiresChoice && Array.isArray(result.choiceOptions) && result.choiceOptions.length > 0) {
      const _clickerPN = result.choiceForControllerPlayerNum ?? playerNum;
      const _isOpponentChoice = _clickerPN !== playerNum;
      setPendingCcChoice(game, {
        abilityId, choiceOptions: result.choiceOptions, gameId, playerNum, card,
        ...(result.choiceValues ? { choiceValues: result.choiceValues } : {}),
        ...(_isOpponentChoice ? { clickerPlayerNum: _clickerPN } : {}),
      });
      const btns = result.choiceOptions.map((opt) => {
        const label = String(opt).slice(0, 80);
        return new ButtonBuilder().setCustomId(`cc_choice_${gameId}_${opt}`).setLabel(label).setStyle(ButtonStyle.Secondary);
      });
      const rows = chunkButtonsToRows(btns);
      const promptHandId = getHandChannelId(game, _clickerPN);
      const promptCh = promptHandId ? await fetchGameChannel(client, promptHandId) : null;
      const header = _isOpponentChoice
        ? `**${card}** — your figure was targeted; choose one:`
        : `**Choose one** (for **${card}**):`;
      if (promptCh) await promptCh.send({ content: header, components: rows }).catch(discordCatch);
    }
    if (!aarResult.handled && result.requiresSpaceChoice && Array.isArray(result.validSpaces) && result.validSpaces.length > 0) {
      if (getBoardStateForMovement && getMapAttachmentForSpaces) {
        setPendingCcSpaceChoice(game, { abilityId, gameId, playerNum, card, validSpaces: result.validSpaces, chosenFigureKey: result.chosenFigureKey ?? null });
        const handChannelId = getHandChannelId(game, playerNum);
        const handCh = handChannelId ? await fetchGameChannel(client, handChannelId) : null;
        if (handCh) {
          const boardState = getBoardStateForMovement(game, null);
          const ccMapSpaces = boardState?.mapSpaces || { spaces: result.validSpaces };
          const ccHeader = `**Pick a space** (for **${card}**)`;
          game.pendingSpacePick = game.pendingSpacePick || {};
          game.pendingSpacePick[gameId] = {
            validSpaces: result.validSpaces,
            cellPrefix: `cc_space_${gameId}_`,
            mapSpaces: ccMapSpaces,
            headerText: ccHeader,
          };
          const { rows: rowBtns } = buildRowPickerButtons(result.validSpaces, `space_row_${gameId}_`);
          const mapAttachment = await getMapAttachmentForSpaces(game, result.validSpaces);
          const payload = { content: `${ccHeader}:\nChoose a row:`, components: rowBtns.slice(0, 5) };
          if (mapAttachment) payload.files = [mapAttachment];
          await handCh.send(payload).catch(discordCatch);
        }
      }
    }
    await promptCommDisruption(game, gameId, playerNum, card, client, logGameAction, saveGames, _ccPreSnap);
  }
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
  await interaction.message.delete().catch(discordCatch);
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
export async function handleCcDraw(interaction, ctx) {
  const { getGame, buildHandDisplayPayload, updateHandVisualMessage, logGameAction, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_draw_');
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
  const deckKey = ccDeckKey(playerNum);
  const handKey = ccHandKey(playerNum);
  let deck = (game[deckKey] || []).slice();
  const hand = (game[handKey] || []).slice();
  if (deck.length === 0) {
    await interaction.followUp({ content: 'No cards in deck to draw.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const card = deck.shift();
  hand.push(card);
  game[deckKey] = deck;
  game[handKey] = hand;
  const handPayload = buildHandDisplayPayload(hand, deck, gameId, game, playerNum);
  handPayload.content = `**Draw CC** — Drew **${card}**.\n\n` + handPayload.content;
  await interaction.message.edit({
    content: handPayload.content,
    embeds: handPayload.embeds,
    files: handPayload.files || [],
    components: handPayload.components,
  }).catch(discordCatch);
  await updateHandVisualMessage(game, playerNum, client);
  await logGameAction(game, client, `<@${interaction.user.id}> drew **${card}**`, { allowedMentions: { users: [interaction.user.id] }, icon: 'card' });
  saveGames(game.gameId);
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

/** @param {import('discord.js').ButtonInteraction} interaction */
export async function handleCcDiscard(interaction, ctx) {
  const { getGame } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_discard_');
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
    await interaction.followUp({ content: 'No cards in hand to discard.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cc_discard_select_${gameId}`)
    .setPlaceholder('Choose a card to discard')
    .addOptions(hand.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));
  await interaction.followUp({
    content: '**Discard CC** — Select a card to discard:',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: false,
  });
}

