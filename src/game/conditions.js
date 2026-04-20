/**
 * Condition helpers — pure game-state operations on figureConditions.
 * No Discord dependency.
 */
import { getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey } from './dc-helpers.js';

export const HARMFUL_CONDITIONS = ['Stun', 'Bleed', 'Weaken'];

/**
 * Remove a specific condition from a figure.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} cond - condition name to remove (e.g. 'Stun', 'Bleed')
 */
export function filterCondition(game, figureKey, cond) {
  if (!game.figureConditions?.[figureKey]) return;
  // Disarm permanent Weakened: skip removal of Weaken if the figure has the Disarm lock
  if (cond === 'Weaken' && game.disarmPermanentWeakened?.[figureKey]) return;
  game.figureConditions[figureKey] = game.figureConditions[figureKey].filter((c) => c !== cond);
  if (game.figureConditions[figureKey].length === 0) delete game.figureConditions[figureKey];
}

/**
 * Check if a figure is immune to HARMFUL conditions (Stun, Bleed, Weaken).
 * Currently: Onar Koma, Snowtrooper Elite.
 * @param {object} game
 * @param {string} figureKey
 * @returns {boolean}
 */
export function isConditionImmune(game, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  const dcEff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const sIds = dcEff?.specialAbilityIds || [];
  if (sIds.includes('immune_onar') || sIds.includes('immune_snowtrooper_elite')) return true;
  // You Will Not Deny Me: Fifth Brother ignores harmful conditions while active
  if (game?.youWillNotDenyMeActive && dcName?.toLowerCase().includes('fifth brother')) return true;
  return false;
}

/**
 * Apply a condition to a figure (with dedup). Initialises figureConditions if needed.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} cond - condition name (e.g. 'Focus', 'Stun', 'Hide')
 * @returns {boolean} true if the condition was newly applied, false if already present
 */
export function applyCondition(game, figureKey, cond) {
  // CRR-INCP-002: an incapacitated figure cannot have conditions applied.
  // Skirmish substrate: The Child while game.childIncapacitated is true.
  if (game?.childIncapacitated && dcNameFromFigureKey(figureKey) === 'The Child') return false;
  game.figureConditions = game.figureConditions || {};
  game.figureConditions[figureKey] = game.figureConditions[figureKey] || [];
  if (game.figureConditions[figureKey].includes(cond)) return false;
  game.figureConditions[figureKey].push(cond);
  return true;
}

/**
 * Ensure a condition is set on a figure, replacing any existing instance.
 * Useful when a condition must be present exactly once regardless of prior state.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} cond
 */
/**
 * Apply a condition and, if it stuck, append a bonus die to attackInfo.
 * Encodes the rule: "become [Condition] → gain +1 [die color]".
 * @param {object} game
 * @param {string} figureKey
 * @param {string} condition - e.g. 'Focus'
 * @param {object} attackInfo - current attack info (has .dice array)
 * @param {string} dieColor - e.g. 'green'
 * @returns {{ attackInfo: object, applied: boolean }}
 */
export function applyConditionWithDie(game, figureKey, condition, attackInfo, dieColor) {
  if (applyCondition(game, figureKey, condition)) {
    return {
      attackInfo: { ...attackInfo, dice: [...(attackInfo.dice || []), dieColor] },
      applied: true,
    };
  }
  return { attackInfo, applied: false };
}

export function resetCondition(game, figureKey, cond) {
  game.figureConditions = game.figureConditions || {};
  game.figureConditions[figureKey] = [...(game.figureConditions[figureKey] || []).filter(c => c !== cond), cond];
}
