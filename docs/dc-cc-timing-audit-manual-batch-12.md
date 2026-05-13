# DC/CC Timing Audit — Manual Triage Batch 12

Scope: DCs alphabetical after Murne Rin, 10 cards: Nexu (Elite), Nexu
(Regular), Obi-Wan Kenobi, Onar Koma, Paz Vizsla, Pit Droid, Probe
Droid (Elite), Probe Droid (Regular), Purge Commander (Elite), Purge
Trooper (Elite).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Nexu (Elite & Regular)

**Special Action (Pounce)** — shared `dc_pounce` (alexanbv-confirmed per-figureKey 2026-05-13).
- ✅ correct.

**Cunning** — shared `cunning_*` family with Han / Jyn Odan.
- ✅ correct (step-4 defender passive; +1 Block per Evade).

**Non-Sentient** — "You cannot interact."
- Impl: `src/engine/available-actions.js`, `src/handlers/dc-play-area.js` — Interact action gated when DC abilityText contains "Non-Sentient" and no `beastTamerInteractOverride` is set. `beastTamerInteractOverride` now per-figureKey (commit `b0e082ad`).
- ✅ correct.

---

## Obi-Wan Kenobi

**Alter Mind** — "Hostile figures with a figure cost of 9 or less within 3 spaces of you cannot interact and are not counted for the purposes of control."
- Impl: `src/game/board-helpers.js` (`alter_mind_obiwan` keyed) — passive bi-effect: blocks hostile interact AND excludes from control counting.
- ⚠️ suspicious — verify (a) cost-9 filter uses base figure cost (not attachment-modified), (b) within-3 path-counted, (c) interact-block applies to the hostile's interact-action eligibility check, (d) control-counting exclusion handles all "controlled by player" predicates (terminals, mission tokens, control objectives).

**Strike Me Down** — "When an attack targeting you is declared, you may reduce your figure cost by 3. If you do, you are then defeated."
- Impl: `src/handlers/combat.js`, `src/handlers/combat-reactions.js`, `src/engine/available-actions.js`, `src/engine/defeat-handler.js`. Defender-controlled interrupt.
- ⚠️ suspicious — verify (a) "**may** reduce" → Use/Skip prompt to Obi-Wan's owner at attack-declare, (b) cost reduction is recorded (some downstream cost-conditional triggers like Bounty / scoring care), (c) Obi-Wan is defeated via the standard pipeline so BEFORE_DEFEATED hooks (like Into the Force) fire, (d) the attack STILL RESOLVES — the attacker keeps their action but the target is gone (defender choice to die).

**Into the Force** — "When you are defeated, choose another friendly figure. That figure becomes Focused."
- Impl: `src/game/damage-pipeline-hooks.js`, `src/engine/combat-bridge.js`, `src/game/interrupts.js`, `src/handlers/index.js`. WHEN_DEFEATED hook with picker.
- ⚠️ suspicious — verify (a) trigger fires on ANY defeat source (attack, Bleed, Blast splash, Strain → damage, etc.), (b) "another friendly figure" → picker presents all friendlies, (c) Focus applies via standard `applyCondition` (so condition-immunity is honored).

---

## Onar Koma

**Special Action (Rush)** — "Move up to 4 spaces, then you may push an adjacent, SMALL figure up to 1 space. If you do, you and that figure suffer 1 Damage."
- Impl: `data/ability-library.json:rush_onar` (descriptor) + `src/game/abilities.js` rush handler family.
- ⚠️ suspicious — verify (a) 4-MP via pendingMoveX, (b) SMALL filter on push target, (c) "If you do" → the 1-Damage-each cost fires ONLY if push happened (Skip → no damage to anyone), (d) Onar's 1 Damage is `viaStrain: false` (direct damage, not strain).

**Get Down** — "While a small figure within 2 spaces is defending, you may apply +1 Block or +1 Evade to the defense results. Limit once per round."
- Impl: `src/handlers/combat.js` (`get_down_onar` keyed).
- ⚠️ suspicious — verify (a) "small figure within 2" → SMALL keyword + path-2 filter, (b) "+1 Block or +1 Evade" → Use/Skip + Block/Evade choice picker (3-button), (c) once-per-round gate via `roundFigureAbilityUsed[onarFk_get_down]`, (d) "another friendly" — does Onar himself qualify? Onar is SMALL, but he's the trigger source, not the defender, so the rule reads naturally as "friendly small defender" without self-exclusion.

**Immune** — "You cannot gain HARMFUL conditions."
- Impl: `src/game/conditions.js`, `src/handlers/dc-play-area.js`. `immune_onar` keyed.
- ✅ correct — `isConditionImmune(game, figureKey)` short-circuits `applyCondition` for HARMFUL conditions on Onar.

---

## Paz Vizsla

**Heavy Repeater** — "While performing a Ranged attack, you may suffer 1 Strain to apply +1 Damage, Blast 2, or +3 Accuracy to the attack results."
- Impl: `src/handlers/combat.js` (`heavy_repeater_paz` keyed).
- ⚠️ suspicious — verify (a) "may suffer" → Use/Skip + 3-option picker (Damage / Blast / Accuracy), (b) Strain via `applyStrain` (so Headhunter / Fireproof / Submit or Fight fire), (c) per-attack limit (likely once per attack, but verify the gate), (d) restricted to Ranged attacks.

**Submit or Fight** — "When you would suffer Damage from Strain, you may return any number of Command cards from your discard pile to the game box to prevent that much Damage."
- Impl: `src/handlers/combat.js`, `src/handlers/interrupts.js`. Strain-pipeline interrupt.
- ⚠️ suspicious — verify (a) trigger fires when Strain causes Damage on Paz (strain→damage branch of the pipeline), (b) picker presents Paz's discard pile; player picks N cards to remove, (c) N Damage prevented = N cards removed, (d) cards returned to GAME BOX (not back to deck — these are removed-from-game).

---

## Pit Droid

**Useful** — "You can retrieve crates. Adjacent heroes can interact with crates you are carrying."
- Impl: `src/game/spatial.js`, `src/game/movement.js`, `src/game/combat-stack.js`, `src/game/damage-pipeline.js` (various crate-handling sites).
- ⚠️ suspicious — verify (a) Pit Droid can pick up + carry crates (extends the standard crate-pickup eligibility), (b) "adjacent heroes" can interact with crates Pit Droid carries (proxy-interact pattern).

**Shiny** — "If you are on the map at the end of the mission, heroes gain 50 credits."
- Impl: ❌ NO IMPL.
- — no impl — Shiny is end-of-mission credit grant. Skirmish doesn't track credits (campaign-only mechanic). Defensible to leave unimplemented in skirmish; flag for campaign-mode wiring if/when added.

---

## Probe Droid (Elite & Regular)

**Targeting Computer** (Elite passive) — shared `targeting_computer_*` family.
- ✅ correct (named reroll bucket).

**Self-Destruct** — "At the end of a round, you may roll 1 red die. Each adjacent figure or object suffers Damage equal to the Damage results. Then, you are defeated."
- Impl: `src/handlers/round.js`, `src/handlers/interrupts.js`, `src/handlers/index.js`. `self_destruct_probe` keyed at EoR.
- ⚠️ suspicious — verify (a) EoR trigger fires for both Elite and Regular variants (shared id), (b) "**may** roll" → Use/Skip prompt at EoR (decision per-figure since each Probe Droid figure is its own decision point), (c) "each figure or object adjacent" includes friendly figures, (d) damage applied via the unified object-damage pipeline (alexanbv 2026-05-10 architecture), (e) Probe Droid defeated AFTER splash damage (BEFORE_DEFEATED hooks like Bounty fire on the splash + self).

---

## Purge Commander (Elite)

**Special Action (Shock Grenade)** — "Choose a space within 3 spaces and roll 1 green die. Each other figure on or adjacent to that space suffers Damage equal to the Damage results. If you rolled a Surge, those figures become Weakened."
- Impl: `data/ability-library.json:shock_grenade_purge` (descriptor) + `src/game/abilities.js` generic handler.
- ⚠️ suspicious — verify (a) range-3 space picker, (b) 1 green die roll, (c) Damage applied to all figures on/adjacent excluding Purge Commander himself, (d) Surge → Weaken applied to same set (condition-immunity honored).

**Coordinated Hunt** — "While you or a friendly HUNTER in your line of sight is attacking, it may reroll 1 attack die. Limit one 'Coordinated Hunt' per attack."
- Impl: `src/game/combat.js`, `src/handlers/combat.js` (`coordinated_hunt_purge_commander` keyed).
- ⚠️ suspicious — verify (a) "**you or** a friendly HUNTER" — Purge Commander himself qualifies (HUNTER trait check on Purge Commander), (b) "friendly HUNTER in YOUR (PC's) line of sight" — LoS check from PC, (c) "may reroll 1 attack die" → named reroll bucket button to the attacking figure's owner per the 2026-05-13 unified reroll model, (d) once-per-attack limit (combat-level flag, not round-level).

---

## Purge Trooper (Elite)

**Imperial Loadout** — "When you are deployed, gain 1 Loadout card from the supply."
- Impl: `src/engine/activation-setup.js`, `src/handlers/setup.js`, `src/handlers/phase-gate.js`, `src/engine/misc-helpers.js`, `src/engine/combat-bridge.js`, `src/handlers/combat.js`, `src/handlers/after-attack-resolve.js` (broad surface — loadout system).
- ⚠️ suspicious — verify (a) post-deploy picker shows the loadout supply (Electrobaton / Electrostaff / Z-6 / Mortar / etc. variants), (b) chosen Loadout card attaches to the Purge Trooper Elite group, (c) loadout-specific Special Actions become available (Flurry of Blows / Quick Strike / Burst Fire / Disruptor Rifle / Crippling Blow / Fire Mission / Tonfa Strike).

**Special Action (On the Hunt)** — "Move up to 2 spaces, then perform an attack targeting a unique hostile figure. Apply +1 Damage to the attack results."
- Impl: `data/ability-library.json:on_the_hunt` (descriptor) + `src/game/abilities.js`.
- ⚠️ suspicious — verify (a) 2-MP move via pendingMoveX, (b) "**a unique hostile figure**" → target picker restricted to hostile DCs with `unique: true` (e.g., heroes, named villains), (c) +1 Damage applies as step-4 attacker mod for this attack only.

---

## Batch 12 — Summary

- ✅ correct: 6
- ⚠️ suspicious: 15
- ❌ wrong-stage: 0
- — no impl: 1 (Pit Droid Shiny — end-of-mission credit grant; skirmish doesn't track campaign credits)

**Highest-priority items surfaced this batch:**

1. **Obi-Wan Strike Me Down** — defender-controlled defeat-by-choice at attack-declare. Verify the full flow: prompt → reduce cost by 3 → Obi-Wan defeated via standard pipeline (Into the Force fires) → attack still resolves on the now-defeated space.

2. **Paz Submit or Fight discard-to-game-box mechanic** — cards go to GAME BOX (removed from game), not back to discard. Different from "shuffle into deck" or "return to deck top". Worth a click-through verifying the removal is permanent for the rest of the game.

3. **Probe Droid Self-Destruct dual-figure decision** — Elite + Regular share the ability id; in multi-figure groups (Probe Droid groups can have 2 figures), each Probe Droid figure makes its own Use/Skip decision at EoR. Verify the picker fires per-figure.

4. **Onar Koma Get Down ambiguity** — "small figure within 2" — does Onar himself qualify (Onar is SMALL)? Probably yes (no self-exclusion in card text). Worth canonicalizing.

5. **Purge Trooper Imperial Loadout supply pick** — verify the deploy-time picker offers the full Loadout supply and that the chosen Loadout's downstream Special Actions become available (Flurry / Quick Strike / Burst Fire / Disruptor / Crippling Blow / Fire Mission / Tonfa Strike — all already audited as per-figure in the migration sprint).

**Next:** Batch 13 (DCs alphabetical after Purge Trooper (Elite)).
