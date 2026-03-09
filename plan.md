# Comprehensive Refactoring & Feature Plan

## Deep Audit Summary

Full line-by-line audit of all 47,000+ lines across 47 production files. Below are the findings organized into prioritized work streams.

---

## Phase 1: Bug Fixes & Critical Issues (Do First)

### 1A. Button Overflow — Two-Tier Dropdown Picker *(original feature request)*

**Problem:** When >25 valid buttons exist (Discord's 5×5 limit), buttons are silently dropped. Minimap shows all valid cells but buttons don't match.

**Affected call sites (8 total):**
- `getSpaceChoiceRows` — 7 call sites: Overwatch, Pounce (×2), False Orders, Rush, CC space (×2)
- `buildLetterRows` — 3 call sites: movement initial, move-pick continuation, letter-back

**Approach:**
1. Add `buildRowPickerSelect(customIdPrefix, validSpaces, mapSpaces)` in `components.js`
2. Modify `getSpaceChoiceRows` to return `{ rows, available, overflowed }`
3. At each call site: when `overflowed`, show select menu dropdown instead of buttons
4. Add per-context select handlers + "Back to Rows" button handlers
5. Add `buildLetterPickerSelect` for movement letter overflow
6. Update `router.js` prefixes and `index.js` dispatch

**Files:** `components.js`, `router.js`, `index.js`, `dc-play-area.js`, `cc-hand.js`, `movement.js`

### 1B. Orphaned Handler: `dc_cc_defender_`

**Problem:** `dc_cc_defender_` is registered in `router.js` BUTTON_PREFIXES (line 19) but has NO dispatch in `index.js`. If a user clicks this button, nothing happens.

**Fix:** Either add the handler dispatch or remove the dead prefix.

**Files:** `router.js`, `index.js`

### 1C. `updateHandChannelMessages` Called With Wrong Arguments

**Problem:** At `index.js:8712`, inside the Mastery handler, the function is called as:
```js
await updateHandChannelMessages(mastGame, mastAPN, client).catch(() => {});
```
But the function signature at `index.js:6481` is:
```js
async function updateHandChannelMessages(game, client)
```
This means `mastAPN` (a number like `1` or `2`) is passed as the Discord `client` parameter. When the function tries to call `client.channels.fetch(handId)`, it crashes because `(2).channels` is `undefined`. The `.catch(() => {})` silently swallows the error.

**Impact:** After Mastery returns a card from discard to hand, the Hand channel message never updates. The player doesn't see the returned card in their hand UI until the next natural refresh.

**Fix:** Change the call to `updateHandChannelMessages(mastGame, client)`.

**Files:** `index.js`

### 1D. DC Name Extraction Uses `split('-')[0]` Instead of Regex

**Problem:** At `index.js:2999`, inside `runDraftRandom`'s `deployForPlayer`:
```js
const dcName = k.split('-')[0];
```
For figure keys like `Obi-Wan Kenobi-1-0`, this extracts `Obi` instead of `Obi-Wan Kenobi`. The rest of the codebase correctly uses `.replace(/-\d+-\d+$/, '')`.

**Impact:** During random auto-deployment, footprint size is looked up using the wrong DC name, potentially allowing overlapping figure placements or throwing errors for unrecognized names.

**Fix:** Change to `const dcName = k.replace(/-\d+-\d+$/, '');`

**Files:** `index.js`

### 1E. Dead Variable `_spDefEff` (Minor)

**Problem:** At `index.js:3747`, `_spDefEff` is assigned but never read. The Self-Preservation logic correctly uses `_spEff` (line 3750) instead. This is dead code left over from a refactor.

**Fix:** Remove the unused variable.

**Files:** `index.js`

### 1F. Dead Code: `dcDepletedState` is Write-Only

**Problem:** `dcDepletedState` Map (game-state.js:64) is written to in 6 places but **never read anywhere**. It's populated on load, set during setup, and deleted on cleanup — but no handler ever calls `.get()` on it.

**Fix:** Audit whether depletion tracking was intended. If not needed, remove all writes. If needed, implement the read side.

**Files:** `game-state.js`, `index.js`, `botmenu.js`

---

## Phase 2: Extract Core Helpers (Biggest Bang for Buck)

These eliminate the worst duplication. Each one replaces 15-50+ copy-pasted code blocks.

### 2A. Extract `applyDamageToFigure()` helper

**Problem:** The health-state-update pattern appears **15+ times** across `index.js` and handlers:
```js
const hs = dcHealthState.get(msgId) || [];
const [cur, max] = hs[figIdx];
const newCur = Math.max(0, (cur ?? max) - damage);
hs[figIdx] = [newCur, max];
dcHealthState.set(msgId, hs);
const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
const idx = (dcIds || []).indexOf(msgId);
if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
```
Every copy risks divergence (some use `max ?? newCur`, some use `max ?? cur`).

**Fix:** Create `applyDamageToFigure(game, playerNum, msgId, figIdx, damage, { dcHealthState })` that:
- Updates dcHealthState Map
- Syncs to game.p{N}DcList
- Returns `{ newCur, max, wasDefeated }`

**Locations to replace:** index.js:3283, 3331, 3407, 3677, 3733, 3854, 4000, 4174; combat.js:82, 432, 2887, 3567, 3785; movement.js:546; round.js:110

**Files:** New `src/game/health.js`, then update `index.js`, `combat.js`, `movement.js`, `round.js`

### 2B. Extract `awardVp()` helper

**Problem:** VP award pattern appears **20+ times**:
```js
const vpKey = `player${playerNum}VP`;
game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
game[vpKey].kills += vp;
game[vpKey].total += vp;
```

**Fix:** Create `awardVp(game, playerNum, amount, category = 'kills')`.

**Locations:** index.js:3299, 3350, 3427, 3656, 4078, 4111, 4136, 4454, 4797, 5696, 5795 (and more)

**Files:** New function in `src/game/scoring.js` or add to existing game module

### 2C. Extract `getPlayerProp()` helpers

**Problem:** Player-number ternary appears **50+ times**:
```js
const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
```

**Fix:** Create helpers:
```js
export function getPlayerId(game, pn) { return pn === 1 ? game.player1Id : game.player2Id; }
export function getDcList(game, pn) { return pn === 1 ? game.p1DcList : game.p2DcList; }
export function getDcMessageIds(game, pn) { return pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds; }
export function getHand(game, pn) { return pn === 1 ? game.player1CcHand : game.player2CcHand; }
// etc.
```

**Files:** New `src/game/player-helpers.js`, then find-and-replace across codebase

### 2D. Extract `applyCondition()` / `removeCondition()` helpers

**Problem:** Condition application pattern with immunity check appears **20+ times**:
```js
game.figureConditions = game.figureConditions || {};
game.figureConditions[figureKey] = game.figureConditions[figureKey] || [];
if (HARMFUL_CONDITIONS.includes(c) && isConditionImmune(game, figureKey)) { /* skip */ }
else if (!game.figureConditions[figureKey].includes(c)) {
  game.figureConditions[figureKey].push(c);
}
```

**Fix:** Create `applyCondition(game, figureKey, condition)` that handles immunity, dedup, and logging.

**Files:** Extend `src/game/conditions.js`, update `index.js`, `combat.js`, `dc-play-area.js`

---

## Phase 3: Structural Refactoring (index.js Split)

### 3A. Extract Context Factory from index.js

**Problem:** ~150 context object assemblies in `index.js` lines 7420-9700, each manually selecting 5-30 properties:
```js
if (buttonKey === 'move_letter_') {
  const moveLetterContext = {
    getGame, dcMessageMeta, clearMoveGridMessages,
    getMoveSpaceGridRows, buildLetterRows,
  };
  await handleMoveLetter(interaction, moveLetterContext);
  return;
}
```

**Fix:** Create a context factory that builds context objects declaratively:
```js
// context-factory.js
const HANDLER_CONTEXTS = {
  'move_letter_': ['getGame', 'dcMessageMeta', 'clearMoveGridMessages', 'getMoveSpaceGridRows', 'buildLetterRows'],
  'move_pick_': ['getGame', 'dcMessageMeta', ...],
  // ...
};
export function buildContext(handlerKey, allDeps) {
  const keys = HANDLER_CONTEXTS[handlerKey];
  return Object.fromEntries(keys.map(k => [k, allDeps[k]]));
}
```
This cuts ~2,000 lines of boilerplate from index.js.

**Files:** New `src/context-factory.js`, refactor `index.js` dispatch section

### 3B. Split index.js into focused modules

**Problem:** index.js is 9,802 lines containing:
- Lines 1-350: Imports
- Lines 358-800: Helper functions (game logic that shouldn't be here)
- Lines 801-1200: Bot initialization
- Lines 1200-7200: Game logic functions defined inline
- Lines 7420-9700: Interaction dispatch

**Fix:** Split into:
1. `src/app.js` — Bot initialization, startup, shutdown
2. `src/orchestrator.js` — Game logic helpers currently inline (lines 358-7200)
3. `src/dispatcher.js` — Interaction routing (uses context factory)
4. `index.js` — Entry point, imports and wires everything together

**Files:** New `src/app.js`, `src/orchestrator.js`, `src/dispatcher.js`, slim down `index.js`

### 3C. Move inline functions to proper modules

**Problem:** 33+ functions defined in index.js (lines 6000-9800) that belong in handler or game modules:
- `getDcStats` (6029) → should be in `data-loader.js`
- `collectOverlappingFigures` (825) → should be in `src/game/movement.js`
- `resolveMassivePush` (885) → should be in `src/game/movement.js`
- `applySquadSubmission` (6686) → should be in `src/handlers/setup.js`
- `populatePlayAreas` (6561) → should be in `src/handlers/setup.js`
- `updateDcActionsMessage` (6205) → should be in `src/discord/messages.js`
- `buildDcEmbedAndFiles` (6396) → should be in `src/discord/embeds.js`
- `drawStartingHand` (nested in runDraftRandom, 3044) → extract to named function

**Files:** Move functions to their natural homes, update imports

---

## Phase 4: Safety & Reliability

### 4A. Add Discord message character limit protection

**Problem:** No character limit checks anywhere. Discord has a 2000-char message limit and 1024-char embed field limit. `logGameAction()`, `applyAbilityResult`, and embed builders can exceed these.

**Fix:** Add `enforceContentLimit(content, max = 2000)` utility, apply to:
- `messages.js:logGameAction` — truncate content
- `embeds.js:formatHealthSection` — truncate field values
- `apply-ability-result.js` — truncate logMessage

**Files:** New utility in `src/discord/limits.js`, update `messages.js`, `embeds.js`, `apply-ability-result.js`

### 4B. Add per-game mutex for state mutations

**Problem:** No concurrency protection. Two Discord interactions can modify the same game object concurrently via interleaved async operations, causing state corruption.

**Fix:** Use the existing `async-mutex` dependency (already in package.json!) to lock per-gameId:
```js
const gameLocks = new Map();
function getGameLock(gameId) {
  if (!gameLocks.has(gameId)) gameLocks.set(gameId, new Mutex());
  return gameLocks.get(gameId);
}
// In dispatcher:
const lock = getGameLock(gameId);
await lock.runExclusive(() => handler(interaction, ctx));
```

**Files:** `src/game-state.js` (add lock), `index.js` or `dispatcher.js` (wrap handlers)

### 4C. Make saveGames() awaitable

**Problem:** `saveGamesToDb()` is fire-and-forget (line 109-112). Failed saves are silently logged. Graceful shutdown may not complete writes.

**Fix:** Make `saveGames()` return a Promise. Critical handlers can `await saveGames()`. Add retry with exponential backoff for DB write failures.

**Files:** `game-state.js`, `db.js`

### 4D. Atomic health state sync

**Problem:** `dcHealthState` Map and `game.p{N}DcList[].healthState` are two sources of truth. `syncHealthStateToGames()` only runs pre-save. If a crash occurs between mutation and save, health changes are lost.

**Fix:** The `applyDamageToFigure()` helper from Phase 2A already solves this by updating both atomically. Ensure all health mutations go through it.

### 4E. Add internal Discord retry for `.edit()` and `.send()`

**Problem:** `withDiscordRetry()` exists in `error-handling.js` but is only used for interaction replies. Internal operations (msg.edit, channel.send) use bare `.catch(() => {})`.

**Fix:** Wrap critical `.edit()` and `.send()` calls with `withDiscordRetry()`.

**Files:** `dc-play-area.js`, `activation.js`, `movement.js`, `apply-ability-result.js`

---

## Phase 5: Code Quality (Nice to Have)

### 5A. Parallelize map renderer image loading

**Problem:** Token and condition icon loading is sequential (`await` in for-loops). A map with 20 tokens = 20 sequential file loads.

**Fix:** Use `Promise.all()` for independent image loads.

**Files:** `map-renderer.js`

### 5B. Replace magic numbers with constants

**Problem:** Hardcoded values scattered throughout:
- `speed * 1.75`, `speed * 2.5` (minimap extent multipliers)
- `99` (fallback max HP)
- `4` (Figurehead range), `3` (Brutal Tactics range)
- `VP_TABLE = [0, 2, 5, 10, 20]`

**Fix:** Extract to named constants in `src/constants.js`.

### 5C. Standardize error handling in handlers

**Problem:** Mix of patterns:
- `.catch((err) => { console.error('[discord]', err?.message ?? err); })` (45+ times)
- `.catch(() => {})` (25+ times, silent failures)
- Early returns without user feedback (20+ places)

**Fix:** Create `discordCatch(err)` helper for consistent logging. Replace silent `.catch(() => {})` with logged catches where appropriate.

### 5D. Handler unit tests

**Problem:** 137 handler functions across 14 files, with ZERO unit tests. Only one integration test (`simulate-game.js`).

**Fix:** Add unit tests for the most complex handlers (combat, activation, movement) using mocked game state and Discord interaction objects.

### 5E. Break apart oversized functions

**Problem:** Several functions exceed 500+ lines:
- `handleAttackTarget` (~1200 lines)
- `handleDcAction` (~850 lines)
- `handleEndEndOfRound` (~634 lines)
- `handleConfirmActivate` (~550 lines)
- `handleCcConfirmPlay` (~356 lines)

**Fix:** Extract sub-functions for distinct logical phases (validation → mutation → UI update).

---

## Implementation Order (Recommended)

```
Phase 1 (Bugs):     1C → 1D → 1E → 1A → 1B → 1F
Phase 2 (Helpers):   2A → 2C → 2B → 2D
Phase 3 (Structure): 3A → 3C → 3B
Phase 4 (Safety):    4A → 4B → 4C → 4D → 4E
Phase 5 (Quality):   5A → 5B → 5C → 5D → 5E
```

Phases 1 and 2 can start immediately.

### Open Questions

- **Initiative swap timing (round.js:398-406):** `swapInitiative()` and `roundNumber++` happen BEFORE `cleanupRoundStart()`. If cleanup logic depends on the old round/initiative context, this ordering could cause subtle bugs. Needs investigation. Phase 3 depends on Phase 2 (helpers need to exist before moving code). Phase 4 is independent. Phase 5 is ongoing.

---

## Files Changed (Full List)

| File | Phases | Changes |
|------|--------|---------|
| `index.js` | 1A,1B,2A-D,3A-C | Biggest changes: extract functions, use helpers, context factory |
| `src/discord/components.js` | 1A | Add `buildRowPickerSelect`, `buildLetterPickerSelect`, overflow flag |
| `src/router.js` | 1A,1B | New select/button prefixes, remove orphan |
| `src/handlers/dc-play-area.js` | 1A,2A,2C,2D | Overflow handlers, use helpers |
| `src/handlers/combat.js` | 2A,2C,2D | Use `applyDamageToFigure`, player helpers |
| `src/handlers/cc-hand.js` | 1A,2C | Overflow handlers, player helpers |
| `src/handlers/movement.js` | 1A,2A,2C | Letter overflow, use helpers |
| `src/handlers/round.js` | 2A,2C | Use helpers |
| `src/handlers/activation.js` | 2C | Use player helpers |
| `src/game-state.js` | 1C,4B,4C | Remove dcDepletedState, add mutex, awaitable save |
| `src/discord/messages.js` | 4A | Content length protection |
| `src/discord/embeds.js` | 4A | Field length protection |
| `src/discord/apply-ability-result.js` | 4A,4E | Content limits, retry |
| `src/error-handling.js` | 4E | Extend retry to internal operations |
| `src/map-renderer.js` | 5A | Parallel image loading |
| `src/constants.js` | 5B | New constants |
| **New files:** | | |
| `src/game/health.js` | 2A | `applyDamageToFigure()` |
| `src/game/scoring.js` | 2B | `awardVp()` |
| `src/game/player-helpers.js` | 2C | Player property accessors |
| `src/context-factory.js` | 3A | Declarative context builder |
| `src/discord/limits.js` | 4A | Content/embed limit utilities |
| `src/orchestrator.js` | 3B | Extracted game logic from index.js |
| `src/dispatcher.js` | 3B | Extracted interaction routing |
| `src/app.js` | 3B | Bot init/shutdown |
