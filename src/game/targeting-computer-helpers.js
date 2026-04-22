/**
 * Pure helpers for the **Targeting Computer** family attacker reroll
 * bump.
 *
 * Card text (Targeting Computer): "While attacking, you may reroll 1
 *  attack die."
 * Card text (Advanced Targeting Computer — Dark Trooper Mk III):
 *  "When you declare an attack, you become Focused. During this
 *  attack, you may reroll 1 attack die. If the result is 3 or more
 *  Accuracy, the defender must reroll 1 defense die."
 *
 * Six DCs share the base Targeting Computer slug (HK Assassin Elite,
 * IG-11, Probe Droid Elite, Sentry Droid Elite/Regular, AT-ST) and
 * grant a straight +1 attacker reroll. Dark Trooper Mk III's Advanced
 * Targeting Computer shares the reroll bump, plus extra effects
 * wired elsewhere (Focused at combat.js:1755; defender-reroll at
 * :3373). Those extras are NOT in this helper's scope.
 */

export const TARGETING_COMPUTER_ABILITY_IDS = Object.freeze([
  'targeting_computer_hk_elite',
  'targeting_computer_ig11',
  'targeting_computer_probe_elite',
  'targeting_computer_sentry_elite',
  'targeting_computer_sentry_reg',
  'targeting_computer_atst',
  'adv_targeting_computer_dark_trooper',
]);

export const TARGETING_COMPUTER_REROLL = 1;

export function hasTargetingComputerAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return TARGETING_COMPUTER_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

export function applyTargetingComputerReroll(atkSpecialReroll = 0) {
  return (atkSpecialReroll || 0) + TARGETING_COMPUTER_REROLL;
}
