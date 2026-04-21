/**
 * Pure helpers for The Child's **Force Exhaustion**.
 *
 * Card text (paraphrase): "When a figure you control is targeted by an
 *  attack, you may declare that The Child becomes Incapacitated. Remove
 *  1 attack die from that attack and the attacker becomes Weakened."
 *
 * Coverage extension: the trigger also fires when the target carries
 * the **Clan of Two** attachment (Mandalorian/Grogu pair), not just
 * The Child itself.
 *
 * Extracted from src/handlers/combat.js (trigger declaration) and
 * src/handlers/combat-reactions.js (die removal) so the rule logic is
 * testable without discord.js.
 */

import { dcNameFromFigureKey } from './index.js';
import { cardNameIncludes } from './card-names.js';

/**
 * Order in which attack dice are culled by Force Exhaustion. Matches
 * the card's intent of removing the attacker's weakest die first.
 */
export const FORCE_EXHAUSTION_DIE_REMOVE_ORDER = Object.freeze([
  'yellow', 'green', 'blue', 'red',
]);

/**
 * Locate The Child on the defender's side. Returns the figure key or
 * null if no live Child exists in that player's figurePositions map.
 *
 * Case-insensitive match on `dcNameFromFigureKey`.
 */
export function findChildFigureKey(game, defenderPlayerNum) {
  const positions = game?.figurePositions?.[defenderPlayerNum] || {};
  for (const fk of Object.keys(positions)) {
    if (String(dcNameFromFigureKey(fk)).toLowerCase() === 'the child') return fk;
  }
  return null;
}

/**
 * Decide whether a Force Exhaustion offer should be presented.
 *
 * Eligibility:
 *   - Target is The Child (by dcName), OR target's attachments include
 *     "Clan of Two".
 *   - A live Child exists on the defender's side.
 *   - Child is not already Incapacitated (`game.childIncapacitated`).
 *
 * Returns:
 *   { eligible: true, childFigureKey, reasonCode: 'target-is-child' | 'clan-of-two' }
 *   { eligible: false, reasonCode: ... }
 */
export function canOfferForceExhaustion(
  game,
  defenderPlayerNum,
  targetDcName,
  defenderUpgrades = [],
) {
  if (game?.childIncapacitated) {
    return { eligible: false, reasonCode: 'already-incapacitated' };
  }
  const targetIsChild = targetDcName === 'The Child';
  const targetHasClanOfTwo = cardNameIncludes(defenderUpgrades || [], 'Clan of Two');
  if (!targetIsChild && !targetHasClanOfTwo) {
    return { eligible: false, reasonCode: 'target-not-eligible' };
  }
  const childFigureKey = findChildFigureKey(game, defenderPlayerNum);
  if (!childFigureKey) {
    return { eligible: false, reasonCode: 'no-child-alive' };
  }
  return {
    eligible: true,
    childFigureKey,
    reasonCode: targetIsChild ? 'target-is-child' : 'clan-of-two',
  };
}

/**
 * Remove 1 die from the given dice list using the Force Exhaustion
 * priority order (yellow > green > blue > red). Non-mutating:
 * returns a fresh array plus the color that was removed (or null).
 */
export function removeForceExhaustionDie(dice) {
  const copy = [...(dice || [])];
  for (const color of FORCE_EXHAUSTION_DIE_REMOVE_ORDER) {
    const idx = copy.indexOf(color);
    if (idx !== -1) {
      copy.splice(idx, 1);
      return { dice: copy, removedColor: color };
    }
  }
  return { dice: copy, removedColor: null };
}
