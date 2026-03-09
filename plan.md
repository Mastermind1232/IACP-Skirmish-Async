# Plan: Two-Tier Dropdown Picker for Button Overflow

## Problem
When there are >25 valid buttons (Discord's 5 rows × 5 buttons limit), buttons are silently dropped. The minimap shows all valid cells, but the actual buttons don't match. This affects:

1. **`getSpaceChoiceRows`** — 9 call sites (Overwatch, Pounce, Rush, Orbital Bombardment, CC space picks, indirect fire)
2. **`buildLetterRows`** — 3 call sites in movement.js (callers slice to 4 rows = 20 max column letters; development-facility has 26)

Already handled: deployment (row picker), cleave/fighting knife (can't physically exceed 25).

## Approach: Generic Row-Picker Dropdown

Create a reusable `buildRowPickerDropdown` in `components.js` that any context can use. When total buttons > threshold, show a StringSelectMenu dropdown of "Row N (X spaces)" options instead of direct buttons. After selection, show the spaces for that row as buttons + a "Back" nav button.

## Implementation Steps

### Step 1: New component helper in `components.js`

Add `buildRowPickerSelect(customIdPrefix, validSpaces, mapSpaces)`:
- Groups spaces by map row (same logic as `getSpaceChoiceRows`)
- Returns a `StringSelectMenuBuilder` with options like `{ label: "Row 5 (3 spaces)", value: "5" }`
- Up to 25 options (Discord select menu limit)
- Caller wraps in ActionRowBuilder and adds nav buttons in remaining rows

### Step 2: Modify `getSpaceChoiceRows` to signal overflow

Add a boolean `overflowed` to the return value: `{ rows, available, overflowed }`.
- `overflowed = true` when `rows` was truncated (pre-slice length > maxRows)
- All 9 callers can check this to decide whether to use the dropdown instead

### Step 3: New generic handler for row-picker select menu interactions

**Pattern:** `space_row_pick_{context}_{...params}_{rowNum}`

But each context (overwatch, pounce, rush, OB, CC, movement) has different customId shapes and different follow-up logic. Rather than one mega-handler, we add a thin select menu handler per context that:
1. Extracts the selected row number from `interaction.values[0]`
2. Filters the valid spaces to just that row
3. Builds space buttons for that row (≤25 per row is guaranteed — map rows don't have >25 columns)
4. Adds a "Back to Rows" button that re-shows the dropdown

### Step 4: Context-specific changes

#### 4a. Movement letter picker (`buildLetterRows` callers)
- In `dc-play-area.js:1300` and `movement.js:335,715`: When `buildLetterRows` returns >4 rows, use a dropdown instead
- New component: `buildLetterPickerSelect(cells, msgId, figureIndex)` — dropdown of column letters
- New select prefix: `move_letter_select_` → handler extracts letter, shows cells (reuses existing `handleMoveLetter` logic)
- New router entry in `SELECT_PREFIXES`

#### 4b. Overwatch space pick (`dc-play-area.js:1774`)
- Check `overflowed` from `getSpaceChoiceRows`
- If overflowed: show `buildRowPickerSelect` with prefix `overwatch_row_select_{gameId}_{msgId}_`
- New handler: on row select → filter spaces to that row → show buttons + back button
- New router entries: `overwatch_row_select_` in SELECT_PREFIXES, `overwatch_row_back_` in BUTTON_PREFIXES

#### 4c. Pounce space pick (`dc-play-area.js:1832, 2017`)
- Same pattern as overwatch
- Prefix: `pounce_row_select_{gameId}_{msgId}_{figureIndex}_`

#### 4d. CC space pick (`cc-hand.js:412, 754`)
- Prefix: `cc_row_select_{gameId}_`

#### 4e. Indirect fire (`dc-play-area.js:2328`)
- Prefix: dynamic, mirrors existing prefix pattern

#### 4f. Rush push (`dc-play-area.js:2552`)
- Prefix: `rush_row_select_{gameId}_{msgId}_`

#### 4g. Orbital Bombardment (`dc-play-area.js:2680, 2717`)
- Prefix: `ob_row_select_{gameId}_{msgId}_`

### Step 5: Router updates (`router.js`)
- Add all new select prefixes to `SELECT_PREFIXES`
- Add all new "back" button prefixes to `BUTTON_PREFIXES`

### Step 6: Dispatch updates (`index.js`)
- Add handler dispatch for each new select prefix
- Add handler dispatch for each new "back" button prefix

## Alternative considered: Single generic handler
Could use one `space_row_select_` prefix and encode the "context" in the customId. Pros: less routing boilerplate. Cons: the handler needs to know what to do after row selection (each context has different follow-up behavior — some edit the message, some follow up, some need to pass through to existing handlers). Per-context handlers are safer and match the existing codebase pattern.

## Simplification opportunity
Many of these contexts (overwatch, pounce, rush, OB, CC) follow the exact same pattern:
1. Show dropdown of rows
2. On select: show space buttons for that row + back button
3. On back: re-show dropdown

We can extract this into a **shared helper** that takes a config object:
```js
{ customIdPrefix, spacesGetter, backPrefix, messageContent }
```
This reduces the per-context handler to ~5 lines of config + calling the shared helper.

## Files to modify
- `src/discord/components.js` — new `buildRowPickerSelect`, modify `getSpaceChoiceRows` return
- `src/router.js` — new prefixes
- `src/handlers/movement.js` — letter picker dropdown fallback
- `src/handlers/dc-play-area.js` — overwatch, pounce, indirect fire, rush, OB overflow handling + new handlers
- `src/handlers/cc-hand.js` — CC space overflow handling + new handler
- `index.js` — dispatch for new handlers
