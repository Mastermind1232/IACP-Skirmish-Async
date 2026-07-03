/**
 * Unified live CC (Command Card) counter-window pipeline.
 *
 * This is the ONE place the Negate/Comms counter-window lives: the stack model,
 * the cancel rules, and the Discord-layer orchestration that opens the window,
 * prompts the responder, plays counters, and resolves the stack. Previously
 * split across src/game/cc-counter-window.js (stack), src/game/cc-counter-rules.js
 * (rules), and src/handlers/cc-hand.js (orchestration); merged here so the live
 * pipeline is a single file (alexanbv 2026-06-24 unification).
 *
 * Every CC play (hand or combat) opens a Negate/Comms counter-window before its
 * effect resolves. Index 0 of the stack is the originally played card; each
 * later entry is a counter targeting the entry below it. spyCount is the
 * player's friendly SPY-group count when they played the card (only consulted
 * for Comm Disruption).
 *
 * Rules: Negation (cost 1) cancels a played card ONLY if its cost is 0 — so it
 * can never cancel another counter, Negate does NOT chain. Comm Disruption
 * (cost 2) needs ≥1 friendly SPY group and cancels a card of cost ≤ that SPY
 * count — so it CAN cancel Negation (≥1 SPY) and Comm Disruption (≥2 SPY), Comms
 * chains.
 *
 * The SC-defer resolve helper (_offerScThenResolveDeferredCc) lives in cc-hand.js
 * because it is also used by the standalone Smuggling-Compartment handlers
 * (handleScCcOpen/Skip/Confirm); the resolve path imports it from there.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { parseCustomId } from '../discord/custom-id.js';
import { getCcEffect, getDcEffects } from '../data-loader.js';
import { getPlayerId, getHandChannelId, ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { fireCcDiscarded } from '../game/cc-passive-redraw.js';
import { awardObjectiveVp } from '../game/index.js';
import { discordCatch } from '../error-handling.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { requireGame } from '../utils/guards.js';
import { _offerScThenResolveDeferredCc, runCcPlayTriggers } from './cc-hand.js';
import { canPlayCC, ccRemovesToGameBox } from '../game/cc-timing.js';

// ── Cancel rules ─────────────────────────────────────────────────────────────

export const NEGATION = 'Negation';
export const COMM_DISRUPTION = 'Comm Disruption';

/**
 * Can `counterCard` cancel a played card of cost `targetCost`, given the
 * canceller has `cancellerSpyCount` friendly SPY groups?
 * @param {string} counterCard - 'Negation' or 'Comm Disruption'
 * @param {number} targetCost - the played (target) card's cost
 * @param {number} [cancellerSpyCount=0] - canceller's friendly SPY group count
 * @returns {boolean}
 */
export function canCancelCc(counterCard, targetCost, cancellerSpyCount = 0) {
  if (counterCard === NEGATION) return targetCost === 0;
  if (counterCard === COMM_DISRUPTION) return (cancellerSpyCount || 0) > 0 && targetCost <= cancellerSpyCount;
  return false;
}

/**
 * The counters that are rule-legal against a played card of cost `targetCost`,
 * given the canceller's SPY count. Hand possession is checked elsewhere; this
 * decides whether a counter-window can open at all and which options to show.
 * @returns {string[]} subset of [NEGATION, COMM_DISRUPTION]
 */
export function availableCounters(targetCost, cancellerSpyCount = 0) {
  const out = [];
  if (canCancelCc(NEGATION, targetCost, cancellerSpyCount)) out.push(NEGATION);
  if (canCancelCc(COMM_DISRUPTION, targetCost, cancellerSpyCount)) out.push(COMM_DISRUPTION);
  return out;
}

/**
 * Resolve a counter-window play stack and return each entry's final status
 * ('resolved' | 'cancelled').
 *
 * The stack is bottom-to-top in play order: index 0 is the original card, and
 * each later entry is a counter targeting the entry immediately below it. It
 * unwinds LIFO — the last counter played is itself uncountered, so it resolves
 * and cancels its target; a cancelled counter does NOT cancel its own target, so
 * the target below it survives and resolves. Thus statuses alternate, gated by
 * the cancel rules (a resolved counter only cancels its target if `canCancelCc`
 * allows it). The classic case: Element of Surprise (0) ← Negation ← Comm
 * Disruption ⇒ Comms resolves, Negation is cancelled, Element of Surprise
 * resolves. alexanbv 2026-06-17.
 *
 * @param {Array<{card:string, cost:number, spyCount?:number}>} stack
 *   - card: the played card name; cost: its cost; spyCount: the player's friendly
 *     SPY-group count when they played it (used when the card is a Comm Disruption).
 * @returns {Array<'resolved'|'cancelled'>} parallel to `stack`
 */
export function resolveCounterStack(stack) {
  const n = Array.isArray(stack) ? stack.length : 0;
  const status = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (i === n - 1) { status[i] = 'resolved'; continue; } // top is uncountered
    const above = stack[i + 1];
    const cancelledByAbove = status[i + 1] === 'resolved'
      && canCancelCc(above.card, stack[i].cost, above.spyCount || 0);
    status[i] = cancelledByAbove ? 'cancelled' : 'resolved';
  }
  return status;
}

// ── Stack model ──────────────────────────────────────────────────────────────
//
// State: game.ccCounterWindow = {
//   gameId,
//   stack: [{ card, cost, playedBy, spyCount?, figureKey?, abilityId?, meta? }]
// }

/** Open a window for a freshly played card (the bottom of a new stack). */
export function openCounterWindow(game, play) {
  game.ccCounterWindow = { gameId: game.gameId, stack: [play] };
  return game.ccCounterWindow;
}

/** The player who should be prompted to counter the top card (its opponent), or null. */
export function counterResponder(game) {
  const w = game?.ccCounterWindow;
  if (!w || w.stack.length === 0) return null;
  return w.stack[w.stack.length - 1].playedBy === 1 ? 2 : 1;
}

/** The top (currently counterable) card on the stack, or null. */
export function topCard(game) {
  const w = game?.ccCounterWindow;
  if (!w || w.stack.length === 0) return null;
  return w.stack[w.stack.length - 1];
}

/**
 * The counters the responder may LEGALLY play against the top card, given their
 * SPY count. Hand possession is checked by the caller.
 * @returns {string[]} subset of ['Negation', 'Comm Disruption']
 */
export function topAvailableCounters(game, responderSpyCount = 0) {
  const top = topCard(game);
  if (!top) return [];
  return availableCounters(top.cost, responderSpyCount);
}

/**
 * Push a counter onto the stack (the responder plays Negate/Comms). The counter
 * must be able to cancel the current top card per the rules.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function pushCounter(game, counter) {
  const w = game?.ccCounterWindow;
  if (!w || w.stack.length === 0) return { ok: false, reason: 'no counter window open' };
  const top = w.stack[w.stack.length - 1];
  if (!canCancelCc(counter.card, top.cost, counter.spyCount || 0)) {
    return { ok: false, reason: `${counter.card} cannot cancel ${top.card} (cost ${top.cost}).` };
  }
  w.stack.push(counter);
  return { ok: true };
}

/**
 * Close the window and resolve the whole stack. Returns each entry annotated
 * with its final status ('resolved' | 'cancelled'), bottom-to-top. The caller
 * then fires resolved cards' effects and routes cancelled cards to the
 * when-discarded pipeline.
 * @returns {Array<object & { status: 'resolved'|'cancelled' }>}
 */
export function resolveAndCloseWindow(game) {
  const w = game?.ccCounterWindow;
  if (!w) return [];
  const statuses = resolveCounterStack(w.stack.map((e) => ({ card: e.card, cost: e.cost, spyCount: e.spyCount })));
  const outcome = w.stack.map((e, i) => ({ ...e, status: statuses[i] }));
  delete game.ccCounterWindow;
  return outcome;
}

// ── Combat gate-resume registry ─────────────────────────────────────────────
// Combat CCs route through the SAME counter-window as hand CCs. After it
// resolves, the combat attack gate must re-drive (return to that phase's
// options). The counter-window resolution lives here, but _driveGatePath needs
// the full combat ctx — so index.js registers a resume that builds the combat
// ctx and calls combat.js's resumeCombatGateAfterCc. Kept in this neutral
// registry to avoid a cc-pipeline <-> combat import cycle.
let _combatGateResume = null;
export function registerCombatGateResume(fn) { _combatGateResume = fn; }
export function getCombatGateResume() { return _combatGateResume; }

// ── Hand-affecting CCs (Smuggling Compartment defer) ─────────────────────────
// Hand-affecting CCs whose effect must let the opponent exhaust [Smuggling
// Compartment] AFTER the Negate/Comms window resolves, before the effect.
const SC_HAND_CCS = new Set(['Stall for Time', 'Collect Intel', 'Intelligence Leak', 'Strategic Shift']);

function _ccSpyGroupCount(game, pn) {
  const dcEffectsData = getDcEffects() || {};
  const dcList = (pn === 1 ? game.p1DcList : game.p2DcList) || [];
  return dcList.filter((dc) => dc && !dc.defeated
    && (dcEffectsData[dc.dcName]?.keywords || []).map((k) => String(k).toUpperCase()).includes('SPY')).length;
}

// ── Custom post-counter-window resolvers ─────────────────────────────────────
// Registry of custom post-counter-window resolvers, keyed by the play
// descriptor's `customResolve` tag. A card whose effect can't be expressed as a
// plain resolveAbility (Celebration's VP gain, WHEN_DEFEATED CCs' bespoke
// pickers, mid-combat reroll reactions) registers a continuation here; it runs
// from _resolveCcCounterWindow ONLY when the card survives the counter-window.
// Signature: (game, entry, ctx, client) => Promise<void>. Keeps cross-file
// continuations decoupled (no circular imports), mirroring registerCombatGateResume.
const _ccCustomResolvers = {};
export function registerCcCustomResolve(kind, fn) { _ccCustomResolvers[kind] = fn; }

// Celebration: "after a unique hostile figure is defeated, gain 4 VP." Now
// counterable like any CC — the VP gain lands here only if it survives.
registerCcCustomResolve('celebration_vp', async (game, entry, ctx, client) => {
  awardObjectiveVp(game, entry.playedBy, 4);
  const pid = getPlayerId(game, entry.playedBy);
  await ctx.logGameAction?.(game, client, `<@${pid}> played **Celebration** — gained 4 VP.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [pid] } });
  if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
});

// ── Unified CC play entry point ───────────────────────────────────────────────

function _ccCommit(game, playerNum, cardName, removeTo, getEffect) {
  const h = game[ccHandKey(playerNum)] || [];
  const i = h.indexOf(cardName);
  if (i >= 0) h.splice(i, 1);
  const dest = removeTo || (ccRemovesToGameBox(cardName, getEffect) ? 'gamebox' : 'discard');
  if (dest === 'gamebox') { game.gameBox = game.gameBox || []; game.gameBox.push(cardName); }
  else if (dest === 'discard') { const dk = ccDiscardKey(playerNum); game[dk] = game[dk] || []; game[dk].push(cardName); }
  return dest;
}

/**
 * Unified CC play — ALL CCs regardless of origin route through here.
 *
 * Pipeline (alexanbv 2026-07-03):
 *  0. Validate (canPlayCC) — unless skipValidation.
 *  1. Signal Jammer — auto-cancel if active against this player.
 *  2. Commit — remove from hand + dispose (unless allowNotInHand).
 *  3. onPostCommit callback — UI refresh / logging (caller-supplied).
 *  4. Log "<@pid> played **card**." unless skipLog.
 *  5. runCcPlayTriggers — Hunt Dissent, Adapt (ALL CCs including counter cards).
 *  6. Counter window — suspends via Promise (_ccWindowResolve) until resolved.
 *  7. Execute — pendingCcEffect + _offerScThenResolveDeferredCc unless skipExecute.
 *
 * opts:
 *   allowNotInHand  — card already relocated (Aphra excavation)
 *   removeTo        — 'discard'|'gamebox'|'none' (default: auto)
 *   skipExecute     — skip step 7; caller applies effect inline
 *   skipTimingCheck — skip timing/block check in canPlayCC (gate-driven CCs)
 *   skipValidation  — skip step 0 (caller already validated)
 *   skipLog         — skip step 4 (caller logs its own message)
 *   getEffect       — getCcEffect override
 *   extraStackEntry — extra fields merged into the counter-window stack entry
 *   onPostCommit    — async fn called after commit (step 2), before log (step 4)
 */
export async function playCcFull(game, gameId, playerNum, figureKey, cardName, opts = {}, ctx, client) {
  const {
    allowNotInHand = false,
    removeTo,
    skipExecute = false,
    skipTimingCheck = false,
    skipValidation = false,
    skipSignalJammer = false,
    skipLog = false,
    getEffect = getCcEffect,
    extraStackEntry = {},
    onPostCommit = null,
  } = opts;

  const effect = getEffect(cardName);
  if (!effect) return { ok: false, reason: `Unknown command card "${cardName}".` };
  const cost = typeof effect.cost === 'number' ? effect.cost : 0;
  const abilityId = effect.abilityId ?? cardName;

  // 0. Validate.
  if (!skipValidation) {
    const check = canPlayCC(game, playerNum, figureKey, cardName, {
      allowNotInHand, getEffect, ignoreCommsJammer: true, skipTimingCheck,
    });
    if (!check.ok) return check;
  }

  // 1. Signal Jammer (skipSignalJammer for callers that handle it themselves).
  if (!skipSignalJammer && game.signalJammerActive && game.signalJammerActive.playerNum !== playerNum && cardName !== 'Signal Jammer') {
    const jammerPN = game.signalJammerActive.playerNum;
    game.signalJammerActive = null;
    if (!allowNotInHand) _ccCommit(game, playerNum, cardName, removeTo, getEffect);
    game[ccDiscardKey(jammerPN)] = [...(game[ccDiscardKey(jammerPN)] || []), 'Signal Jammer'];
    const jmsg = allowNotInHand
      ? `**Signal Jammer** cancelled **${cardName}** — Signal Jammer discarded; **${cardName}** remains in game box.`
      : `**Signal Jammer** cancelled **${cardName}** — both cards discarded.`;
    await ctx.logGameAction?.(game, client, jmsg, { phase: 'ACTION', icon: 'card' });
    ctx.saveGames?.(game.gameId);
    return { ok: true, cancelled: 'signal_jammer' };
  }

  // 2. Commit card.
  if (!allowNotInHand) _ccCommit(game, playerNum, cardName, removeTo, getEffect);

  // 3. Post-commit callback (UI refresh etc.).
  if (onPostCommit) await onPostCommit();

  // 4. Log.
  if (!skipLog) {
    const pid = getPlayerId(game, playerNum);
    await ctx.logGameAction?.(game, client, `<@${pid}> played command card **${cardName}**.`,
      { phase: 'ACTION', icon: 'card', allowedMentions: { users: pid ? [pid] : [] } });
  }

  // 5. On-play triggers (Hunt Dissent, Adapt) — ALL CCs including counter cards.
  await runCcPlayTriggers(game, playerNum, {
    client, logGameAction: ctx.logGameAction, dcMessageMeta: ctx.dcMessageMeta, saveGames: ctx.saveGames,
  });

  // 6. Counter window — suspend via Promise until _resolveCcCounterWindow resolves it.
  const windowResult = await new Promise((resolve) => {
    game._ccWindowResolve = resolve;
    openCcCounterWindow(game, gameId, {
      card: cardName, cost, playedBy: playerNum, figureKey, abilityId, ...extraStackEntry,
    }, ctx, client).then(() => ctx.saveGames?.(game.gameId));
  });

  // _resolveCcCounterWindow already fired fireCcDiscarded + logged the cancel.
  if (windowResult.cancelled) return { ok: true, cancelled: 'opponent' };

  // 7. Execute.
  if (!skipExecute) {
    game.pendingCcEffect = {
      abilityId, card: cardName, playedBy: playerNum,
      msgId: extraStackEntry.msgId ?? null,
      fromDc: !!extraStackEntry.fromDc,
      scProtect: SC_HAND_CCS.has(cardName),
      fastLearnerFigureKey: extraStackEntry.fastLearnerFigureKey ?? null,
      playedByFigureKey: figureKey ?? extraStackEntry.playedByFigureKey ?? null,
    };
    await _offerScThenResolveDeferredCc(game, ctx, client);
  }

  return { ok: true };
}

// ── Counter-window orchestration ─────────────────────────────────────────────

/**
 * Build a `promptOpponentCancel` function for ANY CC play — the single entry
 * point every caller injects into `playCC.ctx`. Logs the play, runs on-play
 * triggers, then opens the counter window as a Promise (stores resolve in
 * game._ccWindowResolve). _resolveCcCounterWindow resolves it with
 * { cancelled } when the Negate/Comms buttons resolve or auto-resolve with
 * no eligible responder. alexanbv 2026-06-30 unified path.
 *
 * @param {object}  game      - live game state
 * @param {string}  gameId
 * @param {object}  ctx       - handler ctx (logGameAction, saveGames, dcMessageMeta…)
 * @param {object}  client    - Discord client
 * @param {object}  [extraPlay={}] - extra fields merged into the counter-window play
 *   descriptor (figureKey, abilityId, combat, msgId, …).
 */
export function makeCcPromptOpponentCancel(game, gameId, ctx, client, extraPlay = {}) {
  return async ({ game: g, playerNum, figureKey, cardName, cost }) => {
    const pid = getPlayerId(g, playerNum);
    await ctx.logGameAction?.(g, client, `<@${pid}> played command card **${cardName}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: pid ? [pid] : [] } });
    await runCcPlayTriggers(g, playerNum, { client, logGameAction: ctx.logGameAction, dcMessageMeta: ctx.dcMessageMeta, saveGames: ctx.saveGames });
    return new Promise((resolve) => {
      g._ccWindowResolve = resolve;
      // _resolveCcCounterWindow resolves via query mode when it finds _ccWindowResolve.
      // .then() only saves; do NOT resolve here — would race the button click.
      openCcCounterWindow(g, gameId, {
        card: cardName, cost, playedBy: playerNum, figureKey, abilityId: cardName, ...extraPlay,
      }, ctx, client).then(() => ctx.saveGames?.(g.gameId));
    });
  };
}

/**
 * Open the counter-window for a freshly played card and prompt the opponent.
 * `play` = { card, cost, playedBy, figureKey?, abilityId? }. On resolution this
 * fires resolved non-counter effects and routes cancelled cards to the
 * when-discarded pipeline.
 */
export async function openCcCounterWindow(game, gameId, play, ctx, client) {
  const spyForPlay = (play.card === COMM_DISRUPTION) ? _ccSpyGroupCount(game, play.playedBy) : undefined;
  openCounterWindow(game, { ...play, spyCount: spyForPlay });
  await _promptCounterResponder(game, gameId, ctx, client);
}

async function _promptCounterResponder(game, gameId, ctx, client) {
  const responder = counterResponder(game);
  if (!responder) { await _resolveCcCounterWindow(game, gameId, ctx, client); return; }
  const top = topCard(game);
  const spy = _ccSpyGroupCount(game, responder);
  const hand = game[ccHandKey(responder)] || [];
  const offer = topAvailableCounters(game, spy).filter((c) => hand.includes(c));
  if (offer.length === 0) { await _resolveCcCounterWindow(game, gameId, ctx, client); return; }
  const chId = getHandChannelId(game, responder);
  const ch = chId ? await fetchGameChannel(client, chId) : null;
  if (!ch) { await _resolveCcCounterWindow(game, gameId, ctx, client); return; }
  const btns = offer.map((c) => new ButtonBuilder()
    .setCustomId(c === NEGATION ? `cc_counter_negate_${gameId}` : `cc_counter_comms_${gameId}`)
    .setLabel(`Play ${c}`).setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder().setCustomId(`cc_counter_pass_${gameId}`).setLabel('Pass (let it resolve)').setStyle(ButtonStyle.Secondary));
  const ownerId = getPlayerId(game, responder);
  await ch.send(sanitizeMentions({
    content: `<@${ownerId}> Your opponent played **${top.card}**. Cancel it?`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

async function _playCounter(interaction, ctx, counterCard) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  const prefix = counterCard === NEGATION ? 'cc_counter_negate_' : 'cc_counter_comms_';
  const gameId = parseCustomId(interaction.customId, prefix);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const responder = counterResponder(game);
  if (!responder || interaction.user.id !== getPlayerId(game, responder)) {
    await interaction.followUp({ content: 'Only the responding player can counter.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const hand = game[ccHandKey(responder)] || [];
  if (!hand.includes(counterCard)) {
    await interaction.followUp({ content: `${counterCard} is no longer in your hand.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const spy = _ccSpyGroupCount(game, responder);
  const res = pushCounter(game, { card: counterCard, cost: counterCard === NEGATION ? 1 : 2, playedBy: responder, spyCount: spy });
  if (!res.ok) {
    await interaction.followUp({ content: res.reason || 'That counter is not legal here.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Signal Jammer: counter cards are also cancellable (alexanbv 2026-07-03).
  // If Jammer fires: pop the counter back off the stack (it was just pushed), discard
  // both cards, and re-prompt with the counter no longer in hand.
  if (game.signalJammerActive && game.signalJammerActive.playerNum !== responder && counterCard !== 'Signal Jammer') {
    const jammerPN = game.signalJammerActive.playerNum;
    game.signalJammerActive = null;
    // Pop the counter we just pushed.
    const w = game.ccCounterWindow;
    if (w && w.stack[w.stack.length - 1]?.card === counterCard && w.stack[w.stack.length - 1]?.playedBy === responder) {
      w.stack.pop();
    }
    const hi = hand.indexOf(counterCard);
    if (hi >= 0) hand.splice(hi, 1);
    game[ccHandKey(responder)] = hand;
    game[ccDiscardKey(responder)] = (game[ccDiscardKey(responder)] || []).concat(counterCard);
    game[ccDiscardKey(jammerPN)] = [...(game[ccDiscardKey(jammerPN)] || []), 'Signal Jammer'];
    await interaction.message.edit({ content: `**Signal Jammer** cancelled **${counterCard}** — both cards discarded.`, components: [] }).catch(discordCatch);
    await logGameAction?.(game, client, `**Signal Jammer** cancelled **${counterCard}** — both cards discarded.`, { phase: 'ACTION', icon: 'card' });
    await _promptCounterResponder(game, gameId, ctx, client);
    saveGames(game.gameId);
    return;
  }
  // Commit: remove from hand + push to discard.
  const hi = hand.indexOf(counterCard);
  hand.splice(hi, 1);
  game[ccHandKey(responder)] = hand;
  game[ccDiscardKey(responder)] = (game[ccDiscardKey(responder)] || []).concat(counterCard);
  await interaction.message.edit({ content: `**${counterCard}** played.`, components: [] }).catch(discordCatch);
  await logGameAction?.(game, client, `<@${interaction.user.id}> played **${counterCard}**.`, { phase: 'ACTION', icon: 'card', allowedMentions: { users: [interaction.user.id] } });
  // On-play triggers fire for counter cards too (Hunt Dissent, Adapt).
  await runCcPlayTriggers(game, responder, { client, logGameAction, dcMessageMeta: ctx.dcMessageMeta, saveGames });
  await _promptCounterResponder(game, gameId, ctx, client);
  saveGames(game.gameId);
}

export async function handleCcCounterNegate(interaction, ctx) { await _playCounter(interaction, ctx, NEGATION); }
export async function handleCcCounterComms(interaction, ctx) { await _playCounter(interaction, ctx, COMM_DISRUPTION); }

export async function handleCcCounterPass(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cc_counter_pass_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const responder = counterResponder(game);
  if (!responder || interaction.user.id !== getPlayerId(game, responder)) {
    await interaction.followUp({ content: 'Only the responding player can pass.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.message.edit({ content: 'Passed — the play resolves.', components: [] }).catch(discordCatch);
  await _resolveCcCounterWindow(game, gameId, ctx, client);
  saveGames(game.gameId);
}

// Resolve the stack: fire resolved non-counter effects (step 4 SC prompt + the
// effect, via the shared deferred-effect machinery); route cancelled cards to
// the when-discarded pipeline. A counter card's "effect" IS its cancellation, so
// a resolved counter does nothing further here.
async function _resolveCcCounterWindow(game, gameId, ctx, client) {
  const outcome = resolveAndCloseWindow(game);
  // Query-mode: when game._ccWindowResolve is set, a Promise-based combat caller
  // is awaiting the result — resolve it with { cancelled } and skip effect
  // execution (playCC handles disposal + effect routing). alexanbv 2026-06-30.
  const queryResolve = game._ccWindowResolve ?? null;
  if (queryResolve) delete game._ccWindowResolve;
  let queryCancelled = false;
  for (const entry of outcome) {
    const isCounter = entry.card === NEGATION || entry.card === COMM_DISRUPTION;
    if (entry.status === 'cancelled') {
      // Cancelled → when-discarded pipeline (Windfall / Built on Hope), NOT resolved.
      fireCcDiscarded(game, entry.playedBy, entry.card, { fromDeck: false });
      await ctx.logGameAction?.(game, client, `**${entry.card}** was cancelled (effects suppressed).`, { phase: 'ACTION', icon: 'card' });
      if (queryResolve && !isCounter) queryCancelled = true;
      continue;
    }
    if (isCounter) continue;
    // Query mode: the main card survived — skip effect; playCC caller handles it.
    if (queryResolve) continue;
    // Normal mode: custom-resolve or generic deferred-effect path.
    // Custom-resolve cards (Celebration, WHEN_DEFEATED CCs, Tough Luck, …):
    // their effect runs via a bespoke continuation registered by the originating
    // handler, NOT the generic resolveAbility path. alexanbv 2026-06-19.
    if (entry.customResolve) {
      const fn = _ccCustomResolvers[entry.customResolve];
      if (fn) await fn(game, entry, ctx, client);
      continue;
    }
    // Resolved card → run the Smuggling Compartment step (if it interacts) then
    // the effect, reusing the deferred-effect path (handles requiresChoice /
    // PowerToken / Space prompts too). The played card is already in discard.
    game.pendingCcEffect = {
      abilityId: entry.abilityId || entry.card, card: entry.card, playedBy: entry.playedBy,
      msgId: entry.msgId ?? null, fromDc: !!entry.fromDc, scProtect: SC_HAND_CCS.has(entry.card),
      fastLearnerFigureKey: entry.fastLearnerFigureKey ?? null,
    };
    await _offerScThenResolveDeferredCc(game, ctx, client);
  }
  if (ctx.checkWinConditions) await ctx.checkWinConditions(game, client);
  if (queryResolve) {
    queryResolve({ cancelled: queryCancelled });
    return; // playCC caller re-drives the gate; skip pendingCombatCcResolve path
  }
  // Combat CC (Tough Luck / after-attack): the attack gate paused — re-drive it
  // now that the play has resolved or been cancelled.
  if (game.pendingCombatCcResolve) {
    const resume = getCombatGateResume();
    if (resume) await resume(game, client);
  }
}
