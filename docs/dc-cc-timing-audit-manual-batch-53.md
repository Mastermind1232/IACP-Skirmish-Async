# DC/CC Timing Audit — Manual Triage Batch 53 (FINAL BATCH)

Scope: Command Cards alphabetical after "Wild Attack", 7 cards
(final batch — only 7 cards remaining in cc-effects.json):
Wild Fire, Wild Fury, Windfall, Wookiee Rage, Worth Every Credit,
Wreak Vengeance, You Will Not Deny Me.

**🎉 AUDIT CAMPAIGN COMPLETE 🎉**
This batch closes the manual triage audit of the entire IACP card set:
- 175 Deployment Cards (batches 7-18)
- ~50 Skirmish Upgrades (batches 18-24)
- 292 Command Cards (batches 24-53)
- = **517+ unique cards audited** across 47 batch documents

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Wild Fire

**Effect** — "CT-1701, cost 1, whenYouDeclareAttack. Remove up to 2 dice of your choice from the defense pool."
- Impl: `Wild Fire` keyed at 3 sites.
- ⚠️ suspicious — verify (a) CT-1701 only, (b) on-declare-own-attack, (c) picker: up to 2 defense dice (player picks 0-2 dice to remove from defenseInfo.dice), (d) removed dice are not rolled.

---

## Wild Fury

**Effect** — "CREATURE or WOOKIE, cost 2, duringActivation. You become Focused and may perform multiple attacks during this activation. At the end of your activation, become Stunned and Bleeding."
- Impl: `Wild Fury` keyed at 6 sites.
- ⚠️ suspicious — verify (a) CREATURE/WOOKIEE playableBy, (b) during-activation, (c) Focus applied via applyCondition, (d) attack-cap bypass: figure can attack multiple times in this activation (bypasses attackPerformedThisActivation gate which is figkey-keyed post-2026-05-13), (e) EoA: Stun + Bleeding applied via applyCondition (immunity respected per condition — could be partially blocked), (f) `postActivationConditions` figkey-keyed flag (migrated 2026-05-13) carries the conditions to apply at activation end.

---

## Windfall

**Effect** — "Doctor Aphra, cost 0, whenCommandCardDiscardedFromHandOrDeck. Gain VPs equal to that card's cost. When this card is discarded from your hand or deck, gain 1 VP."
- Impl: `Windfall` keyed at 5 sites; `windfallActive` ROUND_NULL_FLAGS entry.
- ⚠️ suspicious — verify (a) Doctor Aphra only, (b) free cost, (c) trigger: any CC discarded from Aphra's hand OR deck (Headhunter / Bleeding / Strategize / Submit or Fight / etc.), (d) +N VP where N = discarded card's cost via awardObjectiveVp, (e) PASSIVE: when Windfall ITSELF is discarded, +1 VP, (f) `windfallActive` flag keeps the discard-trigger alive across multiple discard events in a round.

---

## Wookiee Rage

**Effect** — "WOOKIEE, cost 2, specialAction. Choose up to 3 hostile figures adjacent to you. Each chosen figure suffers 1 Damage for each Damage you have suffered, to a maximum of 3 Damage."
- Impl: `Wookiee Rage` keyed at 2 sites.
- ⚠️ suspicious — verify (a) WOOKIEE playableBy, (b) Special Action (1 action), (c) damage-suffered lookup: caster's current Damage taken (maxHp - currentHp), capped at 3, (d) picker: up to 3 hostile adjacent (path-1), (e) per chosen figure: N Damage where N = min(caster's damage, 3) via standard pipeline.

---

## Worth Every Credit

**Effect** — "SCUM, cost 2, duringActivation. Discard 1 HARMFUL condition and gain 2 movement points. When the next hostile figure is defeated during this activation, gain 2 VPs."
- Impl: `Worth Every Credit` keyed at 3 sites.
- ⚠️ suspicious — verify (a) SCUM affiliation, (b) during-activation, (c) filterCondition picker for 1 harmful + 2 MP via grantMovementBank (perFig-keyed), (d) hook: next hostile defeat during caster's activation → +2 VP, (e) flag clears at EoA if no defeat happened, (f) `nextHostileDefeatVpBonus` ROUND_OBJECT_FLAGS entry tracks the bonus.

---

## Wreak Vengeance

**Effect** — "Maul, cost 1, useWhenYouUseDualBladedFury. Choose both effects instead of only 1."
- Impl: `Wreak Vengeance` keyed at 3 sites; `wreakVengeanceActive` ROUND_NULL_FLAGS entry.
- ⚠️ suspicious — verify (a) Maul only, (b) trigger: when Maul plays Dual-Bladed Fury (another CC), (c) modifier: Maul gets BOTH effects of Dual-Bladed Fury instead of picking 1, (d) `wreakVengeanceActive` flag set; consumed when Dual-Bladed Fury resolves.

---

## You Will Not Deny Me

**Effect** — "Fifth Brother, cost 2, other. When discarded, place on Fifth Brother's DC. Cannot be defeated. Ignore your Harmful conditions. When a hostile figure is defeated, recover 2 Damage and return this card to game box."
- Impl: `You Will Not Deny Me` keyed at 6 sites; `youWillNotDenyMeActive` ROUND_NULL_FLAGS entry.
- ⚠️ suspicious — verify (a) Fifth Brother only, (b) trigger: card discarded from hand OR deck, (c) auto-attach to 5B's DC (permanent attachment), (d) defeat-immunity: BEFORE_DEFEATED hook cancels defeat for 5B while YWNDM active, (e) condition-ignore: 5B's harmful conditions have no effect (still applied but ineffective per memory note YWNDM-on-Fifth-Brother: "condition effects are suppressed (token placed but inert), so the Stun does not actually block declaration"), (f) WHEN_DEFEATED hook on hostile: 5B recovers 2 Damage via heal pipeline + return YWNDM to game box (removed from game).

---

## Batch 53 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 7
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Wild Fury attack-cap bypass + EoA conditions** — multiple attacks during activation requires bypassing attackPerformedThisActivation (figkey-keyed). Post-activation Stun + Bleeding via postActivationConditions.

2. **Windfall VP-on-any-discard cascade** — fires on every CC discard from Aphra's hand/deck during the round. Each discard checks Windfall is active + grants VP equal to cost. Self-discard grants +1 VP separately.

3. **You Will Not Deny Me** triple-effect attachment: defeat-immunity + condition-ignore (suppress effects, not application) + heal-on-hostile-defeat + return-to-game-box. Multi-state attachment.

4. **Wreak Vengeance** modifier-CC pattern (modifies another CC's effects). Verify the flag is consumed correctly when Dual-Bladed Fury resolves.

5. **Worth Every Credit next-defeat-VP** — `nextHostileDefeatVpBonus` flag tracks bonus across the activation. Flag must clear at EoA if no defeat.

6. **Wookiee Rage damage-by-suffered scaling** — damage dealt = min(caster's current damage, 3). Scaling with own wounds.

---

## 🎉 Audit Campaign Closure 🎉

**Coverage:** 175 DCs + ~50 SUs + 292 CCs = 517+ unique cards audited.

**Tally totals** (rough aggregation across batches 7-53):
- ✅ correct: ~20-25 (mostly recently-migrated flags from the alexanbv 2026-05-13 audit)
- ⚠️ suspicious: ~430 (the vast majority — flagged for full destruct click-through verification)
- ❌ wrong-stage: 0 (no glaring stage-order bugs surfaced)
- — no impl: ~35-40 (gaps identified for future implementation work)

**Cron job `458f6f83` should now be cancelled** since no further batches exist.

**Notable patterns identified across the campaign:**
1. **Per-figureKey migrations (alexanbv 2026-05-13)** — ~16 flags migrated to ACTIVATION_FIGKEY_FLAGS, plus the perFig nested structure for movementBank. Closes the multifig-correctness gap.
2. **Privacy fixes (alexanbv 2026-05-13)** — Command card draws/reveals through `apply-ability-result.js` log count-only by default; explicit "reveal" cards (Black Market SU, Devotion, Channel the Force, Wookiee Avenger Debts Repaid, etc.) keep name in public log per card text exception.
3. **Object-damage pipeline (alexanbv 2026-05-10)** — AoE effects on objects (Rubble placement, Boulder Barrage, Crush, Whistling Birds, Set the Charges, Bladestorm, Heavy Fire, Reduce to Rubble, etc.) route through the unified figure-or-object damage handler.
4. **BEFORE_DEFEATED hook chain (2026-05-08 rewrite)** — Last Resort, Strike Me Down, Dying Lunge, Final Stand, Miracle Worker, Preservation Protocol, Second Chance, You Will Not Deny Me all participate in the defeat-prevention pipeline.
5. **NO IMPL gaps** (~35-40 cards) — most are niche unique-character CCs that haven't been wired yet. Highest-priority NO IMPLs flagged across batches:
   - Armed Escort, Cal's Buddy, Eerie Visage, Eyes on the Prize, Explosive Weaponry, Feint, Flurry of Blades, Forbidden Knowledge, Glory of the Kill, Grisly Contest, Hard to Hit, Heavy Ordnance, Heightened Reflexes, Jump Jets, Karabast!, Mandalorian Tactics, Rally the Troops, Take it Down, Deathblow, [A New Hope] (SU), [Smuggling Compartment] (SU)

**Next session(s):** triage the NO IMPL list for priority implementation; spot-check the suspicious flags via live game playthrough.

— Audit campaign complete. Cron job can now be cancelled.
