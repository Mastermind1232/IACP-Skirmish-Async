# Deterministic Movement Engine — Plan (updated)

## Goals

- **100% deterministic board state**: Every movement decision derived from a single view of the board (positions, map, rules).
- **100% deterministic movement rules**: One place defines what is legal (costs, blocking, occupied); all pathfinding uses it.
- **Future-proof for modifiers**: Engine designed so we can later pass per-activation modifiers (e.g. +2 MP, ignore difficult, flying) without rewriting core logic.

Only maps that are fully configured (terrain, zones, edges) are in the play-ready pool; no need to default missing terrain.

---

## Rules (confirmed)

- **Terrain**: Difficult = 2 MP to enter, normal = 1 MP. Other types per IACP if needed later.
- **Blocking**: Figures can never move onto blocking terrain (impassable).
- **Large figures**: 2x2 and 2x3 movement **included** in this engine.
- **Modifiers**: Command cards/abilities may add +MP, ignore difficult, fly, etc.; engine will accept optional modifiers per activation later.

---

## Current Gaps

| Piece | Today | Change |
|-------|--------|--------|
| Board state | Scattered reads from `game` + `getMapSpaces` | Single API: `getBoardStateForMovement(game, excludeFigureKey)` → `{ mapSpaces, occupiedSet, mapId }`. |
| Step cost | Fixed 1 per step | `getStepCost(toCoord, mapSpaces)` → 1 (normal), 2 (difficult), Infinity (blocking). Pathfinding uses this. |
| Algorithm | BFS with queue (assumes cost 1) | **Dijkstra (priority queue by cost)** so variable cost (1/2) gives correct shortest path. |
| Large figures | "Coming soon" | Footprint-aware reachability: valid **top-left** positions, full footprint valid (on map, not blocked, not occupied). |

---

## Implementation

### 1. Board state API

- **`getBoardStateForMovement(game, excludeFigureKey)`** in `index.js`:
  - `mapSpaces = getMapSpaces(game.selectedMap?.id)`
  - `occupiedSet` = set from `getOccupiedSpacesForMovement(game, excludeFigureKey)`
  - Return `{ mapSpaces, occupiedSet, mapId }`. Use everywhere movement needs “current board.”

### 2. Movement rules layer

- **`getStepCost(toCoord, mapSpaces)`** (cost to **enter** `toCoord`):
  - If `mapSpaces.blocking` includes `toCoord` → return Infinity (cannot enter).
  - If `mapSpaces.terrain[toCoord] === 'difficult'` → return 2.
  - Else → return 1.
- Keep existing: cannot cross `movementBlockingEdges`, cannot end on occupied. Adjacency already omits impassable in exported data; still check `movementBlockingEdges` in pathfinding.

### 3. Pathfinding: Dijkstra + variable cost

- Replace **plain queue** with a **priority queue** (min-heap by cost) in:
  - **getReachableSpaces(startCoord, mp, mapSpaces, occupiedSet)**: Dijkstra; collect all nodes with min cost ≤ mp; exclude start; exclude occupied.
  - **getPathCost(startCoord, destCoord, mapSpaces, occupiedSet)**: Dijkstra to dest; return cost or Infinity.
  - **getSpacesAtExactMp(startCoord, mp, mapSpaces, occupiedSet)**: Dijkstra until cost > mp; return nodes with cost === mp.
- Each step: from `cur` to neighbor `n`, skip if edge in `movementBlockingEdges`, skip if `n` occupied. Cost to reach `n` = `curCost + getStepCost(n, mapSpaces)`.

### 4. Large figures (2x2, 2x3)

- **Position** = top-left coord; 2x3 orientation from `game.figureOrientations[figureKey]` (e.g. `'horizontal'` = 3 cols × 2 rows, `'vertical'` = 2 cols × 3 rows).
- **Reachable** = set of **top-left** coords such that:
  - New footprint = `getFootprintCells(newTopLeft, size, orientation)` (extend `getFootprintCells` for 2x3 orientation if needed).
  - All footprint cells in `mapSpaces.spaces`, not in `occupiedSet`, not in `mapSpaces.blocking`.
  - No movement-blocking edge crossed when moving figure from current to new top-left (orthogonal step: current top-left → new top-left is one cell N/S/E/W).
- **Step cost for large figure**: Cost to move figure one “step” = cost to enter the **new** footprint. Use max cost of entering any new cell of the footprint, or per-rules (e.g. cost of top-left only). Then run Dijkstra over top-left positions with that step cost.
- **Move handler**: Remove “Coming soon” for non-1x1; pass `figureKey`, `size`, `orientation` into board state / pathfinding so reachable spaces and path cost are footprint-aware.

### 5. Modifiers (later)

- Design so pathfinding can take an optional **options** object, e.g. `{ extraMp: 2, ignoreDifficult: true, flying: false }`. For this pass, options can be omitted (default behavior). Later: `getStepCost(toCoord, mapSpaces, options)` and max MP = speed + (options.extraMp || 0), etc.

### 6. No cached reachable

- Keep current pattern: every Move / Move N / space click recomputes from `game` + `getBoardStateForMovement`. Only `moveInProgress` and `figurePositions` (and orientations) stored.

---

## Files

- **index.js**: Add `getBoardStateForMovement`, `getStepCost`; add priority-queue helper or use array+sort for Dijkstra; update `getReachableSpaces`, `getPathCost`, `getSpacesAtExactMp`; extend for large-figure reachability and remove “Coming soon”; ensure `getFootprintCells` supports 2x3 orientation if not already.
- **data/map-spaces.json**: No schema change. Play-ready maps already have terrain and blocking configured.
- **docs**: Optional one-line in RULES_REFERENCE or here: “Movement: 1 MP normal, 2 MP difficult; blocking = impassable; pathfinding is Dijkstra by MP cost.”

---

## Order of work

1. Board state API + step cost + Dijkstra for 1x1 (terrain + blocking).
2. Wire handlers to use board state API; verify Move 1 / Move 2 / space pick and MP deduction.
3. Large-figure reachability and path cost (top-left, footprint, orientation).
4. Remove “Coming soon” and enable Move for 2x2/2x3.
5. (Later) Add optional modifiers parameter and support +MP, ignore difficult, etc.
