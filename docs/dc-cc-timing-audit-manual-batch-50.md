# DC/CC Timing Audit — Manual Triage Batch 50

Scope: Command Cards alphabetical after "Stimulants", 10 cards:
Strategic Shift, Strength in Numbers, Stroke of Brilliance,
Supercharge, Support Specialist, Survival Instincts, Take Cover,
Take Initiative, Take Position, Take it Down.

**Milestone:** 50th batch. Coverage so far: ~500 cards across batches 1-50
(though batches 1-6 covered the earliest DCs in a different format
from older audit work; batches 7-50 are the current 10-cards-per-batch
manual triage covering DCs, SUs, and CCs).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Strategic Shift

**Effect** — "SPY, cost 1, specialAction. A player of your choice shuffles his hand of Command cards into his deck. Then, that player draws 2 cards."
- Impl: `Strategic Shift` keyed at 1 site.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) Special Action (1 action), (c) target-player picker (own OR opponent), (d) hand → deck shuffle (entire hand returns to deck), (e) deck shuffle (Fisher-Yates), (f) draw 2 for target player (count-only public log per privacy commit; drawn cards SECRET to target player).

---

## Strength in Numbers

**Effect** — "Any Figure, cost 1, afterYouResolveGroupsActivation. Immediately activate another group. The combined deployment cost of these groups cannot exceed 12."
- Impl: `Strength in Numbers` keyed at 5 sites; `strengthInNumbersPlayerNum` + `strengthInNumbersData` flags.
- ⚠️ suspicious — verify (a) post-own-group-activation timing, (b) picker: another ready friendly DC, (c) cost cap: just-activated.cost + chosen.cost ≤ 12, (d) chosen activates immediately (insert into activation order), (e) similar to Squad Swarm but cost-12 cap (vs 15) and no same-name requirement.

---

## Stroke of Brilliance

**Effect** — "Greedo, cost 0, whenAttackDeclaredOnYou. Apply +2 Block and +1 Evade to the defense results."
- Impl: `Stroke of Brilliance` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Greedo only, (b) free cost, (c) on-declare-against-self trigger, (d) +2 Block + +1 Evade at step-5 defender mod, (e) substantial defensive boost for free.

---

## Supercharge

**Effect** — "TECHNICIAN, cost 1, specialAction. Perform an attack. Add yellow dice to the pool until there are 4 attack dice total. After the attack resolves, you suffer Strain equal to the number of dice added this way."
- Impl: `Supercharge` keyed at 3 sites.
- ⚠️ suspicious — verify (a) TECHNICIAN playableBy, (b) Special Action (1 action), (c) free attack via freeAttackBonusPending, (d) attack pool padding: add yellow dice until baseDice.length + addedYellow === 4 (e.g., 2-die base = 2 yellow added, 1-die base = 3 yellow added), (e) post-attack Strain via applyStrain (Fireproof/Headhunter fire) equal to addedYellow count.

---

## Support Specialist

**Effect** — "Del Meeko, cost 2, duringActivation. Choose a friendly DROID, TECHNICIAN, or TROOPER within 3 spaces. That figure interrupts to perform an action."
- Impl: `Support Specialist` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Del Meeko only, (b) during-activation, (c) picker: friendly DROID/TECHNICIAN/TROOPER within path-3, (d) "perform an action" — chosen figure performs 1 normal action (Move, Attack, Special, Interact), not a free attack, (e) interrupt slot: Del Meeko's activation pauses, target figure acts, then Del resumes.

---

## Survival Instincts

**Effect** — "CREATURE, cost 1, startOfActivation. Until the end of the round, apply +1 Block and +1 Evade to your defense results."
- Impl: `Survival Instincts` keyed at 2 sites.
- ⚠️ suspicious — verify (a) CREATURE playableBy, (b) SoA timing, (c) round-long defender mod +1 Block + +1 Evade for caster, (d) round-end revert via figure-flag clear.

---

## Take Cover

**Effect** — "Any Figure, cost 0, specialAction. During this round, while defending, apply +1 Block and -2 Accuracy to the results."
- Impl: `Take Cover` keyed at 6 sites; `pendingCoverFire` flag (likely shared with Cover Fire CC).
- ⚠️ suspicious — verify (a) free cost, (b) Special Action (1 action), (c) round-long defender mod: +1 Block + -2 Accuracy applied at step-5/6, (d) -2 Accuracy reduces ATTACKER'S accuracy roll (range-check penalty), (e) round-end revert.

---

## Take Initiative

**Effect** — "Any Figure, cost 0, startOfRound. Claim the initiative token. Then exhaust 1 of your Deployment cards."
- Impl: `Take Initiative` keyed at 4 sites.
- ⚠️ suspicious — verify (a) free cost, (b) SoR timing, (c) initiative token transferred to TI player (set initiativePlayerId), (d) exhaust cost: TI player picks one of own ready DCs to exhaust (DC can't activate this round).

---

## Take Position

**Effect** — "Non-Massive GUARDIAN or VEHICLE, cost 0, duringActivation. During this round, apply +1 Block to your defense results and you cannot be pushed, except by MASSIVE figures."
- Impl: `Take Position` keyed at 6 sites; `roundPushImmuneUnlessMassive` ROUND_OBJECT_FLAGS entry.
- ⚠️ suspicious — verify (a) Non-Massive + GUARDIAN/VEHICLE playableBy, (b) free cost, (c) during-activation, (d) round-long: +1 Block defender mod + push-immunity flag (except MASSIVE pushers), (e) push-validator checks `roundPushImmuneUnlessMassive[figureKey]` + pusher's MASSIVE keyword.

---

## Take it Down

**Effect** — "Gideon Argus, cost 3, specialAction. Choose an adjacent friendly figure. That figure performs an attack. Apply +2 Hits to the attack results."
- Impl: `Take it Down` — NO src hits.
- — no impl — needs: (a) Gideon Argus only, (b) Special Action (1 action), (c) adjacent friendly picker (path-1), (d) chosen figure performs free attack via freeAttackBonusPending (figkey-keyed), (e) +2 Hits at step-4 attacker mod for the chosen figure's attack.

---

## Batch 50 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Take it Down)

**Highest-priority items surfaced:**

1. **Take it Down NO IMPL** — Gideon Argus +2 Hits buff on adjacent friendly's free attack.

2. **Strategic Shift target-player choice** — SPY can target OWN or opponent for hand-into-deck shuffle + draw 2. Cross-player agency on a 1-cost ability.

3. **Strength in Numbers vs Squad Swarm distinction** — both chain group activations. SiN: cost ≤ 12, any friendly. SS: cost ≤ 15, same-name. Verify both handlers honor their distinct cost caps + filters.

4. **Supercharge pool-padding mechanic** — pad attack pool to exactly 4 dice (adding yellows). Post-attack Strain count = pad amount.

5. **Take Cover -2 Accuracy reduction** — penalty applied to attacker's accuracy roll mid-defense. Verify the -2 mod fires on attacks against TC caster, not all attacks.

6. **Support Specialist interrupt-an-action** — chosen friendly performs a normal action (not free attack). Activation slot interleaving.

**Next:** Batch 51 (next 10 CCs after Take it Down).
