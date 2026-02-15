# IA Skirmish Map Tool Design

## TI4 Async Reference

TI4 Async uses a **separate map system**:
- **Web tool** (keeganw.github.io/ti4): Pre-game map building, tile placement, "Toggle Tile Number Overlay" for coordinates
- **Discord bot**: Regenerates map images when game state changes (MapRenderPipeline). Players see updated maps in the channel.
- **TI4 maps**: Hexagonal tile layout, each tile has a number (0–60+). Coordinates = tile positions.

## IA Skirmish Maps

- **Modular tiles**: Maps are built from map tiles (rectangular grid spaces)
- **Spaces**: Each tile has spaces; figures occupy spaces. Movement = space-to-space.
- **Deployment zones**: Red/blue zones (groups of spaces) where players deploy.
- **No standard coordinate system** in the physical game — we’d define one.

## Proposed: Battleship-Style Grid

**Format:** `a1`, `a2`, `b1`, `b2`, etc.

- **Rows:** a, b, c, d, … (letters)
- **Columns:** 1, 2, 3, 4, … (numbers)
- **Origin:** Top-left = a1; increase right (a2, a3…) and down (b1, c1…)

Example 4×6 map:
```
    1   2   3   4   5   6
a [  ] [  ] [  ] [  ] [  ] [  ]
b [  ] [  ] [  ] [  ] [  ] [  ]
c [  ] [  ] [  ] [  ] [  ] [  ]
d [  ] [  ] [  ] [  ] [  ] [  ]
```

## What We Need

1. **Map data (per map):**
   - Grid dimensions (rows × cols)
   - Space list with coordinates
   - Adjacency (which spaces connect for movement)
   - Deployment zones (which coordinates are red/blue)
   - Blocking terrain, doors, terminals, etc.

2. **Map tool (separate system):**
   - Load map definition
   - Render board image with coordinate overlay (a1, a2, …)
   - Accept game state (figure positions by coordinate)
   - Output updated image for Discord

3. **Integration:**
   - Bot stores: `figureId → coordinate` (e.g. `"stormtrooper-1" → "b3"`)
   - On move/attack: bot calls map tool with new state → gets image → posts to Board channel

## Data Sources

- **Vassal .vsav files:** May have tile/position data — need to parse.
- **Vassal buildFile.xml:** References PositionMapper, positions. May define space layout.
- **Manual definition:** Define grid + deployment zones per map from mission diagrams.
- **IA Skirmish Map Project** (GitHub): Map images only, no structured space data.

## Vassal map images and coordinates

Vassal-generated map images already include the grid and coordinate labels on the sides. The bot (or any runner) can use them with high accuracy:

- **Grid metadata** in `map-registry.json` (`dx`, `dy`, `x0`, `y0`) defines cell size and origin. If the image is rendered with that grid, pixel (x, y) maps deterministically to cell (e.g. a1, b2) — **100% accurate** without OCR.
- **High-res PDFs** in `data/map-pdfs/` give enough clarity to read edge coordinates for moving units, registering spaces, and distances. When implementing move/placement, use the grid definition to map pixel positions to coordinates.

## Implementation Status

**Done:**
1. **Map registry** – `scripts/extract-map-registry.js` parses `buildFile.xml` → `data/map-registry.json` (54 maps, grid params)
2. **Renderer** – `src/map-renderer.js` loads map image, draws coordinate overlay (a1, b2…), optional figure markers. Uses Node `canvas`.
3. **Test** – `npm run test-map` outputs `test-map-output.png`

**Map images:** Stored under `vassal_extracted/images/maps/` (see ASSETS_CATALOG.md). Vassal map images (e.g. `Map_Training Ground.gif`) may live inside the .vmod; run `npm run organize-images` to sort into subfolders. Fallback: use IA Skirmish Map Project images and map names to registry.

**Next:** Wire bot "Refresh Map" button → renderMap() → post to Board channel.
