# Ability library (F1, F3, F4)

The bot resolves abilities from a central **ability library** (`data/ability-library.json`) and code in `src/game/abilities.js`. Surge abilities are fully wired (F2); DC specials and CC effects use the library and fall back to "Resolve manually" until implemented (F3/F4).

## Data: ability-library.json

- **Format:** `{ "source": "...", "abilities": { "id": { "type", ... } } }`.
- **Surge abilities:** `type: "surge"`, optional `surgeCost` (default 1), `label` for display. Keys match `dc-effects.json` surgeAbilities (e.g. `"damage 1"`, `"pierce 2"`, `"damage 4"` with surgeCost 2).
- **Other types (future):** `specialAction`, `passive`, `triggered`, `ccEffect` — add an entry and implement the branch in `resolveAbility()`.

## Surge (F2 — done)

- Combat uses `resolveSurgeAbility(id)` and `getSurgeAbilityLabel(id)` from context.
- Resolution: `parseSurgeEffect(id)` in `src/game/combat.js` returns damage, pierce, accuracy, conditions, blast, recover, cleave.
- To add a new surge option: add the key to `ability-library.json` with `type: "surge"` and ensure `parseSurgeEffect()` handles that key (or add a case there).

## DC specials and CC effects (F3/F4 — incremental)

- **DC Special:** Handler passes an ability id (e.g. `dc_special:DCName:0`) to `resolveAbility(id, ctx)`. If the library has a non-surge implementation, it runs; otherwise the user sees "Resolve manually: …".
- **CC play:** After a CC is played, the bot calls `resolveAbility(cardName, ctx)`. Card name is used as the library id for CCs unless we migrate to explicit ids (D2).

### Implemented CC effect: draw N cards

- In `ability-library.json`, add `"Card Name": { "type": "ccEffect", "label": "Draw 1 Command card", "draw": 1 }` (use `draw`: 2, 3, etc. for multi-draw).
- `resolveAbility` will mutate `game.player1CcDeck` / `player2CcDeck` and hand, return `{ applied: true, drewCards: [...] }`. The CC handler refreshes the hand message and logs the draw.
- Example cards in library: **There is Another** (draw 1), **Planning** (draw 2), **Black Market Prices** (draw 2), **Forbidden Knowledge** (draw 1).

### Adding a non-surge ability

1. **Add to ability-library.json**  
   Example: `"my_ability_id": { "type": "specialAction", "label": "Do X" }`.

2. **Implement in src/game/abilities.js**  
   In `resolveAbility(abilityId, context)`:
   - After the existing `if (!entry || entry.type === 'surge')` check, add a branch for your type, e.g. `if (entry.type === 'specialAction') { ... }`.
   - Use `context.game`, `context.playerNum`, etc. to apply state changes (no Discord calls; return `{ applied: true }` or `{ applied: false, manualMessage: '...' }`).
   - The handler that called `resolveAbility` is responsible for logging and Discord UI (e.g. "Resolve manually" message when `applied: false`).

3. **Wire the id from the card**  
   DC effects reference abilities via surgeAbilities or specials; CCs currently use card name as id. When you add an implementation, ensure the handler passes the same id that you added to the library.

## Files

| File | Role |
|------|------|
| `data/ability-library.json` | Id → type, label, surgeCost; add new abilities here. |
| `src/game/abilities.js` | getAbility, resolveSurgeAbility, getSurgeAbilityLabel, resolveAbility. |
| `src/game/combat.js` | parseSurgeEffect (surge modifiers). |
| DC/CC handlers | Call resolveAbility with the appropriate id and context. |

### Example: There is Another (CC — Draw 1)

- **ability-library.json:** `"There is Another": { "type": "ccEffect", "label": "Draw 1 Command card", "draw": 1 }`.
- **abilities.js:** For `ccEffect` with `draw: 1`, `drawCcCards(game, playerNum, 1)` is called; returns `{ applied: true, drewCards: [card] }`.
- **cc-hand.js:** When `resolveAbility` returns `applied: true` and `drewCards`, the handler calls `updateHandVisualMessage` and logs the drawn card(s).

Phase 2 next: add more `type` values and branches in `resolveAbility` (e.g. more CC “draw N” effects, DC specials by name) so more effects run automatically instead of showing "Resolve manually".
