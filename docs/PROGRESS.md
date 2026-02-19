# IACP Skirmish — Master Progress Tracker
*Goal: Fully playable, 100% in-Discord automated skirmish experience.*
*Last updated: Feb 19 2026 (post full audit).*

---

## Overall Progress

Scores are **effort-weighted** — a checkbox that fixes one return statement is not worth the same as wiring surge abilities for 223 deployment cards. Each category carries a weight reflecting its total implementation cost. The percentage is derived from `(points earned) / (total points)`.

```
████████████░░░░░░░░  ~62%  effort-weighted
```

| Category | Weight | Score | % | Notes |
|---|---|---|---|---|
| 🏗️ Infrastructure | 10 | 8.5 | 85% | Atomic saves + migration logic open |
| 🔄 Game Flow & Rounds | 12 | 8.5 | 71% | Reinforcement missing; pass button works but no server block |
| ⚔️ Combat System | 15 | 12.5 | 83% | Full sequence works; LOS + figures-as-blockers gap |
| 🏃 Movement & LOS | 10 | 8.5 | 85% | Engine solid; reinforce entry points missing |
| 🃏 CC Automation | 20 | 15.0 | 75% | ~248 / 297 cards in library; ~49 still return manual message |
| 🤖 DC Core Gameplay | 12 | 9.5 | 79% | Attack/health/conditions work; DC specials are stubs |
| ⚡ DC Surge Automation | 15 | 0.5 | **3%** | Only 2 / 223 DCs have surge data in dc-effects.json |
| 🗺️ Map Data | 15 | 9.5 | 63% | 3/3 tournament maps + 2 extras built; dev-facility broken |
| 📜 Mission Rules Engine | 8 | 5.0 | 63% | Engine works for 5 maps; dev-facility empty |
| 🔁 Reinforcement | 8 | 0.0 | **0%** | Not implemented — breaks every third/fourth round |
| 📊 Stats & Analytics | 10 | 7.0 | 70% | 3 slash commands live; missing zone/leaderboard/end-game embed |
| **Total** | **135** | **84.0** | **~62%** | |

> ⚠️ **DC Surge Automation** and **Reinforcement** are the two biggest effort gaps.
> The previous draft under-counted Stats (commands are live) and over-stated some game flow gaps.

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

## 🔄 Game Flow & Rounds — weight: 12 pts — score: 8.5 / 12 (71%)

- [x] Win/loss detection: 40 VP threshold + full elimination
- [x] Activation counter reset at end of round
- [x] Activated DC indices reset at end of round
- [x] `mission-rules.js` return bug fixed (game end stops further rule execution) *(fixed this session)*
- [x] Mission A & B objectives run via data-driven `runEndOfRoundRules`
- [x] Defeated groups filtered from Activate list
- [x] Activations decremented when group wiped mid-round
- [x] Attachment CCs cleaned up when DC is defeated
- [x] CC timing validation (`isCcPlayableNow`, `isCcPlayLegalByRestriction`)
- [x] **Pass turn button** — `pass_activation_turn_` handler is fully implemented; shows when opponent has strictly more activations; undoable
- [ ] **Reinforcement** — non-unique defeated figures can redeploy at end of round *(not implemented)*
- [ ] **End-of-activation CC auto-prompt** — `endofactivation` timing exists in `cc-timing.js` but nothing auto-triggers at end of activation; players must manually play from hand
- [ ] **Server-side activation block** — `p1/p2ActivationsRemaining` is decremented but nothing prevents a player from clicking Activate on a DC when their count is already 0
- [ ] **Free action tracking** — abilities that grant free actions still decrement the action counter

---

## 🃏 CC Automation — weight: 20 pts — score: 15.0 / 20 (75%)

> **Coverage: 248 / 297 CC cards (~83%) have entries in `ability-library.json`.**
> ~49 cards return "Resolve manually" reminder text; no game state change.
> 97 distinct code branches in `src/game/abilities.js` handle the wired cards.
> "Data-verified" (289 cards in `cc-verified.json`) ≠ playtested.

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
- [ ] **~49 CC cards still return manual reminder** — not wired to game state
- [ ] **`pendingCcConfirmation` stale** — confirmation state leaks if player acts without confirming

---

## 🤖 DC Core Gameplay — weight: 12 pts — score: 9.5 / 12 (79%)

- [x] Activation buttons: Attack, Move, Special, Rest, End Activation
- [x] Health tracking per figure across damage events
- [x] Conditions on DCs (Focus, Hide, Stun, Weaken, Bleed)
- [x] Exhaustion state reset at end of round
- [x] Movement point bank per activation
- [x] Deploy area embed updates on health change
- [x] Defeat detection + removal from game
- [x] DC activation index tracking (which groups have activated)
- [x] Multi-figure groups tracked as one deployment
- [x] Power Token system — `/power-token add/remove/list` slash command wired to `game.figurePowerTokens`
- [x] Undo — works for **move, pass turn, and deploy actions** (undoStack with game log message deletion)
- [ ] **DC special actions are stubs** — `special.js handleSpecialDone` just marks "✓ Resolved"; no game state change; all DC specials are manual
- [ ] **DC keyword traits** — `Sharpshooter`, `Charging Assault`, and others read from data but not enforced in combat
- [ ] **Undo scope gap** — undo does NOT work for combat, CC plays, health changes, conditions, or VP changes

---

## ⚡ DC Surge Automation — weight: 15 pts — score: 0.5 / 15 (**3%**)

> **This is the biggest single gap in combat accuracy.**
> `dc-effects.json` has only **2 / 223 DCs** with `surgeAbilities` defined.
> For all other DCs, no surge options appear when attacking — players resolve surges manually.
> `parseSurgeEffect(string)` in `combat.js` works correctly — the data just isn't populated.

- [x] `parseSurgeEffect` parser handles all text surge formats (`damage N`, `pierce N`, `stun`, etc.)
- [x] Surge UI buttons shown when `surgeAbilities` array is present for a DC
- [ ] **221 / 223 DCs have no surge data** — populate `dc-effects.json` for each to unlock automation

---

## 🏃 Movement & LOS — weight: 10 pts — score: 8.5 / 10 (85%)

- [x] MP calculation with Speed stat
- [x] Adjacency detection (4-directional grid)
- [x] Reachable spaces computation (BFS with wall/block filtering)
- [x] LOS corner-to-corner algorithm (4×4 inset corner pairs, impassable edge detection)
- [x] Wall segment extraction from space edge data
- [x] Difficult terrain (costs extra MP)
- [ ] **Reinforcement deployment** — no entry point for placing figures after defeat
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

## 📜 Mission Rules Engine — weight: 8 pts — score: 5.0 / 8 (63%)

- [x] `runEndOfRoundRules` — data-driven VP rule engine
- [x] `runStartOfRoundRules` — start-of-round effects
- [x] Flip panel mechanic (Mos Eisley A)
- [x] Contraband carry mechanic (Mos Eisley B, -2 Speed, zone scoring)
- [x] VP scoring per controlled terminal (Corellian, Chopper Base, etc.)
- [ ] **development-facility mission rules** — mission card data is entirely empty
- [ ] **Reinforcement spawn points** — mission data could include reinforcement positions; unused
- [ ] **Named areas / control tracking** — getNamedAreaController exists but untested on all maps

---

## 🔁 Reinforcement — weight: 8 pts — score: 0.0 / 8 (**0%**)

> Non-unique defeated figures can return to the board at the end of a round.
> This is a **core rule** that applies every round and is **completely absent** from the codebase.
> The round end handler (`src/handlers/round.js`) has no reinforcement logic.

- [ ] Detect non-unique defeated DCs at end of round
- [ ] Prompt owning player: deploy reinforcement to valid deployment zone space
- [ ] Award opponent 1 VP per figure that returns
- [ ] Decrement deployment cost from total army cost tracking
- [ ] Re-add figure to active DC list (restore health to full)
- [ ] Handle edge case: no valid deployment spaces available

---

## 🏗️ Infrastructure — weight: 10 pts — score: 8.5 / 10 (85%)

- [x] Game state module (`src/game-state.js`)
- [x] Data loaders (`src/data-loader.js`)
- [x] Interaction router (`src/router.js`)
- [x] Handlers split by domain (`src/handlers/*`)
- [x] Game logic modules (`src/game/*`)
- [x] Discord helpers (`src/discord/*`)
- [x] Headless simulation test (`tests/simulate-game.js`, 742 lines) — runs full game loop without Discord, validates state integrity
- [x] Unit tests for game logic (`abilities.test.js`, `combat.test.js`, `movement.test.js`, `coords.test.js`)
- [x] Error handling + Discord retry
- [x] `completed_games` DB table written on game end (`insertCompletedGame`)
- [x] DB indexes (`idx_games_updated_at`, `idx_games_ended`)
- [x] Game versioning scaffold (`CURRENT_GAME_VERSION`, `migrateGame`)
- [x] Save chain queued (parallel interactions serialize via `savePromise`)
- [x] Critical JSON validation on startup
- [x] Local HTTP `/testgame` endpoint for quick test game creation without Discord UI
- [ ] **Atomic saves** — no temp-file swap; crash mid-write can corrupt game state (#13)
- [ ] **`migrateGame()` does nothing** — version field exists but the function is a no-op (#24)
- [ ] **Auto-cleanup on game end** — channels + roles persist until manual deletion (#25)
- [ ] **`pendingIllegalSquad` memory leak** — `Map` entry never removed on rejection (#26)
- [ ] **No max undo depth** — `undoStack` grows unbounded; memory leak in long games

---

## 📊 Stats & Analytics — weight: 10 pts — score: 7.0 / 10 (70%)

> **Three slash commands are live and working.** `/statcheck`, `/affiliation`, and `/dcwinrate` all call into `src/db.js` and post results in `#statistics`. The DB backend is complete. Gaps are niche analytics not yet built.

- [x] `completed_games` table schema: winner, affiliations, army JSON, map, mission, deployment zone, round count
- [x] `insertCompletedGame()` called on every game end
- [x] `/statcheck` slash command — total games + draws, working
- [x] `/affiliation` slash command — win% per affiliation (Imperial/Rebel/Scum), working
- [x] `/dcwinrate [limit]` slash command — win% per DC from army JSON, working
- [x] `getStatsSummary()`, `getAffiliationWinRates()`, `getDcWinRates()` all implemented in `src/db.js`
- [ ] **No win-rate-by-deployment-zone query** — SQL not written; `deployment_zone_winner` is stored but unused
- [ ] **No leaderboard / player win record** — no per-player query
- [ ] **No end-of-game stats embed** — winner is announced but no summary card posted (VPs, round count, etc.)
- [ ] **No DC pick rate** — the data exists to compute %; not built

---

## What's Left for "Fully Playable"

| Priority | Item | Effort | Why it matters |
|---|---|---|---|
| 🔴 Critical | **Reinforcement** | Large | Core rule, completely unimplemented; breaks every third/fourth round |
| 🔴 Critical | **DC surge data** (221 DCs) | Large | Players can't pick surge options on nearly all DCs — must resolve manually |
| 🟡 High | **DC special actions** | Large | All DC specials are stubs; `handleSpecialDone` just prints "Resolved" |
| 🟡 High | **End-of-activation CC triggers** | Medium | `endofactivation` timing exists but nothing auto-fires; players must notice and play manually |
| 🟡 High | **development-facility data** | Small | Spaces exist but deployment zones + mission card data are empty |
| 🟡 Medium | **~49 remaining CC cards** | Medium | Still return "Resolve manually" message |
| 🟡 Medium | **Server-side activation block** | Small | No guard prevents clicking Activate on a DC with 0 activations remaining |
| 🟢 Low | **End-of-game stats embed** | Small | Data exists; just need a summary card on game end |
| 🟢 Low | **Undo scope** | Medium | Only move/pass/deploy are undoable; combat and CC plays are not |
| 🟢 Low | **Atomic saves + migration** | Medium | Reliability + upgrade path for long-running games |
| 🟢 Low | **Auto-cleanup on game end** | Small | Channels persist manually after game ends |
| 🟢 Low | **`pendingCcConfirmation` / `pendingIllegalSquad` leaks** | Small | Minor state leaks |
