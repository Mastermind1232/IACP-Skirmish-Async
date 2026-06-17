/**
 * Pure helpers for the strain handler.
 *
 * Strain rule (IACP, destruct 2026-05-06):
 *
 * When a figure suffers N strain, the controlling player chooses,
 * **per strain**, one of:
 *   1. Take 1 damage on the figure
 *   2. Discard 1 Command Card from the top of their own deck
 *
 * Special-case figures:
 *   - Paz Vizsla: a third option — return 1 CC from his discard pile
 *     to the game box (preserves deck size, no damage).
 *
 * Stack modifiers:
 *   - Under Duress (CC): doubles option-2 cost (2 deck-cards per strain
 *     prevented). When deplete-triggered: choice authority flips to UD-
 *     controller for the duration of the strain event. UD prompt fires
 *     anytime strain is suffered, regardless of who caused it.
 *   - Headhunter (existing): when a hostile suffers strain during the
 *     Headhunter owner's activation, exhaust to reduce strain by 1; the
 *     controller must discard 1 random CC from hand or the figure
 *     suffers 1 damage. Already wired in handlers/combat.js.
 *
 * Bleed timing: strain from Bleed fires after the action resolves. For
 * move actions, "action resolves" = the moment MP are gained, BEFORE
 * MP are spent.
 *
 * This module exports PURE helpers (no Discord dependencies) so the
 * resolution logic can be unit-tested. The async prompt + state machine
 * lives in src/handlers/strain-handler.js.
 */

import { dcNameFromFigureKey } from './dc-helpers.js';
import { getCcHand, getCcDiscard, getDcAttachments, getDcList, getDcMessageIds, ccHandKey, ccDiscardKey } from './player-helpers.js';
import { fireCcDiscarded } from './cc-passive-redraw.js';

export const STRAIN_OPTIONS = Object.freeze({
  TAKE_DAMAGE: 'damage',
  DISCARD_DECK_TOP: 'discard',
  PAZ_RETURN_FROM_DISCARD: 'paz_return',
});

/**
 * Returns true if the figure is Paz Vizsla and the controller has at
 * least one CC in their discard pile.
 */
export function pazReturnAvailable(game, playerNum, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  if (dcName !== 'Paz Vizsla') return false;
  const discard = getCcDiscard(game, playerNum) || [];
  return discard.length > 0;
}

/**
 * Returns the array of opponent msgIds whose Under Duress card is in
 * the army list and not yet depleted. Empty array means the UD-deplete
 * prompt does NOT fire for this strain event — destruct 2026-05-06: only
 * prompt for UD if the opponent has UD in list.
 *
 * Under Duress is a standalone Skirmish Upgrade DC (`[Under Duress]`,
 * attachment: false in dc-effects.json) — NOT an attachment to another
 * DC. So we scan the opponent's DC list, not attachments.
 */
export function findUnderDuressDepleters(game, strainedPlayerNum) {
  const opponentPN = strainedPlayerNum === 1 ? 2 : 1;
  const dcList = getDcList(game, opponentPN) || [];
  const msgIds = getDcMessageIds(game, opponentPN) || [];
  const depletedIds = opponentPN === 1
    ? (game.p1DepletedDcMessageIds || [])
    : (game.p2DepletedDcMessageIds || []);
  const out = [];
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!dcName) continue;
    // Match `[Under Duress]` (the bracketed standalone-SU form) and any
    // alias variant case-insensitively. The canonical card key is
    // `[Under Duress]`.
    if (!/^\[?\s*under\s*duress\s*\]?$/i.test(String(dcName).trim())) continue;
    const msgId = msgIds[i];
    if (!msgId) continue;
    if (depletedIds.includes(msgId)) continue;
    out.push(msgId);
  }
  return out;
}

/**
 * Resolve a single strain unit using the chosen option. Returns:
 *   {
 *     applied:        whether the choice took effect
 *     damageInflicted: 0 or 1 — actual damage applied to the figure
 *     deckDiscarded:   number of cards moved from deck → discard
 *     pazReturned:     number of cards moved from discard → game box
 *     fellThroughTo:   if a chosen option failed (e.g. empty deck), the
 *                      option that was actually used instead
 *   }
 *
 * Mutates game state directly (deck/discard/gameBox arrays). Damage to
 * the figure is the caller's responsibility — return damageInflicted=1
 * signals the caller should reduceHp by 1.
 *
 * @param {object} game
 * @param {number} controllerPlayerNum - the player whose deck/discard
 *   absorbs the strain. Normally the strained-figure's controller, but
 *   flips to the UD-controller when Under Duress was depleted.
 * @param {string} option - one of STRAIN_OPTIONS
 * @param {object} ctx - { figureKey, costMultiplier?, discardCardName? }
 *   - costMultiplier: 2 for Under-Duress doubled cost (default 1)
 *   - discardCardName: when option is PAZ_RETURN_FROM_DISCARD, the
 *     specific card the controller chose to return to the game box.
 *     If omitted, the first card in the discard is returned.
 */
export function resolveSingleStrainChoice(game, controllerPlayerNum, option, ctx = {}) {
  const out = { applied: false, damageInflicted: 0, deckDiscarded: 0, pazReturned: 0, fellThroughTo: null };
  const costMult = Math.max(1, ctx.costMultiplier || 1);
  if (!game) return out;

  if (option === STRAIN_OPTIONS.TAKE_DAMAGE) {
    out.damageInflicted = 1;
    out.applied = true;
    return out;
  }

  if (option === STRAIN_OPTIONS.DISCARD_DECK_TOP) {
    const deckKey = controllerPlayerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const discardKey = ccDiscardKey(controllerPlayerNum);
    const deck = Array.isArray(game[deckKey]) ? game[deckKey] : [];
    if (deck.length < costMult) {
      // Empty (or insufficient) deck → falls through to damage.
      out.damageInflicted = 1;
      out.applied = true;
      out.fellThroughTo = STRAIN_OPTIONS.TAKE_DAMAGE;
      return out;
    }
    const top = deck.splice(0, costMult);
    game[discardKey] = (game[discardKey] || []).concat(top);
    out.deckDiscarded = costMult;
    out.applied = true;
    // When-discarded subroutine (deck): Built on Hope re-draw + Windfall hooks.
    for (const _c of top) fireCcDiscarded(game, controllerPlayerNum, _c, { fromDeck: true });
    return out;
  }

  if (option === STRAIN_OPTIONS.PAZ_RETURN_FROM_DISCARD) {
    const discardKey = ccDiscardKey(controllerPlayerNum);
    const discard = Array.isArray(game[discardKey]) ? game[discardKey] : [];
    if (discard.length === 0) {
      // No discard → fall back to damage.
      out.damageInflicted = 1;
      out.applied = true;
      out.fellThroughTo = STRAIN_OPTIONS.TAKE_DAMAGE;
      return out;
    }
    let pickIdx = 0;
    if (ctx.discardCardName) {
      const idx = discard.findIndex((c) => String(c).toLowerCase() === String(ctx.discardCardName).toLowerCase());
      if (idx >= 0) pickIdx = idx;
    }
    const removed = discard.splice(pickIdx, 1)[0];
    game.gameBox = game.gameBox || [];
    game.gameBox.push(removed);
    out.pazReturned = 1;
    out.applied = true;
    return out;
  }

  return out;
}
