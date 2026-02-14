# Plan Audit — Conflicts, Breakage, UX

**Purpose:** One-pass check that the plan is internally consistent, won’t break existing behavior, and is tuned for Discord UX.

---

## 1. Conflicts (internal consistency)

| Check | Result | Notes |
|-------|--------|--------|
| Archive vs Kill Game | OK | Archive = either player, first confirm wins. Kill Game = participants or Admin/Bothelpers, first confirm wins. No overlap conflict. |
| DB2 vs Archive | OK | Row written in same code path as `game.ended`; Archive only deletes Discord and removes from `games`. No “write on Archive” for ended games. |
| Game Log vs General chat | OK | Plan and code agree: Game Log (`generalId`) = bot actions; General chat (`chatId`) = player discussion. Two channels. |
| F17 vs /botmenu | OK | Map selection = visible buttons in Game Log. Only Archive/Kill Game behind /botmenu. |
| Undo vs game ended | **Clarify** | Plan doesn’t say whether Undo is disabled after `game.ended`. Recommend: **disable Undo once game has ended** (no un-end). Add one line to F14 or 4.5. |
| Select Draw min 2 vs Selection | OK | Select Draw requires ≥2; single mission = use Selection. Clear. |
| completed_games winner_id | OK | Nullable for draw; schema and postGameOver(null) align. |

**Action:** Add to plan: “Undo is disabled once the game has ended (no un-end).”

---

## 2. Breakage (existing code / in-flight games)

| Check | Result | Notes |
|-------|--------|--------|
| Removing Kill Game button | OK | New messages stop including the button. Old messages may still have it; `kill_game_` handler can stay so old buttons still work until /botmenu exists, then handler is reused from menu flow. No breakage. |
| generalId / chatId | OK | Already set at creation; plan keeps “resolve by generalId.” No change to stored shape. |
| saveGames() after game end | OK | Today: postGameOver sets game.ended, then saveGames(). DB2 adds insert to completed_games in same path; no change to when we save. |
| A1–A6 refactor | OK | Extract state/data/handlers; handlers still receive same interaction + context. Router dispatches by same customId prefixes. No removal of flows. |
| F17 replacing Map Selection button | OK | Replaces one control with a menu; same phase (setup, before map selected). getPlayReadyMaps and map-selection flow stay; only UI and “who clicks first” clarified. |
| Undo and message IDs | **Impl** | F14 time-travel requires tracking which Discord messages belong to each action so we can delete/revert on Undo. Code already has setupLogMessageIds; extend pattern (e.g. store last N message IDs per state or per action). Not a conflict; implementation note. |

**Action:** Add implementation note to F14: “Track message IDs for actions so Undo can remove/revert the correct Discord messages.”

---

## 3. Discord UX

| Check | Result | Notes |
|-------|--------|--------|
| 2.5 limits | OK | Max 5 buttons/row, 5 rows, 80-char labels, 25 select options; plan and A6 enforce via discord/* helpers. |
| Color conventions | OK | Danger = combat/destructive; Success/Primary = confirm; Secondary = cancel/optional. Consistent. |
| /botmenu wrong channel | OK | Clear message: “Use /botmenu in the Game Log channel of the game you want to manage.” Ephemeral. |
| F17 mission list | OK | “Chunk/paginate if more” than 25 missions; no overflow. |
| First confirm wins | OK | Archive and Kill Game: one confirmation, no veto. Reduces friction; consistent. |
| Map selection visibility | OK | Buttons in Game Log (not hidden); destructive actions hidden in /botmenu. Good discoverability vs safety. |
| Ephemeral for errors | OK | A8 and existing pattern: user-facing errors ephemeral; only the user sees “Only players in this game…”. |
| Rate limits | OK | Plan says batch where possible; 5 msg/5 sec/channel. Undo does delete + possibly one reply; within limits. |

No UX conflicts; plan is aligned with Discord limits and clarity.

---

## 4. Doc vs code

| Check | Result | Notes |
|-------|--------|--------|
| DISCORD_SERVER_STRUCTURE | **Gap** | Table lists “IA00001 General chat” and “IA00001 Board” but not **Game Log**. Code creates `${prefix} Game Log` (generalId) and `${prefix} General chat` (chatId). Add a row for **Game Log** (bot posts game actions, setup, round messages) so the doc matches the plan and code. |
| Plan 4.5 Game Log | OK | States Game Log and General chat are separate; generalId = Game Log. Matches code. |

**Action:** In DISCORD_SERVER_STRUCTURE, add a row for the Game Log channel (purpose: bot posts, setup, round messages) so both channels are documented.

---

## 5. Execution order

| Check | Result | Notes |
|-------|--------|--------|
| DB2 before F11/F16 | OK | Phase 2 has DB2 (write on game end); Phase 3 has F11/F16 (Archive/Kill via /botmenu). By the time Archive exists, ended games already wrote to completed_games. |
| A5 before A7 | OK | Game logic extracted before test suite. |
| F1 before F2/F3/F4 | OK | Ability library before wiring surge/DC/CC. |

Order is consistent.

---

## 6. Summary of recommended plan edits

1. **F14 or 4.5:** “Undo is disabled once the game has ended (no un-end).”
2. **F14:** Implementation note: “Track message IDs for actions so Undo can remove/revert the correct Discord messages.”
3. **DISCORD_SERVER_STRUCTURE:** Add a row for the **Game Log** channel (bot posts game actions/setup/round messages), distinct from General chat.

No conflicts that block the plan; a few clarifications and one doc update recommended above.
