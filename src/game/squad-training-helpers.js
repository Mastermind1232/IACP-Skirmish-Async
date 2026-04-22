/**
 * Pure helpers for the **Squad Training** family attacker +1 reroll.
 *
 * Card text: "While attacking, while adjacent to another friendly
 *  TROOPER, you may reroll 1 attack die."
 *
 * Four library slugs in the family; three are wired to live DCs
 * (Shoretrooper Elite, Stormtrooper Elite, Stormtrooper Regular). The
 * fourth — `squad_training_shoretrooper_reg` — has no live DC
 * (Shoretrooper Regular does not exist in dc-effects.json) and is a
 * LATENT orphan; probe pins the orphan state.
 *
 * Extracted from src/handlers/combat.js:2777. This helper covers the
 * id-set membership and the +1 reroll bump. The adjacency-and-TROOPER
 * spatial check remains in the handler — it requires live game state.
 */

export const SQUAD_TRAINING_ABILITY_IDS = Object.freeze([
  'squad_training_shoretrooper_elite',
  'squad_training_shoretrooper_reg',
  'squad_training_stormtrooper_elite',
  'squad_training_stormtrooper_reg',
]);

export const SQUAD_TRAINING_REROLL = 1;

export function hasSquadTrainingAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return SQUAD_TRAINING_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

export function applySquadTrainingReroll(atkSpecialReroll = 0) {
  return (atkSpecialReroll || 0) + SQUAD_TRAINING_REROLL;
}
