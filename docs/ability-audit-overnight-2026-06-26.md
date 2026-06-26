# IACP Ability Audit — Overnight Backlog (2026-06-26)

Synthesis of 53 adversarially-confirmed findings across 5 dimensions
(timing, player-choice, cost, limitation+tracking, logic). After dedup the set
resolves to **52 distinct actionable items** (the two `[Doubt]` findings share
one registration loop but are two separable fixes — wrong side vs. missing
deplete cost — so both are retained).

## Summary

**Counts by severity (after dedup):**

| Severity | Count |
|----------|-------|
| HIGH     | 15    |
| MEDIUM   | 19    |
| LOW      | 18    |
| **Total**| **52**|

**Counts by dimension:**

| Dimension          | Count |
|--------------------|-------|
| logic              | 21    |
| choice             | 12    |
| limitation         | 9     |
| cost               | 6     |
| timing             | 4     |

---

## Systemic Patterns

Several findings share a single root cause. Fixing the pattern once (or adding a
test/lint guard) prevents recurrence.

### P1 — DC special with no `actionCost`/`freeAction` defaults to 1 action (cost)
Free during-activation / on-declare abilities surface as `dc_special_` buttons.
When the ability-library entry carries no `actionCost`, `getDcStats`
(`src/data-loader.js:635-644`) never builds `_specialActionCosts`, leaving
`specialCosts=[]`. Both the renderer (`src/discord/components.js:1210`) and the
dispatcher (`src/handlers/dc-play-area.js:2120`) then fall back to `cost = 1`,
and the gate at `dc-play-area.js:2187-2188` charges/blocks an action. Net: free
abilities wrongly cost a full action (and abilities meant to cost 2 cost 1).
Note: `freeAction:true` alone is NOT read by `getDcStats` — only an explicit
numeric `actionCost` (honored at `data-loader.js:642`) works.
- **Cara Dune / Smash** (should be free, costs 1)
- **Diala Passil / Force Throw** (should be 0 actions + 1 Strain, costs 1 action)
- **Jabba / Order Hit** (should be 2 actions, costs 1)
- **Maul / Dual-Bladed Fury** (should be free on-declare, costs 1)

### P2 — Mandatory effect (`resolution=automatic`, no "may") shown as skippable (choice)
A handler renders an Apply/Skip button pair for an effect the CSV marks
mandatory; Skip lets the player dodge a forced downside or forfeit a forced
benefit. SoA handler is the common offender.
- **Taron Malicos / Madness** (mandatory 1 Strain + Focus dodgeable)
- **Mounted (Tauntaun/Terro/Dewback/Kuiil/74-Z)** (forced 3 MP skippable)
- **Jawa / Take Cover** (forced +1 Block/-1 Evade auto-applied — inverse: a *may* registered as passive; see P3)
- **Alliance Ranger (Regular) / Sniper** (mandatory reroll offered as skippable gate button)

### P3 — `may` / `Skip` path still burns the once-per-limit (limitation)
The resolver writes the `roundFigureAbilityUsed` (or grants a contingent
resource) BEFORE the choice branches, so declining/Skip still consumes the
limit. Correct pattern (used by `get_down`, `Resourceful`): stamp the limit only
inside the apply branches.
- **Hera Syndulla / Call the Shots** (Skip burns once-per-round, permanently disables)
- **Bo-Katan / Dual-Wield Pistols** (declining still grants 2 Block + burns limit)
- **Second Sister / Mastery** (no-eligible-cards / Rest-in-Peace early-exit burns the use)

### P4 — Declared once-per-X limit never read/written by the resolving handler (limitation)
The library entry declares `oncePer:'round'` (or CSV "once per activation"), but
the branch that actually resolves the ability never consults or sets any
round/activation flag. The limit is effectively unenforced (re-fires while
resource remains) or scoped to the wrong container.
- **Boba Fett / Wrist Cord** (oncePer round unenforced)
- **Boba Fett / Wrist Flamethrower** (oncePer round unenforced)
- **Del Meeko / Expertise** (once-per-activation tracked in round-scoped map)
- **[Doubt] / deplete cost** (per-deck-cycle deplete limit never enforced; see also P5)

### P5 — Data-driven reroll loop ignores CSV `resolution`/`side`/cost columns (timing/cost/choice)
The reroll-registration loop (`src/engine/combat-abilities-rerolls.js`, for-loop
at line 64) hardcodes `kind:'interactive'`, reads `side = r.attack_side`
verbatim, and only attaches an exhaust cost when `/exhaust/i` matches — it never
consults `r.resolution` or `/deplete/i`. Causes wrong-player prompts, skippable
mandatory rerolls, and uncharged deplete costs.
- **[Doubt] (part 2) — wrong side** (registered attacker-side; defender owner never prompted)
- **[Doubt] (part 2) — deplete cost** (Deplete cost never charged, never gated)
- **Alliance Ranger (Regular) / Sniper** (mandatory reroll hardcoded interactive — also P2)

### P6 — Player choice silently auto-resolved (slice / hard-coded branch) (choice)
The engine performs a deterministic resolution where the card grants the player a
choice — slicing trailing/leading dice instead of posting a picker, or
hard-coding one branch of a multi-option effect. A symmetric correct picker
often already exists for the defense pool.
- **Run for Cover** (attack-die remove: slices trailing dice, no picker)
- **Savage Vigor** (attack-die keep: slices first 2, no picker)
- **Iden Versio / Droid Kit** (4-way token choice hard-coded to Damage)
- **Choose a Side** (affiliation-keyed branch offered as free menu)
- **Blaze of Glory** (readies any DC; should be IG-88's own)
- **Built on Hope** ("in any order" reduced to top/bottom only)
- **Dewback Rider / Shock Lance** ("a figure" restricted to hostiles only)

### P7 — "Convert EACH Dodge" / "-1 Dodge" treats counted Dodge as boolean (logic)
Dodge is a counted value, but conversion/cancel logic applies a flat amount or
cancels all dodges regardless of count. Correct pattern: scale by `dodge` count
(Wookiee Avenger) or `bonusDodge -= 1` clamped (HK-47 Conclusion).
- **Diala Passil / Defensive Stance** (flat +2/+1 instead of per-Dodge)
- **The Grand Inquisitor / Deadly Spin** (cancels ALL dodge instead of -1)

### P8 — Passive Bleed/Weaken gated on `damage>0` instead of not-miss (logic)
Innate Bleed/Weaken keyword conditions route through the `damage>0` block, but
the CSV says "if the attack does not miss" — a 0-damage hit (fully blocked)
should still apply. The engine tracks the not-miss flag separately
(`combat._step7Hit` / `surgeNoMissConditions`). Possibly an intentional G22
house-rule (`combat-bridge.js:887`) — confirm with designer.
- **Gaarkhan / Bleed**
- **Krrsantan / Bleed**

### P9 — Unique-figure CC bound to the wrong figure / requires active activation (timing/limitation)
A unique CC's reaction/anchor is keyed to the wrong DC name or requires
`findActiveActivationMsgId`, so it never fires in its intended (out-of-activation)
window. Fix: bind to the real owner / use `resolvePlayingFigureKeyForUniqueCc`.
- **Lord of the Sith** (requires active activation; fires when hostile defeated OUT of activation)
- **Dangerous Prey** (bound to 'Bossk'; real owner is Fennec Shand)

### P10 — Declared flag/conditional set but never consumed (logic/limitation)
A handler sets a state flag or carries a gating field, but no consumer reads it,
so the rule is silently unenforced.
- **Dioxis Fumes** (`roundDioxisActive` set, no recover path reads it)
- **Deflection** (`deflectionRangedOnly` defined, never read — counters Melee too)

### P11 — Stale label/description string vs. live behavior (logic)
Player-facing message or library description contradicts the (correct) live
effect. Cosmetic but misleading.
- **Furious Charge** (message says "become Focused"; readies DC)
- **Tress Hacnua / Leg Hydraulics** (label "gain 1 MP"; actually a move)
- **Thrawn / Long-Laid Plans** ("within 3" in prompt; eligibility is unrestricted)
- **Ko-Tun / Dead Precise** (library description is wrong ability entirely)
- **Dr. Hemlock / Neurostim** (CSV says Block; code grants Damage — reconcile)
- **Mandalorian Steel** (CSV says Power Token; code/card use Block — fix CSV)

### P12 — Guarded clause matched on `entry.label` long-string instead of abilityId (logic)
Guards comparing `entry.label === '<short name>'` are always false because the
library label is a long descriptive string. Fix: also match on `abilityId`.
- **Stay Down** (Stun never applies — same pattern already fixed for Burst Fire one line below)

---

## HIGH

### Stay Down — Stay Down [logic]
- **File:** `src/game/abilities.js:2979`
- **Problem:** Post-attack Stun guard is `if (entry.label === 'Stay Down')`, but `entry.label` is the long string "After Close and Personal (target survived): free attack, then you become Stunned", so the condition is always false. `game.stayDownPendingMsgId` is never set and the consumer at `dc-play-area.js:2666` never applies the mandatory Stun. (Pattern P12; identical to the Burst Fire bug fixed one line below at :2987.)
- **Fix:** Match on the card id too: `if (entry.label === 'Stay Down' || abilityId === 'Stay Down')`.

### R2-D2 — Lucky [logic]
- **File:** `src/handlers/combat.js:2658-2659`; `src/engine/combat-abilities-mods.js:473-477`
- **Problem:** CSV: "While defending, if you roll a blank result, add +1 Dodge" (automatic). The resolver only sends a chat message and applies no bonus; the `applies` predicate requires `combat.defenseRoll?.dodge` truthy — the inverse of the "blank result" trigger. No blank-face detection exists anywhere. Lucky fires on the wrong condition and applies nothing.
- **Fix:** Detect a blank white-die face (0 block, 0 evade, no dodge); when present add +1 Dodge (`combat.bonusDodge += 1`). Re-gate `applies` on a blank face present, not on `defenseRoll.dodge`. Apply without a prompt (resolution=automatic).

### Lord of the Sith — Lord of the Sith [timing]
- **File:** `src/game/abilities.js:14208` (gate; null-return :14209). Caller `src/handlers/defeat-cc-prompts.js:387`.
- **Problem:** Card fires when a hostile is defeated NOT during your activation. The defeat-prompt resolves it with no msgId, but the resolver immediately calls `findActiveActivationMsgId` and returns `{applied:false, manualMessage:'No active DC found. Resolve manually.'}` whenever the player is not activating — the exact window the card targets. The effect silently never executes. (Pattern P9.)
- **Fix:** Resolve the Vader anchor via `resolvePlayingFigureKeyForUniqueCc(game, playerNum, 'Lord of the Sith')` (the Miracle Worker pattern) instead of requiring an active activation msgId.

### Dangerous Prey — reaction trigger [logic]
- **File:** `src/engine/combat-bridge.js:2017`
- **Problem:** The after-attack reaction is bound to `targetDcName: 'Bossk'`, but the card belongs to Fennec Shand (`cc-effects.json:390`, `unique-figure-ccs.json:28`). The gate at :2025 checks `targetFigKey.startsWith('Bossk-')`, so when Fennec Shand is attacked the reaction (and its within-4 check) never fires. (Pattern P9.)
- **Fix:** Change the REACTION_CARDS entry to `targetDcName: 'Fennec Shand'` (and rename the misleading `bosskPos` variable in post-combat.js).

### Dioxis Fumes — part 2 (no Strain recovery for non-Droids) [limitation]
- **File:** `src/game/abilities.js:6201`
- **Problem:** Sets `game.roundDioxisActive = true`, but no consumer reads the flag anywhere in the engine. The restriction (non-Droid figures cannot recover Strain until end of round) is declared but never enforced, and round.js never clears it. (Pattern P10.)
- **Fix:** In the Strain-recovery paths that already gate on `sustained_by_rage` (`abilities.js:6355-6359`, `6854-6857`), block Strain recovery when `game.roundDioxisActive` and the figure is non-DROID. Clear `roundDioxisActive` at round boundary in `handlers/round.js`.

### Ambush — Ambush [logic]
- **File:** `src/game/abilities.js:8831-8844` (damage); root cause :8787-8806 (move) and `data/ability-library.json:185-195` (no targetAttacker flag)
- **Problem:** CSV: move adjacent to the attacker, then THE ATTACKER suffers 2 Damage. Routed through generic `chooseAdjacentHostileThen`: (a) free Move-X with no "end adjacent to attacker" constraint, (b) when multiple hostiles are adjacent, the player picks any one to take the damage rather than forcing the attacker. (Pattern P6.)
- **Fix:** Add a dedicated Ambush branch constraining the move to end adjacent to `combat.attackerFigureKey` and applying 2 Damage to the attacker (no target choice), mirroring `cah.targetAttacker` (used by Counter Attack, abilities.js:9890-9909).

### Cara Dune — Smash [cost]
- **File:** `src/handlers/dc-play-area.js:2120` (gate :2187; `src/discord/components.js:1210`)
- **Problem:** Smash is a FREE once-during-activation ability (no "Special Action" prefix), but with no `actionCost` in the library entry `specialCosts=[]` so it defaults to cost 1 and consumes an action. (Pattern P1.)
- **Fix:** Add `"actionCost": 0` to the `smash` entry in `data/ability-library.json` (or route it through the free during-activation interrupt path). Preserve the once-per-activation limit.

### Diala Passil — Force Throw [cost]
- **File:** `src/handlers/dc-play-area.js:2120`
- **Problem:** Force Throw is a free in-activation ability costing only 1 Strain ("Suffer 1 Strain to ... push"), but lacking an `actionCost` it defaults to cost 1 and `consumeActionForCurrentFigure` (:2691-2692) charges a full action on top of the Strain. (Pattern P1.)
- **Fix:** Add `"actionCost": 0` to the `force_throw` entry in `data/ability-library.json`.

### Jabba the Hutt — Order Hit [cost]
- **File:** `src/handlers/dc-play-area.js:2120` (also `components.js:1210-1212`; `ability-library.json:3438`; resolve `abilities.js:2363-2372`)
- **Problem:** CSV marks Order Hit a "Double Action Special" (2 actions), but with no `actionCost` it renders/charges as 1 action and the resolve branch never returns `doubleAction:true`. (Pattern P1, inverse direction.)
- **Fix:** Add `"actionCost": 2` to `order_hit_jabba` in `ability-library.json`.

### Boba Fett — Wrist Cord [limitation]
- **File:** `src/game/abilities.js:624-705`
- **Problem:** CSV limit "once per round"; library declares `oncePer:'round'`, but the `pushTargetWithinRange` branch never reads/writes any round flag (only spends 2 MP). The sole `oncePer==='round'` enforcement lives in the unrelated `rollOneDieTarget` branch. Re-fires while 2 MP remain (leaks under re-activation/extra-activation effects). (Pattern P4.)
- **Fix:** Gate on `game.roundFigureAbilityUsed[`${selfFigureKey}_${abilityId}`]` in the `pushTargetWithinRange` branch, mirroring :3623/:3640.

### Boba Fett — Wrist Flamethrower [limitation]
- **File:** `src/game/abilities.js:4006-4126`
- **Problem:** CSV limit "once per round"; library declares `oncePer:'round'`, but the `fixedAreaEffect` handler spends 2 MP and applies the area effect with no round gate. Re-fires repeatedly while 2 MP remain. (Pattern P4.)
- **Fix:** Add a per-figure round-limit check/set in the `fixedAreaEffect` branch when `entry.oncePer==='round'`, matching :3623/:3640.

### [Doubt] — part 2 (forced attack-die reroll), wrong side [timing]
- **File:** `src/engine/combat-abilities-rerolls.js:66`
- **Problem:** The reroll loop sets `side = r.attack_side` and the CSV row has `attack_side='attacker'`, but Doubt is the DEFENDER's disruption upgrade. Registered attacker-side, the reroll button is offered to the wrong player; the defender who owns Doubt never gets the prompt. (Pattern P5.)
- **Fix:** Special-case Doubt (like Versatile Weaponry / `forcesDefenderReroll`) to register on the DEFENDER side with the attack pool: `side='defender'`, `pool='attack'`.

### [Doubt] — part 2 (deplete cost) [cost]
- **File:** `src/engine/combat-abilities-rerolls.js:166`
- **Problem:** Doubt's cost is "Deplete this card", but `exhaustOnUse` is only set when `/exhaust/i` matches the effect — "Deplete" fails it, so no cost is attached. `_markGateAbilityUsed` (`combat.js:257-277`) has no deplete path. The deplete cost is uncharged and the per-deck-cycle limit unenforced; `applies()` never checks `isDcDepleted`. (Patterns P5, P4.)
- **Fix:** Detect `/deplete/i` and thread a `depleteOnUse(msgId,playerNum)` param; have `_markGateAbilityUsed` call `depleteDc` on use, and gate `applies()` on `!isDcDepleted`.

### Mortar Trooper — Haul [limitation]
- **File:** `src/game/movement.js:530-546`
- **Problem:** Haul is the Mortar Trooper SU figure's own ability, but detection only checks the group carries the `[Mortar Trooper]` attachment, so `hasMortarHaul=true` for EVERY figure in the group (base Shoretroopers too), over-granting the terrain waiver group-wide. (Same scoping already fixed for Guidance Systems on this card.)
- **Fix:** Gate the Haul flag on `squadUpgradeFigureCard(game, figureKey) === 'Mortar Trooper'` (helper at `combat-abilities-mods.js:238` / `movement.js:490`), not group-level attachment presence.

### Wing Guard (Regular) — Keep the Peace [choice]
- **File:** `src/handlers/combat.js:4272-4278`
- **Problem:** Spec is an interactive defender choice ("you may suffer 1 Strain; if you do, the attacker suffers 1 Strain", limit 1/attack). Handler only posts a prose reminder — no button, no `applyStrain` on either figure, no per-attack limit. The whole exchange is left to manual play (the Elite variant is fully automated).
- **Fix:** Replace the reminder with an interactive prompt ('Suffer 1 Strain → Strain attacker' / 'Skip') routed to `applyStrain` on both figures, with a once-per-attack flag (`combat._ktpRegularUsed`).

---

## MEDIUM

### Krrsantan — Bleed [logic]
- **File:** `src/engine/combat-bridge.js:891`
- **Problem:** Innate Bleed keyword routes to `combat.bonusConditions`, consumed only inside the `if (damage > 0 && !_epReentry)` block, but CSV says "if the attack does not miss". The no-miss path (:1795) reads only `surgeNoMissConditions`, never the innate keyword, so on a 0-damage hit Bleed is dropped. (Pattern P8.)
- **Fix:** Route the innate Bleed keyword through `combat.surgeNoMissConditions` in `applyDcPassivesToCombat`, or add a hit-gated (not `damage>0`) branch.

### The Grand Inquisitor — Deadly Spin [logic]
- **File:** `src/game/combat.js:297`, `:431-433`
- **Problem:** Effect is "-1 Dodge ... gains Cleave 3", but `surgeCancelDodge=true` cancels ALL dodge results regardless of count. Against 2 dodge it wrongly hits instead of leaving 1 dodge (miss). (Pattern P7.)
- **Fix:** Route through the -1 dodge path like Conclusion: set a flag doing `combat.bonusDodge -= 1` (clamped via existing Math.max at :432). Keep Cleave 3.

### Hera Syndulla — Call the Shots [limitation]
- **File:** `src/handlers/combat.js:1446`
- **Problem:** Line 1446 sets `roundFigureAbilityUsed[`${fk}_call_the_shots`]=true` unconditionally BEFORE the choice branches, so clicking 'Skip' burns the once-per-round limit. `applies()` (`combat-abilities-mods.js:107`) reads that key, so a no-op Skip permanently disables the ability for the round. (Pattern P3.)
- **Fix:** Move the `roundFigureAbilityUsed` write inside the acc/hit/surge apply branches; do not stamp on Skip (mirror `get_down` at :1472-1481 / `Resourceful` at :895).

### Bo-Katan Kryze — Dual-Wield Pistols [logic]
- **File:** `src/engine/combat-bridge.js:2408-2427`
- **Problem:** The 2 Block Tokens are contingent on performing the bonus attack ("Before performing this bonus Ranged attack, you gain 2 Block Tokens"), but the handler sets the once-per-round flag AND grants 2 Block unconditionally at offer time (:2414/:2417). Declining still pockets 2 free tokens and burns the limit. (Pattern P3.)
- **Fix:** Defer `grantPowerTokens(Block,2)` and the `roundFigureAbilityUsed` flag into the granted-attack handler so they only fire when the bonus attack is declared.

### Second Sister — Mastery [limitation]
- **File:** `src/engine/combat-bridge.js:2092`
- **Problem:** Sets `roundFigureAbilityUsed[mastKey]=true` BEFORE checking outcome. On the no-eligible-cards exit (:2104) or Rest-in-Peace block (:2094) the once-per-round limit is consumed even though nothing was redrawn. (Pattern P3.)
- **Fix:** Mark used only once a redraw is committed (inside `mastery_pick`); leave the limit unset on the early exits.

### Jawa Scavenger (Elite/Regular) — Take Cover [choice]
- **File:** `src/engine/combat-abilities-mods.js:500`
- **Problem:** CSV resolution=prompt, "you MAY apply +1 Block and -1 Evade", but registered as `kind:'passive'` and auto-applied by the gate, so the forced -1 Evade downside lands even when the defender would decline. (Pattern P2.)
- **Fix:** Re-register `take_cover` as `kind:'interactive'` (like `agile` at `combat.js:1432`) with an Apply/Skip prompt.

### Run for Cover — Run for Cover [choice]
- **File:** `src/handlers/combat.js:4896-4897`, `:5047-5048`; `abilities.js:10810-10816`
- **Problem:** Defender must "Choose 1 die and remove it from the attack pool", but the engine does `dice.slice(0, length - removeMax)` — removes trailing (bonus) dice with no choice. For a heterogeneous pool which die is removed matters. (Pattern P6.)
- **Fix:** When `attackPoolRemoveMax>0` and the pool has >1 distinct die, post an attack-die picker mirroring `_postDefenseDieRemovePicker` (`combat.js:4929-4933`).

### Savage Vigor — Savage Vigor [choice]
- **File:** `src/handlers/combat.js:4898-4899`, `:5049-5050`; `abilities.js:10828-10834`
- **Problem:** "The attacker chooses 2 attack dice and removes the rest", but the engine does `dice.slice(0, keepMax)` — keeps the first 2 (base before bonus) with no choice. Matters for mixed pools. (Pattern P6.)
- **Fix:** When `attackPoolKeepMax` is set and the pool exceeds it, prompt the ATTACKER to choose which dice to keep (picker analogous to the defense-die remover).

### Choose a Side — Choose a Side [choice]
- **File:** `src/game/abilities.js:14626`
- **Problem:** Part 2 is mandatory and affiliation-keyed (SCUM vs IMPERIAL), but the handler offers a free menu letting the player pick either branch regardless of their army affiliation. (Pattern P6.)
- **Fix:** Derive the branch from the playing army's affiliation and auto-apply (reuse the `affiliationDetermined`/`firstSeenArmyAffiliation` pattern this file uses for Reactive Loyalties at :529-537). Only prompt if genuinely ambiguous.

### Blaze of Glory — Blaze of Glory [logic]
- **File:** `src/game/abilities.js:10386`
- **Problem:** Card is unique to IG-88 ("Ready your Deployment card"), but the handler builds a choice list of ALL the player's DCs and lets them ready any one. (Pattern P6.)
- **Fix:** Restrict the readied DC to the activating IG-88 figure's own DC (the `readyOwnDeploymentCard` / `findActiveActivationMsgId` pattern used by Son of Skywalker at :15261).

### Kanan Jarrus — Soresu Form [logic]
- **File:** `src/handlers/combat.js:2660`
- **Problem:** Effect: convert each Dodge to +2 Block/+1 Evade AND, if the figure is not FORCE USER, Kanan suffers 1 Strain. The resolve handler only does the conversion and nulls `soresuFormFigKey`; the conditional 1 Strain is never applied (comments at :1314-1315 falsely claim it is).
- **Fix:** After conversion, check whether the rerolling figure (`combat.soresuFormFigKey`'s dc) has FORCE USER; if not, apply 1 Strain to Kanan.

### Taron Malicos — Madness [choice]
- **File:** `src/handlers/soa-handler.js:239-247` (prompt) + `:884-913` (skip :908-909)
- **Problem:** CSV resolution=automatic, no "may" (mandatory 1 Strain + Focus when hand ≤ 2), but rendered with Apply/Skip; Skip dodges the mandatory penalty. (Pattern P2.)
- **Fix:** Auto-fire at start of activation when hand ≤ 2 (no Skip): apply 1 Strain + Focus unconditionally. Keep only an informational message.

### Jundland Terror — Jundland Terror [timing]
- **File:** `src/game/abilities.js:12127-12176`
- **Problem:** CSV end_of_round: the chosen figure "gains 2 MP and may interrupt to perform an attack or Special Action" — an immediate EOR interrupt. Implementation defers both the 2 MP and the free attack/special to the figure's NEXT activation, changing when the MP is spent and when the interrupt resolves.
- **Fix:** Resolve as an immediate EOR interrupt: grant 2 MP for use now and present the attack/Special Action during the EOR window, not via next-activation pending flags.

### Tress Hacnua — Leg Hydraulics [logic]
- **File:** `src/handlers/after-attack-resolve.js:165-171`
- **Problem:** Effect is enqueued with label "Leg Hydraulics: gain 1 MP" (and a matching comment), but the fire (`fireLegHydraulics`) actually does a move-up-to-1-space (correct per spec). Button text mislabels a move as an MP grant. (Pattern P11.)
- **Fix:** Change the enqueued label (and comment) to "Leg Hydraulics: move up to 1 space".

### Deflection — part 2 (counter-damage) [limitation]
- **File:** `src/handlers/after-attack-resolve.js:617`
- **Problem:** Conditional is "when a Ranged attack targeting you is declared" and `deflectionRangedOnly:true` exists, but the flag is never consumed; the counter-damage fires on any attack (no Ranged check), and the play gate isn't Ranged-gated either. Triggers wrongly against Melee. (Pattern P10.)
- **Fix:** Gate the deflection counter-damage on `combat.isRanged` (consume `deflectionRangedOnly`) and/or restrict the play-timing to Ranged attacks. (Part 1 accuracy penalty already self-gates via `attackType:'range'`.)

### Dangerous Prey — hand-dropdown path [limitation]
- **File:** `src/game/abilities.js:14342`
- **Problem:** When played from the hand dropdown, the resolver applies 1/3 Damage based only on adjacency and never enforces the CSV "within 4 spaces of the attacker" conditional; it also grants 2 MP instead of the proper move. Only the reaction path checks within-4.
- **Fix:** Add a `countGameSpaces(defenderPos, attackerPos) > 4` short-circuit (mirroring `post-combat.js:103`) before applying damage; use the Move-X picker, not a flat 2 MP grant.

### Escalating Hostility — defenderStrainPlusDiscardCopies [logic]
- **File:** `src/game/abilities.js:6482`
- **Problem:** "+1 Strain per OTHER copy in discard", but the handler counts `discard.filter(c => c === context.cardName).length` without excluding the just-played copy (already pushed to discard at `cc-hand.js:813` before resolution). Overcounts by 1 (n=2 instead of 1 with no other copies).
- **Fix:** `const copiesInDiscard = Math.max(0, discard.filter(...).length - 1);` (or exclude the resolving card's index).

### Navigation Upgrade — Navigation Upgrade [logic]
- **File:** `src/game/abilities.js:14656-14711`
- **Problem:** Part 1 is only "Take 1 Strain and place this card"; the +1 MP to a friendly DROID is the separate part-2 exhaust. But on first play, if any friendly DROID exists, the resolver forces an immediate DROID MP-grant choice (:14711) with no plain place option — strain is only queued alongside the grant.
- **Fix:** On initial play, pay strain and place the attachment READY without granting MP; surface the +1 MP DROID grant only as the later exhaust action during a friendly DROID activation.

---

## LOW

### Alliance Ranger (Regular) — Sniper [choice]
- **File:** `src/engine/combat-abilities-rerolls.js:246`
- **Problem:** CSV resolution=automatic, mandatory "you reroll 1 attack die" (no "may"), but the reroll loop hardcodes `kind:'interactive'`, so it's offered as a skippable Skip/Done gate button instead of auto-firing. Sibling Elite Sniper (resolution=prompt) is correctly interactive. The imported sniper helpers are dead. (Patterns P5, P2.)
- **Fix:** When `r.resolution==='automatic'` (and no "may"), register as an auto-firing passive that forces the reroll(s) once the dist≥5 gate opens. Remove the dead sniper-helper imports or wire them in.

### Dewback Rider — Shock Lance [choice]
- **File:** `src/game/abilities.js:3717`
- **Problem:** Card reads "Choose a figure within 2 spaces" (any figure), but `rollOneDieTarget:'hostileWithinRange'` enumerates only enemy positions, so a friendly figure can never be targeted. (Pattern P6.)
- **Fix:** Add an `allowFriendly` flag to the `hostileWithinRange` enumeration for Shock Lance (as `targetHostileFigure`/Bully already supports).

### Iden Versio — Droid Kit [choice]
- **File:** `src/engine/activation-setup.js:864-876` (button :870; handler `activation.js:2271-2284`)
- **Problem:** CSV "gain 1 Power Token" (player-chosen type), but the live prompt hard-codes a single Damage-token Apply button. The handler's `tokenMap` already supports all 4 types. An inline designer note deliberately restricts to Damage (contested vs CSV). (Pattern P6.)
- **Fix:** If CSV is authoritative, restore the 4-way token picker (Damage/Surge/Block/Evade); otherwise update the CSV/effect text to the Damage-only ruling so spec and code agree.

### Built on Hope — Built on Hope [choice]
- **File:** `src/game/abilities.js:12275`
- **Problem:** Non-chosen cards go on top/bottom "in any order", but the handler places them as a fixed-order group and only offers top-vs-bottom, never per-card ordering. (Pattern P6.)
- **Fix:** When 2+ cards remain, offer an additional ordering/per-card placement choice.

### Capitalize — passive redraw [choice]
- **File:** `src/game/cc-passive-redraw.js:233`
- **Problem:** CSV resolution=prompt, "you MAY re-draw this card", but `checkCapitalizePassiveRedraw` auto-redraws unconditionally (comment "treating may as opt-in default"), never offering the choice.
- **Fix:** Surface a may/skip prompt for the owner instead of silently moving the card to hand, or document as intentional always-beneficial auto-apply.

### Shared Experience — passive discard re-draw [choice]
- **File:** `src/engine/defeat-handler.js:222`
- **Problem:** CSV resolution=prompt, "you MAY re-draw this card" when a friendly DROID/VEHICLE is defeated, but `checkFriendlyDefeatedPassiveRedraws` unconditionally moves the card to hand. (The same handler correctly prompts for Into the Force just below.)
- **Fix:** Offer the re-draw as an optional prompt/button to the owning player rather than auto-moving the card.

### Diala Passil — Defensive Stance [logic]
- **File:** `src/handlers/combat.js:1354` (also :2656)
- **Problem:** "Convert EACH Dodge to 2 Block and 1 Evade", but both sites add a flat +2 Block/+1 Evade and zero dodge regardless of count. With 2+ Dodge, only one Dodge's worth is converted. (Pattern P7.)
- **Fix:** Scale by the dodge count: `block += 2*dr.dodge; evade += 1*dr.dodge` before zeroing dodge (as Wookiee Avenger does at `src/game/combat.js:425`).

### Gaarkhan — Bleed [logic]
- **File:** `src/engine/combat-bridge.js:887-921` (figure-path `_step7Hit` set :1287)
- **Problem:** Passive Bleed/Weaken merge is nested inside the `damage > 0` guard, but CSV says "if the attack does not miss". A 0-damage hit (accuracy met, all damage blocked) fails to apply Bleed. Possible intentional G22 house-rule — confirm with designer. (Pattern P8.)
- **Fix:** Gate the passive-keyword Bleed/Weaken path on `combat._step7Hit` rather than `damage > 0`, after designer confirmation re G22.

### Dr. Royce Hemlock — Neurostim [logic]
- **File:** `src/game/abilities.js:2198`
- **Problem:** CSV says a Damage result grants a BLOCK Token; code grants a DAMAGE Token, with an inline comment asserting the CSV wording is stale. Unreconciled spec-vs-code conflict. (Pattern P11.)
- **Fix:** Reconcile against the printed card: correct CSV row 222 if the card truly grants Damage, else change :2198 to grant 'Block'.

### Mandalorian Steel — Mandalorian Steel [logic]
- **File:** `data/ability-library.json:3044`
- **Problem:** CSV says recover triggers on "spent a Power Token", but the code, cc-effects, and the verified card all use a Block Token (the Armorer is a Block-token figure). CSV "Power Token" is the transcription error. (Pattern P11.)
- **Fix:** Correct `combat-spec.csv` row 742 to "spent a Block Token"; no code change.

### Furious Charge — Furious Charge [logic]
- **File:** `src/game/abilities.js:7666`
- **Problem:** Live fire correctly readies the DC, but the play-time handler returns the stale message "will automatically become Focused if you suffer 3+ Damage", and the library entry still carries inert `applyFocus`/`conditionalFocusIfDamagedGte`/"Focused" label. Contradictory messaging. (Pattern P11.)
- **Fix:** Update the :7666 logMessage to describe readying the DC; scrub stale `applyFocus`/label/logMessage "Focused" wording from the library entry.

### Thrawn — Long-Laid Plans [logic]
- **File:** `src/handlers/soa-handler.js:487`
- **Problem:** Prompt says "among friendlies within 3", but spec has no range and the orchestrator correctly builds candidates from ALL friendlies. The "within 3" is a stale, misleading label. (Pattern P11.)
- **Fix:** Drop "within 3" from the prompt string.

### Ko-Tun Feralo — Dead Precise [logic]
- **File:** `data/ability-library.json:1147`
- **Problem:** The library description reads "While attacking, if you did not move ... +2 Accuracy" — a completely different ability. Live behavior is correct (token-gated reroll + -1 Dodge rider); this is a stale/wrong description string. (Pattern P11.)
- **Fix:** Correct the `dead_precise_kotun` description to match the printed card (spent-token reroll + -1 Dodge for an attacking figure within 3 of Ko-Tun).

### Fifth Brother — Sith Acolyte [logic]
- **File:** `src/game/abilities.js:15656`
- **Problem:** Card text uniquely requires the fetched Command Card to be revealed, but the resolver deliberately suppresses the name in the public log (CC-secrecy convention). Contradicts the printed text.
- **Fix:** Reveal the fetched card name for Sith Acolyte specifically (post to public log), or confirm with the designer that the reveal is intentionally dropped.

### Royal Guard (Elite) — Forward Vengeance [logic]
- **File:** `src/game/damage-pipeline-hooks.js:1407-1410` (+ apply :1428-1433); `src/engine/combat-bridge.js:1173-1180`
- **Problem:** Elite restricts the trigger to an adjacent friendly non-GUARDIAN, non-companion figure being defeated, but both the Focus hook and the move prompt only exclude GUARDIAN, not companion. A defeated Companion DC adjacent to an Elite wrongly triggers Forward Vengeance.
- **Fix:** For the Elite variant, additionally skip if the defeated figure is a companion (`defeatedEff?.companion` / DC `card_type==='Companion DC'`), mirroring the existing GUARDIAN exclusion.

### Del Meeko — Expertise [limitation]
- **File:** `src/handlers/dc-play-area.js:3293`
- **Problem:** Expertise is "once per activation", but tracked in `game.roundFigureAbilityUsed` (round-scoped, cleared per round). A figure granted a second activation in the same round would be wrongly blocked. (Pattern P4.)
- **Fix:** Track via an activation-scoped key (e.g. `specialsUsedByFig` / a *UsedThisActivation map) so the limit resets per activation.

### Mounted (Tauntaun/Terro/Dewback/Kuiil/74-Z) — Mounted [choice]
- **File:** `src/handlers/soa-handler.js:203-211` (prompt) + `:829-839` (fire)
- **Problem:** CSV resolution=automatic, no "may" ("Gain 3 movement points"), but offered as Apply/Skip; Skip grants no MP. Mandatory benefit shown as skippable. (Pattern P2.)
- **Fix:** Auto-grant 3 MP at start of activation (no Skip), or at minimum default-apply. Reserve Skip for interactive/"may" abilities only.

### Pickpocket — pickpocketVpByAccuracy [logic]
- **File:** `src/game/abilities.js:11139`
- **Problem:** Rolls 1 green die for VP equal to Accuracy, but the choice menu offers ['0 (miss)','1','2','3']. A green attack die has no Accuracy-0 face, so '0 (miss)' is an impossible result yielding 0 VP.
- **Fix:** Present `['1','2','3']` mapping `accuracy = choiceIndex+1` (choiceCount 3).

### Agent Blaise — Surge: +1 Damage [logic]
- **File:** `data/dc-effects.json:722-728` (duplicate "damage 1" at :725-726); rendered `src/handlers/combat.js:2787-2795`
- **Problem:** `surgeAbilities` lists "damage 1" twice (`["accuracy 3","pierce 2","damage 1","damage 1","interrogate"]`), so combat.js renders a phantom second "+1 Damage" surge option not on the card.
- **Fix:** Remove the duplicate "damage 1" entry from Agent Blaise's `surgeAbilities` array in `data/dc-effects.json`.
