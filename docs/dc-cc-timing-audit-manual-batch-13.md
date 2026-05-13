# DC/CC Timing Audit — Manual Triage Batch 13

Scope: DCs alphabetical after Purge Trooper (Elite), 10 cards:
R2-D2, Rancor, Rebel Pathfinder (Elite), Rebel Saboteur (Elite),
Rebel Saboteur (Regular), Rebel Trooper (Elite), Rebel Trooper
(Regular), Riot Trooper (Elite), Riot Trooper (Regular), Royal Guard
(Elite).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## R2-D2

**Special Action (Scomp Link)** — "If you are adjacent to a terminal, your player draws 1 Command card."
- Impl: `src/game/abilities.js:5953` (`drawCCIfAdjacentTerminal`) + library descriptor.
- ⚠️ suspicious — verify (a) "adjacent to terminal" path-counted from R2-D2's activator-selected figure, (b) draws 1 card to the controlling player, (c) costs 1 action.

**Special Action (Service)** — "You or an adjacent friendly DROID or VEHICLE recovers 1 Damage."
- Impl: `src/game/abilities.js:5690` (`recoverSelfOrAdjacentFriendly`) + library descriptor.
- ⚠️ suspicious — verify (a) picker offers SELF + adjacent friendlies filtered by DROID|VEHICLE keyword, (b) recover applies through standard heal pipeline (so dcHealthState updates), (c) cost = 1 action.

**Lucky** — "While defending, if you roll a blank result, add +1 Dodge to the defense results."
- Impl: `lucky_r2d2` keyed at 1 site in src/.
- ⚠️ suspicious — verify (a) trigger fires when defense roll contains a BLANK face (vs. ZERO total), (b) +1 Dodge added to combat.defenseRoll, (c) per-attack scope (not per-die — only ONE Dodge regardless of blank count).

---

## Rancor

**Special Action (Crippling Blow)** — shared `crippling_blow` family — "Perform an attack. After the attack resolves, if it did not miss, the defender becomes Stunned."
- Impl: `src/game/abilities.js`, `src/handlers/combat.js` (shared with Wrecker / Captain Hask). Per-figureKey post 2026-05-13.
- ✅ correct (already audited as part of the figkey migration).

**Trained** — "While attacking, you may suffer 1 Strain to reroll 1 attack die."
- Impl: `trained_rancor` keyed at 1 site.
- ⚠️ suspicious — verify (a) named reroll bucket button on attacker's roll-window, (b) Strain via `applyStrain` (so Headhunter/Fireproof/Submit-or-Fight fire), (c) reroll-1-die action via the standard reroll pipeline.

**Voracious** — "At the start of another figure's activation, you may defeat a friendly non-companion figure within 2 spaces to recover 2 Damage and ready your Deployment card. Limit once per round."
- Impl: `voracious_rancor` keyed at 1 site (SoA orchestrator-wired per the 2026-05-07 slice 6 migration).
- ⚠️ suspicious — verify (a) SoA "another figure's activation" trigger (NOT Rancor's own SoA), (b) picker offers friendly non-companion within path-2, (c) defeat goes through standard pipeline (BEFORE_DEFEATED hooks fire on chosen friendly), (d) Rancor recovers 2 Damage + DC card readies (clears exhausted state), (e) once-per-round gate via `roundFigureAbilityUsed[voracious_rancor_<msgId>]`.

---

## Rebel Pathfinder (Elite)

**Infiltration** — "After deployment, you may move up to 6 spaces."
- Impl: `src/handlers/post-deploy.js:129` — registered as a deploy-phase movement ability with `mpPerFigure: 6`.
- ⚠️ suspicious — verify (a) trigger fires post-deploy for each Pathfinder in the deployed group, (b) each figure gets independent 6-space picker (Move-X with bypassCosts? — actually card says "move up to 6 spaces" with no bonus-cost waiver, so this is MP-style movement honoring difficult terrain per alexanbv 2026-05-13 clarification), (c) "you may" → Skip button included.

**Light It Up** — "While attacking, if the target of your attack did not have line of sight to you at the start of your activation, you may reroll up to 1 attack die."
- Impl: `light_it_up_rebel_pathfinder` keyed at 1 site.
- ⚠️ suspicious — verify (a) LoS check uses `game.activationStartPositions[targetFigureKey]` (target's position at SoA — but rule says "did not have LoS to YOU", so it's reverse: target's-LoS-from-position-at-Pathfinder's-SoA back to Pathfinder), (b) named reroll bucket on attacker, (c) once per attack.

**Distracting Fire** — "After resolving an attack, if it did not miss, you may force the defender's group to activate next if able. Limit once per group per round."
- Impl: `distracting_fire_rebel_pathfinder` keyed at 2 sites.
- ⚠️ suspicious — verify (a) post-attack trigger fires only on Hit (not Miss), (b) "force defender's group to activate next" → set roundForcedNextActivationMsgId or similar, (c) "if able" — only fires when the defender's group still has un-activated figures, (d) once-per-group-per-round via `roundFigureAbilityUsed`.

---

## Rebel Saboteur (Elite & Regular)

**Overload** (shared `overload_saboteur`) — "You can trigger the same Surge ability up to twice per attack."
- Impl: 3 sites in src/.
- ⚠️ suspicious — verify (a) trigger reads attacker passive at surge-allocation time, (b) when present, raises the per-surge-ability allocation cap from 1 to 2 (only for the SAME ability), (c) applies to all of Stun, Pierce 2, Blast 2 separately.

**Priority Target** (Elite only, in abilityText) — "Figures do not block line of sight for this figure's attack."
- Impl: handled via abilityText case-insensitive match `priority target` + `line of sight` in `dc-play-area.js` buildAndSendAttackTargets.
- ✅ correct.

---

## Rebel Trooper (Elite & Regular)

**Aim** (shared semantics per alexanbv 2026-05-13 ruling) — "If you have not exited your space during this activation, apply +1 Damage and +2 Accuracy to your attack results."
- Impl: `combat.js` step-4 attacker mods reading `game.figureMoved[attackerFigureKey]`. Per-figure activation movement check.
- ✅ correct (rewritten in commit `b6edcfc7` per alexanbv ruling — printed Elite "group's activation" wording flagged as incorrect; both Regular and Elite use the same per-figure movement check).

**Double Action Special (Get into Position)** (Elite only) — "Move up to 4 spaces and become Focused."
- Impl: `src/game/abilities.js:5424` (`mpBonus + applyFocus`) — Move-X picker with `isMoveX: true` per CRR MOVE-017 (ignores bonus costs per alexanbv 2026-05-13 ruling).
- ✅ correct — Move-X path is canonical for "move up to N spaces" abilities.

**Get Ready** (Elite only) — "At the start of your activation, another figure in your group interrupts to move 1 space."
- Impl: `get_ready_rebel_trooper_elite` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoA trigger ("at start of your activation"), (b) picker presents OTHER group members (not self), (c) chosen figure gets a 1-space Move-X picker (bypassCosts? — card says "move 1 space" — Move-X with bypassCosts), (d) "interrupts" wording: this is a pre-activation slot, not the regular Move action.

---

## Riot Trooper (Elite & Regular)

**Stun Batons** (shared) — "After you resolve an attack, if the target suffered any Damage, it also suffers 1 Strain."
- Impl: 3 sites in src/.
- ⚠️ suspicious — verify (a) post-attack hook fires only if Damage > 0 on target, (b) Strain applied via `applyStrain` (so Headhunter/Fireproof/Submit-or-Fight fire on target), (c) Elite vs Regular — both should behave identically (no wording difference between cards aside from "Damage" vs "Damage results"; alexanbv has previously confirmed this is a wording variant not a rule variant).

**Shield** (shared) — "At the end of your activation, if you have no Block Tokens, gain 1 Block Token."
- Impl: shared with other Shield bearers (likely EoA hook).
- ⚠️ suspicious — verify (a) EoA trigger fires per-figure (not per-group), (b) "no Block Tokens" check counts CURRENT Block tokens (not Damage/Surge/Evade), (c) grants exactly 1 Block (not capped at max — but power-token max would clamp).

**Weaken (passive)** (Elite only) — "your attacks apply Weakened to the target."
- Impl: probably step-4/step-8 attacker mod that auto-applies Weaken condition.
- ⚠️ suspicious — verify (a) trigger fires on every Riot Trooper Elite attack regardless of hit/miss (card says "your attacks apply" — possibly always-on, possibly hit-gated; CRR may clarify), (b) Weaken applied via standard condition pipeline (immunity respected).

**Professional** (Elite only) — "While attacking, you may reroll 1 attack die."
- Impl: shared with other Professional bearers.
- ⚠️ suspicious — verify (a) named reroll bucket per attack, (b) defender's "While defending" mirror (if such cards exist) doesn't trigger from this.

---

## Royal Guard (Elite)

**Sentinel** — "While a friendly non-GUARDIAN figure is defending, and you are adjacent to the targeted space, apply +1 Block to the defense results. Limit 1 'Sentinel' or 'Protector' ability used per attack."
- Impl: `sentinel` keyed at 6 sites in src/.
- ⚠️ suspicious — verify (a) "friendly non-GUARDIAN defender" filter on target keyword, (b) "adjacent to targeted space" — path-1 from RG to defender's footprint, (c) "+1 Block to the defense results" via defender bucket button, (d) "1 Sentinel/Protector ability used per attack" → shared once-per-attack flag across all Sentinel + Protector sources.

**Forward Vengeance** — "When an adjacent, friendly, non-GUARDIAN, non-companion figure is defeated, you become Focused and may move 1 space."
- Impl: `forward_vengeance_royal_guard_elite` keyed at 1 site.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook for defeated friendly within path-1 + keyword filter, (b) Focus applied to RG via `applyCondition` (immunity respected — but RG doesn't have Immune), (c) "may move 1 space" → Move-X picker with bypassCosts? — card text just says "move 1 space" which fits the Move-X pattern per alexanbv 2026-05-13, (d) prompt is "you may" so the picker must include a Skip button.

**Professional** — same as Riot Trooper Elite above.

---

## Batch 13 — Summary

- ✅ correct: 4 (Crippling Blow shared family, Priority Target, Aim both troopers, Get into Position)
- ⚠️ suspicious: 19
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Rancor Voracious SoA orchestration** — start-of-OTHER-figure's-activation trigger, defeat-friendly picker, recover + ready own card. Multi-step interrupt that previously survived the SoA slice-6 migration. Worth a click-through with a 2-figure group + adjacent friendly.

2. **Rebel Pathfinder Infiltration deploy-phase movement** — per-figure 6-space picker, each Pathfinder independent. Confirm bonus costs respected (Move action style) since "move up to 6 spaces" doesn't say "spaces" without bonus-cost waiver per alexanbv's clarification.

3. **Distracting Fire forced-next-activation** — post-attack hook that forces opponent's group to activate next. Confirm "if able" gates correctly (no un-activated figures in defender's group = no fire) + once-per-group-per-round limit shared with other "force next" abilities.

4. **Rebel Trooper Elite Get Ready group-mate interrupt** — SoA "another figure in your group interrupts to move 1 space." Verify the chosen friendly's 1-space Move-X has bypassCosts (it's a "move N spaces" effect per alexanbv 2026-05-13).

5. **Royal Guard Sentinel + Forward Vengeance** — Sentinel's "Sentinel/Protector once per attack" cross-source gate needs to be verified shared with other Sentinel + Protector bearers. Forward Vengeance's Focus + 1-space-move are independent; both should fire (not OR).

**Next:** Batch 14 (DCs alphabetical after Royal Guard (Elite)).
