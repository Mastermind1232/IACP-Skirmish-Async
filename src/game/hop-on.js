/**
 * Kuiil "Hop On!" on-enter push helper (alexanbv 2026-06-21, CORRECTED model).
 *
 * Hop On is a DESIGNATION-ONLY special action (see abilities.js hopOnPush): it
 * costs an action to PICK a SMALL friendly figure, then for the REST OF THE
 * ACTIVATION, whenever Kuiil ENTERS that figure's space during movement, the
 * figure is pushed 1 space in Kuiil's direction of travel (the space beyond it
 * along the move) so the space is vacated and Kuiil occupies it.
 *
 * This module is a PURE geometry/board helper — no Discord, no game mutation.
 * The Discord move handler (src/handlers/movement.js) and headless tests call
 * computeHopOnPush() after committing each Kuiil move step and, if it returns a
 * push, apply it via pushFigure(). Because Kuiil is forced step-by-step while a
 * designation is active (forced-step-movement.js), each entry is a discrete,
 * detectable single-space step.
 */

import { parseCoord, colRowToCoord, normalizeCoord, getFootprintCells } from './coords.js';
import { pushFigure } from './player-helpers.js';

/**
 * Unit (single-space) direction vector of Kuiil's step, derived from the
 * top-left coords. Normalizes each axis to -1 / 0 / +1 so a multi-space jump
 * still yields a single-space push direction (defensive — Kuiil is forced
 * step-by-step so the step is normally exactly 1 space).
 *
 * @returns {{dx:number, dy:number}|null} null if there is no movement.
 */
export function stepDirection(fromCoord, toCoord) {
  const a = parseCoord(fromCoord);
  const b = parseCoord(toCoord);
  if (a.col < 0 || a.row < 0 || b.col < 0 || b.row < 0) return null;
  const dx = Math.sign(b.col - a.col);
  const dy = Math.sign(b.row - a.row);
  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

/**
 * Compute the Hop On push for a single committed Kuiil move step.
 *
 * @param {object} args
 * @param {string} args.kuiilStartCoord   Kuiil's top-left BEFORE this step.
 * @param {string} args.kuiilNewCoord     Kuiil's top-left AFTER this step.
 * @param {string} args.kuiilSize         Kuiil's footprint size (e.g. "2x1").
 * @param {string} args.designatedPos     Designated figure's current top-left.
 * @param {string} args.designatedSize    Designated figure's size (e.g. "1x1").
 * @param {Set<string>} args.spacesSet    Lower-cased set of valid board spaces.
 * @param {Set<string>} args.occupiedSet  Lower-cased set of occupied spaces
 *                                         (EXCLUDING the designated figure and
 *                                         Kuiil — the caller passes a set built
 *                                         with both excluded so the push
 *                                         destination check is correct).
 * @param {Set<string>} [args.blockingSet] Lower-cased blocking spaces.
 * @returns {{ entered:boolean, pushed:boolean, fromPos?:string, toPos?:string,
 *             reason?:string }}
 *   - entered: did Kuiil's new footprint overlap the designated figure's space?
 *   - pushed: was a legal 1-space push found in the travel direction?
 *   - fromPos/toPos: the push (lower-cased) when pushed.
 *   - reason: when entered but not pushed, why (e.g. 'blocked').
 */
export function computeHopOnPush(args) {
  const {
    kuiilStartCoord, kuiilNewCoord, kuiilSize,
    designatedPos, designatedSize,
    spacesSet, occupiedSet, blockingSet,
  } = args;
  const figPos = normalizeCoord(designatedPos);
  if (!figPos) return { entered: false, pushed: false };

  // Did Kuiil ENTER the designated figure's space this step? Overlap = any cell
  // of Kuiil's NEW footprint coincides with any cell of the figure's footprint.
  const kuiilCells = getFootprintCells(normalizeCoord(kuiilNewCoord), kuiilSize || '1x1').map(normalizeCoord);
  const figCells = getFootprintCells(figPos, designatedSize || '1x1').map(normalizeCoord);
  const figCellSet = new Set(figCells);
  const entered = kuiilCells.some((c) => figCellSet.has(c));
  if (!entered) return { entered: false, pushed: false };

  // Direction of travel (Kuiil's per-step movement vector). The figure is
  // pushed 1 space along this vector — the space beyond it, away from Kuiil.
  const dir = stepDirection(kuiilStartCoord, kuiilNewCoord);
  if (!dir) return { entered: true, pushed: false, reason: 'no-direction' };

  // Candidate push destinations, in preference order:
  //   1. straight ahead along the travel direction (designer's example), then
  //   2. the two diagonal neighbours flanking that direction (graceful
  //      fallback when straight-ahead is blocked / off-board / occupied).
  const { col, row } = parseCoord(figPos);
  const occ = occupiedSet instanceof Set ? occupiedSet : new Set(occupiedSet || []);
  const blocked = blockingSet instanceof Set ? blockingSet : new Set(blockingSet || []);
  const candidates = [];
  candidates.push({ dx: dir.dx, dy: dir.dy });
  // Flanking diagonals: keep the dominant axis, vary the other by ±1.
  if (dir.dx !== 0 && dir.dy === 0) {
    candidates.push({ dx: dir.dx, dy: 1 }, { dx: dir.dx, dy: -1 });
  } else if (dir.dy !== 0 && dir.dx === 0) {
    candidates.push({ dx: 1, dy: dir.dy }, { dx: -1, dy: dir.dy });
  } else {
    // Diagonal travel: try the two orthogonal components as fallbacks.
    candidates.push({ dx: dir.dx, dy: 0 }, { dx: 0, dy: dir.dy });
  }

  for (const c of candidates) {
    const dest = normalizeCoord(colRowToCoord(col + c.dx, row + c.dy));
    if (!dest) continue;
    if (!spacesSet || !spacesSet.has(dest)) continue;   // off-board / not a space
    if (occ.has(dest)) continue;                        // occupied by another figure
    if (blocked.has(dest)) continue;                    // blocking terrain
    return { entered: true, pushed: true, fromPos: figPos, toPos: dest };
  }
  // Entered but no legal push destination — the push cannot happen this step.
  return { entered: true, pushed: false, reason: 'blocked' };
}

/**
 * Resolve a Hop On! on-enter push for a single committed Kuiil move step, and
 * APPLY the push via the game-layer pushFigure primitive when one is found.
 *
 * Kept in the game layer (not the Discord handler) so the push position write
 * goes through pushFigure() here — the voluntary-exit handler gates in
 * src/handlers/movement.js must never call pushFigure directly (CRR-PSH-003).
 *
 * @param {object} game
 * @param {number} playerNum  Kuiil's player number (the figure is friendly).
 * @param {string} designatedFigureKey  The designated figure being pushed.
 * @param {object} pushArgs  Args forwarded to computeHopOnPush (minus the
 *   designatedPos which is read from game state here).
 * @returns {{ entered:boolean, pushed:boolean, fromPos?:string, toPos?:string,
 *             reason?:string }} the computeHopOnPush result (push already
 *   applied to game.figurePositions when pushed === true).
 */
export function applyHopOnPush(game, playerNum, designatedFigureKey, pushArgs) {
  const designatedPos = game?.figurePositions?.[playerNum]?.[designatedFigureKey];
  if (!designatedPos) return { entered: false, pushed: false };
  const res = computeHopOnPush({ ...pushArgs, designatedPos });
  if (res.entered && res.pushed) {
    pushFigure(game, playerNum, designatedFigureKey, res.toPos);
  }
  return res;
}
