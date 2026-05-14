# DC/CC Timing Audit — Manual Triage Batch 29

Scope: Command Cards alphabetical after "Comm Disruption", 10 cards:
Concentrated Fire, Coordinated Attack, Corrupting Force, Counter
Attack, Covering Fire, Cripple, Cruel Strike, Crush, Cut Lines,
Dangerous Bargains.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Concentrated Fire

**Effect** — "TROOPER, cost 1, whenAnotherFriendlyTrooperDeclaresAttackTargetingInYourLineOfSight. If you have the Ranged attack type, add 1 red die to the attack pool. You become Stunned."
- Impl: `Concentrated Fire` keyed at 7 sites; `applySelfStunAfterAttackFigureKey` flag (recategorized 2026-05-13).
- ⚠️ suspicious — verify (a) TROOPER playableBy + Ranged-attacker gate (CF caster must have Ranged attack type), (b) on-declare trigger when ANOTHER friendly TROOPER attacks a target in CF caster's LoS, (c) +1 red die to attacker's pool at step-4, (d) CF caster Stunned via applyCondition — applied AFTER the supported attack resolves (per applySelfStunAfterAttackFigureKey timing: stored at declare, applied at post-attack), (e) playerNum-keyed flag works because only one CF chain per attack.

---

## Coordinated Attack

**Effect** — "Loku Kanoloa, cost 2, doubleActionSpecial. You and a friendly figure within 3 spaces may each perform an attack targeting the same figure. Figures do not block line of sight for these attacks."
- Impl: `Coordinated Attack` keyed at 1 site.
- ⚠️ suspicious — verify (a) Loku only, (b) DOUBLE action special (2 actions), (c) picker: friendly figure within path-3, (d) shared target picker (Loku and partner attack same hostile), (e) figures don't block LoS for BOTH attacks (use `nextAttackIgnoreFigureLOS` figkey-keyed for both attackers), (f) both attacks resolve sequentially.

---

## Corrupting Force

**Effect** — "IMPERIAL, cost 2, startOfRound. Each player chooses up to 3 figures. Roll 1 blue die. Each of those figures suffers Damage equal to the Hit results."
- Impl: `Corrupting Force` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoR + IMPERIAL affiliation gate, (b) dual-player figure picker (like Balancing Force / Chaotic Force), (c) 1 blue die roll shared, (d) Damage = Hit results applied to each chosen figure via standard pipeline.

---

## Counter Attack

**Effect** — "BRAWLER, cost 2, afterAttackTargetingYouResolved. If you were not defeated and are adjacent to the attacker, the attacker suffers 2 Damage."
- Impl: `Counter Attack` keyed at 1 site.
- ⚠️ suspicious — verify (a) BRAWLER playableBy, (b) post-attack-against-self trigger, (c) gates: defender not-defeated + path-1 adjacency to attacker, (d) attacker suffers 2 Damage via standard pipeline, (e) does NOT consume the defender's action (it's a CC play, not a free attack).

---

## Covering Fire

**Effect** — "Any Figure, cost 3, startOfRound. Up to 3 friendly TROOPERS become Hidden. During this round, each of your TROOPERS gains: Surge: Stun. If the target was already stunned, apply +2 Hits to the attack results."
- Impl: `Covering Fire` keyed at 3 sites.
- ⚠️ suspicious — verify (a) SoR timing, (b) picker: up to 3 friendly TROOPERS apply Hide via applyCondition, (c) round-long surge injection: +Stun surge for all friendly TROOPERS (added to surge pool), (d) conditional +2 Hits if target already Stunned at attack time — needs combat-time check on target's existing conditions before applying the Stun surge.

---

## Cripple

**Effect** — "BRAWLER or HUNTER, cost 2, specialAction. Choose an adjacent hostile figure. Until the end of the round, that figure cannot voluntarily exit its space."
- Impl: `Cripple` keyed at 4 sites; `crippledFigures` round-array flag.
- ⚠️ suspicious — verify (a) BRAWLER/HUNTER playableBy, (b) Special Action timing (1 action), (c) picker: adjacent hostile, (d) `crippledFigures` array tracks figureKeys; movement validator blocks voluntary moves out of starting space for crippled figures, (e) involuntary moves (pushes) still allowed, (f) EoR reset (round flag).

---

## Cruel Strike

**Effect** — "Any Figure, cost 0, specialAction. Perform an attack. This attack gains: Surge: Pierce 1, Weaken."
- Impl: `Cruel Strike` keyed at 2 sites.
- ⚠️ suspicious — verify (a) free cost CC (no VP deduct), (b) Special Action timing (1 action), (c) free attack via freeAttackBonusPending (figkey-keyed post-2026-05-13), (d) surge override: ONLY "Pierce 1 + Weaken" surge available during this attack (pendingOverrideAttackDice with blockSurgeAbilities + replacement surge bucket).

---

## Crush

**Effect** — "MASSIVE, cost 3, whenYouEndMovementInSpacesWithOtherFigures. Choose one of those figures that is SMALL. That figure suffers 4 Damage."
- Impl: `Crush` keyed at 1 site.
- ⚠️ suspicious — verify (a) MASSIVE playableBy, (b) trigger: MASSIVE figure ends a move in a multi-cell footprint that overlaps SMALL figures' spaces, (c) picker: SMALL figures sharing footprint cells, (d) chosen SMALL figure suffers 4 Damage via standard pipeline, (e) MASSIVE pass-through-figures rule interacts here.

---

## Cut Lines

**Effect** — "SPY, cost 0, startOfStatusPhase. Players cannot draw Command cards during this round."
- Impl: `Cut Lines` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) SoSP timing (before status-phase draws), (c) blocks ALL CC draws for the round — status-phase draw, [Rebel High Command] +1, [Black Market] draw, Scheme draw, Wisdom draw, etc., (d) round-scoped flag (`noCommandDrawThisRound`).

---

## Dangerous Bargains

**Effect** — "Any Figure, cost 1, startOfRound. Use if you have 30 or fewer VPs. You and your opponent each gain 3 VPs."
- Impl: `Dangerous Bargains` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoR timing, (b) VP gate: own VP ≤ 30, (c) both players +3 VP, (d) win-condition check fires after VP grant (could push opponent over win threshold!).

---

## Batch 29 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Concentrated Fire Stun-on-self timing** — applySelfStunAfterAttackFigureKey applies stun AFTER the supported attack resolves, not at declare. Verify the playerNum-keyed flag correctly tracks the supporter's figureKey value for post-attack apply.

2. **Coordinated Attack dual-attacker LoS bypass** — both Loku AND the partner attack with figures-don't-block. Two nextAttackIgnoreFigureLOS sets, one per attacker figureKey.

3. **Covering Fire conditional surge** — "+Stun, OR if already Stunned, +2 Hits" — combat-time check on target conditions before applying surge effect.

4. **Cripple voluntary-move blocker** — `crippledFigures` array consulted by movement validator. Pushes still legal; only voluntary movement blocked.

5. **Crush footprint overlap detection** — MASSIVE's footprint can include SMALL figures' spaces (pass-through). Trigger fires on end-of-move when overlap exists.

6. **Dangerous Bargains win-condition race** — +3 VP to BOTH players could push opponent over win threshold first. Must check win conditions after the dual grant.

**Next:** Batch 30 (next 10 CCs after Dangerous Bargains).
