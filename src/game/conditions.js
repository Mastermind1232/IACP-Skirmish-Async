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
 *
 * Per destruct's 2026-05-05 audit, YWNDM-on-Fifth-Brother is NOT immunity:
 * the condition is APPLIED but INERT (token placed, effects suppressed —
 * matters for HK-style "while you have a HARMFUL condition" checks).
 * That semantic moved to areConditionEffectsSuppressed below.
 *
 * @param {object} game
 * @param {string} figureKey
 * @returns {boolean}
 */
export function isConditionImmune(game, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  const dcEff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const sIds = dcEff?.specialAbilityIds || [];
  if (sIds.includes('immune_onar') || sIds.includes('immune_snowtrooper_elite')) return true;
  return false;
}

/**
 * Check whether a figure's HARMFUL condition effects are currently suppressed.
 * The conditions remain APPLIED on the figure (token in figureConditions);
 * only their downstream effects (Bleed end-of-action damage, Stun cannot-
 * declare-attack, Weaken −1 to attack/defense) should be skipped.
 *
 * Currently: Fifth Brother under YWNDM.
 *
 * Per destruct 2026-05-05: "condition is applied but inert. token IS placed
 * on the figure, effects suppressed. matters for HKs (HK abilities key off
 * having a condition — the condition still satisfies that check, just
 * doesn't damage you)."
 *
 * @param {object} game
 * @param {string} figureKey
 * @returns {boolean}
 */
export function areConditionEffectsSuppressed(game, figureKey) {
  if (!game?.youWillNotDenyMeActive) return false;
  const dcName = dcNameFromFigureKey(figureKey);
  if (dcName?.toLowerCase().includes('fifth brother')) return true;
  return false;
}

/**
 * Check whether a figure cannot currently be defeated. Per destruct 2026-05-05:
 * "damage tokens capped at health. Pierce does NOT overflow."
 *
 * Sources today:
 *   - YWNDM (You Will Not Deny Me) on Fifth Brother
 *   - Second Chance CC attached to a specific DC msgId
 *   - Sustained by Rage on Krrsantan (when "no activation resolved this round")
 *
 * The destruct-correct semantic is: when this returns true, applying damage
 * that would defeat the figure should leave HP at 0 (or damage at health,
 * equivalently) and SUPPRESS the defeat trigger. Subsequent damage hits
 * with flag still active also stay at 0/no-defeat. A heal removes damage
 * normally and may bring the figure back above 0.
 *
 * This replaces the legacy "heal to 1 on defeat" approach which incorrectly
 * left figures vulnerable to a single-damage follow-up.
 *
 * @param {object} game
 * @param {string} figureKey
 * @param {string} [msgId] - optional, enables Second Chance check
 * @returns {boolean}
 */
export function isCannotBeDefeated(game, figureKey, msgId = null) {
  if (!game) return false;
  // YWNDM applies to Fifth Brother only.
  if (game.youWillNotDenyMeActive) {
    const dcName = dcNameFromFigureKey(figureKey);
    if (dcName?.toLowerCase().includes('fifth brother')) return true;
  }
  // Second Chance is keyed per msgId.
  if (msgId && game.secondChanceDcMsgId?.[msgId]) return true;
  // Sustained by Rage (Krrsantan): requires "no activation resolved this round."
  // The activation-state check is complex (read the figure's DC ability + the
  // current round's activation history). Existing call sites at
  // engine/combat-bridge.js:1015+ check it inline; not yet generalized here.
  // Future: hoist that check into this helper too. For now, callers that need
  // SbR coverage check independently.
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
