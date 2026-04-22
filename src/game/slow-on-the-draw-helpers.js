/**
 * Pure helpers for Greedo's **Slow on the Draw**.
 *
 * Card text: "When Greedo declares an attack, the targeted figure's
 *  owner may interrupt to perform an attack targeting Greedo first."
 *
 * Helper owns slug id + predicate. The pendingSlowOnTheDraw state
 * write, button row, and async prompt all stay handler-owned (they
 * are one-off orchestration, not reusable shape).
 *
 * Extracted from src/handlers/combat.js:2463.
 */

export const SLOW_ON_THE_DRAW_ABILITY_ID = 'slow_on_the_draw_greedo';

export function hasSlowOnTheDrawAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SLOW_ON_THE_DRAW_ABILITY_ID);
}
