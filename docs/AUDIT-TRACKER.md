# Code Audit Tracker — Feb 18 2026

## CRITICAL — Game Rules Are Wrong

- [x] **#1 — Evade does NOT cancel Surge** ✅ FIXED
  Evade results now cancel surge at end of Apply Modifiers step, BEFORE surge spending. Total evade (dice + CC bonus + round bonus) reduces available surge. Hit check no longer uses evade (was wrong — evade cancels surge, not accuracy).

- [x] **#2 — Accuracy vs Distance never checked** ✅ FIXED
  Distance stored on target at selection time. `isRanged` determined from attack range (`minRange >= 2 || maxRange >= 3`). After surge spending, `computeCombatResult` checks `totalAccuracy >= distanceToTarget` for ranged attacks. Melee attacks skip accuracy check.

- [x] **#3 — Dodge results don't exist** ✅ FIXED
  White die face 6 was `{block:2, evade:0}` (wrong — no such face). Changed to `{dodge:true}`. `rollDefenseDice` now returns `dodge`. Dodge skips surge step entirely and auto-misses in `computeCombatResult`. Combat thread shows "DODGE!" on defense roll.

- [x] **#4 — Blast/Cleave trigger on 0 damage** ✅ FIXED
  Added `damage > 0` gate to both Blast damage path and Cleave trigger. A fully blocked hit no longer triggers splash damage.

- [ ] **#5 — Attack sequence out of order**
  Correct: Roll → Reroll → Apply Modifiers (evade cancels surge) → Spend Surges → Check Accuracy → Calculate Damage. Code applies modifiers after surge spending. Reroll step missing.

- [ ] **#6 — LOS is advisory, not enforced**
  LOS check only posts a warning. Attack proceeds regardless.

- [ ] **#7 — LOS algorithm is wrong**
  Uses center-to-center interpolation. Rules require corner-to-corner tracing.

## HIGH — Game Flow Bugs

- [x] **#8 — Activated DC indices never reset at end of round** ✅ FIXED
  Added `game.p1ActivatedDcIndices = []; game.p2ActivatedDcIndices = [];` in `handleEndEndOfRound` after activation counts are restored.

- [x] **#9 — Attachment CCs double-counted (discard + attached)** ✅ FIXED
  Removed discard push in `handleCcAttachTo`; only tracked as attachment now.

- [x] **#10 — `handleNegationPlay` uses undefined `playerId`** ✅ FIXED
  Derived `negPlayerId` from `oppNum` → `game.player1Id`/`game.player2Id`.

- [x] **#11 — `handleCelebrationPlay` uses undefined `playerId`** ✅ FIXED
  Derived `celPlayerId` from `attackerPlayerNum` → `game.player1Id`/`game.player2Id`.

- [x] **#12 — Missing optional chaining crashes old games** ✅ FIXED
  Added `?.` to `mech?.flipLimitPerRound`. (Already guarded by `mech?.type` check, but defensive fix.)

- [ ] **#13 — File-based saves not atomic**
  `writeFileSync` directly. Crash mid-write corrupts save file. No recovery, no backups.

- [ ] **#14 — Race conditions on concurrent saves**
  Two simultaneous interactions → concurrent `saveGames()`. Last write wins, other changes lost. No locking.

## MEDIUM — Functional Gaps

- [ ] **#15 — Reinforcement not implemented**
  Defeated non-unique figures can be redeployed at end of round for reinforce cost. Not implemented.

- [ ] **#16 — End-of-activation CC effects never trigger automatically**
  CCs with `endOfActivation` timing are never prompted. Players must remember manually.

- [ ] **#17 — No free action tracking**
  Some abilities grant free actions. All actions decrement the 2-action counter.

- [ ] **#18 — `pendingCcConfirmation` can go stale**
  If player does something else after selecting CC, old confirmation never cleaned up.

- [x] **#19 — Attachments not cleaned up on DC defeat** *(RULE: attachments disappear on defeat unless otherwise specified)*
  When DC is defeated, attached CCs remain in `p1CcAttachments`/`p2CcAttachments`. Should be removed (discarded).

- [ ] **#20 — Incomplete mission data**
  `development-facility` has empty names/labels/VP rules/positions. Other maps have empty token labels.

- [x] **#21 — 9 trait placeholder cards in `cc-effects.json`**
  "Heavy Weapon", "Hunter", "Leader", "Smuggler", "Spy", "Technician", "Trooper", "Vehicle", "Wookiee" — empty effects, null costs. Deleted.

- [ ] **#22 — Inconsistent return pattern in `mission-rules.js`**
  Line ~147 sets `gameEnded = true` instead of `return { gameEnded: true }`. Subsequent rules execute on finished game.

## LOW — Quality Issues

- [ ] **#23 — No pass enforcement** — Players with 0 activations aren't forced to pass server-side.
- [ ] **#24 — No game state versioning/migration** — `migrateGame()` does nothing.
- [ ] **#25 — No auto-cleanup on game end** — Channels persist until manual deletion.
- [ ] **#26 — `pendingIllegalSquad` Map leaks memory** — Never cleaned up.
