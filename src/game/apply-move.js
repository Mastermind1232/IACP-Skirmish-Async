import { handleMovePick } from '../handlers/movement.js';

/**
 * MCTS fast-path entrypoint for a move_pick_ action.
 *
 * Calls the shared move-resolution code in `handleMovePick` with a
 * `fastPath` flag set, which skips the two expensive Discord-UI blocks
 * (`_renderNextMoveGrid` + `_renderPostMoveBoardUpdate`). Every state
 * mutation — figurePositions, Overrun, Cut and Run, massive displacement,
 * moveState bookkeeping, pushUndo, Deference/Cassian/Swipe/Attached —
 * runs identically to the Discord path, so the two paths stay in lock-step.
 *
 * Used by the headless game harness's `move_pick_` intercept. Discord
 * callers should continue to use `handleMovePick` directly.
 */
export async function applyMoveTransition(interaction, ctx) {
  return handleMovePick(interaction, ctx, { fastPath: true });
}
