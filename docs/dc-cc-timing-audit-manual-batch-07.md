# DC/CC Timing Audit — Manual Triage Batch 07

Scope: DCs alphabetical after General Sorin, 10 cards: General Weiss,
Gideon Argus, Greedo, HK Assassin Droid (Elite), HK-47, Han Solo, Heavy
Stormtrooper (Elite), Heavy Stormtrooper (Regular), Hera Syndulla, Hired
Gun (Elite).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## General Weiss

**General's Orders** — "At the start of your activation choose up to 2 other friendly figures on the map. Those figures may each interrupt to perform a move."
- Impl: `src/engine/activation-setup.js:825-843` — at SoA, enumerates non-self friendlies on the map, posts a picker with up to 4 friendlies (slice) + Done button. `setPendingGeneralsOrders` tracks `remaining: 2, chosen: []`. Friendly chosen figures each gain Speed-MP for an immediate move.
- ⚠️ suspicious — **picker only shows first 4 friendlies** (`friendlyFigs.slice(0, 4)`). If the player has >4 non-self friendlies, the player can't pick from the rest. For a typical Imperial army with multiple groups, this could exclude valid choices (e.g., 6+ Stormtrooper figures + LEADERs). Discord 5-button-row constraint is real, but the picker should chunk/page through ALL friendlies, not silently truncate.

**Epic Arsenal** — "Your attack pool consists of any combination of 3 attack dice. You cannot roll more than 2 dice of a single color."
- Impl: `src/engine/available-actions.js:1879-1900` (`epic_arsenal` keyed, 3-dice combos enumeration) + `src/handlers/dc-play-area.js:963-971` (handles focus-die interaction with the color cap — per destruct 2026-05-06: "focus die would always be green; chosen 3 must keep total greens ≤ 2 i.e. ≤ 1 chosen green when Focused").
- ✅ correct — combo enumeration excludes 3-of-same-color; Focus-die interaction handled correctly.

---

## Gideon Argus

**Special Action (Tactical Maneuver)** — "Choose another friendly figure in your line of sight. That figure gains 2 movement points."
- Impl: `src/game/abilities.js:1132-1145` (`tactical_maneuver` keyed) — stamps `pendingMoveX` with `bypassCosts: false` so the recipient's terrain/figure costs apply normally to the 2-MP move.
- ⚠️ suspicious — verify **LoS gate** is enforced at target enumeration. Card says "in your line of sight" — Gideon must have LoS to the chosen friendly. Per the impl excerpt, the call site doesn't show a LoS filter; confirm `getFigureKeysForDcMsg` or downstream enumeration applies LoS-from-Gideon.

**Special Action (On My Mark)** — "Choose another friendly figure in your line of sight. That figure becomes Focused."
- Impl: `src/game/abilities.js:1111-1124` (`on_my_mark` keyed) — applies Focus to chosen friendly.
- ⚠️ suspicious — same LoS-gate concern as Tactical Maneuver. Verify LoS-from-Gideon filter on target enumeration.

---

## Greedo

**Slow on the Draw** — "When you declare an attack, the defender may interrupt to perform an attack targeting you."
- Impl: `src/handlers/combat.js:2999-3014` — fires on Greedo's attack declare; sets `pendingSlowOnTheDraw` and posts Use/Decline buttons to the defender owner.
- ✅ correct — fires at step 1+2 declare (after target selection so the defender is known); defender-controlled interrupt prompt; per memory `project_session_20260510_alexanbv_part2.md` 2026-05-10, SoTD was migrated to combatStack (architectural fix). Note: `handleSlowOnTheDrawUse` (not shown here) must enforce that the interrupt attack targets Greedo specifically.

**Parting Shot** — "When you have suffered Damage equal to your Health, before you are defeated, you may interrupt to perform an attack. Then, you are defeated."
- Impl: `src/game/damage-pipeline-hooks.js:559-612` — `BEFORE_DEFEATED_HOOKS.push({ id: 'parting_shot', requiresDamage: true, ... })`. Stun gate at Step 7 snapshot (suppress Parting Shot if defender is Stunned pre-Step-8). Posts Fire/Skip buttons to the defeated-figure's owner.
- ✅ correct — BEFORE_DEFEATED pipeline-hook ordering preserves canonical timing (HP→0 first, then PS check). `requiresDamage: true` correctly blocks PS on direct-defeat sources. Stun-gate uses pre-Step-8 conditions to handle mid-attack Stun applications. Shared id family `parting_shot_*` covers Greedo, Hired Gun Elite, etc.

---

## HK Assassin Droid (Elite)

**Targeting Computer** (passive) — "While attacking, you may reroll 1 attack die."
- Impl: `src/game/targeting-computer-helpers.js:20-27` — shared id family includes `targeting_computer_hk_elite`, `_ig11`, `_probe_elite`, `_sentry_elite/reg`, `_atst`. Routes through the unified reroll bucket.
- ✅ correct — named reroll bucket button in step-3 attacker reroll window.

**Versatile Weaponry** — "While attacking, you may force the defender to reroll 1 defense die."
- Impl: `src/handlers/combat.js:3793-3796` — pushes a forced-reroll-queue entry: `{ controlPlayer: attackerPlayerNum, pool: 'defense', remaining: 1, source: 'Versatile Weaponry' }`.
- ⚠️ suspicious — verify (a) "**may force**" → "may" = player choice; confirm a Use button is shown to attacker (not auto-fire). The queue entry has `remaining: 1` and would consume the defender's die automatically unless the attacker has explicit control. Worth a click-through. (b) The forced reroll happens at step-3 defender reroll phase, where the attacker controls a defense-die reroll — confirm queue routing matches the 2026-05-13 unified model.

**Merciless** (passive) — "When you declare an attack, if the defender has any HARMFUL conditions, it suffers 1 Damage."
- Impl: `src/handlers/combat.js:1589-1616` (registration on attack declare) + `:4194+` (`handleMercilessUse` button handler with click-time HARMFUL re-check). Per alexanbv 2026-05-13 in memory: attacker-controlled "Use Merciless" button — NOT auto-fire — so other on-declare effects (CCs that add HARMFUL conditions, etc.) can apply first.
- ✅ correct — on-declare button; click-time re-check of `['Bleed', 'Stun', 'Weaken']` so mid-window condition changes are respected. Damage applied via the standard pipeline. Matches alexanbv 2026-05-13 intent.

---

## HK-47

**Query** — "When you declare an attack, apply +1 Damage to the attack results unless the defender becomes Bleeding."
- Impl: `src/game/query-hk47-helpers.js:17-29` (`QUERY_HK47_ABILITY_ID = 'query_hk47'`, `QUERY_BONUS_HITS = 1`) + `src/engine/combat-bridge.js`.
- ⚠️ suspicious — **conditional Bleed-cancel logic**: card text says "apply +1 Damage **unless** the defender becomes Bleeding." This means the +1 Damage applies, but is *removed* if a Bleed condition gets applied to the defender during this attack (e.g., via a Bleed surge, Bleed CC, etc.). Verify the +1 Damage is set provisionally at declare and *retracted* at the end of step 5 (surge) if Bleed lands. Or alternatively, only fires if no Bleed-applying surge/CC is in play.

**Conclusion** — "While attacking, apply -1 Evade to the defense results."
- Impl: `src/game/combat.js`, `src/game/evade-debuff-helpers.js`, `src/handlers/combat.js` — shared with Loku Kanoloa Pierce/Evade debuffs.
- ✅ correct — step-4 attacker passive modifier; -1 Evade subtracted from defender's final evade count (min 0).

**Mockery** — "Once during your activation, you may choose a hostile figure in your line of sight. That figure suffers 1 Strain."
- Impl: `data/ability-library.json:mockery` (`targetHostileFigure: { strain: 1, requiresLos: true }`, `freeAction: true`).
- ⚠️ suspicious — descriptor has `freeAction: true` but no `oncePer: activation` flag. Card limits to "Once during your activation" — verify the once-per-activation gate is enforced (similar concern as Squad Captain in batch 04).

---

## Han Solo

**Return Fire** — "After an attack targeting you is resolved, if you did not suffer any Damage, you may interrupt to perform an attack targeting that attacker. Limit once per round."
- Impl: `src/engine/combat-bridge.js:2922+` — inline path **disabled** 2026-05-09 (`if (false)` guard). Live path is `fireReturnFire` via `combat._pendingDefenderChainAttacks` queue, which `_finishCombatResolution` runs BEFORE attacker chain queue per alexanbv 2026-05-09 priority spec. Han's variant requires `combat._appliedDamage === 0` (Rogue Smuggler attachment override exists for the no-damage requirement).
- ✅ correct — post-resolve fire; "did not suffer damage" gate; once-per-round gate via `roundFigureAbilityUsed[returnFire_<fk>]`; chained attack ordering defender-before-attacker per priority spec.

**Distracting** (shared id with C-3P0) — see batch 03.
- ✅ correct.

**Cunning** — "While defending, apply +1 Block to the defense results for each Evade result."
- Impl: `src/game/cunning-helpers.js:13-18` — shared id family `cunning_han`, `cunning_jyn`, `cunning_nexu_elite`, `cunning_nexu_reg`. Step-4 defender passive that adds bonusBlock = evade-count.
- ⚠️ suspicious — verify (a) "for each Evade result" counts the FINAL post-mods evade count (not just the rolled evade — Targeted-Network etc. could change it), (b) the +Block is applied AFTER all other defense mods so the count is stable. Also: confirm Dodge results don't count (Dodge != Evade; Dodge is the trump-card result).

---

## Heavy Stormtrooper (Elite)

**Modular** — "You may include an attachment card in your army and decrease its cost by 1, to a minimum of 0. During setup, you must attach that card to this group."
- Impl: `src/game/validation.js` (army-build attachment cost reduction) + `src/game/modular-hse-helpers.js` + `data/ability-library.json:modular_heavy_stormtrooper` (descriptor `category: passive`, "army-building rule").
- ⚠️ suspicious — verify (a) "**must attach** that card to this group" — i.e., the discounted attachment is force-attached to the HSE group, NOT free-floating in the army's pool, (b) min-0 floor on cost reduction, (c) only ONE attachment gets the -1 (not all of them).

**Spray Fire** — "While attacking, you may apply -3 Accuracy and +1 Surge to the attack results."
- Impl: `src/game/spray-fire-helpers.js:14-22` — `SPRAY_FIRE_ACCURACY_DELTA = -3`, `SPRAY_FIRE_SURGE_DELTA = 1`. "May" → player-choice.
- ⚠️ suspicious — verify (a) "may" → Use button (not auto-apply), (b) -3 Accuracy and +1 Surge are applied as a **pair** (single decision), not independently, (c) the trigger fires at step-4 attacker mods (since "While attacking" with a modifier-result).

---

## Heavy Stormtrooper (Regular)

**Composite Plating** — "While defending, if the attacker is 4 or more spaces away, apply +1 Block to the defense results."
- Impl: `src/game/composite-plating-helpers.js:11-18` — `COMPOSITE_PLATING_MIN_DISTANCE = 4`, `COMPOSITE_PLATING_BONUS_BLOCK = 1`.
- ✅ correct — step-4 defender passive; gated on attacker-distance ≥ 4 spaces (path-counted, not Chebyshev).

---

## Hera Syndulla

**Call the Shots** — "While another friendly figure within 3 spaces is attacking, you may apply +2 Accuracy, +1 Damage, or +1 Surge to the attack results. Limit once per round."
- Impl: `src/handlers/combat.js:6705-6716` — at step-4 attacker mods, scans for Hera within 3 spaces of attacker; if found and once-per-round (`roundFigureAbilityUsed[<HeraFk>_call_the_shots]`) unused, sets `pendingCombatPassive = 'call_the_shots'` + `callTheShotsFigKey` to surface a 3-option picker.
- ⚠️ suspicious — verify (a) the 3-option picker (Acc/Dmg/Surge) prompts **Hera's controller**, not the attacker's controller — important if the attacker is a different player, but for skirmish both Hera and the attacker should be on the same side. (b) "**Another** friendly figure" → Hera herself attacking shouldn't trigger Call the Shots (excludes self). Confirm the call-site filter excludes Hera's own figureKey. (c) Once-per-round gate covers all Hera figures (the gate is keyed on `_call_the_shots` with figureKey — if Hera has only 1 figure, fine, but if a Form Card or attachment grants additional Hera-like ability the dedupe should hold).

**Smooth Landing** (shared with Bodhi Rook) — see batch 02.
- ✅ correct.

---

## Hired Gun (Elite)

**Self-Preservation** — "When you suffer Damage, you become Focused."
- Impl: `src/game/damage-pipeline-hooks.js:97-111` — `WHEN_DAMAGED_HOOKS.push({ id: 'self_preservation_hired_gun_elite', sync: true, probe, apply: applyCondition Focus })`. Fires only when amount > 0.
- ✅ correct — WHEN_DAMAGED hook; source-agnostic (Bleed, Blast, attack, Strain→damage all trigger); idempotent Focus application.

**Parting Shot** (shared id family with Greedo) — see Greedo above.
- ✅ correct — same `parting_shot` BEFORE_DEFEATED hook; `parting_shot_hired_gun_elite` matches `startsWith('parting_shot_')`.

---

## Batch 07 — Summary

- ✅ correct: 11
- ⚠️ suspicious: 11
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced this batch:**
1. **General Weiss General's Orders picker truncation** (`activation-setup.js:833`) — `friendlyFigs.slice(0, 4)` silently drops friendlies beyond the first 4. For armies with >4 non-self friendly figures (typical Imperial army with multiple Stormtrooper groups + LEADERs), the player can't pick from the rest. Worth a chunk/page implementation.
2. **HK-47 Query Bleed-cancel logic** — "+1 Damage unless defender becomes Bleeding" requires the +1 to be **retracted** if a Bleed condition lands mid-attack. Verify the cancel path; if the +1 is set at declare and never re-checked, Bleed-application doesn't undo it.
3. **HK Assassin Elite Versatile Weaponry "may" semantics** — Push to forced-reroll-queue with `remaining: 1` may auto-consume; confirm a Use/Skip button is presented to the attacker (player choice per "may"), not auto-fire.
4. **Heavy Stormtrooper Elite Modular** — verify the discounted attachment is force-attached to the HSE group at setup, not pooled.

**Next:** Batch 08 (DCs alphabetical after Hired Gun (Elite)).
