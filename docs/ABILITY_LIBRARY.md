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

### Implemented CC effects

**Draw N cards**

- In `ability-library.json`, add `"Card Name": { "type": "ccEffect", "label": "Draw 1 Command card", "draw": 1 }` (use `draw`: 2, 3, etc. for multi-draw).

**Conditional draw (drawIfTrait)**

- Add `"drawIfTrait": "LEADER"` (or other trait) to only draw when the figure has that trait. Uses combat context (attacker during attack) or dcMessageMeta (during activation). Example: **Officer's Training** — draws 1 only if the attacking figure is a LEADER.

**+N MP (fixed bonus)**

- Add `"mpBonus": N` — e.g. Fleet Footed (+1 MP), Force Rush (+2 MP). Requires active activation (`dcMessageMeta`, `findActiveActivationMsgId`).

**Speed + N MP**

- Add `"mpBonusFromSpeed": N` — MP gained = DC's Speed + N (e.g. Urgency: Speed+2). Requires active activation. Uses `getStatsForDc(meta.dcName)` for speed lookup.

**Focus**

- `abilityId === "Focus"` — applies Focus condition to all figures in the active DC.
- `resolveAbility` will mutate `game.player1CcDeck` / `player2CcDeck` and hand, return `{ applied: true, drewCards: [...] }`. The CC handler refreshes the hand message and logs the draw.
**Power Token gain (powerTokenGain)**

- Add `"powerTokenGain": 1` (or 2) — give Power Token(s) to activating figure. Optional `powerTokenGainIfDamagedGte: { "3": 2 }` — if figure has suffered ≥3 damage, give 2 instead.
- Example: **Battle Scars** — 1 token normally, 2 if suffered 3+ damage.

**Focus to figures (focusGainToUpToNFigures)**

- Add `"focusGainToUpToNFigures": 3` with `vpCondition: { opponentHasAtLeastMore: 8 }` — end of round; if opponent has ≥8 more VPs, apply Focus to up to N of your figures. Auto when you have ≤N figures; manual when >N (choose which).
- Example: **Against the Odds**.

- Example cards in library: **There is Another** (draw 1), **Planning** (draw 2), **Black Market Prices** (draw 2), **Forbidden Knowledge** (draw 1), **Officer's Training** (draw 1 if LEADER), **Fool Me Once** (draw 1 if SPY), **Fleet Footed** (+1 MP), **Force Rush** (+2 MP), **Heart of Freedom** (+2 MP), **Apex Predator** (+2 MP), **Price of Glory** (+2 MP), **Worth Every Credit** (+2 MP), **Rank and File** (+1 MP; adjacent TROOPERS manual), **Urgency** (Speed+2 MP), **Focus** (become Focused), **Battle Scars** (Power Token gain), **Against the Odds** (Focus up to 3 if VP condition met).

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

## Power Tokens (consolidated rules reference)

From **docs/RULES_REFERENCE.md** and **docs/consolidated-rules-raw.txt**:

- **Types:** Surge (surge), Damage/Hit, Evade, Block. Wild (player chooses any).
- **Spending:** When a figure declares an attack or is declared as target, it may spend 1 Power Token to apply +1 of the symbol to attack results. Attacker cannot spend Block or Evade; defender cannot spend Hit or Surge.
- **Max 2 per figure.** If a figure would gain more than 2, its player must choose tokens to discard until the figure has 2.
- **Max 1 spent per attack.**

**Status:** Power Token **tracking and display** are implemented. `game.figurePowerTokens[figureKey]` stores tokens; map shows them on figures. **Gaining** via CC (Battle Scars) is automated. **Spending** during combat (attacker/defender restrictions) is not yet wired — resolve manually.

---

## Progress (~6% of CCs auto; ~90% of those with abilityId)

- **Surge:** 100% — all surge abilities resolved.
- **CC effects:** 298 total; 20 have abilityId; ~18 fully or partially automated.
- **CCs with automation:** Draw (4), conditional draw (2), MP bonus (8), Focus (2), Power Token gain (1), Against the Odds (1).

Phase 2 next: add more `type` values and branches in `resolveAbility` (e.g. more CC “draw N” effects, DC specials by name) so more effects run automatically instead of showing "Resolve manually".
