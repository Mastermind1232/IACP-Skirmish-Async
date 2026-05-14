# DC/CC Timing Audit — Manual Triage Batch 17

Scope: DCs alphabetical after Tusken Raider (Regular), 10 cards:
Ugnaught Tinkerer (Elite), Ugnaught Tinkerer (Regular), Verena Talos,
Vinto Hreeda, Wampa (Elite), Wampa (Regular), Weequay Pirate (Elite),
Weequay Pirate (Regular), Wing Guard (Elite), Wing Guard (Regular).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Ugnaught Tinkerer (Elite & Regular)

**Special Action (Spot Weld)** — "Place the Junk Droid companion in an adjacent space."
- Impl: `src/game/abilities.js:2087` (`Spot Weld` block).
- ⚠️ suspicious — verify (a) adjacent-empty-space picker (path-1 from Ugnaught), (b) Junk Droid companion placed at chosen space (creates/positions the companion DC), (c) if Junk Droid already exists, old one is removed and a new one is placed (note line 2181: "old Junk Droid removed; new Junk Droid placed... READY for second activation"), (d) per-figure Spot Weld (Ugnaught is single-figure typically).
- alexanbv 2026-05-09 followup note: "Ugnaught double-Junk-Droid combo TODO" — pending.

**Special Action (Overclock)** (Elite only) — "The Junk Droid may interrupt to perform a move or attack."
- Impl: `src/game/abilities.js:2017` (`overclockCompanionInterrupt`) + `overclock` keyed at 1 site.
- ⚠️ suspicious — verify (a) Junk Droid must exist + be deployed, (b) Use/Skip picker for Move OR Attack, (c) Move uses Junk Droid's normal MP grant (speed), (d) Attack uses Junk Droid's attack pool (no free-action gate? — Overclock IS the action cost on Ugnaught), (e) interrupt scope: fires during Ugnaught's activation.

**Scrap Battalion (passive)** — "The Junk Droid readies at the start of your activation. It activates as though it was part of your group and may use your surge abilities."
- Impl: `scrap_battalion_ugnaught_*` keyed at 1-2 sites.
- ⚠️ suspicious — verify (a) SoA hook: readies Junk Droid (clears exhaustedSkirmishUpgrades / dcExhaustedState for the Junk Droid msgId), (b) Junk Droid "as part of your group" — shares activation thread + budget? Or independent activation slot inheriting from Ugnaught?, (c) Junk Droid attacks may use Ugnaught's surge abilities (combat.attackerSurgeAbilities lookup includes companion's surges).

---

## Verena Talos

**Special Action (Close Quarters)** — "Move up to 1 space, then perform an attack using an adjacent hostile figure's attack type and attack pool. Remove 1 die from the target's defense pool and apply +1 Accuracy to the attack results."
- Impl: `close_quarters` — no src hit by id; but related `closeQuartersActive` figureKey-keyed flag exists (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) 1-space Move-X picker (bypassCosts per alexanbv 2026-05-13), (b) after move, attack picker shows adjacent hostiles, (c) attack USES TARGET'S type + pool (e.g., target is a Stormtrooper Elite → attack is Ranged blue/green dice), (d) remove 1 die from target's DEFENSE pool, (e) +1 Accuracy applied.

**Improvised Cover** — "While defending, if you are adjacent to an object or non-friendly figure other than the attacker, apply +1 Block to the defense results."
- Impl: `improvised_cover_verena` keyed at 1 site.
- ⚠️ suspicious — verify (a) defender-side mod, (b) "adjacent to object or non-friendly figure OTHER THAN attacker" — the attacker doesn't count for cover (anti-rules-lawyering check), (c) +1 Block always (or "may apply" — card text doesn't say "may"), (d) once per attack.

**Surge (Fighting Knife)** — "After this attack resolves, choose an adjacent hostile figure and roll 1 red die. That figure suffers Damage equal to the Damage results."
- Impl: `fighting_knife` keyed at 7 sites (shared family — Jyn Erso, Verena, others).
- ⚠️ suspicious — verify (a) surge cost = 1 from attacker's roll, (b) post-attack hook fires after step-8 close, (c) adjacent-hostile picker (path-1 from Verena's CURRENT post-attack position), (d) 1 red die roll + Damage via standard pipeline.

---

## Vinto Hreeda

**Special Action (Rapid Fire)** — "Perform 2 attacks."
- Impl: shared `freeAttackBonus` family; `rapid_fire_vinto` — no src by id but pattern is `freeAttackBonusPending = N` for N=2.
- ⚠️ suspicious — verify (a) grants 1 free attack window after the 1 paid attack (so action cost = 1 but 2 attacks resolve), (b) freeAttackBonusPending = 1 set on Vinto's figureKey (per the 2026-05-13 figkey migration), (c) no target restriction (unlike Multi-Fire/Brutality).

**Boltslinger** — "After you resolve an attack during your activation, you may choose a hostile figure other than the defender in your line of sight and within 3 spaces of you. That figure suffers 1 Damage."
- Impl: `boltslinger` keyed at 7 sites.
- ⚠️ suspicious — verify (a) post-attack-resolve hook fires after step 8, (b) "during your activation" gate (NOT during free attacks given by CCs to Vinto out of activation? or BOTH? CRR check), (c) picker offers hostiles WITHIN path-3, with LoS to Vinto, EXCLUDING the just-attacked defender, (d) 1 Damage via standard pipeline.

---

## Wampa (Elite & Regular)

**Efficient Travel (passive)** — "You ignore additional movement point costs for difficult terrain and hostile figures."
- Impl: keyword-based; movement validator checks Efficient Travel passive.
- ⚠️ suspicious — verify per-figure passive read.

**Hunger** — "At the start of your activation, if there are no hostile figures within 2/3 spaces, gain 3/2 movement points (Elite also gains 1 Block OR Evade Token)."
- Impl: `hunger_wampa` — no src by id. SoA orchestrator probably enumerates Hunger generically.
- ⚠️ suspicious — verify (a) SoA hook checks no-hostiles-within-N (Elite=2, Reg=3), (b) MP grant to perFig[0] of Wampa's bank, (c) Elite also gets Block/Evade picker.

**Non-Sentient** — "You cannot interact."
- Impl: handled at available-actions.js + dc-play-area.js gate (PROBE-INT-001/004 in tests).
- ✅ correct (audited).

---

## Weequay Pirate (Elite & Regular)

**Special Action (Prowl)** (Elite only) — "You become Hidden."
- Impl: `prowl` — no src by id. Likely uses generic `applyCondition` with chosenCondition=Hide.
- ⚠️ suspicious — verify (a) cost = 1 action, (b) applies Hide to self via `applyCondition` (immunity respected), (c) "you" = the specific activating figure (per-figure).

**Raider** — same as Fyrnock Style (Tress) and Precision (GI) — choose 1 attack die, force opponent to reroll.
- Impl: `raider_weequay_*` keyed at 1 site each.
- ⚠️ suspicious — verify (a) attacker-side only (card says "while attacking"), (b) named reroll bucket fires on either pool, (c) forced reroll for opponent (no Skip), (d) once per attack.

---

## Wing Guard (Elite & Regular)

**Keep the Peace** (Elite) — "When a hostile figure declares an attack targeting a space adjacent to you, the attacker suffers 1 Strain. Limit 1 'Keep the Peace' ability per group activation."
- Impl: `keep_the_peace_elite` keyed at 1 site.
- ⚠️ suspicious — verify (a) on-declare trigger fires when target space is adjacent to Wing Guard Elite, (b) auto-applies 1 Strain to attacker via `applyStrain` (so Fireproof/Headhunter/Submit-or-Fight fire), (c) "Limit 1 per GROUP activation" — alexanbv 2026-05-13 confirmed-keeper: Keep the Peace is GROUP-scoped (per-msgId), NOT per-figure. This is one of the exceptions to the per-figure default.

**Keep the Peace** (Regular) — "When a hostile figure declares an attack targeting a space adjacent to you, if that space does not contain a friendly GUARDIAN, you may suffer 1 Strain. If you do, the attacker suffers 1 Strain. Limit 1 'Keep the Peace' ability used per attack."
- Impl: `keep_the_peace_regular` keyed at 1 site.
- ⚠️ suspicious — verify Reg's distinct rules: (a) "no friendly GUARDIAN in target space" gate (so a GUARDIAN already there blocks the trigger), (b) Use/Skip prompt to Wing Guard Reg's owner, (c) Use: WGR suffers 1 Strain via applyStrain, attacker suffers 1 Strain via applyStrain, (d) "Limit 1 per ATTACK" (different scope from Elite's "per group activation"!).

**Bespin Security** (Elite only) — "You may include 'Lando Calrissian' in your army. While an adjacent friendly LEADER or SCUM TROOPER is performing an attack, it may reroll 1 attack die. Limit 1 'Bespin Security' ability per attack."
- Impl: `bespin_security` keyed at 1 site.
- ⚠️ suspicious — verify (a) army-build inclusion rule (validation), (b) attacker-side reroll bucket gated on adjacent Wing Guard Elite + attacker keyword LEADER or SCUM+TROOPER (both keywords on attacker), (c) once per attack — shared across all Wing Guard Elites adjacent.

---

## Batch 17 — Summary

- ✅ correct: 1 (Wampa Non-Sentient — already audited)
- ⚠️ suspicious: 22
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Ugnaught Spot Weld double-Junk-Droid combo** — pending TODO from alexanbv 2026-05-09 audit. Need to verify "old Junk Droid removed; new placed" path doesn't leak XP/tokens/etc.

2. **Scrap Battalion companion-as-group activation model** — Junk Droid "activates as though part of your group" is a unique flow. Audit whether it shares the activation thread/budget or has its own.

3. **Verena Close Quarters target's-pool-and-type** — distinct from standard attack: USES the target's attack stats. Verify the attack pool override correctly inherits target's dice + type at attack time.

4. **Vinto Boltslinger "during your activation" gate** — only fires for in-activation attacks (not BL/Leia/Executor/etc. out-of-activation grants).

5. **Wing Guard Keep the Peace scope (group-activation Elite vs. per-attack Regular)** — Elite is per-msgId (group-scoped, one of the few alexanbv 2026-05-13 confirmed group-keepers). Regular is per-attack. Verify they read the right scope flag.

6. **Wing Guard Reg "no friendly GUARDIAN in target space" gate** — pre-check before Use/Skip prompt. Verify the space-occupants scan for friendly GUARDIAN.

**Next:** Batch 18 (DCs alphabetical after Wing Guard (Regular)).
