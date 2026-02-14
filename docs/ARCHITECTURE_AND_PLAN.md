# Architecture & Plan — IACP Skirmish Async

**Mode: PLAN.** This doc is the single source of truth for assessing the codebase, re-architecting it, and defining what’s needed for a full game. **No implementation** of new features or refactors until this plan is agreed and we explicitly switch to build mode.

**Goal:** Imperial Assault skirmish fully playable in Discord, async, with the **bot enforcing all rules** (no honor system). Codebase is **modular, testable, and maintainable** (not monolithic).

---

## 0. Progress vs monolith (this build)

The **monolithic** problem (one huge file, hard to navigate/test/change — §1.5) is being addressed in this build as follows:

| Done | What moved out of index.js |
|------|----------------------------|
| **A1** | Game state → `src/game-state.js` (games Map, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, pendingIllegalSquad; getGame, setGame, saveGames). |
| **A2** | Data loading → `src/data-loader.js` (all JSON load, reloadGameData; getDcStats, getDcEffects, getMapSpaces, getDice, getCcEffect, etc.). |
| **A3** | Interaction router → `src/router.js` (prefix → handler key; single place to register customIds). |
| **A4** | **All interaction handlers** → `src/handlers/*` (lobby, requests, game-tools, special, interact, round, movement, combat, activation, setup, dc-play-area, cc-hand). Index no longer has 40+ if-branches; it builds context and calls the registered handler per prefix. |
| **A6** | Discord helpers → `src/discord/*`: embeds.js, messages.js, components.js (all tooltip/embed/button builders including lobby, deploy, move, DC/CC actions). Index keeps thin wrappers that pass game/data helpers where needed. |
| **A5** | Game logic → `src/game/*` (coords.js, movement.js, combat.js; validation.js; getFigureSize in data-loader). |
| **A7** | Test suite → `src/game/*.test.js`; run `npm test`. Node built-in test runner; no extra deps. |
| **A8** | Error-handling → `src/error-handling.js` (retry for Discord API, log + user message; top-level catch uses replyOrFollowUpWithRetry). |

**Still in index.js (optional later extraction):**

- **Discord/orchestration:** buildBoardMapPayload, buildDcEmbedAndFiles, updateDcActionsMessage, buildHandDisplayPayload, getCommandCardImagePath, clearPreGameSetup, runDraftRandom, getFiguresForRender, getMapTokensForRender, updateDeployPromptMessages, getDeploymentMapAttachment, and other helpers that mix Discord + game state. Target for a future pass: `src/discord/*` or dedicated modules.

So the monolith is being split by responsibility: **state**, **data**, **router**, **handlers**, **game logic**, **Discord helpers** (A6), **error-handling** (A8), **constants**, and **lobby state** are out; optional later pass can move remaining orchestration helpers from index.

**Phase 1 (A1–A8) complete.** Next: Phase 2 — ability library (F1), surge wired to library (F2), CC timing (F5), multi-figure defeat (F7), etc. See §5 Execution order.

---

## 1. Codebase assessment (current state)

### 1.1 Layout

| Layer | Where it lives | Notes |
|-------|----------------|-------|
| **Entry / Discord** | `index.js` only | Single file ~8.4k lines. Bot entry, client setup, all listeners. |
| **Game state** | `index.js` | `games` Map, `dcMessageMeta`, `dcExhaustedState`, `dcDepletedState`, `dcHealthState`, `pendingIllegalSquad` — all globals. |
| **Data load** | `index.js` (top + `reloadGameData`) | 12+ JSON files read at startup into globals: `dcImages`, `figureImages`, `dcStats`, `mapRegistry`, `deploymentZones`, `mapSpacesData`, `dcEffects`, `dcKeywords`, `diceData`, `missionCardsData`, `mapTokensData`, `ccEffectsData`. |
| **Persistence** | `src/db.js` | Load/save games; used by index. |
| **Helpers** | `index.js` | 200+ functions in one file: movement, LOS, map, combat, embeds, validation, etc. |
| **Interaction handling** | `index.js` | Single `client.on('interactionCreate')` with 40+ `if (customId.startsWith(...))` branches. Buttons, modals, selects all in one handler. |
| **Other modules** | `src/vsav-parser.js`, `src/map-renderer.js`, `src/dc-image-utils.js` | Small, focused. |

### 1.2 Data (reference only)

- **data/** — 24 JSON files: DC/CC effects, images, stats, maps, dice, missions, tokens, deployment zones, etc.
- **dc-effects.json** — Per-card ability text, surge keys, passives. No shared ability library; cards are self-contained.
- **Map data** — Only `mos-eisley-outskirts` has full space/terrain/adjacency in `map-spaces.json`; other maps have images only.

### 1.3 What works (feature-wise)

- Game create/join, map selection, initiative, deployment zones, deployment of figures.
- Round/activation flow: activations remaining, start/end of round windows.
- Per activation: Move (MP, valid spaces from map data), Attack (declare target, roll attack, roll defense, **surge spending**, resolve damage, VP, defeat), Interact (e.g. Launch Panel), Special (manual “resolve manually” + Done).
- Win/loss: 40 VP and elimination; `game.ended` set, winner announced.
- Mission A: Launch panels, VP per panel.
- LOS: soft check (warning in game log if bot thinks no LOS; attack not blocked).
- Dice: rolled by bot; attack (acc/dmg/surge) and defense (block/evade) applied.
- Surge: attacker can spend surge on DC surge abilities (buttons); damage/pierce/accuracy/conditions applied.
- DC/CC display: card images, hand, play area, exhaust/deplete; CC effect text as reminder (manual).
- Defeated groups filtered from activation list; activations decremented when group wiped before activating.

### 1.4 What’s missing or partial (for “full game + bot enforces everything”)

- **Ability system** — No central ability library. DC/CC abilities are on-card text or surge keys; named abilities (specials, passives, triggered) have no executable definition. Bot cannot “run” them.
- **CC effects** — Reminder only; no game-state changes. CC timing not enforced.
- **DC effects** — Beyond surge: passives, special actions, keywords, triggered effects not automated.
- **Maps** — Only one map with full space/terrain; movement/LOS not validated on others.
- **Interior/exterior** — Not in map data; cards that depend on it (e.g. MASSIVE) can’t be enforced.
- **Conditions** — Stun/weaken/bleed etc. shown in combat result but not tracked on figures for later rules.
- **Multi-figure defeat** — May need verification that health/positions/embeds stay in sync when one figure in a group dies.
- **Combat UX** — Optional “Ready to resolve rolls” step noted for later; not required for MVP.

### 1.5 Structural problems

- **Monolith** — One huge file; hard to navigate, test, or change safely.
- **Global state** — Games and DC state are globals; no single place that “owns” state and persistence.
- **Global data** — All card/map/dice data loaded into globals; no clear data layer.
- **No routing** — Interaction handler is one long if/else chain; adding a flow means touching the same block.
- **Mixed concerns** — Discord (reply, edit, send), game logic (hit/damage, movement), and data access all in the same functions.
- **No game “engine”** — Rules (movement, combat, abilities) live inside Discord handlers; not testable in isolation.

---

## 2. Target architecture

### 2.1 Principles

- **Layers:** Discord (UI) → Handlers (orchestration) → Game logic (rules, state transitions) → State + Data (in-memory + persistence, read-only reference data).
- **No monolith:** Split by responsibility. One main entry wires the app; domain logic lives in modules.
- **Single ownership:** Game state in one module; data load in one module; Discord only talks to handlers and state/data via clear APIs.
- **Testable core:** Movement, combat, abilities can be unit-tested without Discord.

### 2.2 Proposed structure (directories / modules)

```
index.js                    # Entry: Discord client, register routes, start bot
src/
  config.js                 # Env, root dir, paths (optional)
  data-loader.js            # Load all JSON; export getDcStats, getDcEffects, getMapSpaces, getDice, etc.
  game-state.js             # games Map, dcMessageMeta, dcHealthState, etc.; getGame, setGame, saveGames delegation
  router.js                 # interactionCreate → getHandler(customId) → handler(interaction, context)
  handlers/
    index.js                # Registers all handlers; exports route(interaction) -> handler
    lobby.js                # lobby_join_, lobby_start_
    setup.js                # map_selection_, determine_initiative_, deployment_zone_*, deployment_fig_*, deploy_pick_*, deployment_done_
    activation.js           # status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_
    dc-play-area.js         # dc_activate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_, dc_attack_, dc_interact_, dc_special_
    movement.js             # move_mp_, move_pick_, move_adjust_mp_
    combat.js               # attack_target_, combat_ready_, combat_roll_, combat_surge_
    special.js              # special_done_
    interact.js             # interact_choice_, interact_cancel_
    cc-hand.js              # cc_play_, cc_draw_, cc_discard_, cc_attach_, cc_search_discard_, cc_close_discard_, squad_modal_, deploy_modal_, etc.
    round.js                # end_end_of_round_, end_start_of_round_
    game-tools.js           # refresh_map_, refresh_all_, undo_, kill_game_, default_deck_, squad_select_
  game/
    index.js                # Re-exports or orchestrates game logic
    movement.js             # Pure movement: getReachableSpaces, getPathCost, LOS, etc. (from current index)
    combat.js               # Pure combat: resolveHit, resolveDamage, applySurgeModifiers, etc.
    abilities.js            # (Later) resolveAbility(id, context) → state delta
    validation.js           # validateDeckLegal, isFigureInDeploymentZone, etc.
  discord/
    embeds.js               # buildDcEmbedAndFiles, buildBoardMapPayload, etc.
    messages.js             # logGameAction, updateActivationsMessage, etc. (optional split)
  db.js                     # (existing) loadGamesFromDb, saveGamesToDb, initDb
  vsav-parser.js            # (existing)
  map-renderer.js           # (existing)
  dc-image-utils.js         # (existing)
data/                       # (unchanged) all JSON
scripts/                    # (unchanged) tooling, seeds, extractors
```

### 2.3 Data / ability library (target)

- **Ability library** — Code-per-ability: each ability implemented in code (`game/abilities.js`), with data (e.g. `ability-library.json`) listing ids and type (surge/special/passive/triggered) for lookup. DCs/CCs reference ability ids; bot resolves by id to the corresponding code.
- **Cards** — DC/CC data keep stats and references (e.g. `surgeAbilityIds: ["surge_damage_2", "surge_stun"]`), not full prose for execution. Optional: keep human-readable text for display only.

### 2.4 Boundaries

- **Handlers** — Only: read game from state, call game/* and data-loader, then call discord/* to send/edit messages. No direct `games.get` in game/*.
- **Game logic** — No Discord, no `client`. Receives state + context, returns new state or instructions (e.g. “apply 3 damage to figure X”).
- **State** — Only game-state.js and db.js write to `games` and related Maps. Handlers call `getGame` / `setGame`; state module calls db save.

### 2.5 Discord UI constraints and UX standards (apply to every step)

All button and embed presentation must follow Discord limits and a consistent, visually intuitive scheme. **Bake this into every implementation step** (handlers and `src/discord/*`).

**Hard limits (Discord):**
- **Buttons:** Maximum **5 buttons per ActionRow**, maximum **5 ActionRows per message** (25 buttons per message). If there are more options (e.g. attack targets, surge abilities, deployment spaces), chunk into rows of 5 and use multiple rows or pagination/select menus instead of overflowing.
- **Button styles:** Only **Primary** (blurple), **Secondary** (grey), **Success** (green), **Danger** (red), **Link** (link only). No custom colors.
- **Button label:** Max 80 characters; truncate or abbreviate so labels stay under.
- **Select menus:** Max 25 options per menu; max 5 menus per row. Use for long lists when buttons would exceed 5 per row.
- **Embeds:** Max 10 embeds per message; title/description/field lengths have limits. Keep within limits.
- **Rate limits:** 5 messages per 5 seconds per channel; avoid burst-sending; batch where possible.

**Color and area conventions (visually intuitive):**
- **Combat / attack:** Danger (red) for attack-related actions (e.g. Roll Combat Dice, Spend surge for damage); Secondary for other combat choices.
- **Destructive:** Danger for Kill Game, confirm-destroy; Secondary for cancel.
- **Primary actions / confirm:** Success (green) or Primary (blurple) for Confirm, Done, Ready, Submit, Archive game.
- **Secondary / cancel:** Secondary (grey) for Cancel, Back, No surge, optional choices.
- **Setup / neutral:** Primary or Success for Map Selection, Determine Initiative, Deploy; Secondary for alternatives.
- **Surge / abilities:** Secondary for Spend 1 surge options; Primary for Done (no more surge).
- **Movement / interact:** Secondary for movement and interact so they do not compete with attack (red) or confirm (green).

**Implementation:**
- **Centralize:** In `src/discord/*`, provide helpers that build ActionRows (e.g. chunk to max 5 per row) and map area to button style. Handlers and embeds always use these helpers so we never send invalid or inconsistent UI.
- **Review at each step:** When adding or changing any handler that sends buttons or components, check: (1) at most 5 buttons per row, (2) at most 5 rows, (3) labels at most 80 chars, (4) style matches the area convention above.

---

## 3. Full-game scope (front to back)

Definition of “full game” for this plan:

1. **Setup** — Create game, join, map select, initiative, deployment zones, deploy figures, submit squads (with validation). ✅ Done.
2. **Rounds** — Start/end of round windows, activation count, “both squads ready” → activation phase. ✅ Done.
3. **Activations** — Activate group → choose Move / Attack / Interact / Special; track actions used; exhausted/readied. ✅ Done.
4. **Movement** — MP from stats, valid spaces from map data, move figure, update position. ✅ Done for maps with data.
5. **Attack** — Declare target (LOS soft warning), pre-combat window, roll attack, roll defense, **spend surge** (buttons), resolve damage, VP, defeat, update health and board. ✅ Done (surge implemented).
6. **Interact** — Legal targets from map/mission (e.g. Launch Panel); resolve mission-specific effects. ✅ Done for Mission A.
7. **Special** — Consume action; bot runs ability by id (from ability library) or shows “resolve manually” for unimplemented abilities. ⚠️ Partial (manual only).
8. **Command cards** — Play/discard/draw; when played, bot applies effect by ability id (or reminder if not in library). ⚠️ Partial (reminder only); timing not enforced.
9. **Win/loss** — 40 VP or elimination; game ends, winner announced. ✅ Done.
10. **Maps** — Movement and LOS valid for all maps in use. ⚠️ Only one map has full data.
11. **Rules enforced by bot** — No honor system; all resolvable actions go through bot (dice, surge, abilities, movement, damage). ⚠️ Abilities (non-surge) and CCs not yet enforced.

---

## 4. Gaps and todos (consolidated)

### 4.1 Architecture (must do before or while adding features)

| ID | Item | Notes |
|----|------|-------|
| A1 | Extract game state into `src/game-state.js` | games, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, pendingIllegalSquad; getGame, setGame, persist. |
| A2 | Extract data loading into `src/data-loader.js` | All JSON load + reloadGameData; export getDcStats, getDcEffects, getMapSpaces, getDice, getCcEffect, etc. |
| A3 | Add interaction router in `index.js` | Map customId prefix → handler; one place to register; handlers receive (interaction, context). |
| A4 | Move handlers into `src/handlers/*` by domain | Lobby, setup, activation, dc-play-area, movement, combat, special, interact, cc-hand, round, game-tools. |
| A5 | Extract game logic into `src/game/*` | Movement, combat (resolve hit/damage/surge), validation; no Discord. |
| A6 | Extract Discord helpers into `src/discord/*` | Embeds, buildBoardMapPayload, logGameAction; **button/component helpers** that enforce 2.5 (max 5 per row, chunking, color-by-area). All handlers use these so UI stays within Discord limits and color scheme. |
| A7 | Add test suite and unit tests for `src/game/*` | e.g. Jest; test movement, combat, validation so refactors and ability logic are safe. Run after A5. |
| A8 | Error-handling pattern for handlers | ✅ **Done.** `src/error-handling.js`: isRetryableDiscordError, withDiscordRetry, replyOrFollowUpWithRetry. Top-level catch: log via logGameErrorToBotLogs, then reply/followUp with retry (3 attempts, exponential backoff); if retryable and exhausted, user sees "Something went wrong… try again in 2–3 minutes." Handlers: log + ephemeral message; optional withDiscordRetry for critical Discord API calls after state change. |

### 4.2 Features (full game + bot enforces everything)

| ID | Item | Notes |
|----|------|-------|
| F1 | Ability library (data + lookup) | ✅ **Scaffold done.** `data/ability-library.json` (surge abilities by id: type, surgeCost, label). `src/game/abilities.js`: getAbility(id), resolveSurgeAbility(id), getSurgeAbilityLabel(id). Resolution: code-per-ability (surge via parseSurgeEffect). DCs still use surgeAbilities array in dc-effects; ids match keys. |
| F2 | Wire surge to ability library | ✅ **Done.** Combat handler uses resolveSurgeAbility and getSurgeAbilityLabel from context; labels and modifiers go through ability library. SURGE_LABELS/parseSurgeEffect kept as fallback. |
| F3 | Wire DC specials / passives to ability library | ✅ **Scaffold done.** DC Special calls resolveAbility(id, ctx); library lookup by id (e.g. dc_special:DCName:idx); manual fallback with message. |
| F4 | Wire CC effects to ability library | ✅ **Scaffold done.** After CC play, resolveAbility(cardName, ctx); logs "CC effect: Resolve manually…" when not in library. |
| F5 | CC timing | ✅ **Done.** Documented in `docs/CC_TIMING.md`. `src/game/cc-timing.js`: getCcPlayContext, isCcPlayableNow, getPlayableCcFromHand. Hand Play filters to playable cards only; Play Select validates timing. Supported: startOfRound, duringActivation, endOfRound, duringAttack, whileDefending, whenAttackDeclaredOnYou, etc. specialAction played only from DC button. |
| F6 | Conditions and combat extras | ✅ **Done (core).** Conditions: stun/weaken/bleed applied to defender and stored in `game.figureConditions[figureKey]`. **Conditions displayed** in DC embed health section. Recover: parsed and applied (heal attacker). Blast: parsed and applied (figures adjacent to target). **Cleave:** parsed (surgeCleave) and **applied**: after hit, if surgeCleave > 0, attacker chooses one other figure **in melee** (adjacent to attacker, enemy only, excluding primary target); cleave target takes surgeCleave damage (VP, defeat, embed refresh). Discord: "Cleave (N damage): Choose one target in melee" + buttons in combat thread; `cleave_target_` handler applies damage and finishes combat. |
| F7 | Multi-figure defeat | ✅ **Verified.** resolveCombatAfterRolls updates dcHealthState and dcList[idx].healthState, removes defeated figure from figurePositions, then re-renders target DC embed from dcHealthState; board map is updated. isGroupDefeated uses figurePositions so activation count stays correct. |
| F8 | Map data for all maps in use | Extend map-spaces (or equivalent) so every map has spaces, adjacency, terrain. |
| F9 | Interior/exterior | Per-space flags stored **per map** in map data. Provide a **UI tool** (like the existing tool for difficult terrain, etc.) so the maintainer can mark which spaces are interior vs exterior on each map; tool saves to the same map data the bot uses. Required for abilities like MASSIVE. |
| F10 | Optional: “Ready to resolve rolls” | Extra confirmation step in combat; low priority. |

| F11 | Post-game archival | ✅ **Done.** Archive via **`/botmenu`** in Game Log → Bot Stuff → Archive → "Are you sure?" Yes/No. First confirm wins. On Yes: delete game category and channels, remove from `games` and DB. Ended games already have a row in `completed_games` (DB2). |
| F12 | Mission B (and other IACP missions) | ✅ **Verified.** Mission B: Retrieve Contraband (interact at contraband space), end-of-round VP for figures in deployment zone with contraband (round.js); getLegalInteractOptions includes retrieve_contraband; figureContraband tracked. |
| F13 | Multi-surge abilities | Support abilities that cost 2 (or N) surge; deduct N when chosen; show only when surge >= N. |
| F14 | Undo scope | **Multiple steps** — player can keep pressing Undo (one step per press) and go all the way back if they want. **Every** state-changing action is undoable: undo winds back the game by one state (whatever just changed). Store full history of previous states in game data so undo works after bot restart (no cap on history size). **Time-travel UX:** Undo should feel like time travel — after Undo, the Game Log (and board/hands) must look exactly as they did before the last action; remove or revert the Discord messages for the undone action so state and Discord stay in sync. Track message IDs for each action so Undo can remove/revert the correct messages. Undo is disabled once the game has ended (no un-end). |
| F15 | Discord limits and UI | ✅ **Done.** Section 2.5 enforced: `truncateLabel(s, 80)` in `src/discord/components.js`; `getMoveMpButtonRows`, `getMoveSpaceGridRows`, `getDeploySpaceGridRows`, `getActivateDcButtons` cap at 5 rows; interact choice labels use `truncateLabel`; Cleave/surge/deploy/DC actions already slice labels and rows. Centralized discord/* helpers and color-by-area scheme in use. |
| F16 | Permissions and flow for destructive actions | ✅ **Done.** **Kill Game** and **Archive** only via **`/botmenu`** in Game Log. Menu shows Archive and Kill Game; each has "Are you sure?" Yes/No (first confirm wins). Kill Game restricted to game participants or Discord roles **Admin** or **Bothelpers**. Visible Kill Game button removed from setup and Determine Initiative; `kill_game_` handler kept for legacy buttons. |
| F17 | Map Selection menu | ✅ **Done.** Map Selection button shows a select menu: **Random** (random map + A/B), **Competitive** (random from `data/tournament-rotation.json` missionIds), **Select Draw** (multi-select ≥2 missions, then random draw), **Selection** (single-select one mission). Mission options from buildPlayableMissionOptions (play-ready maps × variants). D4 rotation file committed; getTournamentRotation() in data-loader. |

### 4.3 Data / content

| ID | Item | Notes |
|----|------|-------|
| D1 | Migrate DC surge/passives/specials to reference ability ids | After F1/F2; cards hold ids, not only free text. |
| D2 | Migrate CC effects to reference ability ids | After F1/F4. |
| D3 | Validate critical JSON on load | Validate dc-effects, dc-stats, map-spaces, ability-library shape; log warnings and fail fast in dev so we don't run with bad data. |
| D4 | Tournament rotation config | **Competitive** uses a list of mission IDs (`mapId:variant`) in data (e.g. `data/tournament-rotation.json`). **Commit the file in the repo** with a default (e.g. `[]`) so the repo works out of the box and we only handle "empty or missing" as one case (show "No rotation configured"). If the file is empty or missing at runtime, show "No rotation configured" and do not pick a mission (user chooses another option). Provide an **HTML UI tool** (like the existing tools e.g. for difficult terrain) that shows (1) all playable maps + mission variants and (2) the current tournament rotation list; the tool saves edits to that same JSON file so the bot and the tool share one source of truth (100% deterministic). Maintainer updates the rotation manually every few months. |

### 4.4 Database (stats and state evolution)

| ID | Item | Notes |
|----|------|-------|
| DB2 | Stats-ready schema | Write a row to `completed_games` **in the same code path** that sets `game.ended` (synchronous insert when the game ends), so stats are captured immediately and even if the player never clicks Archive. Archive then only deletes Discord and removes the game from the `games` table. **Schema (minimum):** winner_id (nullable for draw when both eliminated), player1_id, player2_id (Discord IDs), player1_affiliation, player2_affiliation, player1_army_json, player2_army_json, map_id, mission_id (mapId:variant), deployment_zone_winner (who won zone pick), ended_at (timestamp), round_count (for average game length). Archiving a game that has **not** ended does not write to completed_games. **Stats we support (from this data):** win rate by affiliation, by DC, by deployment zone, by mission, by matchup (e.g. Imp vs Reb), first-pick impact (win rate when you won vs lost zone choice), mission popularity, games per period (from ended_at), average game length (from round_count), per-player win rate and games played (from player1_id / player2_id / winner_id). Stat UI/aggregation is later (out of scope); DB2 gives us the data. |
| DB3 | Optional indexes | e.g. on `games(updated_at)` or `(game_data->>'ended')` for "active games" queries if needed. |
| DB4 | Game state versioning | Add `game.version` (or similar); on load, run migration if version &lt; current so we can evolve state shape without breaking old saves. |
| DB5 | Save optimization (optional) | Current db.js does `DELETE FROM games` then INSERT all. Prefer: only delete rows for games no longer in the in-memory map; optional dirty-only saves for large deployments. |

### 4.5 Plan clarifications (no new work, just lock in)

- **Ability library:** **Every** ability on all DCs (and CCs) must be implemented — 100%, no subset, no priority list. Use **code-per-ability**: each ability is implemented in code (e.g. `game/abilities.js`), with data referencing ability ids for lookup; no data-only interpreter for complex logic. Rollout can be phased (e.g. surge first, then wire DC/CC). Manual fallback ("resolve manually") only until that ability is in the library.
- **Maps "in use":** Only maps that are **playable** — i.e. have mission data and full map data (spaces, terrain, adjacency) so the bot can run a game on them — are loadable. Today that is only mos-eisley-outskirts; as we add map-spaces (and optional mission entries) for more maps, they join the set. Map selection (F17) and all setup must only offer or allow these playable maps. When implementing F17, filter missions by **both** deployment zones and map-spaces (code today uses getPlayReadyMaps = deployment zones only; align so we never offer a map that lacks spaces).
- **Mission ID:** Use a single string: **`mapId:variant`** (e.g. `mos-eisley-outskirts:a`, `mos-eisley-outskirts:b`). No separate mission list; derived from mission-cards / playable maps. D4 (tournament rotation) and F17 (map selection) use this format.
- **Command card hand size:** No cap. Do not enforce discard-down at end of round; hand size can grow.
- **CC initial draw:** Enforce **3 cards per player at setup** (per rules) as the base. Abilities/effects can add extra draws (e.g. Imperial DC Skirmish Upgrade that draws an extra card at the beginning); implementation must apply base 3 then any modifiers.
- **Rules source of truth:** The consolidated rules reference (e.g. `docs/RULES_REFERENCE.md` / `docs/consolidated-rules-raw.txt` and IACP overrides) is the source of truth for **all** rules: adjacency, Cleave, Recover, Blast, movement, LOS, conditions, etc. F6 and all game logic implement per that reference.
- **Game ↔ Discord:** When a game is started, a **category** (and several subchannels under it) is created, keyed by that game’s ID. That category and its channels belong to that one game; there is no “multiple games in one channel” — one game = one category + its subchannels. **Game Log** and **General chat** are separate channels: Game Log is for game actions/updates (bot posts); General chat is for player discussion. `/botmenu` is valid only in the Game Log channel. Resolve which game: find the game whose stored Game Log channel ID (`generalId`) equals the channel where `/botmenu` was used; no channel name lookup (current implementation already does this at game creation).

- **Router / customId:** Handlers are dispatched by `customId` prefix (e.g. `lobby_join_`, `map_selection_`, `undo_`). Format is `prefix_gameId` or `prefix_gameId_extra`; the exact prefix list is derived from existing handlers when implementing A3.
- **Game creation:** Existing behavior — **#new-games** forum; each post = one lobby. Join Game / Start Game (when both in) creates the game category and channels. See DISCORD_SERVER_STRUCTURE and lobby handlers in index.js.
- **Max active games per player:** 3 (enforced on create and join). Defined in index.js as MAX_ACTIVE_GAMES_PER_PLAYER.
- **Test games:** Supported — user types `testgame` in #lfg to create a game with themselves as both players; `game.isTestGame` set. Draft Random button is shown only for test games (setup only); one-click random map + mission + initiative + default decks. Stays as-is unless we change it when adding F17.
- **Game tools (Refresh Map, Refresh All, Undo):** Only game participants may use these (already enforced in index.js); preserve this check when moving handlers to `src/handlers/game-tools.js`.

### 4.6 Out of scope (for this plan)

- Stat tracking UI and aggregation — later; DB2 gives us the data.
- Multi-server / multi-guild — later.
- Full automation of every single card on day one — we phase the work (surge first, then library, then wire DC/CC) but the target is all abilities implemented.

---

## 5. Execution order (plan)

**Phase 0 — Lock plan**  
- Review this doc; adjust scope, order, or boundaries.  
- Decide: refactor first (A1–A6) then features (F1–…), or one slice (e.g. A1 + A2 + A3, then F1/F2).  
- **No code** until “build mode” is agreed.

**Phase 1 — Architecture (recommended first)**  
1. A1 — Game state module.  
2. A2 — Data loader module.  
3. A3 — Router; handlers still in index but dispatched by prefix.  
4. A5 — Extract game logic (movement, combat) so handlers call into it.  
5. A6 — Discord helpers module.  
6. A4 — Move handlers into `src/handlers/*` (can be incremental).  
7. A7 — Test suite for game logic (after A5).  
8. A8 — Error-handling pattern (log, user message, avoid silent catch).

**Phase 2 — Ability system and full game**  
1. F1 — Ability library (data + code).  
2. F2 — Surge wired to library (and D1 for DC references if desired).  
3. F5 — CC timing (document + soft or hard enforce).  
4. F7 — Multi-figure defeat verification.  
5. F3 / F4 — DC specials and CC effects wired to library (incremental).  
6. F6 — Conditions, Recover, Blast, Cleave (as needed by abilities).  
7. F8 / F9 — Map data and interior/exterior for maps in use.  
8. F17 — Map Selection menu (Random / Competitive / Select Draw / Selection); D4 tournament rotation.  
9. F12 — Mission B (and other IACP missions) verify/complete.  
10. F13 — Multi-surge abilities.  
11. D3 — Validate critical JSON on load.  
12. DB2 — Stats-ready schema (completed_games); write row when game ends.  
13. DB4 — Game state versioning and migration on load.

**Phase 3 — Polish**  
- F10 if desired; F11 (Archive via /botmenu); F14 (Undo scope); F15 (Discord limits); F16 (Kill/Archive via /botmenu); stat tracking UI when DB2 exists.

---

## 6. Summary

| Area | Current | Target |
|------|---------|--------|
| **Structure** | One 8.4k-line file, globals, 40+ if-branches | Modules: state, data, router, handlers, game, discord |
| **State** | Global Maps in index | `src/game-state.js`; get/set/persist |
| **Data** | Global vars loaded in index | `src/data-loader.js`; getters only |
| **Interactions** | Single handler, long if chain | Router → handler by prefix; handlers in modules |
| **Rules** | Inline in handlers | `src/game/*`; testable, no Discord |
| **Abilities** | On-card text; surge keys parsed in code | Ability library; DC/CC reference ids; bot runs by id |
| **Full game** | Setup→rounds→move/attack/interact/special→win | Same; abilities and CCs enforced via library |

**Next step:** Confirm or edit this plan (sections 2–5). Once locked, we switch to build mode and execute in the chosen order (Phase 1 then Phase 2).
