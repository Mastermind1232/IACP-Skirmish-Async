# Map Tool — Full Top-to-Bottom Audit

**Date:** 2026-02-16  
**Scope:** Server injection, HTML/script order, data flow, dropdown, terrain draw, mission data.

---

## 1. Server (`scripts/map-tool-server.js`)

### Request handling
- **Root `/`** → treated as request for `vassal_extracted/images/extract-map-spaces.html` (pathname = `'/' + MAP_SPACES_HTML`).
- **Path match:** `normalizedHtmlPath === 'vassal_extracted/images/extract-map-spaces.html'` (case-insensitive). So both `http://127.0.0.1:3457/` and `http://127.0.0.1:3457/vassal_extracted/images/extract-map-spaces.html` get the **injected** HTML.
- **`/data/*.json`** → served from project `data/` (e.g. `/data/map-spaces.json`).
- **`/maps/xxx`** → served from `vassal_extracted/images/maps/` (e.g. `/maps/Map_Mos Eisley Outskirts.gif`).

### Injection (critical)
- **Map spaces:** Replaced `<!-- INJECT_MAP_SPACES -->` with **empty** `{"maps":{}}` in both branches (bug). **Fixed:** when `data/map-spaces.json` exists, server now reads and injects its full content (escaped for script).
- **Mission cards:** Was always empty. **Fixed:** when `data/mission-cards.json` exists, server now injects its full content.
- **Deployment zones / Map tokens:** Were always empty. **Fixed:** when `data/deployment-zones.json` and `data/map-tokens.json` exist, server injects their content.
- **Map image paths:** From `data/map-registry.json` → `id` → `vassal_extracted/images/maps/<filename>`.
- **Escaping:** `escapeJsonForScript()` replaces `</script>` and `<` so injected JSON does not break the HTML.

### Takeaways
- User **must** open the tool from the map-tool server URL (e.g. `http://127.0.0.1:3457/`). Opening the HTML via `file://` means no injection and no `/data/` or `/maps/` requests.
- After code changes, restart the server and hard-refresh the page (Ctrl+F5).

---

## 2. HTML structure and script order

### DOM order
1. `<p id="status">`, diagnostic panel, toolbars, map `<select id="mapSelect">` (initially **no options**), `<img id="mapImg">`, overlay `<canvas>`, mission panel.
2. Placeholders: `<!-- INJECT_MAP_SPACES -->`, `<!-- INJECT_MAP_IMAGE_PATHS -->`, etc. (replaced by server with `<script type="application/json" id="...">` or `<script>...`).
3. **Script 1:** `window.__mapToolAllMaps` = full map list (id + name).
4. **Script 2:** `window.__mapToolError`, boot check (file: vs http), `window.__mapToolChangeMap` (early handler), `window.onerror`, diagnostic, then **main script** (fullMapData, mapImagePaths, ALL_MAPS, ensureMapDropdownPopulated, … initMapSelect, applyLoadedData, fetch fallback, save, img.onload).
5. **Script 3 (fallback):** Fetches `/data/map-spaces.json`, populates dropdown, sets `__mapToolData`, calls `__mapToolApplyLoadedData` if defined, then `__mapToolRefreshAfterLoad`.

### Data elements (after server injection)
- `#map-spaces-data` → `fullMapData` (parsed in main script).
- `#map-image-paths` → `mapImagePaths`.
- `#mission-cards-data` → `fullMissionCardsData` (plus localStorage merge).
- `#deployment-zones-data`, `#map-tokens-data`, `#tournament-rotation`, etc.

### Takeaways
- `ALL_MAPS` is defined in the main script (line ~494); dropdown and `getMapImageSrc` use it. `__mapToolAllMaps` is set in script 1 and again in main script; fallback uses `__mapToolAllMaps` if main script never runs.
- If the main script throws **before** `initMapSelect`, the dropdown never gets the full handler and `switchToMap` is never called on change. The **early** `__mapToolChangeMap` only updates `img.src` and status; it now also calls `window.__mapToolSwitchToMap(id)` when set, so after main script runs, dropdown change still triggers a full switch.

---

## 3. Dropdown: populate and change

### Populate
- **ensureMapDropdownPopulated** (IIFE right after `ALL_MAPS`): clears `<select>`, appends one `<option>` per `ALL_MAPS`. So dropdown has options as soon as this runs.
- **initMapSelect:** calls `refreshMapSelectOptions()` which rebuilds the dropdown with **optgroups** (play ready / in rotation). So the visible list is from `ALL_MAPS`; grouping uses `fullMapData` and `fullTournamentRotationData`.

### Change handler
- **Inline:** `onchange="if(window.__mapToolChangeMap)window.__mapToolChangeMap()"`.
- **Early handler** (script 2): sets `img.src = '/maps/Map_' + name + '.gif'`, status, and `window.__mapToolSwitchToMap(id)` if defined.
- **Full handler** (in initMapSelect): `onMapSelectChange` — syncs `fullMapData` from `__mapToolData` if needed, updates image via `getMapImageSrc`, `switchToMap(id)`, checkboxes. Assigned to `window.__mapToolChangeMap` and also attached via `addEventListener` and `select.onchange`.
- **window.__mapToolSwitchToMap** is set to `switchToMap` in initMapSelect so the early handler can trigger a full switch when the main script has run.

### getMapImageSrc(id)
- Uses `mapImagePaths[id]` (injected) with `mapImagePathForUrl`; else looks up `ALL_MAPS` by id and returns `/maps/Map_<Name>.gif`; else `/maps/Map_Mos Eisley Outskirts.gif`.

### Takeaways
- Dropdown “does nothing” if: (1) main script throws before initMapSelect (handler stays early-only; we now still call `__mapToolSwitchToMap` when set), or (2) page opened from `file://` (no data, image path wrong). Status line now shows “Loaded N map(s) from server” when injection worked, and “Map data parse error: …” if JSON.parse fails.

---

## 4. switchToMap, loadMapIntoState, terrain draw

### switchToMap(id)
- If `fullMapData.maps` is empty but `window.__mapToolData.maps` exists, sets `fullMapData = window.__mapToolData`.
- Reads `mapData = fullMapData.maps[id]`. If present: `syncDeploymentZoneState`, `syncMissionTokenState`, `updateMissionNameInputs`, **loadMapIntoState(mapData)**, **initGridFromSpaces()**, then `draw()` and status update. If absent: status message, state reset, numCols/numRows = 0.

### loadMapIntoState(mapData)
- Normalizes terrain keys to **lowercase** and sets `state.terrain`, `state.spaces`, adjacency, edges, offMap, exterior, etc. So `draw()` can use `state.terrain[coordKey(c,r)]` (coordKey is already lowercase).

### initGridFromSpaces()
- Builds `numCols`/`numRows` from `state.spaces`, sets `state.offMap`, resizes overlay, calls `draw()`.

### draw()
- Uses `state.terrain[k]` (k = coordKey(c,r), lowercase). Difficult = blue, blocking = red, exterior = green. So terrain shows if state was filled by loadMapIntoState and draw() runs after initGridFromSpaces.

### Takeaways
- Terrain is missing only if: (1) `fullMapData.maps` (or __mapToolData.maps) is empty, or (2) main script never reaches `switchToMap` (e.g. throws earlier), or (3) parse error on injected map-spaces. Status line and diagnostic help distinguish these.

---

## 5. Mission data

### Source
- **fullMissionCardsData** from `#mission-cards-data` (injected) plus localStorage merge. **Server now injects** `data/mission-cards.json` when it exists.
- **updateMissionNameInputs(mapId)** reads `fullMissionCardsData.maps[mapId]` (or `__mapToolMissionCards.maps[mapId]`) and sets mission name/token label/effects and mission card image.

### When it runs
- On **switchToMap(id)** and again after a short timeout. So if mission-cards are injected, mission names and card image should appear for the selected map.

### Takeaways
- Mission data was empty because server never injected mission-cards. Now injected when `data/mission-cards.json` exists. Deployment-zones and map-tokens are also injected when their files exist.

---

## 6. Fixes applied (this audit)

1. **Server:** Inject **real** `data/map-spaces.json` when the file exists (was always injecting empty).
2. **Server:** Inject **real** `data/mission-cards.json` when it exists.
3. **Server:** Inject **real** `data/deployment-zones.json` and `data/map-tokens.json` when they exist.
4. **HTML:** Early `__mapToolChangeMap` now calls `window.__mapToolSwitchToMap(id)` when defined so dropdown change still triggers full switch if main script ran.
5. **HTML:** `window.__mapToolSwitchToMap = switchToMap` set in initMapSelect.
6. **HTML:** After parsing injected map-spaces, status shows “Loaded N map(s) from server” or “Map data parse error: …” for easier debugging.

---

## 7. How to verify

1. Restart map-tool server: `npm run map-tool`.
2. Open **http://127.0.0.1:3457/** (not file://). Hard refresh (Ctrl+F5).
3. Status should show “Loaded N map(s) from server” then “Editing: &lt;map name&gt; (X spaces).”
4. Terrain overlay and mission names/card should appear for the selected map.
5. Changing the map in the dropdown should update image, grid, terrain, and mission panel.
6. If something fails: open with `?diagnostic=1` or triple-click status; check console for errors.
