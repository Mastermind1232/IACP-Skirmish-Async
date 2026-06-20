/**
 * Pure helpers for The Child's **Force Exhaustion**.
 *
 * Ruling (alexanbv, refined): when an attack targeting The Child — or a
 * figure carrying the **Clan of Two** attachment — is declared, The Child's
 * owner may have The Child become **Incapacitated**. There are two cases,
 * distinguished by who the attack's target is:
 *
 *  - ALWAYS (both cases): on incap, remove 1 attack die from the attack
 *    (weakest-first order via removeForceExhaustionDie) AND the attacker
 *    becomes **Weakened** (respecting condition immunity).
 *
 *  - ADDITIONALLY, only when The Child *itself* is the target
 *    (reasonCode 'target-is-child'): the attack is also SKIPPED — it
 *    MISSES with no dice rolled, the pipeline jumping straight to the
 *    "after resolving an attack" step (like On the Lam forcing a miss).
 *    The attacker still loses Focus and Hidden.
 *
 *  - When a Clan-of-Two-ATTACHED figure is the target (reasonCode
 *    'clan-of-two'): only the die-removal + Weaken happen; the attack
 *    PROCEEDS normally with the reduced dice (no forced miss).
 *
 * This module owns the OFFER eligibility (canOfferForceExhaustion /
 * findChildFigureKey) and the pure die-removal helper
 * (removeForceExhaustionDie). The incap resolution (die removal + Weaken,
 * and the forced-miss skip for the target-is-child case) lives in
 * src/handlers/combat-reactions.js (handleForceExhaustion). Extracted so
 * the rule logic is testable without discord.js.
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
