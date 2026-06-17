/**
 * CC Passive Redraw System
 *
 * Certain Command Cards have passive abilities that trigger while in the discard pile,
 * causing them to be re-drawn (moved from discard to hand).
 *
 * Supported cards and their triggers:
 *   C22 — Knowledge and Defense: FORCE USER spends a surge → re-draw
 *   C37 — Built on Hope: discarded from Command deck → re-draw
 *   C53 — Shared Experience: friendly DROID or VEHICLE defeated → re-draw
 *   C68 — Rebel Graffiti: Sabine Wren in army → re-draw at start of round
 *   C74 — Targeting Network: DROID spends a surge → re-draw
 */
import { getDcKeywords, getCcEffect } from '../data-loader.js';
import {
  ccHandKey, ccDiscardKey, ccDeckKey, getDcList, vpKey,
} from './player-helpers.js';

// ── Passive redraw card definitions ──────────────────────────────────────────

/**
 * Cards with surge-based passive redraws (while in discard, figure gains "Surge: Re-draw").
 * Each entry maps card name → required keyword on the attacking figure.
 */
export const SURGE_REDRAW_CARDS = {
  'Knowledge and Defense': 'FORCE USER',
  'Targeting Network': 'DROID',
};

/**
 * Cards that re-draw when discarded from the Command deck (not from hand).
 */
export const DECK_DISCARD_REDRAW_CARDS = new Set([
  'Built on Hope',
]);

/**
 * Cards that re-draw when a friendly figure with a matching trait is defeated.
 * Maps card name → array of qualifying keywords (any match triggers redraw).
 */
export const FRIENDLY_DEFEATED_REDRAW_CARDS = {
  'Shared Experience': ['DROID', 'VEHICLE'],
};

/**
 * Cards that re-draw at start of round if a specific DC is in the army.
 * Maps card name → DC name substring to match.
 */
export const START_OF_ROUND_REDRAW_CARDS = {
  'Rebel Graffiti': 'Sabine Wren',
};

// ── Core redraw helper ───────────────────────────────────────────────────────

/**
 * Move a card from the player's CC discard pile to their hand.
 * Returns true if the card was found and moved, false otherwise.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} cardName - CC name to re-draw
 * @returns {boolean}
 */
export function moveDiscardToHand(game, playerNum, cardName) {
  const dKey = ccDiscardKey(playerNum);
  const hKey = ccHandKey(playerNum);
  const discard = game[dKey] || [];
  const idx = discard.indexOf(cardName);
  if (idx < 0) return false;
  discard.splice(idx, 1);
  game[dKey] = discard;
  game[hKey] = [...(game[hKey] || []), cardName];
  return true;
}

// ── Trigger-specific checks ──────────────────────────────────────────────────

/**
 * Check for surge-triggered passive redraws after a surge is spent in combat.
 * Called from the surge-spending handler.
 *
 * @param {object} game - Game state
 * @param {number} attackerPlayerNum - Player number of the attacker
 * @param {string} attackerDcName - DC name of the attacking figure
 * @returns {{ redrawn: string[] }} - Array of card names re-drawn
 */
export function checkSurgePassiveRedraws(game, attackerPlayerNum, attackerDcName) {
  const redrawn = [];
  // Rest in Peace blocks all retrievals from discard piles for the round.
  if (game.restInPeaceActive) return { redrawn };
  const dKey = ccDiscardKey(attackerPlayerNum);
  const discard = game[dKey] || [];
  if (discard.length === 0) return { redrawn };

  // Get keywords for the attacking figure
  const kwMap = getDcKeywords(game);
  const dcBase = (attackerDcName || '')
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  const keywords = (kwMap[attackerDcName] || kwMap[dcBase] || []).map(k => String(k).toUpperCase());

  for (const [cardName, requiredKeyword] of Object.entries(SURGE_REDRAW_CARDS)) {
    if (!discard.includes(cardName)) continue;
    if (!keywords.includes(requiredKeyword)) continue;
    if (moveDiscardToHand(game, attackerPlayerNum, cardName)) {
      redrawn.push(cardName);
    }
  }
  return { redrawn };
}

/**
 * Check for deck-discard passive redraws when a CC is discarded from the Command deck.
 * Called after any mechanic that discards from the deck (Bleed prevention, Strategize, etc.).
 *
 * @param {object} game - Game state
 * @param {number} playerNum - Player whose deck the card was discarded from
 * @param {string} discardedCardName - Name of the card that was just discarded from deck
 * @returns {{ redrawn: string[] }}
 */
export function checkDeckDiscardPassiveRedraws(game, playerNum, discardedCardName) {
  const redrawn = [];
  // Rest in Peace blocks retrieval from discard. Built on Hope's redraw
  // routes through discard ("when this card is discarded from your Command
  // deck, re-draw it") so it counts as a discard retrieval.
  if (game.restInPeaceActive) return { redrawn };
  // The card was just discarded from deck to... where? It needs to go to discard first,
  // then the passive triggers and moves it to hand.
  // Actually, the card text says "when this card is discarded from your Command deck, re-draw it."
  // So the card itself was discarded from the deck. It would land in the discard pile,
  // then immediately re-draw. But in most flows the discarded-from-deck card goes to discard.
  // We check if the card that was just discarded from deck matches a DECK_DISCARD_REDRAW card.
  if (DECK_DISCARD_REDRAW_CARDS.has(discardedCardName)) {
    // The card was just placed in the discard pile by the caller.
    // Move it from discard to hand.
    if (moveDiscardToHand(game, playerNum, discardedCardName)) {
      redrawn.push(discardedCardName);
    }
  }
  return { redrawn };
}

/**
 * Check for friendly-defeated passive redraws when a friendly figure is defeated.
 * Called from defeat processing code.
 *
 * @param {object} game - Game state
 * @param {number} defeatedFigureOwnerPlayerNum - Player who owns the defeated figure
 * @param {string} defeatedDcName - DC name of the defeated figure
 * @returns {{ redrawn: string[] }}
 */
export function checkFriendlyDefeatedPassiveRedraws(game, defeatedFigureOwnerPlayerNum, defeatedDcName) {
  const redrawn = [];
  if (game.restInPeaceActive) return { redrawn };
  const dKey = ccDiscardKey(defeatedFigureOwnerPlayerNum);
  const discard = game[dKey] || [];
  if (discard.length === 0) return { redrawn };

  // Get keywords for the defeated figure
  const kwMap = getDcKeywords(game);
  const dcBase = (defeatedDcName || '')
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  const keywords = (kwMap[defeatedDcName] || kwMap[dcBase] || []).map(k => String(k).toUpperCase());

  for (const [cardName, requiredKeywords] of Object.entries(FRIENDLY_DEFEATED_REDRAW_CARDS)) {
    if (!discard.includes(cardName)) continue;
    const matches = requiredKeywords.some(kw => keywords.includes(kw));
    if (!matches) continue;
    if (moveDiscardToHand(game, defeatedFigureOwnerPlayerNum, cardName)) {
      redrawn.push(cardName);
    }
  }
  return { redrawn };
}

/**
 * Check for start-of-round passive redraws (army composition triggers).
 * Called at start of each round during the status phase.
 *
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @returns {{ redrawn: string[] }}
 */
export function checkStartOfRoundPassiveRedraws(game, playerNum) {
  const redrawn = [];
  if (game.restInPeaceActive) return { redrawn };
  const dKey = ccDiscardKey(playerNum);
  const discard = game[dKey] || [];
  if (discard.length === 0) return { redrawn };

  const dcList = getDcList(game, playerNum) || [];

  for (const [cardName, dcSubstring] of Object.entries(START_OF_ROUND_REDRAW_CARDS)) {
    if (!discard.includes(cardName)) continue;
    // Check if any DC in the army matches the required name
    const hasDc = dcList.some(dc => {
      const name = typeof dc === 'object' ? (dc.dcName || dc.displayName || '') : (dc || '');
      return name.includes(dcSubstring);
    });
    if (!hasDc) continue;
    if (moveDiscardToHand(game, playerNum, cardName)) {
      redrawn.push(cardName);
    }
  }
  return { redrawn };
}

/**
 * Capitalize passive: while in discard, when a hostile figure with a
 * harmful condition gains another harmful condition, the owner may
 * re-draw the card. Per CRR card text + user clarification 2026-05-09.
 *
 * Trigger: applyCondition() pushes a HARMFUL onto a figure that already
 * has at least one HARMFUL. The card's owner is the OPPONENT of the
 * figure's controller (since "hostile figure" is relative to the card
 * holder). Auto-redraws (treating "may" as opt-in default).
 *
 * @param {object} game
 * @param {string} hostileFigureKey - figureKey of the figure that just gained a stacking harmful
 * @param {number} hostileFigureOwnerPN - 1 or 2: controller of the figure
 * @returns {{ redrawn: string[], beneficiaryPN: number|null }}
 */
export function checkCapitalizePassiveRedraw(game, hostileFigureKey, hostileFigureOwnerPN) {
  const out = { redrawn: [], beneficiaryPN: null };
  if (game.restInPeaceActive) return out;
  // Capitalize's owner = the OPPOSITE of the figure's controller.
  const ownerPN = hostileFigureOwnerPN === 1 ? 2 : 1;
  const dKey = ccDiscardKey(ownerPN);
  const discard = game[dKey] || [];
  if (!discard.includes('Capitalize')) return out;
  if (moveDiscardToHand(game, ownerPN, 'Capitalize')) {
    out.redrawn.push('Capitalize');
    out.beneficiaryPN = ownerPN;
  }
  return out;
}

// ── De Wanna Wanga passive reshuffle ────────────────────────────────────────

/**
 * Cards that, once per round, shuffle back into the deck when discarded from hand.
 */
export const HAND_DISCARD_RESHUFFLE_CARDS = new Set([
  'De Wanna Wanga',
]);

/**
 * Check for hand-discard passive reshuffle after a CC is played/discarded from hand.
 * If the card is De Wanna Wanga and the once-per-round limit hasn't been used,
 * move it from discard pile to deck and shuffle.
 *
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} cardName - Name of the card that was just discarded from hand
 * @returns {{ reshuffled: boolean }}
 */
export function checkHandDiscardPassiveReshuffle(game, playerNum, cardName) {
  if (!HAND_DISCARD_RESHUFFLE_CARDS.has(cardName)) return { reshuffled: false };
  // Rest in Peace blocks retrieval from discard. De Wanna Wanga's reshuffle
  // moves the card from discard pile back into the deck — that's a
  // retrieval, so RIP suppresses it for the round.
  if (game.restInPeaceActive) return { reshuffled: false };

  // Once per round check
  game.deWannaWangaUsedThisRound = game.deWannaWangaUsedThisRound || {};
  if (game.deWannaWangaUsedThisRound[playerNum]) return { reshuffled: false };

  const dKey = ccDiscardKey(playerNum);
  const discard = game[dKey] || [];
  const idx = discard.indexOf(cardName);
  if (idx < 0) return { reshuffled: false };

  // Move from discard to deck and shuffle
  discard.splice(idx, 1);
  game[dKey] = discard;
  const deckKey = ccDeckKey(playerNum);
  const deck = game[deckKey] || [];
  deck.push(cardName);
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  game[deckKey] = deck;
  game.deWannaWangaUsedThisRound[playerNum] = true;
  return { reshuffled: true };
}

/**
 * Central "when a Command card is DISCARDED from hand or deck" subroutine.
 *
 * Fires ONLY on genuine discards — NOT when a card is played/used (alexanbv
 * 2026-06-17: "When a card is discarded (does NOT count when a CC is used/
 * played) there should be a marker that triggers a 'when discarded'
 * subroutine"). Discard sites call this AFTER the card has been placed in the
 * discard pile (so the re-draw passives can retrieve it from there).
 *
 * Hooks:
 *  - re-draw passives: Built on Hope (deck), De Wanna Wanga (hand)
 *  - Windfall: when Windfall itself is discarded, its owner gains 1 VP; and the
 *    discarded card's cost is recorded so a Windfall reaction-play can award
 *    VP=cost (read + cleared by the Windfall ccEffect handler).
 *
 * @param {object} game
 * @param {number} ownerPlayerNum - whose hand/deck the card left
 * @param {string} cardName
 * @param {object} [opts]
 * @param {boolean} [opts.fromDeck=false] - discarded from deck (vs hand)
 * @returns {{ redrawn: string[], windfallSelfVp: number, recordedCost: number }}
 */
export function fireCcDiscarded(game, ownerPlayerNum, cardName, { fromDeck = false } = {}) {
  const out = { redrawn: [], windfallSelfVp: 0, recordedCost: 0 };
  if (!game || !ownerPlayerNum || !cardName) return out;

  // 1. Re-draw passives (deck vs hand).
  if (fromDeck) {
    out.redrawn = checkDeckDiscardPassiveRedraws(game, ownerPlayerNum, cardName).redrawn || [];
  } else if (checkHandDiscardPassiveReshuffle(game, ownerPlayerNum, cardName).reshuffled) {
    out.redrawn = [cardName];
  }

  // 2. Windfall (Doctor Aphra) — "When this card is discarded from your hand or
  //    deck, gain 1 VP." The discarded card IS Windfall ⇒ its owner gains 1 VP.
  if (cardName === 'Windfall') {
    const vk = vpKey(ownerPlayerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total || 0) + 1;
    out.windfallSelfVp = 1;
  }

  // 3. Record the discarded card's cost so a Windfall reaction-play ("Use when a
  //    Command card is discarded from your hand or deck. You gain VPs equal to
  //    that card's cost.") can award it. Per-player; the Windfall handler reads
  //    and clears it.
  out.recordedCost = getCcEffect(cardName)?.cost ?? 0;
  game.windfallDiscardCost = game.windfallDiscardCost || {};
  game.windfallDiscardCost[ownerPlayerNum] = out.recordedCost;

  return out;
}
