/**
 * Pure helpers for Director Krennic's **Advanced Weapons Research**.
 *
 * Card text: "At the start of each of your activations, a friendly
 *  figure within 2 spaces may gain 1 Damage Token or 1 Surge Token."
 *  Range extends to 3 with the **Advanced Com Systems** attachment.
 *
 * Extracted from src/engine/activation-setup.js so the rule logic is
 * test-importable without pulling in discord.js.
 */
import { countGameSpaces } from './board-helpers.js';
import { cardNameIncludes } from './card-names.js';

/** Return the AWR targeting range (2, or 3 with Advanced Com Systems). */
export function awrRange(attachments) {
  return cardNameIncludes(attachments || [], 'Advanced Com Systems') ? 3 : 2;
}

/**
 * Enumerate friendly figures eligible for AWR. Returns `[figureKey, pos]`
 * entries ordered so Krennic's own figureKey is first (same as the
 * original sort in activation-setup.js).
 *
 * @param {object} game - Game object with figurePositions.
 * @param {number} playerNum - Krennic's player number.
 * @param {string} selfFk - Krennic's figure key (e.g. 'Director Krennic-1-0').
 * @param {number} range - Result from awrRange().
 */
export function enumerateAwrTargets(game, playerNum, selfFk, range) {
  const positions = game?.figurePositions?.[playerNum] || {};
  const selfPos = positions[selfFk];
  if (!selfPos) return [];
  return Object.entries(positions)
    .filter(([, fp]) => fp && countGameSpaces(game, selfPos, fp) <= range)
    .sort(([a], [b]) => (a === selfFk ? -1 : b === selfFk ? 1 : 0));
}
