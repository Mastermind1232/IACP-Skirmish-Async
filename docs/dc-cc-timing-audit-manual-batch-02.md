# DC/CC Timing Audit — Manual Triage Batch 02

Scope: DCs B-* (alphabetical), 10 cards. Each card's abilityText is paired
with the implementation site(s) located via grep, and the timing is
compared against the CRR stage the rule belongs to. Verdicts:

- ✅ correct — implementation fires at the right CRR stage
- ⚠️ suspicious — wired but worth a closer look (timing edge case, shared helper, wrong-text announcement, etc.)
- ❌ wrong-stage — implementation timing contradicts the card text
- — no impl — no code reference found (may be unwired, or named differently)

---

## BD-1

**Damaged Scomplink** — "You are not counted for the purpose of control."
- ✅ correct (passive, control logic checks ownership predicate; standard pattern).

**Special Action (Stim Canister)** — "An adjacent friendly figure recovers 2 Health."
- Impl: `src/game/abilities.js:5717` — `dcSpecial: healFriendlyAdjacent`, label "Stim Canister". Resolves via the dcSpecial pipeline at action-time.
- ✅ correct (Special Action triggered by the activation action picker).

**Double Action Special (Terminal Slicing)** — "Discard an adjacent terminal to draw 1 Command card."
- Impl: — no impl (only the abilityText string mentions it; no `terminal_slicing` id, no draw-card-on-terminal handler).
- ❌ wrong-stage — actually missing entirely. Terminal-discard-to-draw is not wired. *Note:* Terminal interact mechanics in general (Aphra Excavation, etc.) exist, but BD-1's specific Double Action variant is not surfaced.

---

## BT-1

**Special Action (Missile Salvo)** — "Perform up to 3 Ranged attacks with different targets using 1 blue, 1 red, or 1 yellow die. Limit once per die. Apply +3 accuracy to each of these attacks."
- Impl: `src/engine/action-types.js`, `src/handlers/combat-special-effects.js`, `src/game/abilities.js:1979` (`dcSpecial: multiFireDoubleAttack` family), `src/handlers/index.js` registrations.
- ✅ correct timing — fires as a Special Action chosen from the activation action picker. Per-die limit + +3 accuracy applied to each sub-attack at declare time.

**Assassin** — "Before you declare an attack, become Focused."
- Impl: `src/handlers/combat.js:2233` via `hasBattleMeditationAbility` — shared helper with Diala Passil's Battle Meditation (`src/game/battle-meditation-helpers.js`). Fires inside `handleCombatDeclare`, applies `Focus` + bonus green die before roll.
- ✅ correct — fires at step 1+2 declare, before any roll. Label dynamically switches "Battle Meditation" → "Assassin" for BT-1.

---

## Bantha Rider

**Wild Beast** — "When you would perform an attack, you may perform a Special Action instead."
- Impl: `src/discord/apply-ability-result.js:313` posts a "Wild Beast: Trample instead" swap button alongside the granted-attack button. Gated by per-activation + per-status-phase one-shot flags (`wildBeastUsedThisActivation`, `wildBeastUsedThisStatusPhase` in `activation-state.js:52, 432`). Resolution path: `handleWildBeastTrample` in `src/handlers/interrupts.js:1035`, which calls `resolveAbility('trample_bantha', …)`.
- ✅ correct — offered at the attack-declare decision point as a player choice (per IACP "may"); also exposed in granted-attack contexts where Bantha could otherwise be forced to attack.

**Special Action (Trample)** — "Choose up to 3 adjacent hostile figures and roll 1 red die. Each of those figures suffers Damage equal to the Damage results."
- Impl: `trample_bantha` resolveAbility entry; fired both as a regular Special Action and from the Wild Beast swap path.
- ✅ correct.

**Stampede** — "When you end your movement in spaces that contain other figures, each hostile figure in your space suffers 1 Damage."
- Impl: per `src/handlers/movement.js:1388` comment (alexanbv 2026-05-10), Stampede was folded into the MASSIVE push framework — each displaced enemy in Bantha's final footprint takes 1 Damage BEFORE being pushed. Now lives in `_runMassiveDisplacement` in `src/handlers/move-x-handler.js`.
- ⚠️ suspicious — the migration coupling Stampede to MASSIVE displacement is correct in spirit (Bantha is MASSIVE, so figures in its destination footprint must be displaced), but the rule literally says "end your movement" — not just "during displacement." Worth verifying the post-move-X path also reaches this fire site (i.e., gain-MP-out-of-activation moves still proc Stampede on hostiles in final footprint).

---

## Baze Malbus

**Into the Fray** — "At the start of your activation, gain 1 Surge Token for each hostile figure with line of sight to you. Then, gain 1 movement point."
- Impl: `src/game/soa-orchestrator.js`, `src/handlers/soa-handler.js`, `src/engine/activation-setup.js` — SoA event hooks.
- ✅ correct — fires in the SoA orchestrator, which runs after start-of-round / before activation actions. Surge tokens granted via `grantPowerTokens`, MP via `grantMovementBank`.

**Assault** — "You can perform multiple attacks each activation."
- Impl: `src/engine/available-actions.js`, `src/handlers/dc-play-area.js`. Acts as a per-activation flag that disables the standard "one attack per activation" gate.
- ✅ correct (passive on the action-availability check).

**Hold the Line** — "At the end of your activation, gain 1 Block Token for each hostile figure with line of sight to you."
- Impl: `src/engine/activation-effects.js` via the EoA orchestrator (the SoA file was grepped because the helper file imports cross-link, but the actual fire is in `applyEndOfActivationEffects`).
- ✅ correct — fires at EoA. Symmetric to Into the Fray for SoA.

---

## Bib Fortuna

**Dirty Dealing** — "You cannot be included in the same army as any REBEL Deployment cards."
- Impl: `src/game/validation.js` army-build validator. (`dirty_dealing_bib` id not directly grep-hit, but the validator handles Bib's REBEL-exclusion at deck-build.)
- ⚠️ suspicious — verify the army-validator hard-rejects on REBEL+Bib pairing; flagged because the specialAbilityId itself isn't grep-hit in src.

**Special Action (Bartered Information)** — "Choose another friendly SCUM figure within 2 spaces. Then, you may spend 1 VP to choose another such figure. Each chosen figure becomes Focused."
- Impl: `src/game/abilities.js:1579` — first-pick path applies Focus. Comment includes "*(You may also spend 1 VP to Focus another friendly SCUM within 2.)*" as a follow-up hint.
- ⚠️ suspicious — the **second-pick + VP-spend branch is informational only** in the log message. The 1-VP-for-second-focus is not enforced as a button choice. Manual play possible but not automated.

**Illicit Arms** — "While a friendly figure is attacking, if your army's affiliation is SCUM, you may discard 1 Command card from your hand to apply +1 Damage to the attack results. Limit once per attack."
- Impl: `src/handlers/combat.js:6417` (inside `sendModsYn(attacker)` step-4 attacker-mods path) + `src/game/illicit-arms-helpers.js` (eligibility) + `src/handlers/combat-reactions.js` (Use/Decline handler).
- ✅ correct — alexanbv-confirmed timing fix landed (step-4 attacker modifier, not post-defender mods). Per-attack limit via `combat.illicitArmsResolved`.

---

## Biv Bodhrik

**Special Action (Multi-Fire)** — "Perform 2 attacks. Each attack must have a different target. Apply -1 Damage to each attack's results."
- Impl: `src/game/abilities.js:1979` (`dcSpecial: multiFireDoubleAttack`), `src/engine/combat-bridge.js`, `src/handlers/combat.js`. Shared with HK Assassin Droid family per memory (`project_elite_multifire_held.md`).
- ✅ correct — Special Action; -1 Damage modifier applied to each sub-attack.

**Surge (Suppression)** — "After resolving a Ranged attack, if it did not miss due to accuracy, the target suffers Strain equal to the number of target's Block, Evade, and Dodge results, to a maximum of 2."
- Impl: `src/engine/combat-bridge.js:1952-1977` — `surgeSuppressionStrain` flag set at surge-spend (step 5), consumed at step 8 in `combat-bridge.js`. Routes through the strain pipeline (`applyStrain`).
- ✅ correct — fires post-resolve (step 8) after defender's block/evade/dodge totals are final and after the miss check. Max-2 cap implemented.

---

## Bo-Katan Kryze

**Personal Combat Shield** (Gar Saxon shares id) — "Whenever you spend a Block Token while defending, apply +1 Evade to the defense results."
- Impl: `src/handlers/combat.js:8014, 8086, 8138` — three call-sites in the token-phase handler (wild-roll / declined / standard spend paths). Each adds `combat.bonusEvade += 1` when a Block token is spent by the defender.
- ✅ correct — fires inside the defender's token-spend phase (step 6 / token phase), exactly when the Block token is consumed.

**Defensive Fire** — "After resolving a Ranged attack, gain 1 Block Token."
- Impl: `src/engine/combat-bridge.js:2982-2988`. Calls `grantPowerTokens(game, combat.attackerFigureKey, 'Block', 1)` after ranged-attack resolve.
- ✅ correct — step 8 post-resolve.

**Dual-Wield Pistols** — "After resolving a Ranged attack, you may perform a Ranged attack without spending an action. Limit once per round."
- Impl: `src/engine/combat-bridge.js:2992-2998`. Sets `freeAttackBonusPending[figureKey] = true` and `roundFigureAbilityUsed[dualWieldPistols_<fk>] = true`.
- ⚠️ suspicious — verify the "may perform" presentation. The card is permissive (player choice); confirm a Use/Skip button is offered post-resolve rather than auto-granting a free attack queue item. (Lazy-grant via `freeAttackBonusPending` suggests it's offered, but worth a click-through trace.)

**Last Wielder of the Darksaber** — "You may include 'The Darksaber' in your army. At the start of the round, you may attach it to this group."
- Impl: army-build side handled in `src/game/validation.js` (attachment eligibility extension). SoR attach-to-group: `data/ability-library.json:2883` (`last_wielder_darksaber_bokatan` entry exists).
- ⚠️ suspicious — verify the SoR "may attach" prompt actually fires at start-of-round for Bo-Katan owners (not just at deck-build). The ability-library entry exists; runtime SoR wiring should be confirmed via play-trace.

---

## Boba Fett

**Wrist Cord** — "Once per round, you may spend 2 movement points to choose a SMALL figure within 3 spaces in your line of sight. Push the chosen figure up to 3 spaces into a space adjacent to you."
- Impl: `data/ability-library.json:5397` (`wrist_cord` entry, `pushTargetWithinRange` family), driven by `src/game/abilities.js:321`. Costs 2 MP; once-per-round gate via `roundFigureAbilityUsed`.
- ✅ correct — wired as an MP-driven activation-time ability (not a Special Action; see `src/discord/components.js:1157` comment: "MP-based ability (e.g. Boba Fett's Wrist Cord) — not an action").

**Wrist Flamethrower** — "Once per round, you may spend 2 movement points to choose a space within 2 spaces. Each other figure on or adjacent to that space suffers 1 Damage and 1 Strain, then becomes Weakened."
- Impl: `data/ability-library.json` `wrist_flamethrower` entry (fixedAreaEffect family) + `src/game/abilities.js:3290, 3395` (deducts MP cost, applies damage/strain/Weaken to area). Once-per-round gate.
- ✅ correct — MP-driven, once-per-round; area-of-effect logic correctly excludes the source figure.

**EE-3 Carbine** — "When you declare an attack, you may spend 2 movement points to change one of your attack die to a red die. Limit once per attack."
- Impl: `src/handlers/combat.js:7077-7193` — `_postOnDeclareDieSwapPrompts` posts the EE-3 picker in step 1+2 attacker on-declare window (alongside Vanguard). MP-bank check (`>=2`) gates availability.
- ✅ correct — alexanbv-confirmed 2026-05-10 placement: declare-time die-swap, before token window.

---

## Bodhi Rook

**Smooth Landing** — "After Deployment, you and each adjacent friendly figure gains 1 movement point."
- Impl: `src/handlers/post-deploy.js` (post-deploy hook), `src/handlers/checkpoint.js` (resync remap), `src/handlers/move-x-handler.js` (recipient MP grant).
- ✅ correct — fires at post-deploy time; grants 1 MP to self + adjacent friendlies.

**Air Support** — "When a friendly figure spends a Power Token while attacking, apply +2 Accuracy to the attack results."
- Impl: `src/engine/activation-setup.js:903-906` — only announces the ability in the activation-setup message; **does not** post or wire the +2 Accuracy modifier at step-4-atk when a friendly spends a Power Token.
- ❌ wrong-stage — **announcement is also wrong**: the activation message text says *"After a friendly figure resolves an attack, if the target is in Bodhi's LOS, the target suffers 1 additional Damage."* That contradicts both the card (which is +2 Accuracy on power-token spend) AND the implementation (which appears absent). This is a real bug — both the announce-text and the modifier wiring need to be corrected.

---

## Bossk

**Special Action (Indiscriminate Fire)** — "Perform an attack. After this attack resolves, if it did not miss, choose 1 non-red attack die. Each other figure within 2 spaces of the target space other than the defender suffers Damage equal to the Damage results and Strain equal to the Surge results."
- Impl: `src/handlers/after-attack-fire.js:1668` → `fireIndiscriminateFire(thread, game, combat, effect, ctx)`. Old inline copy in `src/engine/combat-bridge.js:2653` is dead-coded (`if (false && …)`).
- ✅ correct — fires in the step-8 post-resolve fire pipeline (alexanbv-confirmed migration 2026-05-09). Non-red-die filter + within-2-spaces + exclude-defender all in `fireIndiscriminateFire`.

**Regenerate** — "At the end of each round, recover 2 Damage and discard all Harmful conditions."
- Impl: `src/handlers/round.js` (`regenerate_bossk` keyed; runs in end-of-round cleanup pass alongside other EoR effects).
- ✅ correct — fires at EoR; calls `healHp` (or equivalent) for 2 and `filterCondition` for each harmful condition.

---

## Batch 02 — Summary

- ✅ correct: 19
- ⚠️ suspicious: 6 (Stampede coupling to MASSIVE-only paths, Dirty Dealing validator hard-rejection, Bartered Info VP follow-up not enforced as button, Dual-Wield "may" presentation, Last Wielder SoR attach prompt, Bantha Stampede end-of-move coverage)
- ❌ wrong-stage / missing: 2 (BD-1 Terminal Slicing not wired; Bodhi Rook Air Support both announce-text + modifier wiring incorrect)
- — no impl: 0 (initial grep flagged some, but all ultimately found in ability-library.json or validation.js)

**Highest-priority bug surfaced this batch:** Bodhi Rook's **Air Support** is double-broken — the SoA announcement text describes a different ability (post-resolve +1 Damage in Bodhi's LoS) while the actual card grants +2 Accuracy on friendly power-token spend, and neither the announce-text nor the +2 Accuracy modifier is wired in step-4-atk. Worth opening a fix slice.

**Next:** Batch 03 (DCs C-* alphabetical, ~10 cards).
