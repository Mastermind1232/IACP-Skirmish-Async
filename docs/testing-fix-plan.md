# Implementation Plan: Destruct's Testing Cases → All PASS

**89 FAILs + 101 PARTIALs** organized into 20 workstreams by shared code patterns.
Each workstream lists affected test IDs, what to change, and which pattern to follow.

---

## Workstream 1: Combat Pipeline Core Fixes
**IDs:** G12, G22, I46
**Impact:** Tier 1 — affects every single game

### G12 — Per-die reroll tracking
**File:** `src/handlers/combat.js` (~line 2284)
**Problem:** Reroll uses a simple counter. Any die can be rerolled unlimited times.
**Fix:** Track `alreadyRerolledIndices` as a Set on the combat object. In the reroll UI builder, filter out indices already in the Set. When a die is rerolled, add its index.
```
// In pendingCombat object initialization:
combat.attackerRerolledIndices = new Set();
combat.defenderRerolledIndices = new Set();

// In reroll selection handler:
if (combat.attackerRerolledIndices.has(dieIndex)) return; // skip
combat.attackerRerolledIndices.add(dieIndex);
```

### G22 — Conditions from surges require damage > 0
**File:** `src/index.js` (~line 2468-2477)
**Problem:** Conditions applied outside the `if (damage > 0)` block.
**Fix:** Move the condition-application code INSIDE the `if (damage > 0)` block, or add an explicit `if (damage > 0)` guard around it. Exception: Recover and Stun Net (Zuckuss) which don't require damage — handle those with explicit opt-out flags.

### I46 — Cross-Training once per round
**File:** `src/handlers/combat.js` (~line 679-681)
**Problem:** Die swap fires every defense, not once per round.
**Fix:** Check `game.crossTrainingExhausted?.[msgId]` before applying. Set it after first use. Add `'crossTrainingExhausted'` to `ROUND_OBJECT_FLAGS` in `activation-state.js` for auto-cleanup.

---

## Workstream 2: Lure of the Dark Side (Hostile Figure Attack)
**IDs:** G25, G26, G27, G28, C3
**Impact:** Tier 1 — entire CC mechanic missing

**Files:** `src/game/abilities.js`, `src/handlers/combat.js`
**Problem:** `chooseAdjacentHostileThen` only applies strain. The card's core mechanic (attack WITH a hostile figure) is not implemented.
**Pattern:** "Do it like False Orders" (combat.js:4064-4151) — `falseOrdersControllerPlayerNum` already delegates attacker role to a different player. Lure needs a similar delegation where:
1. Pick adjacent hostile figure (existing chooseAdjacentHostileThen picker)
2. Grant that figure +2 Hit Tokens
3. Set `combat.lureControllerPlayerNum` = card player
4. Set `combat.lureFigureKey` = chosen hostile
5. During combat: no figures are "friendly" to the Lure attacker, attacker can use hostile figure's abilities, must spend hostile figure's Focus
6. After attack: apply 2 Strain to hostile figure
7. Thread `lureControllerPlayerNum` through combat flow like `falseOrdersControllerPlayerNum`

**Scope:** ~100 lines new code in abilities.js for the picker, ~30 lines threading through combat.js.

---

## Workstream 3: Ranged Cleave
**IDs:** G34, I17, I18
**Impact:** Tier 1 — TGI and other ranged cleave users broken

**Files:** `src/index.js` (~line 3681-3718), `src/game/combat.js`
**Problem:** Cleave only works for melee (checks adjacency). Ranged Cleave should apply to figures adjacent to the target within the attacker's LOS+range.
**Fix:** In the existing cleave handler at index.js:3684+:
1. Check if attacker has `rangedCleave` flag (set via DC ability or surge)
2. If ranged cleave: find figures adjacent to target that are ALSO within attacker's LOS and range
3. If melee cleave: use existing adjacent-only logic
4. Add `rangedCleave` to TGI's DC abilities in dc-effects.json or ability-library.json

Also need to add TGI's specific abilities to ability-library.json and wire handlers.

---

## Workstream 4: Per-Instance CC/Ability Limits
**IDs:** G36, G37, C21, C25
**Impact:** Tier 1-2 — exploitable unlimited plays

### G36 — Parting Blow once per move
**File:** `src/game/abilities.js` (~line 7197)
**Fix:** Track `game.partingBlowUsedThisMove[figureKey]` Set. Set when played, clear when the moving figure's move action ends. Add to `ACTIVATION_MSGID_FLAGS` for cleanup.

### G37 / C21 — Jundland Terror once per EOR
**File:** `src/game/abilities.js` (~line 5768)
**Fix:** Track `game.jundlandTerrorUsedThisEOR` boolean. Set on first play, check before allowing second. Clear at end of `handleEndEndOfRound`.

### C25 — Reinforcements max 1 per SOR
**Fix:** Track `game.reinforcementsPlayedThisSOR` boolean. Clear at start of SOR phase.

---

## Workstream 5: Companion System
**IDs:** G39, G40, G41, G42, G43, G44, G47, G48, G49, M53, M67, M74, M76
**Impact:** Tier 5 — many figures depend on companions

This is a system-level feature. Build a `companion-helpers.js` module:

### 5a. Companion Registry
**New file:** `src/game/companion-helpers.js`
```js
// Core companion data
function isCompanion(figureKey) { /* check dc-effects.json companion field */ }
function getParentDc(companionFigureKey) { /* return parent DC msgId */ }
function getCompanionFigureKey(parentMsgId) { /* return companion FK */ }
```

### 5b. Space Sharing (G39)
**File:** `src/game/movement.js` (~line 79-91, `getOccupiedSpacesForMovement`)
**Fix:** Add companion exemption — companions don't block other figures from entering their space. Check `isCompanion(figureKey)` and skip in blocking calculation.

### 5c. Entering Play (G40)
**File:** `src/handlers/post-deploy.js` or `src/handlers/dc-play-area.js`
**Fix:** When a DC with `companion` field is deployed, auto-deploy companion figure to same/adjacent space. Use Cal's Buddy pattern (abilities.js:8140-8169) as template.

### 5d. Exiting Play (G41)
**File:** `src/handlers/combat.js` (defeat handling), `src/game/damage-helpers.js`
**Fix:** When parent figure is defeated, remove companion. When companion is defeated, mark as removed. Add `removeCompanion(game, figureKey)` function.

### 5e. Activation Order (G42, G43)
**File:** `src/handlers/activation.js`
**Fix:** At start of group activation, offer "Activate companion before or after?" button. Track `companionActivatedBefore[msgId]`.

### 5f. Cost = 0 (G47)
**File:** `src/game/dc-helpers.js`
**Fix:** `getCompanionCost()` always returns 0. Ensure VP calculations exclude companion cost.

### 5g. Cannot Interact (G48)
**File:** `src/handlers/interact.js`
**Fix:** At top of interact handler, check `isCompanion(figureKey)` and reject with message.

### 5h. Can Play CCs (G49)
Already works via `ccPlayableByMatches` — just verify companion figures match the playableBy field.

### 5i. Specific companions (M53, M67, M74, M76)
Wire Junk Droid, Kuiil Hop On, The Child abilities, Salacious B. Crumb using the new companion system.

---

## Workstream 6: Massive Figure Rules
**IDs:** G64, G65, G66, G67, G68, G69, G70, G71
**Impact:** Tier 3 — affects AT-ST, Rancor, Nexu games

**File:** `src/game/movement.js`

### G64 — Massive cannot enter Massive
**Fix:** In `evaluateMovementStep`, check if any cell in new footprint is occupied by another Massive figure. Block the move.

### G65 — Massive LOS exemption
**File:** `src/game/spatial.js`
**Fix:** In `hasLineOfSight()`, skip figure-blocking checks for/from Massive figures.

### G66-G68 — Voluntary movement restriction after overlapping
**Fix:** After `resolveMassivePush` fires, set `game.massiveMovementLocked[figureKey] = true`. Check this flag in movement handlers. Clear at appropriate phase boundary (activation end / SOR end / EOR end). Add to cleanup lists in `activation-state.js`.

### G69-G70 — Push ordering (friendly first)
**Fix:** In `resolveMassivePush` (movement.js:654-667), partition pushed figures into friendly/hostile arrays. Process friendly array first, then hostile.

### G71 — Companions pushed by Massive
**Fix:** Ensure `resolveMassivePush` doesn't skip companion figures.

---

## Workstream 7: Missing Figure Abilities — Rebel
**IDs:** R5, R11, R28-R29, R34-R36, R41, R43, R45, R52, R60, R63, R72, R85, R88

### R5/R11/R41 — Upgrade validation warnings
**File:** `src/game/validation.js`
**Fix:** Add warnings for Chewbacca without unique upgrade, Han Solo without unique upgrade, Luke Hero without 0-pt upgrade. Check DC lists during army validation.

### R28-R29 — Ahsoka Twin Sabers reroll restriction
**File:** `src/handlers/combat.js` (reroll handler)
**Fix:** When Ahsoka's Twin Sabers triggers, mark the rerolled dice indices in `combat.twinSabersRerolledIndices`. In subsequent reroll UI, filter out those indices. The reroll must happen simultaneously (all at once), not one-by-one.

### R34-R36 — Kanan Jarrus group naming
**File:** `src/handlers/activation.js`
**Pattern:** "Do it like Cad Bane" for the trigger. Add new activation flow:
1. At start of Kanan's owner's activation, prompt opponent to name a group
2. Store `game.kananNamedGroup[playerNum]`
3. When opponent activates, check if named group is alive → must activate it
4. If named group defeated, opponent chooses freely
5. Opponent cannot pass instead of activating named group

### R43 — Luke Hero +1 damage on sabre strike
**File:** `src/handlers/combat.js` or `src/game/combat.js`
**Fix:** Add `bonusHits += 1` when Luke Hero is using sabre strike. Check DC name and attack type.

### R45 — Luke Hero global reroll
**File:** `src/handlers/combat.js`
**Fix:** When any friendly figure attacks and Luke Hero is alive, offer 1 attack die reroll. "Do it like Ko-Tun" for range-based ally benefit.

### R52 — CT-1701 Barrage
**File:** `src/handlers/combat.js`
**Fix:** When CT-1701 performs second attack via Barrage, add white die to attack pool. Track `barrageSecondAttack` flag on combat object.

### R60 — Mara Jade trait grant
**File:** `src/game/dc-helpers.js`
**Fix:** When checking keywords for a figure, if Mara Jade has Adaptive Skills, dynamically add the matching trait to her keyword set. `getDcKeywords()` should check for Mara's active trait config.

### R63 — Pathfinder Distracting Fire
**File:** `src/handlers/post-combat.js`
**Fix:** After attack resolves, if Rebel Pathfinder is within range and has LOS, deal 1 damage to the attacker. "Do it like Nimble" pattern.

### R72 — Murne Figurehead
**File:** `src/handlers/combat-reactions.js`
**Fix:** When a friendly figure within range suffers damage/strain, prompt Murne's owner to redirect. "Do it like Tough Luck" interrupt pattern.

### R85 — Fury of Kashyyyk 3+ damage Focus
**File:** `src/index.js` (damage application section)
**Fix:** After applying 3+ damage to a WOOKIEE, check if Fury of Kashyyyk is in play. If so, apply Focus to that WOOKIEE. "Do it like Cad Bane" scan pattern.

### R88 — Heavy Fire
**File:** `src/handlers/post-combat.js`
**Fix:** After attack resolves, if Heavy Fire is in play, deal 1 damage per attack die to each hostile within 2 spaces. Opponent chooses conditions. "Do it like Indiscriminate Fire" (combat-special-effects.js:14-43).

---

## Workstream 8: Missing Figure Abilities — Mercenary
**IDs:** M7-M10, M13, M19-M22, M28, M31, M34-M36, M39, M42-M43, M53, M55, M62, M67, M69-M70, M75

### M7-M10 — Rancor Voracious
**File:** `src/handlers/activation.js`
**Pattern:** "Do it like Cad Bane" — at start of ANY figure's activation (not Rancor's own), if Rancor is alive and adjacent, roll 1 red die. If 2+ damage, may perform free attack.
**Fix:** Add `voracious_rancor` block in activation trigger scan. Check adjacency. Roll die via `rollSingleDie('red')`. If damage threshold met, set `pendingVoraciousAttack`.

### M13 — Krrstanan autofocus
**File:** `src/handlers/combat.js`
**Fix:** When Krrstanan declares attack and has 6+ damage tokens (current HP ≤ threshold), auto-Focus. "Do it like battle_meditation" (combat.js:836-842).

### M19-M22 — Migs Mayfeld abilities
**Files:** `src/game/game-helpers.js` (token cap), `src/handlers/combat.js`, `src/game/abilities.js`
- M19: Override token max to 3 for Migs in `grantPowerTokens`. Add `getMaxTokens(figureKey)` helper.
- M20-M21: Droid Arm — when declaring attack, offer "Use Droid Arm?" button. If yes, draw LOS from adjacent space instead of Migs's space. Modify `handleAttackTarget` to accept LOS override.
- M22: Return Fire — "Do it like Han Solo Return Fire" but for Migs. Add to post-combat defender reaction queue.

### M28 — Clawdite form uniqueness
**File:** `src/handlers/setup.js` (~line 1457-1480, `handleFormPick`)
**Fix:** Track chosen forms in `game.chosenForms[playerNum]` Set. In form picker, filter out already-chosen forms.

### M31 — Gar Saxon Mobile check
**File:** `src/handlers/combat.js`
**Fix:** In surge-sharing logic, verify attacking figure has Mobile keyword via `getDcKeywords()`.

### M34 — Jabba Nefarious Gains
**File:** `src/index.js` (defeat section)
**Fix:** After any hostile figure is defeated, if Jabba is alive, award 1 objective VP. Add to the defeat handler scan. Use `game.playerNVP.objectives += 1`.

### M35-M36 — Jabba Scum restriction
**File:** `src/game/abilities.js` (Incentivize handler at line 982-1011)
**Fix:** At line 995-1002, add `if (fkEff.affiliation !== 'Scum') continue;` to filter targets.

### M39 — Maul Stalk Prey post-combat
**File:** `src/handlers/post-combat.js`
**Fix:** When `combat.surgeStalkPrey` is true, grant 2 MP + 1 Hit Token to Maul after attack resolves. Add consumption of the flag.

### M55 — Aphra bonus action for droids
**File:** `src/handlers/activation.js`
**Fix:** At start of BT-1/0-0-0 activation, check if Aphra is alive. If so, grant 1 bonus action. Track via `actionsData.remaining += 1`.

### M62 — Bib Fortuna Illicit Arms
**File:** `src/handlers/combat.js`
**Pattern:** "Do it like Cad Bane" — at attack declare time, if Bib is alive, prompt Bib's owner: "Discard a CC for +1 Hit?" Show hand as selectable buttons. If selected, discard card, set `combat.bonusHits += 1`.

### M67 — Kuiil Hop On
**File:** `src/game/abilities.js`
**Fix:** Wire `hop_on_kuiil` using the push pattern (like Shyla Whip). Target friendly SMALL figure, push up to 4 spaces. Use `pushTargetWithinRange` template.

### M69-M70 — Beast Tamer
**File:** `src/handlers/activation.js`
**Fix:** At start of CREATURE activation, if Beast Tamer SU is equipped, grant that creature `Speed` MP via `addMovementPoints`. Add `NON-SENTIENT can interact` override in interact handler.

### M75 — Devious Scheme
**File:** `src/handlers/setup.js` (initiative determination)
**Fix:** Before rolling initiative, check both players' SU lists for Devious Scheme. If one player has it and the other doesn't, that player auto-wins initiative. If both have it, cancel both.

---

## Workstream 9: Missing Figure Abilities — Imperial
**IDs:** I2, I3, I15, I17-I18, I19, I28-I29, I34, I37-I38, I43-I44, I47, I48, I51-I52

### I2 — Vader upgrade warning
**File:** `src/game/validation.js`
**Fix:** Same as R5/R11 pattern.

### I3 — Driven by Hatred EOR attack
**File:** `src/handlers/round.js`
**Fix:** In EOR phase, if Darth Vader is alive and has Driven by Hatred, offer "Move 2 + Free Attack" button. "Do it like Scavenged Walker EOR attack" (round.js:238-253).

### I15 — Dio counts for control after Iden defeated
**File:** `src/game/mission-rules.js`
**Fix:** In control counting, if `Dio` companion exists and Iden is defeated, include Dio. Add conditional similar to existing Salacious B. Crumb exclusion.

### I17-I18 — TGI abilities
See Workstream 3 (Ranged Cleave). Additionally, wire TGI's Precision reroll using the `rerollOneAttackDie` pattern.

### I19 — Kallus Hunt Dissent automation
**File:** `src/index.js` (defeat section)
**Fix:** After hostile defeated within range, if Kallus/friendly TROOPER did it and Hunt Dissent is active, grant Block Token. Check ACS attachment for range extension: `const range = hasAttachment(game, msgId, 'Advanced Com Systems') ? 3 : 2;`

### I28-I29 — Flametrooper Incinerate + rubble walls
**File:** `src/game/abilities.js`
**Fix:** Wire Incinerate as a special action that places rubble tokens on targeted spaces. For Wasskah walls, add a check: if rubble placed on a wall segment, remove that wall from the map's blocking set.

### I34 — Second Sister Saber Orbit
**File:** `src/game/abilities.js`
**Fix:** Wire as special action: choose up to 3 adjacent hostiles, perform melee attack using 1 red die against each. "Do it like chooseAdjacentHostileThen" but multi-target.

### I37-I38 — Death Trooper Field Tactics
**File:** `src/handlers/activation.js`
**Fix:** Wire as start-of-activation ability. When Death Trooper activates, choose a friendly IMPERIAL figure within 2 spaces — that figure may perform an interrupt attack. "Do it like Coordinated Raid" (abilities.js:1048-1083).

### I43-I44 — Purge Trooper loadout post-attack effects
**File:** `src/handlers/post-combat.js`
**Fix:** After attack resolves, check `combat.loadoutPostAttack`. If `electro_pulse`: deal 1 damage to each figure adjacent to target. If `quick_strike` and `combat.defenderRerolledOrModified`: deal 1 damage to defender. The flag tracking already exists — just need to consume it.

### I47 — Imperial Citadel gain on defeat
**File:** `src/index.js` (defeat section)
**Fix:** When a friendly Imperial figure is defeated, check if Imperial Citadel is in play. For each Power Token on the defeated figure, place matching token on the Citadel card.

### I48 — Imperial Retrofitting
**File:** `src/handlers/dc-play-area.js`, `src/game/abilities.js`
**Fix:** Wire 3 effects: (1) Exhaust to perform a second attack (action queue), (2) Exhaust to perform a move (grant Speed MP), (3) Deplete to become Focused.

### I51-I52 — Zillo Technique
**File:** `src/handlers/combat-reactions.js`
**Fix:** Two effects:
1. Exhaust: +1 Block in modifiers phase → add to defender modifier scan in combat resolution
2. Deplete: discard 1 CC from hand to reduce attacker's Pierce by 2 → add to defender modifiers, after attacker surge spending (so Pierce is known), prompt "discard CC to reduce Pierce?"

---

## Workstream 10: CC Passive Redraws
**IDs:** C22, C37, C53, C57, C68, C74
**Impact:** Tier 4 — 6 cards with same missing feature

**Architecture:** Build a generic passive redraw system.

**New function in `src/game/cc-timing.js`:**
```js
function checkPassiveRedraws(game, playerNum, trigger, ctx) {
  // trigger: 'surgeByForceUser', 'discardedFromDeck', 'friendlyDroidDefeated', etc.
  // Scan discard pile for cards with matching passive redraw triggers
  // If found, move card from discard to hand, log the redraw
}
```

**Data change in `cc-effects.json`:** Add `passiveRedraw` field:
```json
{ "name": "Knowledge and Defense", "passiveRedraw": { "trigger": "surgeByForceUser" } }
{ "name": "Built on Hope", "passiveRedraw": { "trigger": "discardedFromDeck" } }
{ "name": "Shared Experience", "passiveRedraw": { "trigger": "friendlyDroidOrVehicleDefeated" } }
{ "name": "De Wanna Wanga", "passiveRedraw": { "trigger": "discardedFromHand" } }
{ "name": "Rebel Graffiti", "passiveRedraw": { "trigger": "ownedBySabine" } }
{ "name": "Targeting Network", "passiveRedraw": { "trigger": "surgeByDroid" } }
```

**Call sites:** Insert `checkPassiveRedraws()` at:
- Surge spending (combat.js surge handler)
- Card discard events (cc-hand.js)
- Figure defeat events (index.js defeat section)

---

## Workstream 11: CC Timing Fixes
**IDs:** C14, C15, C46, C65, C66
**Impact:** Tier 4 — cards unplayable at correct time

### C14 — Comm Disruption timing bug
**File:** `src/game/cc-timing.js`
**Problem:** `whenCommandCardPlayed` maps to `duringActivation` — wrong. Should be playable during OPPONENT's turn.
**Fix:** New context flag `ctx.opponentPlayedCC`. Map `whenCommandCardPlayed` to `ctx.opponentPlayedCC || ctx.duringActivation`. Set the flag in cc-hand.js when opponent plays a CC, and auto-prompt for Comm Disruption.

### C15 — Dirty Trick prompt during opponent's move
**Fix:** Similar — `whenHostileFigureEntersAdjacentSpace` should fire as an interrupt during opponent's movement. Add to movement handler: after each step, check if any opponent has Dirty Trick and a qualifying figure adjacent.

### C46 — Extra Protection trigger check
**Fix:** After damage application, check if friendly within 2 suffered 3+. If Extra Protection is in owner's hand, auto-prompt.

### C65/C66 — Opportunistic outside activation
**File:** `src/game/cc-timing.js`
**Fix:** Map `afterHostileFigureSuffersDamage` to broader context (not just `duringActivation`). Add `ctx.afterHostileDamage` flag set during damage resolution. If played outside activation, MP must be spent immediately (set `game.opportunisticMustSpendNow`).

---

## Workstream 12: Tiebreaker System
**IDs:** G111, G112, G113
**Impact:** Tier 6 — affects game-ending ties

### G112 — Track total damage received
**File:** `src/game/game-state.js`, `src/index.js`
**Fix:** Add `game.totalDamageReceived = { 1: 0, 2: 0 }`. Increment in every damage application path (`reduceHp`, `applyStrainToFigure`).

### G111/G113 — Tiebreaker logic
**File:** `src/game/vp-helpers.js` (`checkWinConditions`)
**Fix:** When both players reach 40+ VP simultaneously or game ends with same VP:
1. Player with more kill points wins
2. If tied, player with less total damage received wins
3. If tied, roll blue die — higher accuracy wins

---

## Workstream 13: Initiative & Deployment Rules
**IDs:** G81, G82, G85
**Impact:** Tier 6 — setup phase

### G81 — <40 deployment points initiative
**File:** `src/handlers/setup.js` (line 762)
**Fix:** Before random roll, count each player's deployment points. If one has fewer, they choose initiative. Add comparison logic before the `Math.random()` call.

### G82 — Devious Scheme
See Workstream 8 (M75).

### G85 — Deployment zone overflow
**File:** `src/handlers/setup.js`
**Fix:** Count figure spaces needed vs deployment zone capacity. If overflow, allow placement in expanded zone (adjacent to deployment zone).

---

## Workstream 14: Strain Choice System
**IDs:** G104, G105
**Impact:** Tier 6

**File:** `src/game/combat.js` (`applyStrainToFigure`)
**Fix:** When strain is applied, instead of auto-converting to damage, present choice:
1. "Suffer as damage" (reduce HP)
2. "Discard command card" (remove from hand)
For multiple strain, present allocation up front: "How many as damage, how many as card discard?"
Use button picker pattern ("Do it like Tough Luck").

---

## Workstream 15: Force Push Path & Smoke Grenade LOS
**IDs:** C49, C54

### C49 — Force Push path
**File:** `src/game/abilities.js` (~line 6796-6822)
**Problem:** Teleports figure directly. No intermediate spaces = no Parting Blow.
**Fix:** Compute shortest path from source to destination. Move figure through each intermediate space, triggering movement events (Parting Blow checks) at each step. Use movement.js pathfinding.

### C54 — Smoke Grenade LOS blocking
**File:** `src/game/spatial.js` (LOS calculation)
**Fix:** In `hasLineOfSight()`, check if any smoke token position blocks the LOS line. Add `game.ancillaryTokens.smoke` to the blocking set during LOS checks (similar to how energy shields are handled at dc-play-area.js:867-886).

---

## Workstream 16: Missing Skirmish Upgrades
**IDs:** M71-M73, M77, M79-M80, I48 (see WS9)
**Impact:** Tier 3

### M71-M73 — Black Market SU
**File:** `src/handlers/round.js`
**Fix:** At EOR, if Black Market equipped on a SMUGGLER, reveal top CC from deck. Offer 3 buttons: "Draw (pay 1 VP)", "Discard (gain 1 VP)", "Return to top". Wire handler.

### M77 — Punishing Strike SU
**File:** `src/handlers/combat-special-effects.js`
**Fix:** Whenever a condition is dealt by a figure with Punishing Strike, prompt owner: "Exhaust Punishing Strike to replace this condition with a different one?" Show condition picker.

### M79-M80 — Under Duress SU
**File:** `src/game/combat.js` (strain handling)
**Fix:** When opponent voluntarily suffers strain, if Under Duress is equipped, opponent must discard 2 CCs instead of 1 to prevent damage. Deplete: resolve strain choices for opponent.

---

## Workstream 17: Disarm Permanent Weakened
**IDs:** C40, C41, C42

**File:** `src/game/conditions.js` or `src/game/combat.js`
**Fix:** Add `permanentWeakened` flag to figure state. When Disarm applies Weakened, set `game.permanentWeakened[figureKey] = true`. In ALL condition-removal paths, check this flag and skip Weakened removal. Clear only at end of round (when Weakened normally clears) or when figure is defeated.

---

## Workstream 18: Self-Augmentation DROID Keyword
**IDs:** C71, C72

**File:** `src/game/dc-helpers.js` (`getDcKeywords`)
**Fix:** When checking keywords, also check if figure has Self-Augmentation attachment. If so, add `'droid'` to the returned keyword set. This makes all CC restriction checks and ability checks recognize the figure as a DROID.

---

## Workstream 19: Miscellaneous CC Fixes
**IDs:** C4, C8, C17, C19-C20, C33, C35, C36, C39, C56, C58, C62, C63, C69, C75-C77

### C4 — On the Lam LOS recheck
After On the Lam movement, auto-check LOS from attacker to defender. If no LOS, set `combat.hit = false; combat.missReason = 'target moved out of LOS'`.

### C8 — Adrenaline health tracking
Add `game.adrenalineHealthBonus[figureKey] = 5`. Apply at play time. In `cleanupRoundStart`, subtract bonus and reduce HP if needed.

### C17 — Evacuate negative attachment cost — FIXED 2026-04-21
Formula: `max(0, ceil((baseCost + positiveAtts) / 2) + negativeAtts)` (abilities.js:7144-7168). Covers DC + CC attachments. Negative-cost attachments applied AFTER halving per Destruct V2 ruling. Probes: tests/domain/oracle/evacuate-vp-probe.test.js.

### C19-C20 — Get Behind Me automation
Wire full mechanics: target swap during combat, recalculate defense pool, cancel previous CC effects on old defender.

### C33 — You Will Not Deny Me timing
Change CC timing from `other` to a new timing that's active during damage resolution.

### C35 — Arcing Shot targeting
Override LOS check to allow targeting figure adjacent to empty space in attacker's LOS.

### C36 — Bodyguard attack swap
Same as C19 pattern — redirect attack to Bodyguard figure.

### C39 — Change of Plans cost check
Add cost comparison: `exhaustedDcCost >= readiedDcCost`. Both use base cost from `getDcStats().cost`.

### C56 — Strength in Numbers cost enforcement
Add automated cost check: sum base DC costs of activated + candidate, reject if > 12.

### C58 — Devotion auto-search
After shuffling, programmatically search deck for card matching trait. Show matches as picker.

### C62 — Fool Me Once strain cost
Add `selfStrain: 2` to ability-library entry. Apply strain before executing effect.

### C63 — Fool Me Once gamebox
Track removed cards in `game.gameBox[]` array instead of just deleting. Ensure no effect can retrieve from gamebox.

### C69 — Rest in Peace discard blocking
Set `game.restInPeaceActive = true`. In all discard-pile access points, check this flag and block.

### C75 — To the Limit Move restriction
In the extra action handler, block "Move" as the action choice. Only allow Attack/Special/Interact.

### C76 — To the Limit harmful immunity exception
Check `figure.immuneToHarmful` before applying Stun. If immune, grant extra action without Stun.

### C77 — Urgency spend-all-at-once
Set `game.urgencyMustSpendAll[figureKey] = mpAmount`. In movement handler, if this flag is set, require all MP to be spent before stopping.

---

## Workstream 20: Remaining PARTIAL Items
**IDs:** G6, G7, G8, G13, G14, G16, G18, G62, G73-G78, G95, G104-G105, R3, R15, R40, R60, R64, R66, R69, R75, R79, R94, M3, M27, M30, M39, M43, M47, M53, M58-M59, M61, M63, M74, M76, M81-M82, I3, I5, I7, I10, I12, I14, I22, I24-I26, I30-I31, I33, I36, I43-I44, I47

Many of these need small targeted fixes:
- **Add exhaust/deplete tracking** where missing (I10 Modular cost, I46)
- **Wire ACS range extension** dynamically (I19, I26)
- **Complete informational-only abilities** into automated handlers
- **Add affiliation/trait filters** where missing
- **Fix cost calculation bugs** (G4 Squad Swarm)

Each is a 5-30 line fix following existing patterns.

---

## Execution Order

**Phase 1 — Core Rules (Workstreams 1, 3, 4):** Fix combat pipeline, ranged cleave, per-instance limits. Every game is affected.

**Phase 2 — Major Mechanics (Workstreams 2, 5, 6):** Lure of the Dark Side, companion system, Massive rules. System-level features.

**Phase 3 — Figure Abilities (Workstreams 7, 8, 9):** Wire all missing Rebel, Merc, Imperial abilities. Highest volume of changes.

**Phase 4 — CC System (Workstreams 10, 11, 15, 17-19):** Timing fixes, passive redraws, CC mechanic fixes.

**Phase 5 — Edge Cases (Workstreams 12-14, 16, 20):** Tiebreakers, initiative, strain choice, SU wiring, remaining PARTIALs.

**Estimated scope:** ~3000-5000 lines of new/modified code across ~20 source files.
