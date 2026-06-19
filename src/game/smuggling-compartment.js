/**
 * [Smuggling Compartment] — Skirmish Upgrade with two abilities.
 *
 *   Part 1 (reaction): "Before your opponent resolves a Command card or ability,
 *   you may exhaust this card to set aside any number of Command cards from your
 *   hand. Return them to your hand at the start of the next activation or phase."
 *
 *   Part 2 (end of round): "Before the start of the Status Phase, you may look
 *   at the top and bottom cards of your Command deck. You may move 1 of those
 *   cards to the top or bottom of your Command deck."
 *
 * This module holds the PURE, side-effect-free logic for both parts so it can be
 * unit-tested without the Discord layer. The round.js / cc-hand.js wiring drives
 * the interactive prompts and calls these helpers to mutate deck/hand arrays.
 *
 * alexanbv 2026-06-17: "wire both parts of SC."
 */

import { getDcList, getDcMessageIds, ccHandKey } from './player-helpers.js';
import { cardNameIncludes } from './card-names.js';

export const SMUGGLING_COMPARTMENT_NAME = '[Smuggling Compartment]';

/**
 * True if `ownerNum` can react with an un-exhausted [Smuggling Compartment] and
 * has cards in hand to set aside. Pure (game-layer) so both the Discord handler
 * (handlers/sc-hand-protection.js re-exports this) and the ability engine
 * (game/abilities.js — e.g. Strategic Shift's post-choice protection) can call
 * it without crossing into the handler layer.
 */
export function scReactionAvailable(game, ownerNum) {
  const mid = findSmugglingCompartmentMsgId(getDcList(game, ownerNum), getDcMessageIds(game, ownerNum));
  if (!mid) return false;
  if (cardNameIncludes(game?.exhaustedSkirmishUpgrades?.[mid], 'Smuggling Compartment')) return false;
  return (game?.[ccHandKey(ownerNum)] || []).length > 0;
}

/**
 * Locate an owned, usable [Smuggling Compartment] in a player's DC list.
 * Returns the parallel msgId, or null if absent/defeated/removed-from-game.
 *
 * @param {Array} dcList   - getDcList(game, pn)
 * @param {Array} msgIds   - getDcMessageIds(game, pn) (parallel to dcList)
 * @param {(msgId:string)=>boolean} [isRemoved] - optional depletion/removed check
 * @returns {string|null}
 */
export function findSmugglingCompartmentMsgId(dcList, msgIds, isRemoved) {
  const list = Array.isArray(dcList) ? dcList : [];
  const ids = Array.isArray(msgIds) ? msgIds : [];
  for (let i = 0; i < list.length; i++) {
    const dc = list[i];
    const name = dc?.dcName || dc;
    if (name !== SMUGGLING_COMPARTMENT_NAME) continue;
    if (dc?.defeated) continue;
    const mid = ids[i];
    if (!mid) continue;
    if (typeof isRemoved === 'function' && isRemoved(mid)) continue;
    return mid;
  }
  return null;
}

/**
 * Part 2 peek: the top and bottom cards of a deck.
 * @param {string[]} deck
 * @returns {{top:string, bottom:string, single:boolean}|null} null when empty
 */
export function smugglingCompartmentPeek(deck) {
  if (!Array.isArray(deck) || deck.length === 0) return null;
  return { top: deck[0], bottom: deck[deck.length - 1], single: deck.length === 1 };
}

/**
 * Part 2 reorder: move one of the two known cards. Returns a NEW deck array.
 *   'topToBottom' — send the current top card to the bottom
 *   'bottomToTop' — bring the current bottom card to the top
 *   'skip' / anything else — leave the deck unchanged
 * A deck of fewer than 2 cards has no meaningful move and is returned as-is.
 * @param {string[]} deck
 * @param {'topToBottom'|'bottomToTop'|'skip'} action
 * @returns {string[]}
 */
export function applySmugglingCompartmentReorder(deck, action) {
  const d = Array.isArray(deck) ? deck.slice() : [];
  if (d.length < 2) return d;
  if (action === 'topToBottom') d.push(d.shift());
  else if (action === 'bottomToTop') d.unshift(d.pop());
  return d;
}

/**
 * Part 1 set-aside: remove the chosen cards from a hand into a set-aside pile.
 * Only cards actually present in the hand are moved (each instance once).
 * Returns the new hand and the cards actually set aside.
 * @param {string[]} hand
 * @param {string[]} cardsToSetAside
 * @returns {{hand:string[], setAside:string[]}}
 */
export function setAsideFromHand(hand, cardsToSetAside) {
  const newHand = Array.isArray(hand) ? hand.slice() : [];
  const setAside = [];
  for (const name of (Array.isArray(cardsToSetAside) ? cardsToSetAside : [])) {
    const idx = newHand.indexOf(name);
    if (idx >= 0) {
      newHand.splice(idx, 1);
      setAside.push(name);
    }
  }
  return { hand: newHand, setAside };
}

/**
 * Part 1 return: merge set-aside cards back into a hand. Returns the new hand.
 * @param {string[]} hand
 * @param {string[]} setAside
 * @returns {string[]}
 */
export function returnSetAsideToHand(hand, setAside) {
  return [...(Array.isArray(hand) ? hand : []), ...(Array.isArray(setAside) ? setAside : [])];
}

/**
 * Part 1 return trigger: move every player's set-aside pile back into their
 * hand and clear the piles. Mutates `game` (hand arrays + the pile map) and
 * returns the list of releases so callers can log / refresh hand visuals.
 * Idempotent: a no-op when there is nothing set aside.
 * @param {object} game
 * @returns {Array<{playerNum:number, cards:string[]}>}
 */
export function releaseSmugglingCompartmentSetAside(game) {
  const released = [];
  const piles = game?.smugglingCompartmentSetAside;
  if (!piles) return released;
  for (const pnStr of Object.keys(piles)) {
    const cards = piles[pnStr];
    if (!Array.isArray(cards) || cards.length === 0) continue;
    const pn = Number(pnStr);
    const handKey = pn === 1 ? 'player1CcHand' : 'player2CcHand';
    game[handKey] = returnSetAsideToHand(game[handKey] || [], cards);
    released.push({ playerNum: pn, cards: cards.slice() });
  }
  if (released.length) game.smugglingCompartmentSetAside = {};
  return released;
}
