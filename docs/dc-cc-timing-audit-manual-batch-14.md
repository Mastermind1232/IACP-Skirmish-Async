# DC/CC Timing Audit — Manual Triage Batch 14

Scope: DCs alphabetical after Royal Guard (Elite), 10 cards: Royal
Guard (Regular), Royal Guard Champion, SC2-M Repulsor Tank, Sabine
Wren, Salacious B. Crumb, Saska Teft, Saw Gerrera, Scout Trooper
(Elite), Second Sister, Sentry Droid (Elite).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Royal Guard (Regular)

**Sentinel** — shared `sentinel` family, 6 sites. Same as Royal Guard Elite.
- ⚠️ suspicious (per batch 13 follow-ups).

**Vengeance** — "When an adjacent, friendly, non-GUARDIAN figure is defeated, you become Focused."
- Impl: `vengeance_royal_guard` keyed at 1 site.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED trigger on adjacent friendly + non-GUARDIAN filter, (b) Focus applied via standard `applyCondition`, (c) does NOT also grant a 1-space move (that's the Elite-only Forward Vengeance).

---

## Royal Guard Champion

**Special Action (Brutality)** — "Perform 2 attacks. Each attack must have a different target."
- Impl: `src/game/abilities.js:2375` — `freeAttackDifferentTargets` per-figureKey tracker (migrated 2026-05-13). Tagged `Brutality / Sarlacc Sweep / Multi-Fire`.
- ✅ correct (recently audited as part of the figkey migration).

**Executor** — "When a friendly figure within 3 spaces is defeated, you may interrupt to move up to 2 spaces and then perform an attack. Limit once per round."
- Impl: `executor` keyed at 7 sites.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook on friendly within path-3, (b) "may" → Use/Skip prompt to RGC's owner, (c) 2-space Move-X picker with bypassCosts per alexanbv 2026-05-13 rule for "move N spaces" (not Move action), (d) then free attack, (e) once-per-round via `executorTriggered` flag in ROUND_OBJECT_FLAGS.

**Overpower** — "While attacking, you may reroll 1 red die. While defending, you may reroll 1 black die."
- Impl: `overpower` keyed at 2 sites.
- ⚠️ suspicious — verify (a) attacker reroll bucket allows specifically a red die only, (b) defender reroll bucket allows specifically a black die only, (c) named reroll buckets fire one per attack each (separate gates), (d) attacker side fires for RGC as attacker, defender side fires for RGC as defender.

---

## SC2-M Repulsor Tank

**Double Action Special (Focus Fire)** — "Perform 2 attacks targeting the same figure."
- Impl: `src/game/abilities.js:1967` — focusFireActive per-figureKey + forcedAttackTarget per-figureKey (migrated 2026-05-13).
- ✅ correct (recently audited).

**Defensible** — "While defending, you may apply either +1 Block or +1 Evade to your defense results."
- Impl: `defensible_sc2m` keyed at 1 site.
- ⚠️ suspicious — verify (a) defender bucket prompt during attack-resolve, (b) Use/Skip + Block/Evade choice (3-button), (c) once per attack (not per round).

---

## Sabine Wren

**Special Action (Evasive Maneuver)** — "Move up to 2 spaces, then recover 2 Damage."
- Impl: `src/game/abilities.js:5597` (`mpBonus + recover`) — Move-X picker per CRR MOVE-017 (ignores bonus costs per alexanbv 2026-05-13).
- ⚠️ suspicious — verify (a) Move-X picker with bypassCosts: true, (b) 2-MP grant for the picker, (c) "then recover 2 Damage" — Sabine recovers 2 via standard heal pipeline AFTER move completes (or atomically with the action click?).

**Parting Gift** — "Once during your activation, you may choose a space within 3 spaces and roll 1 green die. Each other figure and object on or adjacent to that space suffers Damage equal to the Damage results."
- Impl: `src/game/abilities.js:2643` (`rollOneDie` generic with target='spaceWithinN') + line 3092 Parting Gift style.
- ⚠️ suspicious — verify (a) "once during your activation" gate (per-figure once-per-activation via roundFigureAbilityUsed or similar), (b) range-3 space picker, (c) 1 green die roll, (d) Damage applied to all figures AND objects (alexanbv 2026-05-11 ruling confirmed object-damage pipeline), (e) Sabine excluded from the splash (card says "each OTHER figure").

**Mobile (passive)** — "While moving, ignore other figures (treat their spaces as if empty)."
- Impl: probably wired into the movement validator (mobileMovementActive).
- ⚠️ suspicious — verify the per-figure flag (mobileMovementActive figureKey-keyed post-2026-05-13) is correctly read by the movement validator.

---

## Salacious B. Crumb

**Swipe** — "When you activate in or enter a space containing a hostile figure, it suffers 1 Damage. Limit once per figure per round."
- Impl: NO `swipe_crumb` id in src/. Check by ability text.
- — no impl OR ⚠️ suspicious — Salacious B. Crumb is a SMALL companion (can share spaces). Need to verify (a) activate-in-shared-space trigger fires Swipe, (b) enter-shared-space trigger fires Swipe, (c) once-per-figure-per-round gate keyed by hostile figureKey + round.

**Special Action (Scratch)** — "Choose an adjacent hostile figure. That figure suffers 1 Damage."
- Impl: NO `scratch_crumb` id wired in src/.
- — no impl — needs Special Action handler for "pick adjacent hostile, apply 1 Damage".

---

## Saska Teft

**Shady Contacts** — "You may include up to 1 non-upgrade SCUM Deployment card in your army."
- Impl: `shady_contacts_saska` — no src hits.
- — no impl — army-build-time rule; affects validation only. Probably not in the runtime engine.

**Unstable Devices** — "Once during your activation, a friendly figure in your line of sight may gain 1 Device token."
- Impl: `unstable_devices_saska` keyed at 1 site (probably abilities.js).
- ⚠️ suspicious — verify (a) once-per-activation gate keyed per-figureKey (Saska is single-figure), (b) picker presents friendly figures in Saska's LoS, (c) chosen figure gains 1 Device token, (d) action cost (it's a "during your activation" effect — probably no action cost or 1 action).

**Power Converter** — "Once per round, while a friendly figure with a Device token is attacking, it may reroll 1 attack die. Before rerolling, you may replace that die with another attack die of any color. It is considered rerolled."
- Impl: `power_converter_saska` keyed at 1 site.
- ⚠️ suspicious — verify (a) named reroll bucket on any friendly with a Device token, (b) "replace + reroll" mechanic (the player picks which die to replace and what color to swap in), (c) once-per-round gate (NOT once-per-attack).

---

## Saw Gerrera

**Brutal Tactics (passive)** — "Once per round, when a hostile figure is defeated, choose a hostile figure within 3 spaces of the defeated figure's space. The chose figure becomes weakend."
- Impl: NO `brutal_tactics_saw` id; passives include "Brutal Tactics". May be wired through the WHEN_DEFEATED pipeline + auto-apply hooks.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook on ANY hostile defeat (not just Saw's attacks), (b) picker offers hostiles within path-3 of defeated's last position, (c) Weaken applied via standard condition pipeline, (d) once-per-round gate keyed by Saw's figureKey or playerNum.

**Wanton Destruction** — "After a friendly resolves an attack, you may discard 1 Command card from your hand to choose up to 2 figures other than the defender within 2 spaces of the target space. Those figures suffer 1 Damage."
- Impl: `wanton_destruction_saw` keyed at 3 sites.
- ⚠️ suspicious — verify (a) post-attack hook fires after any friendly's attack resolves, (b) Use/Skip prompt to Saw's owner, (c) discards 1 CC from hand (Saw's hand) — goes to discard, public-OK, (d) picker offers up to 2 figures (not defender) within path-2 of target space, (e) 1 Damage per chosen figure via standard pipeline.

---

## Scout Trooper (Elite)

**Camouflage** — "Hostile figures 4 or more spaces away from you cannot draw line of sight to you. You do not block line of sight for those figures."
- Impl: `camouflage_scout_trooper` keyed at 4 sites.
- ⚠️ suspicious — verify (a) attacker→ScoutT LoS check: if attacker path-distance ≥ 4, LoS is blocked, (b) ScoutT's own footprint doesn't block LoS for distant figures' attacks across the board, (c) both rules respect MASSIVE/other-LoS-overrides.

**Find Weakness** — "While attacking, apply +3 Accuracy and -1 Evade to the results."
- Impl: `find_weakness` keyed at 1 site.
- ⚠️ suspicious — verify (a) step-4 attacker mod always-on, (b) +3 Accuracy adds to attack results, (c) -1 Evade removes from defense results (modifies the DEFENDER'S evade output).

**Exploit Weakness** — "While attacking a figure with a HARMFUL condition, apply +1 Surge to the attack results."
- Impl: `exploit_weakness` keyed at 1 site.
- ⚠️ suspicious — verify (a) trigger fires when target has ANY harmful condition (Stun, Bleed, Weaken, Strain via marker?), (b) +1 Surge to attack roll, (c) HARMFUL filter correctly excludes Focus, Hide, etc.

**Professional** — same as Royal Guard / Riot Trooper Elite. Shared.

---

## Second Sister

**Special Action (Force Leap)** — "Place your figure in an empty space within 6 spaces."
- Impl: NO `force_leap_second_sister` direct hit; may use generic `placeInEmptySpace` ability.
- ⚠️ suspicious — verify (a) range-6 empty-space picker (path-counted? or unobstructed-line?), (b) "place" not "move" — bypasses movement rules entirely (no terrain costs, no LoS check), (c) cost = 1 action (or special?).

**Special Action (Saber Orbit)** — "Choose up to 3 adjacent hostile figures. For each of those figures, perform a Melee attack using 1 red die targeting that figure."
- Impl: `saber_orbit` — abilities.js:2259 (saberOrbitChain), saberOrbitAttacksRemaining figureKey-keyed.
- ✅ correct (audited as part of figkey migration; uses pendingOverrideAttackDice figureKey-keyed).

**Surge (Mastery)** — "Choose and re-draw a FORCE USER Command card of cost 1 or less in your discard pile. Limit once per round."
- Impl: surgeAbilities include "mastery" — wired via the mastery surge handler.
- ⚠️ suspicious — verify (a) surge cost = 1 surge from attack pool, (b) picker presents discard-pile FORCE-USER CCs of cost ≤ 1, (c) chosen card moves to hand (the redraw — card name OK to log since it was in PUBLIC discard pile before), (d) once-per-round gate.

---

## Sentry Droid (Elite)

**Special Action (Multi-Fire)** — "Perform 2 attacks. Each attack must have a different target. Apply -1 Damage to each attack's result."
- Impl: `multi_fire` shared family, abilities.js:1992 — figureKey-keyed (multifig 2026-05-13 fix in batch 6).
- ✅ correct.

**Special Action (Charged Shot)** — "Perform an attack. Apply +2 Accuracy to the attack results."
- Impl: abilities.js:2461 — `nextAttackBonusAccuracy` figureKey-keyed.
- ✅ correct.

**Targeting Computer (passive)** — shared `targeting_computer` reroll. Same as Probe Droid Elite.
- ✅ correct (already audited).

---

## Batch 14 — Summary

- ✅ correct: 6 (Brutality, Focus Fire, Saber Orbit, Multi-Fire, Charged Shot, Targeting Computer — all recently audited as part of the figkey migration)
- ⚠️ suspicious: 20
- ❌ wrong-stage: 0
- — no impl: 3 (Salacious B. Crumb Swipe + Scratch, Saska Shady Contacts)

**Highest-priority items surfaced:**

1. **Salacious B. Crumb Swipe + Scratch** — NO IMPL. Crumb has no `swipe_crumb` or `scratch_crumb` ids wired. Need:
   - Swipe: "activate in / enter shared space" trigger → 1 Damage to hostile, once-per-figure-per-round
   - Scratch: special action picker → 1 Damage to adjacent hostile

2. **Saska Teft Power Converter "replace + reroll"** — the rule lets the player replace a die with a different-color die BEFORE the reroll. That's a 2-step interaction (replace → reroll). Worth a click-through.

3. **Saw Gerrera Brutal Tactics on ANY hostile defeat** — not Saw-attack-only. WHEN_DEFEATED hook needs to fire on EVERY hostile defeat (any source) and offer Weaken picker.

4. **Scout Trooper Camouflage 4-space LoS gate** — bidirectional rule: attackers ≥4 can't see Scout, AND Scout doesn't block their LoS to others. Verify both directions.

5. **Second Sister Force Leap** — "Place in empty space within 6" — distinct from "Move 6 spaces". Needs range-6 path-counted picker that bypasses ALL movement rules (terrain, LoS, push, etc.).

**Next:** Batch 15 (DCs alphabetical after Sentry Droid (Elite)).
