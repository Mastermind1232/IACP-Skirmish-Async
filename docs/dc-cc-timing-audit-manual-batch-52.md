# DC/CC Timing Audit — Manual Triage Batch 52

Scope: Command Cards alphabetical after "Toxic Dart", 10 cards:
Trandoshan Terror, Transmit the Plans, Triangulate, Unlimited Power,
Urgency, Utinni!, Vanish, Veteran Instincts, Whistling Birds,
Wild Attack.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Trandoshan Terror

**Effect** — "Bossk, cost 1, whenYouDeclareIndiscriminateFire. Add 1 yellow die to the dice pool."
- Impl: `Trandoshan Terror` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Bossk only, (b) trigger: when Bossk declares Indiscriminate Fire special, (c) +1 yellow die added to attackInfo.dice for THAT attack, (d) per-IF declare.

---

## Transmit the Plans

**Effect** — "Bodhi Rook, cost 0, specialAction. Distribute 2 Hit Tokens among friendly figures. If you are adjacent to a terminal, gain 2 VPs."
- Impl: `Transmit the Plans` keyed at 1 site.
- ⚠️ suspicious — verify (a) Bodhi only, (b) free cost, (c) Special Action (1 action), (d) distribute 2 Hit Tokens (=Damage type per alexanbv 2026-05-08) — sequential picker for 2 friendly figures (can stack), (e) adjacent-to-terminal bonus: +2 VP via awardObjectiveVp.

---

## Triangulate

**Effect** — "DROID, cost 1, specialAction. Up to 3 friendly DROIDS each move up to 1 space. Then choose a hostile figure within 5 spaces and line of sight. It suffers Damage equal to the number of those friendly DROIDS who have line of sight to it."
- Impl: `Triangulate` keyed at 2 sites.
- ⚠️ suspicious — verify (a) DROID playableBy, (b) Special Action (1 action), (c) picker: up to 3 friendly DROIDS, each gets 1-space Move-X (bypassCosts), (d) after moves resolve, hostile picker (path-5 + LoS from caster), (e) damage = count of those 3 DROIDS that have LoS to target after their moves, (f) standard pipeline.

---

## Unlimited Power

**Effect** — "Emperor Palpatine, cost 2, useWhenYouUseEmperor. Choose any other friendly figure on the map instead of another friendly figure within 4 spaces."
- Impl: `Unlimited Power` keyed at 2 sites; `unlimitedPowerActive` ROUND_NULL_FLAGS entry.
- ⚠️ suspicious — verify (a) Emperor Palpatine only, (b) trigger: when Emperor uses "Emperor" ability (his special), (c) range expansion: 4-space limit → any-friendly-on-map, (d) round-flag sets `unlimitedPowerActive[playerNum]`, (e) Emperor's grant-action ability reads the flag to skip distance gate.

---

## Urgency

**Effect** — "Any Figure, cost 0, specialAction. Gain a number of movement points equal to your Speed +2."
- Impl: `Urgency` keyed at 6 sites; `urgencyMustSpendAll` flag.
- ⚠️ suspicious — verify (a) free cost, (b) Special Action (1 action), (c) (Speed + 2) MP via grantMovementBank (perFig-keyed), (d) `urgencyMustSpendAll` — flag implies must use all granted MP? CRR check, (e) per alexanbv 2026-05-13 in-activation MP goes to bank.

---

## Utinni!

**Effect** — "Any Figure, cost 1, startOfRound. During this round, each friendly Jawa Scavenger gains +1 Speed, +1 Accuracy, and Surge: If you are attacking a figure, gain 1 VP."
- Impl: `Utinni!` keyed at 4 sites; `roundUtinniJawaBuffs` ROUND_NULL_FLAGS entry.
- ⚠️ suspicious — verify (a) SoR timing, (b) round-long buffs on all Jawa Scavengers in caster's army, (c) +1 Speed at movement-validator (when activating, base Speed treated as +1 for MP grant on Move action), (d) +1 Accuracy at step-4 attacker mod, (e) Surge injection: "+1 VP if attacking a figure" added to Jawa surge pool — note "if attacking a figure" is always true during attacks (vs objects?), so effectively unconditional +1 VP surge.

---

## Vanish

**Effect** — "Davith Elso, cost 2, specialAction. You cannot suffer Damage or receive conditions until your next activation. At the start of your next activation, gain 4 movement points."
- Impl: `Vanish` keyed at 6 sites; `vanishImmunityUntilNextActivation` flag.
- ⚠️ suspicious — verify (a) Davith only, (b) Special Action (1 action), (c) immunity-until-SoA flag: Davith blocks Damage application + condition application until SoA, (d) on Davith's next SoA: +4 MP grant via grantMovementBank (perFig-keyed) + flag cleared, (e) dc-play-area.js:2096+ has the Vanish bonus-MP detection logic per memory.

---

## Veteran Instincts

**Effect** — "Any Unique Figure, cost 1, duringActivation. Gain 1 Hit Token or Surge Token. Then, gain 1 Block Token or Evade Token."
- Impl: `Veteran Instincts` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Unique playableBy, (b) during-activation, (c) 2 pickers: first picker Hit/Surge (Damage/Surge PT type), second picker Block/Evade, (d) tokens via grantPowerTokens with max-cap, (e) per memory note: vetInstinctsActiveThisActivation was REMOVED (one-time grant, no persistent flag).

---

## Whistling Birds

**Effect** — "The Mandalorian, cost 2, specialAction. Move up to 2 spaces, then choose up to 3 figures within 2 spaces and roll 1 red die. Each of those figures suffers Damage equal to the Hit results."
- Impl: `Whistling Birds` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Mando only, (b) Special Action (1 action), (c) 2-space Move-X with bypassCosts, (d) after move resolves, picker: up to 3 figures within path-2 (friendly + hostile? — "any" target seemingly literal but probably hostile-only by intent), (e) 1 red die roll (shared), (f) per chosen figure: damage = Hit results via standard pipeline.

---

## Wild Attack

**Effect** — "Any Figure, cost 0, whenYouDeclareAttack. Add 1 red die to the attack pool and 1 white die to the defense pool."
- Impl: `Wild Attack` keyed at 3 sites.
- ⚠️ suspicious — verify (a) free cost, (b) on-declare-own-attack, (c) +1 red die to attackInfo.dice, (d) +1 white die to defenseInfo.dice (defender benefits too! — Wild Attack is a free CC but defender gets a bonus die).

---

## Batch 52 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Wild Attack defender-benefit** — caster pays 0 VP, adds red die to attack, BUT also +1 white die to defender's pool. Mutual buff/debuff balance.

2. **Triangulate post-move LoS recount** — after 3 DROIDs move, recount how many of THOSE specific 3 still have LoS to target. Multi-figure post-move state lookup.

3. **Unlimited Power range expansion** — Emperor's special action gets unlimited range while UP active. Verify Emperor handler reads the unlimitedPowerActive flag.

4. **Utinni! Surge VP grant** — Jawa Scavengers get "Surge: +1 VP if attacking a figure". When does the VP grant fire — at surge allocation or attack-resolve? Per-attack scope.

5. **Vanish damage + condition immunity** — Davith blocks Damage AND condition application until SoA. Verify both pipelines honor the flag.

6. **Whistling Birds target scope** — card says "up to 3 figures" without "hostile" qualifier. Friendly inclusion is literal but probably-not-intended.

**Next:** Batch 53 (next 10 CCs after Wild Attack).
