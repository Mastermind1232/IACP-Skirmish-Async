/**
 * Pure helpers for Doctor Aphra's **Dubious Counterparts**.
 *
 * Card text: "After a friendly DROID resolves Missile Salvo or Invasive
 *  Procedure, that figure may perform 1 additional action. Scum DROID
 *  Deployment Cards are allowed in non-Scum armies."
 *
 * Extracted from src/handlers/combat-special-effects.js and
 * src/handlers/dc-play-area.js so the trigger logic is testable without
 * discord.js.
 */

import { getDcList } from './player-helpers.js';

/**
 * Is Doctor Aphra in the given player's DC list AND has at least one
 * figure still on the board?
 */
export function isAphraAlive(game, playerNum) {
  const dcList = getDcList(game, playerNum) || [];
  const inList = dcList.some((dc) => dc?.dcName === 'Doctor Aphra');
  if (!inList) return false;
  const positions = game?.figurePositions?.[playerNum] || {};
  return Object.keys(positions).some((fk) => fk.startsWith('Doctor Aphra-'));
}

/**
 * Apply the +1 action bump to an actionsData record. Mutates in place
 * and returns the new `remaining` value.
 *
 * Pattern (from both call sites):
 *   remaining = min((total ?? fallback) + 1, remaining + 1)
 *
 * The +1-to-total cap means the bump can push remaining above the
 * usual per-activation cap by exactly 1.
 */
export function applyDubiousCounterpartsActionBump(actionsData, totalFallback = 2) {
  if (!actionsData) return null;
  const total = actionsData.total ?? totalFallback;
  actionsData.remaining = Math.min(total + 1, actionsData.remaining + 1);
  return actionsData.remaining;
}
