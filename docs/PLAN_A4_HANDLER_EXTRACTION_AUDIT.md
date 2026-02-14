# A4 Handler Extraction — Comprehensive Audit

**Purpose:** Ensure handler extraction (A4) does not overlap, break flows, or introduce inconsistencies. Single source of truth for what exists, what depends on what, and how to extract safely.

---

## 1. Handler inventory (router vs code)

### 1.1 Router prefixes (src/router.js)

- **Buttons (59):** `request_resolve_`, `request_reject_`, `deck_illegal_play_`, `deck_illegal_redo_`, `dc_activate_`, `dc_unactivate_`, `dc_toggle_`, `dc_deplete_`, `dc_cc_special_`, `dc_move_`, `dc_attack_`, `dc_interact_`, `dc_special_`, `special_done_`, `move_mp_`, `move_adjust_mp_`, `move_pick_`, `attack_target_`, `combat_ready_`, `combat_roll_`, `combat_surge_`, `status_phase_`, `end_end_of_round_`, `end_start_of_round_`, `map_selection_`, `draft_random_`, `pass_activation_turn_`, `end_turn_`, `confirm_activate_`, `cancel_activate_`, `interact_cancel_`, `interact_choice_`, `refresh_map_`, `refresh_all_`, `undo_`, `determine_initiative_`, `deployment_zone_red_`, `deployment_zone_blue_`, `deployment_fig_`, `deployment_orient_`, `deploy_pick_`, `deployment_done_`, `cc_shuffle_draw_`, `cc_play_`, `cc_draw_`, `cc_search_discard_`, `cc_close_discard_`, `cc_discard_`, `kill_game_`, `default_deck_`, `squad_select_`, `lobby_join_`, `lobby_start_`
- **Modals (2):** `squad_modal_`, `deploy_modal_`
- **Selects (3):** `cc_attach_to_`, `cc_play_select_`, `cc_discard_select_`

### 1.2 Handlers in index.js (by prefix and line range)

| Prefix / customId | Approx. lines | Plan module |
|-------------------|---------------|-------------|
| `request_resolve_` | 4316–4337 | (requests / moderation) |
| `request_reject_` | 4339–4362 | (requests / moderation) |
| `squad_modal_` | 4369–4396 | cc-hand |
| `deploy_modal_` | 4401–4454 | cc-hand / setup |
| `cc_attach_to_` | 4459–4515 | cc-hand |
| `cc_play_select_` | 4520–4591 | cc-hand |
| `cc_discard_select_` | 4594–4642 | cc-hand |
| `deck_illegal_play_` | 4650–4675 | game-tools / cc-hand |
| `deck_illegal_redo_` | 4678–4712 | game-tools / cc-hand |
| `dc_activate_` | 4715–4811 | dc-play-area |
| `dc_unactivate_` | 4814–4882 | dc-play-area |
| `dc_toggle_` | 4885–5024 | dc-play-area |
| `dc_deplete_` | 5027–5064 | dc-play-area |
| `dc_cc_special_` | 5067–5131 | dc-play-area |
| `dc_move_` / `dc_attack_` / `dc_interact_` / `dc_special_` | 5134–5408 | dc-play-area |
| `special_done_` | 5411–5418 | special |
| `move_mp_` | 5423–5520 | movement |
| `move_adjust_mp_` | 5523–5558 | movement |
| `move_pick_` | 5563–5702 | movement |
| `attack_target_` | 5705–5907 | combat |
| `combat_ready_` | 5910–5958 | combat |
| `combat_roll_` | 5963–6051 | combat |
| `combat_surge_` | 6054–6121 | combat |
| `status_phase_` | 6124–6201 | activation |
| `end_end_of_round_` | 6204–6379 | round |
| `end_start_of_round_` | 6382–6458 | round |
| `map_selection_` | 6461–6541 | setup |
| `draft_random_` | 6544–6578 | setup |
| `pass_activation_turn_` | 6581–6633 | activation |
| `end_turn_` | 6636–6735 | activation |
| `confirm_activate_` | 6738–6806 | activation |
| `cancel_activate_` | 6809–6816 | activation |
| `interact_cancel_` | 6819–6831 | interact |
| `interact_choice_` | 6834–6907 | interact |
| `refresh_map_` | 6910–6935 | game-tools |
| `refresh_all_` | 6938–6958 | game-tools |
| `undo_` | 6961–7033 | game-tools |
| `determine_initiative_` | 7036–7080 | setup |
| `deployment_zone_red_` / `deployment_zone_blue_` | 7083–7162 | setup |
| `deployment_fig_` | 7165–7288 | setup |
| `deployment_orient_` | 7291–7384 | setup |
| `deploy_pick_` | 7387–7478 | setup |
| `deployment_done_` | 7481–7635 | setup |
| `cc_shuffle_draw_` | 7638–7684 | cc-hand |
| `cc_play_` | 7687–7716 | cc-hand |
| `cc_draw_` | 7719–7758 | cc-hand |
| `cc_search_discard_` | 7761–7829 | cc-hand |
| `cc_close_discard_` | 7832–7863 | cc-hand |
| `cc_discard_` | 7866–7895 | cc-hand |
| `kill_game_` | 7898–7951 | game-tools |
| `default_deck_` | 7954–7993 | game-tools |
| `squad_select_` | 7996–8043 | game-tools / cc-hand |
| `lobby_join_` | 8046–8085 | lobby |
| `lobby_start_` | 8086–8196 | lobby |
| `create_game` / `join_game` | 8187–8198 | lobby / main menu |

### 1.3 Overlap and gaps

- **Router vs handlers:** Every router prefix has exactly one handler block in index. No duplicate handling of the same prefix.
- **Order:** Router uses first-match; index uses explicit `if (buttonKey === '...')` so order of checks does not change behavior.
- **Unregistered IDs:** `create_game` and `join_game` are **not** in `BUTTON_PREFIXES`. So when `customId` is `create_game` or `join_game`, `getHandlerKey(interaction.customId, 'button')` returns `null`, and the code does `if (!buttonKey) return` and never reaches the `create_game` / `join_game` block. **Conclusion:** That block (lines 8186–8198) is currently **dead code** unless these buttons are never sent or are handled elsewhere. **Action:** Add `create_game` and `join_game` to the router (e.g. as literal IDs or a single prefix like `main_menu_`) and ensure they are dispatched, or remove the dead block and fix the menu to use registered IDs.

---

## 2. Globals and shared state

| Symbol | Location | Used by |
|--------|----------|--------|
| `games` | game-state.js (internal); getGame/setGame/saveGames exported | All game handlers |
| `dcMessageMeta`, `dcExhaustedState`, `dcDepletedState`, `dcHealthState`, `pendingIllegalSquad` | game-state.js | dc-play-area, cc-hand, game-tools |
| `lobbies` | index.js (line 1212) | lobby_join_, lobby_start_ only |
| `MAX_ACTIVE_GAMES_PER_PLAYER` | index.js (1221) | lobby, messageCreate |
| `PENDING_ILLEGAL_TTL_MS` | index.js (3119) | deck_illegal_play_ |
| `DC_ACTIONS_PER_ACTIVATION` | index.js (3154) | dc_activate_, dc_toggle_, end_start_of_round_, etc. |

**Risks:**

- **lobbies:** Not in game-state. Lobby handlers must receive `lobbies` via context or we move `lobbies` into game-state (or a dedicated `src/lobby-state.js`).
- **Constants:** Should be moved to a shared config or left in index and passed in context until a later cleanup.

---

## 3. Dependencies (where handlers get their helpers)

- **Already in modules:**  
  - **game-state.js:** getGame, setGame, saveGames, loadGames, getGamesMap, deleteGame, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, pendingIllegalSquad  
  - **data-loader.js:** getDcStats, getDcEffects, getMapSpaces, getDeploymentZones, getCcEffect, getDcKeywords, getDiceData, getMissionCardsData, getMapTokensData, getMapRegistry, getDcImages, getFigureImages, getFigureSizes, getMapSpacesData, getCcEffectsData, isCcAttachment, reloadGameData  
  - **game/index.js:** validateDeckLegal, resolveDcName, DC_POINTS_LEGAL, CC_CARDS_LEGAL, CC_COST_LEGAL  
  - **discord/index.js:** buildScorecardEmbed, getInitiativePlayerZoneLabel, logPhaseHeader, logGameAction, logGameErrorToBotLogs, chunkButtonsToRows, getButtonStyle, etc.  
  - **Note:** `src/discord/messages.js` is referenced by `discord/index.js` but the file is **missing** in the repo; if the bot runs, it may be failing on load or messages are defined elsewhere. Verify and add messages.js or fix exports.

- **Still only in index.js:** 100+ helpers (e.g. buildAttachmentEmbedsAndFiles, updateAttachmentMessageForDc, getReachableSpaces, getPathCost, rollAttackDice, buildBoardMapPayload, getGeneralSetupButtons, createGameChannels, getLobbyEmbed, getLobbyStartButton, applySquadSubmission, updateDeployPromptMessages, pushUndo, etc.). Handlers in separate files cannot import from index (circular dependency). So either:
  - **Option A:** Move all needed helpers into game/ and discord/ first (complete A5/A6), then extract handlers; or  
  - **Option B:** Pass a **context** object from index into each handler that includes those helpers (and globals like lobbies). Then incrementally move helpers to game/discord and remove from context.

**Recommendation:** Use **Option B** for A4: extract handlers to `src/handlers/*`, each handler receives `(interaction, context)`. Context is built in index and includes getGame, setGame, saveGames, lobbies, constants, and all index-only helpers. No change to behavior; we can later move helpers and shrink context.

---

## 4. Plan module → file mapping (no overlap)

| File | Prefixes / handlers |
|------|----------------------|
| **handlers/lobby.js** | lobby_join_, lobby_start_ |
| **handlers/requests.js** | request_resolve_, request_reject_ (optional; can stay in index) |
| **handlers/setup.js** | map_selection_, draft_random_, determine_initiative_, deployment_zone_red_, deployment_zone_blue_, deployment_fig_, deployment_orient_, deploy_pick_, deployment_done_, deploy_modal_ (if kept with setup) |
| **handlers/activation.js** | status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_ |
| **handlers/dc-play-area.js** | dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_, dc_attack_, dc_interact_, dc_special_ |
| **handlers/movement.js** | move_mp_, move_pick_, move_adjust_mp_ |
| **handlers/combat.js** | attack_target_, combat_ready_, combat_roll_, combat_surge_ |
| **handlers/special.js** | special_done_ |
| **handlers/interact.js** | interact_choice_, interact_cancel_ |
| **handlers/cc-hand.js** | squad_modal_, cc_attach_to_, cc_play_select_, cc_discard_select_, cc_shuffle_draw_, cc_play_, cc_draw_, cc_search_discard_, cc_close_discard_, cc_discard_, deck_illegal_play_, deck_illegal_redo_, squad_select_ (and deploy_modal_ if grouped with cc-hand) |
| **handlers/round.js** | end_end_of_round_, end_start_of_round_ |
| **handlers/game-tools.js** | refresh_map_, refresh_all_, undo_, kill_game_, default_deck_ |

**Deploy modal:** Plan lists deploy_modal_ under cc-hand and setup; it’s deployment-related. Keep in **setup.js** so setup owns all deployment UI.

---

## 5. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Handler runs without game (e.g. wrong channel) | Keep existing guards (getGame(gameId), reply "Game not found", etc.) inside each extracted handler. |
| Prefix order (first match) | Router order is fixed; handler modules don’t change which prefix matches. No change. |
| Double dispatch | Each customId matches one prefix; one handler per prefix. No double dispatch. |
| Shared mutable state | Handlers only use getGame/setGame/saveGames and context; no new globals. Lobbies passed via context. |
| create_game / join_game unreachable | Add prefixes or a catch-all for these IDs so the block is reachable (see 1.3). |
| Missing discord/messages.js | Create messages.js with logGameAction, logPhaseHeader, logGameErrorToBotLogs, GAME_PHASES, ACTION_ICONS, or fix discord/index.js to not depend on it. |

---

## 6. Safe execution order

1. **Fix router for create_game / join_game** so the main-menu block is reachable (add to BUTTON_PREFIXES or handle via a separate path).
2. **Add handlers registry:** `src/handlers/index.js` exports `getHandler(handlerKey)` returning `async (interaction, context) => {}` for each key. Initially return handlers that still run the existing logic by calling into functions that remain in index (see step 4).
3. **Define context shape:** In index, build `context = { getGame, setGame, saveGames, loadGames, getGamesMap, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, pendingIllegalSquad, lobbies, MAX_ACTIVE_GAMES_PER_PLAYER, PENDING_ILLEGAL_TTL_MS, DC_ACTIONS_PER_ACTIVATION, ... (all index helpers used by handlers) }` and pass to handlers.
4. **Extract one domain at a time:** Start with **lobby** (small, clear deps). Create `handlers/lobby.js` with `handleLobbyJoin(interaction, context)` and `handleLobbyStart(interaction, context)`. Register them in `handlers/index.js`. In index, replace the two `if (buttonKey === 'lobby_join_')` / `lobby_start_` blocks with `const handler = getHandler(buttonKey); if (handler) { await handler(interaction, context); return; }`. Verify behavior unchanged.
5. **Extract remaining domains** in order: requests (optional) → setup → activation → dc-play-area → movement → combat → special → interact → cc-hand → round → game-tools. After each, run a quick smoke test (create game, join, map select, one activation, one move, one attack if possible).
6. **Do not** remove or reorder router prefixes; do not add a second handler for the same prefix.

---

## 7. Checklist before each extraction

- [ ] Handler key matches router prefix exactly.
- [ ] Handler receives only `(interaction, context)`; no import from index.
- [ ] Context includes every helper and global this handler uses.
- [ ] Index replaces the old block with a single call to the registered handler.
- [ ] No other code path calls the same handler for the same customId (no overlap).

---

---

## 8. Done (this session)

- **Router:** Added `create_game` and `join_game` to `BUTTON_PREFIXES` so those buttons are reachable.
- **index.js:** Main-menu block now runs when `buttonKey === 'create_game'` or `'join_game'` (explicit branches before catch).
- **Handler registry:** `src/handlers/index.js` exports `getHandler(key)` and registers `lobby_join_`, `lobby_start_`.
- **Lobby extracted:** `src/handlers/lobby.js` implements `handleLobbyJoin(interaction, ctx)` and `handleLobbyStart(interaction, ctx)`. Index builds a lobby context (getGame, setGame, lobbies, countActiveGamesForPlayer, MAX_ACTIVE_GAMES_PER_PLAYER, getLobbyEmbed, getLobbyStartButton, updateThreadName, createGameChannels, getGeneralSetupButtons, logGameErrorToBotLogs, EmbedBuilder) and calls the handlers. No overlap: only these two prefixes are dispatched to handlers; all others remain in index.

**Next step:** Extract further domains (setup, activation, dc-play-area, movement, combat, etc.) one at a time using the same pattern: add handler file, register in handlers/index.js, build context in index, replace the corresponding if-block with a handler call.
