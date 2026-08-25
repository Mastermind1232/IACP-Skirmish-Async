/**
 * A figure controlled by Lure of the Dark Side is isolated from friendliness.
 *
 * alexanbv 2026-08-24:
 *   "No other figures are considered friendly to the figure that is being
 *    controlled."
 *   "Friendly figures within 3 spaces of you would indeed find no one."
 *   "Also, abilities like purge commander reroll, luke skywalker reroll, will
 *    NOT affect the controlled figure."
 *   "for CC, an example would be Battlefield Awareness, as the controlled figure
 *    is NOT friendly."
 *
 * It cuts BOTH ways for the duration of the control:
 *
 *   FROM the controlled figure — nothing is friendly to it, so a card resolved
 *   through it that counts "friendly figures within N of you" counts nobody.
 *
 *   TOWARDS it — its OWNER's friendly-figure effects skip it. Purge Commander's
 *   and Luke's reroll auras do not reach it, and its owner cannot play
 *   Battlefield Awareness off its dice roll.
 *
 * Note which side each case lands on. The controlled figure stays in its OWNER's
 * figurePositions, so it is the owner's enumerations that must exclude it; the
 * controller never had it in their list to begin with.
 */

/** The figureKey currently controlled by a Lure, or null. */
export function lureControlledFigureKey(game) {
  const lure = game?.pendingLure;
  return lure?.controlledFigureKey || null;
}

/** Is this specific figure currently controlled by a Lure? */
export function isLureControlled(game, figureKey) {
  if (!figureKey) return false;
  return lureControlledFigureKey(game) === figureKey;
}

/**
 * Should `candidate` be treated as friendly to `subject` right now?
 *
 * False when either side is the Lure-controlled figure — that is the whole rule.
 * Both arguments are figureKeys; pass the subject as null when you only need
 * "is this candidate available to friendly effects at all".
 */
export function countsAsFriendly(game, subject, candidate) {
  const controlled = lureControlledFigureKey(game);
  if (!controlled) return true;
  if (candidate === controlled) return false;
  if (subject === controlled) return false;
  return true;
}

/**
 * Filter a list of figureKeys down to those that count as friendly to `subject`.
 * Convenience wrapper so call sites read as one line.
 */
export function friendlyFigureKeys(game, subject, figureKeys) {
  const controlled = lureControlledFigureKey(game);
  if (!controlled) return [...(figureKeys || [])];
  if (subject === controlled) return []; // nothing is friendly to it
  return (figureKeys || []).filter((fk) => fk !== controlled);
}
