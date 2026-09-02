/**
 * Ability-id predicates for two -1 DODGE passives.
 *
 *  - **Disposable** (Hired Gun Regular, defender side): its OWN defense results
 *    take -1 Dodge. "Paid to take hits."
 *  - **Conclusion** (HK-47, attacker side): -1 Dodge to the defender's results.
 *
 * NOTE THE FILE NAME. Both were originally implemented as -1 EVADE and both are
 * actually -1 DODGE (alexanbv: Conclusion 2026-09-02 by card art, Hired Gun
 * confirmed the same day — "hired gun (regular) are -1 dodge"). Dodge and Evade
 * are near-identical glyphs on the printed cards, which is how they were
 * conflated. `applyEvadeDebuff` below is kept only for callers that genuinely
 * want an Evade debuff; NEITHER of these two uses it any more.
 */

export const DISPOSABLE_ABILITY_ID = 'disposable';
export const CONCLUSION_ABILITY_ID = 'conclusion';
export const EVADE_DEBUFF_DELTA = -1;

export function hasDisposableAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(DISPOSABLE_ABILITY_ID);
}

export function hasConclusionAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(CONCLUSION_ABILITY_ID);
}

export function applyEvadeDebuff({ bonusEvade = 0 } = {}) {
  return {
    applied: true,
    bonusEvade: (bonusEvade || 0) + EVADE_DEBUFF_DELTA,
  };
}
