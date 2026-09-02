/**
 * Pure helpers for Rebel Trooper (Elite/Regular)'s **Aim**.
 *
 * Card text: "If you have not exited a space during this activation,
 *  apply +1 Damage and +2 Accuracy to your attack results."
 *
 * Engine semantics (src/handlers/combat.js ~line 2107):
 *   - "Has not moved" is tracked via game.figureMoved[figureKey];
 *     truthy = moved at least once this activation.
 *   - Bonus is a single flat +1 Damage / +2 Accuracy; not stackable with
 *     itself (the probe locks this in so future refactors don't
 *     silently make it apply per-die or per-roll).
 *
 * Extracted so the predicate + bonus shape are covered by a probe.
 */

export const AIM_REBEL_TROOPER_ABILITY_IDS = Object.freeze([
  'aim_rebel_trooper_elite',
  'aim_rebel_trooper_reg',
]);

export const AIM_BONUS_HITS = 1;
export const AIM_BONUS_ACCURACY = 2;

/**
 * Does a DC's specialAbilityIds carry either Rebel Trooper Aim slug?
 */
export function hasAimAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return AIM_REBEL_TROOPER_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

/**
 * Whether the Aim bonus applies for `figureKey`, given the game's
 * figure-moved map. The bonus only fires when the figure has NOT
 * moved during the current activation.
 */
export function aimBonusApplies(figureKey, figureMoved = {}) {
  if (!figureKey) return false;
  return !figureMoved?.[figureKey];
}

/**
 * Pure computation of the Aim bonus given current attack totals.
 *
 *   { bonusHits, bonusAccuracy } → new { bonusHits, bonusAccuracy,
 *   applied }
 *
 * `applied` is always true here — the caller is responsible for
 * checking `aimBonusApplies` first. This helper only does the math
 * so a future scoring change is caught by the probe.
 */
export function applyAimBonus({ bonusHits = 0, bonusAccuracy = 0 } = {}) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + AIM_BONUS_HITS,
    bonusAccuracy: (bonusAccuracy || 0) + AIM_BONUS_ACCURACY,
  };
}
