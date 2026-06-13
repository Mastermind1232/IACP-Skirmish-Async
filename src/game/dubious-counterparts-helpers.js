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
import { grantActionToFigure, figureActionsRemaining } from './activation-state.js';

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
 * Apply the +1 action bump to the active figure's per-figure budget.
 * Mutates actionsData in place and returns the figure's new remaining.
 *
 * Actions are STRICTLY per-figure (alexanbv 2026-06-13): the bump goes
 * to actionsData.perFigureRemaining[selectedFigure], not a group-level
 * counter. The old behavior allowed remaining to reach (total + 1) — one
 * over the base 2 — so the per-figure cap here is 3 to preserve that
 * extra-action allowance.
 */
export function applyDubiousCounterpartsActionBump(actionsData) {
  if (!actionsData) return null;
  const figIdx = actionsData.selectedFigure ?? 0;
  grantActionToFigure(actionsData, figIdx, 1, 3);
  return figureActionsRemaining(actionsData, figIdx);
}
