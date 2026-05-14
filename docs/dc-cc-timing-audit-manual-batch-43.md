# DC/CC Timing Audit — Manual Triage Batch 43

Scope: Command Cards alphabetical after "Out of Time", 10 cards:
Overcharged Weapons, Overdrive, Overheated, Overrun, Overwhelming
Impact, Pack Alpha, Paid in Beskar, Parry, Parting Blow, Payback.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Overcharged Weapons

**Effect** — "Readied VEHICLE, cost 0, whenEnemyFigureActivates. Interrupt to perform an attack targeting that figure. The attack gains Pierce 2. Then, exhaust your Deployment card and become Weakened."
- Impl: `Overcharged Weapons` keyed at 2 sites.
- ⚠️ suspicious — verify (a) playable only by READIED VEHICLE (not exhausted), (b) on-enemy-activation interrupt trigger, (c) Use: free attack via freeAttackBonusPending (figkey-keyed) at target, (d) attack gains Pierce 2 (added to attacker mods), (e) post-attack: exhaust VEHICLE's DC + apply Weaken via applyCondition, (f) VEHICLE's normal activation that round is now lost (since exhausted).

---

## Overdrive

**Effect** — "Any Figure, cost 3, startOfRound. During this round, each of your DROIDS may suffer 2 Damage during its activation to perform 1 additional action. Limit once per DROID."
- Impl: `Overdrive` keyed at 6 sites; `roundDroidExtraActionCostDamage` flag + `overdriveUsedThisActivation` figkey-keyed (migrated 2026-05-09).
- ⚠️ suspicious — verify (a) SoR timing, (b) round-long buff on caster's DROID figures, (c) per-DROID per-activation: button to "Suffer 2 Damage for +1 action" (gates: applyDamage via standard pipeline + perFigureRemaining +1), (d) once-per-DROID figkey-keyed via `overdriveUsedThisActivation[figureKey]`.

---

## Overheated

**Effect** — "Paz Vizsla, cost 1, specialAction. Strain 4. If you have the Ranged attack type, perform 2 attacks. Apply -1 Hit to the attack results during these attacks. Then, your attack type becomes Melee."
- Impl: `Overheated` keyed at 4 sites; `overheatedActive` figkey-keyed (migrated 2026-05-09).
- ⚠️ suspicious — verify (a) Paz only, (b) Special Action (1 action), (c) 4 Strain via applyStrain (Fireproof/Headhunter fire), (d) Ranged-attack-type gate, (e) 2 attacks chained: pendingOverrideAttackDice (figkey-keyed) with bonusHits = -1 on each, (f) post-chain: attackTypeOverride[figureKey] = 'melee' (Paz becomes Melee for rest of activation), (g) full chain wired per memory notes (batch 16 audit).

---

## Overrun

**Effect** — "VEHICLE, cost 2, startOfActivation. During this activation, when you enter a hostile figure's space, that figure suffers 2 Damage. Limit once per hostile figure."
- Impl: `Overrun` keyed at 6 sites; `overrunThisActivation` + `overrunDamagedThisMove` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) VEHICLE playableBy, (b) SoA timing, (c) per-step movement hook: VEHICLE enters hostile-occupied space → 2 Damage to hostile via standard pipeline, (d) "once per hostile figure" gate via `overrunDamagedThisMove[figureKey]` per-target tracker, (e) figkey-keyed flags are per-VEHICLE-figure.

---

## Overwhelming Impact

**Effect** — "HEAVY WEAPON or WOOKIEE, cost 3, duringAttack. For each defense die rolled, apply +1 Damage and +1 Surge to the attack results. During this attack, ignore all defense results that are not on the defense dice."
- Impl: `Overwhelming Impact` keyed at 8 sites.
- ⚠️ suspicious — verify (a) HEAVY WEAPON or WOOKIEE playableBy, (b) during-own-attack, (c) count defense dice rolled (defenseInfo.dice.length), (d) +N Damage + N Surge to attack results, (e) "ignore all defense results not on dice" — block tokens / evade tokens / passive defense mods (+1 Block / +1 Evade from CCs) are suppressed; only the rolled dice's results count.

---

## Pack Alpha

**Effect** — "CREATURE, cost 1, specialAction. Up to 3 friendly CREATURES within 3 spaces each move up to 3 spaces. Then, choose a hostile figure. It suffers Damage equal to the number of those figures adjacent to it."
- Impl: `Pack Alpha` keyed at 2 sites.
- ⚠️ suspicious — verify (a) CREATURE playableBy, (b) Special Action (1 action), (c) picker: up to 3 friendly CREATUREs within path-3 of caster (includes caster?), (d) per chosen: 3-space Move-X with bypassCosts, (e) after all moves resolve, hostile picker, (f) damage = count of chosen CREATUREs path-1 adjacent to target.

---

## Paid in Beskar

**Effect** — "HUNTER, cost 0, whenHostileFigureWithin3SpacesDefeated. Gain 2 Block tokens."
- Impl: `Paid in Beskar` keyed at 5 sites.
- ⚠️ suspicious — verify (a) HUNTER playableBy, (b) free cost, (c) WHEN_DEFEATED hook on hostile within path-3 of caster, (d) Use: +2 Block Tokens via grantPowerTokens, (e) per-defeat scope (one Paid in Beskar play per qualifying defeat).

---

## Parry

**Effect** — "BRAWLER or GUARDIAN, cost 0, whileDefending. Apply +1 Block or +1 Evade to the defense results."
- Impl: `Parry` keyed at 4 sites.
- ⚠️ suspicious — verify (a) BRAWLER/GUARDIAN playableBy, (b) free cost, (c) defender-side mid-attack, (d) 2-option picker: +1 Block OR +1 Evade applied at step-5 defender mod.

---

## Parting Blow

**Effect** — "BRAWLER, cost 2, whenHostileFigureExitsAdjacentSpace. Interrupt. Before that figure moves, perform an attack targeting that figure. Then, you become Stunned."
- Impl: `Parting Blow` keyed at 8 sites; `partingShotTriggered` scalar flag.
- ⚠️ suspicious — verify (a) BRAWLER playableBy, (b) movement-trigger: hostile begins exiting path-1 of caster, (c) interrupt FIRES BEFORE the exit move resolves, (d) free attack at the still-adjacent figure, (e) post-attack: caster Stunned via applyCondition, (f) per memory note: partingShotTriggered scalar (cleared at activation end) prevents repeated fires.

---

## Payback

**Effect** — "Dengar, cost 2, afterAttackTargetingYouResolved. Interrupt to perform an attack targeting the attacker. Apply +2 Surge to the attack results."
- Impl: `Payback` keyed at 7 sites; `paybackBonusSurge` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) Dengar only, (b) post-attack-against-self trigger, (c) Use: free attack at the original attacker via freeAttackBonusPending (figkey-keyed) + forcedAttackTarget (figkey-keyed) pointing to attacker, (d) +2 Surge at step-4 attacker mod for the counter-attack (paybackBonusSurge figkey-keyed flag).

---

## Batch 43 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Overcharged Weapons interrupt-attack on activation** — VEHICLE attacks before opponent's activated group acts. Verify the interrupt slot fires AFTER opponent's SoA but BEFORE their first action.

2. **Overdrive once-per-DROID flag** — `overdriveUsedThisActivation` figkey-keyed gate ensures each DROID figure can opt in once per activation (separate from the player's once-per-round-per-DROID outer gate).

3. **Overwhelming Impact "ignore non-die defense results"** — suppress all defender mods that aren't dice-rolled (Block tokens, Evade tokens, +Block/Evade from CCs). Only raw die results count.

4. **Overheated full chain** — Strain 4 → 2 Ranged attacks → become Melee. Per memory batch 16 audit, all wired via figkey-keyed flags.

5. **Pack Alpha multi-figure coordination** — 3 friendly CREATURES move + adjacency count for damage. Picker sequence: select creatures → move each → pick hostile → count adjacents.

6. **Parting Blow before-exit timing** — interrupt fires BEFORE the hostile's move step. Movement engine must dispatch the prompt at exit-detection, not at move-completion.

**Next:** Batch 44 (next 10 CCs after Payback).
