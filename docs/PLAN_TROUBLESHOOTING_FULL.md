# Full Plan Troubleshooting — What We're Missing

**Purpose:** No-stone-unturned review so the plan gets us to a fully functioning end state (Discord bot enforces all rules, full game playable, modular codebase). Items below are either missing from the main plan, under-specified, or recommended improvements.

---

## 1. Missing from the plan (should add)

### 1.1 Database and stats

- **Current DB:** One table `games (game_id, game_data JSONB, updated_at)`. Full game state in JSONB. No schema for completed games or stats.
- **Missing:**
  - **Stats schema and ETL:** You want win rate by affiliation, by DC, by deployment zone, pick rate, play rate. That requires either (a) querying JSONB (slow, no indexes) or (b) a dedicated **game history** table written when a game ends (or when archived): e.g. `completed_games (id, game_id, winner_id, player1_affiliation, player2_affiliation, player1_army_json, player2_army_json, map_id, mission_variant, deployment_winner_zone, created_at)`. Then aggregate queries for stats. Plan says "stat tracking later" but doesn't design the DB for it.
  - **Recommendation:** Add to plan: **DB2** — When game ends (or on Archive), write a row to `completed_games` (or equivalent) with winner, affiliations, army lists, map, zone. Design this table once so F11 / stat tracking can use it without a second migration. Optionally **DB3** — Add indexes on `games (updated_at, game_data->>'ended')` for "active games" if we ever need to list them.

### 1.2 Mission B and other missions

- **Current:** Mission A (Launch panels, VP) is in the plan. Mission B (contraband: retrieve, carry, deliver to deployment zone for 15 VP each) exists in code and map-tokens; win check includes "contraband delivery."
- **Missing:** Plan doesn't call out Mission B explicitly. If IACP uses Mission B, we need: (a) verify retrieve/deliver flow and VP grant, (b) any mission-specific interact options and UI. Same for any other mission variants.
- **Recommendation:** Add **F12** — Verify and document Mission B (and any other IACP mission) flow end-to-end; fix or implement any missing steps.

### 1.3 Testing

- **Current:** No test suite (no Jest, no *.test.js). Plan says "testable core" (game logic in `src/game/*`) but doesn't say "add tests."
- **Missing:** Unit tests for movement (reachable spaces, LOS, path cost), combat (hit/damage/surge), validation (validateDeckLegal), ability resolution. Without tests, refactors (A5, F1–F4) are riskier.
- **Recommendation:** Add **A7** — Add test suite (e.g. Jest) and unit tests for `src/game/*` (movement, combat, validation). Run in CI if we add CI. Can start after A5 so there's something to test.

### 1.4 Error handling and logging

- **Current:** Many ` .catch(() => {})` in index (Discord edit/reply); errors often swallowed. Some `logGameErrorToBotLogs` for interactions.
- **Missing:** Consistent strategy: (a) log failures (with gameId, interaction customId, err.message), (b) tell the user something when an action fails ("Something went wrong; try again or refresh."), (c) avoid leaving game state inconsistent if Discord API fails mid-flow.
- **Recommendation:** Add **A8** — Define error-handling pattern for handlers (log + user-facing message + optional retry); replace silent `.catch(() => {})` where it matters (e.g. after state change).

### 1.5 Game state versioning and migrations

- **Current:** `game_data` is free-form JSON. If we change the shape (e.g. add `game.version`, or change how we store conditions), old saves could break.
- **Missing:** Version field in game state and a migration path (e.g. on load, if `game.version < 2`, run migrateToV2(game)).
- **Recommendation:** Add **DB4** — Add `game.version` (or equivalent) and a small migration layer when loading games so we can evolve state shape without breaking old games.

### 1.6 Archive button: who can click?

- **Current:** F11 says "Archive game button in Game Log when game has ended."
- **Missing:** Who is allowed to click? (Both players? Either player? Only server admin?) Plan doesn't specify.
- **Recommendation:** Decide and document in F11: e.g. "Either player in the game can click Archive once game has ended."

### 1.7 Double-surge and multi-surge abilities

- **Current:** Surge flow filters out abilities whose key matches "(2 surges)" so we only show 1-surge options. Some cards have "Blast 3 (2 surges)" or similar.
- **Missing:** Plan doesn't mention implementing 2-surge (or N-surge) abilities. For "bot enforces everything," we need to support them.
- **Recommendation:** Add **F13** — Support multi-surge abilities (e.g. spend 2 surge for one effect). Buttons or menu; deduct N surge when chosen.

### 1.8 Recover, Blast, Cleave (combat)

- **Current:** Surge parser and combat apply damage, pierce, accuracy, conditions (display). Recover (attacker recovers damage), Blast (splash), Cleave (multi-target) are not applied to state.
- **Missing:** Plan has F6 (conditions) but doesn't explicitly call out Recover (heal attacker), Blast (damage adjacent figures), Cleave (spread damage). These are needed for full combat enforcement.
- **Recommendation:** Fold into F6 or add explicit bullet: **Recover** — apply healing to attacker's figure(s). **Blast / Cleave** — apply damage to additional valid targets per rules. (May depend on ability library design.)

### 1.9 Undo scope and consistency

- **Current:** Undo exists (e.g. `undo_` handler). Plan doesn't define scope (how many steps? which actions are undoable?).
- **Missing:** Clear contract: what can be undone (move? attack? CC play?) and how far back. Otherwise we risk inconsistent state or UX confusion.
- **Recommendation:** Add **F14** — Document undo scope and implement consistently (e.g. last N state-changing actions, or only move); ensure DC/CC state and Discord messages stay in sync after undo.

### 1.10 Data validation on load

- **Current:** JSON files loaded with try/catch; invalid or partial data leaves globals empty or partial.
- **Missing:** Schema or validation for critical data (dc-effects, dc-stats, map-spaces, ability-library). Bad data can cause runtime errors in handlers.
- **Recommendation:** Add **D3** — Validate critical JSON on load (e.g. required fields, shape); log warnings and fail fast in dev or at startup so we don't run with bad data.

### 1.11 Discord rate limits and size limits

- **Current:** No explicit handling. We send embeds, multiple messages, regenerate board image.
- **Missing:** Discord limits (e.g. 5 messages/5 sec per channel, embed size, 5 buttons per row). Under load (many games, many updates) we could hit rate limits or get messages rejected.
- **Recommendation:** Add **F15** — Document Discord limits we care about; add simple backoff or queue if we ever batch-send; ensure embeds and button rows stay under limits (we already slice to 5 buttons).
- **Update:** The main plan now has **section 2.5** (Discord UI constraints and UX standards): max 5 buttons per row, 5 rows, 80-char labels, button color restrictions, and a **color-by-area** scheme (e.g. Danger for combat, Success/Primary for confirm, Secondary for cancel/optional). This is baked into A6 (discord helpers) and F15, and applies to every implementation step.

### 1.12 Kill game and destructive actions

- **Current:** "Kill Game (testing)" button exists. Plan doesn't say who can kill or archive.
- **Missing:** Permissions for destructive actions (kill game, archive). If any user can kill any game, that's a problem for production.
- **Recommendation:** Add **F16** — Restrict Kill Game to game participants or server admin; same principle for Archive if needed. Document in plan.

---

## 2. Under-specified in the plan (clarify)

- **Ability library scope:** Plan says "phased" and "surge first, then DC/CC." How many abilities in phase 1? Do we have a list of "must have" abilities for IACP play? Suggest adding a **priority list** (e.g. top 20 CCs, top 10 specials) so we know what to implement first.
- **Maps "in use":** F8 says "all maps in use." Which maps are those? (IACP official list? Only those in map-registry?) Define the set so F8 is scoped.
- **Manual fallback:** When an ability isn't in the library yet, we show "resolve manually." Plan should state we keep that fallback forever for abilities we never implement, so the game is always playable.
- **CC draw/discard rules:** Initial draw, hand size, discard pile — are these enforced today? Plan doesn't mention; if not, add to validation/game logic.

---

## 3. Nice to have / improve (not blocking)

- **TypeScript:** Typing for game state and ability definitions would reduce bugs. Optional; could apply to `src/game/*` and `data-loader` first. Not required for "fully functioning" but improves maintainability.
- **CI:** Run tests (and lint) on push. Plan doesn't require it; add when we have tests.
- **Structured logging:** Replace ad hoc console.log with levels (info/warn/error) and structured fields (gameId, userId). Helps debugging in production.
- **i18n:** All strings are English; not in scope unless you want multiple languages.
- **Rewrite in another language:** Plan assumes we stay on Node/JS. A rewrite (e.g. TypeScript, or another runtime) would be a separate project; not necessary for the stated end state.

---

## 4. Necessary for your stated end state

To get to "fully functioning" (bot enforces everything, full game playable, modular codebase), the plan already has:

- Architecture (A1–A6): state, data, router, handlers, game logic, discord.
- Ability system (F1–F4, D1–D2): library, wire DC/CC, migrate data.
- Full-game features (F5–F11): timing, conditions, multi-figure, maps, interior/exterior, optional combat UX, archive.

**Must add to plan so nothing is left out:**

1. **Database:** Stats-ready design (completed_games or equivalent) and when to write it (on end/archive). (DB2, maybe DB3.)
2. **Game state versioning:** So we can evolve state without breaking old games. (DB4.)
3. **Testing:** At least game-logic tests so refactors and ability logic are safe. (A7.)
4. **Mission B:** Explicit verify/complete so Mission B is not a blind spot. (F12.)
5. **Multi-surge abilities:** So we don't leave cards with "2 surge" options unsupported. (F13.)
6. **Recover / Blast / Cleave:** Either in F6 or called out so combat is complete. (F6 expansion or F13.)
7. **Archive and Kill permissions:** Who can do what. (F11/F16.)
8. **Error handling:** Don't swallow errors everywhere; log and respond. (A8.)
9. **Undo scope:** Define and implement consistently. (F14.)
10. **Data validation:** Validate critical JSON on load. (D3.)

---

## 5. Summary: add these to ARCHITECTURE_AND_PLAN.md

| ID | Item | Section |
|----|------|---------|
| A7 | Add test suite and unit tests for `src/game/*` | 4.1 Architecture |
| A8 | Error-handling pattern: log, user message, avoid silent catch | 4.1 Architecture |
| DB2 | Design and add completed_games (or equivalent) for stats; write on game end/archive | 4.3 Data or new 4.5 Database |
| DB3 | Optional: indexes for active games queries | 4.5 Database |
| DB4 | Game state version + migration on load | 4.5 Database |
| F12 | Verify Mission B (and other IACP missions) end-to-end | 4.2 Features |
| F13 | Multi-surge abilities (e.g. spend 2 surge for one effect) | 4.2 Features |
| F14 | Undo scope: document and implement consistently | 4.2 Features |
| F15 | Document Discord rate/size limits; ensure we stay under | 4.2 Features |
| F16 | Permissions for Kill Game and Archive (who can click) | 4.2 Features |
| D3 | Validate critical JSON on load; fail fast on bad data | 4.3 Data |
| — | F6: explicitly include Recover, Blast, Cleave in combat resolution | 4.2 Features (expand F6) |
| — | Ability library: add priority list (top N abilities) for phased rollout | 4.2 or 5 |
| — | Maps "in use": define the set for F8 | 4.2 Features |
| — | Manual fallback: keep "resolve manually" for unimplemented abilities | 2.3 or 4.2 |

---

**Next step:** Fold the items in Section 5 into [ARCHITECTURE_AND_PLAN.md](ARCHITECTURE_AND_PLAN.md) (add new rows to tables, new subsection 4.5 Database if needed, and the short clarifications). Then the plan is fully troubleshot and ready for build.
