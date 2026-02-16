# Map Tool UI — Comprehensive Audit

## Purpose

This document records the audit of the map-tool UI (Vassal map spaces extractor) and the fixes applied to make the dropdown and overall UI reliable and debuggable.

---

## 1. Load order and script execution

### Flow

1. **HTML** is served (with injected JSON when using `npm run map-tool`).
2. **Body** is parsed: toolbar (with empty `<select id="mapSelect">`), color key, container (map img + overlay), mission panel, then **injected script tags** (map-spaces-data, map-image-paths, etc.), then the **main script**.
3. **Main script** runs synchronously:
   - Reads injected data via `getElementById` + `JSON.parse`.
   - Defines `ALL_MAPS`, runs `ensureMapDropdownPopulated()` (flat list of options).
   - Defines many functions, then **`initMapSelect()`** which calls `refreshMapSelectOptions()` (clears select, rebuilds with optgroups) and wires dropdown/map/status.
   - Kicks off optional **fetch** for `map-spaces.json` if no data was injected.
4. **Fallback script** (at end of body) runs: if `mapSelect.options.length === 0`, fills it with a short fallback list.

### What can go wrong

- **Script error before `ensureMapDropdownPopulated`**  
  Any throw (e.g. bad injected JSON, missing element) prevents the dropdown from being filled. The **global `onerror`** handler now fills the dropdown with a fallback list and stores the error for the diagnostic.

- **Script error inside `refreshMapSelectOptions` or `initMapSelect`**  
  If we already cleared the select in `refreshMapSelectOptions` and then throw, the dropdown can be left empty. **`refreshMapSelectOptions`** is now wrapped in try/catch and only clears the select after building a fragment; on catch it fills the select with a flat list if it’s empty.

- **Dropdown covered or unclickable**  
  Overlay has `z-index: 1`. Toolbar/left-column had no z-index, so in some stacking contexts the overlay could sit on top. **CSS** was updated so `.left-column` and `.toolbar` use `position: relative; z-index: 5` so they stay above the overlay.

---

## 2. Injected data and escaping

- **Problem**  
  Injected JSON (e.g. `map-spaces.json`) is embedded in `<script type="application/json">`. If the JSON contains a literal `</script>`, the HTML parser closes the script tag and the rest of the document is broken, often leading to “Unexpected token” errors.

- **Fix (server)**  
  All injected JSON is passed through `escapeJsonForScript()`: replace `</script>` with `\u003C/script>`, then any remaining `<` with `\u003C`. `JSON.parse()` still decodes `\u003C` as `<`.

---

## 3. Map image 404

- **Problem**  
  Default `<img src="maps/Map_Mos Eisley Outskirts.gif">` resolves to `/maps/...` while files live under `vassal_extracted/images/maps/`.

- **Fix (server)**  
  Map-tool server serves `GET /maps/xxx` from `vassal_extracted/images/maps/xxx`.

---

## 4. Diagnostic and troubleshooting

- **Diagnostic panel**  
  - Id: `mapToolDiagnostic`.  
  - Shown when URL contains `?diagnostic=1` or when the status line is **triple‑clicked**.  
  - Shows: whether `mapSelect` exists, `mapSelect.options.length`, and any script error stored in `window.__mapToolError`.

- **How to use**  
  1. Open the map tool with `?diagnostic=1` (e.g. `http://127.0.0.1:3457/?diagnostic=1`) or triple‑click the green status line.  
  2. Check “mapSelect element”, “options count”, and “Script error”.  
  3. If options is 0 and there’s an error, the error is likely preventing init; fix that (e.g. bad data, missing element).  
  4. If options &gt; 0 but the dropdown still doesn’t open, check for CSS (overflow, visibility) or another element covering it (inspect in devtools).

---

## 5. Checklist for “dropdown still broken”

1. **Hard refresh**  
   Ctrl+Shift+R (or Cmd+Shift+R) so the page isn’t from cache.

2. **Open with diagnostic**  
   `http://127.0.0.1:3457/?diagnostic=1`  
   - If “options” is 0 and “Script error” is set → fix the reported error (injected data, missing element, or logic bug).  
   - If “options” &gt; 0 → dropdown is populated; if you still can’t open it, it’s likely layout/CSS or something covering it.

3. **Browser console**  
   F12 → Console. Note any red errors and the line/column. Those often point to the first place the script failed.

4. **Server**  
   Ensure `npm run map-tool` is running and you’re using the URL it prints (e.g. `http://127.0.0.1:3457/`). If you open the HTML via `file://` or another server, injected data and `/maps/` and `/data/` won’t work.

5. **Fallback**  
   The final script in the page runs after the main script. If the main script fails and the global `onerror` didn’t run (e.g. syntax error), the fallback script still runs and, if the dropdown has 0 options, fills it with a short list. So after load, the dropdown should have either the full list or the fallback list.

---

## 6. Mission A/B panel

- Mission name and effects are filled by **`updateMissionNameInputs(mapId)`**, called from **`switchToMap(id)`** when changing map or when **`applyMissionVariantSwitch()`** detects the target variant has no in-memory data.  
- **`fullMissionCardsData`** comes from injected `mission-cards-data` or localStorage. If the server injects mission cards, the panel should show data when a map is selected and when toggling A/B.

---

## 7. Files touched (summary)

| File | Changes |
|------|--------|
| `vassal_extracted/images/extract-map-spaces.html` | Diagnostic panel, global onerror, toolbar/left-column z-index, fallback script, triple‑click to show diagnostic, `refreshMapSelectOptions` try/catch and fallback, `initMapSelect` guards. |
| `scripts/map-tool-server.js` | Serve `/maps/xxx` from `vassal_extracted/images/maps/`, `escapeJsonForScript()` for all injected JSON, case‑insensitive path match for HTML, always inject map-spaces and map-image-paths (empty when file missing). |
| `docs/MAP_TOOL_UI_AUDIT.md` | This audit. |

---

## 8. Next steps if issues remain

- Reproduce with **?diagnostic=1**, note “options” and “Script error”, and any console errors.  
- If the dropdown has options but doesn’t open: inspect `#mapSelect` and its parents (Computed style, “pointer-events”, “overflow”, “z-index”) and check for overlapping elements.  
- If the script error points at a specific line (e.g. in injected JSON): ensure that data is valid and that the server is escaping it with `escapeJsonForScript()`.
