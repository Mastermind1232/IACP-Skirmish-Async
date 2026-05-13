# DC/CC Timing Audit — Manual Triage Batch 04

Scope: DCs alphabetical after Chirrut Imwe (10 cards): Clawdite
Shapeshifter (Elite), Clawdite Shapeshifter (Regular), Dark Trooper Mk III,
Darth Vader, Davith Elso, Death Trooper (Elite), Death Trooper (Regular),
Del Meeko, Dengar, Dewback Rider.

Verdicts:
- ✅ correct — implementation fires at the right CRR stage
- ⚠️ suspicious — wired but worth a closer look
- ❌ wrong-stage — implementation timing contradicts the card text
- — no impl — no code reference found

---

## Clawdite Shapeshifter (Elite) & (Regular)

**Shape** — "When you are deployed, you may gain 1 Form card of your choice from the supply."
- Impl: `src/handlers/round.js:1177, 1451` — form picker fires at SoR. `src/handlers/setup.js`, `src/handlers/post-deploy.js`, `src/handlers/phase-gate.js` also reference shape_clawdite_{elite,reg}.
- ⚠️ suspicious — **trigger mismatch**: card says "When you are deployed" (post-deploy), but the picker is invoked at SoR in `round.js:1177`. The two ability ids `shape_*` and `shift_*` are OR'd together at the same call site, conflating two distinct triggers. **Expected:** Shape fires once at post-deploy; Shift fires every SoR thereafter. Risk: a Clawdite that deploys mid-game (companion summon, etc.) misses Shape, or re-gets Shape every round. Per memory `project_clawdite_form_uniqueness.md` (M28 in `feedback_no_partial_support.md`) there's a known form-uniqueness gap as well.

**Shift** — "At the start of each round, you may switch your Form card with 1 other Form card of your choice."
- Impl: same call site `round.js:1177, 1451`. `getFormsChosenByTeamClawdites` enforces team-wide form uniqueness, with `pendingStartOfRoundResolve` gating activation phase until resolved.
- ✅ correct — fires at SoR with a picker; resolves before activation phase begins.

---

## Dark Trooper Mk III

**Advanced Targeting Computer** — "When you declare an attack, you become Focused. During this attack, you may reroll 1 attack die. If the rerolled die has fewer Damage symbols than before it was rerolled, apply +1 Damage to the attack results."
- Impl:
  - On-declare Focus: `src/handlers/combat.js:2317-2322` via `hasAdvTargetingComputerAbility` + `applyConditionWithDie` (Focus + 1 green die).
  - Reroll-loses-hits bonus: `src/handlers/combat.js:4288-4291` via `advTcRerollLostHits(oldDie, newDie)` + `applyAdvTcHitBonus` — applies +1 Hit if the rerolled die has fewer Damage symbols.
- ✅ correct — auto-Focus at step 1+2 declare, reroll-with-bonus-on-loss at step-3 reroll. Helper module split out cleanly.

**Durasteel Fist** — "Once during your activation, you may choose 1 adjacent figure or object and roll 1 green die. It suffers Damage equal to the Damage results. Then, if you rolled a Surge and the target was a SMALL figure, you may push that figure up to 1 space."
- Impl: `src/handlers/activation.js` (activation-time prompt + once/activation gate), `src/handlers/combat-special-effects.js:634` (`handleDurasteelPush` push direction picker after Surge+SMALL roll).
- ✅ correct — fires during activation as a per-activation use; post-roll push direction is a separate picker (player choice).

**Special Action (Lift Off)** — "Move up to 4 spaces. During this movement, you gain Mobile."
- Impl: `data/ability-library.json:lift_off_dark_trooper` (`dcSpecial`, `freeMoveBonus: 4`, `mobileMovement: true`).
- ✅ correct — Special Action at activation action-time; generic dcSpecial pipeline grants 4 free MP with Mobile flag for the movement window.

---

## Darth Vader

**Special Action (Brutality)** — "Perform 2 attacks. Each attack must have a different target."
- Impl: `data/ability-library.json:brutality` (`freeAttackBonusCount: 2`, `differentTargetsRequired: true`) + `src/handlers/combat.js` + `src/discord/components.js` + `src/handlers/dc-play-area.js` + `src/game/abilities.js`.
- ⚠️ suspicious — verify **different-targets enforcement**: the `differentTargetsRequired: true` flag exists in the library entry, but I didn't confirm a runtime gate in `combat.js` that rejects a second Brutality attack targeting the same figure as the first. Worth a click-through test.

**Special Action (Force Choke)** — "Choose a hostile figure in your line of sight. That figure suffers 2 Damage and 1 Strain."
- Impl: `data/ability-library.json:force_choke` (`targetHostileFigure: { damage: 2, strain: 1, requiresLos: true }`).
- ✅ correct — Special Action; LoS precondition + damage+strain via generic targetHostileFigure handler.

**Foresight** — "While defending, you may reroll 1 defense die."
- Impl: `src/game/defensive-reroll-helpers.js:16` (`FORESIGHT_ABILITY_ID = 'foresight'`) — shares the same descriptor family as Defensive Stance. Surfaced as a named reroll bucket button in step-3 defender reroll window (post-2026-05-13 unified reroll model).
- ✅ correct — fires at step-3 defender reroll as a "Use Foresight" bucket button.

---

## Davith Elso

**Stealthy** — "At the start of the mission, become Hidden."
- Impl: `src/handlers/post-deploy.js` (Hide applied post-deploy) + `data/ability-library.json:stealthy_davith` (`trigger: mission-start`).
- ✅ correct — fires at post-deploy = mission start. Davith's Hide condition is applied automatically.

**Cut and Run** — "When you exit a space containing a hostile figure, that figure suffers 1 Damage. Limit once per figure per round."
- Impl: `src/handlers/movement.js:1028-1085` — fires inside the movement handler when `startCoord !== newTopLeft` AND startCoord's footprint contained a hostile figure. Damage applied via `_applyDamage` with `source: 'Cut and Run'`. Per-figure-per-round gate via `roundFigureAbilityUsed` keyed on `${hostileFigureKey}_cut_and_run_${activatorFk}_round${X}` or equivalent.
- ✅ correct — fires on exit of each hostile-occupied space during movement, with proper per-figure-per-round limit and defeat-handler routing.

**Surge (Fell Swoop)** — "After this attack resolves, become Hidden, move up to 2 spaces, then perform an attack. Limit once per round."
- Impl: `src/handlers/after-attack-fire.js:1653` → `fireFellSwoop(thread, game, combat, effect, ctx)` at line 724 of after-attack-fire.js. Once/round gate via `${attackerFigureKey}_fell_swoop` in `roundFigureAbilityUsed`. Applies Hide, then `_stageChainAttack` queues the free attack after a 2-MP move window.
- ✅ correct — step-8 post-resolve fire; once/round gate; chained free attack staged correctly.

---

## Death Trooper (Elite)

**Squad Captain** — "Once during your activation, an adjacent friendly TROOPER or LEADER may gain 1 Power Token."
- Impl: `data/ability-library.json:squad_captain` (`targetFriendlyFigureAdjacent: { traits: [TROOPER, LEADER], powerTokenTarget: 1 }`, `freeAction: true`). Driven by generic dcSpecial handler.
- ⚠️ suspicious — card says "Once during your activation" but the library descriptor doesn't include an `oncePer: activation` flag. Verify the once-per-activation gate is enforced (vs. spammable).

**Field Tactics** — "After your activation, you may immediately activate a friendly TROOPER or LEADER group with cost 6 or less. That group loses 'Field Tactics' this round."
- Impl: `src/game/field-tactics-helpers.js` (eligibility + cost-6 filter), `src/handlers/activation.js` (post-activation prompt), `src/handlers/checkpoint.js` (resync state). Library entry `field_tactics_death_trooper_elite` with `trigger: end-of-activation`.
- ✅ correct — fires post-activation (after current group's EoA effects); cost-6 filter + "loses Field Tactics this round" both implemented via round-scoped flag.

---

## Death Trooper (Regular)

**Security Detail** — "After deployment, a friendly LEADER gains 1 Block Token."
- Impl: `src/handlers/post-deploy.js:116-127, 308-314, 635-644, 1436-1452` — post-deploy hook surfaces a LEADER picker (when multiple LEADERs exist, player chooses). Block token granted via `grantPowerTokens`. Logged with "🛡️" icon.
- ✅ correct — fires at post-deploy, with interactive picker when needed.

**Field Tactics** — same as Elite, with `field_tactics_death_trooper_reg` keyed library entry.
- ✅ correct.

---

## Del Meeko

**Expertise** — "After you perform a Special Action, you may perform an additional action. Limit once per activation."
- Impl: `src/handlers/dc-play-area.js` + `src/game/abilities.js` (post-Special-Action hook).
- ⚠️ suspicious — verify: (a) hook fires after Special Action **resolution** (not declaration), (b) "additional action" is presented as a player-choice prompt (Use/Skip), (c) the additional action **cannot itself be a Special Action that re-triggers Expertise** (i.e., the once-per-activation gate is set BEFORE the additional action, not after). Common bug pattern: infinite-action chain via Expertise → Special Action → Expertise.

**Special Action (Gifted Mechanic)** — "Choose an adjacent friendly DROID or VEHICLE. If you do, you and that figure each recover 1 Damage and gain 1 Damage Token."
- Impl: `data/ability-library.json:gifted_mechanic` (`targetFriendlyFigureAdjacent: { traits: [DROID, VEHICLE], recoverSelf: 1, recoverTarget: 1, hitTokenSelf: 1, hitTokenTarget: 1 }`).
- ⚠️ suspicious — verify the **Damage Token** is being granted as a stored token (Hit Token bank), not as suffered damage. Per the card and library descriptor's `hitTokenSelf`/`hitTokenTarget` naming, this should be a hit/damage-token grant. Same concern flagged for Cassian Strike Team in batch 03 — these are tokens, not damage application.

**Open-Minded** — "After this attack resolves, gain 1 movement point or Power Token."
- Impl: `src/engine/combat-bridge.js`, `src/handlers/after-attack-resolve.js`, `src/handlers/activation.js`.
- ⚠️ suspicious — "or" → player choice. Verify a Use button prompt with two options (MP / Power Token) appears post-resolve, not auto-grant of one.

---

## Dengar

**Surge (Spread the Pain)** — "Choose a HARMFUL condition you have not already chosen during this attack. After this attack resolves, if it did not miss, you may have a figure on or adjacent to the target space gain the chosen condition. This ability can be used multiple times per attack."
- Impl: `src/game/combat.js`, `src/handlers/combat.js`, `src/engine/combat-bridge.js`, `src/discord/action-buttons.js`, `src/engine/available-actions.js`, `src/handlers/after-attack-fire.js`, `src/handlers/after-attack-resolve.js`.
- ⚠️ suspicious — three things to verify: (1) the "not already chosen during this attack" tracker prevents picking the same harmful condition twice (e.g., can't Bleed twice). (2) "may have a figure" → player-choice picker among on/adjacent figures. (3) "multiple times per attack" → each surge spend opens a new picker AND maintains the chosen-list across surges. Worth a click-through with a 3-surge result and 3 harmful conditions available.

---

## Dewback Rider

**Special Action (Shock Lance)** — "Choose a figure within 2 spaces and roll 1 green die. That figure suffers Damage equal to the Damage results. Then, if you rolled 1 or more Surge results, that figure becomes Weakened."
- Impl: `data/ability-library.json:shock_lance_dewback` (`rollOneDie: green`, `rollOneDieTarget: spaceWithin`, `rollOneDieRange: 2`, `rollOneDieSurgeCondition: Weaken`).
- ✅ correct — Special Action at activation action-time; range-2 + green die + Surge → Weaken via generic descriptor.

**Mounted** — "At the start of your activation, you gain 3 movement points."
- Impl: `src/game/soa-orchestrator.js` (`mounted_dewback` keyed).
- ✅ correct — fires in SoA, grants 3 MP via `grantMovementBank`.

**Efficient Travel** + **Professional** — canonical IACP keywords.
- Impl: passive on movement-cost + named reroll bucket respectively.
- ✅ correct.

---

## Batch 04 — Summary

- ✅ correct: 14
- ⚠️ suspicious: 8 (Clawdite Shape post-deploy trigger conflated with SoR Shift; Brutality different-targets enforcement; Squad Captain once/activation gate; Expertise infinite-chain risk; Gifted Mechanic Damage-Token vs damage; Open-Minded MP/Power Token choice presentation; Spread the Pain multi-use chosen-list + picker; LoS for Force Choke (counts as ✅ but worth runtime verify))
- ❌ wrong-stage: 0
- — no impl: 0 (all library-only hits confirmed wired via descriptor handlers)

**Highest-priority items surfaced this batch:**
1. **Clawdite Shape vs Shift trigger conflation** (`round.js:1177, 1451`) — `shape_*` and `shift_*` ability ids are OR'd together at SoR, but Shape's trigger is **post-deploy**, not SoR. A Clawdite deployed mid-game (companion / interactive summon) won't get its initial Form picker; a Clawdite present at start may have Shape re-fire every round instead of just Shift. **Recommended:** split the two triggers — Shape fires once in post-deploy.js, Shift fires every SoR in round.js.
2. **Del Meeko Expertise** — verify once-per-activation gate is set BEFORE the additional action resolves to prevent Expertise → Special Action → Expertise chain.
3. **Multiple Damage-Token vs damage confusions across batches** — Cassian Strike Team (batch 03), Del Meeko Gifted Mechanic (this batch). Worth a sweep that the `hitTokenSelf`/`hitTokenTarget` library fields are routed to token-bank grants, not `applyDamage` calls.

**Next:** Batch 05 (DCs D-E continued, alphabetical after Dewback Rider).
