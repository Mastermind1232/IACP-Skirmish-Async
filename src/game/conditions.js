/**
 * Condition helpers — pure game-state operations on figureConditions.
 * No Discord dependency.
 */
import { getDcEffects } from '../data-loader.js';

export const HARMFUL_CONDITIONS = ['Stun', 'Bleed', 'Weaken'];

/**
 * Remove a specific condition from a figure.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} cond - condition name to remove (e.g. 'Stun', 'Bleed')
 */
export function filterCondition(game, figureKey, cond) {
  if (!game.figureConditions?.[figureKey]) return;
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
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const dcEff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const sIds = dcEff?.specialAbilityIds || [];
  return sIds.includes('immune_onar') || sIds.includes('immune_snowtrooper_elite');
}

/**
 * Apply a condition to a figure (with dedup). Initialises figureConditions if needed.
 * @param {object} game
 * @param {string} figureKey
 * @param {string} cond - condition name (e.g. 'Focus', 'Stun', 'Hide')
 * @returns {boolean} true if the condition was newly applied, false if already present
 */
export function applyCondition(game, figureKey, cond) {
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
export function resetCondition(game, figureKey, cond) {
  game.figureConditions = game.figureConditions || {};
  game.figureConditions[figureKey] = [...(game.figureConditions[figureKey] || []).filter(c => c !== cond), cond];
}
