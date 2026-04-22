# D7.3 — Spatial tensor board dimensions

Commits the fixed grid size, coordinate origin, axis convention, and padding semantics
for the spatial tensor whose channel list is defined in `_channel_list.md`.

Doc-only slice. No engine code. Unblocks D7.5 (`encode_state`) and D7.6 (`decode_state`)
by pinning the tensor shape contract.

---

## Decision

**Grid: `32 × 32` fixed.**
Spatial tensor shape is `[C, H, W] = [96, 32, 32]` where `C=96` is the channel count
from D7.2 and `H=W=32`.

---

## Observed map extents (measured 2026-04-21)

Source: `data/map-spaces.json`. Parsed every cell's `(col, row)` across all 8 missions.

| Mission                  | Col span | Row span | Cells |
|---                       |---       |---       |---    |
| mos-eisley-outskirts     | a..z (26)| 1..26 (26)| 658  |
| corellian-underground    | a..z (26)| 1..26 (26)| 936  |
| chopper-base-atollon     | d..x (21)| 3..20 (18)| 227  |
| lothal-wastes            | c..x (22)| 4..22 (19)| 297  |
| development-facility     | a..z (26)| 1..24 (24)| 624  |
| devaron-garrison         | a..z (26)| 1..28 (28)| 728  |
| anchorhead-cantina-bar   | a..z (26)| 1..24 (24)| 624  |
| hoth-battle-station      | e..w (19)| 2..22 (21)| 186  |

**Max col span: 26** (any `a..z` map).
**Max row span: 28** (devaron-garrison, rows 1..28).

---

## Why 32 × 32

- **Fits the largest map.** 26 × 28 max extent vs 32 × 32 tensor → 6 cols and 4 rows of padding on the bottom-right margin. No map comes close to the boundary.
- **Power of 2.** CNN stride-2 downsampling (D8) produces integer spatial dims at every depth: 32 → 16 → 8 → 4. No fractional pixels, no asymmetric pooling.
- **16 is too small.** Can't hold 26 × 28.
- **64 is wasteful.** 4× the activation memory for no capacity gain — the signal density is ≤ 936 cells on the largest map, so ~91% of a 64 × 64 grid would be permanently padded.
- **Non-power dims (28, 30) are awkward.** CNN strides at depth produce odd spatial sizes (e.g. 30 → 15 → 7.5); forces ad-hoc padding inside the residual tower.

Plan anchored 32 × 32 in D7.3. This doc formalizes the choice with measured data.

---

## Coordinate contract

### JS / engine coords
IA coordinates are `<col><row>` strings (e.g. `'a1'`, `'m15'`, `'z28'`). Columns are
letters `'a'..'z'`, rows are integers `1..28`.

### Tensor index mapping
Let `(col, row)` be a JS coord. Its tensor index `(x, y)` is:

```
x = ord(col.lower()) - ord('a')    # 0 .. 25
y = row - 1                        # 0 .. 27
```

**`x` is the horizontal axis (columns, increasing right), `y` is the vertical axis
(rows, increasing down).** This mirrors standard image convention where the
top-left pixel is `(0, 0)`.

### Tensor layout in memory

PyTorch convention: `tensor[c, y, x]` where `c` is channel, `y` is row (height), `x`
is column (width). So a cell `'m15'` lives at `tensor[:, 14, 12]`.

### Bounds

After the mapping above, every valid IA cell has `0 ≤ x ≤ 25` and `0 ≤ y ≤ 27`.
Tensor slots with `x ≥ 26` (cols `26..31`) and `y ≥ 28` (rows `28..31`) are
**always padding** regardless of which mission is being encoded.

---

## Padding semantics

Padded cells (anything outside the actual map's cell set, including the 26..31 /
28..31 dead strip and any hole inside the map's bounding box) are encoded as:

- **`wall_static` channel (Group D, idx 57): `1.0`** — marks the cell as
  impassable / off-map.
- **Every other channel: `0.0`** — no figure, no terrain flag, no objective, no
  pending-state mask.

The CNN then learns to treat `wall_static=1` cells as impassable; the policy head
should never place probability mass on a padded cell because the legal-action
mask channels (Group G) are already 0 there.

**Rationale.** Adding a dedicated `is_off_map` channel would double-encode the
information (every off-map cell is always a wall, and every wall is always
untargetable). Using `wall_static` keeps the channel budget at 96 and preserves
a single "cell is impassable" semantic the CNN can learn once and reuse.

---

## Coordinate origin decision (top-left vs centered)

**Committed: top-left origin.** Actual map cells always start at `(x=0, y=0)` if the
map includes `'a1'` (6 of 8 missions do); else the top-left corner of the map's
bounding box sits at its natural offset (e.g. chopper-base-atollon's top-left is
`(x=3, y=2)` since cols start at `d` and rows at `3`).

Alternative considered: center each map in the 32 × 32 grid. Rejected because:
- The same IA cell would map to different tensor coords across missions, defeating
  weight reuse for positional features.
- Engine-side coord lookups (adjacency, LOS, pathfinding) live in Python at their
  natural `(col, row)` and need a single deterministic tensor mapping.
- Top-left is what a JS reader of the JSON would reach for first; keeps cross-
  engine mental model aligned.

---

## Decode contract

`decode_state(spatial, scalar)` must invert the encoder over the set of cells that
are real on the current mission. Padded cells are allowed to carry arbitrary
values post-encode, but on round-trip the decoder reads only cells where
`mission.spaces` includes the IA coord. Bijection is required on that subset
(D7.7).

---

## Revision policy

The grid size `32 × 32`, the origin convention, and the axis mapping are **stable
contract** from this slice onward. Any future map with col-span > 26 or row-span
> 28 would require a tensor shape change and a separate explicit slice (not an
in-place edit). No such map exists today.

The padding semantic ("off-map ⇒ `wall_static=1`, everything else 0") is stable.
Alternative padding schemes (learned padding embeddings, signed distance to map
boundary, etc.) are considered representation-layer optimizations and would
land as future slices on top of the baseline.

---

## Verification checklist

- [x] All 8 missions fit inside `32 × 32` with both col and row span ≤ 28.
- [x] Shape contract pinned: `[96, 32, 32]` (channels from D7.2).
- [x] Origin and axis convention documented with a concrete sample mapping.
- [x] Padding semantic chosen (reuse `wall_static`, no new channel).
- [x] Channel count unchanged at 96 (D7.2 contract preserved).

---

## Out of scope

- `encode_state` implementation (D7.5).
- `decode_state` implementation (D7.6).
- Scalar-vector shape (D7.4).
- Bijection tests (D7.7) and 10K round-trip (D7.10).
- Batch encoder (D7.9).
- CNN input-layer wiring — lives in D8.4 (input stem).
