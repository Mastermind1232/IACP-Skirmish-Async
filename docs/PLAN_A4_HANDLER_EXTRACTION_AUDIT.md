# A4 Handler Extraction — Comprehensive Audit

**Purpose:** Ensure handler extraction (A4) does not overlap, break flows, or introduce inconsistencies. Single source of truth for what exists, what depends on what, and how to extract safely.

---

## A1–A8 status (Phase 1 — Architecture)

| ID | Item | Status | Notes |
|----|------|--------|--------|
| **A1** | Game state → `src/game-state.js` | ✅ Done | games, dcMessageMeta, dcExhaustedState, dcDepletedState, dcHealthState, pendingIllegalSquad; getGame, setGame, persist |
| **A2** | Data loading → `src/data-loader.js` | ✅ Done | JSON load, reloadGameData; getDcStats, getDcEffects, getMapSpaces, getDice, getCcEffect, etc. |
| **A3** | Interaction router | ✅ Done | `src/router.js`; prefix → handler key; create_game / join_game in BUTTON_PREFIXES |
| **A4** | Handlers → `src/handlers/*` | ✅ Done | **Extracted:** lobby (2), requests (2), game-tools (5), special (1), interact (2), round (2), movement (3), combat (4), activation (5), setup (8), DC-play-area (6), **CC-hand (2 modals, 3 selects, 9 buttons)**. |
| **A5** | Game logic → `src/game/*` | ✅ Done | **Extracted:** `coords.js` (parseCoord, normalizeCoord, getFootprintCells, etc.), `movement.js` (getBoardStateForMovement, getMovementProfile, computeMovementCache, getReachableSpaces, getPathCost, filterMapSpacesByBounds, …), `combat.js` (rollAttackDice, rollDefenseDice, getAttackerSurgeAbilities, parseSurgeEffect, computeCombatResult). Validation already in `validation.js`. Index uses game/* and data-loader getFigureSize. |
| **A6** | Discord helpers → `src/discord/*` | ✅ Done | **Moved:** embeds.js (formatHealthSection, CARD_BACK_CHAR, getPlayAreaTooltipEmbed, getHandTooltipEmbed, getHandVisualEmbed, getDiscardPileEmbed, getLobbyRosterText, getLobbyEmbed, getDeployDisplayNames, EMBEDS_PER_MESSAGE). messages.js (getActivationsLine, DC_ACTIONS_PER_ACTIVATION, getActionsCounterContent, updateActivationsMessage, getThreadName, updateThreadName). components.js (getDiscardPileButtons, getDcToggleButton, getDcPlayAreaComponents, FIGURE_LETTERS, getUndoButton, getBoardButtons, getGeneralSetupButtons, getDetermineInitiativeButtons, getDeploymentZoneButtons, getDeploymentDoneButton, getMainMenu, getLobbyJoinButton, getLobbyStartButton, getCcShuffleDrawButton, getCcActionButtons, getSelectSquadButton, getHandSquadButtons, getKillGameButton, getRequestActionButtons, getMoveMpButtonRows, getMoveSpaceGridRows, getDeployFigureLabels, getDeployButtonRows, getDeploySpaceGridRows, getDcActionButtons, getActivateDcButtons). Index keeps thin wrappers where helpers are needed (getDcPlayAreaComponents, getDcActionButtons, getActivateDcButtons, getDeployFigureLabels, getDeployButtonRows). **Still in index (future pass):** buildBoardMapPayload, buildDcEmbedAndFiles, updateDcActionsMessage, buildHandDisplayPayload, getCommandCardImagePath, clearPreGameSetup, runDraftRandom, getFiguresForRender, getMapTokensForRender, updateDeployPromptMessages, getDeploymentMapAttachment, and other orchestration helpers. |
| **A7** | Test suite for `src/game/*` | ✅ Done | Node built-in test runner; `npm test` runs `src/game/*.test.js`. Coverage: coords (10), combat (9), movement (13), validation (5). data-loader uses lazy import of map-renderer so tests run without native canvas. |
| **A8** | Error-handling pattern | ✅ Done | `src/error-handling.js`: isRetryableDiscordError, withDiscordRetry, replyOrFollowUpWithRetry. Top-level interactionCreate catch logs via logGameErrorToBotLogs and sends user message with retry (3 attempts, exponential backoff); on retryable exhaustion shows "Something went wrong… try again in 2–3 minutes." Handlers continue to log + ephemeral reply; optional use of withDiscordRetry for critical reply/edit after state change. |

**A4 detail (handlers):**

| Domain | File | Prefixes | Status |
|--------|------|----------|--------|
| Lobby | `handlers/lobby.js` | lobby_join_, lobby_start_ | ✅ |
| Requests | `handlers/requests.js` | request_resolve_, request_reject_ | ✅ |
| Game-tools | `handlers/game-tools.js` | refresh_map_, refresh_all_, undo_, kill_game_, default_deck_ | ✅ |
| Special | `handlers/special.js` | special_done_ | ✅ |
| Interact | `handlers/interact.js` | interact_cancel_, interact_choice_ | ✅ |
| Round | `handlers/round.js` | end_end_of_round_, end_start_of_round_ | ✅ |
| Movement | `handlers/movement.js` | move_mp_, move_adjust_mp_, move_pick_ | ✅ |
| Combat | `handlers/combat.js` | attack_target_, combat_ready_, combat_roll_, combat_surge_ | ✅ |
| Activation | `handlers/activation.js` | status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_ | ✅ |
| Setup | `handlers/setup.js` | map_selection_, draft_random_, determine_initiative_, deployment_zone_red_/blue_, deployment_fig_, deployment_orient_, deploy_pick_, deployment_done_ | ✅ |
| DC-play-area | `handlers/dc-play-area.js` | dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_ | ✅ |
| CC-hand + modals | `handlers/cc-hand.js` | squad_modal_, deploy_modal_, cc_attach_to_, cc_play_select_, cc_discard_select_, deck_illegal_play_/redo_, cc_shuffle_draw_, cc_play_, cc_draw_, cc_search_discard_, cc_close_discard_, cc_discard_, squad_select_ | ✅ |

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
- **create_game / join_game:** Both are in `BUTTON_PREFIXES` (router.js). They are handled in index.js when `buttonKey === 'create_game'` or `'join_game'` (main menu). No longer dead code.

---

## 2. Globals and shared state

| Symbol | Location | Used by |
|--------|----------|--------|
| `games` | game-state.js (internal); getGame/setGame/saveGames exported | All game handlers |
| `dcMessageMeta`, `dcExhaustedState`, `dcDepletedState`, `dcHealthState`, `pendingIllegalSquad` | game-state.js | dc-play-area, cc-hand, game-tools |
| Lobby state | lobby-state.js (getLobby, setLobby, hasLobby, hasLobbyEmbedSent, markLobbyEmbedSent, getLobbiesMap) | index (messageCreate), lobby handlers via context.lobbies |
| `MAX_ACTIVE_GAMES_PER_PLAYER`, `PENDING_ILLEGAL_TTL_MS` | constants.js | index, lobby, cc-hand (via context) |
| `DC_ACTIONS_PER_ACTIVATION` | discord/messages.js | dc_activate_, dc_toggle_, end_start_of_round_, etc. |

**Phase 1 complete.** Lobbies and config constants moved to `src/lobby-state.js` and `src/constants.js`. **Phase 2 started:** F1 ability library scaffold (`data/ability-library.json`, `src/game/abilities.js`), F2 surge wired to library (combat uses resolveSurgeAbility, getSurgeAbilityLabel). Next: F5 CC timing, F7 multi-figure defeat, F3/F4 DC/CC abilities, etc.

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
| create_game / join_game unreachable | Resolved: both in BUTTON_PREFIXES and handled in index. |
| Missing discord/messages.js | Resolved: created `src/discord/messages.js` with PHASE_COLOR, GAME_PHASES, ACTION_ICONS, logPhaseHeader, logGameAction, logGameErrorToBotLogs. |

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

**Next step:** Extract further domains (setup, activation, dc-play-area, combat, cc-hand) one at a time using the same pattern.

---

## 9. Done this session (continued — "continue all the way")

- **Requests:** `src/handlers/requests.js` — `handleRequestResolve`, `handleRequestReject`. Context: `logGameErrorToBotLogs`. Handler uses `PermissionFlagsBits` from discord.js.
- **Game-tools:** `src/handlers/game-tools.js` — `handleRefreshMap`, `handleRefreshAll`, `handleUndo`, `handleKillGame`, `handleDefaultDeck`. Context per handler: getGame, client, and the helpers each needs.
- **Special:** `src/handlers/special.js` — `handleSpecialDone` (no context).
- **Interact:** `src/handlers/interact.js` — `handleInteractCancel`, `handleInteractChoice`. Context: getGame, dcMessageMeta, getLegalInteractOptions, getDcStats, updateDcActionsMessage, logGameAction, saveGames.
- **Round:** `src/handlers/round.js` — `handleEndEndOfRound`, `handleEndStartOfRound`. Large context (getPlayerZoneLabel, dcMessageMeta, dcExhaustedState, dcHealthState, isDepletedRemovedFromGame, buildDcEmbedAndFiles, getDcPlayAreaComponents, countTerminalsControlledByPlayer, isFigureInDeploymentZone, checkWinConditions, getMapTokensData, getSpaceController, getInitiativePlayerZoneLabel, updateHandVisualMessage, buildHandDisplayPayload, sendRoundActivationPhaseMessage; and for start-of-round: GAME_PHASES, PHASE_COLOR, shouldShowEndActivationPhaseButton).
- **Movement:** `src/handlers/movement.js` — `handleMoveMp`, `handleMoveAdjustMp`, `handleMovePick`. Context: getGame, dcMessageMeta, getBoardStateForMovement, getMovementProfile, ensureMovementCache, computeMovementCache, getSpacesAtCost, clearMoveGridMessages, getMoveSpaceGridRows, getMovementMinimapAttachment, editDistanceMessage, getMoveMpButtonRows, normalizeCoord, getMovementTarget, getFigureSize, getNormalizedFootprint, resolveMassivePush, updateMovementBankMessage, getMovementPath, pushUndo, logGameAction, countTerminalsControlledByPlayer, buildBoardMapPayload, saveGames, client.
- **Registry:** All of the above registered in `handlers/index.js`; index imports and calls them with the appropriate context.
- **Combat:** `resolveCombatAfterRolls` moved to **top-level** in index.js (after `findDcMessageIdForFigure`). `src/handlers/combat.js` — `handleAttackTarget`, `handleCombatReady`, `handleCombatRoll`, `handleCombatSurge`. Context: getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, updateDcActionsMessage, ACTION_ICONS, ThreadAutoArchiveDuration, resolveCombatAfterRolls, saveGames, client, rollAttackDice, rollDefenseDice, getAttackerSurgeAbilities, SURGE_LABELS, parseSurgeEffect. Index dispatches all four combat prefixes with a single `combatContext` and handler calls.
- **Activation:** `src/handlers/activation.js` — `handleStatusPhase`, `handlePassActivationTurn`, `handleEndTurn`, `handleConfirmActivate`, `handleCancelActivate`. Context: getGame, replyIfGameEnded, hasActionsRemainingInGame, GAME_PHASES, PHASE_COLOR, getInitiativePlayerZoneLabel, getPlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, client, dcMessageMeta, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, maybeShowEndActivationPhaseButton, dcExhaustedState, updateActivationsMessage, getActionsCounterContent, getDcActionButtons, getActivationMinimapAttachment, getActivateDcButtons, DC_ACTIONS_PER_ACTIVATION, ThreadAutoArchiveDuration, ACTION_ICONS. Index dispatches all five activation prefixes with a single `activationContext`.

**Still in index.js (extract in follow-up):** DC-play-area (dc_activate_, dc_unactivate_, dc_toggle_, dc_deplete_, dc_cc_special_, dc_move_/dc_attack_/dc_interact_/dc_special_). deploy_modal_ (modal; setup-related). CC-hand (squad_modal_, deploy_modal_, cc_attach_to_, cc_play_select_, cc_discard_select_, deck_illegal_*, cc_shuffle_draw_, cc_play_, cc_draw_, cc_search_discard_, cc_close_discard_, cc_discard_, squad_select_). Same pattern: create handler file, register, build context in index, replace if-block.

---

## 10. Audit — is everything going smoothly? (current)

- **Router ↔ registry:** Every button prefix that has an extracted handler is registered in `src/handlers/index.js`. No router prefix points to a missing handler. Extracted: lobby (2), requests (2), game-tools (5), special (1), interact (2), round (2), movement (3), combat (4), activation (5) = 26 handlers.
- **Index dispatch:** For each extracted prefix, index builds context and calls the handler; old inline blocks removed. No duplicate handling.
- **Context pattern:** Handlers receive `(interaction, context)`; no handler imports from index; context built in index. Consistent across all extracted domains.
- **create_game / join_game:** In router and handled in index. No longer dead.
- **Remaining:** DC-play-area, setup, cc-hand. Section 1.2 line numbers are from an earlier snapshot (shifted after extractions).
- **Conclusion:** Extraction is consistent and on plan. Safe to continue.

**Setup (full):** `src/handlers/setup.js` — `handleMapSelection`, `handleDraftRandom`, `handleDetermineInitiative`, `handleDeploymentZone` (red/blue), `handleDeploymentFig`, `handleDeploymentOrient`, `handleDeployPick`, `handleDeploymentDone`. Single `setupContext` in index includes: getGame, getPlayReadyMaps, postMissionCardAfterMapSelection, buildBoardMapPayload, logGameAction, getGeneralSetupButtons, createHandChannels, getHandTooltipEmbed, getSquadSelectEmbed, getHandSquadButtons, runDraftRandom, logGameErrorToBotLogs, extractGameIdFromInteraction, clearPreGameSetup, getDeploymentZoneButtons, getDeploymentZones, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, pushUndo, updateDeployPromptMessages, getInitiativePlayerZoneLabel, getCcShuffleDrawButton, client, saveGames. All setup button handlers extracted; deploy_modal_ (modal) remains in index for now.
