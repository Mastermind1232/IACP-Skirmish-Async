# DC/CC Timing Audit — Manual Triage Batch 11

Scope: DCs alphabetical after Loth-cat (Elite), 10 cards: Loth-cat
(Regular), Luke Skywalker, Luke Skywalker (Jedi Knight), MHD-19, Mak
Eshka'rey, Mara Jade, Maul, Migs Mayfeld, Moff Gideon, Murne Rin.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Loth-cat (Regular)

**Special Action (Pounce)** — shared `dc_pounce` family (Loth-cat Elite/Reg).
- ✅ correct — alexanbv-confirmed per-figureKey migration in commit `165ce220`.

**Special Action (Rat Catcher)** — "You or an adjacent CREATURE gains 1 Block Token."
- Impl: `src/game/abilities.js` (`rat_catcher_lothcat` keyed).
- ⚠️ suspicious — verify (a) picker presents Loth-cat itself + adjacent CREATURE figures, (b) the chosen figure gets 1 Block Token via `grantPowerTokens(_, _, 'Block', 1)`.

**Curious** — shared with Elite.
- ✅ correct.

---

## Luke Skywalker

**Special Action (Saber Strike)** — "Perform a melee attack using 1 red and 1 yellow die. This attack gains Pierce 3."
- Impl: `src/handlers/combat.js`, `src/game/abilities.js` — `saber_strike` keyed. Overrides attack pool to [red, yellow], sets bonusPierce +3, melee type.
- ⚠️ suspicious — verify (a) override fully replaces (not adds to) the printed attack pool, (b) Pierce 3 is bonus (not just total pierce), (c) Melee type override applies even though Luke's printed type is range.

**Inspiring** — "While another friendly figure within 3 spaces is attacking, it may reroll 1 die."
- Impl: `src/game/inspiring-helpers.js`, `src/handlers/combat.js`. Same family as Kanan's Soresu Form (without the Dodge conversion).
- ⚠️ suspicious — verify (a) "**another** friendly" → excludes Luke himself, (b) within-3 path-counted, (c) "may reroll 1 die" → exposed as named reroll bucket button to the attacking figure's owner per the 2026-05-13 unified reroll model, (d) Luke does NOT take Strain (unlike Kanan).

---

## Luke Skywalker (Jedi Knight)

**Deflect** — "After a Ranged attack targeting you or an adjacent friendly figure resolves, a hostile figure of your choice in your line of sight suffers 1 Damage."
- Impl: `src/game/abilities.js`, `src/game/interrupts.js`, `src/game/effective-los.js`, `src/engine/combat-bridge.js`, `src/engine/available-actions.js`, multiple deflection sites.
- ⚠️ suspicious — verify (a) the post-resolve trigger fires for BOTH Luke-as-defender AND friendly-adjacent-defender cases, (b) the hostile-picker enumerates ONLY hostiles in Luke's LoS (not the attacker's LoS), (c) the 1 Damage routes through `applyDamage` so per-figure hooks (Bounty, Last Stand, etc.) fire correctly.

**Heroic** — "Once during your activation, you may perform an attack without spending an action."
- Impl: `src/game/abilities.js`, `src/handlers/index.js`, `src/game/activation-state.js` (`heroicUsedThisActivation` keyed by figureKey per 2026-05-09 migration), `src/discord/components.js` (heroic button surfacing).
- ✅ correct — once-per-activation gate via heroicUsedThisActivation (figureKey-keyed already), free attack via freeAttackBonusPending.

---

## MHD-19

**Special Action (Medical Loadout)** — "You or an adjacent friendly figure recovers 3 Damage."
- Impl: `data/ability-library.json:medical_loadout` (descriptor) + `src/game/abilities.js` generic handler.
- ⚠️ suspicious — verify (a) picker presents MHD-19 itself + adjacent friendly figures, (b) 3-Damage heal via `healHp` (not direct HP write).

**Special Action (Improper Procedure)** — "Choose an adjacent hostile figure. That figure suffers 1 Damage and becomes Weakened."
- Impl: `data/ability-library.json:improper_procedure` (descriptor).
- ⚠️ suspicious — verify (a) 1 Damage via `applyDamage` pipeline (so Bounty etc. fire), (b) Weaken condition applied via `applyCondition` (so condition-immunity is honored).

---

## Mak Eshka'rey

**Surge (Critical Hit)** — "This attack gains Pierce 2. If the target figure suffered 1 or more Damage during this attack, the target figure may not play command cards during this round."
- Impl: `src/game/combat.js`, `src/engine/combat-bridge.js`, `src/handlers/combat.js`. Shared `critical_hit` surge family.
- ⚠️ suspicious — verify (a) Pierce 2 applies, (b) "target may not play CCs this round" sets a per-figure round flag that cc-timing.js honors, (c) the CC-block fires only on damage > 0 (not on miss/0-damage hits).

**Camouflage** — "Hostile figures 4 or more spaces away cannot draw line of sight to you. You do not block line of sight for those figures."
- Impl: `src/game/effective-los.js`, `src/engine/available-actions.js`, `src/handlers/combat.js`, `src/handlers/dc-play-area.js`. `camouflage_mak` keyed.
- ⚠️ suspicious — bi-directional LoS rule. Verify (a) hostiles at distance ≥4 from Mak have no LoS to Mak (target-eligibility blocks attacks on Mak), (b) Mak's body does NOT block LoS for those distant hostiles (figure-blocking removed for Mak from their perspective). The latter is unusual; worth a runtime LoS trace.

---

## Mara Jade

**Adaptive Skills** — "Your affiliation matches your army's affiliation. You gain 1 of the following traits based on your army's affiliation: IMPERIAL: HUNTER; SCUM: SMUGGLER; REBEL: GUARDIAN."
- Impl: `src/game/adaptive-skills-helpers.js`, `data-loader.js`, `cc-timing.js`. Affiliation-based keyword grant.
- ⚠️ suspicious — verify (a) Mara's effective affiliation matches the army's at runtime (not the printed Imperial), (b) the granted trait flows into all keyword checks (HUNTER for hunter-CC eligibility, etc.).

**Fast Learner** — "Once per round, you may play a Command card whose restriction matches the name of another Deployment card in your army, except 'Arcing Shot'."
- Impl: `src/game/adaptive-skills-helpers.js`, `src/game/cc-timing.js`, `src/engine/activation-setup.js`, `src/game/unique-figure-ccs.js`.
- ⚠️ suspicious — verify (a) CC restriction match: Mara can play a CC restricted to e.g. "Bossk" if Bossk is in her army, (b) Arcing Shot exclusion enforced, (c) once-per-round gate persists.

**Professional** — canonical keyword.
- ✅ correct.

---

## Maul

**Dual-Bladed Fury** — "Before you declare an attack, choose one: This attack gains Reach and Cleave 2 OR You become Focused."
- Impl: `src/game/abilities.js`, `src/handlers/dc-play-area.js`, `src/game/cc-timing.js`. Player-choice picker at declare.
- ⚠️ suspicious — verify (a) declare-time picker shows both options, (b) "Reach and Cleave 2" applies both keywords for THIS attack only (cleared post-resolve), (c) Focus is applied via standard mechanism (with green die if attack hasn't started yet — alexanbv-fixed in 2026-05-13 batch ATC pattern).

**Surge (Stalk Prey)** — "After this attack resolves, you gain 2 movement points and 1 Damage Token."
- Impl: `src/game/combat.js` (surge → `stalk_prey` flag), `src/handlers/after-attack-fire.js`, `src/handlers/after-attack-resolve.js`, `src/engine/combat-bridge.js`.
- ⚠️ suspicious — verify (a) 2 MP via `grantMovementBank`, (b) 1 Damage Token via `grantPowerTokens(_, _, 'Damage', 1)` (token-bank grant, NOT damage application — alexanbv principle).

**Sustained by Rage** — "You cannot recover Damage. If you have not resolved an activation this round, you cannot be defeated."
- Impl: `src/game/abilities.js`, `src/game/damage-pipeline.js`, `src/game/damage-pipeline-hooks.js`, `src/game/conditions.js`, `src/engine/combat-bridge.js`, `src/game/damage-helpers.js`.
- ⚠️ suspicious — verify (a) `healHp` is blocked for Maul (any recover effect no-ops), (b) BEFORE_DEFEATED hook prevents defeat if Maul hasn't activated this round, (c) the round-activation check looks at `p1ActivatedDcIndices`/`p2ActivatedDcIndices` for Maul's index. After Maul activates once, defeat-prevention disables.

---

## Migs Mayfeld

**Locked and Loaded** — "You may have up to 3 Power Tokens. After you resolve an attack, gain 2 Power Tokens."
- Impl: `src/game/dc-helpers.js`, `src/engine/combat-bridge.js`, `src/handlers/after-attack-resolve.js`, `src/headless/headless-cc-play.js`.
- ⚠️ suspicious — verify (a) the max-3 cap is enforced at grant time (excess auto-discards or overflow-prompts per the standard token-cap flow), (b) the 2-token grant uses Wild-gain-at-time semantics (player picks types per token gained per the 2026-05-13 wild-token refactor), (c) attack-resolve step-8 hook fires the grant.

**Droid Arm** — "Before you declare an attack, you may discard a Power Token to draw line of sight to the target from a space adjacent to you."
- Impl: `src/handlers/dc-play-area.js`, `src/handlers/combat.js`, `src/engine/available-actions.js`.
- ⚠️ suspicious — verify (a) declare-time picker shows Discard-Token-for-LoS option, (b) the chosen adjacent-space LoS is computed correctly (target eligibility recomputed from that space), (c) token-discard is player choice of type.

**Return Fire (`return_fire_migs`)** — variant of Han Solo's Return Fire WITHOUT the "no damage" precondition.
- Impl: `src/engine/combat-bridge.js`, `src/handlers/after-attack-fire.js`, `src/handlers/after-attack-resolve.js`, `src/handlers/combat.js`.
- ⚠️ suspicious — Han's variant gates on `combat._appliedDamage === 0`; Migs's variant does NOT. Verify the conditional check distinguishes the two ids — `return_fire_migs` should fire on ANY targeting (damage or not).

---

## Moff Gideon

**I Know Everything** — "During setup, before drawing Command cards, search your opponent's Command deck and reveal 2 cards. Your opponent chooses 1 to shuffle back into the deck, then return the other card to the game box."
- Impl: `src/handlers/checkpoint.js`, `src/handlers/cc-hand.js`. Setup-phase trigger.
- ⚠️ suspicious — verify (a) trigger fires during setup BEFORE Gideon's player draws their hand, (b) opponent picker shows 2 random CCs from their deck, (c) selected card returns to game box (removed from deck), (d) the other card shuffles back into the deck.

**You Have Something I Want** — "Once during your activation, you may choose a Power Token or condition token on a hostile figure within 4 spaces. That figure suffers 3 Damage unless it transfers the chosen token to you."
- Impl: `src/game/abilities.js` (`you_have_something_i_want_gideon`), `src/handlers/dc-play-area.js`, `src/handlers/interrupts.js`. Multi-step picker.
- ⚠️ suspicious — verify (a) "Power Token or condition token" picker shows both kinds, (b) hostile owner gets a Transfer/Damage choice, (c) on Transfer: token moves to Gideon's figure (or condition transfers per condition mechanics), (d) on Damage: 3 Damage via applyDamage pipeline, (e) once-per-activation gate (per-figure post-2026-05-13 migration).

---

## Murne Rin

**Special Action (False Orders)** — "Choose a hostile figure with a figure cost of 4 or less within 4 spaces. Perform a move or attack with that figure."
- Impl: `src/game/abilities.js`, `src/engine/action-types.js`, `src/handlers/index.js`, `src/handlers/combat.js`, `src/handlers/dc-play-area.js`. Full handler family.
- ⚠️ suspicious — verify (a) cost-4 filter uses base figure cost (not attachment-modified), (b) within-4 path-counted, (c) "move or attack" → both options offered, (d) hostile's action consumed for that activation (vs free), (e) Murne's player controls the hostile figure for the action.

**Special Action (Field Report)** — "Choose up to 2 friendly figures within 4 spaces with 2 or less attack dice in their printed attack pool. The chosen figures become Hidden."
- Impl: `data/ability-library.json:field_report` (descriptor) + `src/game/abilities.js`.
- ⚠️ suspicious — verify (a) picker shows up-to-2 friendly figures within 4 spaces, (b) printed-attack-dice ≤2 filter (using `attack.dice.length`), (c) Hide condition applied via `applyCondition`.

**Figurehead** — "Before a friendly figure within 4 spaces suffers Damage or Strain, you may suffer Damage or Strain to prevent 1 of that Damage or Strain."
- Impl: `src/game/interrupts.js`, `src/game/activation-state.js`, `src/handlers/combat.js`, `src/engine/combat-bridge.js`, `src/engine/available-actions.js`, `src/engine/misc-helpers.js`.
- ⚠️ suspicious — pre-damage interrupt with player choice. Verify (a) trigger fires BEFORE damage is applied (so prevention works), (b) Murne's owner gets the Use/Skip prompt, (c) Murne's transferred 1 Damage/Strain via `applyDamage`/`applyStrain` so per-figure hooks fire on Murne, (d) prevention reduces the friendly's damage/strain by 1 (min 0).

---

## Batch 11 — Summary

- ✅ correct: 6
- ⚠️ suspicious: 26
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced this batch:**

1. **Maul Sustained by Rage** — "cannot be defeated if not yet activated this round" is a BEFORE_DEFEATED hook that needs the per-figure activation-history check. Verify the hook doesn't accidentally trigger after Maul's activation has been fully spent.

2. **Migs Mayfeld Return Fire (no-damage gate)** — `return_fire_migs` variant should NOT require zero damage (unlike `return_fire` for Han). The shared handler must distinguish the two ids.

3. **Moff Gideon You Have Something I Want token-or-damage choice** — multi-step picker with hostile-owner-controlled Transfer/Damage decision. Click-through audit recommended.

4. **Mak Camouflage bi-directional LoS** — figures ≥4 spaces away can't see Mak AND Mak doesn't block their LoS. The latter is the unusual half; runtime LoS trace recommended.

5. **Mara Adaptive Skills affiliation-based trait grant** — Mara's effective trait set must include the army-affiliation-derived bonus trait for all downstream keyword checks (HUNTER CCs, GUARDIAN protective rules, SMUGGLER restrictions).

**Next:** Batch 12 (DCs alphabetical after Murne Rin).
