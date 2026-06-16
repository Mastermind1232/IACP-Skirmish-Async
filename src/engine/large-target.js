// Large-target square declaration (alexanbv 2026-06-16): "every time a figure
// targets a large figure it must declare which square it is targeting. This
// affects LOS, but NOT range (range is the shortest spaces to the target FIGURE
// regardless of which square is targeted)." It also feeds blast and other
// abilities that act on the target square.
//
// This module is the data model: is the target large (needs a declaration), and
// which squares can be chosen. The picker UI (at attack declaration) + the
// LOS-to-the-declared-square check + using the declared square as the blast origin
// are wired on top of this.

import { getFootprintCells } from '../game/coords.js';
import { getEffectiveFigureSize } from '../game/board-helpers.js';
import { getFigureSize, getFigureSizes, getMapData } from '../data-loader.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { hasLineOfSightByCoord } from '../game/spatial.js';

/** Parse a "WxH" size (or [w,h]) into [w,h]. */
function _wh(size) {
  if (Array.isArray(size)) return [Number(size[0]) || 1, Number(size[1]) || 1];
  const m = String(size || '1x1').match(/(\d+)\s*x\s*(\d+)/i);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1, 1];
}

/** Effective footprint size [w,h] of a figure on the board (orientation-aware). */
export function targetFootprintSize(game, figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  const size = getEffectiveFigureSize(game, figureKey, dcName) || getFigureSize(dcName) || getFigureSizes()?.[dcName];
  return _wh(size);
}

/** A target is LARGE (occupies more than one square) → the attacker must declare a square. */
export function isLargeTarget(game, figureKey) {
  const [w, h] = targetFootprintSize(game, figureKey);
  return w > 1 || h > 1;
}

/**
 * The board squares a target occupies — the candidate squares the attacker may
 * declare. For a 1x1 figure this is its single square; for a large figure, all
 * footprint cells (lowercased). Returns [] if the figure isn't placed.
 */
export function getTargetSquares(game, playerNum, figureKey) {
  const pos = game?.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) return [];
  const size = targetFootprintSize(game, figureKey);
  return getFootprintCells(pos, `${size[0]}x${size[1]}`).map((c) => String(c).toLowerCase());
}

/**
 * The squares of a large target the attacker may DECLARE — its footprint cells
 * filtered to those the attacker has line of sight to (alexanbv 2026-06-16: the
 * declaration "affects LOS"; you can't declare a square you can't see). Falls back
 * to the full footprint if LOS can't be resolved (or none are visible) so the
 * attacker is never left without a square. Used by BOTH the declaration picker and
 * the re-invoke handler so the button index maps to the same square.
 */
export function getDeclarableSquares(game, attackerPlayerNum, attackerFigureKey, defPlayerNum, targetFigureKey) {
  const squares = getTargetSquares(game, defPlayerNum, targetFigureKey);
  const atkCoord = game?.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
  const mapSp = getMapData(game?.selectedMap?.id);
  if (!atkCoord || !mapSp || squares.length <= 1) return squares;
  const visible = squares.filter((sq) => hasLineOfSightByCoord(game, String(atkCoord).toLowerCase(), sq, mapSp, getFigureSize));
  return visible.length ? visible : squares;
}
