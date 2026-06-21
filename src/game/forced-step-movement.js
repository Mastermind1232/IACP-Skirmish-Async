/**
 * Forced step-by-step movement (alexanbv 2026-06-21).
 *
 * Some figures must move ONE space at a time so a per-step interrupt /
 * follow trigger can fire after EACH step. The canonical case is
 * **Iden Versio + Dio (Attached)**: "Iden moves 1 space, Dio then moves 1
 * space; if Dio moves to Iden's space, then when Iden moves again Dio can
 * move 1 more space, etc." The designer ruling is that "Iden movement will
 * have to be ALWAYS STEP BY STEP to take care of this" — otherwise a
 * multi-space auto A→B move would fire the Dio-follow trigger only once at
 * the end of the whole move, denying Dio the chance to chain-follow after
 * each individual step.
 *
 * When a DC is forced step-by-step:
 *   - the move session starts in step-by-step mode (immediate neighbours
 *     only), and
 *   - the "Auto (A→B)" toggle and the "Pick Path Manually" distance picker
 *     are suppressed, so the player cannot bypass the per-step model.
 *
 * Keep this a tiny, data-driven allowlist so the shared movement path stays
 * conservative — only the named DCs are affected.
 */
const FORCED_STEP_BY_STEP_DCS = new Set([
  'Iden Versio',
]);

/**
 * @param {string} dcName - the moving figure's DC name (meta.dcName)
 * @returns {boolean} true if this DC must move one space at a time
 */
export function isForcedStepByStep(dcName) {
  return FORCED_STEP_BY_STEP_DCS.has(dcName);
}

/**
 * Figure-aware variant. Returns true when this specific figure must move one
 * space at a time, accounting for DYNAMIC per-figure step-by-step conditions in
 * addition to the static DC allowlist.
 *
 * Dynamic case — Kuiil "Hop On!" (alexanbv 2026-06-21): while a Hop On
 * designation is active for this figure (game.hopOnDesignated[figureKey]),
 * Kuiil must move step-by-step so the move handler can detect each discrete
 * ENTRY into the designated figure's space and fire the 1-space push there.
 *
 * @param {string} dcName - the moving figure's DC name (meta.dcName)
 * @param {object} [game] - game state (for dynamic conditions)
 * @param {string} [figureKey] - the moving figure's key (e.g. "Kuiil-1-0")
 * @returns {boolean} true if this figure must move one space at a time
 */
export function isForcedStepByStepForFigure(dcName, game, figureKey) {
  if (FORCED_STEP_BY_STEP_DCS.has(dcName)) return true;
  if (game && figureKey && game.hopOnDesignated && game.hopOnDesignated[figureKey]) return true;
  return false;
}
