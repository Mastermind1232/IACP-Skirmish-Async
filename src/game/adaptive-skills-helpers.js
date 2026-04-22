/**
 * Pure helpers for Mara Jade's **Adaptive Skills**.
 *
 * Card text: "Your affiliation matches your army's affiliation."
 *
 * Two concerns, both army-building / structural:
 *   1. Find the Mara-Jade-shaped DC in an army (any DC whose
 *      specialAbilityIds include adaptive_skills_mara_jade).
 *   2. Resolve the army's lowercase primary affiliation and map it
 *      to the trait keyword the engine injects on Mara's figure
 *      (Imperial → Hunter, Scum → Smuggler, Rebel → Guardian).
 *
 * Extracted from:
 *   - src/data-loader.js (trait-injection into keywords)
 *   - src/game/cc-timing.js (CC restriction-match pivot)
 *   - src/handlers/cc-hand.js (Fast Learner round-use tagging)
 *
 * so the army-scan + trait-map semantics are covered by a probe.
 */

export const ADAPTIVE_SKILLS_ABILITY_ID = 'adaptive_skills_mara_jade';

/**
 * Affiliation → injected trait map. The card's mechanical effect is
 * to give Mara Jade a trait that aligns with her army:
 *   Imperial → Hunter, Scum → Smuggler, Rebel → Guardian.
 * Keys are lowercase for resilience to casing drift in card data.
 */
export const ADAPTIVE_SKILLS_TRAIT_MAP = Object.freeze({
  imperial: 'Hunter',
  scum: 'Smuggler',
  rebel: 'Guardian',
});

function resolveDcName(entry) {
  return typeof entry === 'object' ? (entry?.dcName || entry?.displayName) : entry;
}

/**
 * Find the DC name in `dcList` that carries Adaptive Skills. Accepts
 * both string and object DC-list entries. Returns null when not found.
 */
export function findAdaptiveSkillsDc(dcList, dcEffects) {
  if (!Array.isArray(dcList)) return null;
  for (const entry of dcList) {
    const dn = resolveDcName(entry);
    if (!dn) continue;
    const sIds = dcEffects?.[dn]?.specialAbilityIds || [];
    if (sIds.includes(ADAPTIVE_SKILLS_ABILITY_ID)) return dn;
  }
  return null;
}

/**
 * Return the lowercase affiliation of the first non-"Any" DC in the
 * list (legacy "first-seen" heuristic — matches the inlined behavior
 * at data-loader.js and cc-timing.js). Returns null when no definite
 * affiliation is present.
 *
 * NOTE: validateArmyAffiliation uses a more principled "most common"
 * tally; the engine paths use first-seen. Documented here so probe
 * drift is loud if either site diverges.
 */
export function firstSeenArmyAffiliation(dcList, dcEffects) {
  if (!Array.isArray(dcList)) return null;
  for (const entry of dcList) {
    const dn = resolveDcName(entry);
    if (!dn) continue;
    const aff = (dcEffects?.[dn]?.affiliation || '').toLowerCase();
    if (aff && aff !== 'any') return aff;
  }
  return null;
}

/**
 * Resolve the trait that Adaptive Skills grants given an affiliation
 * string. Case-insensitive. Returns null when affiliation is unknown.
 */
export function adaptiveSkillsTrait(affiliation) {
  if (!affiliation) return null;
  return ADAPTIVE_SKILLS_TRAIT_MAP[String(affiliation).toLowerCase()] || null;
}

/**
 * High-level convenience: scan `dcList`, find Mara, resolve her army's
 * trait. Returns { dcName, trait } (either/both may be null).
 */
export function resolveAdaptiveSkills(dcList, dcEffects) {
  const dcName = findAdaptiveSkillsDc(dcList, dcEffects);
  if (!dcName) return { dcName: null, trait: null };
  const aff = firstSeenArmyAffiliation(dcList, dcEffects);
  return { dcName, trait: adaptiveSkillsTrait(aff) };
}
