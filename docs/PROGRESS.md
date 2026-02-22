# IACP Skirmish — Master Progress Tracker
*Goal: Fully playable, 100% in-Discord automated skirmish experience.*
*Last updated: Feb 2026 (comprehensive audit: CC coverage, activation block confirmed, specialAbilityIds, dc-keywords.json removal, abilityText denominator corrected; EoA CC auto-prompt done; Nexu Pounce wired — specialAbilityIds now 7 DCs; 10 more CCs wired: Adrenaline, Son of Skywalker, Signal Jammer, Harsh Environment, Terminal Network [full automation] + Marksman, Force Push, Battlefield Awareness, Double or Nothing, Change of Plans [informational]; round.js cleanup for new round-scoped flags).*

---

## Overall Progress

Scores are **effort-weighted** — a checkbox that fixes one return statement is not worth the same as wiring surge abilities for 223 deployment cards. Each category carries a weight reflecting its total implementation cost. The percentage is derived from `(points earned) / (total points)`.

```
████████████████░░░░  ~80%  effort-weighted
```

| Category | Weight | Score | % | Notes |
|---|---|---|---|---|
| 🏗️ Infrastructure | 10 | 9.3 | 93% | Atomic saves + migration logic open; undo cap, health sync, CC confirmation TTL, free action mechanism all done |
| 🔄 Game Flow & Rounds | 12 | 9.1 | 76% | Reinforcement missing; door system + setup attachments now tracked; EoA CC auto-prompt done |
| ⚔️ Combat System | 15 | 12.5 | 83% | Full sequence works; LOS + figures-as-blockers gap |
| 🏃 Movement & LOS | 10 | 8.5 | 85% | Engine solid; large figure occupancy gap |
| 🃏 CC Automation | 20 | 16.0 | 80% | 289/289 CC cards have library entries (100% coverage); 0 gameready, 12 testready, 141 wired, 136 manual (83 partial + 53 unwired) |
| 🤖 DC Core Gameplay | 12 | 9.8 | 82% | DC specials wired via resolveAbility; `abilityText` filled for 233/238 cards; `specialAbilityIds` populated for 7 DCs; gap is writing more code paths per DC special |
| ⚡ DC Surge Automation | 15 | 12.5 | **83%** | 165/165 attacking DCs have surgeAbilities; parseSurgeEffect fully handles all types |
| 🗺️ Map Data | 15 | 9.5 | 63% | 3/3 tournament maps + 2 extras built; dev-facility broken |
| 📜 Mission Rules Engine | 8 | 5.2 | 65% | Door tracking via openedDoors across all maps |
| 🔁 Reinforcement | ~~8~~ | N/A | **N/A** | Campaign-only mechanic — does NOT apply in skirmish. Figure deaths are permanent in skirmish (except specific CC/DC effects). Row removed from weighting. |
| 📊 Stats & Analytics | 10 | 7.5 | 75% | End-game scorecard embed confirmed posted; leaderboard/zone queries missing |
| **Total** | **127** | **100.3** | **~80%** | *(Reinforcement row removed from weight — campaign-only)* |

> ✅ **Reinforcement is a campaign-only mechanic.** Figure deaths are permanent in skirmish. The only exceptions are specific CC/DC special effects that explicitly return a figure — those are handled per-ability, not globally.
> Previous "3% DC Surge" stat was stale — data was already populated for all 165 attacking DCs.
> Previous audits also under-counted: Negation, Celebration, door system, CC play undo, end-game scorecard, setup attachment phase.

---

## ⚔️ Combat System — weight: 15 pts — score: 12.5 / 15 (83%)

- [x] Full attack sequence: Roll → Reroll → Dodge → Evade → Surge → Resolve
- [x] Evade cancels surge (not hit) — correct timing
- [x] Accuracy vs distance enforced for ranged attacks
- [x] Dodge: white die face 6 auto-miss
- [x] Blast / Cleave only trigger on >0 damage
- [x] Conditions (Stun, Weaken, Bleed, etc.) applied and tracked
- [x] Multi-surge ability costs (`surgeCost > 1`)
- [x] LOS enforced — no-LOS target buttons disabled + server-side hard block *(fixed this session)*
- [x] LOS algorithm — corner-to-corner tracing, not center-to-center *(fixed this session)*
- [ ] **Edge: figure-as-blocker LOS** — group figures block LOS for enemies; not yet validated
- [ ] **Blast/Cleave adjacency per figure** — currently checks space, not per-figure

---

## 🔄 Game Flow & Rounds — weight: 12 pts — score: 8.8 / 12 (73%)

- [x] Win/loss detection: 40 VP threshold + full elimination; draw on mutual elimination
- [x] Activation counter reset at end of round
- [x] Activated DC indices reset at end of round
- [x] `mission-rules.js` return bug fixed (game end stops further rule execution)
- [x] Mission A & B objectives run via data-driven `runEndOfRoundRules`
- [x] Defeated groups filtered from Activate list
- [x] Activations decremented when group wiped mid-round
- [x] Attachment CCs cleaned up when DC is defeated
- [x] CC timing validation (`isCcPlayableNow`, `isCcPlayLegalByRestriction`)
- [x] **Pass turn button** — `pass_activation_turn_` handler fully implemented; shows when opponent has strictly more activations; undoable
- [x] **End Turn button** — per-DC "End Turn" prompt after 0 actions remain; `handleEndTurn` passes turn to opponent
- [x] **Skirmish Upgrade setup attachment phase** — after both players deploy, attachment selection phase before CC shuffle; fully gated and sequential
- [x] **Door system** — doors present on map, removed from render when opened via interact; `game.openedDoors` persisted
- [x] **Ancillary token tracking** — smoke, rubble, energyShield, device, napalm tracked in `game.ancillaryTokens` and rendered on board
- [x] **Manual VP edit** — `/editvp +N` or `/editvp -N` typed in Game Log; per-player adjustment; triggers win condition check and refreshes scorecard
- [x] **Supercharge strain** — `superchargeStrainAfterAttackCount` applies strain to attacker's figure after attack resolves
- [x] **Server-side activation block** — `remaining <= 0` guard in both `handleDcActivate` and `handleConfirmActivate`; returns ephemeral error if no activations remain *(confirmed present)*
- [x] **End-of-activation CC auto-prompt** — `dc_cc_eoa_` handler + `getPlayableCcEndOfActivationForDc`; buttons auto-appear in action row when `actions=0` for any EoA-timing CC in hand
- [ ] **Free action tracking** — abilities that grant free actions still decrement the action counter

---

## 🃏 CC Automation — weight: 20 pts — score: 15.5 / 20 (78%)

> **Coverage: 289 / 289 CC cards (100%) have entries in `ability-library.json`.**
> Status hierarchy: **gameready** → **testready** → **wired** → **manual** (partial/unwired)
> 0 gameready · 12 testready · 141 wired · 136 manual (83 partial + 53 unwired)
> 102 distinct code branches in `src/game/abilities.js` handle wired/testready/gameready cards.

- [x] CC hand management: draw, hold, play, discard
- [x] CC effects routed through `resolveAbility` → 97 code paths
- [x] Choice-based CCs: `chooseOne` prompts player for selection before applying
- [x] Attack-context CCs (+hit, +surge, +pierce, +accuracy, +blast, dice, etc.)
- [x] Defense-context CCs (+block, +evade, remove attack dice, etc.)
- [x] Movement CCs (+MP, Focus, Hide, Smoke Grenade, etc.)
- [x] Round-until CCs (Take Position, Survival Instincts, etc.) stored on game state
- [x] Hand manipulation CCs (draw, discard, shuffle, opponent disruption)
- [x] Condition CCs (apply Focus/Hide, discard Stun/Weaken/Bleed from adjacents)
- [x] Damage CCs (recover, self-damage, strain, adjacent hostile damage)
- [x] VP manipulation CCs (Dangerous Bargains, Field Promotion, Black Market Prices, etc.)
- [x] Initiative manipulation CCs (I Make My Own Luck, Take Initiative)
- [x] Complex CCs: Apex Predator, Blaze of Glory, Overrun, Provoke, Vanish wired
- [x] **Negation** — fully wired: cost-0 CC plays trigger opponent Negation window (Play Negation / Let it resolve); DC Special CC path also triggers Negation
- [x] **Celebration** — fully wired: on unique hostile defeat, attacker is prompted to play Celebration for +4 VP; both `celebration_play_` and `celebration_pass_` handlers live in `cc-hand.js`
- [x] **CC discard pile search** — thread-based; open/close/view fully implemented
- [x] **CC play from DC activation thread** (`dc_cc_special_`) — Special Action timing; cost-0 triggers Negation window
- [x] **CC play undo** — undoStack records `cc_play` and `cc_play_dc` types; hand/discard/attachment state restored
- [x] **25 CC test scenarios** implemented and launchable via `testready` / `testgame` — TIMING_TEST_REQUIREMENTS covers all 10 timing categories
- [x] **Signal Jammer** — intercepts opponent CC play; both cards discarded; round-scoped flag cleared in `round.js`
- [x] **Adrenaline** — grants +2 MP during activation via `freeAction: true` mechanism
- [x] **Son of Skywalker** — readies own DC (removes from activatedDcIndices, unexhausts embed)
- [x] **Harsh Environment** — sets `game.harshEnvironmentActive = true` (round-scoped)
- [x] **Terminal Network** — sets `game.terminalControlPlayerNum` (round-scoped)
- [ ] **136 CC cards are manual** — 83 partial (some automation), 53 unwired (no state change)
- [x] **`pendingCcConfirmation` stale** — fixed: 10-min TTL via timestamp; see Infrastructure section

---

## 🤖 DC Core Gameplay — weight: 12 pts — score: 9.7 / 12 (81%)

- [x] Activation buttons: Attack, Move, Special, Interact, End Activation
- [x] Health tracking per figure across damage events
- [x] Conditions on DCs (Focus, Hide, Stun, Weaken, Bleed) — stored per figureKey
- [x] Exhaustion state reset at end of round
- [x] Movement point bank per activation
- [x] Deploy area embed updates on health change (DC thumbnail rotated 90° when exhausted)
- [x] Defeat detection + removal from game; win condition check on defeat
- [x] DC activation index tracking (which groups have activated)
- [x] Multi-figure groups tracked as one deployment card
- [x] Power Token system — `/power-token add/remove/list` slash command; stored in `game.figurePowerTokens`; rendered on board minimap
- [x] **DC specials wired via `resolveAbility`** — `dc-play-area.js handleDcAction(Special)` calls `resolveAbility(specialAbilityIds[idx])` from `dc-effects.json`; if `specialAbilityIds` is populated for a DC, its special IS automated
- [x] **`abilityText` filled for 233/238 DCs** — human-readable ability text entered via DC effect editor; displayed as reminder in Special embed. 5 remaining are non-combat utility figures.
- [x] **Nexu Pounce wired** — two-phase flow: space-pick UI (valid empty spaces within pounceRange via BFS), then teleport + `pounceAttackPending` grants free attack; applies to both Nexu (Elite) and Nexu (Regular)
- [x] **Door system** — `open_door_{edge}` interact option tracked in `game.openedDoors`; doors removed from map render when opened; undo-supported
- [x] **Skirmish Upgrade setup attachment** — `handleSetupAttachTo` places Skirmish Upgrade on DC during setup; stored in `p1DcAttachments` / `p2DcAttachments`; Deplete button + CC attachment embeds update accordingly
- [x] **Companion embed** — DCs with a `companion` field in `dc-effects.json` get a Companion embed posted in Play Area; updates on Refresh All
- [x] **Interact: terminals, doors, contraband, launch panels** — `getLegalInteractOptions` returns mission-specific (blue) + standard (grey) options; fully tracked with undo
- [x] **Undo** — works for: move, pass turn, deploy, interact, cc_play (hand), cc_play_dc (Special from thread)
- [ ] **DC specials automation gap** — `abilityText` is populated (233/238 ✅); `specialAbilityIds` populated for 7 DCs: MHD-19, R2-D2, Rebel Trooper (Elite), Sabine Wren, Weequay Pirate (Elite), Nexu (Elite), Nexu (Regular). Remaining DCs show ability text reminder + Done button (manual). This is a code-writing problem per ability, not a data entry problem.
- [ ] **DC keyword traits** — `Sharpshooter`, `Charging Assault`, and others stored in `dc-effects.json keywords` field (computed via `getDcKeywords()`; dc-keywords.json deleted); not yet enforced in combat resolution
- [ ] **Undo scope gap** — undo does NOT work for: combat outcomes, health changes, conditions, VP awards, or group defeats

---

## ⚡ DC Surge Automation — weight: 15 pts — score: 12.5 / 15 (83%)

> All 165 attacking DCs have `surgeAbilities` populated in `dc-effects.json`.
> The 14 figure DCs without surge data are all non-combat figures (`NO ATTACK` in dc-stats.json): C-3PO, Jabba, The Child, Cam Droid, Pit Droid, BD-1, etc.
> `parseSurgeEffect` handles every known surge text format.

- [x] `parseSurgeEffect` parser handles all surge formats: `damage N`, `pierce N`, `accuracy N`, `blast N`, `recover N`, `cleave N`, `stun`, `weaken`, `bleed`, `hide`, `focus`, and comma-separated combos
- [x] Surge UI buttons shown during combat from `surgeAbilities` data
- [x] Multi-surge costs (`surgeCost > 1`) supported via `doubleSurgeAbilities`
- [x] **165 / 165 attacking DCs have `surgeAbilities` populated** — surge is fully automated
- [x] Bonus surge abilities from CCs (e.g. Spinning Kick → `combat.bonusSurgeAbilities`) merged at resolve time
- [ ] **Clawdite Shapeshifter / Purge Trooper** use Form/Loadout card swap — their stats and surges come from a card mechanic not yet implemented
- [ ] **Salacious B. Crumb `Swipe`** — damage on movement into space is not a standard attack; handled as manual

---

## 🏃 Movement & LOS — weight: 10 pts — score: 8.5 / 10 (85%)

- [x] MP calculation with Speed stat
- [x] Adjacency detection (4-directional grid)
- [x] Reachable spaces computation (BFS with wall/block filtering)
- [x] LOS corner-to-corner algorithm (4×4 inset corner pairs, impassable edge detection)
- [x] Wall segment extraction from space edge data
- [x] Difficult terrain (costs extra MP)
- [ ] **Large figure LOS** — multi-space figures not accounted for in occupancy check

---

## 🗺️ Map Data — weight: 15 pts — score: 9.5 / 15 (63%)

> 54 maps exist in `map-registry.json`. Each requires: grid spaces, adjacency, walls, deployment zones, token positions, mission card data.
> **Tournament rotation** (D4 Season): 3 maps — all 3 are fully built. ✅
> Total maps playable: **5 complete + 1 broken** out of 54 in registry.

- [x] **Mos Eisley Outskirts** — spaces, adjacency, zones, tokens, missions A+B ✅
- [x] **Corellian Underground** — fully built ✅ *(tournament rotation)*
- [x] **Chopper Base: Atollon** — fully built ✅ *(tournament rotation)*
- [x] **Lothal Wastes** — fully built ✅ *(tournament rotation)*
- [x] **Devaron Garrison** — fully built ✅
- [x] Map tool built and functional (`scripts/generate-map-spaces.js` + browser UI)
- [x] Deployment zone tooling built
- [x] Tournament rotation data populated
- [ ] **development-facility** — spaces exist but deployment zones empty; mission card data empty (#20)
- [ ] **48 remaining maps** in registry need spaces + deployment zones + mission data

---

## 📜 Mission Rules Engine — weight: 8 pts — score: 5.2 / 8 (65%)

- [x] `runEndOfRoundRules` — data-driven VP rule engine
- [x] `runStartOfRoundRules` — start-of-round effects
- [x] Flip panel mechanic (Mos Eisley A) — `launch_panel_{coord}_{side}` interact; `launchPanelState` tracked; undo-supported; per-round flip gate
- [x] Contraband carry mechanic (Mos Eisley B) — `retrieve_contraband` interact; `game.figureContraband` tracked; -2 Speed applied via `getEffectiveSpeed`; zone scoring
- [x] VP scoring per controlled terminal — `countTerminalsControlledByPlayer` at end of round
- [x] **Door system wired globally** — `game.openedDoors` persists across all maps; door edges filtered from map render; `open_door_` interact available wherever `map-tokens.json` has `doors` entries
- [x] **Ancillary tokens on board** — smoke, rubble, energyShield, device, napalm tracked in `game.ancillaryTokens` and passed to `renderMap`
- [ ] **development-facility mission rules** — mission card data is entirely empty
- [ ] **Named areas / control tracking** — `getNamedAreaController` exists but untested on all maps; no generic area-control scoring rule

---

## 🔁 Reinforcement — NOT A SKIRMISH MECHANIC

> **Reinforcement is campaign-only.** In skirmish, figure defeats are permanent.
> The only exceptions are specific CC or DC special effects (e.g. abilities that explicitly state a figure returns). Those are handled per-ability via `resolveAbility`, not as a global end-of-round hook.
> This category has been removed from the effort-weighted score.

- N/A — no global reinforcement logic needed in skirmish

---

## 🏗️ Infrastructure — weight: 10 pts — score: 9.3 / 10 (93%)

- [x] Game state module (`src/game-state.js`)
- [x] Data loaders (`src/data-loader.js`)
- [x] Interaction router (`src/router.js`)
- [x] Handlers split by domain (`src/handlers/*`)
- [x] Game logic modules (`src/game/*`)
- [x] Discord helpers (`src/discord/*`)
- [x] Headless simulation test (`tests/simulate-game.js`, 742 lines) — runs full game loop without Discord, validates state integrity
- [x] Unit tests for game logic (`abilities.test.js`, `combat.test.js`, `movement.test.js`, `coords.test.js`)
- [x] CLI movement test suite — `node index.js --test-movement` runs 10+ BFS tests with pass/fail report
- [x] Error handling + Discord retry (`replyOrFollowUpWithRetry`)
- [x] `completed_games` DB table written on game end (`insertCompletedGame`)
- [x] DB indexes (`idx_games_updated_at`, `idx_games_ended`)
- [x] Game versioning scaffold (`CURRENT_GAME_VERSION`, `migrateGame`)
- [x] Save chain queued (parallel interactions serialize via `savePromise`)
- [x] Critical JSON validation on startup (`validateCriticalData`)
- [x] Local HTTP `/testgame` endpoint for quick test game creation without Discord UI
- [x] **Undo system** — `undoStack` with game log message deletion; 6 undo types: `move`, `pass_turn`, `deploy_pick`, `interact`, `cc_play`, `cc_play_dc`
- [x] **25 implemented test scenarios** — `IMPLEMENTED_SCENARIOS` list; `createTestGame` auto-deploys + seeds P1 hand + posts timed test instructions
- [x] **`reloadGameData()`** — hot-reloads all JSON files + clears map renderer cache on "Refresh All"
- [ ] **Atomic saves** — no temp-file swap; crash mid-write can corrupt game state (#13)
- [ ] **`migrateGame()` does nothing** — version field exists but the function is a no-op (#24)
- [ ] **Auto-cleanup on game end** — channels persist until manual deletion (#25)
- [x] **`pendingIllegalSquad` memory leak fixed** — `postGameOver` now deletes both player entries on natural game end
- [x] **`pendingCcConfirmation` stale state fixed** — timestamp added; `handleCcConfirmPlay` rejects confirmations older than 10 min
- [x] **Undo depth cap** — `MAX_UNDO_DEPTH = 50`; `pushUndo` trims oldest entry when exceeded
- [x] **DC health persistence** — `syncHealthStateToGames()` runs before every `saveGames()`; live `dcHealthState` Map always flushed to `p1DcList/p2DcList[idx].healthState`
- [x] **Free action mechanism** — `resolveAbility` can return `freeAction: true`; `handleDcAction` restores the decremented action if set; wired abilities can use this going forward
- [x] **460 empty catch blocks replaced with `console.error('[discord]', ...)` logging** (see prior commit)

---

## 📊 Stats & Analytics — weight: 10 pts — score: 7.5 / 10 (75%)

> **Three slash commands are live and working.** `/statcheck`, `/affiliation`, and `/dcwinrate` all call into `src/db.js` and post results in `#statistics`. The DB backend is complete. Gaps are niche analytics not yet built.

- [x] `completed_games` table schema: winner, affiliations, army JSON, map, mission, deployment zone, round count
- [x] `insertCompletedGame()` called on every game end (`postGameOver`)
- [x] `/statcheck` slash command — total games + draws, working
- [x] `/affiliation` slash command — win% per affiliation (Imperial/Rebel/Scum), working
- [x] `/dcwinrate [limit]` slash command — win% per DC from army JSON, working
- [x] `getStatsSummary()`, `getAffiliationWinRates()`, `getDcWinRates()` implemented in `src/db.js`
- [x] **End-of-game scorecard embed** — `postGameOver` posts `buildScorecardEmbed(game)` with VP totals on game end
- [ ] **No win-rate-by-deployment-zone query** — SQL not written; `deployment_zone_winner` stored but unused
- [ ] **No leaderboard / player win record** — no per-player query
- [ ] **No round count or detailed narrative in game-over message** — scorecard shows VP only; no "8 rounds, 3 objectives" summary
- [ ] **No DC pick rate** — data exists to compute; not built

---

## What's Left for "Fully Playable"

| Priority | Item | Effort | Why it matters |
|---|---|---|---|
| ~~🔴 Critical~~ | ~~**Reinforcement**~~ | ~~N/A~~ | Campaign-only mechanic — does not apply in skirmish. Removed. |
| ~~🔴 Critical~~ | ~~**DC surge data**~~ | ~~Done~~ | Surge data already populated for all 165 attacking DCs — previously misstated as 3% |
| 🟡 High | **DC special action automation** (`specialAbilityIds`) | Large | `abilityText` filled for 233/238 ✅; `specialAbilityIds` wired for 7 DCs (MHD-19, R2-D2, Rebel Trooper Elite, Sabine Wren, Weequay Pirate Elite, Nexu Elite, Nexu Regular); remaining degrade gracefully to reminder text + Done button. |
| ~~🟡 High~~ | ~~**End-of-activation CC triggers**~~ | ~~Medium~~ | ~~`endofactivation` timing exists but nothing auto-fires~~ — **Done**: `dc_cc_eoa_` handler wired; buttons auto-show when `actions=0` |
| 🟡 High | **development-facility data** | Small | Spaces exist but deployment zones + mission card data are empty |
| 🟡 Medium | **136 manual CC cards** | Medium | 83 partial (some automation), 53 unwired (no state change) — all require manual resolution |
| ~~🟡 Medium~~ | ~~**Server-side activation block**~~ | ~~Small~~ | ~~No guard prevents clicking Activate on a DC when `ActivationsRemaining` is already 0~~ — **Done**: `remaining <= 0` guard confirmed present in both activate handlers |
| 🟡 Medium | **DC keyword trait enforcement** | Medium | `Sharpshooter`/`Charging Assault` etc. in `dc-effects.json keywords` field (`getDcKeywords()` computed live); not yet enforced in combat resolution |
| 🟢 Low | **Undo for combat/HP/VP** | Medium | Current undo misses: combat outcomes, health changes, conditions, VP awards |
| 🟢 Low | **Detailed game-over summary** | Small | Scorecard embed posts; but no "8 rounds, X kills" narrative |
| 🟢 Low | **Atomic saves + migration** | Medium | Reliability + upgrade path for games spanning bot restarts |
| 🟢 Low | **Auto-cleanup on game end** | Small | Channels persist until manual deletion after game ends |
| ~~🟢 Low~~ | ~~**`pendingIllegalSquad` / `pendingCcConfirmation` leaks**~~ | ~~Small~~ | Fixed: `postGameOver` cleans up squad entries; `handleCcConfirmPlay` rejects stale confirmations (10-min TTL) |
