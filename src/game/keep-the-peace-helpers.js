/**
 * Pure helpers for **Keep the Peace** (Imperial Royal Guard E/R).
 *
 * Card text:
 *   - **Elite**: "When a hostile figure attacks a space adjacent to
 *     you, the attacker suffers 1 Strain." (automatic; limit 1 per
 *     group activation per card)
 *   - **Regular**: "When a hostile figure attacks a space adjacent
 *     to you, you may suffer 1 Strain. If you do, the attacker
 *     suffers 1 Strain." (opt-in)
 *
 * Extracted from src/handlers/combat.js:2053. Adjacency and target-
 * figure lookup stay handler-owned.
 */

export const KTP_ELITE_ABILITY_ID = 'keep_the_peace_elite';
export const KTP_REGULAR_ABILITY_ID = 'keep_the_peace_regular';
export const KTP_STRAIN_AMOUNT = 1;

export function hasKtpEliteAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(KTP_ELITE_ABILITY_ID);
}

export function hasKtpRegularAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(KTP_REGULAR_ABILITY_ID);
}

/**
 * Round-scoped once-per-figure usage key. Ties the limit to the
 * DC name + current round, matching the handler pattern at
 * combat.js:2066.
 */
export function buildKtpRoundKey(dcName, currentRound) {
  const round = currentRound || 0;
  return `${dcName}_ktp_${round}`;
}

/**
 * Has the elite ability already fired for this dcName this round?
 */
export function isKtpAlreadyUsed(roundFigureAbilityUsed, dcName, currentRound) {
  if (!roundFigureAbilityUsed || typeof roundFigureAbilityUsed !== 'object') return false;
  return !!roundFigureAbilityUsed[buildKtpRoundKey(dcName, currentRound)];
}
