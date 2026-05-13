# DC/CC Timing Audit — Manual Triage Batch 03

Scope: DCs C-* alphabetical (10 cards): C-3P0, C1-10P "Chopper", Cad Bane,
Cal Kestis, Cam Droid, Captain Terro, Cara Dune, Cassian Andor, Chewbacca,
Chirrut Imwe.

Verdicts:
- ✅ correct — implementation fires at the right CRR stage
- ⚠️ suspicious — wired but worth a closer look
- ❌ wrong-stage — implementation timing contradicts the card text
- — no impl — no code reference found

---

## C-3P0

**Special Action (Inform)** — "Choose an adjacent friendly figure. That figure becomes Focused."
- Impl: `src/game/abilities.js:5864` — `Inform` label, applies `Focus` to chosen adjacent friendly via `applyCondition`.
- ✅ correct — fires through dcSpecial pipeline at activation action-time.

**Cower** — "While defending, while adjacent to a friendly figure, you may reroll 1 defense die."
- Impl: `src/handlers/combat.js` (cower_c3po-keyed) + `src/game/combat.js` (eligibility). Per memory `project_combat_rebuild_session_20260508.md`, alexanbv corrected a Cower over-grant bug on 2026-05-08 (commit shipped in night batch).
- ✅ correct — fires in defender step-3 reroll window when adjacent to a friendly. "May reroll 1" → exposed as a named reroll bucket button per the unified reroll model.

**Distracting** — "While a friendly figure is defending, and you are adjacent to the targeted space, apply +1 Evade to the defense results."
- Impl: `src/game/distracting-helpers.js` + `src/engine/combat-bridge.js` + `src/game/combat.js` + `src/game/effective-los.js`.
- ✅ correct — fires as a step-4 defender modifier (auto-applied; no player choice since it's a passive +Evade).

**Non-Combatant** — "You cannot attack."
- Impl: `src/handlers/dc-play-area.js` — non_combatant_c3po gates the Attack action from the activation action picker.
- ✅ correct (passive on action enumeration).

---

## C1-10P "Chopper"

**Special Action (Ram)** — "Move up to 2 spaces, then choose an adjacent figure. If hostile, roll 1 green die. Suffers Damage = Damage results. If SMALL, push up to 1 space."
- Impl: `data/ability-library.json:3757` (`ram_chopper` entry) with `freeMoveBonus: 2`, `rollOneDie: green`, `rollOneDieTarget: adjacentHostile`, `rollOneDiePushSmall: true`. Driven by generic dcSpecial handlers in `src/game/abilities.js`.
- ✅ correct — Special Action at activation action-time; move-then-roll-then-push ordering enforced via library descriptor.

**Special Action (System Shock)** — "Use while on or adjacent to a terminal. Choose a figure on or adjacent to any terminal. 2 Damage + 1 Strain."
- Impl: `data/ability-library.json:4901` (`system_shock_chopper` entry) with `activatorMustBeAdjacentToToken: terminal` + `targetMustBeAdjacentToToken: terminal`.
- ✅ correct — terminal-adjacency precondition enforced for both activator and target. Damage + Strain applied via generic targetHostileFigure handler.

---

## Cad Bane

**Flawless Execution** — "Before you declare an attack, you become Focused. If you are already Focused, you may gain 1 Power Token and add 1 attack die of any color to your attack pool instead of 1 green die."
- Impl: `src/handlers/combat.js:2325-2334` — inside `handleCombatDeclare`. If not Focused, applies Focus + adds 1 green die. If already Focused, adds 1 yellow die (note: card says "any color" but impl hardcodes yellow).
- ⚠️ suspicious — **two issues**: (1) card grants "1 attack die of any color" in the already-Focused branch, but impl hardcodes yellow. Per IACP, "any color" generally means player choice. Worth confirming the design intent — is this a deliberate simplification, or a missing picker? (2) "may gain 1 Power Token" + "may" → player choice. Currently auto-applies. Verify "may" handling matches IACP "may" semantics.

**I Make the Rules Now** — "At the start of another figure's activation, a friendly HUNTER within 4 spaces may gain 1 movement point. Limit once per round."
- Impl: `src/game/soa-orchestrator.js:474` — iterates other figures' activations, finds Cad Bane on either team, scans for friendly HUNTERs within 4. Once-per-round gate.
- ⚠️ suspicious — "may" → confirm player-choice button exists. If auto-grants the 1 MP, the trigger fires correctly but player-choice semantics may be lost. (For HUNTER + 1 MP, auto-grant is usually fine because no downside — but verify a click-through exists if multiple friendly HUNTERs could be eligible.)

---

## Cal Kestis

**Special Action (Wall Run)** — "Move a number of spaces up to your speed. During this movement, you may ignore terrain in spaces that share an edge or corner with a wall."
- Impl: `src/game/movement.js:471-531` builds wall-adjacent cell set + per-figure `figureWallRunActive` flag, gates terrain cost waiver to those cells. Per memory, alexanbv-confirmed 2026-05-10: includes blocking + impassable + difficult terrain in wall-adjacent cells. Library entry at `data/ability-library.json:5296`.
- ✅ correct — Special Action at activation action-time; per-step terrain cost waiver consumed during the activation, cleared at activation end.

**Force Slow** — "At the start of the round, choose a hostile figure within 3 spaces. That figure's group cannot be activated during its owner's next opportunity to resolve an activation."
- Impl: `src/handlers/round.js:1143, 1441` — `_postForceSlowPicker` runs at SoR for each Cal Kestis owner. Picker emits a "choose hostile within 3" button row; selected group becomes skip-next-activation.
- ✅ correct — fires at SoR (two call sites = both round-1 and ongoing-round paths). Skip-next-activation enforced via group-activation state.

---

## Cam Droid

**Surge (Agitate)** — "If this attack does not miss, the defending figure's group must be the next group to activate, if able."
- Impl: `src/game/combat.js`, `src/engine/combat-bridge.js`, `src/handlers/combat.js`, `src/handlers/dc-play-area.js`, `src/headless/game-harness.js` — Agitate routes through surge spend + post-resolve flag set on defender's group.
- ⚠️ suspicious — **timing edge case**: the "if able" clause needs to consider already-activated groups, stunned/exhausted leaders, and the multi-group-on-one-side case. Verify post-resolve handler in `combat-bridge.js` checks both the must-be-next-up bind AND the "if able" escape (defender's group already activated, etc.).

---

## Captain Terro

**Special Action (Flamethrower)** — "Choose a space within 2 spaces. Each other figure on or adjacent to that space suffers 1 Damage and 1 Strain, then becomes Weakened."
- Impl: `data/ability-library.json:1896` (`flamethrower_terro` entry, `fixedAreaEffect` family) + `src/game/abilities.js:3290, 3395` (deducts MP cost where applicable + applies damage/strain/Weaken to area, excluding source).
- ⚠️ suspicious — verify "other figure on or adjacent to that space" correctly **excludes Terro himself** AND **applies Weaken** in addition to damage+strain. Sister card *Din's Wrist Flamethrower* (memory'd) has same template but lacks the Weaken clause — confirm library descriptor includes the Weaken application here.

**Mounted** — "At the start of your activation, gain 3 movement points."
- Impl: `src/game/soa-orchestrator.js` — fires in SoA, grants 3 MP via `grantMovementBank`.
- ✅ correct.

**Efficient Travel** — "You ignore additional movement point costs for difficult terrain and hostile figures."
- Impl: per memory `reference_iacp_keywords.md` — canonical IACP keyword, destruct-confirmed 2026-05-06. Wired in movement-cost evaluation.
- ✅ correct (passive on terrain-cost computation).

**Professional** — "While attacking, you may reroll 1 attack die."
- Impl: `src/game/combat.js` (`getInnateRerollAbilities` returns Professional descriptor) + `src/handlers/combat.js` (named reroll bucket). Canonical IACP keyword.
- ✅ correct — fires in step-3 attacker reroll window as a named "Use Professional" button (post-2026-05-13 unified reroll model).

---

## Cara Dune

**Shock and Awe** — "When you declare an attack, you may replace 1 Yellow die in your attack pool with 1 Red die. Limit once per round."
- Impl: `src/game/shock-and-awe-helpers.js` + `src/handlers/combat.js`. Eligibility gated on Yellow being in the pool + once-per-round flag.
- ⚠️ suspicious — **verify timing**: card says "When you declare an attack, you may replace…" Should be the same on-declare die-swap window as EE-3 Carbine / Vanguard (alexanbv-confirmed 2026-05-10 placement). Confirm `_postOnDeclareDieSwapPrompts` in combat.js posts a Shock and Awe button alongside EE-3/Vanguard, **not** at step-4 attacker mods.

**Smash** — "Once during your activation, choose 1 adjacent hostile figure and roll 1 red die. That figure suffers Damage equal to the Damage results. Then, if it is SMALL, you may push it 1 space to a space adjacent to you."
- Impl: `data/ability-library.json:4501` (`smash` entry) — `oncePer: activation`, `rollOneDie: red`, `pushMustRemainAdjacentToActivator: true`. Generic dcSpecial handler.
- ✅ correct — Special Action at activation action-time; once-per-activation gate; SMALL-push remains-adjacent constraint enforced.

**Hunker Down** — "While defending, if you share a corner or edge with a space containing blocking, impassable, or difficult terrain, apply +1 Evade to your defense results."
- Impl: `src/game/hunker-down-helpers.js` + `src/handlers/combat.js`. Step-4 defender modifier; passive (no player choice).
- ✅ correct — fires at step-4 defender; terrain-adjacency check covers blocking/impassable/difficult.

---

## Cassian Andor

**Strike Team** — "After deployment, you and an adjacent friendly figure gain 2 movement points. Then, up to 4 friendly figures outside of your deployment zone each gain 1 Damage Token."
- Impl: `src/handlers/post-deploy.js:141` — post-deploy hook surfaces Strike Team as an interactive ability (type: 'complex'). Driver path also touches `src/handlers/move-x-handler.js` for the +2 MP grant.
- ⚠️ suspicious — verify the "up to 4 friendly figures **outside of your deployment zone**" picker (a) restricts choices to outside-DZ figures, (b) caps at 4, (c) applies 1 Damage **Token** (not 1 Damage). Per IACP, "Damage Token" ≠ damage applied — it's a stored token that can be spent. Worth a click-through to confirm token grant vs damage-suffer.

**It Will Be Alright** — "Once during your activation, you may choose another friendly figure within 2 spaces that can be defeated. That figure is defeated, then perform a move or attack without spending an action."
- Impl: `src/game/interrupts.js:518` (`setPendingItWillBeAlright`), `src/handlers/activation.js:2475` (`handleItWillBeAlrightUse`), `src/handlers/index.js:368-371` (4 sub-handlers: use/skip/pick/action). Library entry at `data/ability-library.json:2787`.
- ✅ correct — full once-per-activation flow: Use→Pick (target friendly that can be defeated)→Action (move or attack without spending action). Multi-step interrupt with sub-handlers wired.

---

## Chewbacca

**Special Action (Slam)** — "Choose 1 adjacent hostile figure and roll 1 red die. That figure suffers Damage equal to Damage results. Then, if SMALL, may push 1 space."
- Impl: `src/game/abilities.js`, `src/discord/components.js`, `src/game/interrupts.js`, `src/handlers/index.js`. Slam routes through the dcSpecial pipeline with red die + push-if-small.
- ✅ correct — Special Action; SMALL push is "may" → player-choice button.

**Protector** — "While a friendly figure is defending, and you are adjacent to the targeted space, apply +1 Block to the defense results. Limit 1 'Protector' ability used per attack."
- Impl: `src/handlers/combat.js:2604-2611`. Adds 1 bonusBlock to defender combat state. Wookiee Avenger attachment swap is checked (skips +1 Block when Avenger is attached, parallel to DBH stripping Brutality).
- ⚠️ suspicious — **verify "Limit 1 Protector per attack"** is enforced. Multiple Chewbacca figures (or shared "Protector"-id figures like Wookiee Warriors) adjacent to the targeted space should NOT each grant +1 Block. Looks like a `sentinelApplied` flag is used (line 2604 condition begins with `!sentinelApplied`), so likely correct — but worth confirming this is reset per-attack.

---

## Chirrut Imwe

**Devout** — "You may use Rebel FORCE USER Command cards."
- Impl: `src/game/cc-timing.js` — eligibility extension for Rebel FORCE USER CCs when Chirrut is in the army.
- ✅ correct (army-build / CC-eligibility extension).

**I'm One With the Force** — "At the start of a hostile figure's activation, you may move up to 2 spaces to a space adjacent to a hostile figure. Limit once per round."
- Impl: `data/ability-library.json:2578` (`i_am_one_with_the_force` entry) — `freeMoveBonus: 2`, `oncePer: round`, trigger "at the start of any hostile figure's activation." Driven by generic dcSpecial pipeline.
- ⚠️ suspicious — verify the **trigger fires at SoA of a HOSTILE figure** (not own), with a Use/Skip prompt shown to Chirrut's owner. Once-per-round gate must persist across multiple hostile SoAs in the same round. Worth a runtime trace — SoA-event hooks tend to fire for the activating figure's owner; the hostile-activation reverse-fire is not the common path.

**The Force is With Me** — "When a Ranged attack targeting you is declared, choose an adjacent hostile figure. If you do, apply -1 Damage to the attack results and the chosen figure suffers 1 Damage."
- Impl: `src/handlers/combat.js:2927-2945` — inside the declare-attack flow, gates on `isRanged && defSpecialIds.includes('the_force_is_with_me_chirrut')`. Scans for an adjacent hostile to Chirrut, auto-picks first match, applies -1 Hit + 1 dmg to that hostile.
- ⚠️ suspicious — **two issues**: (1) **auto-picks first adjacent hostile** instead of presenting a player-choice picker. Card text says "choose an adjacent hostile figure" → player choice. (2) Applies "-1 Hit" while card says "-1 Damage." In IACP these usually mean different things (Hit = pre-conversion attack result, Damage = final damage after defense). Worth a destruct check on which is correct. Per memory `feedback_canonical_card_image_priority.md`, when CRR text is ambiguous, the card image is authoritative — recommend verifying via `vassal_extracted/images/`.

---

## Batch 03 — Summary

- ✅ correct: 14
- ⚠️ suspicious: 8 (Flawless Execution "any color" hardcoded yellow + "may"-token auto; I Make the Rules "may" player-choice; Agitate "if able" escape; Flamethrower (Terro) Weaken inclusion; Shock and Awe declare-time placement; Strike Team Damage Token vs Damage clarity; Protector per-attack limit; I'm One With the Force hostile-SoA trigger; The Force is With Me auto-pick + Hit vs Damage)
- ❌ wrong-stage: 0
- — no impl: 0 (all initial grep misses traced to ability-library.json entries)

**Highest-priority items surfaced this batch:**
1. **Chirrut "The Force is With Me"** — `combat.js:2927-2945` auto-picks first adjacent hostile + applies `-1 Hit` (card says "-1 Damage" + player choice). Two potential mismatches in one block. **Recommended next step:** open `vassal_extracted/images/` for Chirrut Imwe card image to canonicalize "Damage" vs "Hit", and add a target-picker if multiple adjacent hostiles exist.
2. **Cad Bane "Flawless Execution"** — already-Focused branch hardcodes yellow ("any color" in card text), and "may gain 1 Power Token" is auto-applied. Both deserve a player-choice picker if design intent is faithful IACP semantics.

**Next:** Batch 04 (DCs C-* continued — Chopper… already done; next 10 starting at Clan of Two / Clawdite Shapeshifter / Clone Trooper).
