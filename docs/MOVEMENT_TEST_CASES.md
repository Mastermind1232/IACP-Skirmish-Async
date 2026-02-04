# Imperial Assault Movement — Test Cases & Knowledge Gaps

**Purpose:** Document movement rules, test scenarios, and known gaps. Run `node index.js --test-movement` to execute tests.

---

## Official Rules (from FFG / IACP)

| Rule | Source | Implementation Status |
|------|--------|------------------------|
| Normal terrain = 1 MP to enter | Skirmish Guide | ✅ |
| Difficult terrain = 2 MP to enter | Skirmish Guide | ✅ |
| Blocking terrain = impassable (cannot enter) | Skirmish Guide | ✅ |
| Moving **through** a hostile figure = +1 MP extra (2 MP total for that space) | Consolidated Rules | ✅ |
| Moving **through** a friendly figure = no extra cost | Consolidated Rules | ✅ |
| Cannot **end** movement on a space with another figure | Rules Reference | ✅ |
| Diagonal movement allowed when both orthogonal "corner" spaces exist | CanMoveDiagonally | ✅ |
| Cutting corner diagonally (not entering enemy space) = 1 MP | Implied | ✅ (entering set excludes corner) |
| movementBlockingEdges (dotted red) = cannot cross | Map tool | ✅ |
| impassableEdges = solid walls, no adjacency | Map tool | ✅ |
| Large figures (2x2, 2x3) = footprint-aware movement | MOVEMENT_ENGINE_PLAN | ✅ |
| Massive / Mobile = ignore difficult, blocking, figure cost | getMovementProfile | ✅ |

---

## Verified (Consolidated Rules)

1. **Hostile figure cost:** +1 MP to enter a space containing a hostile figure. ✅
2. **Friendly figures:** No extra movement cost to move through friendly figures. Can still not end movement on them (unless Massive). ✅
3. **Diagonal through enemy:** You only pay for cells you **enter**; cutting the corner = no enter = 1 MP. ✅
4. **Ending on friendly:** Cannot end on any figure (friendly or hostile) unless Massive. ✅

---

## Test Scenarios

### Grid Layout (5×5, coords a1–e5)

```
     A   B   C   D   E
1  [  ] [  ] [  ] [  ] [  ]
2  [  ] [W ] [  ] [  ] [  ]   W = Wookiee (enemy)
3  [  ] [  ] [  ] [  ] [  ]
4  [  ] [  ] [  ] [  ] [  ]
5  [L ] [  ] [  ] [  ] [  ]   L = Luke (moving figure)
```

### Case 1: Diagonal Past Enemy (Corner Cut)

- **Setup:** Luke at A1, Wookiee at B2. Empty otherwise.
- **Question:** Luke (speed 4) wants to reach C3. Path A1→B2→C3 goes through Wookiee. Path A1→B1→C2→C3 goes around. Path A1→B1→C2 cuts the diagonal corner at B2.
- **Expected:** A1→B1→C2→C3 = 3 MP (no cell entered is occupied). A1→B2→C3 = 2+1=3 MP (B2 costs 2 to enter, C3 costs 1) but cannot **end** on B2 — so must continue. Total 2+1=3 to reach C3 via through.
- **Code behavior:** Diagonal from B1 to C2: entering = [C2] only. B2 not in entering. Cost 1. ✅

### Case 2: Orthogonal Through Enemy

- **Setup:** Luke at A1, Wookiee at B1. Luke wants to reach C1.
- **Expected:** A1→B1 (2 MP) → C1 (1 MP) = 3 MP total. Cannot end on B1.
- **Code behavior:** enteringOccupied=true for B1, extraCost=1, cost=2. canEnd=false. Pathfinding explores through. ✅

### Case 3: Difficult Terrain

- **Setup:** Luke at A1. B1 is difficult. C1 is normal.
- **Expected:** A1→B1 = 2 MP. A1→B1→C1 = 2+1 = 3 MP.
- **Code behavior:** enteringDifficult, extraCost=1. ✅

### Case 4: Blocking

- **Setup:** B1 is blocking.
- **Expected:** Cannot enter B1. A1→C1 must go around.
- **Code behavior:** blockingSet, evaluateMovementStep returns null. ✅

### Case 5: Movement-Blocking Edge (Wall)

- **Setup:** Edge between A1 and B1 is in movementBlockingEdges.
- **Expected:** Cannot move A1→B1 directly.
- **Code behavior:** movementBlockingSet check in evaluateMovementStep. ✅

### Case 6: Diagonal When Corner Missing

- **Setup:** B1 is off-map or blocking. Luke at A1 wants to reach B2 diagonally.
- **Expected:** Diagonal A1→B2 requires intermediates A2 and B1. If B1 invalid, diagonal not allowed.
- **Code behavior:** canMoveDiagonally checks both intermediates. ✅

### Case 7: Through Two Enemies

- **Setup:** Luke at A1, Enemy1 at B1, Enemy2 at C1. Luke wants D1.
- **Expected:** A1→B1 (2) →C1 (2) →D1 (1) = 5 MP. Cannot end on B1 or C1.
- **Code behavior:** Each occupied cell adds +1. ✅

### Case 8: Friendly Figure

- **Setup:** Luke at A1, friendly Leia at B1. Can Luke move to C1?
- **Rules (unverified):** Can you move through friendly figures? Same cost?
- **Code behavior:** occupiedSet includes all figures. Same as enemy. ⚠️ **Gap if rules differ.**

---

## Running Tests

```bash
node index.js --test-movement
```

Exits with code 0 if all pass, 1 if any fail. No Discord connection.

### Standalone sanity checks (no bot)

```bash
node scripts/test-movement.js
```

Runs adjacency/terrain checks only. Full pathfinding tests require `node index.js --test-movement`.
