# DC/CC Timing Audit — Manual Triage Batch 05

Scope: DCs alphabetical after Dewback Rider (10 cards): Diala Passil, Dio,
Director Krennic, Doctor Aphra, Dr. Royce Hemlock, Drokkatta, E-Web Engineer
(Elite), E-Web Engineer (Regular), Echo Base Trooper (Elite), Echo Base
Trooper (Regular).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Diala Passil

**Battle Meditation** — "Before you declare an attack, become Focused."
- Impl: `src/handlers/combat.js:2233` via `hasBattleMeditationAbility` + shared helper in `src/game/battle-meditation-helpers.js`. Same site as BT-1's Assassin (label dynamically switches).
- ✅ correct — auto-Focus + 1 green die at step 1+2 declare.

**Defensive Stance** — "While defending, you may reroll 1 defense die. If you do, convert each Dodge result to 2 Block and 1 Evade."
- Impl: `src/game/defensive-reroll-helpers.js:17` (`DEFENSIVE_STANCE_ABILITY_ID`) + `src/handlers/combat.js`. Shared family with Foresight (Vader).
- ⚠️ suspicious — verify the **Dodge → 2 Block + 1 Evade conversion** is applied to the rerolled die. Per `src/game/combat.js` `getInnateRerolls`/`getInnateRerollAbilities`, Defensive Stance has special Dodge-conversion logic — confirm it's still applied post-2026-05-13 unified reroll bucket refactor (memory notes the conversion preservation but worth a click-through).

**Force Throw** — "Once during your activation, you may suffer 1 Strain to choose another small figure within 3 spaces. Push that figure up to 2 spaces."
- Impl: `src/game/abilities.js:321` (`pushTargetWithinRange` family) + `src/handlers/dc-play-area.js`. Library entry at `data/ability-library.json:force_throw`.
- ⚠️ suspicious — card says "another **small** figure" (excludes self + non-small). Verify SMALL filter is in the target enumeration phase. Also: "suffer 1 Strain" cost — verify Strain pipeline runs (including Headhunter/Fireproof triggers) and that Force Throw can be **cancelled** if the player can't or won't pay the Strain.

---

## Dio

**Attached** — "When a friendly 'Iden Versio' exits your space, interrupt to move up to 1 space."
- Impl: `src/game/attached-dio-helpers.js:27` (`detectAttachedTrigger`) called from `src/handlers/movement.js:1395-1419` + `src/game/abilities.js` (Dio follow handler) + `src/game/apply-move.js` (state). Library entry `attached_dio` in `data/ability-library.json`.
- ✅ correct — fires inside the movement handler when Iden Versio exits a space sharing Dio's footprint. Player-choice follow prompt shown to Dio's owner with adjacency-set + default-space picker.

**Insignificant** — "You cannot be the target of an attack while in the same space as a friendly figure."
- Impl: `src/engine/available-actions.js`, `src/handlers/dc-play-area.js` — target-eligibility filter at attack-declare time.
- ✅ correct (target-validity check at step 1+2 declare).

---

## Director Krennic

**Advanced Weapons Research** — "At the start of your activation, a friendly figure within 2 spaces may gain 1 Damage Token or 1 Surge Token."
- Impl: `src/game/awr-helpers.js` (`awrRange`, `enumerateAwrTargets` — range 2, or 3 with **Advanced Com Systems** attachment), `src/handlers/soa-handler.js`, `src/handlers/activation.js`, `src/engine/activation-setup.js`, `src/game/soa-orchestrator.js`.
- ⚠️ suspicious — **range-extension by attachment** (Advanced Com Systems → range 3) is implemented in `awrRange`. Verify (a) the attachment-lookup uses both `p1DcAttachments`/`p2DcAttachments` and finds the Com Systems attachment specifically on Krennic's own DC (not anywhere in the army), (b) the prompt's "Damage Token or Surge Token" is a player-choice picker (not auto-grant). Also verify "may" → Skip button.

**Unhinged Director** — "When a friendly TROOPER or GUARDIAN within 2 spaces spends a Damage Token or Surge Token while declaring an attack, it may suffer 1 Strain to apply +2 of the chosen symbol to the results instead of +1."
- Impl: `src/handlers/combat.js:2085-2093` (Krennic-source enumeration with range 2 / 3 (ACS) check), `src/engine/activation-setup.js`, `src/handlers/index.js` (button registration).
- ⚠️ suspicious — verify (a) the trigger fires **when the token is spent during attack declaration**, not at attack resolution. (b) "+2 instead of +1" overrides the standard +1; confirm the math is *replace*, not *add* on top. (c) Strain cost is paid through `applyStrain` (so Headhunter etc. fire). (d) "may" → optional Use button.

---

## Doctor Aphra

**Dubious Counterparts** — "If your army's affiliation is Scum, you may include '0-0-0' and 'BT-1' in your army together. After a friendly DROID resolves 'Invasive Procedure' or 'Missile Salvo', that figure may perform 1 additional action."
- Impl: 
  - Army-build: `src/game/validation.js:642-648` — Scum-affiliation DROIDs excused from same-affiliation gate when Aphra is in the army.
  - Post-Missile-Salvo additional-action: `src/handlers/combat-special-effects.js:778-784` + `src/game/dubious-counterparts-helpers.js`.
- ⚠️ suspicious — card mentions BOTH 'Invasive Procedure' (0-0-0) AND 'Missile Salvo' (BT-1). Verify both Special Actions trigger the additional-action prompt, not just Missile Salvo. (Comment at `combat-special-effects.js:783` mentions only Missile Salvo; confirm Invasive Procedure resolution path also enters the same trigger.)

**Excavation** — "At the start of each round, you may choose 1 Command card in any discard pile that costs 1 or less, except 'Take Initiative'. Once during this round, your player may play that card from the discard pile and then return it to the game box."
- Impl: `src/handlers/round.js` (SoR picker), `src/handlers/interrupts.js` (resolve), `src/game/cc-timing.js` (eligibility), `src/handlers/cc-hand.js` (play-from-discard wiring), `src/game/activation-state.js` (`aphraExcavationOptions` cleanup key — memory'd 2026-05-09).
- ✅ correct — fires at SoR with a picker showing CCs in either discard with cost ≤1 (excluding Take Initiative); chosen CC playable once this round and returned to game box (not back to discard).

---

## Dr. Royce Hemlock

**Special Action (Neurotoxin)** — "Choose a space within 3 spaces and roll 1 yellow die. All hostile figures on or adjacent to that space become Weakened and suffer Damage equal to the Damage results."
- Impl: `data/ability-library.json:neurotoxin_hemlock` — `rollOneDie: yellow`, `rollOneDieTarget: spaceWithin`, `rollOneDieRange: 3`, note explicitly mentions Weakened + Damage results to all hostiles on/adj.
- ⚠️ suspicious — confirm `rollOneDieRange: 3` correctly enforces 3-space range (not LoS-gated). Also confirm that ALL hostile figures on or adjacent receive both effects (Weaken AND Damage), and that Damage applies the Damage results from the single yellow roll — not just 1 dmg flat. The note says "Damage results" so the generic handler likely passes the roll result through.

**Special Action (Neurostim)** — "Choose an adjacent friendly figure and roll 1 yellow die. If you rolled Damage, that figure gains a Block Token. Then, if you rolled a Surge, that figure gains a Surge Token."
- Impl: `src/game/abilities.js:1710-1750` — `neurostim_hemlock` keyed; rolls 1 yellow attack die, conditional on Damage symbol grants Block Token; conditional on Surge grants Surge Token.
- ✅ correct — Special Action; adjacent-friendly target; conditional grant logic matches card text (Block on Damage, Surge on Surge — note that both can fire from one roll if the die has both).

---

## Drokkatta

**Demolish** — "Once during your activation, you may choose a space within 3 spaces and line of sight. Each figure on or adjacent to that space suffers 1 Damage. Then, place a rubble token in that space and you suffer 1 Strain."
- Impl: `src/game/abilities.js:3290-3380` — `dcSpecial: fixedAreaEffect` family (shared with Wrist Flamethrower). Range 3, fixed 1 dmg per figure on/adj, self-strain via `applyStrain` pipeline (line 3371). Rubble token placement via `src/game/object-damage-pipeline.js`.
- ⚠️ suspicious — **verify LoS gating**: card says "within 3 spaces **and line of sight**." Library descriptor for fixedAreaEffect doesn't appear to have a `requiresLos` field in the comment trace; confirm the abilities.js handler honors LoS for Demolish's space pick. Also verify rubble token is **placed in the chosen space**, not in adjacent spaces.

**Surge (Shrapnel)** — "Choose one: This attack gains Blast 2, or after this attack resolves, if it did not miss, each figure and object within 2 spaces of the target space suffers 1 Damage."
- Impl: `src/game/combat.js:256-263` — surge sets `surgeShrapnel = true` (no auto-blast). Pick handler `handleCombatPassive` writes the chosen effect (`combat_passive_shrapnel_blast` or `_splash`). Splash routed via `src/handlers/after-attack-fire.js:1659` → `fireShrapnelSplash`.
- ✅ correct — alexanbv-locked 2026-05-10 design: surge spend opens a player picker (Blast 2 vs splash); no auto-apply. Splash fires at step-8 post-resolve, gated on "did not miss," within-2 of target space.

---

## E-Web Engineer (Elite & Regular)

**Forward Emplacement** (Elite only) — "After deployment, you gain movement points equal to your speed."
- Impl: `src/handlers/post-deploy.js`.
- ✅ correct — fires at post-deploy; grants MP = speed.

**Tripod** — "During your activation, you cannot voluntarily exit your space if you attack, and you cannot attack if you exit your space."
- Impl:
  - Cannot-attack-after-move: `src/game/tripod-eweb-helpers.js:14-29` (`hasTripodEwebAbility` + `tripodBlocksAttack({moved})`) + `src/handlers/combat.js` enforcement.
  - Cannot-move-after-attack: `src/handlers/movement.js:885-892` — `game.tripodAttacked[figureKey]` flag set on attack; movement handler rejects exit-from-space when set.
- ✅ correct — **both directions** of the mutual-exclusion are wired (move-then-attack via `tripodBlocksAttack(moved)`; attack-then-move via `tripodAttacked` flag in movement.js). The helper file's docstring is slightly out of date (mentions only one direction), but the implementation covers both.

**Assault** — "You can perform multiple attacks each activation."
- Impl: `src/handlers/dc-play-area.js` (action-availability gate). Same wiring as Baze Malbus / E-Web.
- ✅ correct (passive on action enumeration).

---

## Echo Base Trooper (Elite & Regular)

**Front Line** — "While attacking, if the target is within 3 spaces of you, you may replace 1 blue die in your attack pool with 1 red die." (Elite adds "+2 Accuracy.")
- Impl: `src/game/front-line-helpers.js` + `src/handlers/combat.js`.
- ⚠️ suspicious — "When attacking, if the target is within 3 spaces" → **declare-time** decision (similar to EE-3 Carbine, Vanguard). Verify Front Line picker is posted in `_postOnDeclareDieSwapPrompts` window (with EE-3/Vanguard/Shock and Awe), not at step-4 attacker mods. Also verify Elite-only +2 Accuracy bonus is layered correctly (not double-applied for Regular).

**Cortosis Weave** (Elite only) — "While you are defending, you may reduce the Pierce value of the attack results by 2, to a minimum of 0."
- Impl: `src/game/cortosis-weave-helpers.js` + `src/handlers/combat.js`. "May" → player-choice action in defender step-4 mods (or step-7 surge-resolution when Pierce is being computed).
- ⚠️ suspicious — "**reduce Pierce by 2, min 0**" — verify the min-0 floor is applied AFTER all Pierce sources sum (so 1 Pierce → 0, 5 Pierce → 3). Also verify "may" → optional Use button. Timing: should fire at step 7 (damage-vs-block math), not pre-roll.

**Efficient Travel** (Regular passive) — canonical IACP keyword.
- ✅ correct.

---

## Batch 05 — Summary

- ✅ correct: 11
- ⚠️ suspicious: 11 (Defensive Stance Dodge-conversion preservation; Force Throw SMALL filter + Strain cost; AWR attachment lookup + token-or picker; Unhinged Director +2-replace-+1 math + Strain pipeline; Dubious Counterparts Invasive Procedure path coverage; Neurotoxin range-3 + Damage-results passthrough; Demolish LoS gate; Front Line declare-time placement + Elite +2 Acc layering; Cortosis Weave min-0 floor + step-7 timing)
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced this batch:**
1. **Diala Passil Defensive Stance Dodge-conversion** — most complex reroll-with-conversion in the game. Confirm post-reroll Dodge → 2 Block + 1 Evade conversion survives the unified reroll-bucket refactor. Worth a behavioral test.
2. **Director Krennic Unhinged Director math** — "+2 of the chosen symbol instead of +1" is a *replacement* of the standard +1 bonus per token, not an addition. Single-character off-by-one risk.
3. **Doctor Aphra Dubious Counterparts coverage** — verify the post-Special-Action hook fires for **both** Invasive Procedure AND Missile Salvo (combat-special-effects.js comment only mentions Missile Salvo).
4. **Echo Base Trooper Front Line** — declare-time die-swap (same family as EE-3 Carbine / Vanguard / Shock and Awe). Confirm it's in `_postOnDeclareDieSwapPrompts` and not misplaced at step-4 attacker mods.

**Next:** Batch 06 (DCs E continued — Elite Imperial Officer? eFFEcTS? — next 10 alphabetical after Echo Base Trooper Regular).
