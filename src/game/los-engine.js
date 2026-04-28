/**
 * IACP line-of-sight engine. Faithful port of Nick Hansen's reference
 * implementation (https://github.com/Nick-Hansen/ia-los) with adapters for
 * our coordinate convention and map data.
 *
 * Coordinate convention
 *   tile (x, y) is the cell at (col=x, row=y) — both 0-indexed
 *   tile spans (x, y) … (x+1, y+1) in continuous space
 *   tile corners: tl=(x,y), tr=(x+1,y), bl=(x,y+1), br=(x+1,y+1)
 *
 * Algorithm shape (per Nick)
 *   For each of 16 valid (attacker_corner, defender_adjacent_corner_pair):
 *     - corner1 line OK   (getLosFromCornerToCorner)
 *     - corner2 line OK   (getLosFromCornerToCorner)
 *     - edge midpoint OK  (getLosFromPointToPoint)
 *     - paths don't overlap (pathsOverlap === false)
 *   If any combination passes, LOS exists.
 *
 * Phase 1 scope (this file)
 *   Geometry only: integer corners, edge crossings, tile traversal,
 *   adjacent-tile blocking on pure horizontal/vertical lines, paths-overlap
 *   check. NO IACP-specific rules yet (Massive blocks LOS, energy shield
 *   semantics, mobile-in-blocking-terrain, spire, etc.) — those land in
 *   Phase 2 layers on top of this baseline.
 *
 * Inputs (from caller):
 *   walls            : Array of segments [{x,y},{x,y}] (vertical or horizontal,
 *                      length 1 along the integer grid).
 *   blockingTiles    : Set<"x,y"> of cells that block LOS (terrain).
 *   figureBlockers   : Set<"x,y"> of cells with a figure that blocks LOS.
 *   offMapTiles      : Set<"x,y"> of cells that are off the map.
 *
 * The wrapper in spatial.js converts game state to these primitives.
 */

// ── small helpers ──────────────────────────────────────────────────────────

const k = (x, y) => `${x},${y}`;

/** A vertical wall segment is a 1-unit edge with constant x. Both wall list
 *  formats are stored as a length-2 array of {x,y} corner points. */
function wallSetFromSegments(segments) {
  // Index walls for O(1) lookup by both endpoints.
  const set = new Set();
  for (const seg of segments) {
    const a = seg[0], b = seg[1];
    set.add(`${a.x},${a.y}|${b.x},${b.y}`);
    set.add(`${b.x},${b.y}|${a.x},${a.y}`);
  }
  return set;
}

// ── path decomposition (Nick) ──────────────────────────────────────────────

/** Vertical edges crossed by the line — i.e. segments along integer-x lines
 *  where y is non-integer (line entered a new column on a non-corner). */
function getVerticalEdges(startX, startY, endX, endY) {
  let deltaX = endX - startX;
  const deltaY = endY - startY;
  const xDir = deltaX < 0 ? -1 : 1;
  deltaX = Math.abs(deltaX);
  if (deltaX === 0) return [];
  let currentX = startX, step = 0;
  const out = [];
  do {
    currentX += xDir;
    step++;
    const y = (deltaY / deltaX) * step + startY;
    if (y % 1 !== 0) {
      const yTop = Math.floor(y), yBot = Math.ceil(y);
      out.push([{ x: currentX, y: yTop }, { x: currentX, y: yBot }]);
    }
  } while (step < Math.floor(deltaX));
  return out;
}

/** Horizontal edges crossed: segments along integer-y lines, x non-integer. */
function getHorizontalEdges(startX, startY, endX, endY) {
  const deltaX = endX - startX;
  let deltaY = endY - startY;
  const yDir = deltaY < 0 ? -1 : 1;
  deltaY = Math.abs(deltaY);
  if (deltaY === 0) return [];
  let currentY = startY, step = 0;
  const out = [];
  do {
    currentY += yDir;
    step++;
    const x = (deltaX / deltaY) * step + startX;
    if (x % 1 !== 0) {
      const xL = Math.floor(x), xR = Math.ceil(x);
      out.push([{ x: xL, y: currentY }, { x: xR, y: currentY }]);
    }
  } while (step < Math.floor(deltaY));
  return out;
}

/** Intersections — where the line crosses both an integer-x and integer-y at
 *  the same point (i.e., goes exactly through a grid corner). Includes start
 *  and end if they're at integer corners. */
function getIntersections(startX, startY, endX, endY) {
  const out = [];
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const xDir = deltaX < 0 ? -1 : 1;
  const yDir = deltaY < 0 ? -1 : 1;
  let currentX = startX, currentY = startY;
  if (deltaX === 0) {
    while (currentY !== endY) {
      out.push({ x: currentX, y: currentY });
      currentY += yDir;
    }
  } else if (deltaY === 0) {
    while (currentX !== endX) {
      out.push({ x: currentX, y: currentY });
      currentX += xDir;
    }
  } else {
    let step = 0;
    const aDx = Math.abs(deltaX);
    do {
      currentX += xDir;
      step++;
      const y = (deltaY / aDx) * step + startY;
      if (y % 1 === 0) out.push({ x: currentX, y });
    } while (step < Math.floor(aDx));
  }
  if (!out.some(i => i.x === startX && i.y === startY)) out.push({ x: startX, y: startY });
  if (!out.some(i => i.x === endX && i.y === endY)) out.push({ x: endX, y: endY });
  return out;
}

/** Tiles the line passes through, excluding attacker / target. */
function getTiles(verticalEdges, horizontalEdges, fromX, fromY, toX, toY,
                  startX, startY, endX, endY) {
  const tiles = [];
  const seen = new Set();
  const push = (x, y) => {
    if (x === fromX && y === fromY) return;
    if (x === toX && y === toY) return;
    const key = k(x, y);
    if (seen.has(key)) return;
    seen.add(key); tiles.push({ x, y });
  };
  for (const e of verticalEdges) {
    push(e[0].x - 1, e[0].y);
    push(e[0].x, e[0].y);
  }
  for (const e of horizontalEdges) {
    push(e[0].x, e[0].y - 1);
    push(e[0].x, e[0].y);
  }
  // 45-degree diagonals — line skims between tiles via integer corners; need
  // to add the tiles "to the side" of each integer-corner step.
  const dx = endX - startX, dy = endY - startY;
  const fortyFive = Math.abs(dx) > 0 && Math.abs(dx) === Math.abs(dy);
  if (fortyFive) {
    const att_tl = startX === fromX && startY === fromY;
    const att_tr = startX === fromX + 1 && startY === fromY;
    const att_br = startX === fromX + 1 && startY === fromY + 1;
    const att_bl = startX === fromX && startY === fromY + 1;
    const def_tl = endX === toX && endY === toY;
    const def_tr = endX === toX + 1 && endY === toY;
    const def_br = endX === toX + 1 && endY === toY + 1;
    const def_bl = endX === toX && endY === toY + 1;
    let cx = startX, cy = startY;
    const xDir = dx < 0 ? -1 : 1, yDir = dy < 0 ? -1 : 1;
    const len = Math.abs(dx);
    let xMod = 0, yMod = 0;
    if (dx > 0 && dy > 0) { xMod = 0; yMod = 0; }
    else if (dx < 0 && dy > 0) { xMod = 0; yMod = -1; }
    else if (dx > 0 && dy < 0) { xMod = 0; yMod = -1; }
    else if (dx < 0 && dy < 0) { xMod = 0; yMod = 0; }
    for (let s = 0; s <= len; s++) {
      let skip = false;
      if (dx > 0 && dy > 0) {
        if (s === len) skip = true;
        else if (att_tl && s === 0) skip = true;
        else if (def_br && s === len - 1) skip = true;
      } else if (dx < 0 && dy > 0) {
        if (s === 0) skip = true;
        else if (att_tr && s === 1) skip = true;
        else if (def_bl && s === len) skip = true;
      } else if (dx > 0 && dy < 0) {
        if (s === len) skip = true;
        else if (att_bl && s === 0) skip = true;
        else if (def_tr && s === len - 1) skip = true;
      } else if (dx < 0 && dy < 0) {
        if (s === 0) skip = true;
        else if (att_br && s === 1) skip = true;
        else if (def_tl && s === len) skip = true;
      }
      if (!skip) {
        const nx = cx + xMod, ny = cy + yMod;
        const key = k(nx, ny);
        if (!seen.has(key)) {
          seen.add(key);
          tiles.push({ x: nx, y: ny });
        }
      }
      cx += xDir; cy += yDir;
    }
  }
  return tiles.filter(t => !(t.x === fromX && t.y === fromY) && !(t.x === toX && t.y === toY));
}

// ── blocked checks ─────────────────────────────────────────────────────────

function edgeBlocked(pathEdges, wallSet) {
  for (const e of pathEdges) {
    const fwd = `${e[0].x},${e[0].y}|${e[1].x},${e[1].y}`;
    if (wallSet.has(fwd)) return true;
  }
  return false;
}

/**
 * Walls are 1-unit segments along integer grid lines. Nick's edgeBlocked
 * only catches walls the LOS line CROSSES at non-corner points. Walls that
 * the line is *coincident* with (line runs along the wall) or that start
 * at a line endpoint are missed by edgeBlocked alone — Nick's reference
 * uses `blockingIntersections` to resolve these. We approximate that here:
 * a wall coincident with the LOS line and overlapping its parametric range
 * blocks LOS.
 */
function coincidentWallBlocks(walls, sx, sy, ex, ey) {
  // Direction of LOS line.
  const dx = ex - sx, dy = ey - sy;
  if (dx === 0 && dy === 0) return false;
  for (const w of walls) {
    const wax = w[0].x, way = w[0].y, wbx = w[1].x, wby = w[1].y;
    const wdx = wbx - wax, wdy = wby - way;
    // Co-linear: cross product (line × wall) === 0 AND start-difference is parallel.
    const cross = dx * wdy - dy * wdx;
    if (cross !== 0) continue;
    // Both endpoints of the wall must lie on the line.
    // Use parametric form: line = (sx + t*dx, sy + t*dy).
    const onLine = (px, py) => {
      // (px - sx, py - sy) is parallel to (dx, dy) → cross product = 0
      return (px - sx) * dy - (py - sy) * dx === 0;
    };
    if (!onLine(wax, way) || !onLine(wbx, wby)) continue;
    // Project wall endpoints onto LOS parameter t.
    let ta, tb;
    if (Math.abs(dx) >= Math.abs(dy)) {
      ta = (wax - sx) / dx; tb = (wbx - sx) / dx;
    } else {
      ta = (way - sy) / dy; tb = (wby - sy) / dy;
    }
    const tMin = Math.min(ta, tb), tMax = Math.max(ta, tb);
    // Wall's parametric range on the LOS line, clamped to [0, 1].
    const overlap = Math.min(tMax, 1) - Math.max(tMin, 0);
    if (overlap > 0) return true; // proper interval overlap
    // Tangent at single point — wall touches line at one endpoint only;
    // per IACP/Nick, this alone doesn't block.
  }
  return false;
}

function tileBlocked(pathTiles, blockingTiles, figureBlockers, offMapTiles, ignoreBlockingTerrain) {
  for (const t of pathTiles) {
    const key = k(t.x, t.y);
    if (figureBlockers.has(key)) return true;
    if (!ignoreBlockingTerrain && blockingTiles.has(key)) return true;
    if (offMapTiles && offMapTiles.has(key)) return true;
  }
  return false;
}

/** For purely horizontal or vertical lines, the line travels along an edge
 *  shared by two columns of tiles. If both flanking tiles are blocked by a
 *  wall on each side or by figures/blocking-terrain on each side, LOS
 *  cannot squeeze through. Per Nick. */
function adjacentTilesBlocked(fromX, fromY, toX, toY, sx, sy, ex, ey,
                               wallSet, blockingTiles, figureBlockers, offMapTiles) {
  const dx = ex - sx, dy = ey - sy;
  if (!((dx === 0 && dy !== 0) || (dy === 0 && dx !== 0))) return false;

  const att_tl = sx === fromX     && sy === fromY;
  const att_tr = sx === fromX + 1 && sy === fromY;
  const att_br = sx === fromX + 1 && sy === fromY + 1;
  const att_bl = sx === fromX     && sy === fromY + 1;
  const def_tl = ex === toX     && ey === toY;
  const def_tr = ex === toX + 1 && ey === toY;
  const def_br = ex === toX + 1 && ey === toY + 1;
  const def_bl = ex === toX     && ey === toY + 1;

  const adjBlocked = (cx, cy) => {
    // For horizontal lines, check the two tiles vertically adjacent to the
    // edge segment; for vertical lines, the two horizontally adjacent tiles.
    if (dy === 0) {
      // segment spans (cx,cy)→(cx+1,cy); flanking tiles are (cx, cy-1) and (cx, cy)
      const top = { x: cx, y: cy - 1 }, bot = { x: cx, y: cy };
      const topB = figureBlockers.has(k(top.x, top.y)) || blockingTiles.has(k(top.x, top.y)) || (offMapTiles && offMapTiles.has(k(top.x, top.y)));
      const botB = figureBlockers.has(k(bot.x, bot.y)) || blockingTiles.has(k(bot.x, bot.y)) || (offMapTiles && offMapTiles.has(k(bot.x, bot.y)));
      return topB && botB;
    } else {
      const lf = { x: cx - 1, y: cy }, rt = { x: cx, y: cy };
      const lfB = figureBlockers.has(k(lf.x, lf.y)) || blockingTiles.has(k(lf.x, lf.y)) || (offMapTiles && offMapTiles.has(k(lf.x, lf.y)));
      const rtB = figureBlockers.has(k(rt.x, rt.y)) || blockingTiles.has(k(rt.x, rt.y)) || (offMapTiles && offMapTiles.has(k(rt.x, rt.y)));
      return lfB && rtB;
    }
  };

  const xDir = dx < 0 ? -1 : 1, yDir = dy < 0 ? -1 : 1;
  let cx = sx, cy = sy;

  if (dy === 0) {
    const len = Math.abs(dx);
    if (xDir > 0) {
      for (let s = 0; s < len; s++) {
        if (s === 0 && (att_tl || att_bl)) { cx += xDir; continue; }
        if (s === len - 1 && (def_tr || def_br)) { cx += xDir; continue; }
        if (adjBlocked(cx, cy)) return true;
        cx += xDir;
      }
    } else {
      for (let s = 0; s <= len; s++) {
        if (s === 0) { cx += xDir; continue; }
        if (s === 1 && (att_tr || att_br)) { cx += xDir; continue; }
        if (s === len && (def_tl || def_bl)) { cx += xDir; continue; }
        if (adjBlocked(cx, cy)) return true;
        cx += xDir;
      }
    }
    return false;
  }

  // dx === 0
  const len = Math.abs(dy);
  if (yDir > 0) {
    for (let s = 0; s < len; s++) {
      if (s === 0 && (att_tl || att_tr)) { cy += yDir; continue; }
      if (s === len - 1 && (def_bl || def_br)) { cy += yDir; continue; }
      if (adjBlocked(cx, cy)) return true;
      cy += yDir;
    }
  } else {
    for (let s = 0; s <= len; s++) {
      if (s === 0) { cy += yDir; continue; }
      if (s === 1 && (att_bl || att_br)) { cy += yDir; continue; }
      if (s === len && (def_tl || def_tr)) { cy += yDir; continue; }
      if (adjBlocked(cx, cy)) return true;
      cy += yDir;
    }
  }
  return false;
}

// ── corner-to-corner / point-to-point LOS ──────────────────────────────────

function getLosFromCornerToCorner(fromX, fromY, toX, toY, attCorner, defCorner, ctx) {
  const { walls, wallSet, blockingTiles, figureBlockers, offMapTiles, blockingIntersections,
          ignoreBlockingTerrain } = ctx;
  const sx = attCorner.x, sy = attCorner.y, ex = defCorner.x, ey = defCorner.y;

  const vEdges = getVerticalEdges(sx, sy, ex, ey);
  if (edgeBlocked(vEdges, wallSet)) return false;

  const hEdges = getHorizontalEdges(sx, sy, ex, ey);
  if (edgeBlocked(hEdges, wallSet)) return false;

  if (coincidentWallBlocks(walls, sx, sy, ex, ey)) return false;

  const tiles = getTiles(vEdges, hEdges, fromX, fromY, toX, toY, sx, sy, ex, ey);
  if (tileBlocked(tiles, blockingTiles, figureBlockers, offMapTiles, ignoreBlockingTerrain)) return false;

  if (adjacentTilesBlocked(fromX, fromY, toX, toY, sx, sy, ex, ey,
                            wallSet, ignoreBlockingTerrain ? new Set() : blockingTiles,
                            figureBlockers, offMapTiles)) return false;

  // Nick Hansen's intersectionBlocksPath state machine: at each integer-grid
  // intersection the line passes through (or starts/ends at), check whether
  // the wall connections at that corner block the line per CRR p.22 corner
  // rules. This catches cases pure edge-crossing checks miss — wall endpoints
  // tangent to lines, walls running through corners on a perpendicular axis
  // to the line, lines starting/ending on wall corners, etc.
  if (blockingIntersections && blockingIntersections.size > 0) {
    const intersections = getIntersections(sx, sy, ex, ey);
    for (const p of intersections) {
      const bi = blockingIntersections.get(`${p.x},${p.y}`);
      if (!bi) continue;
      if (intersectionBlocksPath(bi, fromX, fromY, toX, toY, sx, sy, ex, ey)) return false;
    }
  }

  return true;
}

/** Faithful port of Nick Hansen's intersectionBlocksPath. Determines whether
 *  the LOS line is blocked at the given wall-junction corner based on which
 *  of its 4 cardinal connections (top/right/bottom/left) have walls AND on
 *  the line's geometry (start/end/through, attacker/defender position
 *  relative to the corner, line direction). */
function intersectionBlocksPath(bi, fromTileX, fromTileY, toTileX, toTileY, startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const attL = fromTileX < bi.x;
  const attR = !attL;
  const attA = fromTileY < bi.y;
  const attB = !attA;
  const defL = toTileX < bi.x;
  const defR = !defL;
  const defA = toTileY < bi.y;
  const defB = !defA;
  const top = bi.connections.has(`${bi.x},${bi.y - 1}`);
  const right = bi.connections.has(`${bi.x + 1},${bi.y}`);
  const left = bi.connections.has(`${bi.x - 1},${bi.y}`);
  const bottom = bi.connections.has(`${bi.x},${bi.y + 1}`);
  let blocked = false;

  // Case A: line both starts AND ends at this intersection (rare zero-length).
  if (bi.x === startX && bi.y === startY && bi.x === endX && bi.y === endY) {
    if (attL && attA) {
      if (defR && defA) blocked = (top && left) || (top && right) || (top && bottom);
      else if (defR && defB) blocked = (top && left) || (top && bottom) || (bottom && right) || (left && right);
      else if (defL && defB) blocked = (top && left) || (left && bottom) || (left && right);
    } else if (attR && attA) {
      if (defL && defA) blocked = (top && left) || (top && right) || (top && bottom);
      else if (defR && defB) blocked = (top && right) || (bottom && right) || (left && right);
      else if (defL && defB) blocked = (top && right) || (left && bottom) || (top && bottom) || (left && right);
    } else if (attR && attB) {
      if (defL && defA) blocked = (left && top) || (bottom && right) || (top && bottom) || (left && right);
      else if (defR && defA) blocked = (bottom && right) || (top && right) || (left && right);
      else if (defL && defB) blocked = (left && bottom) || (top && bottom) || (bottom && right);
    } else if (attL && attB) {
      if (defL && defA) blocked = (left && top) || (left && right) || (left && bottom);
      else if (defR && defA) blocked = (left && bottom) || (top && right) || (left && right) || (top && bottom);
      else if (defR && defB) blocked = (left && bottom) || (bottom && right) || (top && bottom);
    }
    return blocked;
  }
  // Case B: line ENDS at this intersection.
  if (bi.x === endX && bi.y === endY) {
    if (defL && defA) {
      if (deltaX > 0 && deltaY > 0) return false;
      else if (deltaX < 0 && deltaY > 0) blocked = (left && top) || (top && right) || (top && bottom);
      else if (deltaX < 0 && deltaY < 0) blocked = (left && top) || (bottom && right) || (top && bottom) || (left && right);
      else if (deltaX > 0 && deltaY < 0) blocked = (left && top) || (left && bottom) || (left && right);
      else if (deltaX > 0) return false;
      else if (deltaX < 0) blocked = (left && top) || (top && bottom) || (top && right);
      else if (deltaY > 0) return false;
      else if (deltaY < 0) blocked = (left && top) || (left && right) || (left && bottom);
    } else if (defR && defA) {
      if (deltaX > 0 && deltaY > 0) blocked = (left && top) || (top && right) || (top && bottom);
      else if (deltaX < 0 && deltaY > 0) return false;
      else if (deltaX < 0 && deltaY < 0) blocked = (top && right) || (bottom && right) || (left && right);
      else if (deltaX > 0 && deltaY < 0) blocked = (top && right) || (left && bottom) || (top && bottom) || (left && right);
      else if (deltaX > 0) blocked = (top && right) || (top && left) || (top && bottom);
      else if (deltaX < 0) return false;
      else if (deltaY > 0) return false;
      else if (deltaY < 0) blocked = (top && right) || (left && right) || (right && bottom);
    } else if (defR && defB) {
      if (deltaX > 0 && deltaY > 0) blocked = (left && top) || (bottom && right) || (left && right) || (top && bottom);
      else if (deltaX < 0 && deltaY > 0) blocked = (top && right) || (bottom && right) || (left && right);
      else if (deltaX < 0 && deltaY < 0) return false;
      else if (deltaX > 0 && deltaY < 0) blocked = (left && bottom) || (bottom && right) || (top && bottom);
      else if (deltaX > 0) blocked = (bottom && right) || (top && bottom) || (left && bottom);
      else if (deltaX < 0) return false;
      else if (deltaY > 0) blocked = (bottom && right) || (left && right) || (top && right);
      else if (deltaY < 0) return false;
    } else if (defL && defB) {
      if (deltaX > 0 && deltaY > 0) blocked = (left && top) || (left && bottom) || (left && right);
      else if (deltaX < 0 && deltaY > 0) blocked = (left && bottom) || (top && right) || (left && right) || (top && bottom);
      else if (deltaX < 0 && deltaY < 0) blocked = (left && bottom) || (bottom && right) || (top && bottom);
      else if (deltaX > 0 && deltaY < 0) return false;
      else if (deltaX > 0) return false;
      else if (deltaX < 0) blocked = (left && bottom) || (top && bottom) || (bottom && right);
      else if (deltaY > 0) blocked = (left && bottom) || (left && right) || (left && top);
      else if (deltaY < 0) return false;
    }
    return blocked;
  }
  // Case C: line STARTS at this intersection.
  if (bi.x === startX && bi.y === startY) {
    if (attL && attA) {
      if (deltaX > 0 && deltaY > 0) blocked = (top && left) || (bottom && right) || (top && bottom) || (left && right);
      else if (deltaX < 0 && deltaY > 0) blocked = (left && bottom) || (left && top) || (left && right);
      else if (deltaX < 0 && deltaY < 0) return false;
      else if (deltaX > 0 && deltaY < 0) blocked = (left && top) || (top && right) || (top && bottom);
      else if (deltaX > 0) blocked = (left && top) || (top && bottom);
      else if (deltaX < 0) return false;
      else if (deltaY > 0) blocked = (left && top) || (left && right);
      else if (deltaY < 0) return false;
    } else if (attR && attA) {
      if (deltaX > 0 && deltaY > 0) blocked = (top && right) || (bottom && right) || (left && right);
      else if (deltaX < 0 && deltaY > 0) blocked = (left && bottom) || (top && right) || (top && bottom) || (left && right);
      else if (deltaX < 0 && deltaY < 0) blocked = (top && right) || (left && top) || (top && bottom);
      else if (deltaX > 0 && deltaY < 0) return false;
      else if (deltaX > 0) return false;
      else if (deltaX < 0) blocked = (top && right) || (top && bottom);
      else if (deltaY > 0) blocked = (top && right) || (left && right);
      else if (deltaY < 0) return false;
    } else if (attR && attB) {
      if (deltaX > 0 && deltaY > 0) return false;
      else if (deltaX < 0 && deltaY > 0) blocked = (left && bottom) || (bottom && right) || (top && bottom);
      else if (deltaX < 0 && deltaY < 0) blocked = (left && top) || (bottom && right) || (top && bottom) || (left && right);
      else if (deltaX > 0 && deltaY < 0) blocked = (bottom && right) || (top && right) || (left && right);
      else if (deltaX > 0) return false;
      else if (deltaX < 0) blocked = (bottom && right) || (top && bottom);
      else if (deltaY > 0) return false;
      else if (deltaY < 0) blocked = (bottom && right) || (left && right);
    } else if (attL && attB) {
      if (deltaX > 0 && deltaY > 0) blocked = (left && bottom) || (bottom && right) || (top && bottom);
      else if (deltaX < 0 && deltaY > 0) return false;
      else if (deltaX < 0 && deltaY < 0) blocked = (left && bottom) || (left && top) || (left && right);
      else if (deltaX > 0 && deltaY < 0) blocked = (left && bottom) || (top && right) || (top && bottom) || (left && right);
      else if (deltaX > 0) blocked = (left && bottom) || (top && bottom);
      else if (deltaX < 0) return false;
      else if (deltaY > 0) return false;
      else if (deltaY < 0) blocked = (left && bottom) || (left && right);
    }
    return blocked;
  }
  // Case D: line passes THROUGH this intersection (interior).
  if (deltaX > 0 && deltaY > 0) blocked = (left && top) || (bottom && right) || (top && bottom) || (left && right);
  else if (deltaX < 0 && deltaY > 0) blocked = (left && bottom) || (top && right) || (top && bottom) || (left && right);
  else if (deltaX < 0 && deltaY < 0) blocked = (left && top) || (bottom && right) || (top && bottom) || (left && right);
  else if (deltaX > 0 && deltaY < 0) blocked = (left && bottom) || (top && right) || (top && bottom) || (left && right);
  else if (deltaX > 0) blocked = (top && bottom);
  else if (deltaX < 0) blocked = (top && bottom) || (top && right) || (bottom && right);
  else if (deltaY > 0) blocked = (left && right);
  else if (deltaY < 0) blocked = (left && right);
  return blocked;
}

function getLosFromPointToPoint(fromX, fromY, toX, toY, fromPt, toPt, ctx) {
  const { walls, wallSet } = ctx;
  // Collect crossed edges. Nick's reference drops the final edge that ends
  // exactly at the target point — but that's only valid when the final edge
  // ISN'T a wall. If the wall coincides with the target's own edge (a wall
  // sits on the target's left/right/top/bottom), the wall *is* what blocks
  // LOS through that edge to the target — we must keep it in the check.
  const isWall = (e) => wallSet.has(`${e[0].x},${e[0].y}|${e[1].x},${e[1].y}`);
  let vEdges = getVerticalEdges(fromPt.x, fromPt.y, toPt.x, toPt.y);
  vEdges = vEdges.filter(e => isWall(e) || !(
    e[0].x === toPt.x && e[0].y === Math.floor(toPt.y) &&
    e[1].x === toPt.x && e[1].y === Math.ceil(toPt.y)
  ));
  if (edgeBlocked(vEdges, wallSet)) return false;

  let hEdges = getHorizontalEdges(fromPt.x, fromPt.y, toPt.x, toPt.y);
  hEdges = hEdges.filter(e => isWall(e) || !(
    e[0].y === toPt.y && e[0].x === Math.floor(toPt.x) &&
    e[1].y === toPt.y && e[1].x === Math.ceil(toPt.x)
  ));
  if (edgeBlocked(hEdges, wallSet)) return false;

  if (coincidentWallBlocks(walls, fromPt.x, fromPt.y, toPt.x, toPt.y)) return false;

  return true;
}

// ── paths-overlap (degenerate co-linear lines reject) ──────────────────────

/** For two orthogonally adjacent tiles, return the wallSet key for the
 *  segment along their shared edge — or null if not orthogonally adjacent. */
function sharedAdjacencyEdge(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  if (dx === 1 && dy === 0) {
    // target is east — shared edge is vertical at x = toX, y in [fromY, fromY+1]
    return `${toX},${fromY}|${toX},${fromY + 1}`;
  }
  if (dx === -1 && dy === 0) {
    return `${fromX},${fromY}|${fromX},${fromY + 1}`;
  }
  if (dy === 1 && dx === 0) {
    return `${fromX},${toY}|${fromX + 1},${toY}`;
  }
  if (dy === -1 && dx === 0) {
    return `${fromX},${fromY}|${fromX + 1},${fromY}`;
  }
  return null;
}

function pathsOverlap(att, d1, d2) {
  const p1dx = d1.x - att.x, p1dy = d1.y - att.y;
  const p2dx = d2.x - att.x, p2dy = d2.y - att.y;
  if (p1dy === 0 && p2dy === 0) return Math.sign(p1dx) === Math.sign(p2dx);
  if (p1dx === 0 && p2dx === 0) return Math.sign(p1dy) === Math.sign(p2dy);
  return false;
}

// ── top-level: tile-to-tile LOS via 16-combo enumeration ───────────────────

/**
 * @param {number} fromX attacker tile col (0-indexed)
 * @param {number} fromY attacker tile row (0-indexed)
 * @param {number} toX defender tile col
 * @param {number} toY defender tile row
 * @param {object} ctx { wallSet, blockingTiles, figureBlockers, offMapTiles }
 * @returns {boolean}
 */
/** True if the LOS line passes through any cell-corner that is a blocking
 *  intersection — i.e., a corner of an energy-shield cell where the shield
 *  isn't the attacker or target. Per CRR p.28, shields block LOS through
 *  their corners as well as through their interior. */
function passesThroughBlockingCorner(sx, sy, ex, ey, blockingCorners) {
  if (blockingCorners.size === 0) return false;
  const dx = ex - sx, dy = ey - sy;
  if (dx === 0 && dy === 0) return false;
  // Sample integer-coord points the line passes through.
  for (const cornerKey of blockingCorners) {
    const [cx, cy] = cornerKey.split(',').map(Number);
    // Skip line endpoints — those are att/def corners, not "through" points.
    if ((cx === sx && cy === sy) || (cx === ex && cy === ey)) continue;
    // Is (cx, cy) on the segment? Parametric check.
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx === 0) continue;
      const t = (cx - sx) / dx;
      if (t <= 0 || t >= 1) continue;
      const expectedY = sy + t * dy;
      if (Math.abs(expectedY - cy) < 1e-9) return true;
    } else {
      const t = (cy - sy) / dy;
      if (t <= 0 || t >= 1) continue;
      const expectedX = sx + t * dx;
      if (Math.abs(expectedX - cx) < 1e-9) return true;
    }
  }
  return false;
}

export function tileToTileLos(fromX, fromY, toX, toY, ctx) {
  if (fromX === toX && fromY === toY) return true;
  const blockingCorners = ctx.blockingCorners ?? new Set();

  const att = {
    tl: { x: fromX,     y: fromY     },
    tr: { x: fromX + 1, y: fromY     },
    bl: { x: fromX,     y: fromY + 1 },
    br: { x: fromX + 1, y: fromY + 1 },
  };
  const def = {
    tl:    { x: toX,     y: toY     },
    tr:    { x: toX + 1, y: toY     },
    bl:    { x: toX,     y: toY + 1 },
    br:    { x: toX + 1, y: toY + 1 },
    top:   { x: toX + 0.5, y: toY     },
    right: { x: toX + 1,   y: toY + 0.5 },
    bot:   { x: toX + 0.5, y: toY + 1 },
    left:  { x: toX,       y: toY + 0.5 },
  };

  // 16 valid (attacker_corner, adjacent_defender_pair) combinations.
  // pair: defender corner1, defender corner2, edge midpoint.
  const pairs = [
    [def.tl, def.tr, def.top  ],
    [def.tr, def.br, def.right],
    [def.bl, def.br, def.bot  ],
    [def.tl, def.bl, def.left ],
  ];
  for (const aCorner of [att.tl, att.tr, att.bl, att.br]) {
    for (const [d1, d2, mid] of pairs) {
      if (aCorner.x === d1.x && aCorner.y === d1.y) continue;
      if (aCorner.x === d2.x && aCorner.y === d2.y) continue;
      if (pathsOverlap(aCorner, d1, d2)) continue;
      if (!getLosFromCornerToCorner(fromX, fromY, toX, toY, aCorner, d1, ctx)) continue;
      if (!getLosFromCornerToCorner(fromX, fromY, toX, toY, aCorner, d2, ctx)) continue;
      if (!getLosFromPointToPoint  (fromX, fromY, toX, toY, aCorner, mid, ctx)) continue;
      return true;
    }
  }
  return false;
}

// ── adapter: build the engine ctx from our existing map data shape ─────────

/**
 * Convert our impassableEdges (array of [coordA, coordB] cell pairs) into
 * Nick-style wall segments at integer corners.
 */
export function impassableEdgesToWalls(edges, parseCoord) {
  const walls = [];
  for (const edge of (edges || [])) {
    if (!edge || edge.length < 2) continue;
    const a = parseCoord(edge[0]);
    const b = parseCoord(edge[1]);
    if (a.col < 0 || b.col < 0) continue;
    if (a.col === b.col && Math.abs(a.row - b.row) === 1) {
      // vertically adjacent — horizontal wall at y = max(a.row, b.row)
      const y = Math.max(a.row, b.row);
      walls.push([{ x: a.col, y }, { x: a.col + 1, y }]);
    } else if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
      // horizontally adjacent — vertical wall at x = max(a.col, b.col)
      const x = Math.max(a.col, b.col);
      walls.push([{ x, y: a.row }, { x, y: a.row + 1 }]);
    }
    // else: diagonal "edge" — not a single wall segment, skip.
  }
  return walls;
}

export const _internals = {
  getVerticalEdges, getHorizontalEdges, getIntersections, getTiles,
  edgeBlocked, tileBlocked, adjacentTilesBlocked,
  getLosFromCornerToCorner, getLosFromPointToPoint,
  pathsOverlap, wallSetFromSegments,
};

export { wallSetFromSegments };
