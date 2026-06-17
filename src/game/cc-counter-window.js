/**
 * Game-level recursive CC counter-window orchestration (alexanbv 2026-06-17).
 *
 * Every CC play (hand or combat) opens a Negate/Comms counter-window before its
 * effect resolves. This module owns the window's stack state and resolution; the
 * Discord layer posts the prompts and calls these transitions. Rules come from
 * cc-counter-rules (Negate cancels cost-0 only; Comms needs ≥1 SPY and cancels
 * cost ≤ SPY — so Comms chains, Negate does not).
 *
 * State: game.ccCounterWindow = {
 *   gameId,
 *   stack: [{ card, cost, playedBy, spyCount?, figureKey?, abilityId?, meta? }]
 * }
 * Index 0 is the originally played card; each later entry is a counter targeting
 * the entry below it. spyCount is the player's friendly SPY-group count when they
 * played it (only consulted for Comm Disruption).
 */
import { canCancelCc, availableCounters, resolveCounterStack } from './cc-counter-rules.js';

/** The open window, or null. */
export function getCounterWindow(game) {
  return game?.ccCounterWindow || null;
}

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

/** Abort/clear the window without resolving (e.g. game teardown). */
export function clearCounterWindow(game) {
  if (game) delete game.ccCounterWindow;
}
