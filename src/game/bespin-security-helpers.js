/**
 * Pure helpers for Wing Guard (Elite)'s **Bespin Security**.
 *
 * Card text: "While an adjacent friendly LEADER or SCUM TROOPER is
 *  attacking, it may reroll 1 attack die."
 *
 * Split into three decisions:
 *  1) does the attacker qualify (LEADER, or SCUM TROOPER)?
 *  2) is there an adjacent friendly DC carrying the Bespin slug?
 *  3) apply +1 rerollOneAttackDie.
 *
 * Adjacency lookup lives in the handler (combat.js:2052) since it
 * needs mapSpaces + figurePositions; this helper only owns the
 * attacker-trait check + the reroll math.
 *
 * Extracted from src/handlers/combat.js:2051.
 */

export const BESPIN_SECURITY_ABILITY_ID = 'bespin_security';
export const BESPIN_SECURITY_REROLLS = 1;

export function hasBespinSecurityAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(BESPIN_SECURITY_ABILITY_ID);
}

/**
 * Does the attacker match Bespin Security's trait gate?
 *   - LEADER (any affiliation), OR
 *   - TROOPER with affiliation === 'Scum'
 *
 * Keywords are compared case-insensitively to match the handler's
 * `.map(k => k.toUpperCase())` pipeline.
 */
export function attackerQualifiesForBespin(keywords, affiliation) {
  if (!Array.isArray(keywords)) return false;
  const upper = keywords.map((k) => String(k).toUpperCase());
  if (upper.includes('LEADER')) return true;
  if (upper.includes('TROOPER') && affiliation === 'Scum') return true;
  return false;
}

/**
 * Apply the +1 attack-die reroll to pendingCombat totals. Pure.
 */
export function applyBespinSecurityReroll({ rerollOneAttackDie = 0 } = {}) {
  return {
    applied: true,
    rerollOneAttackDie: (rerollOneAttackDie || 0) + BESPIN_SECURITY_REROLLS,
  };
}
