# DC/CC Timing Audit — Manual Triage Batch 24

Scope: last 5 Skirmish Upgrades ([Unshakable], [Vader's Finest],
[Wookiee Avenger], [Z-6 Trooper], [Zillo Technique]) + first 5 Command
Cards (A Powerful Influence, Adrenaline, Advance Warning, Against the
Odds, All in a Day's Work).

This batch marks the **end of all Deployment Cards + Skirmish
Upgrades** (175 DCs + ~50 SUs covered across batches 7-24) and the
**start of Command Cards** (~292 to audit).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## [Unshakable]

**Effect** — "Exhaust this card at the start of one of your activations and choose 1 of your figures with a figure cost of 9 or greater. That figure discards 1 HARMFUL condition and suffers 1 Strain."
- Impl: `Unshakable` keyed at 5 sites.
- ⚠️ suspicious — verify (a) SoA Use/Skip prompt (exhaust only, once per round), (b) picker for friendly figure with cost ≥ 9, (c) chosen figure: filterCondition picker for which harmful to discard + applyStrain for 1 Strain (Fireproof/Headhunter/Submit-or-Fight may fire).

---

## [Vader's Finest]

**Effect** — "TROOPER ONLY. Figures in this group gain: Special Action: Perform an attack, then move up to 1 space. Special Action: If you have less than 2 dice in your printed attack pool, you become Focused. Limit once per group per round."
- Impl: `Vader's Finest` keyed at 5 sites; `vadersFinestPostAttackMove` + `vadersFocusUsedThisRound` flags.
- ⚠️ suspicious — verify (a) TROOPER only, (b) Attack+Move special: pendingVF set, attack resolves, then 1-space Move-X picker per MOVE-017 (bypassCosts per alexanbv 2026-05-13), (c) Focus special: picker (per group, NOT per figure — `vadersFocusUsedThisRound[msgId]` group-keyed gate), check printed attack pool < 2 dice, apply Focus via applyCondition, (d) auditing notes from earlier batches confirm both wired.

---

## [Wookiee Avenger]

**Effect** — "CHEWBACCA (LOYAL WOOKIE) ONLY. +1 Damage passive. You lose 'Protector'. While defending, convert all Dodge results to Evade results. During setup, search Command deck for 'Debts Repaid', reveal it, put in hand, shuffle, then draw 1 fewer card. Once during your activation, may use 'Slam' without spending an action."
- Impl: `Wookiee Avenger` keyed at 11 sites; `wookieeAvengerSlamUsed` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) Chewbacca (Loyal Wookie) only, (b) +1 Damage step-4 mod, (c) "Protector" surge removed from Chewie's surge pool, (d) defender Dodge→Evade conversion at step 5/6, (e) setup-time Debts Repaid search (THE REVEAL IS INTENTIONAL per card text — "reveal it" — alexanbv 2026-05-13 exception confirmed; existing setup.js:278 log naming the card is correct), (f) Slam-without-action: free attack flag for Slam special, figkey-keyed gate.

---

## [Z-6 Trooper]

**Effect** — "NON-UNIQUE REBEL TROOPER GROUP WITH 2 FIGURES ONLY. Rotary Cannon: Before you declare an attack, become Focused. Special Action (Autofire): Perform an attack. Defender adds 1 white die. Surge: After this attack resolves, perform an attack targeting a figure within 3 spaces of the target space."
- Impl: `Z-6 Trooper` keyed at 6 sites; `autofireActive` + `autofireChainTargetSpace` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) army-build: 2-figure non-unique Rebel Trooper, (b) Rotary Cannon: on-declare Focus via applyCondition every attack, (c) Autofire: +1 defender white die at step-5, surge ability chains a free attack targeting within-3-of-original-target-space (autofireChainTargetSpace figkey-keyed for the chain), (d) free attack uses Z-6's normal pool.

---

## [Zillo Technique]

**Effect** — "Exhaust this card while a friendly figure is defending to reduce the Pierce value of the attack results by 2, to a minimum of 0. While a friendly figure is defending, you may discard 1 Command card to apply +1 Block to the defense results. Limit once per attack."
- Impl: `Zillo Technique` keyed at 3 sites; `pendingZilloDiscard` flag.
- ⚠️ suspicious — verify (a) defender bucket button "Reduce Pierce by 2" (exhaust-once-per-round gate), (b) defender bucket "Discard 1 CC for +1 Block" (picker for which CC to discard from hand; discarded card name OK to log since going to discard pile = public), (c) once-per-attack gate for the discard variant; the exhaust variant is once-per-round.

---

## CC: A Powerful Influence

**Effect** — "REBEL FORCE USER, cost 2, startOfRound. Use at the start of a round. Until the start of the next round, hostile figures within 3 spaces of you cannot interact and are not counted for the purposes of control."
- Impl: `A Powerful Influence` keyed at 2 sites; `powerfulInfluencePlayerNum` flag.
- ⚠️ suspicious — verify (a) playableBy = REBEL FORCE USER (Luke/Yoda/Obi-Wan etc.), (b) round-long effect: hostile figures within path-3 of the user's figure cannot interact AND are excluded from control counting (like Yoda's Alter Mind but range-3 and untargeted), (c) interact-block at available-actions.js, (d) control-counting exclusion at terminal/objective scoring.

---

## CC: Adrenaline

**Effect** — "Any Figure, cost 2, startOfRound. Use at the start of a round. During this round, apply +5 Health to each of your WOOKIES."
- Impl: `Adrenaline` keyed at 6 sites.
- ⚠️ suspicious — verify (a) round-long max-HP boost for all WOOKIE figures (each WOOKIE's maxHp +5 in dcHealthState for this round), (b) round-end revert (max-HP returns to base + clamp current HP if needed), (c) applies to all WOOKIEs in player's army at SoR.

---

## CC: Advance Warning

**Effect** — "LEADER, cost 0, duringActivation. Use during your activation. You and an adjacent friendly figure each gain 1 movement point."
- Impl: `Advance Warning` keyed at 3 sites.
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) free CC (cost 0 — VPs not deducted), (c) during-activation timing, (d) self + adjacent-friendly each gain 1 MP via grantMovementBank (figureKey-keyed per perFig migration 2026-05-13), (e) picker for which adjacent friendly to grant MP.

---

## CC: Against the Odds

**Effect** — "Any Figure, cost 0, endOfRound. Use at the end of a round. If your opponent has at least 8 more VPs than you, choose up to 3 of your figures. Those figures become Focused."
- Impl: `Against the Odds` keyed at 3 sites.
- ⚠️ suspicious — verify (a) playable at EoR only, (b) VP gap check (opponent.total - own.total ≥ 8), (c) picker for up to 3 own figures, (d) Focus applied to each via applyCondition (immunity respected).

---

## CC: All in a Day's Work

**Effect** — "TECHNICIAN, cost 3, afterSpecialOrInteract. Use after you resolve a Special or Interact during your activation to become Focused and perform 1 additional action."
- Impl: `All in a Day's Work` keyed at 2 sites.
- ⚠️ suspicious — verify (a) TECHNICIAN playableBy (also affected by [Technician Training] SU which adds TECHNICIAN trait to extra figures — see batch 23), (b) timing: after Special OR Interact action resolves, (c) Focus applied via applyCondition + +1 action grant to perFigureRemaining[figureIdx] (per the 2026-05-07 destruct ruling on per-figure actions), (d) cost 3 VP deducted.

---

## Batch 24 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Transitioned from DCs+SUs to Command Cards.** All 175 DCs covered (batches 7-18) + first ~50 SUs covered (batches 18-24). Remaining: ~292 CCs across upcoming batches 25-55.

2. **[Wookiee Avenger] Debts Repaid setup-search** — intentional reveal per card text; existing setup.js:278 log correctly names the card (confirmed exception to alexanbv 2026-05-13 privacy rule).

3. **[Vader's Finest] Focus once-per-group-per-round** — this IS group-scoped (vadersFocusUsedThisRound[msgId]) per the card's "Limit once per group per round" text. Confirmed group-keeper (not migrated to figkey).

4. **CC A Powerful Influence Yoda-Alter-Mind parallel** — same control-counting + interact-block mechanic but at path-3 untargeted. Verify both check sites honor APE flag.

5. **CC Adrenaline +5 Health round-long** — temporary max-HP increase. Verify revert at EoR (max-HP comes back down, current HP clamped to new max).

6. **CC All in a Day's Work +1 action grant** — needs to add 1 to perFigureRemaining[selectedFigure], not just remaining (per destruct 2026-05-07 per-figure action budget).

**Next:** Batch 25 (next 10 CCs after All in a Day's Work — all CC from now on, reading from data/cc-effects.json).
