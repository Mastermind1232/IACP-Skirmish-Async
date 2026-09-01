/**
 * Pure helpers for Yoda's **There Is No Try**.
 *
 * Card text: "Use when a friendly REBEL FORCE USER **within 4 spaces** rolls any
 * number of dice. Choose one of those dice and turn it to any other side. On
 * that die, convert each Dodge result to 2 Blocks and 1 Evade."
 *
 * Two things were missing before 2026-08-31:
 *
 *   1. It only ever offered DEFENSE dice, so playing it on an attack roll did
 *      nothing (alexanbv: "Yoda CC works for attack or defense").
 *   2. The "within 4 spaces" clause was not enforced AT ALL — any friendly
 *      REBEL FORCE USER qualified at any distance on the board
 *      (alexanbv 2026-08-31: "you must enforce ALL range limits").
 *
 * Range is measured from the Yoda figure that PLAYED the card, which the
 * resolver records at play time from `game.ccPlayedByFigureKey` (the declared
 * figure — alexanbv 2026-08-24, "for any CC that is played by a figure, the
 * first thing that must be determined is which figure is playing it").
 *
 * Distance counting itself stays with the caller, which owns the map data and
 * closed-door edges; this module owns the constant, the predicate and the
 * roller-eligibility rule.
 */

export const THERE_IS_NO_TRY_ABILITY_ID = 'setsTherIsNoTry';

/** "within 4 spaces" of the Yoda that played the card. */
export const THERE_IS_NO_TRY_MAX_DISTANCE = 4;

/** The two keywords the ROLLING figure must have for the card to apply. */
export const THERE_IS_NO_TRY_REQUIRED_KEYWORDS = ['REBEL', 'FORCE USER'];

/**
 * True iff a counted distance satisfies "within 4 spaces".
 *
 * `Infinity` (no path, or `countSpaces` refusing) is out of range, and so is a
 * non-numeric distance — an unknown distance must NOT pass, or the range clause
 * silently stops existing again.
 */
export function thereIsNoTryInRange(distance) {
  return Number.isFinite(distance) && distance <= THERE_IS_NO_TRY_MAX_DISTANCE;
}

/**
 * True iff the rolling figure's keywords make it an eligible roller: it must be
 * both REBEL and a FORCE USER.
 * @param {string[]} keywords keywords + traits of the rolling figure
 */
export function thereIsNoTryRollerEligible(keywords) {
  if (!Array.isArray(keywords)) return false;
  const up = keywords.map((k) => String(k).toUpperCase());
  return THERE_IS_NO_TRY_REQUIRED_KEYWORDS.every((k) => up.includes(k));
}

/**
 * Resolve the Yoda figure the card was played by.
 *
 * Prefers the figure key recorded at play time. Falls back to locating a figure
 * whose Deployment Card name starts with "Yoda" among that player's figures,
 * which covers a game saved before the key was recorded — without the fallback
 * those in-flight games would lose the ability entirely rather than lose the
 * range check.
 *
 * @returns {string|null} figure key, or null if Yoda is not on the board
 */
export function resolveThereIsNoTrySourceFigure(game, playerNum, dcNameFromFigureKey) {
  const recorded = game?.thereIsNoTrySourceFigureKey;
  const positions = game?.figurePositions?.[playerNum] || {};
  if (recorded && positions[recorded]) return recorded;
  for (const fk of Object.keys(positions)) {
    const dcName = dcNameFromFigureKey?.(fk) || '';
    if (/^yoda\b/i.test(String(dcName).trim())) return fk;
  }
  return null;
}
