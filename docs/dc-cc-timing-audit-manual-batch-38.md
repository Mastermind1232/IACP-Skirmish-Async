# DC/CC Timing Audit — Manual Triage Batch 38

Scope: Command Cards alphabetical after "Hidden Trap", 10 cards:
Hide in Plain Sight, Hit and Run, Hold Ground, Honoring the Fallen,
Hostile Negotiation, Hour of Need, Hunt Them Down, Hunter Protocol,
I Can Feel It, I Make My Own Luck.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Hide in Plain Sight

**Effect** — "SPY, cost 3, specialAction. Until the end of the round, you cannot be the target of an attack."
- Impl: `Hide in Plain Sight` keyed at 1 site.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) Special Action (1 action), (c) round-long flag: HiPS caster excluded from target picker by attack-target validator, (d) flag keyed by figureKey so per-figure (not whole group), (e) EoR reset.

---

## Hit and Run

**Effect** — "Any Figure, cost 1, specialAction. Perform an attack. After the attack resolves, you gain 3 movement points."
- Impl: `Hit and Run` keyed at 2 sites; `hitAndRunPendingMp` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) Special Action (1 action), (b) free attack via freeAttackBonusPending (figkey-keyed), (c) post-attack hook: +3 MP via grantMovementBank (perFig-keyed) to caster's bank, (d) MP delivered via `hitAndRunPendingMp` queue → bank grant after attack-resolve closes.

---

## Hold Ground

**Effect** — "GUARDIAN, cost 2, specialAction. Until the end of the round, SMALL hostile figures cannot voluntarily exit spaces adjacent to you."
- Impl: `Hold Ground` keyed at 3 sites; `holdGroundPlayerNum` flag.
- ⚠️ suspicious — verify (a) GUARDIAN playableBy, (b) Special Action (1 action), (c) round-long flag with caster figureKey, (d) movement validator: SMALL hostiles adjacent (path-1) to HG caster blocked from voluntary moves (pushes still legal), (e) EoR reset.

---

## Honoring the Fallen

**Effect** — "Migs Mayfeld, cost 2, whenYouDeclareAttack. Apply +1 Hit to the attack results for each currently defeated friendly figure, to a maximum of +3 Hits."
- Impl: `Honoring the Fallen` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Migs only, (b) on-declare, (c) count currently-defeated friendly figures (DCs marked defeated in figurePositions OR dcExhaustedState — depends on data model), (d) +N Hits where N = min(count, 3), at step-4 attacker mod.

---

## Hostile Negotiation

**Effect** — "Any Figure, cost 1, duringActivation. Discard a random Command card from your hand. If you do, your opponent discards 2 random cards from their hand."
- Impl: `Hostile Negotiation` keyed at 1 site.
- ⚠️ suspicious — verify (a) during-activation, (b) random discard from own hand (auto-pick), (c) opponent discards 2 random — auto-pick, (d) discarded cards go to public discard piles — names OK to log (per alexanbv 2026-05-13 privacy rule: discard pile is public), (e) "if you do" gate: only fires opponent's discard if own discard succeeded.

---

## Hour of Need

**Effect** — "REBEL, cost 0, duringActivation. You recover Damage equal to the current round number."
- Impl: `Hour of Need` keyed at 2 sites.
- ⚠️ suspicious — verify (a) REBEL playableBy, (b) free cost, (c) during-activation, (d) recover N Damage where N = current round number (round 1 = 1 heal, round 7 = 7 heal), (e) heal via standard pipeline; clamped to maxHp.

---

## Hunt Them Down

**Effect** — "The Grand Inquisitor, cost 2, whenYouDeclareLightsaberThrow. Apply +2 Accuracy to the attack results. The attack gains Cleave 2."
- Impl: `Hunt Them Down` keyed at 2 sites.
- ⚠️ suspicious — verify (a) GI only, (b) trigger: when GI declares Lightsaber Throw special, (c) +2 Accuracy at step-4 attacker mod (stacks on Lightsaber Throw's existing +2, total +4? or replaces? CRR check), (d) +Cleave 2 added to attacker's cleave bucket.

---

## Hunter Protocol

**Effect** — "DROID, cost 1, duringAttack. You may trigger the same Surge ability up to twice."
- Impl: `Hunter Protocol` keyed at 8 sites; `pendingHunterProtocol` flag.
- ⚠️ suspicious — verify (a) DROID playableBy, (b) during-own-attack, (c) raise surge-ability allocation cap from 1 to 2 for ONE surge ability (player picks which surge to double-up), (d) similar mechanic to Overload SU but CC-level, (e) per-attack play.

---

## I Can Feel It

**Effect** — "FORCE USER, cost 0, other. Use while defending to reroll 1 defense die. Use while attacking to reroll 1 attack die. Special Action: Gain 1 VP."
- Impl: `I Can Feel It` keyed at 1 site.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) free cost, (c) 3-mode card: defender reroll, attacker reroll, special action VP grant — UI must offer the correct option based on play context, (d) reroll picker (figure picks die from its own pool), (e) Special Action mode: 1 action cost + 1 VP via awardObjectiveVp.

---

## I Make My Own Luck

**Effect** — "Han Solo, cost 2, startOfRound. Your player claims the initiative token, and Han Solo must activate first this round."
- Impl: `I Make My Own Luck` keyed at 1 site.
- ⚠️ suspicious — verify (a) Han Solo only, (b) SoR timing, (c) initiative token transferred to IMOL player (set `game.initiativePlayerId` / `getInitiativePlayerNum`), (d) Han forced-first-activation constraint: activation order validator requires Han activate before any other friendly figure this round, (e) round-scoped constraint.

---

## Batch 38 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **I Can Feel It 3-mode card** — defender reroll / attacker reroll / Special Action VP grant. UI must surface different actions in different contexts. Most flexible CC in the game.

2. **I Make My Own Luck initiative + forced-first-activation** — combo flag: re-grant initiative AND constrain Han to first activation. Activation-order validator must enforce.

3. **Hunt Them Down +2 Accuracy stacking** — base Lightsaber Throw already gives +2 Acc per card text. With HTD adding +2, does that stack (+4 total) or replace? CRR check.

4. **Hide in Plain Sight per-figure flag** — SPY's untargetability is on the specific figureKey, not the group. Per alexanbv 2026-05-13 default rule, this should be figkey-keyed.

5. **Hold Ground SMALL-hostile movement gate** — movement validator must check holdGroundPlayerNum + caster's adjacency + target's SMALL keyword + voluntary-vs-forced distinction.

6. **Honoring the Fallen defeated-friendlies counter** — needs canonical "is this figure currently defeated" check. Verify the source of truth (dcExhaustedState? figurePositions? dcHealthState 0/maxHp?).

**Next:** Batch 39 (next 10 CCs after I Make My Own Luck).
