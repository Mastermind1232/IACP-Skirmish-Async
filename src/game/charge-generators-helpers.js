/**
 * Pure helpers for AT-DP's **Charge Generators**.
 *
 * Card text: "While attacking, if you have suffered fewer than 9
 *  Damage, apply +1 Damage to the attack results and you may reroll 1
 *  attack die."
 *
 * Attacker passive with health-state gate (strict: <9). Single DC
 * wiring: AT-DP. Extracted from src/handlers/combat.js:2706.
 */

export const CHARGE_GENERATORS_ABILITY_ID = 'charge_generators';
export const CHARGE_GENERATORS_DAMAGE_CAP = 9;
export const CHARGE_GENERATORS_BONUS_HITS = 1;
export const CHARGE_GENERATORS_REROLL = 1;

export function hasChargeGeneratorsAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(CHARGE_GENERATORS_ABILITY_ID);
}

export function chargeGeneratorsApplies(damageSuffered) {
  if (typeof damageSuffered !== 'number') return false;
  return damageSuffered < CHARGE_GENERATORS_DAMAGE_CAP;
}

export function applyChargeGeneratorsBonus(
  { bonusHits = 0 } = {},
  atkSpecialReroll = 0,
) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + CHARGE_GENERATORS_BONUS_HITS,
    atkSpecialReroll: (atkSpecialReroll || 0) + CHARGE_GENERATORS_REROLL,
  };
}
