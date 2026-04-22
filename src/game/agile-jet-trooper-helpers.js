/**
 * Pure helpers for Jet Trooper (Elite/Regular)'s **Agile**.
 *
 * Card text: "While defending, you may convert 1 Block to 1 Evade."
 *
 * Rule nuance: any Block die (from the base defense roll OR from
 * bonus-Block sources) counts toward the "1 Block" requirement, but
 * the conversion itself is always taken out of the bonus-block pool
 * (combat.bonusBlock) — the engine treats rolled Block as untouched
 * and adds a negative bonusBlock to net out.
 *
 * Extracted from src/handlers/combat.js (Agile block ~line 4164) so
 * the predicate + conversion math are covered by a probe.
 */

export const AGILE_JET_TROOPER_ABILITY_IDS = Object.freeze([
  'agile_jet_trooper_elite',
  'agile_jet_trooper_reg',
]);

/**
 * Does a DC's specialAbilityIds carry the Jet-Trooper Agile passive?
 */
export function hasAgileAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return AGILE_JET_TROOPER_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

/**
 * Compute the bonusBlock/bonusEvade deltas for an Agile conversion.
 * Input is the defender's current defense totals:
 *   { block, bonusBlock, bonusEvade }
 * Any falsy value defaults to 0.
 *
 * Returns the new { bonusBlock, bonusEvade } values plus an `applied`
 * flag. When the defender has no Block at all (roll + bonus), the
 * conversion is a no-op and `applied` is false.
 */
export function applyAgileConversion({
  block = 0,
  bonusBlock = 0,
  bonusEvade = 0,
} = {}) {
  const total = (block || 0) + (bonusBlock || 0);
  if (total <= 0) {
    return { applied: false, bonusBlock: bonusBlock || 0, bonusEvade: bonusEvade || 0 };
  }
  return {
    applied: true,
    bonusBlock: (bonusBlock || 0) - 1,
    bonusEvade: (bonusEvade || 0) + 1,
  };
}
