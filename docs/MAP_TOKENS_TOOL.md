# Map Tokens Tool

Place **terminals**, **Mission A tokens** (launch panels for Get to the Ship), and **Mission B tokens** (contraband for Smuggled Goods) on the map.

## Usage

1. Open `vassal_extracted/images/extract-map-tokens.html` in a browser.
2. Click **Load map-spaces.json** → select `data/map-spaces.json` (defines valid cells).
3. Use the three modes to place tokens:
   - **Terminals** — global, always on the map
   - **Mission A** — launch panels (Mission A: Get to the Ship)
   - **Mission B** — contraband (Mission B: Smuggled Goods)
4. Click or drag to add/remove. Off-map cells are dimmed.
5. **Export map-tokens.json** → save the downloaded file to `data/map-tokens.json`.

## Map Display

The map renderer uses actual game box token images from `vassal_extracted/images/`:
- **Terminals** — `Counter--Terminal Blue.gif`
- **Mission A (launch panels)** — `Mission Token--Neutral Blue.gif`
- **Mission B (contraband)** — `Counter--Crate Blue.gif`

Token images are configured in `data/token-images.json`.

## Bot Integration

When Mos Eisley Outskirts is selected:
- Terminals are always drawn on the map.
- If Mission A is randomly selected → launch panels are drawn.
- If Mission B is randomly selected → contraband tokens are drawn.
