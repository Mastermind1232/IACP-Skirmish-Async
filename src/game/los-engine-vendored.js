/**
 * Vendored LOS engine — verbatim port of the LOS algorithm from
 * https://github.com/Nick-Hansen/ia-los (grid.js, lines 979–2215).
 *
 * Used with permission. Same control flow, same conditions, same data
 * shapes as Nick's reference. The only changes from his source:
 *   - Wrapped in an ES module instead of relying on top-level globals.
 *   - All state (walls, blockingTiles, blockingEdges, blockingIntersections,
 *     blockers, offMapTiles, spireTiles) is passed in as a single `state`
 *     object instead of read from globals.
 *   - The DOM/canvas update path (`updateLinesOfSight`,
 *     `updateLinesOfSightDropdown`) is removed; the single boolean output
 *     "any pair enabled" is what we need.
 *
 * Coord system: Nick's (x, y) — 0-indexed, origin top-left, integer corner
 * points span [0, width] × [0, height]. Tile (x, y) covers (x, y) →
 * (x+1, y+1). The caller is responsible for translating our (col, row) into
 * Nick's (x, y) before calling — see los-coord-adapter.js (lothal-wastes
 * uses `our_col = 23 - nick.y`, `our_row = nick.x + 3`).
 */

/**
 * Run Nick's algorithm and return whether the attacker tile (fromTileX,
 * fromTileY) has LOS to the defender tile (toTileX, toTileY) given the
 * provided per-map state.
 *
 * @param {number} fromTileX
 * @param {number} fromTileY
 * @param {number} toTileX
 * @param {number} toTileY
 * @param {object} state {
 *   walls, blockingTiles, blockingEdges, blockingIntersections,
 *   blockers, offMapTiles, spireTiles
 * }
 * @returns {boolean}
 */
export function nickLineOfSight(fromTileX, fromTileY, toTileX, toTileY, state) {
  const walls                  = state.walls                  || [];
  const blockingTiles          = state.blockingTiles          || [];
  const blockingEdges          = state.blockingEdges          || [];
  const blockingIntersections  = state.blockingIntersections  || [];
  const blockers               = state.blockers               || [];
  const offMapTiles            = state.offMapTiles            || [];
  const spireTiles             = state.spireTiles             || [];
  // Extension: a Set of "x,y" corner strings. Any line passing strictly
  // through a corner in this set (interior intersection — not the line's
  // own start/end) is blocked. Used for energy shields, which block LOS
  // through every one of their cell corners per CRR p.28.
  const blockingCornerSet      = state.blockingCornerSet      || null;

  // ── pathsOverlap (verbatim from Nick's grid.js:1105) ─────────────────────
  function pathsOverlap(attackingCorner, defendingCorner1, defendingCorner2) {
    var path1_deltaX = defendingCorner1.x - attackingCorner.x;
    var path1_deltaY = defendingCorner1.y - attackingCorner.y;

    var path2_deltaX = defendingCorner2.x - attackingCorner.x;
    var path2_deltaY = defendingCorner2.y - attackingCorner.y;

    if (path1_deltaY == 0 && path2_deltaY == 0) {
      var path1_xDirection = path1_deltaX < 0 ? -1 : 1;
      var path2_xDirection = path2_deltaX < 0 ? -1 : 1;

      return (path1_xDirection == path2_xDirection);
    }
    else if (path1_deltaX == 0 && path2_deltaX == 0) {
      var path1_yDirection = path1_deltaY < 0 ? -1 : 1;
      var path2_yDirection = path2_deltaY < 0 ? -1 : 1;

      return (path1_yDirection == path2_yDirection);
    }

    return false;
  }

  // ── getVerticalEdges (verbatim from Nick's grid.js:1193) ─────────────────
  function getVerticalEdges(startX, startY, endX, endY) {
    var deltaX = endX - startX;
    var deltaY = endY - startY;
    var xDirection = deltaX < 0 ? -1 : 1;
    deltaX = Math.abs(deltaX);
    var currentX = startX;
    var step = 0;
    var verticalEdges = [];
    if (deltaX == 0) {
      return verticalEdges;
    }
    do {
      currentX += xDirection;
      step++;
      var y = deltaY / deltaX * step + startY;
      if (y % 1 != 0) {
        var yTop = Math.floor(y);
        var yBottom = Math.ceil(y);
        verticalEdges.push([
          { x: currentX, y: yTop },
          { x: currentX, y: yBottom }
        ]);
      }
    }
    while (step < Math.floor(deltaX));
    return verticalEdges;
  }

  // ── getHorizontalEdges (verbatim from Nick's grid.js:1221) ───────────────
  function getHorizontalEdges(startX, startY, endX, endY) {
    var deltaX = endX - startX;
    var deltaY = endY - startY;
    var yDirection = deltaY < 0 ? -1 : 1;
    deltaY = Math.abs(deltaY);
    var currentY = startY;
    var step = 0;
    var horizontalEdges = [];
    if (deltaY == 0) {
      return horizontalEdges;
    }
    do {
      currentY += yDirection;
      step++;
      var x = deltaX / deltaY * step + startX;
      if (x % 1 != 0) {
        var xStart = Math.floor(x);
        var xEnd = Math.ceil(x);
        horizontalEdges.push([
          { x: xStart, y: currentY },
          { x: xEnd, y: currentY }
        ]);
      }
    }
    while (step < Math.floor(deltaY));
    return horizontalEdges;
  }

  // ── getIntersections (verbatim from Nick's grid.js:1249) ─────────────────
  function getIntersections(startX, startY, endX, endY) {
    var deltaX = endX - startX;
    var deltaY = endY - startY;
    var intersections = [];
    var step = 0;
    var xDirection = deltaX < 0 ? -1 : 1;
    var yDirection = deltaY < 0 ? -1 : 1;
    var currentX = startX;
    var currentY = startY;
    if (deltaX == 0) {
      while (currentY != endY) {
        intersections.push({ x: currentX, y: currentY });
        currentY += yDirection;
      }
      var intersectionIndex = intersections.findIndex(function(intersection) {
        return intersection.x == startX && intersection.y == startY;
      });
      if (intersectionIndex < 0) { intersections.push({ x: startX, y: startY }); }
      intersectionIndex = intersections.findIndex(function(intersection) {
        return intersection.x == endX && intersection.y == endY;
      });
      if (intersectionIndex < 0) { intersections.push({ x: endX, y: endY }); }
      return intersections;
    }
    if (deltaY == 0) {
      while (currentX != endX) {
        intersections.push({ x: currentX, y: currentY });
        currentX += xDirection;
      }
      var intersectionIndex = intersections.findIndex(function(intersection) {
        return intersection.x == startX && intersection.y == startY;
      });
      if (intersectionIndex < 0) { intersections.push({ x: startX, y: startY }); }
      intersectionIndex = intersections.findIndex(function(intersection) {
        return intersection.x == endX && intersection.y == endY;
      });
      if (intersectionIndex < 0) { intersections.push({ x: endX, y: endY }); }
      return intersections;
    }
    deltaX = Math.abs(deltaX);
    do {
      currentX += xDirection;
      step++;
      var y = deltaY / deltaX * step + startY;
      if (y % 1 == 0) {
        intersections.push({ x: currentX, y: y });
      }
    }
    while (step < Math.floor(deltaX));
    var intersectionIndex = intersections.findIndex(function(intersection) {
      return intersection.x == startX && intersection.y == startY;
    });
    if (intersectionIndex < 0) { intersections.push({ x: startX, y: startY }); }
    intersectionIndex = intersections.findIndex(function(intersection) {
      return intersection.x == endX && intersection.y == endY;
    });
    if (intersectionIndex < 0) { intersections.push({ x: endX, y: endY }); }
    return intersections;
  }

  // ── getTiles (verbatim from Nick's grid.js:1309) ─────────────────────────
  function getTiles(verticalEdges, horizontalEdges, intersections,
    fromTileX, fromTileY, toTileX, toTileY,
    startX, startY, endX, endY) {
    var tiles = [];
    var newTile = {};
    var tileIndex = -1;
    var isAttacker = false;
    var isDefender = false;
    verticalEdges.forEach(function (edge) {
      newTile = { x: edge[0].x - 1, y: edge[0].y };
      isAttacker = newTile.x == fromTileX && newTile.y == fromTileY;
      isDefender = newTile.x == toTileX && newTile.y == toTileY;
      tileIndex = tiles.findIndex(function(tile) {
        return tile.x == newTile.x && tile.y == newTile.y;
      });
      if (tileIndex < 0 && !isAttacker && !isDefender) { tiles.push(newTile); }
      newTile = { x: edge[0].x, y: edge[0].y };
      isAttacker = newTile.x == fromTileX && newTile.y == fromTileY;
      isDefender = newTile.x == toTileX && newTile.y == toTileY;
      tileIndex = tiles.findIndex(function(tile) {
        return tile.x == newTile.x && tile.y == newTile.y;
      });
      if (tileIndex < 0 && !isAttacker && !isDefender) { tiles.push(newTile); }
    });
    horizontalEdges.forEach(function(edge) {
      newTile = { x: edge[0].x, y: edge[0].y - 1 };
      isAttacker = newTile.x == fromTileX && newTile.y == fromTileY;
      isDefender = newTile.x == toTileX && newTile.y == toTileY;
      tileIndex = tiles.findIndex(function(tile) {
        return tile.x == newTile.x && tile.y == newTile.y;
      });
      if (tileIndex < 0 && !isAttacker && !isDefender) { tiles.push(newTile); }
      newTile = { x: edge[0].x, y: edge[0].y };
      isAttacker = newTile.x == fromTileX && newTile.y == fromTileY;
      isDefender = newTile.x == toTileX && newTile.y == toTileY;
      tileIndex = tiles.findIndex(function(tile) {
        return tile.x == newTile.x && tile.y == newTile.y;
      });
      if (tileIndex < 0 && !isAttacker && !isDefender) { tiles.push(newTile); }
    });
    var deltaX = endX - startX;
    var deltaY = endY - startY;
    var fortyFiveDegreeAngle = Math.abs(deltaX) > 0 && Math.abs(deltaX) == Math.abs(deltaY);
    if (fortyFiveDegreeAngle) {
      var attacker_tl = startX == fromTileX && startY == fromTileY;
      var attacker_tr = startX == fromTileX + 1 && startY == fromTileY;
      var attacker_br = startX == fromTileX + 1 && startY == fromTileY + 1;
      var attacker_bl = startX == fromTileX && startY == fromTileY + 1;
      var defender_tl = endX == toTileX && endY == toTileY;
      var defender_tr = endX == toTileX + 1 && endY == toTileY;
      var defender_br = endX == toTileX + 1 && endY == toTileY + 1;
      var defender_bl = endX == toTileX && endY == toTileY + 1;

      var currentX = startX;
      var currentY = startY;
      var pathLength = Math.abs(deltaX);
      var xDirection = deltaX < 0 ? -1 : 1;
      var yDirection = deltaY < 0 ? -1 : 1;
      var xModifer = 0, yModifer = 0;

      if (deltaX > 0 && deltaY > 0) {
        xModifer = 0; yModifer = 0;
        for (var step = 0; step <= pathLength; step++) {
          if (step == pathLength) { currentX += xDirection; currentY += yDirection; continue; }
          else if (attacker_tl && step == 0) { currentX += xDirection; currentY += yDirection; continue; }
          else if (defender_br && step == pathLength - 1) { currentX += xDirection; currentY += yDirection; continue; }
          var nt = { x: currentX + xModifer, y: currentY + yModifer };
          tileIndex = tiles.findIndex(function(t) { return t.x == nt.x && t.y == nt.y; });
          if (tileIndex < 0) { tiles.push(nt); }
          currentX += xDirection; currentY += yDirection;
        }
      } else if (deltaX < 0 && deltaY > 0) {
        xModifer = 0; yModifer = -1;
        for (var step = 0; step <= pathLength; step++) {
          if (step == 0) { currentX += xDirection; currentY += yDirection; continue; }
          else if (attacker_tr && step == 1) { currentX += xDirection; currentY += yDirection; continue; }
          else if (defender_bl && step == pathLength) { currentX += xDirection; currentY += yDirection; continue; }
          var nt = { x: currentX + xModifer, y: currentY + yModifer };
          tileIndex = tiles.findIndex(function(t) { return t.x == nt.x && t.y == nt.y; });
          if (tileIndex < 0) { tiles.push(nt); }
          currentX += xDirection; currentY += yDirection;
        }
      } else if (deltaX > 0 && deltaY < 0) {
        xModifer = 0; yModifer = -1;
        for (var step = 0; step <= pathLength; step++) {
          if (step == pathLength) { currentX += xDirection; currentY += yDirection; continue; }
          else if (attacker_bl && step == 0) { currentX += xDirection; currentY += yDirection; continue; }
          else if (defender_tr && step == pathLength - 1) { currentX += xDirection; currentY += yDirection; continue; }
          var nt = { x: currentX + xModifer, y: currentY + yModifer };
          tileIndex = tiles.findIndex(function(t) { return t.x == nt.x && t.y == nt.y; });
          if (tileIndex < 0) { tiles.push(nt); }
          currentX += xDirection; currentY += yDirection;
        }
      } else if (deltaX < 0 && deltaY < 0) {
        xModifer = 0; yModifer = 0;
        for (var step = 0; step <= pathLength; step++) {
          if (step == 0) { currentX += xDirection; currentY += yDirection; continue; }
          else if (attacker_br && step == 1) { currentX += xDirection; currentY += yDirection; continue; }
          else if (defender_tl && step == pathLength) { currentX += xDirection; currentY += yDirection; continue; }
          var nt = { x: currentX + xModifer, y: currentY + yModifer };
          tileIndex = tiles.findIndex(function(t) { return t.x == nt.x && t.y == nt.y; });
          if (tileIndex < 0) { tiles.push(nt); }
          currentX += xDirection; currentY += yDirection;
        }
      }
      return tiles;
    }
    return tiles;
  }

  // ── edgeBlocked (verbatim from Nick's grid.js:1491) ──────────────────────
  function edgeBlocked(pathEdges) {
    var pathBlocked = false;
    pathEdges.forEach(function(pathEdge) {
      if (pathBlocked) { return; }
      var edgeIndex = blockingEdges.findIndex(function(blocking_edge) {
        return blocking_edge[0].x == pathEdge[0].x && blocking_edge[0].y == pathEdge[0].y &&
          blocking_edge[1].x == pathEdge[1].x && blocking_edge[1].y == pathEdge[1].y;
      });
      pathBlocked = edgeIndex > -1;
    });
    if (pathBlocked) { return true; }
    pathEdges.forEach(function(pathEdge) {
      if (pathBlocked) { return; }
      var edgeIndex = walls.findIndex(function(wall) {
        return wall[0].x == pathEdge[0].x && wall[0].y == pathEdge[0].y &&
          wall[1].x == pathEdge[1].x && wall[1].y == pathEdge[1].y;
      });
      pathBlocked = edgeIndex > -1;
    });
    return pathBlocked;
  }

  // ── tileBlocked (verbatim from Nick's grid.js:1517) ──────────────────────
  function tileBlocked(pathTiles, spireTile) {
    var pathBlocked = false;
    pathTiles.forEach(function(pathTile) {
      if (pathBlocked) { return; }
      var tileIndex = blockers.findIndex(function(blocker) {
        return blocker.x == pathTile.x && blocker.y == pathTile.y;
      });
      pathBlocked = tileIndex > -1;
    });
    if (pathBlocked) { return true; }
    var blocking_Tiles = blockingTiles.filter(function (bt) { return true; });
    if (spireTile) {
      blocking_Tiles = blockingTiles.filter(function(bt) {
        return !((bt.x == spireTile.x && bt.y == spireTile.y - 1) ||
                 (bt.x == spireTile.x && bt.y == spireTile.y + 1) ||
                 (bt.y == spireTile.y && bt.x == spireTile.x - 1) ||
                 (bt.y == spireTile.y && bt.x == spireTile.x + 1));
      });
    }
    pathTiles.forEach(function(pathTile) {
      if (pathBlocked) { return; }
      var tileIndex = blocking_Tiles.findIndex(function(bt) {
        return bt.x == pathTile.x && bt.y == pathTile.y;
      });
      pathBlocked = tileIndex > -1;
    });
    if (pathBlocked) { return true; }
    pathTiles.forEach(function(pathTile) {
      if (pathBlocked) { return; }
      var tileIndex = offMapTiles.findIndex(function(omt) {
        return omt.x == pathTile.x && omt.y == pathTile.y;
      });
      pathBlocked = tileIndex > -1;
    });
    return pathBlocked;
  }

  // ── intersectionBlocksPath (verbatim from Nick's grid.js:1581) ───────────
  function intersectionBlocksPath(blockingIntersection, fromTileX, fromTileY, toTileX, toTileY, startX, startY, endX, endY) {
    var deltaX = endX - startX;
    var deltaY = endY - startY;
    var attackingTileLeftOfIntersection  = fromTileX < blockingIntersection.x;
    var attackingTileRightOfIntersection = !attackingTileLeftOfIntersection;
    var attackingTileAbovefIntersection  = fromTileY < blockingIntersection.y;
    var attackingTileBelowIntersection   = !attackingTileAbovefIntersection;
    var defendingTileLeftOfIntersection  = toTileX < blockingIntersection.x;
    var defendingTileRightOfIntersection = !defendingTileLeftOfIntersection;
    var defendingTileAboveIntersection   = toTileY < blockingIntersection.y;
    var defendingTileBelowIntersection   = !defendingTileAboveIntersection;

    var topConnection    = blockingIntersection.connections.findIndex(function(c) { return c.x == blockingIntersection.x   && c.y == blockingIntersection.y - 1; }) > -1;
    var rightConnection  = blockingIntersection.connections.findIndex(function(c) { return c.x == blockingIntersection.x+1 && c.y == blockingIntersection.y;     }) > -1;
    var leftConnection   = blockingIntersection.connections.findIndex(function(c) { return c.x == blockingIntersection.x-1 && c.y == blockingIntersection.y;     }) > -1;
    var bottomConnection = blockingIntersection.connections.findIndex(function(c) { return c.x == blockingIntersection.x   && c.y == blockingIntersection.y + 1; }) > -1;

    var pathBlocked = false;

    if (blockingIntersection.x == startX && blockingIntersection.y == startY &&
        blockingIntersection.x == endX   && blockingIntersection.y == endY) {
      if (attackingTileLeftOfIntersection && attackingTileAbovefIntersection) {
        if (defendingTileRightOfIntersection && defendingTileAboveIntersection) {
          pathBlocked = (topConnection && leftConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection);
        } else if (defendingTileRightOfIntersection && defendingTileBelowIntersection) {
          pathBlocked = (topConnection && leftConnection) || (topConnection && bottomConnection) || (bottomConnection && rightConnection) || (leftConnection && rightConnection);
        } else if (defendingTileLeftOfIntersection && defendingTileBelowIntersection) {
          pathBlocked = (topConnection && leftConnection) || (leftConnection && bottomConnection) || (leftConnection && rightConnection);
        }
      } else if (attackingTileRightOfIntersection && attackingTileAbovefIntersection) {
        if (defendingTileLeftOfIntersection && defendingTileAboveIntersection) {
          pathBlocked = (topConnection && leftConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection);
        } else if (defendingTileRightOfIntersection && defendingTileBelowIntersection) {
          pathBlocked = (topConnection && rightConnection) || (bottomConnection && rightConnection) || (leftConnection && rightConnection);
        } else if (defendingTileLeftOfIntersection && defendingTileBelowIntersection) {
          pathBlocked = (topConnection && rightConnection) || (leftConnection && bottomConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection);
        }
      } else if (attackingTileRightOfIntersection && attackingTileBelowIntersection) {
        if (defendingTileLeftOfIntersection && defendingTileAboveIntersection) {
          pathBlocked = (leftConnection && topConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection);
        } else if (defendingTileRightOfIntersection && defendingTileAboveIntersection) {
          pathBlocked = (bottomConnection && rightConnection) || (topConnection && rightConnection) || (leftConnection && rightConnection);
        } else if (defendingTileLeftOfIntersection && defendingTileBelowIntersection) {
          pathBlocked = (leftConnection && bottomConnection) || (topConnection && bottomConnection) || (bottomConnection && rightConnection);
        }
      } else if (attackingTileLeftOfIntersection && attackingTileBelowIntersection) {
        if (defendingTileLeftOfIntersection && defendingTileAboveIntersection) {
          pathBlocked = (leftConnection && topConnection) || (leftConnection && rightConnection) || (leftConnection && bottomConnection);
        } else if (defendingTileRightOfIntersection && defendingTileAboveIntersection) {
          pathBlocked = (leftConnection && bottomConnection) || (topConnection && rightConnection) || (leftConnection && rightConnection) || (topConnection && bottomConnection);
        } else if (defendingTileRightOfIntersection && defendingTileBelowIntersection) {
          pathBlocked = (leftConnection && bottomConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection);
        }
      }
    }
    else if (blockingIntersection.x == endX && blockingIntersection.y == endY) {
      if (defendingTileLeftOfIntersection && defendingTileAboveIntersection) {
        if (deltaX > 0 && deltaY > 0) { return false; }
        else if (deltaX < 0 && deltaY > 0) { pathBlocked = (leftConnection && topConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0 && deltaY < 0) { pathBlocked = (leftConnection && topConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0 && deltaY < 0) { pathBlocked = (leftConnection && topConnection) || (leftConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0)               { return false; }
        else if (deltaX < 0)               { pathBlocked = (leftConnection && topConnection) || (topConnection && bottomConnection) || (topConnection && rightConnection); }
        else if (deltaY > 0)               { return false; }
        else if (deltaY < 0)               { pathBlocked = (leftConnection && topConnection) || (leftConnection && rightConnection) || (leftConnection && bottomConnection); }
      } else if (defendingTileRightOfIntersection && defendingTileAboveIntersection) {
        if (deltaX > 0 && deltaY > 0)      { pathBlocked = (leftConnection && topConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0 && deltaY > 0) { return false; }
        else if (deltaX < 0 && deltaY < 0) { pathBlocked = (topConnection && rightConnection) || (bottomConnection && rightConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0 && deltaY < 0) { pathBlocked = (topConnection && rightConnection) || (leftConnection && bottomConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0)               { pathBlocked = (topConnection && rightConnection) || (topConnection && leftConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0)               { return false; }
        else if (deltaY > 0)               { return false; }
        else if (deltaY < 0)               { pathBlocked = (topConnection && rightConnection) || (leftConnection && rightConnection) || (rightConnection && bottomConnection); }
      } else if (defendingTileRightOfIntersection && defendingTileBelowIntersection) {
        if (deltaX > 0 && deltaY > 0)      { pathBlocked = (leftConnection && topConnection) || (bottomConnection && rightConnection) || (leftConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0 && deltaY > 0) { pathBlocked = (topConnection && rightConnection) || (bottomConnection && rightConnection) || (leftConnection && rightConnection); }
        else if (deltaX < 0 && deltaY < 0) { return false; }
        else if (deltaX > 0 && deltaY < 0) { pathBlocked = (leftConnection && bottomConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX > 0)               { pathBlocked = (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && bottomConnection); }
        else if (deltaX < 0)               { return false; }
        else if (deltaY > 0)               { pathBlocked = (bottomConnection && rightConnection) || (leftConnection && rightConnection) || (topConnection && rightConnection); }
        else if (deltaY < 0)               { return false; }
      } else if (defendingTileLeftOfIntersection && defendingTileBelowIntersection) {
        if (deltaX > 0 && deltaY > 0)      { pathBlocked = (leftConnection && topConnection) || (leftConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX < 0 && deltaY > 0) { pathBlocked = (leftConnection && bottomConnection) || (topConnection && rightConnection) || (leftConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0 && deltaY < 0) { pathBlocked = (leftConnection && bottomConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX > 0 && deltaY < 0) { return false; }
        else if (deltaX > 0)               { return false; }
        else if (deltaX < 0)               { pathBlocked = (leftConnection && bottomConnection) || (topConnection && bottomConnection) || (bottomConnection && rightConnection); }
        else if (deltaY > 0)               { pathBlocked = (leftConnection && bottomConnection) || (leftConnection && rightConnection) || (leftConnection && topConnection); }
        else if (deltaY < 0)               { return false; }
      }
    }
    else if (blockingIntersection.x == startX && blockingIntersection.y == startY) {
      if (attackingTileLeftOfIntersection && attackingTileAbovefIntersection) {
        if (deltaX > 0 && deltaY > 0)      { pathBlocked = (topConnection && leftConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX < 0 && deltaY > 0) { pathBlocked = (leftConnection && bottomConnection) || (leftConnection && topConnection) || (leftConnection && rightConnection); }
        else if (deltaX < 0 && deltaY < 0) { return false; }
        else if (deltaX > 0 && deltaY < 0) { pathBlocked = (leftConnection && topConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX > 0)               { pathBlocked = (leftConnection && topConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0)               { return false; }
        else if (deltaY > 0)               { pathBlocked = (leftConnection && topConnection) || (leftConnection && rightConnection); }
        else if (deltaY < 0)               { return false; }
      }
      else if (attackingTileRightOfIntersection && attackingTileAbovefIntersection) {
        if (deltaX > 0 && deltaY > 0)      { pathBlocked = (topConnection && rightConnection) || (bottomConnection && rightConnection) || (leftConnection && rightConnection); }
        else if (deltaX < 0 && deltaY > 0) { pathBlocked = (leftConnection && bottomConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX < 0 && deltaY < 0) { pathBlocked = (topConnection && rightConnection) || (leftConnection && topConnection) || (topConnection && bottomConnection); }
        else if (deltaX > 0 && deltaY < 0) { return false; }
        else if (deltaX > 0)               { return false; }
        else if (deltaX < 0)               { pathBlocked = (topConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaY > 0)               { pathBlocked = (topConnection && rightConnection) || (leftConnection && rightConnection); }
        else if (deltaY < 0)               { return false; }
      }
      else if (attackingTileRightOfIntersection && attackingTileBelowIntersection) {
        if (deltaX > 0 && deltaY > 0)      { return false; }
        else if (deltaX < 0 && deltaY > 0) { pathBlocked = (leftConnection && bottomConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0 && deltaY < 0) { pathBlocked = (leftConnection && topConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0 && deltaY < 0) { pathBlocked = (bottomConnection && rightConnection) || (topConnection && rightConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0)               { return false; }
        else if (deltaX < 0)               { pathBlocked = (bottomConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaY > 0)               { return false; }
        else if (deltaY < 0)               { pathBlocked = (bottomConnection && rightConnection) || (leftConnection && rightConnection); }
      }
      else if (attackingTileLeftOfIntersection && attackingTileBelowIntersection) {
        if (deltaX > 0 && deltaY > 0)      { pathBlocked = (leftConnection && bottomConnection) || (bottomConnection && rightConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0 && deltaY > 0) { return false; }
        else if (deltaX < 0 && deltaY < 0) { pathBlocked = (leftConnection && bottomConnection) || (leftConnection && topConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0 && deltaY < 0) { pathBlocked = (leftConnection && bottomConnection) || (topConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
        else if (deltaX > 0)               { pathBlocked = (leftConnection && bottomConnection) || (topConnection && bottomConnection); }
        else if (deltaX < 0)               { return false; }
        else if (deltaY > 0)               { return false; }
        else if (deltaY < 0)               { pathBlocked = (leftConnection && bottomConnection) || (leftConnection && rightConnection); }
      }
    }
    else {
      if (deltaX > 0 && deltaY > 0)      { pathBlocked = (leftConnection && topConnection)    || (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
      else if (deltaX < 0 && deltaY > 0) { pathBlocked = (leftConnection && bottomConnection) || (topConnection && rightConnection)    || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
      else if (deltaX < 0 && deltaY < 0) { pathBlocked = (leftConnection && topConnection)    || (bottomConnection && rightConnection) || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
      else if (deltaX > 0 && deltaY < 0) { pathBlocked = (leftConnection && bottomConnection) || (topConnection && rightConnection)    || (topConnection && bottomConnection) || (leftConnection && rightConnection); }
      else if (deltaX > 0)               { pathBlocked = (topConnection && bottomConnection); }
      else if (deltaX < 0)               { pathBlocked = (topConnection && bottomConnection)  || (topConnection && rightConnection)    || (bottomConnection && rightConnection); }
      else if (deltaY > 0)               { pathBlocked = (leftConnection && rightConnection); }
      else if (deltaY < 0)               { pathBlocked = (leftConnection && rightConnection); }
    }

    return pathBlocked;
  }

  // ── intersectionBlocked (verbatim from Nick's grid.js:1561) ──────────────
  function intersectionBlocked(pathIntersections, fromTileX, fromTileY, toTileX, toTileY, startX, startY, endX, endY) {
    var intersections = [];
    pathIntersections.forEach(function(pIntersection) {
      var bI = blockingIntersections.find(function(bi) {
        return bi.x == pIntersection.x && bi.y == pIntersection.y;
      });
      if (bI) { intersections.push(bI); }
    });
    if (intersections.length == 0) { return false; }
    var pathBlocked = false;
    intersections.forEach(function(intersection) {
      if (pathBlocked) { return; }
      pathBlocked = intersectionBlocksPath(intersection, fromTileX, fromTileY, toTileX, toTileY, startX, startY, endX, endY);
    });
    return pathBlocked;
  }

  // ── verticallyAdjacentTilesBlocked / horizontallyAdjacentTilesBlocked ────
  function verticallyAdjacentTilesBlocked(tile) {
    var idx = offMapTiles.findIndex(function(t) { return t.x == tile.x && t.y == tile.y; });
    if (idx < 0) idx = blockingTiles.findIndex(function(t) { return t.x == tile.x && t.y == tile.y; });
    if (idx < 0) idx = blockers.findIndex(function(t) { return t.x == tile.x && t.y == tile.y; });
    if (idx < 0) return false;
    else if (tile.y == 0) return true;
    var aIdx = offMapTiles.findIndex(function(t) { return t.x == tile.x && t.y == tile.y - 1; });
    if (aIdx < 0) aIdx = blockingTiles.findIndex(function(t) { return t.x == tile.x && t.y == tile.y - 1; });
    if (aIdx < 0) aIdx = blockers.findIndex(function(t) { return t.x == tile.x && t.y == tile.y - 1; });
    return aIdx != -1;
  }

  function horizontallyAdjacentTilesBlocked(tile) {
    var idx = offMapTiles.findIndex(function(t) { return t.x == tile.x && t.y == tile.y; });
    if (idx < 0) idx = blockingTiles.findIndex(function(t) { return t.x == tile.x && t.y == tile.y; });
    if (idx < 0) idx = blockers.findIndex(function(t) { return t.x == tile.x && t.y == tile.y; });
    if (idx < 0) return false;
    else if (tile.x == 0) return true;
    var aIdx = offMapTiles.findIndex(function(t) { return t.x == tile.x - 1 && t.y == tile.y; });
    if (aIdx < 0) aIdx = blockingTiles.findIndex(function(t) { return t.x == tile.x - 1 && t.y == tile.y; });
    if (aIdx < 0) aIdx = blockers.findIndex(function(t) { return t.x == tile.x - 1 && t.y == tile.y; });
    return aIdx != -1;
  }

  // ── adjacentTilesBlocked (verbatim from Nick's grid.js:2032) ─────────────
  function adjacentTilesBlocked(fromTileX, fromTileY, toTileX, toTileY, startX, startY, endX, endY) {
    var deltaX = endX - startX;
    var deltaY = endY - startY;
    if (!((deltaX == 0 && deltaY != 0) || (deltaY == 0 && deltaX != 0))) { return false; }
    var attacker_tl = startX == fromTileX     && startY == fromTileY;
    var attacker_tr = startX == fromTileX + 1 && startY == fromTileY;
    var attacker_br = startX == fromTileX + 1 && startY == fromTileY + 1;
    var attacker_bl = startX == fromTileX     && startY == fromTileY + 1;
    var defender_tl = endX == toTileX     && endY == toTileY;
    var defender_tr = endX == toTileX + 1 && endY == toTileY;
    var defender_br = endX == toTileX + 1 && endY == toTileY + 1;
    var defender_bl = endX == toTileX     && endY == toTileY + 1;
    var currentX = startX, currentY = startY;
    var pathLength = 0;
    var xDirection = deltaX < 0 ? -1 : 1;
    var yDirection = deltaY < 0 ? -1 : 1;
    var pathBlocked = false;
    if (deltaY == 0) {
      pathLength = Math.abs(deltaX);
      if (xDirection > 0) {
        for (var step = 0; step < pathLength; step++) {
          if (pathBlocked) { return true; }
          if (step == 0 && (attacker_tl || attacker_bl)) { currentX += xDirection; currentY = startY; continue; }
          else if (step == pathLength - 1 && (defender_tr || defender_br)) { currentX += xDirection; currentY = startY; continue; }
          pathBlocked = verticallyAdjacentTilesBlocked({ x: currentX, y: currentY });
          currentX += xDirection; currentY = startY;
        }
      } else if (xDirection < 0) {
        for (var step = 0; step <= pathLength; step++) {
          if (pathBlocked) { return true; }
          if (step == 0) { currentX += xDirection; currentY = startY; continue; }
          if (step == 1 && (attacker_tr || attacker_br)) { currentX += xDirection; currentY = startY; continue; }
          else if (step == pathLength && (defender_tl || defender_bl)) { currentX += xDirection; currentY = startY; continue; }
          pathBlocked = verticallyAdjacentTilesBlocked({ x: currentX, y: currentY });
          currentX += xDirection; currentY = startY;
        }
      }
    } else if (deltaX == 0) {
      pathLength = Math.abs(deltaY);
      if (yDirection > 0) {
        for (var step = 0; step < pathLength; step++) {
          if (pathBlocked) { return true; }
          if (step == 0 && (attacker_tl || attacker_tr)) { currentX = startX; currentY += yDirection; continue; }
          else if (step == pathLength - 1 && (defender_bl || defender_br)) { currentX = startX; currentY += yDirection; continue; }
          pathBlocked = horizontallyAdjacentTilesBlocked({ x: currentX, y: currentY });
          currentX = startX; currentY += yDirection;
        }
      } else if (yDirection < 0) {
        for (var step = 0; step <= pathLength; step++) {
          if (pathBlocked) { return true; }
          if (step == 0) { currentX = startX; currentY += yDirection; continue; }
          if (step == 1 && (attacker_bl || attacker_br)) { currentX = startX; currentY += yDirection; continue; }
          else if (step == pathLength && (defender_tl || defender_tr)) { currentX = startX; currentY += yDirection; continue; }
          pathBlocked = horizontallyAdjacentTilesBlocked({ x: currentX, y: currentY });
          currentX = startX; currentY += yDirection;
        }
      }
    }
    return pathBlocked;
  }

  // ── getLosFromCornerToCorner (verbatim from Nick's grid.js:1129) ─────────
  function getLosFromCornerToCorner(fromTileX, fromTileY, toTileX, toTileY, attackingCorner, defendingCorner) {
    var pathBlocked = false;
    var verticalEdges = getVerticalEdges(attackingCorner.x, attackingCorner.y, defendingCorner.x, defendingCorner.y);
    pathBlocked = edgeBlocked(verticalEdges);
    if (pathBlocked) return false;
    var horizontalEdges = getHorizontalEdges(attackingCorner.x, attackingCorner.y, defendingCorner.x, defendingCorner.y);
    pathBlocked = edgeBlocked(horizontalEdges);
    if (pathBlocked) return false;
    var intersections = getIntersections(attackingCorner.x, attackingCorner.y, defendingCorner.x, defendingCorner.y);
    if (blockingCornerSet) {
      for (var i = 0; i < intersections.length; i++) {
        var pi = intersections[i];
        if (pi.x === attackingCorner.x && pi.y === attackingCorner.y) continue;
        if (pi.x === defendingCorner.x && pi.y === defendingCorner.y) continue;
        if (blockingCornerSet.has(pi.x + ',' + pi.y)) return false;
      }
    }
    pathBlocked = intersectionBlocked(intersections,
      fromTileX, fromTileY, toTileX, toTileY,
      attackingCorner.x, attackingCorner.y, defendingCorner.x, defendingCorner.y);
    if (pathBlocked) return false;
    var tiles = getTiles(verticalEdges, horizontalEdges, intersections,
      fromTileX, fromTileY, toTileX, toTileY,
      attackingCorner.x, attackingCorner.y, defendingCorner.x, defendingCorner.y);
    var targetSpire = spireTiles.find(function(s) {
      return (s.x == toTileX   && s.y == toTileY) ||
             (s.x == fromTileX && s.y == fromTileY);
    });
    pathBlocked = tileBlocked(tiles, targetSpire);
    if (pathBlocked) return false;
    pathBlocked = adjacentTilesBlocked(fromTileX, fromTileY, toTileX, toTileY,
      attackingCorner.x, attackingCorner.y, defendingCorner.x, defendingCorner.y);
    if (pathBlocked) return false;
    return true;
  }

  // ── getLosFromPointToPoint (verbatim from Nick's grid.js:1162) ───────────
  function getLosFromPointToPoint(fromTileX, fromTileY, toTileX, toTileY, fromPoint, toPoint) {
    var verticalEdges = getVerticalEdges(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y);
    var finalEdgeIndex = verticalEdges.findIndex(function(edge) {
      return edge[0].y == Math.floor(toPoint.y) && edge[0].x == toPoint.x &&
             edge[1].y == Math.ceil(toPoint.y)  && edge[1].x == toPoint.x;
    });
    if (finalEdgeIndex > -1) verticalEdges.splice(finalEdgeIndex, 1);
    if (edgeBlocked(verticalEdges)) return false;
    var horizontalEdges = getHorizontalEdges(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y);
    finalEdgeIndex = horizontalEdges.findIndex(function(edge) {
      return edge[0].x == Math.floor(toPoint.x) && edge[0].y == toPoint.y &&
             edge[1].x == Math.ceil(toPoint.x)  && edge[1].y == toPoint.y;
    });
    if (finalEdgeIndex > -1) horizontalEdges.splice(finalEdgeIndex, 1);
    if (edgeBlocked(horizontalEdges)) return false;
    return true;
  }

  // ── calculateLoSFromAttackerToDefender (verbatim, returns ANY-pair-enabled) ──
  if (fromTileX == -1 || fromTileY == -1 || toTileX == -1 || toTileY == -1) return false;
  var attacker_tl = { x: fromTileX,     y: fromTileY     };
  var attacker_tr = { x: fromTileX + 1, y: fromTileY     };
  var attacker_bl = { x: fromTileX,     y: fromTileY + 1 };
  var attacker_br = { x: fromTileX + 1, y: fromTileY + 1 };
  var defender_tl = { x: toTileX,     y: toTileY     };
  var defender_tr = { x: toTileX + 1, y: toTileY     };
  var defender_bl = { x: toTileX,     y: toTileY + 1 };
  var defender_br = { x: toTileX + 1, y: toTileY + 1 };
  var defender_top    = { x: toTileX + 0.5, y: toTileY     };
  var defender_right  = { x: toTileX + 1,   y: toTileY + 0.5 };
  var defender_bottom = { x: toTileX + 0.5, y: toTileY + 1 };
  var defender_left   = { x: toTileX,       y: toTileY + 0.5 };

  // 16 attacker × adjacent-defender-pair combos. For each, both corner LOS
  // lines + edge midpoint LOS line + paths-don't-overlap → enabled.
  const attackerCorners = [attacker_tl, attacker_tr, attacker_bl, attacker_br];
  const defenderPairs = [
    [defender_tl, defender_tr, defender_top   ],
    [defender_tr, defender_br, defender_right ],
    [defender_bl, defender_br, defender_bottom],
    [defender_tl, defender_bl, defender_left  ],
  ];
  for (const a of attackerCorners) {
    for (const [d1, d2, mid] of defenderPairs) {
      const overlaps = pathsOverlap(a, d1, d2);
      if (overlaps) continue;
      const c1 = getLosFromCornerToCorner(fromTileX, fromTileY, toTileX, toTileY, a, d1);
      if (!c1) continue;
      const c2 = getLosFromCornerToCorner(fromTileX, fromTileY, toTileX, toTileY, a, d2);
      if (!c2) continue;
      const m  = getLosFromPointToPoint  (fromTileX, fromTileY, toTileX, toTileY, a, mid);
      if (!m) continue;
      return true;
    }
  }
  return false;
}
