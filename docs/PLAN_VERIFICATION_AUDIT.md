# Plan Verification Audit

**Date:** 2026-02-16  
**Purpose:** Double-check that items marked "Done" in ARCHITECTURE_AND_PLAN.md are present in code, and confirm upcoming steps (F8, D1/D2) remain feasible after recent changes.

---

## 1. Section 0 / Phase 1 (A1–A8) — Verified

| ID | Claim | Verification |
|----|--------|---------------|
| A1 | Game state in `src/game-state.js` | **OK.** `index.js` imports `getGame`, `setGame`, `saveGames`, `dcMessageMeta`, `dcHealthState`, etc. from `./src/game-state.js`. State lives in game-state; index uses it. |
| A2 | Data loading in `src/data-loader.js` | **OK.** index imports `getDcStats`, `getMapSpaces`, `getDeploymentZones`, `getTournamentRotation`, `isExteriorSpace`, etc. from data-loader. |
| A3 | Router in `src/router.js` | **OK.** `getHandlerKey(customId, type)` exists; BUTTON_PREFIXES, MODAL_PREFIXES, SELECT_PREFIXES include all expected prefixes (cleave_target_, combat_resolve_ready_, botmenu_*, etc.). |
| A4 | Handlers in `src/handlers/*` | **OK.** handlers/index.js registers all handlers; lobby, setup, activation, combat, round, movement, interact, cc-hand, dc-play-area, game-tools, botmenu, special, requests. `cleave_target_` extracted to handlers/combat.js. |
| A5 | Game logic in `src/game/*` | **OK.** game/index.js exports from coords, movement, combat, validation, abilities, cc-timing. |
| A6 | Discord helpers in `src/discord/*` | **OK.** embeds.js, messages.js, components.js exist; index imports from discord. |
| A7 | Test suite | **OK.** `src/game/*.test.js` (abilities, combat, validation, movement, coords); `npm test` runs them. |
| A8 | Error-handling in `src/error-handling.js` | **OK.** `isRetryableDiscordError`, `withDiscordRetry`, `replyOrFollowUpWithRetry`, `DISCORD_RETRY_EXHAUSTED_MESSAGE` exported and used. |

**Outdated in plan:** §1.1 "Game state \| index.js" and "Data load \| index.js" describe the *pre-refactor* layout. §0 is correct: state and data are in game-state.js and data-loader.js.

---

## 2. Phase 2 Features (F1–F17, D3, DB2–DB5) — Verified

| ID | Claim | Verification |
|----|--------|---------------|
| F1 | Ability library scaffold | **OK.** `data/ability-library.json` and `src/game/abilities.js`: `getAbility`, `resolveSurgeAbility`, `getSurgeAbilityLabel`, `resolveAbility`. |
| F2 | Surge wired to library | **OK.** combat.js and index pass `resolveSurgeAbility`, `getSurgeAbilityLabel` (and `getAbility`) in context; surge step uses them. |
| F3 | DC specials → resolveAbility | **OK.** dc-play-area.js calls `resolveAbility(abilityId, { game, msgId, meta, ... })`; manual fallback when not in library. |
| F4 | CC effects → resolveAbility | **OK.** cc-hand.js (handleCcPlaySelect, handleCcPlay from DC) calls `resolveAbility(card, ctx)`; logs "Resolve manually" when not applied. |
| F5 | CC timing | **OK.** `docs/CC_TIMING.md` exists. `src/game/cc-timing.js`: `getCcPlayContext`, `isCcPlayableNow`, `getPlayableCcFromHand`, `isCcPlayLegalByRestriction`. Hand Play uses `getPlayableCcFromHand`; Play Select validates with `isCcPlayableNow`. |
| F6 | Conditions, Recover, Blast, Cleave | **OK.** `game.figureConditions[figureKey]` set in resolveCombatAfterRolls; Recover/Blast/Cleave applied; Cleave: buttons in thread, `cleave_target_` in index applies damage, defeat, embed refresh, activation decrement. |
| F7 | Multi-figure defeat | **OK.** resolveCombatAfterRolls: updates dcHealthState and dcList[idx].healthState, deletes from figurePositions, refresh embeds + board; isGroupDefeated uses figurePositions; activations decremented when group wiped before activating. |
| F8 | Map data for all maps | **Not done (content).** Code is ready: `getPlayReadyMaps()` requires deployment zones + map-spaces (spaces or adjacency) + playReady. Adding map-spaces per map via map tool will add maps to the playable set. |
| F9 | Interior/exterior | **OK.** data-loader: `isExteriorSpace(mapSpaces, coord)`; map-spaces may have `exterior: { coord: true }`; map tool has Exterior mode. |
| F10 | Ready to resolve rolls | **OK.** combat_resolve_ready_ handler; sendReadyToResolveRolls in combat.js; resolveCombatAfterRolls called on click. |
| F11 | Archive via /botmenu | **OK.** botmenu.js: Archive, "Are you sure?" Yes/No; on Yes, delete category/channels, remove from games and DB. |
| F12 | Mission B (Contraband) | **OK.** interact.js: retrieve_contraband option, game.figureContraband; round.js / mission-rules: vpPerContrabandInDeploymentZone, figureContraband. |
| F13 | Multi-surge abilities | **OK.** ability-library surgeCost; combat filters by cost, deducts N, shows "Spend N surge". |
| F14 | Undo scope | **OK.** game-tools.js: undo for move, deploy_pick, pass_turn, interact, CC play (hand + DC). |
| F15 | Discord limits | **OK.** components.js: truncateLabel(80); row caps (5 per row) in move/deploy/activate/cleave/surge. |
| F16 | Kill/Archive permissions | **OK.** botmenu: Kill and Archive only via /botmenu; Kill restricted to participants or Admin/Bothelpers. |
| F17 | Map Selection menu | **OK.** setup.js: buildPlayableMissionOptions(getPlayReadyMaps, getMissionCardsData); Random, Competitive (getTournamentRotation), Select Draw, Selection. |
| D3 | Validate critical JSON | **OK.** data-loader: `validateCriticalData()` after load; validates dc-effects, dc-stats, map-spaces, ability-library, cc-effects, map-registry, deployment-zones, dice; throws in NODE_ENV=development. |
| DB2 | completed_games on game end | **OK.** db.js: insertCompletedGame(game); index postGameOver sets game.ended then calls insertCompletedGame(game). |
| DB3 | Indexes | **OK.** initDb: idx_games_updated_at, idx_games_ended. |
| DB4 | Game versioning | **OK.** game-state.js: CURRENT_GAME_VERSION, migrateGame(g); loadGames calls migrateGame on each loaded game. |
| DB5 | Save optimization | **OK.** db.js: save only deletes rows for games not in memory; upserts the rest. |

---

## 3. Upcoming Steps — Compatibility Check

### F8 (Map data for all maps in use)

- **Code:** `getPlayReadyMaps()` (index.js) filters by: deployment zones (red + blue), `getMapSpaces(m.id)` with `playReady !== false`, and (spaces.length > 0 or adjacency has keys). No code change needed; adding map-spaces (and deployment zones) per map via the map tool is sufficient.
- **Recent changes:** Map tool now uses double-newline for mission effect list separation; mission-cards.json still stores one string per timing (setup, persistent, etc.). F8 does not depend on mission-cards structure. **Compatible.**

### D1 / D2 (Migrate DC/CC to reference ability ids)

- **Current:** DCs use `surgeAbilities` array of keys; CCs use card name as id for resolveAbility. ability-library has abilities by id; resolveAbility(abilityId, context) looks up by id.
- **Migration path:** Add optional `abilityId` (or similar) to dc-effects entries and cc-effects entries; in code, prefer abilityId over legacy text when resolving. resolveAbility already takes an id; getAbility(id) works. No structural change required—add id refs alongside existing fields. **Compatible.**

### Mission effects (map tool) and game

- **Map tool change:** Mission timing effects (setup, persistent, startOfRound, endOfRound) are stored as one string per key; multiple effects are newline-separated (double-newline between effects). Saved to mission-cards.json as before.
- **Game use:** mission-rules.js and round.js use `getMissionRules(mapId, variant)` which returns the **rules** object (e.g. endOfRound, startOfRound as structured effect types), not the free-text setup/persistent strings. The bot does not parse the free-text effect strings for game logic. So the map tool’s double-newline format does not affect the game. **Compatible.**

---

## 4. Summary

- **Phase 1 (A1–A8):** All verified. Only discrepancy: §1.1 describes old layout; §0 is correct.
- **Phase 2 done items:** All verified in code. `cleave_target_` extracted to handlers/combat.js.
- **F8:** No code blocker; add map-spaces (and zones) per map.
- **D1/D2:** Code supports ability ids; migration can add ids to data without breaking current behavior.
- **Map tool mission effects:** Format change (double-newline) does not affect bot; mission-cards.json remains one string per timing key.

**Recommendation:** Update ARCHITECTURE_AND_PLAN.md §1.1 to state that game state and data load live in `src/game-state.js` and `src/data-loader.js` (index imports from them).
