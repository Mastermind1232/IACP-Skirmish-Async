# DC/CC Timing Audit — Manual Triage Batch 16

Scope: DCs alphabetical after Tauntaun Rider, 10 cards: The Armorer,
The Child, The Grand Inquisitor, The Mandalorian, Thrawn, Trandoshan
Hunter (Elite), Trandoshan Hunter (Regular), Tress Hacnua, Tusken
Raider (Elite), Tusken Raider (Regular).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## The Armorer

**Beskar Armor (passive)** — "After deployment, you gain 2 Block Tokens."
- Impl: `beskar_armor` keyed at 1 site + library descriptor.
- ⚠️ suspicious — verify (a) post-deploy hook grants 2 Block Tokens via `grantPowerTokens`, (b) max-cap clamps (Block max for Armorer / Mando), (c) fires per-figure (Armorer is single-figure, but the rule generalizes).

**This is the Way** — "When another friendly figure resolves an attack, if the defender was defeated, that figure gains 1 Block Token."
- Impl: `this_is_the_way_armorer` keyed at 2 sites; deps wired into headless via `checkThisIsTheWay` (per the audit snapshot in memory).
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook fires only when defender was defeated by a friendly figure's attack (not own attack on self, not non-attack defeats like Bleed strain), (b) "that figure" = the ATTACKER, not Armorer, (c) 1 Block Token granted with cap, (d) "another friendly" — Armorer's own attacks don't trigger.

**Survival is Strength** — "While a friendly figure within 3 spaces is defending, if it spent a Block symbol during this attack, it may reroll 1 attack die."
- Impl: `survival_is_strength_armorer` keyed at 1 site.
- ⚠️ suspicious — verify (a) trigger is on defender resolving an attack (friendly within path-3 of Armorer), (b) condition: defender used Block ≥ 1 from their roll/tokens during this attack, (c) "attack die reroll" — wait, this says "reroll 1 attack die"? Card text odd — should probably be "reroll 1 defense die" or it's a future attack reroll. Worth a destruct check.

---

## The Child

**Special Action (Force Heal)** — "An adjacent friendly figure recovers 1 Damage and discards a HARMFUL condition."
- Impl: `force_heal` — no src hit by id; library descriptor present.
- ⚠️ suspicious — verify (a) adjacent friendly picker (path-1 + same player), (b) both effects apply: recover 1 Damage via heal pipeline AND discard 1 harmful condition via filterCondition, (c) cost = 1 action.

**Force Exhaustion** — "When an attack is declared targeting you or a friendly figure with 'Clan of Two', you may become Incapacitated. If you do, the attacker removes 1 attack die from the attack pool and becomes Weakened."
- Impl: `force_exhaustion` keyed at 4 sites.
- ⚠️ suspicious — verify (a) on-declare trigger fires for attacks targeting The Child OR friendlies with Clan of Two attachment, (b) Use/Skip prompt to The Child's controller, (c) Use: The Child becomes Incapacitated (condition apply); attacker removes 1 attack die from pool AND becomes Weakened, (d) per-attack scope.

---

## The Grand Inquisitor

**Precision (passive)** — "While attacking or defending against an adjacent figure, you may choose 1 die. The player that rolled that die must reroll it."
- Impl: `precision_grand_inquisitor` keyed at 1 site.
- ⚠️ suspicious — verify (a) trigger fires only when defender/attacker is adjacent (path-1), (b) named reroll bucket lets GI's controller pick ONE die from EITHER player's roll, (c) the other player MUST reroll (forced, no opt-out), (d) once per attack (not per round).

**Special Action (Lightsaber Throw)** — "Perform a Ranged attack targeting a non-adjacent figure using your attack pool. Apply +2 Accuracy to the attack results."
- Impl: `lightsaber_throw_gi` — no src hit by id; library descriptor present (line 2960).
- ⚠️ suspicious — verify (a) attack type forced to Ranged for this special, (b) target must be NON-adjacent (range ≥ 2) — the existing `mustTargetNonAdjacent` flag, (c) +2 Accuracy applied to the attack results, (d) uses GI's own attack pool (no override on dice).

**Surge (Deadly Spin)** — "Apply -1 Dodge to the defense results. This attack gains Cleave 3."
- Impl: `deadly_spin` keyed at 2 sites + surgeAbilities entry.
- ⚠️ suspicious — verify (a) surge cost = 1 from attacker's roll, (b) -1 Dodge applied to defender's results (modifies defense roll), (c) +3 Cleave added to the attack's cleave bucket, (d) per-attack scope.

---

## The Mandalorian

**Beskar Armor** — same as Armorer, shared family.
- ⚠️ suspicious — same verification list.

**Special Action (Disruptor Rifle)** — shared with Snowtrooper Elite. Same mechanic.
- ⚠️ suspicious — same as Snowtrooper Elite Disruptor Rifle audit (batch 15): figureKey-keyed disruptorRiflePending; verify HP-1 condition after non-miss attack.

**Special Action (Din's Wrist Flamethrower)** — "Move up to 2 spaces, then choose a space within 2 spaces. Each other figure on or adjacent to that space suffers 1 Damage and 1 Strain."
- Impl: `dins_wrist_flamethrower` — no src hit by id; library descriptor present.
- ⚠️ suspicious — verify (a) 2-space Move-X picker with bypassCosts (Move-X per alexanbv 2026-05-13), (b) after move, range-2 space picker, (c) each figure on/adjacent to picked space (excluding Mando) suffers 1 Damage AND 1 Strain, (d) Damage via damage-pipeline, Strain via `applyStrain` so Headhunter/Fireproof/Submit-or-Fight fire, (e) AOE: object damage included if objects in range.

---

## Thrawn

**Long-Laid Plans** — "At the start of your activation, distribute among friendly figures different Power tokens equal to the current round number."
- Impl: `long_laid_plans_thrawn` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoA hook on Thrawn's activation, (b) picker lets Thrawn distribute N power tokens (N = current round number) among friendly figures, (c) "DIFFERENT" Power tokens — each token must be a different TYPE (Block, Evade, Damage, Surge), so caps at 4 distinct types per round, (d) per-figure max-cap clamping.

**Strategize** — "At the start of your activation, look at the top Command card of each player's deck. You may discard one of those cards."
- Impl: `strategize_thrawn` keyed at 1 site (commit c3648151 routes the picker to private hand channel per alexanbv 2026-05-13 privacy fix).
- ✅ correct (privacy issue resolved; discarded card stays named since discard pile is public; non-discarded stays secret).

---

## Trandoshan Hunter (Elite & Regular)

**Relentless** — "When you declare an attack on/targeting a figure within 3 spaces, that figure suffers 1 Strain."
- Impl: `relentless_trandoshan_*` keyed at 2 sites each.
- ⚠️ suspicious — verify (a) on-declare trigger fires only when target is within path-3, (b) defender suffers 1 Strain via `applyStrain` (so Fireproof/Headhunter fire), (c) Strain applied BEFORE attack resolves (per CRR "when you declare" timing), (d) per-attack scope.

**ACP Scattergun / Scattergun** — "While attacking, if you are adjacent to the target, apply +2/+1 Damage to the attack results."
- Impl: `acp_scattergun` + `scattergun` keyed at 1-2 sites each.
- ⚠️ suspicious — verify (a) step-4 attacker mod gated on path-1 adjacency to target, (b) +2 Damage (Elite) or +1 Damage (Regular) added to attack results, (c) Elite vs Regular handled by separate flag values.

**Hardy** (Elite only) — "At the end of each round, discard all HARMFUL conditions."
- Impl: `hardy` keyed at 1 site.
- ⚠️ suspicious — verify (a) EoR hook iterates Trandoshan Elite figures and discards all harmful conditions via `filterCondition`, (b) per-figure (each Trandoshan Elite figure clears its own), (c) HARMFUL filter excludes Focus/Hide/Stealth.

---

## Tress Hacnua

**Krayt Dragon Fury (passive)** — "While attacking, X equals the number of Surge rolled."
- Impl: `krayt_dragon_fury_tress` keyed at 1 site.
- ⚠️ suspicious — verify (a) attacker-pool computation: X-cleave + X-recover surge abilities use Tress's surge count rolled, (b) interaction with Overload-style cards (which let same ability fire 2x) — does each "X" instance use the SAME surge count or different?

**Fyrnock Style** — "While attacking or defending, choose 1 attack die. The player that rolled that die must reroll that die."
- Impl: `fyrnock_style_tress` keyed at 1 site.
- ⚠️ suspicious — verify (a) similar to Precision (GI) — named reroll bucket, but Fyrnock Style applies to ANY adjacency (not just adjacent), (b) Tress picks any single attack-pool die from either side, (c) forced reroll for the rolling player, (d) once per attack.

**Leg Hydraulics (passive)** — "After you resolve an attack, move up to 1 space."
- Impl: `leg_hydraulics_tress` keyed at 1 site.
- ⚠️ suspicious — verify (a) post-attack-resolve hook (after step 8) for Tress as attacker, (b) 1-space Move-X picker with bypassCosts (per alexanbv 2026-05-13 Move-X rule), (c) auto-skipped if no valid adjacent empty space, (d) per-attack (not per-activation — fires after each Tress attack).

---

## Tusken Raider (Elite & Regular)

**Special Action (Tusken Cycler)** — "Perform a Ranged attack using 1 blue and 1 red die. Apply +2 Accuracy (Elite) / You cannot use abilities during this attack (Regular)."
- Impl: `tusken_cycler_elite` + `tusken_cycler_regular` — no src hit by id; library descriptors present.
- ⚠️ suspicious — verify (a) pendingOverrideAttackDice (per-figureKey post-2026-05-13) set with `{dice: ['blue', 'red'], type: 'ranged'}`, (b) +2 Accuracy bonus (Elite), (c) Regular's "cannot use abilities" — sets `blockSurgeAbilities: true` (per the pendingOverrideAttackDice block-surge flag) which suppresses surge abilities during this attack — but rule says "abilities" which is broader than just surge. Worth a destruct check on what counts.

**+1 Damage (Elite passive)** — "+1 Damage on every attack."
- ⚠️ suspicious — step-4 always-on attacker mod; verify per-figure read of passives.

---

## Batch 16 — Summary

- ✅ correct: 1 (Thrawn Strategize — privacy fix landed today)
- ⚠️ suspicious: 24
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Armorer Survival is Strength wording** — card text says "reroll 1 ATTACK die" when triggered by defender spending Block. That's unusual — usually defender-trigger gives a defender-reroll. Worth a destruct ruling on whether the reroll is on the CURRENT attack's defense (mid-attack) or a FUTURE attack.

2. **Mando Din's Wrist Flamethrower 2-step Move + AOE** — Move-X picker then space picker for AOE, then Damage + Strain to all figures on/adjacent. Multi-step interrupt; worth full click-through.

3. **Force Exhaustion (The Child) cross-figure trigger** — fires on attacks targeting Clan of Two upgrade holders, not just The Child. Verify the friendly-figure scan includes attachment-holders.

4. **Thrawn Long-Laid Plans "different" tokens** — N tokens of N DIFFERENT types. Caps at 4 distinct types (Block/Evade/Damage/Surge), so rounds 5+ are still 4 distinct types.

5. **GI Precision adjacency gate** — only fires when defender/attacker is adjacent to GI. Cross-board attacks don't trigger.

6. **Tusken Cycler Regular "cannot use abilities"** — broader than surge-block. Verify what abilities are suppressed — Aim? Combat passives? Surge abilities? Reroll buckets?

**Next:** Batch 17 (DCs alphabetical after Tusken Raider (Regular)).
