/**
 * Nested attack frames — slice 7.1 scaffold.
 *
 * Per destruct's 2026-05-05 audit: when an interrupt triggers a nested attack
 * (Hired Gun Parting Shot, Final Stand, Extra Protection, Counterattack,
 * Electrobatons Flurry of Blows), the outer attack pauses and a new attack
 * begins. State must be preserved — pools, modifiers, ccPlayStack — and
 * restored when the nested attack resolves.
 *
 * `game.combatStack` is an additive list of paused outer-attack frames. The
 * top of the stack is the most-recently-paused frame; popping restores it
 * onto `game.pendingCombat` and the outer attack resumes from where it
 * paused.
 *
 * Per-frame `perFrameLimits` (e.g. Tools-for-the-Job once-per-attack) reset
 * on each push so nested attacks don't share consumption with their outer
 * frame.
 *
 * Wiring sites are landed in slices 7.2–7.7.
 */

/**
 * Save the current `game.pendingCombat` onto `game.combatStack` and clear
 * `pendingCombat` so the caller can initialize a new nested attack.
 *
 * No-op when there is no current `pendingCombat` (e.g. interrupt fired
 * outside an active attack — defensive guard, shouldn't happen in
 * production but cheap to handle).
 *
 * @param {object} game
 * @returns {boolean} true if a frame was pushed
 */
export function pushNestedCombat(game) {
  if (!game) return false;
  const current = game.pendingCombat;
  if (!current) return false;
  game.combatStack = game.combatStack || [];
  // Reset per-frame limits on the current frame before stashing — when this
  // frame later resumes, its perFrameLimits should reflect the consumption
  // state at pause time, not be re-zeroed. So we DON'T reset here.
  // (perFrameLimits reset happens on the new nested frame at init time.)
  game.combatStack.push(current);
  delete game.pendingCombat;
  return true;
}

/**
 * Pop the top of `game.combatStack` and restore it onto `game.pendingCombat`.
 *
 * No-op when stack is empty.
 *
 * @param {object} game
 * @returns {boolean} true if a frame was restored
 */
export function popNestedCombat(game) {
  if (!game) return false;
  const stack = game.combatStack;
  if (!Array.isArray(stack) || stack.length === 0) return false;
  game.pendingCombat = stack.pop();
  if (stack.length === 0) delete game.combatStack;
  return true;
}

/**
 * Peek at the top of the combat stack without mutating. Useful for callers
 * that want to know whether they're inside a nested attack without popping.
 *
 * @param {object} game
 * @returns {object|null}
 */
export function peekNestedCombat(game) {
  const stack = game?.combatStack;
  if (!Array.isArray(stack) || stack.length === 0) return null;
  return stack[stack.length - 1];
}

/** Current nesting depth (0 = outer, 1+ = nested under at least one frame). */
export function nestedCombatDepth(game) {
  return Array.isArray(game?.combatStack) ? game.combatStack.length : 0;
}
