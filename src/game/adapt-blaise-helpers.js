/**
 * Pure helpers for Agent Blaise's **Adapt** (reminder-only).
 *
 * Card text: "Adapt: The first time your opponent plays a Command card
 *  each round, choose 1 SPY or TROOPER. That figure becomes Hidden"
 *
 * IMPORTANT: this is currently wired as a **start-of-activation
 * reminder** only (see src/engine/activation-setup.js:773). No handler
 * implements the "opp plays first CC → choose SPY/TROOPER → Hidden"
 * mechanic. The reminder text and the library description both say
 * "choose a trait", which matches the generic Adapt rule but NOT the
 * Blaise-specific card text. This is a pinned latent bug; see
 * memory/project_latent_bugs_probe_grind.md.
 */

export const ADAPT_BLAISE_ABILITY_ID = 'adapt_blaise';

export function hasAdaptBlaiseAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(ADAPT_BLAISE_ABILITY_ID);
}
