# Architecture & Current State — IACP Skirmish Async

**Last verified:** 2026-02-22 (full code audit)

---

## 1. Module layout

| Layer | Location | Notes |
|-------|----------|-------|
| Entry / Discord | `index.js` (~5,405 lines) | Client setup, event listeners, context building, manual if-chain dispatch. Imports all handlers from `src/handlers/index.js`. |
| Game state | `src/game-state.js` | `games` Map, `dcMessageMeta`, `dcExhaustedState`, `dcDepletedState`, `dcHealthState`, `pendingIllegalSquad`. Exports `getGame`, `setGame`, `saveGames`, `loadGames`, `deleteGame`. DB + file persistence. `CURRENT_GAME_VERSION = 1`, `migrateGame()` runs on load. |
| Data loading | `src/data-loader.js` | All JSON load + `reloadGameData`. Exports `getDcStats`*, `getDcEffects`, `getDcKeywords`, `getMapSpaces`, `getDiceData`, `getCcEffect`, `getAbilityLibrary`, `getTournamentRotation`, `getMissionRules`, `isCcAttachment`, `isExteriorSpace`, etc. *Note: `getPlayReadyMaps()` lives in index.js (~line 1117), not here. |
| Router | `src/router.js` | `getHandlerKey(customId, type)` maps to a prefix string. 86 button + 2 modal + 8 select prefixes. index.js uses this to identify the key, then dispatches via manual if-chain. The `getHandler()` registry exists but is not used by index.js. |
| Handlers | `src/handlers/` (15 files) | activation, botmenu, cc-hand, combat, dc-play-area, fast-forward, game-tools, interact, lobby, movement, requests, round, setup, special, index. **`src/handlers/index.js`** is the barrel: imports, re-exports, and registers all handlers. When adding a new handler, update all 3 places there. |
| Game logic | `src/game/` (8 files) | `abilities.js`, `combat.js`, `movement.js`, `cc-timing.js`, `coords.js`, `validation.js`, `mission-rules.js`, `index.js` (re-export hub). No Discord calls. |
| Discord helpers | `src/discord/` (4 files) | `components.js` (button/row builders), `embeds.js`, `messages.js` (logGameAction, phase headers), `index.js` (re-export). |
| Persistence | `src/db.js` | PostgreSQL (via `DATABASE_URL`) or file-based (`data/games-state.json`). `initDb()` creates `games` + `completed_games` tables and indexes. `insertCompletedGame(game)` called from `postGameOver()` in index.js when DB is configured. |
| Error handling | `src/error-handling.js` | `isRetryableDiscordError`, `withDiscordRetry` (3 attempts, exponential backoff), `replyOrFollowUpWithRetry`. |

---

## 2. Data files

| File | Entries | Description |
|------|---------|-------------|
| `data/cc-effects.json` | 289 | CC metadata: cost, timing, playableBy, abilityId |
| `data/ability-library.json` | 333 total | 289 ccEffect + 12 dcSpecial + ~32 surge abilities. All ccEffect entries have `wiredStatus`. |
| `data/dc-effects.json` | 237 | DC text, keywords, cost, attachment flag, affiliation |
| `data/dc-images.json` | 228 | DC image path map |
| `data/figure-images.json` | 174 | Figure/companion image paths |
| `data/figure-sizes.json` | 174 | Base size per DC for map rendering |
| `data/map-registry.json` | 54 | All maps from Vassal module (grid config, image path) |
| `data/map-spaces.json` | 6 | Playable spaces + adjacency per play-ready map |
| `data/deployment-zones.json` | 6 | Red/blue zones per play-ready map |
| `data/map-tokens.json` | 6 | Token positions per mission variant |
| `data/mission-cards.json` | 6 | Mission rules per map (variants a/b), token mechanics, interaction labels |
| `data/dice.json` | 6 | Attack/defense die face definitions |
| `data/tournament-rotation.json` | 3 | Current rotation mission IDs (e.g. `corellian-underground:a`) |
| `data/loadout-cards.json` | 3 | IACP Purge Trooper Elite loadout options |
| `data/token-images.json` | 12 | Condition/token image paths |
| `data/test-scenarios.json` | — | CC test scenario definitions (template structure) |
| `data/cc-name-aliases.json` | 0 | Empty — not in use |
| `data/dc-specials-reference.md` | — | Stale template; references non-existent `dc-stats.json`. Ignore. |

**Note:** `dc-stats.json` does not exist. `scripts/audit-dc-stats.js` references it but the bot runtime does not depend on it. DC figure counts and special names live in `dc-effects.json`.

---

## 3. Play-ready maps (6 total)

All 6 maps have full `map-spaces.json` + `deployment-zones.json` data and appear in `getPlayReadyMaps()`:

1. `mos-eisley-outskirts`
2. `corellian-underground`
3. `chopper-base-atollon`
4. `lothal-wastes`
5. `development-facility`
6. `devaron-garrison`

Each map has mission variants `a` and `b` defined in `mission-cards.json`.

---

## 4. Feature implementation status (verified)

### Fully implemented ✅

| Feature | Where |
|---------|-------|
| Setup (lobby, map select, deploy, squads) | `src/handlers/lobby.js`, `setup.js` |
| Rounds (start/end, activation count, both-ready gate) | `src/handlers/round.js`, `src/game/mission-rules.js` |
| DC activations (activate, exhaust, thread, action buttons) | `src/handlers/activation.js`, `dc-play-area.js` |
| Movement (BFS pathfinding, MP bank, diagonal corner-cut rule) | `src/game/movement.js`, `src/handlers/movement.js` |
| Attack (declare target, LOS soft warn, roll dice, surge buttons, damage, VP, defeat) | `src/handlers/combat.js`, `src/game/combat.js` |
| Blast (adjacent figure detection, damage application) | `src/game/movement.js:95-131`, `src/handlers/combat.js` |
| Cleave (target button, damage application, defeat + VP) | `src/handlers/combat.js:718-811` |
| Stun condition (replaces damage) | `src/game/combat.js:165-167` |
| Weaken condition (reduces damage/block by 1) | `src/game/combat.js:151-162` |
| Reach keyword (melee range extended to 2) | `src/handlers/dc-play-area.js:867-871` |
| Conditions stored and displayed on DC embed | `game.figureConditions[figureKey]` |
| CC play (hand flow): timing enforced, negation, choice dialogs | `src/handlers/cc-hand.js`, `src/game/cc-timing.js` |
| CC play from DC thread: Special Action (1 action), EoA, Double Action (2 actions) | `src/handlers/dc-play-area.js` |
| CC automation (288 wired, 1 unwired/informational) | `src/game/abilities.js`, `data/ability-library.json` |
| CC timing (60 unique timing values, all handled) | `src/game/cc-timing.js` |
| Win/loss (40 VP or elimination) | `index.js postGameOver()` |
| Multi-figure defeat (health state, figurePositions removal, VP) | `src/handlers/combat.js`, `src/game-state.js` |
| Interact (mission tokens: contraband, launch panels, doors) | `src/handlers/interact.js` |
| Power Token tracking + display on map | `game.figurePowerTokens[figureKey]`, `index.js` |
| Undo (pass_turn, move, deploy_pick, interact, cc_play, cc_play_dc) | `src/handlers/game-tools.js:71-252` |
| Map selection menu (Random, Competitive, Select Draw, Selection) | `src/handlers/setup.js` |
| Tournament rotation (Competitive draw from `tournament-rotation.json`) | `data/tournament-rotation.json`, `src/data-loader.js` |
| Archive / Kill Game (via /botmenu) | `src/handlers/botmenu.js` |
| Game state versioning + migration on load | `src/game-state.js` |
| Completed games schema (stats-ready DB rows on game end) | `src/db.js insertCompletedGame()`, `index.js:2223` |
| Error handling (retry, ephemeral fallback) | `src/error-handling.js` |
| Test suite (148 tests, node --test) | `src/game/*.test.js` |
| DC Special button → resolveAbility → manual fallback | `src/handlers/dc-play-area.js:999-1005` |

### Partially implemented ⚠️

| Feature | Status | Notes |
|---------|--------|-------|
| **Bleed condition** | Parsed, not applied | Added to `game.figureConditions` and displayed. No combat math effect. Honor system. |
| **Hide condition** | Parsed, not applied | Same as Bleed. |
| **Focus condition (via CC)** | Stored, not applied in combat | `applyFocus: true` in library adds to figureConditions. No die bonus applied during rolls. |
| **Power Token spending** | Tracked, not enforced | `game.figurePowerTokens` counts tokens; no code deducts them during combat or ability use. Honor system. |
| **DC Specials wiring** | 7 DCs / 12 library entries | Only 7 DCs have `specialAbilityIds` in dc-effects.json (Vader, Luke, etc.). All others produce a synthetic id → `resolveAbility` → "Resolve manually" message. |
| **Cal's Buddy** (1 CC) | Informational only | `wiredStatus: unwired`. Posts instructions; BD-1 deploy + activation tracking requires manual play. |

### Not implemented / out of scope

- Stat tracking UI and aggregation (DB rows exist; display layer not built)
- Multi-server / multi-guild support

---

## 5. CC automation details

- **289 total CCs** in `cc-effects.json`
- **ability-library.json** has 289 ccEffect entries — all have `wiredStatus` defined
  - 288 `wired` — fully automated or informational with logMessage
  - 1 `unwired` — Cal's Buddy (manual, no automation)
  - 0 `partial`
- **60 unique timing values** in cc-effects.json — all 60 handled in `cc-timing.js`
  - 58 handled via explicit switch cases
  - 2 (`specialaction`, `doubleactionspecial`) blocked upfront via `SPECIAL_ACTION_TIMING` set — must be played from DC thread, not hand
- **doubleActionSpecial play path**: `dc_cc_double_` button in DC thread, deducts both actions (sets remaining = 0)

---

## 6. Maintainer tools

| Tool | Location | Purpose |
|------|----------|---------|
| CC Effect Editor | `scripts/cc-effect-editor.html` + `cc-review-server.js` (port 3456) | Edit CC metadata and ability library |
| DC Effect Editor | `scripts/dc-effect-editor.html` + same server | Edit DC data |
| Tournament Rotation Tool | `scripts/tournament-rotation-tool.html` | Edit `data/tournament-rotation.json` |
| Map Spaces Extractor | `vassal_extracted/images/extract-map-spaces.html` | Extract playable spaces from Vassal map images |
| Deployment Zone Extractor | `scripts/extract-deployment-zones.html` | Mark red/blue zones on map images |
| Map Token Extractor | `vassal_extracted/images/extract-map-tokens.html` | Extract token positions from mission images |
| Set wiredStatus | `scripts/set-cc-wired-status.js` | Recompute wiredStatus from heuristics + test-scenarios |
| Build rules reference | `scripts/build-rules-reference.js` | Regenerates `docs/RULES_REFERENCE.md` |
