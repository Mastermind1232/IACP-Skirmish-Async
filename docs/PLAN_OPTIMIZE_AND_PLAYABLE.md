# Plan: Optimize & Make Fully Playable

**Goal:** Clean up the codebase and close the gap so Imperial Assault skirmish is fully playable in the Discord bot (rules enforced, card effects resolvable).

---

## Two Tracks

| Track | What | Outcome |
|-------|------|---------|
| **Optimize** | Refactor structure, split monolith, clarify boundaries | Easier to add features and fix bugs; safer to change code. |
| **Playable** | Wire effects, surge, maps, timing | Bot enforces rules; players resolve abilities through the bot. |

You can do them in parallel (e.g. small refactors while adding surge) or in sequence (e.g. refactor first, then effects). Below is a phased plan for both.

---

## Track A: Optimize (Codebase)

### Phase A1 — Low risk, high clarity
- **Extract game state + persistence**  
  Move `games` Map, `dcMessageMeta`, `dcExhaustedState`, `dcHealthState`, etc. into a single module (e.g. `src/game-state.js`). Expose `getGame(id)`, `setGame(id, game)`, and clear helpers. Keep `saveGames()` in db layer; state module just holds in-memory and delegates save.
- **Extract data loaders**  
  All the `readFileSync` + parse at top of `index.js` (and `reloadGameData`) → e.g. `src/data-loader.js`. Export `getDcStats`, `getDcEffects`, `getDiceData`, `getMapSpaces`, etc. so `index.js` and others import instead of using globals.
- **Single interaction router**  
  In `index.js`, keep one `client.on('interactionCreate')` but have it call a router that returns a handler by `customId` prefix (e.g. `routeInteraction(interaction) → handler(interaction, context)`). Handlers can stay in `index.js` at first; the important win is one place that maps prefix → handler instead of 40+ `if (customId.startsWith(...))`.

**Result:** Same behavior, clearer ownership of state vs data vs Discord. No change to Discord UX.

### Phase A2 — Split by domain (optional, bigger)
- **Handlers by feature**  
  Move handlers into modules by prefix group, e.g.  
  - `src/handlers/deployment.js` — deployment_zone_*, deployment_fig_*, deploy_pick_*, deployment_done_*  
  - `src/handlers/combat.js` — attack_target_*, combat_ready_*, combat_roll_*  
  - `src/handlers/movement.js` — dc_move_*, move_mp_*, move_pick_*, move_adjust_mp_*  
  - `src/handlers/dc-play-area.js` — dc_activate_*, dc_toggle_*, dc_deplete_*, dc_cc_special_*  
  - `src/handlers/cc-hand.js` — cc_play_*, cc_draw_*, cc_discard_*, cc_attach_*, cc_search_discard_*  
  - etc.  
  Router in `index.js` calls into these with `(interaction, game, context)`.
- **Game logic out of handlers**  
  Move “pure” logic (e.g. resolve attack: hit/miss, damage, VP) into `src/game/` or similar so it’s testable without Discord. Handlers only: get game, call game logic, then update Discord (edit message, send to thread, etc.).

**Result:** Smaller files, testable core, easier to add e.g. surge or new buttons without touching unrelated code.

---

## Track B: Playable (Features)

### Phase B1 — Fast wins (no ability DB yet)
- **Combat flow UX (note for later):** Optional 1–2 checks in the middle of combat, e.g. a “Ready to resolve rolls” button after both have rolled (and after surge, if any) so both players confirm before the bot applies damage. Not critical; add when polishing.
- **Surge spending in combat**  
  After attack + defense roll, if attacker has surge and the DC has `surgeAbilities` in dc-effects, show buttons (e.g. “Spend 1 surge: +2 damage”, “Spend 1 surge: Stun”). On click: apply that effect (extra damage, add condition), then resolve damage as now. Keeps surge resolution in one place (combat thread) and reuses existing `dcEffects` structure.
- **CC timing (document or soft-enforce)**  
  Add a small “when can I play this?” hint in the CC play flow (from `cc-effects.json` timing). Optionally: disable Play button for a card if current phase doesn’t match (e.g. “duringAttack” only when `pendingCombat` exists). Start with document + optional soft check.
- **Multi-figure defeat**  
  Verify: when one figure in a group dies, `healthState` and `figurePositions` stay in sync and DC embed shows remaining figures. Fix any bugs; no new systems.

**Result:** Surge is usable; timing is clearer; no weird state when a single figure in a group dies.

### Phase B2 — Ability system (bigger)
- **Ability registry**  
  One place (JSON + or code) that defines named abilities: id, name, type (surge / special / passive / triggered / etc.), when it runs, and what it does (e.g. “add damage”, “apply stun”, “move 2 spaces”). DC/CC effects reference ability ids (or names) instead of free text only.
- **DC/CC → abilities**  
  Map each DC’s surge/special and each CC’s effect to one or more ability ids. When the bot needs to resolve (e.g. after combat roll), it looks up the attacker’s surge abilities, shows choices, then runs the chosen ability’s logic against current game state.
- **Discord UX for abilities**  
  Buttons or menus in the right place (combat thread, activation message, etc.) to trigger abilities; bot applies state changes and updates messages.

**Result:** Card effects become “run this ability” instead of “remind human”; you can add new abilities without rewriting handler spaghetti.

### Phase B3 — Maps and edge rules
- **Map data for more maps**  
  Extend `map-spaces.json` (or equivalent) so every map you care about has spaces, adjacency, and terrain. Reuse/extend existing tooling (e.g. extract-map-spaces) so movement and LOS work everywhere.
- **Interior/exterior (if needed)**  
  Add per-space flags where cards (e.g. MASSIVE) depend on it; enforce in movement and ability checks.
- **Optional: stat tracking**  
  Game history, win rate by faction/DC, etc. — only after core playability and refactor are in a good place.

---

## Suggested order (for discussion)

1. **A1** — Extract state + data + router. Low risk, makes everything that follows easier to reason about.
2. **B1** — Surge + timing hint + multi-figure fix. Directly improves playability with minimal new structure.
3. **B2** — Ability registry and wiring. Unlocks “full” playable; can be incremental (start with surge abilities only, then specials, then CCs).
4. **A2** — Split handlers and game logic. Do when you’re about to add a lot of ability handlers or new flows.
5. **B3** — More maps + interior/exterior as needed.

---

## Decisions to make

- **Refactor first vs feature first?**  
  Refactor (A1) first → cleaner base for surge and abilities.  
  Feature first (B1) → faster visible progress; refactor after so new code lands in the right place.
- **How far to automate?**  
  Full automation (every ability in the registry) vs “surge + 20 most common abilities” vs “surge only, rest manual.” Drives scope of B2.
- **How many maps?**  
  “Just Mos Eisley” vs “all IACP maps” vs “subset.” Drives B3 effort.

Once you pick direction (e.g. “A1 then B1, then B2 for surge-only abilities”), we can break that into concrete tasks and file-level steps.
