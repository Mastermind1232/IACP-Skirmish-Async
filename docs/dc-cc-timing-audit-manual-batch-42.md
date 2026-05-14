# DC/CC Timing Audit — Manual Triage Batch 42

Scope: Command Cards alphabetical after "Navigation Upgrade", 10 cards:
Negation, New Orders, Of No Importance, Officer's Training,
On a Mission, On the Lam, One in a Million, Opportunistic,
Optimal Bombardment, Out of Time.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Negation

**Effect** — "Any Figure, cost 1, whenCommandCardPlayed. Use after your opponent plays a Command card with a cost of 0. Discard that card and cancel its effects."
- Impl: `Negation` keyed at 39 sites (very high — core counter mechanic).
- ⚠️ suspicious — verify (a) on-CC-play trigger fires for opponent's CC, (b) cost gate: target CC's cost must be 0 (Negation specifically blocks free CCs like Brace Yourself, Fool Me Once, Officer's Training, etc.), (c) Use: target CC discarded + effects canceled, (d) timing: must fire BEFORE target CC's effects apply (pre-resolve interrupt similar to Comm Disruption).

---

## New Orders

**Effect** — "LEADER, cost 3, doubleActionSpecial. Choose 1 adjacent friendly figure. Ready that figure's Deployment card."
- Impl: `New Orders` keyed at 2 sites.
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) DOUBLE Action Special (2 actions), (c) adjacent friendly picker (path-1 from LEADER), (d) chosen figure's DC readies (clear exhaustedDcs / dcExhaustedState), (e) readied figure can activate again this round.

---

## Of No Importance

**Effect** — "Any Figure, cost 0, whenOneOfYourFiguresDefeated. That figure is worth 4 fewer VPs, to a minimum of 0."
- Impl: `Of No Importance` keyed at 4 sites; `nextDefeatedFriendlyVpReduction` flag.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED trigger on non-unique friendly (card says "non-unique" — verify gate), (b) Use/Skip prompt to caster's owner, (c) Use: opponent's VP gain for this defeat reduced by 4 (clamped to ≥ 0), (d) cost adjustment applied at the moment opponent's awardKillVp computes; could be a one-shot flag on the dying figure.

---

## Officer's Training

**Effect** — "Any Figure, cost 0, duringAttack. Reroll 1 attack die. Then, if you are a LEADER, draw 1 Command card."
- Impl: `Officer's Training` keyed at 2 sites.
- ⚠️ suspicious — verify (a) free cost, (b) during-own-attack, (c) reroll 1 attack die (named bucket), (d) LEADER bonus: draw 1 CC after reroll (count-only public log per privacy fix; card stays SECRET).

---

## On a Mission

**Effect** — "C1-10P, cost 0, specialAction. Move up to 5 spaces. Each time you enter a space containing a SMALL figure, you may push that figure 1 space."
- Impl: `On a Mission` keyed at 4 sites; `pendingOnAMissionPush` flag.
- ⚠️ suspicious — verify (a) C1-10P only, (b) free cost, (c) Special Action (1 action), (d) 5-space Move-X with bypassCosts (per alexanbv 2026-05-13), (e) per-step hook: entering shared space with SMALL figure → pause picker with push-1 prompt (existing pendingOnAMissionPush logic in move-x-handler.js), (f) Use/Skip per encounter.

---

## On the Lam

**Effect** — "SMUGGLER, cost 3, whenAttackDeclaredOnYou. Perform a move."
- Impl: `On the Lam` keyed at 5 sites; `onTheLamActive` flag in ACTIVATION_SCALAR_FLAGS.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) on-declare-against-self trigger, (c) Use: caster performs a Move action (gains MP = Speed via grantMovementBank perFig-keyed) interrupting the attack, (d) attack continues against caster after move resolves OR moves caster out of range/LoS to cancel (CRR ruling).

---

## One in a Million

**Effect** — "Jyn Odan, cost 2, whenYouDeclareAttack. If it is not your activation, remove all dice from the target's defense pool."
- Impl: `One in a Million` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Jyn Odan only, (b) on-declare-own-attack, (c) "not your activation" gate (interrupt-style attacks like Hair Trigger, BL, Return Fire), (d) defense pool zeroed for this attack (target.defenseDice = []).

---

## Opportunistic

**Effect** — "SCUM, cost 0, afterHostileFigureSuffersDamage. Gain 3 movement points."
- Impl: `Opportunistic` keyed at 5 sites; `opportunisticMustSpendNow` flag.
- ⚠️ suspicious — verify (a) SCUM affiliation, (b) free cost, (c) trigger: any hostile suffers Damage (any source — attack, AoE, Strain→Damage, etc.), (d) +3 MP via grantMovementBank (perFig-keyed) to caster, (e) "must spend now" flag — caster must use the MP immediately before normal turn resumes? CRR check.

---

## Optimal Bombardment

**Effect** — "General Sorin, cost 3, doubleActionSpecial. Choose up to 3 VEHICLES, DROIDS, or HEAVY WEAPONS adjacent to you. Each of these figures may interrupt to perform an attack. Each attack gains Blast 1."
- Impl: `Optimal Bombardment` keyed at 2 sites; `optimalBombardmentBlastBonus` figkey-keyed (migrated 2026-05-13); `pendingOrbitalBombardment` flag.
- ⚠️ suspicious — verify (a) Sorin only, (b) DOUBLE Action Special (2 actions), (c) picker: up to 3 friendly VEHICLE/DROID/HEAVY WEAPON within path-1 of Sorin, (d) per chosen figure: free attack via freeAttackBonusPending (figkey-keyed) + Blast 1 bonus (via optimalBombardmentBlastBonus figkey-keyed flag), (e) attacks resolve sequentially.

---

## Out of Time

**Effect** — "SCUM, cost 1, duringActivation. A hostile figure within 3 spaces and line of sight suffers Strain equal to the current round number."
- Impl: `Out of Time` keyed at 1 site.
- ⚠️ suspicious — verify (a) SCUM affiliation, (b) during-activation, (c) picker: hostile within path-3 + LoS, (d) target suffers N Strain via applyStrain where N = current round (round 1 = 1 Strain, round 7 = 7 Strain) — escalating mid-game power, (e) Fireproof/Headhunter/Submit-or-Fight fire.

---

## Batch 42 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Negation cost-0 gate** — only fires against free CCs. Critical core counter; 39 src sites suggests well-tested but worth confirming the cost check is strict (=0, not ≤0).

2. **Optimal Bombardment 3-attack chain** — Sorin's DOUBLE Action triggers up to 3 simultaneous free attacks with Blast 1. Sequential resolution; each fires with its own attacker context. figkey-keyed flags ensure no cross-figure leakage.

3. **Of No Importance VP reduction** — opponent's awardKillVp(defeatedFigure) sees the -4 cap. Verify the deduction applies AFTER any other VP modifiers (Field Promotion +4 from same defeat, etc.).

4. **On the Lam attack-continuation** — does the original attack still resolve against caster's new position, or is it canceled if caster moves out of range? CRR ruling needed.

5. **Opportunistic "must spend now"** — `opportunisticMustSpendNow` flag suggests forced immediate spend. Verify the constraint is enforced.

6. **Out of Time escalating Strain** — N = current round. Late-game Out of Time becomes very powerful. Verify the round-number lookup is current (not stale from when card was drawn).

**Next:** Batch 43 (next 10 CCs after Out of Time).
