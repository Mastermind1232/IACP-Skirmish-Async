/**
 * F1 Ability library: lookup by id, resolve surge (code-per-ability). No Discord.
 * Surge resolution uses combat.parseSurgeEffect; DCs still reference keys in dc-effects (surgeAbilities array).
 */
import { getAbilityLibrary } from '../data-loader.js';
import { parseSurgeEffect } from './combat.js';

/** Get ability metadata by id. Returns { type, surgeCost?, label?, ... } or null. */
export function getAbility(id) {
  const lib = getAbilityLibrary();
  return (lib?.abilities && lib.abilities[id]) || null;
}

/**
 * Resolve a surge ability id (same as key in dc-effects surgeAbilities) to modifiers.
 * Code-per-ability: surge effects are resolved via parseSurgeEffect (combat).
 * @param {string} abilityId - e.g. "damage 1", "pierce 2", "damage 1, stun"
 * @returns {{ damage: number, pierce: number, accuracy: number, conditions: string[] }}
 */
export function resolveSurgeAbility(abilityId) {
  return parseSurgeEffect(abilityId);
}

/**
 * Display label for a surge ability. Uses ability library when present, else raw id (for composites not in library).
 * @param {string} abilityId
 * @returns {string}
 */
export function getSurgeAbilityLabel(abilityId) {
  const entry = getAbility(abilityId);
  if (entry?.label) return entry.label;
  return abilityId || '';
}

/**
 * Draw N command cards from deck to hand.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {number} n - Number of cards to draw
 * @returns {string[]} - Cards drawn (may be fewer if deck has fewer than n cards)
 */
function drawCcCards(game, playerNum, n) {
  const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const deck = (game[deckKey] || []).slice();
  const hand = (game[handKey] || []).slice();
  const drew = [];
  for (let i = 0; i < n && deck.length > 0; i++) {
    const card = deck.shift();
    hand.push(card);
    drew.push(card);
  }
  game[deckKey] = deck;
  game[handKey] = hand;
  return drew;
}

/**
 * F3/F4: Resolve a non-surge ability by id (DC special or CC effect). Code-per-ability; most return manual.
 * @param {string|null|undefined} abilityId - Library id or synthetic key (e.g. dc_special:DCName:0 or CC card name).
 * @param {object} context - { game, ... } plus optional msgId, meta, playerNum, cardName, specialLabel.
 * @returns {{ applied: boolean, manualMessage?: string, drewCards?: string[] }}
 */
export function resolveAbility(abilityId, context) {
  const entry = abilityId ? getAbility(abilityId) : null;
  if (!entry || entry.type === 'surge') {
    return { applied: false, manualMessage: 'Resolve manually (see rules).' };
  }

  // ccEffect: Draw N cards
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const drew = drawCcCards(game, playerNum, entry.draw);
    return { applied: true, drewCards: drew };
  }

  return { applied: false, manualMessage: entry.label ? `Resolve manually: ${entry.label}` : 'Resolve manually (see rules).' };
}
