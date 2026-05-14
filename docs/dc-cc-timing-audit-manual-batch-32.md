# DC/CC Timing Audit — Manual Triage Batch 32

Scope: Command Cards alphabetical after "Disorient", 10 cards:
Double or Nothing, Draw!, Droid Mastery, Dying Lunge, Eerie Visage,
Efficient Travel, Element of Surprise, Elusive, Emergency Aid,
Endless Reserves.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Double or Nothing

**Effect** — "SMUGGLER, cost 2, duringAttack. Choose a die. That die's controller rerolls it. If the rerolled result has the same number of symbols as the original roll, you may double or cancel its results."
- Impl: `Double or Nothing` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) during-attack, (c) picker: any die (attack or defense pool), (d) forced reroll for that die's controller, (e) symbol-count comparison: rolled-face's total symbol count (Hit + Surge + Accuracy + Block + Evade + Dodge) before vs after, (f) if equal, DoN player picks: double the symbols OR cancel (set to blank), (g) symbol-count semantic — verify this is total icons not per-icon-type match.

---

## Draw!

**Effect** — "Vinto Hreeda, cost 1, duringActivation. Perform an attack without using an action."
- Impl: `Draw!` keyed at 1 site.
- ⚠️ suspicious — verify (a) Vinto only, (b) during-activation, (c) free attack via freeAttackBonusPending (figkey-keyed post-2026-05-13), (d) standard attack pool (no overrides).

---

## Droid Mastery

**Effect** — "Jarrod Kelvin, cost 0, duringActivation. J4X-7 becomes Focused, then may interrupt to perform an attack. If it is not in play, put J4X-7 into play in your space instead."
- Impl: `Droid Mastery` keyed at 1 site.
- ⚠️ suspicious — verify (a) Jarrod Kelvin only, (b) during-Jarrod-activation, (c) branch: J4X-7 in play → apply Focus to J4X-7 + grant free interrupt attack, (d) branch: J4X-7 not in play → deploy J4X-7 to Jarrod's space (skip Focus + attack effects), (e) free attack timing: J4X-7 interrupts current activation to attack.

---

## Dying Lunge

**Effect** — "Any Figure, cost 2, other. Use when you have suffered Damage equal to your Health, before you are defeated. Move up to 2 spaces, then perform a Melee attack. Then, you are defeated."
- Impl: `Dying Lunge` keyed at 7 sites; `pendingDyingLunge` flag.
- ⚠️ suspicious — verify (a) BEFORE_DEFEATED hook (per the 2026-05-08 defeat-timing rewrite), (b) Use/Skip prompt to dying figure's owner, (c) Use: 2-space Move-X with bypassCosts, (d) free Melee attack with `pendingOverrideAttackDice` (figkey-keyed post-2026-05-13) for type=melee, (e) `selfDefeatsAfterAttackMsgId` figkey-keyed flag → figure defeated AFTER attack resolves, (f) standard attack pool with type override.

---

## Eerie Visage

**Effect** — "0-0-0, cost 1, specialAction. Each hostile figure with line of sight to you suffers 1 Strain and becomes Weakened."
- Impl: `Eerie Visage` — NO src hits.
- — no impl — needs: (a) 0-0-0 only, (b) Special Action (1 action), (c) iterate ALL hostile figures + LoS check from 0-0-0, (d) per hostile: 1 Strain via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire) + Weaken via applyCondition (immunity respected).

---

## Efficient Travel

**Effect** — "Any Figure, cost 1, startOfRound. Until the end of the round, each of your figures ignores additional movement point costs for difficult terrain and hostile figures."
- Impl: `Efficient Travel` keyed at 5 sites; `roundEfficientTravel` flag in ROUND_OBJECT_FLAGS.
- ⚠️ suspicious — verify (a) SoR timing, (b) round-long effect, (c) ALL friendly figures (for ET-player) get the passive at movement-validator: terrain costs +0 and hostile pass-through cost +0, (d) round-end revert.

---

## Element of Surprise

**Effect** — "Any Figure, cost 0, whenYouDeclareAttack. If the target figure did not have line of sight to you at the start of your activation, remove 1 die from its defense pool."
- Impl: `Element of Surprise` keyed at 9 sites.
- ⚠️ suspicious — verify (a) free cost, (b) on-declare, (c) LoS check: defender's position at start-of-attacker's-activation vs current attacker position — needs `activationStartPositions[attackerFigureKey]` + reverse-LoS from defender, (d) Use: remove 1 defense die from pool (player picks color?).

---

## Elusive

**Effect** — "SPY, cost 1, whileDefending. Choose 1 attack die and remove all symbols on the chosen die from the attack results. Then, remove all symbols on a defense die from the defense results."
- Impl: `Elusive` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) defender-side mid-attack, (c) picker: 1 attack die from pool (set to blank), (d) THEN picker: 1 defense die from own pool (set to blank — net effect is sacrificing a defense die to nullify an attack die), (e) order is forced: attack die first, then defense die.

---

## Emergency Aid

**Effect** — "Any Figure, cost 2, specialAction. Choose an adjacent figure. That figure recovers 2 Damage. If you are a GUARDIAN or LEADER, that figure recovers an additional 1 Damage."
- Impl: `Emergency Aid` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Special Action (1 action), (b) picker: adjacent FRIENDLY figure? — card says "adjacent figure", might include any (including hostile?). CRR check, (c) recover 2 Damage via standard heal pipeline, (d) +1 bonus if EA-player has GUARDIAN or LEADER trait.

---

## Endless Reserves

**Effect** — "General Weiss, cost 2, specialAction. Choose a defeated friendly TROOPER and place it in an empty space adjacent to another figure in its group. Then, shuffle this card back into your Command deck."
- Impl: `Endless Reserves` keyed at 1 site.
- ⚠️ suspicious — verify (a) Weiss only, (b) Special Action (1 action), (c) picker: defeated friendly TROOPER figure, (d) place picker: empty space adjacent to ANOTHER figure in the SAME group as the chosen defeated figure (NOT adjacent to Weiss — adjacent to a still-alive groupmate), (e) revive at full HP, (f) shuffle ER back into Command deck (not discard).

---

## Batch 32 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Eerie Visage)

**Highest-priority items surfaced:**

1. **Eerie Visage NO IMPL** — AoE-LoS Strain + Weaken on hostile figures with LoS to 0-0-0.

2. **Double or Nothing symbol-count match** — total icon count comparison (Hit + Surge + Acc + Block + Evade + Dodge) before vs after reroll. Equal → double or cancel picker.

3. **Element of Surprise reverse-LoS-from-SoA** — checks defender's LoS to attacker at attacker's SoA (using activationStartPositions). Multi-axis state lookup.

4. **Dying Lunge BEFORE_DEFEATED + Move-X + attack chain** — already wired per memory notes. Verify the figkey-keyed pendingOverrideAttackDice + selfDefeatsAfterAttackMsgId flow.

5. **Endless Reserves revive adjacent to groupmate** — placement constraint is "adjacent to ANOTHER figure in its group", not adjacent to Weiss. Group-aware placement picker.

6. **Droid Mastery branch** — Jarrod Kelvin's J4X-7 conditional: in-play → Focus + free attack; not-in-play → deploy only.

**Next:** Batch 33 (next 10 CCs after Endless Reserves).
