/**
 * Pure helpers for Iden Versio's **Droid Kit**.
 *
 * Card text: "At the start of each of your activations, if Dio is in
 *  your space, gain 1 Power Token of your choice (Damage, Surge, Block,
 *  or Evade)."
 *
 * Extracted from src/engine/activation-setup.js so the trigger logic is
 * testable without discord.js.
 */

/**
 * Determine whether Iden's Droid Kit trigger applies.
 *
 * Returns:
 *   { applicable: true, idenPos, dioFigureKey, dioPos }
 *   { applicable: false, reason: 'Dio is not in play' | 'Dio is not in the same space' | 'Iden has no position' }
 *
 * @param {object} game
 * @param {number} playerNum
 * @param {string} idenFigureKey - e.g. 'Iden Versio-1-0'
 */
export function detectDroidKitTrigger(game, playerNum, idenFigureKey) {
  const positions = game?.figurePositions?.[playerNum] || {};
  const idenPos = positions[idenFigureKey];
  if (!idenPos) return { applicable: false, reason: 'Iden has no position' };

  const dioFigureKey = Object.keys(positions).find((fk) => fk.startsWith('Dio-'));
  if (!dioFigureKey) return { applicable: false, reason: 'Dio is not in play' };

  const dioPos = positions[dioFigureKey];
  if (!dioPos) return { applicable: false, reason: 'Dio is not in play' };

  if (String(idenPos).toLowerCase() !== String(dioPos).toLowerCase()) {
    return { applicable: false, reason: 'Dio is not in the same space' };
  }
  return { applicable: true, idenPos, dioFigureKey, dioPos };
}

/** Set of valid token types this ability can grant. */
export const DROID_KIT_TOKEN_TYPES = Object.freeze(['Damage', 'Surge', 'Block', 'Evade']);
