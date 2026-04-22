/**
 * Pure helpers for Jawa Scavenger (Elite/Regular)'s **Take Cover**.
 *
 * Card text: "While defending, apply +1 Block and -1 Evade to your
 *  defense results."
 *
 * Simple, always-on defensive passive. No gate — fires every time a
 * Jawa Scavenger defends. The -1 Evade is part of the card's
 * tradeoff (Jawa is trading dodge for hard-block).
 *
 * Extracted from src/handlers/combat.js (Take Cover block ~line 2099)
 * so the ID set + bonus shape are pinned by a probe.
 */

export const TAKE_COVER_JAWA_ABILITY_IDS = Object.freeze([
  'take_cover_jawa_elite',
  'take_cover_jawa_reg',
]);

export const TAKE_COVER_BONUS_BLOCK = 1;
export const TAKE_COVER_BONUS_EVADE = -1;

export function hasTakeCoverAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return TAKE_COVER_JAWA_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

/**
 * Pure computation of Take Cover bonuses on top of current totals.
 * Always applies when called — caller checks hasTakeCoverAbility first.
 */
export function applyTakeCoverBonus({ bonusBlock = 0, bonusEvade = 0 } = {}) {
  return {
    applied: true,
    bonusBlock: (bonusBlock || 0) + TAKE_COVER_BONUS_BLOCK,
    bonusEvade: (bonusEvade || 0) + TAKE_COVER_BONUS_EVADE,
  };
}
