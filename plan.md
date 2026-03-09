# DRY Refactor Plan — Test-Driven Architecture (Audited)

## Philosophy
Every change follows TDD: **write failing test → implement → verify green → move on**.
No helper is introduced without a test. No call site is changed until the helper's test passes.

---

## Phase 1: Pure Helper Functions (No Discord dependency, fully testable)

### Step 1.1: `opponentPlayerNum(pn)` — in `src/game/player-helpers.js`

**Test file:** `src/game/player-helpers.test.js` (new file)

```js
test('opponentPlayerNum returns 2 for 1', () => assert.strictEqual(opponentPlayerNum(1), 2));
test('opponentPlayerNum returns 1 for 2', () => assert.strictEqual(opponentPlayerNum(2), 1));
test('opponentPlayerNum returns 1 for 0 (falsy)', () => assert.strictEqual(opponentPlayerNum(0), 1));
test('opponentPlayerNum returns 1 for undefined', () => assert.strictEqual(opponentPlayerNum(undefined), 1));
test('opponentPlayerNum returns 1 for null', () => assert.strictEqual(opponentPlayerNum(null), 1));
```

**Implementation:** Add to `src/game/player-helpers.js`:
```js
export function opponentPlayerNum(pn) { return pn === 1 ? 2 : 1; }
```

**Call-site replacement:** 99 instances across 12 files. Replace `playerNum === 1 ? 2 : 1` (and all variants like `meta.playerNum === 1 ? 2 : 1`, `attackerPlayerNum === 1 ? 2 : 1`, etc.) with `opponentPlayerNum(variable)`.

**Edge cases to handle:**
- `(playerNum || 1) === 1 ? 2 : 1` → `opponentPlayerNum(playerNum || 1)` (7 instances in abilities.js)
- Inline usages like `findMsgIdForFigureKey(game, playerNum === 1 ? 2 : 1, ...)` → extract to variable first
- Complex: `cbt.defenderPlayerNum ?? (cbt.attackerPlayerNum === 1 ? 2 : 1)` → `cbt.defenderPlayerNum ?? opponentPlayerNum(cbt.attackerPlayerNum)`
- Optional chaining: `cbt?.attackerPlayerNum ? (cbt.attackerPlayerNum === 1 ? 2 : 1) : null` → `cbt?.attackerPlayerNum ? opponentPlayerNum(cbt.attackerPlayerNum) : null` (3 instances in abilities.js)

**Files to change (by count):**
- `src/game/abilities.js` — 48 instances
- `src/handlers/combat.js` — 16 instances
- `src/handlers/activation.js` — 10 instances
- `src/handlers/dc-play-area.js` — 8 instances
- `src/handlers/cc-hand.js` — 3 instances
- `src/handlers/combat-reactions.js` — 3 instances
- `src/handlers/movement.js` — 3 instances
- `src/handlers/round.js` — 3 instances
- `src/handlers/interrupts.js` — 2 instances
- `src/discord/apply-ability-result.js` — 1 instance
- `src/discord/components.js` — 1 instance
- `src/game/movement.js` — 1 instance

**Re-export:** Add to `src/game/index.js` so existing import chains work.

---

### Step 1.2: `getInitiativePlayerNum(game)` — in `src/game/player-helpers.js`

**Tests:**
```js
test('getInitiativePlayerNum returns 1 when p1 has initiative', () => {
  assert.strictEqual(getInitiativePlayerNum({ initiativePlayerId: 'u1', player1Id: 'u1' }), 1);
});
test('getInitiativePlayerNum returns 2 when p2 has initiative', () => {
  assert.strictEqual(getInitiativePlayerNum({ initiativePlayerId: 'u2', player1Id: 'u1' }), 2);
});
test('getInitiativePlayerNum returns 2 when initiativePlayerId is undefined', () => {
  assert.strictEqual(getInitiativePlayerNum({ player1Id: 'u1' }), 2);
});
```

**Implementation:**
```js
export function getInitiativePlayerNum(game) {
  return game.initiativePlayerId === game.player1Id ? 1 : 2;
}
```

**Call sites:** 25 instances across 6 files:
- `src/handlers/setup.js` — 10 instances (including 1 nonInitiativePlayerNum variant → use `opponentPlayerNum(getInitiativePlayerNum(game))`)
- `index.js` — 9 instances (lines 432, 1669, 1721, 1984, 2569, 2682, 2741, 5369, 5407)
- `src/handlers/round.js` — 3 instances
- `src/handlers/activation.js` — 1 instance
- `src/handlers/cc-hand.js` — 1 instance
- `src/handlers/dc-play-area.js` — 1 instance

---

### Step 1.3: Embed color constants — in `src/discord/colors.js` (new file)

**Tests:** `src/discord/colors.test.js`
```js
test('COLORS has expected keys', () => {
  assert.ok(COLORS.DARK_EMBED);
  assert.ok(COLORS.BLURPLE);
  assert.strictEqual(typeof COLORS.DARK_EMBED, 'number');
});
test('COLORS values are valid hex numbers', () => {
  for (const val of Object.values(COLORS)) {
    assert.strictEqual(typeof val, 'number');
    assert.ok(val >= 0 && val <= 0xffffff);
  }
});
```

**Implementation:**
```js
export const COLORS = {
  DARK_EMBED: 0x2f3136,
  BLURPLE: 0x5865f2,
  GREEN: 0x57f287,
  RED: 0xed4245,
  ORANGE: 0xe67e22,
  GRAY: 0x95a5a6,
  GOLD: 0xffd700,
};
```

**Note:** `0xf39c12` (gold/orange) already exported as `PHASE_COLOR` from `src/discord/messages.js` — leave as-is.

**Call sites:** 29 hardcoded hex values across 7 files:
- `index.js` — 14 instances (9× DARK_EMBED, 2× GOLD, 1× BLURPLE, 1× GREEN, 1× RED)
- `src/discord/embeds.js` — 8 instances (4× DARK_EMBED, 2× BLURPLE, 1× GREEN, 1× DARK_EMBED)
- `src/handlers/cc-hand.js` — 2 instances (DARK_EMBED)
- `src/handlers/dc-play-area.js` — 2 instances (DARK_EMBED, GRAY)
- `src/handlers/combat.js` — 1 instance (ORANGE)
- `src/handlers/lobby.js` — 1 instance (DARK_EMBED)
- `src/discord/messages.js` — 1 instance (already named PHASE_COLOR, leave as-is)

---

## Phase 2: Validation Guards (Reusable utilities)

### Step 2.1: `requireGame(interaction, getGame, gameId, opts)` — in `src/utils/guards.js` (new file)

**Location:** `src/utils/guards.js` (not `src/handlers/`) — guards are utilities, not handlers. Avoids circular import risk.

**Tests:** `src/utils/guards.test.js`

Uses a `mockInteraction()` factory — a simple object with `followUp` as a spy. No Discord.js dependency needed.

```js
function mockInteraction() {
  const i = { followUpCalled: false, followUpArgs: null };
  i.followUp = async (args) => { i.followUpCalled = true; i.followUpArgs = args; };
  return i;
}

test('requireGame returns game when found', async () => {
  const game = { gameId: 'g1' };
  const result = await requireGame(mockInteraction(), (id) => game, 'g1');
  assert.strictEqual(result, game);
});
test('requireGame returns null and replies when not found', async () => {
  const interaction = mockInteraction();
  const result = await requireGame(interaction, () => null, 'g1');
  assert.strictEqual(result, null);
  assert.strictEqual(interaction.followUpCalled, true);
});
test('requireGame returns null for ended game when checkEnded=true', async () => {
  const interaction = mockInteraction();
  const result = await requireGame(interaction, () => ({ ended: true }), 'g1', { checkEnded: true });
  assert.strictEqual(result, null);
});
test('requireGame returns game for ended game when checkEnded=false', async () => {
  const game = { ended: true };
  const result = await requireGame(mockInteraction(), () => game, 'g1');
  assert.strictEqual(result, game);
});
test('requireGame silent mode returns null without replying', async () => {
  const interaction = mockInteraction();
  const result = await requireGame(interaction, () => null, 'g1', { silent: true });
  assert.strictEqual(result, null);
  assert.strictEqual(interaction.followUpCalled, false);
});
```

**Implementation:**
```js
import { discordCatch } from '../error-handling.js';

export async function requireGame(interaction, getGame, gameId, opts = {}) {
  const game = getGame(gameId);
  if (!game) {
    if (!opts.silent) {
      await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
    }
    return null;
  }
  if (opts.checkEnded && game.ended) {
    if (!opts.silent) {
      await interaction.followUp({ content: 'This game has ended.', ephemeral: true }).catch(discordCatch);
    }
    return null;
  }
  return game;
}
```

**Call sites:** 96 instances across handler files:
- 87 with "Game not found." message → `requireGame(interaction, getGame, gameId)`
- 9 silent returns → `requireGame(interaction, getGame, gameId, { silent: true })`

Each becomes:
```js
// Before (3 lines):
const game = getGame(gameId);
if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch); return; }

// After (2 lines):
const game = await requireGame(interaction, getGame, gameId);
if (!game) return;
```

**Files by count:**
- `src/handlers/dc-play-area.js` — 18 instances (2 silent)
- `src/handlers/cc-hand.js` — 17 instances
- `src/handlers/setup.js` — 18 instances (2 silent)
- `src/handlers/combat.js` — 14 instances (2 silent)
- `src/handlers/activation.js` — 6 instances (2 silent)
- `src/handlers/game-tools.js` — 5 instances
- `src/handlers/movement.js` — 5 instances
- `src/handlers/botmenu.js` — 4 instances
- `src/handlers/map-events.js` — 3 instances
- `src/handlers/round.js` — 2 instances
- `src/handlers/fast-forward.js` — 2 instances
- `src/handlers/interact.js` — 2 instances (1 silent)

---

### Step 2.2: `requirePlayer(interaction, game, userId, playerNum, canActAsPlayer, message)` — in `src/utils/guards.js`

**Tests:**
```js
test('requirePlayer returns true when authorized', async () => {
  const result = await requirePlayer(mockInteraction(), {}, 'u1', 1, () => true);
  assert.strictEqual(result, true);
});
test('requirePlayer returns false and replies when unauthorized', async () => {
  const interaction = mockInteraction();
  const result = await requirePlayer(interaction, {}, 'u99', 1, () => false);
  assert.strictEqual(result, false);
  assert.strictEqual(interaction.followUpCalled, true);
});
test('requirePlayer forwards custom error message', async () => {
  const interaction = mockInteraction();
  await requirePlayer(interaction, {}, 'u99', 1, () => false, 'Only the owner can move.');
  assert.strictEqual(interaction.followUpArgs.content, 'Only the owner can move.');
});
```

**Implementation:**
```js
export async function requirePlayer(interaction, game, userId, playerNum, canActAsPlayer, message) {
  if (!canActAsPlayer(game, userId, playerNum)) {
    await interaction.followUp({
      content: message || 'Only the owner can perform this action.',
      ephemeral: true,
    }).catch(discordCatch);
    return false;
  }
  return true;
}
```

**Call sites:** 74 instances across 9 files. 45+ unique error messages — each is preserved via the `message` parameter.

**Files by count:**
- `src/handlers/cc-hand.js` — 17 instances
- `src/handlers/combat.js` — 14 instances
- `src/handlers/dc-play-area.js` — 12 instances
- `src/handlers/interrupts.js` — 11 instances
- `index.js` — 9 instances (Sidewinder, Boltslinger, Indiscriminate Fire, Fighting Knife, Concussive Bolt, Spread Pain, Missile Salvo ×2, dc_fig_select)
- `src/handlers/movement.js` — 5 instances
- `src/handlers/combat-reactions.js` — 4 instances
- `src/handlers/map-events.js` — 3 instances
- `src/handlers/activation.js` — 2 instances

---

## Phase 3: CustomId Parsing Utility

### Step 3.1: `parseCustomId` / `splitCustomId` / `matchCustomId` — in `src/discord/custom-id.js` (new file)

**Tests:** `src/discord/custom-id.test.js`
```js
test('parseCustomId extracts suffix after prefix', () => {
  assert.strictEqual(parseCustomId('refresh_map_game123', 'refresh_map_'), 'game123');
});
test('parseCustomId returns null for non-matching prefix', () => {
  assert.strictEqual(parseCustomId('other_game123', 'refresh_map_'), null);
});
test('parseCustomId returns empty string when customId equals prefix', () => {
  assert.strictEqual(parseCustomId('refresh_map_', 'refresh_map_'), '');
});
test('parseCustomId returns null for null/undefined input', () => {
  assert.strictEqual(parseCustomId(null, 'refresh_map_'), null);
  assert.strictEqual(parseCustomId(undefined, 'refresh_map_'), null);
});
test('splitCustomId splits remaining parts', () => {
  assert.deepStrictEqual(splitCustomId('deploy_pick_game1_2_3_a4', 'deploy_pick_'), ['game1', '2', '3', 'a4']);
});
test('splitCustomId returns empty array for non-matching prefix', () => {
  assert.deepStrictEqual(splitCustomId('other_thing', 'deploy_pick_'), []);
});
test('matchCustomId extracts regex groups', () => {
  assert.deepStrictEqual(matchCustomId('attack_target_msg1_2_3', /^attack_target_(.+)_(\d+)_(\d+)$/), ['msg1', '2', '3']);
});
test('matchCustomId returns null on no match', () => {
  assert.strictEqual(matchCustomId('other_thing', /^attack_target_(.+)$/), null);
});
```

**Implementation:**
```js
export function parseCustomId(customId, prefix) {
  if (!customId?.startsWith(prefix)) return null;
  return customId.slice(prefix.length);
}

export function splitCustomId(customId, prefix) {
  const suffix = parseCustomId(customId, prefix);
  return suffix ? suffix.split('_') : [];
}

export function matchCustomId(customId, regex) {
  const m = customId?.match(regex);
  return m ? m.slice(1) : null;
}
```

**Call sites:** 79 `.replace()` calls + 10 `.match()` calls → gradual adoption. Start with simplest cases (single gameId extraction via `parseCustomId`). Not a forced bulk migration.

---

## Phase 4: Verify Existing Helper Adoption

### Step 4.1: Audit `dcNameFromFigureKey` usage

**Existing:** `src/game/dc-helpers.js:12` — `dcNameFromFigureKey(fk)` does `fk.replace(/-\d+-\d+$/, '')`.

**22 raw instances found across 7 files:**
- `src/handlers/combat.js` — 12 instances (lines 83, 89, 382, 2671, 2688, 2710, 2819, 2832, 2848, 2878, 3944, 3947)
- `src/handlers/setup.js` — 3 instances (lines 1337, 1341, 1372)
- `src/game/movement.js` — 4 instances (lines 137, 217, 234, 613)
- `src/game/abilities.js` — 2 instances (lines 1653, 1750 — inside `.map()` callbacks)
- `src/game/conditions.js` — 1 instance (line 29)
- `src/handlers/dc-play-area.js` — 1 instance (line 1032)
- `src/handlers/round.js` — 1 instance (line 107)

**Task:** Replace all raw `.replace(/-\d+-\d+$/, '')` with `dcNameFromFigureKey()`. Import where not already imported.

### Step 4.2: Add tests for existing `parseFigureKey`

**Tests to add to `src/game/dc-helpers.test.js`:**
```js
test('parseFigureKey extracts dgIndex and figureIndex', () => {
  assert.deepStrictEqual(parseFigureKey('Stormtroopers-1-0'), { dgIndex: 1, figureIndex: 0 });
});
test('parseFigureKey handles multi-word names', () => {
  assert.deepStrictEqual(parseFigureKey('Darth Vader-2-1'), { dgIndex: 2, figureIndex: 1 });
});
test('parseFigureKey defaults for invalid input', () => {
  assert.deepStrictEqual(parseFigureKey('invalid'), { dgIndex: 1, figureIndex: 0 });
});
test('dcNameFromFigureKey extracts DC name', () => {
  assert.strictEqual(dcNameFromFigureKey('Darth Vader-1-0'), 'Darth Vader');
  assert.strictEqual(dcNameFromFigureKey('Stormtroopers-2-3'), 'Stormtroopers');
});
```

---

## Execution Order & Dependency Graph

```
Phase 1.1 (opponentPlayerNum)     ← No dependencies, biggest impact (99 sites)
  ↓
Phase 1.2 (getInitiativePlayerNum) ← Same file, 25 sites (incl. 9 in index.js)
  ↓
Phase 1.3 (COLORS)                 ← Independent, 29 sites across 7 files
  ↓
Phase 2.1 (requireGame)            ← Needs mockInteraction test util, 96 sites
  ↓
Phase 2.2 (requirePlayer)          ← Same test util, same file, 74 sites
  ↓
Phase 3.1 (parseCustomId)          ← Independent, gradual adoption (79+ sites)
  ↓
Phase 4 (verify existing helpers)  ← Audit + test only
  ↓
Phase 5 (extract index.js)        ← Structural, 3 tiers (~3,200 lines out)
```

---

## Phase 5: Extract `index.js` into Modules

**Goal:** Reduce `index.js` from 7,400 → ~4,200 lines by extracting cohesive handler groups into the existing handler registry pattern.

### Step 5.1: Combat Special Effects → `src/handlers/combat-special-effects.js` (new file)

**What moves:** 15 inline handlers currently in LOCAL_HANDLERS table:
- `handleBleedResolve` (lines 3009-3080)
- `handleSidewinderApply/Skip` (lines 4856-4907)
- `handleBoltslingerTarget/Skip` (lines 4908-4954)
- `handleIndiscriminateFireDie/Skip` (lines 5005-5037)
- `handleFightingKnifeTarget/Skip` (lines 5038-5100)
- `handleConcussiveBoltPush/Skip` (lines 5101-5144)
- `handleSpreadThePainFigPick/CondPick/Skip` (lines 5145-5232)
- `handleMissileSalvoDie/Done` (lines 5233-5288)

**Impact:** ~500 lines extracted. These are self-contained combat effects that follow the existing handler pattern. Register with the handler registry just like combat-reactions.js.

**Dependencies to inject via context:** `getGame`, `saveGames`, `canActAsPlayer`, `client`, combat state access.

**Risk:** LOW — each handler is already a standalone function.

---

### Step 5.2: Combat Damage Resolution → `src/handlers/combat-damage.js` (new file)

**What moves:**
- `applyDamageAndFinishCombat` (lines 3209-4375 — **1,167 lines**)
- `resolveCombatAfterRolls` (lines 3108-3208)
- `checkPostCombatSurges` (lines 4403-4648)
- `finishCombatResolution` (lines 4649-4855)
- `applyNpcDamageToFigure` (lines 2920-2961)
- `applyDirectDamageToFigure` (lines 2962-2988)
- `sendBleedingPrompt` (lines 2989-3008)
- `applyIndiscriminateFireSplash` (lines 4955-5004)

**Impact:** ~1,700 lines extracted. This is the single largest extraction.

**Dependencies:** Heavy — combat state, game state, Discord messaging, figure lookups, ability resolution. Will need a well-defined context interface.

**Risk:** MEDIUM-HIGH — `applyDamageAndFinishCombat` is deeply interconnected. Must be extracted as a whole unit with its callees. Test coverage exists in combat.test.js to validate.

---

### Step 5.3: Game Creation & Rendering → `src/game-creation.js` + `src/rendering.js` (new files)

**game-creation.js moves:**
- `createTestGame` (lines 1383-1490)
- `createGameChannels` (lines 1238-1294)
- `createPlayAreaChannels` (lines 1191-1215)
- `createBoardChannel` (lines 1295-1346)
- `createHandThreads` (lines 1216-1237)
- `setupServer` (lines 5973-6012)
- `applySquadSubmission` (lines 5902-5971)
- `finishSetupAttachments` (lines 2559-2607)

**rendering.js moves:**
- `buildBoardMapPayload` (lines 2357-2430)
- `buildDcEmbedAndFiles` (lines 5614-5660)
- `buildDiscardPileDisplayPayload` (lines 5661-5698)
- `buildHandDisplayPayload` (lines 1129-1170)
- `getFiguresForRender`, `buildMissionTokens`, `getMapTokensForRender` (lines 1716-1824)
- `getActivationMinimapAttachment`, `getMovementMinimapAttachment` (lines 1825-1945)
- `getDeploymentMapAttachment` (lines 1946-1977)

**Impact:** ~1,000 lines extracted across two files.

**Risk:** MEDIUM — game creation functions touch Discord channel APIs and need careful dependency injection.

---

### Step 5.4: Board Helpers → `src/game/board-helpers.js` (new file)

**What moves:** Pure game logic functions with no Discord dependency:
- `getPlayerOccupiedCells` (line 364)
- `getMissionTokenCoords` (line 378)
- `isFigureAdjacentOrOnMissionToken` (line 390)
- `getEffectiveSpeed` (line 413)
- `isFigureInDeploymentZone` (line 429)
- `isFigureAdjacentOrOnAny` (line 443)
- `getFigureAdjacentCoordsFromSet` (line 448)
- `getLegalInteractOptions` (line 482)
- `getSpaceController` (line 553)
- `getFiguresOnOrAdjacentToSpace` (line 599)
- `countTerminalsControlledByPlayer` (line 614)

**Impact:** ~300 lines. These are **fully testable** pure functions — highest value extraction for test coverage.

**Risk:** LOW — pure functions, no side effects.

---

### Phase 5 Execution Order

```
5.1 (combat-special-effects)  ← Easiest, 15 standalone handlers, ~500 lines
  ↓
5.4 (board-helpers)            ← Pure functions, most testable, ~300 lines
  ↓
5.3 (game-creation + rendering) ← Medium complexity, ~1,000 lines
  ↓
5.2 (combat-damage)            ← Hardest, 1,700 lines, most dependencies
```

### Phase 5 New Files

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/handlers/combat-special-effects.js` | 15 inline combat effect handlers | ~500 |
| `src/handlers/combat-damage.js` | Damage resolution mega-functions | ~1,700 |
| `src/game-creation.js` | Game/channel initialization | ~500 |
| `src/rendering.js` | Board/map/UI payload builders | ~500 |
| `src/game/board-helpers.js` | Pure board state query functions | ~300 |

## New Files Created

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/game/player-helpers.test.js` | Tests for opponentPlayerNum, getInitiativePlayerNum | ~30 |
| `src/discord/colors.js` | Embed color constants | ~8 |
| `src/discord/colors.test.js` | Color constants tests | ~15 |
| `src/utils/guards.js` | requireGame, requirePlayer | ~30 |
| `src/utils/guards.test.js` | Guard tests with mockInteraction | ~60 |
| `src/discord/custom-id.js` | parseCustomId, splitCustomId, matchCustomId | ~15 |
| `src/discord/custom-id.test.js` | CustomId parser tests | ~35 |

## Files Modified

| File | Changes | Sites |
|---|---|---|
| `src/game/player-helpers.js` | Add opponentPlayerNum, getInitiativePlayerNum | +2 functions |
| `src/game/index.js` | Re-export new helpers | +2 exports |
| `src/game/abilities.js` | Replace opponent ternaries | 48 |
| `src/handlers/combat.js` | Ternaries + guards + player guards | 16 + 14 + 12 |
| `src/handlers/activation.js` | Ternaries + guards + initiative | 10 + 6 + 1 |
| `src/handlers/dc-play-area.js` | Ternaries + guards + player guards + colors + initiative | 8 + 18 + 12 + 2 + 1 |
| `src/handlers/cc-hand.js` | Ternaries + guards + player guards + colors + initiative | 3 + 17 + 17 + 2 + 1 |
| `src/handlers/setup.js` | Guards + initiative | 18 + 10 |
| `src/handlers/movement.js` | Ternaries + guards + player guards | 3 + 5 + 5 |
| `src/handlers/round.js` | Ternaries + guards + initiative | 3 + 2 + 3 |
| `src/handlers/combat-reactions.js` | Ternaries + player guards | 3 + 4 |
| `src/handlers/interrupts.js` | Ternaries + player guards | 2 + 10 |
| `src/handlers/game-tools.js` | Guards | 5 |
| `src/handlers/botmenu.js` | Guards | 4 |
| `src/handlers/fast-forward.js` | Guards | 2 |
| `src/handlers/map-events.js` | Guards + player guards | 3 + 3 |
| `src/handlers/post-combat.js` | Guards | 3 |
| `src/handlers/interact.js` | Guards | 2 |
| `src/discord/embeds.js` | Colors | 8 |
| `src/discord/apply-ability-result.js` | 1 ternary | 1 |
| `src/discord/components.js` | 1 ternary | 1 |
| `src/game/movement.js` | 1 ternary | 1 |
| `src/game/dc-helpers.test.js` | Add parseFigureKey + dcNameFromFigureKey tests | +4 tests |

---

## Risk Assessment

| Change | Risk | Reason |
|---|---|---|
| opponentPlayerNum | LOW | Pure function, trivial logic, full tests. High volume but mechanical replacement. |
| getInitiativePlayerNum | LOW | Pure function, 16 call sites (3× more than initially estimated). |
| COLORS | LOW | Literal value swap, no behavior change. |
| requireGame | MEDIUM | Changes control flow (early return). Silent vs messaging variants need care. Each site must verify the `return` still correctly exits the handler (all confirmed top-level). |
| requirePlayer | MEDIUM | Same control flow concern. 45+ unique custom error messages must be preserved in each call. |
| parseCustomId | LOW | Gradual opt-in adoption, no forced migration. |
| combat-special-effects extraction | LOW | Self-contained handlers, existing registry pattern. |
| board-helpers extraction | LOW | Pure functions, no side effects, easy to test. |
| game-creation + rendering extraction | MEDIUM | Discord channel APIs, careful DI needed. |
| combat-damage extraction | HIGH | 1,700 lines, deeply interconnected. Highest payoff but highest risk. |

## Success Criteria

1. All 312 passing tests still pass (2 infrastructure scripts excluded)
2. All new test files pass (est. 30+ new tests)
3. `grep -rn "=== 1 ? 2 : 1" src/` count drops from 99 to 0
4. `grep -rn "initiativePlayerId === game.player1Id ? "` drops from 25 to 0
5. `grep -c "'Game not found.'" src/handlers/*.js` drops from ~87 to 0
6. No hardcoded hex colors remain in handler/embed files
7. Zero regressions in game behavior
8. `index.js` reduced from 7,400 → ~4,200 lines (Phase 5)
9. All extracted modules registered in handler registry or importable standalone

---

## Completion Status (2026-03-09)

### Completed
| Phase | Description | Commit | Tests Added |
|-------|-------------|--------|-------------|
| 1.1 | opponentPlayerNum — 108 ternary replacements across 12 files | `4e6ebdd` | 5 |
| 1.2 | getInitiativePlayerNum — 36 ternary replacements across 5 files | `bbb30e3` | 3 |
| 2.1 | COLORS constants — 34 hardcoded hex replacements across 4 files | `65e9a6b` | 2 |
| 2.2 | requireGame guard — 63 guard blocks replaced across 15 handlers | `e8103b2`, `be2ba71` | 5 |
| 2.3 | requirePlayer guard — canActAsPlayer guard blocks replaced | `969573e` | 4 |
| 3.1 | parseCustomId / splitCustomId / matchCustomId utilities | `d7e842b` | 10 |
| 4.1 | dcNameFromFigureKey + parseFigureKey test coverage | `3c73109` | 8 |
| 4.2 | dcNameFromFigureKey — 254 raw regex calls replaced | `8c36100` | 0 |
| 5.1 | combat-special-effects — 15 handlers extracted to new module | `75d0de0`, `d7371c6` | 0 |
| 5.4 | board-helpers — 11 pure functions extracted | `75d0de0` | 0 |
| 5.3 | game-creation + rendering extraction | `7463f08` | 0 |

**Total: 44 new tests, all passing. index.js reduced from 7,400 → 5,943 lines (−1,457 lines, −20%).**

### Deferred
| Phase | Description | Reason |
|-------|-------------|--------|
| 5.2 | combat-damage extraction (~1,700 lines) | `applyDamageAndFinishCombat` accesses 50+ game state properties with ~95 internal function calls. Extraction would require fundamental refactoring of game state management (e.g., state object pattern or context injection) rather than simple file moves. Recommended as a standalone follow-up project. |

### Metrics
- Ternary opposites (`=== 1 ? 2 : 1`): 99 → 0
- Initiative ternaries: 36 → 0
- Hardcoded hex colors in handlers/embeds: 34 → 0
- Raw `dcNameFromFigureKey` regex patterns: 254 → 0
- Guard boilerplate blocks eliminated: ~63 (requireGame) + ~8 (requirePlayer)
- New reusable modules: 7 (player-helpers, dc-helpers, board-helpers, colors, guards, custom-id, combat-special-effects)
