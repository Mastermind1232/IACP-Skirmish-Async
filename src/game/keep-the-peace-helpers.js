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
 * Per IACP card text "Limit 1 'Keep the Peace' ability per group
 * activation" — and per user clarification 2026-05-09: maximum once
 * per ENEMY group activation. The limit is scoped to the attacking
 * group's activation cycle, so different attacker groups in the
 * same round can each trigger KTP once.
 *
 * Key shape: `${dcName}_ktp_${attackerMsgId}` — DC name + attacker
 * group's msgId. roundFigureAbilityUsed is cleared at round start,
 * so the entry only persists during the attacker's activation cycle
 * and any subsequent same-msgId activations within the round (rare
 * — typically a group activates once per round).
 */
export function buildKtpRoundKey(dcName, attackerMsgId) {
  return `${dcName}_ktp_${attackerMsgId || 'unknown'}`;
}

/**
 * Has the elite ability already fired for this dcName during this
 * attacker group's activation?
 */
export function isKtpAlreadyUsed(roundFigureAbilityUsed, dcName, attackerMsgId) {
  if (!roundFigureAbilityUsed || typeof roundFigureAbilityUsed !== 'object') return false;
  return !!roundFigureAbilityUsed[buildKtpRoundKey(dcName, attackerMsgId)];
}
