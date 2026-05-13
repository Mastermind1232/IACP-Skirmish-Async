# DC/CC Timing Audit — Manual Triage Batch 09

Scope: DCs alphabetical after J4X-7, 10 cards: Jabba the Hutt, Jarrod
Kelvin, Jawa Scavenger (Elite), Jawa Scavenger (Regular), Jet Trooper
(Elite), Jet Trooper (Regular), Junk Droid, Jyn Erso, Jyn Odan, K-2S0.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Jabba the Hutt

**Special Action (Bully)** — "A figure of your choice within 3 spaces suffers 3 Damage."
- Impl: `data/ability-library.json:bully_jabba` (`targetHostileFigure: { damage: 3, range: 3 }`).
- ❌ wrong-stage — **target filter is wrong**. Card says "**a figure of your choice**" — that's ANY figure (friendly OR hostile). Library descriptor uses `targetHostileFigure` which restricts to enemies only. Per canonical IACP (Jabba's flavor — he bullies his own minions too), the picker must include friendly figures within 3.

**Special Action (Incentivize)** — "An elite figure of your choice becomes Focused."
- Impl: `src/game/abilities.js:1432-1442` (`incentivize_jabba` keyed) — picker for elite figures, applies Focus.
- ⚠️ suspicious — verify (a) **"elite figure of your choice"** is ANY elite (friendly + hostile + NPC); per IACP convention this should be unbounded, no range limit. (b) Elite filter checks the DC's "Elite" trait (typically the DC name includes "(Elite)").

**Special Action (Scheme)** — "Draw 1 Command card."
- Impl: `src/game/abilities.js:1423-1429` — draws 1 CC; logs "Scheme — Drew 1 Command card."
- ✅ correct.

**Double Action Special (Order Hit)** — "Spend 2 VPs. An elite figure of your choice may interrupt to perform an attack. Then, it gains 2 movement points."
- Impl: `data/ability-library.json:order_hit_jabba` — `chooseFriendlyToFocus: true`, `choiceRequiresElite: true`, `autoDeductVp: 2`, `grantFreeAttackToTarget: true`, `grantMpToTarget: 2`. Double Action.
- ⚠️ suspicious — descriptor has `chooseFriendlyToFocus: true` BUT the card grants a free attack + 2 MP, NOT Focus. Verify the `chooseFriendlyToFocus` flag doesn't apply Focus as a side effect (might be a copy-paste from Bartered Information). Also verify (a) VP deduction is unconditional (auto-deducts before the attack); (b) the elite figure is any elite (friend/foe — but in practice friendly elites because hostile interrupts wouldn't make sense for Jabba's "Order"); (c) double-action cost consumes both actions.

**Nefarious Gains** — "When a hostile figure is defeated, gain 1 VP."
- Impl: `src/game/damage-pipeline-hooks.js`, `src/engine/defeat-handler.js`, `src/game/vp-helpers.js`. WHEN_DEFEATED hook.
- ✅ correct — source-agnostic VP grant on hostile defeat.

---

## Jarrod Kelvin

**Special Action (Leaping Slash)** — "Move up to 2 spaces, then perform an attack."
- Impl: `data/ability-library.json:leaping_slash` (`freeMoveBonus: 2`, `freeAttackBonus: true`) + `src/handlers/move-x-handler.js`.
- ✅ correct — Special Action: 2 free MP via pendingMoveX, then free attack via `freeAttackBonusPending`.

**Droid Master** — "At the start of a mission, put J4X-7 into play in an adjacent space. J4X-7 activates at the start or end of your activation. J4X-7 is not counted for the purposes of control."
- Impl: `src/game/abilities.js`, `src/game/board-helpers.js:114` (J4X-7 excluded from control counting under the name "Jarrod Kelvin"-affiliated lookup).
- ⚠️ suspicious — verify (a) J4X-7 auto-deploys to a space adjacent to Jarrod at mission start (post-deploy hook), (b) "start or end of your activation" is a player-choice picker for J4X-7's activation timing (similar to Iden's ID10 — flagged for verification in batch 08).

---

## Jawa Scavenger (Elite)

**Surge (Bargain)** — "Spend 1 VP to roll 1 green die. For each Damage result, gain 1 VP."
- Impl: `src/game/combat.js`, `src/game/abilities.js`, `src/handlers/combat.js`.
- ⚠️ suspicious — verify (a) the "spend 1 VP" is an actual VP deduction (game.player1VP.total -= 1 or via deductVp helper); (b) "for each Damage result" awards 1 VP per Damage symbol on the green die (max 1 since green has at most 1 dmg face); (c) Bargain is a "may" surge — player chooses Use/Skip (need a button if eligible, since spending 1 VP for ≤1 expected VP is a gamble).

**Take Cover** — "While defending, you may apply +1 Block and -1 Evade to the defense results."
- Impl: `src/game/take-cover-jawa-helpers.js` (shared with Regular Jawa). Step-4 defender modifier.
- ⚠️ suspicious — verify (a) "may apply" → Use/Skip button (player choice — sometimes +1 Block / -1 Evade is bad). (b) Applied as a paired modifier (both or neither).

**Scavenged Stock** — army-build rule, +3 DROIDs from any affiliation.
- Impl: `data/ability-library.json:scavenged_stock_jawa_elite` (descriptor) + `validateArmyAffiliation` per library description.
- ✅ correct (army-build validator).

---

## Jawa Scavenger (Regular)

**Surge (Harass)** — "After the attack resolves, if it did not miss, the defender suffers 1 Strain."
- Impl: `src/game/combat.js` (`surgeHarassStrain` flag set when surge spent); `src/engine/combat-bridge.js` consumes at step 8.
- ✅ correct — step-8 post-resolve fire; routes through `applyStrain` per memory updates.

**Take Cover** — shared with Elite, see above.
- ⚠️ suspicious (same as Elite).

---

## Jet Trooper (Elite)

**Agile** — "While defending, you may convert 1 Block to 1 Evade."
- Impl: `src/game/agile-jet-trooper-helpers.js` + `src/handlers/combat.js`. Shared with Regular variant via `agile_jet_trooper_elite` / `agile_jet_trooper_reg` ids.
- ⚠️ suspicious — verify (a) "may convert" → player choice (not auto), (b) requires at least 1 Block in the rolled defense results to convert (can't convert from nothing), (c) fires in step-4 defender mods window.

**Fly-By** — "When you declare an attack, if the target space is within 2 spaces, add 1 blue die to your attack pool. After the attack resolves, gain 2 movement points."
- Impl:
  - Declare-time +1 blue die: `src/handlers/combat.js:1574-1579` — gated on `target.dist <= 2`.
  - Post-attack 2 MP: `src/engine/combat-bridge.js:962-969` — gated on `combat.distanceToTarget <= 2`.
- ⚠️ suspicious — verify both conditions use the SAME distance (target.dist vs combat.distanceToTarget) consistently. Also: card has no "may" clause — both effects fire unconditionally if within 2.

---

## Jet Trooper (Regular)

**Agile** — same as Elite.

**Jets** — "After you resolve an attack, if the target space is within 2 spaces, gain 1 movement point."
- Impl: `src/engine/combat-bridge.js:971-977`, `src/handlers/after-attack-resolve.js`.
- ✅ correct — step-8 post-resolve; range-2 gate; +1 MP via grantMovementBank.

---

## Junk Droid

- No specialAbilityIds. Passive `+1 damage`. No abilities to audit.
- ✅ correct (no-op DC, passive-only).

---

## Jyn Erso

**Trust Goes Both Ways** — "At the start or end of your activation, choose an adjacent friendly figure. If you do, you and that figure Recover 1 Damage and gain 1 Surge Token. Limit once per round."
- Impl: `src/game/soa-orchestrator.js:670-685` (SoA picker), `src/game/eoa-orchestrator.js` (EoA picker), `src/engine/activation-setup.js`, `src/handlers/soa-handler.js`, `src/handlers/eoa-handler.js`. Once-per-round via `roundFigureAbilityUsed[trustBothWays_<msgId>]`.
- ✅ correct — both timing options wired; once-per-round shared between SoA and EoA so the player can pick either timing per round but not both.

**Special Action (Tonfa Strike)** — "Move up to 2 spaces, then you may perform a Melee attack using 1 red and 1 green die. Then you may perform an attack."
- Impl: `src/handlers/after-attack-fire.js`, `src/handlers/after-attack-resolve.js`, `src/game/abilities.js`, `src/handlers/move-x-handler.js`.
- ⚠️ suspicious — verify (a) "Move up to 2 spaces" via pendingMoveX picker (2 MP, terrain costs apply), (b) "**you may**" perform the special attack — Use/Skip button, (c) **special attack uses 1 red + 1 green die** (override attack pool), Melee only, (d) "Then you may perform an attack" — a SECOND free attack option (with Jyn's normal attack pool). The two-attack sequence is unusual; confirm both attacks are presented as separate choices.

---

## Jyn Odan

**Hair Trigger** — "At the start of a hostile figure's activation, you may interrupt to perform an attack that targets that figure. Limit once per round."
- Impl: `src/game/soa-orchestrator.js:395-405` (descriptor at hostile activation start), `src/engine/activation-setup.js`, `src/handlers/soa-handler.js`, `src/handlers/activation.js`. Per-figure-per-round dedupe via `id: hair_trigger:<jynMsgId>-><msgId>:f<figureIndex>`.
- ✅ correct — fires at hostile SoA; multi-figure-aware dedupe; once-per-round gate.

**Sidewinder** — "After you resolve an attack, you may suffer 1 Strain to move up to 2 spaces. Limit once per round."
- Impl: `src/handlers/after-attack-fire.js:902-920` (`fireSidewinder`) + `src/handlers/combat-special-effects.js` (Use/Skip handler). Once-per-round via `<attackerFigureKey>_sidewinder` in `roundFigureAbilityUsed`.
- ✅ correct — step-8 post-resolve fire; Use/Skip button to attacker; Strain via applyStrain pipeline.

**Cunning** — shared `cunning_*` family with Han Solo / Nexu (see batch 07).
- ✅ correct.

---

## K-2S0

**Vague and Unconvincing** — "While defending, your player and your opponent cannot spend power tokens or play Command cards."
- Impl: `src/handlers/combat.js:7291-7295` — sets `combat.vagueAndUnconvincing = true` when K-2S0 is the defender. Token-spend gates check this flag (skipping the cohesion + token windows).
- ⚠️ suspicious — verify the flag actually blocks (a) **both players** from spending power tokens (own AND opponent's), (b) **both players** from playing CCs during this attack. CC-play guard is more complex; check `getPlayableReactionCardsForTiming` / cc-timing.js for the flag's effect.

**Cassian Said I Had To** — "Once per round, when a friendly LEADER enters an adjacent space, gain up to 1 Damage Token."
- Impl: `src/handlers/movement.js:1322-1336` — fires on friendly LEADER move-end into a K-2S0-adjacent space; per-round per-figure gate `cassian_said_i_had_to_<fk>`; grants 1 Damage Token via grantPowerTokens.
- ⚠️ suspicious — verify (a) "**up to 1**" → player choice (Use/Skip) — current impl auto-grants the token. Card's "**may** gain up to 1" → optional. (b) `cassian_said_i_had_to_<fk>` keys per-K-2S0-figure (correct since K-2S0 is a unique companion).

**Special Action (Continually Unexpected)** — "If you have any combination of 2 Damage Tokens or 2 Surge Tokens, perform a Ranged attack using your attack pool."
- Impl: `src/game/abilities.js:1784-1810+` (`continually_unexpected` keyed). Checks `hitCount >= 2 || surgeCount >= 2` for Damage/Surge tokens on K-2S0's figure.
- ⚠️ suspicious — **ambiguity in card text**: "any combination of 2 Damage Tokens or 2 Surge Tokens" — could mean (a) "2 Damage tokens, OR 2 Surge tokens" (each type independent — current impl), OR (b) "2 of any combination — e.g., 1 Damage + 1 Surge = 2". If (b), impl undercount. Worth canonicalizing against `vassal_extracted/images/K-2S0*`.

---

## Batch 09 — Summary

- ✅ correct: 10
- ⚠️ suspicious: 13
- ❌ wrong-stage: 1 (Jabba Bully target filter — `targetHostileFigure` excludes friendly figures the card explicitly allows)
- — no impl: 0

**Highest-priority items surfaced this batch:**

1. **Jabba Bully target filter** — descriptor `targetHostileFigure` restricts to enemies, but card says "**a figure of your choice**" (any side). Need to broaden to `targetAnyFigure` or equivalent. Same pattern as Emperor Palpatine's Tempt (flagged batch 06 as ✓ correct because impl was unrestricted — Bully should mirror).

2. **Jabba Order Hit `chooseFriendlyToFocus` flag** — descriptor mentions `chooseFriendlyToFocus: true` but card grants a free attack + 2 MP, NOT Focus. If the generic handler honors the flag, an unwanted Focus may apply. Recommend a click-through trace to confirm.

3. **K-2S0 Continually Unexpected token-count semantics** — "any combination of 2 Damage or 2 Surge" — current impl reads "2 of either type" (independent), but card text may mean "2 of any combo (Damage + Surge inclusive)". Card-image canonicalization needed.

4. **K-2S0 Cassian Said I Had To "may" auto-grants** — currently grants 1 Damage Token automatically when a friendly LEADER moves adjacent. Card says "**may** gain up to 1" → should be a player-choice Use/Skip prompt.

5. **Jawa Bargain VP gamble** — verify the surge is a "may" prompt (player chooses Use/Skip), not auto-spent (since spending 1 VP for ≤1 expected VP can be net-negative).

**Next:** Batch 10 (DCs alphabetical after K-2S0).
