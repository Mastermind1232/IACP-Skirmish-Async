# DC/CC Timing Audit — Manual Triage Batch 30

Scope: Command Cards alphabetical after "Dangerous Bargains", 10 cards:
Dangerous Prey, Dark Energy, Data Theft, De Wanna Wanga, Deadeye,
Deadly Precision, Deathblow, Debts Repaid, Definition: 'Love',
Deflection.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Dangerous Prey

**Effect** — "Fennec Shand, cost 1, afterAttackTargetingYouResolved. If you are within 4 spaces of the attacker, the attacker suffers 1 Damage (3 Damage if you are adjacent). Then, move up to 2 spaces."
- Impl: `Dangerous Prey` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Fennec Shand only, (b) post-attack-against-self trigger, (c) range gates: path-1 → 3 Damage, path-2 to path-4 → 1 Damage, > path-4 → no fire, (d) attacker takes Damage via standard pipeline, (e) Fennec 2-space Move-X (bypassCosts per alexanbv 2026-05-13).

---

## Dark Energy

**Effect** — "IMPERIAL FORCE USER, cost 1, duringActivation. Choose another SMALL figure within 3 spaces. Push that figure up to 1 space, then it suffers 1 Damage."
- Impl: `Dark Energy` keyed at 2 sites.
- ⚠️ suspicious — verify (a) IMPERIAL FORCE USER playableBy (Vader/Emperor/etc.), (b) during-activation, (c) picker: SMALL figures within path-3 (excludes self via "another"), (d) 1-space push picker, (e) 1 Damage to pushed figure via standard pipeline.

---

## Data Theft

**Effect** — "SPY, cost 1, specialAction. Choose a Command card in your opponent's discard pile. Once during this round, you may play that card as though it was in your hand."
- Impl: `Data Theft` keyed at 2 sites; `dataTheftStolenCard` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) Special Action (1 action), (c) picker: opponent's discard pile (public — already visible), (d) chosen card stored in `dataTheftStolenCard` round-flag with player-num context, (e) within the round, that player can "play" the stolen card once (treats hand check as if card is present, then card returns to opponent's discard after play? OR is permanently consumed?). CRR check.

---

## De Wanna Wanga

**Effect** — "Bib Fortuna, cost 0, specialAction. Choose 1 Command card in your discard pile and shuffle it into your Command deck. Passive: Once per round, when this card is discarded from your hand or deck, you may shuffle it into your Command deck."
- Impl: `De Wanna Wanga` keyed at 4 sites; `deWannaWangaUsedThisRound` flag in ROUND_DELETE_FLAGS.
- ⚠️ suspicious — verify (a) Bib Fortuna only, (b) free cost, (c) Special Action (1 action), (d) picker: own discard-pile CC (public), (e) chosen card shuffled into deck (`Math.random` shuffle integration), (f) PASSIVE auto-shuffle: when DWW is discarded (from hand via Headhunter / from deck via Bleeding / Strategize), once-per-round prompt to shuffle back into deck instead of staying in discard.

---

## Deadeye

**Effect** — "Any Figure, cost 0, duringAttack. Apply +2 Accuracy to the attack results."
- Impl: `Deadeye` keyed at 4 sites.
- ⚠️ suspicious — verify (a) free cost, (b) during-own-attack, (c) +2 Accuracy at step-4 attacker mod.

---

## Deadly Precision

**Effect** — "IMPERIAL FORCE USER, cost 0, startOfActivation. While attacking during this round, apply -1 Dodge to the defense results."
- Impl: `Deadly Precision` keyed at 1 site.
- ⚠️ suspicious — verify (a) IMPERIAL FORCE USER playableBy, (b) SoA timing, (c) round-long effect: -1 Dodge applied to DEFENDER's results during caster's attacks, (d) defender step-5 mod, (e) round-end revert.

---

## Deathblow

**Effect** — "Any Figure, cost 1, whenYouDeclareAttack. Apply +1 Hit. If defender has Ranged attack type, additional +1 Hit (so +2 total vs Ranged)."
- Impl: `Deathblow` — NO src hits.
- — no impl — needs: (a) on-declare attacker mod, (b) +1 Hit base, (c) +1 additional if defender's `attackInfo.type === 'range'`.

---

## Debts Repaid

**Effect** — "Chewbacca, cost 3, whenOneOfYourFiguresDefeated. Ready your Deployment card and become Focused."
- Impl: `Debts Repaid` keyed at 9 sites.
- ⚠️ suspicious — verify (a) Chewbacca playableBy (per [Wookiee Avenger] setup-search rule — Debts Repaid auto-added to hand at setup), (b) WHEN_DEFEATED trigger on ANY friendly defeat (not just Chewbacca's), (c) Chewbacca's DC readies (clear exhaust state), (d) Chewbacca becomes Focused via applyCondition.

---

## Definition: 'Love'

**Effect** — "HK-47, cost 1, duringActivation. Perform an attack targeting a hostile figure 5 or more spaces away without spending an action. Remove 1 red die from the attack pool."
- Impl: `Definition: 'Love'` keyed at 3 sites.
- ⚠️ suspicious — verify (a) HK-47 only, (b) during-activation, (c) free attack via freeAttackBonusPending (figkey-keyed post-2026-05-13), (d) attackOverrideOpts: minRange = 5 + removeDieColor = 'red' (alexanbv 2026-05-13 audit confirmed attackOverrideOpts wiring), (e) target picker filtered to figures ≥ path-5.

---

## Deflection

**Effect** — "FORCE USER, cost 1, whenAttackDeclaredOnYou. Apply -2 Accuracy to the attack results. After the attack is resolved, the attacker suffers 1 Damage."
- Impl: `Deflection` keyed at 8 sites; `deflectionPending` + `deflectionUnconditional` flags (recategorized 2026-05-13 to PLAYERNUM).
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) Ranged-attack gate? — card doesn't restrict to Ranged but post-attack damage in some Deflection variants is Ranged-only; verify base Deflection is any-type, (c) on-declare -2 Accuracy at step-4/5, (d) post-attack 1 Damage to attacker via standard pipeline (`deflectionPending` flag carries amount + applies at after-attack-fire.js per the impl).

---

## Batch 30 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Deathblow)

**Highest-priority items surfaced:**

1. **Deathblow NO IMPL** — simple +1 Hit / +2 vs Ranged-attack-type defender; on-declare timing.

2. **Dangerous Prey range tiers** — adjacent → 3 Damage; within-4 (not adjacent) → 1 Damage; > 4 → no fire. Distinct from binary range gates.

3. **Data Theft cross-pile playable** — chosen card playable from opponent's discard. State management: where does the card go after play (opponent discard? removed?).

4. **De Wanna Wanga passive auto-shuffle** — when DWW itself gets discarded, prompt shuffle-back. Once-per-round limit; existing flag tracked.

5. **Definition: 'Love' attackOverrideOpts** — minRange + removeDieColor combo. Per alexanbv 2026-05-13 audit, attackOverrideOpts is figkey-keyed post-migration.

6. **Debts Repaid: ANY friendly defeat triggers Chewie's ready** — not just Chewie himself. Verify the WHEN_DEFEATED hook scans all friendlies.

**Next:** Batch 31 (next 10 CCs after Deflection).
