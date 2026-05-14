# DC/CC Timing Audit — Manual Triage Batch 35

Scope: Command Cards alphabetical after "Fleet Footed", 10 cards:
Flurry of Blades, Focus, Fool Me Once, Forbidden Knowledge,
Force Drain, Force Illusion, Force Jump, Force Lightning, Force Push,
Force Rush.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Flurry of Blades

**Effect** — "Royal Guard Champion, cost 2, doubleActionSpecial. Perform 3 attacks."
- Impl: `Flurry of Blades` — NO src hits.
- — no impl — needs: (a) RGC only, (b) DOUBLE Action Special (2 actions), (c) 3 attacks: 1 paid + 2 free via freeAttackBonusPending counter (figkey-keyed post-2026-05-13), (d) no target restriction (vs Brutality / Multi-Fire which require different targets).

---

## Focus

**Effect** — "Any Figure, cost 1, specialAction. You become Focused."
- Impl: `Focus` keyed at 45 sites (very high — Focus is a core condition).
- ⚠️ suspicious — verify (a) Special Action (1 action), (b) apply Focus to self via applyCondition (immunity respected), (c) per-figure activation context (the activating figure becomes Focused, not whole group).

---

## Fool Me Once

**Effect** — "Any Figure, cost 0 (2 Strain), duringActivation. Return your opponent's Command discard pile to the game box. Then, if you are a SPY, draw 1 Command card."
- Impl: `Fool Me Once` keyed at 2 sites; `clearOpponentDiscard` ability per abilities.js:3843.
- ⚠️ suspicious — verify (a) "Cost: 2 Strain" — not VP, paid via applyStrain on FMO caster (Fireproof/Headhunter/Submit-or-Fight fire), (b) during-activation timing, (c) opponent's discard pile moved to game box (removed-from-game), (d) SPY-bonus: draw 1 CC if caster is SPY (count-only public log per privacy fix).

---

## Forbidden Knowledge

**Effect** — "Taron Malicos, cost 1, startOfActivation. Draw 1 Command card, then discard 1 or more Command cards from your hand. You recover 1 Damage, gain 1 movement point, and discard 1 HARMFUL condition for each card discarded."
- Impl: `Forbidden Knowledge` — NO src hits.
- — no impl — needs: (a) Malicos only, (b) SoA timing, (c) draw 1 CC (private hand-channel UI per privacy), (d) discard-N-from-hand picker (N ≥ 1; cards go to public discard pile), (e) per-discarded-card: recover 1 + gain 1 MP + filterCondition harmful picker (so 3 effects per discarded card), (f) recover via heal pipeline, MP via grantMovementBank (perFig-keyed).

---

## Force Drain

**Effect** — "Second Sister, cost 1, specialAction. Choose a hostile figure within 2 spaces. That figure suffers 3 Damage and becomes Stunned and Weakened. If that figure is a FORCE USER, you recover 3 Damage."
- Impl: `Force Drain` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Second Sister only, (b) Special Action (1 action), (c) range gate: path-2 hostile, (d) 3 Damage via standard pipeline + Stun + Weaken via applyCondition (immunity respected for each), (e) FORCE USER bonus: Second Sister recovers 3 Damage via heal pipeline if target has FORCE USER trait.

---

## Force Illusion

**Effect** — "FORCE USER, cost 2, whenHostileFigureInYourLineOfSightAttacking. The defender becomes Hidden."
- Impl: `Force Illusion` keyed at 3 sites.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) on-declare interrupt: hostile figure attacking + caster has LoS to attacker, (c) defender (NOT caster — the attack's defender) gains Hide via applyCondition (immunity respected), (d) interrupt timing: applies BEFORE attack resolves so Hide affects defense.

---

## Force Jump

**Effect** — "FORCE USER, cost 1, specialAction. Move up to 5 spaces. During this movement, you gain MOBILE. You cannot end your movement in a space that contains blocking or impassable terrain."
- Impl: `Force Jump` keyed at 2 sites.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) Special Action (1 action), (c) 5-space Move-X with bypassCosts (per alexanbv 2026-05-13), (d) MOBILE keyword temporarily added during this move (ignore-figures pass-through), (e) end-of-move validator: terminal space cannot be blocking/impassable (different from intermediate passes).

---

## Force Lightning

**Effect** — "IMPERIAL FORCE USER, cost 3, specialAction. Choose a hostile figure in your line of sight within 2 spaces. That figure and each figure adjacent to it suffers 2 Damage and becomes Stunned."
- Impl: `Force Lightning` keyed at 3 sites.
- ⚠️ suspicious — verify (a) IMPERIAL FORCE USER (Vader/Emperor/etc.), (b) Special Action (1 action), (c) target picker: hostile, path-2 range, LoS, (d) AoE: target + each figure adjacent to target (path-1 from target) suffer 2 Damage + Stun via applyCondition, (e) "each figure" — friendly inclusion? Card says "each figure" not "each hostile" — verify whether friendlies adjacent to target also get hit (probably yes per "each figure" literal reading).

---

## Force Push

**Effect** — "FORCE USER, cost 1, duringActivation. Choose another SMALL figure within 3 spaces. Push that figure up to 2 spaces."
- Impl: `Force Push` keyed at 5 sites.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) during-activation, (c) "another" excludes self (FP-caster cannot push self), (d) SMALL filter on target, (e) range gate: path-3 (LoS?), (f) push up to 2 spaces (player picks landing space, must be valid push path).

---

## Force Rush

**Effect** — "FORCE USER, cost 0, startOfActivation. Gain 2 movement points."
- Impl: `Force Rush` keyed at 2 sites.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) free cost, (c) SoA timing, (d) 2 MP via grantMovementBank (perFig-keyed) into the activator's bank, (e) per alexanbv 2026-05-13: in-activation MP grants go to bank.

---

## Batch 35 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 8
- ❌ wrong-stage: 0
- — no impl: 2 (Flurry of Blades, Forbidden Knowledge)

**Highest-priority items surfaced:**

1. **Flurry of Blades NO IMPL** — RGC 3-attack chain (1 paid + 2 free via freeAttackBonusPending counter).

2. **Forbidden Knowledge NO IMPL** — Malicos multi-discard chain: per card discarded → +1 effect of each (heal / MP / condition discard). Variable-N picker.

3. **Force Lightning "each figure adjacent"** — friendly inclusion is literal per "each figure". AoE including friendlies needs verification on the impl.

4. **Fool Me Once Strain cost via applyStrain pipeline** — 2 Strain cost runs through applyStrain so Fireproof/Headhunter/etc. fire. Different from VP cost.

5. **Force Jump end-space terrain constraint** — intermediate passes can cross blocking/impassable (via MOBILE), but FINAL space must not be blocking/impassable.

6. **Force Drain FORCE-USER-target bonus heal** — Second Sister recovers 3 only when target has FORCE USER trait. Conditional self-heal.

**Next:** Batch 36 (next 10 CCs after Force Rush).
