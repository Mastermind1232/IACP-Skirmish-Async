/**
 * Pure helpers for Ezra Bridger's **Much to Learn**.
 *
 * Canonical card text (data/dc-effects.json, IACP image): "While
 *  attacking, if there is **another** friendly unique figure within 3
 *  spaces, you may reroll 1 attack die. If that friendly Unique is a
 *  Force User, you may choose a side instead."
 *
 * "another" excludes self — Ezra cannot trigger Much to Learn off his
 * own attack. Iteration site at src/handlers/combat.js skips the
 * attacker's own figureKey, which matches.
 *
 * Helper owns slug id, range predicate (distance ≤ 3), reroll
 * delta, FORCE USER keyword string, and small DC-effect-shape
 * predicates. Iteration over friendly positions + distance
 * counting stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:2033.
 */

export const MUCH_TO_LEARN_ABILITY_ID = 'much_to_learn';
export const MUCH_TO_LEARN_MAX_DISTANCE = 3;
export const MUCH_TO_LEARN_REROLL_DELTA = 1;
export const MUCH_TO_LEARN_FORCE_USER_KEYWORD = 'FORCE USER';

export function hasMuchToLearnAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(MUCH_TO_LEARN_ABILITY_ID);
}

export function muchToLearnInRange(distance) {
  return Number.isFinite(distance) && distance <= MUCH_TO_LEARN_MAX_DISTANCE;
}

/** True iff the DC effect entry is flagged unique. */
export function isUniqueFriendly(fkEff) {
  return Boolean(fkEff?.unique);
}

/** True iff the DC effect has FORCE USER in its keywords (case-insensitive). */
export function isForceUserFriendly(fkEff) {
  const kws = fkEff?.keywords;
  if (!Array.isArray(kws)) return false;
  return kws.map(k => String(k).toUpperCase()).includes(MUCH_TO_LEARN_FORCE_USER_KEYWORD);
}

export function applyMuchToLearnReroll({ rerollOneAttackDie = 0 } = {}) {
  return {
    applied: true,
    rerollOneAttackDie: (rerollOneAttackDie || 0) + MUCH_TO_LEARN_REROLL_DELTA,
  };
}

/**
 * Which Much to Learn option is legal, given the friendly figures around Ezra.
 *
 * The card gives two mutually-exclusive outcomes and the difference matters: a
 * reroll is random, turning a die to any side is chosen. alexanbv 2026-08-31:
 * "For Ezra make sure there is a logic path to detect which option is legal."
 *
 * Rules, in order:
 *   - the source must be ANOTHER figure (Ezra cannot trigger off himself),
 *   - it must be a friendly UNIQUE,
 *   - it must be within 3 spaces,
 *   - if any qualifying source is a FORCE USER the mode is 'turn', otherwise
 *     'reroll'. 'turn' is strictly better, so a FORCE USER always wins even if a
 *     non-Force-User unique was found first.
 *
 * Distance counting is injected because it needs the map and closed-door edges,
 * which belong to the handler.
 *
 * @param {object[]} candidates {figureKey, dcName, effect, distance}
 * @param {string} selfFigureKey Ezra's own figure key, excluded
 * @returns {{mode: 'turn'|'reroll', sourceFigureKey: string, sourceName: string}|null}
 */
export function resolveMuchToLearnMode(candidates, selfFigureKey) {
  if (!Array.isArray(candidates)) return null;
  let fallback = null;
  for (const c of candidates) {
    if (!c || c.figureKey === selfFigureKey) continue;
    if (!isUniqueFriendly(c.effect)) continue;
    if (!muchToLearnInRange(c.distance)) continue;
    if (isForceUserFriendly(c.effect)) {
      return { mode: 'turn', sourceFigureKey: c.figureKey, sourceName: c.dcName };
    }
    if (!fallback) {
      fallback = { mode: 'reroll', sourceFigureKey: c.figureKey, sourceName: c.dcName };
    }
  }
  return fallback;
}
