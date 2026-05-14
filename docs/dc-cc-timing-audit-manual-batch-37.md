# DC/CC Timing Audit — Manual Triage Batch 37

Scope: Command Cards alphabetical after "Grisly Contest", 10 cards:
Guardian Stance, Guerilla Warfare, Guild Programming, Hard to Hit,
Harsh Environment, Heart of Freedom, Heavy Armor, Heavy Ordnance,
Heightened Reflexes, Hidden Trap.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Guardian Stance

**Effect** — "GUARDIAN, cost 1, whileAdjacentFriendlyFigureDefending. Reroll 1 or more attack or defense dice."
- Impl: `Guardian Stance` keyed at 3 sites.
- ⚠️ suspicious — verify (a) GUARDIAN playableBy, (b) trigger: friendly within path-1 of GS-caster is defender of an attack, (c) picker: any subset of attack OR defense dice to reroll (player chooses 1+ dice; mixed pool allowed), (d) forced reroll for each die's controller, (e) per-attack play.

---

## Guerilla Warfare

**Effect** — "Saw Gerrera, cost 1, startOfRound. Each friendly figure with no other friendly figures within 2 spaces gains 1 Block token and becomes Hidden."
- Impl: `Guerilla Warfare` keyed at 1 site.
- ⚠️ suspicious — verify (a) Saw only, (b) SoR timing, (c) iterate friendly figures; for each, check no-other-friendly-within-path-2 (isolated-figure filter), (d) qualifying figures: +1 Block Token via grantPowerTokens + Hide via applyCondition (immunity respected for Hide).

---

## Guild Programming

**Effect** — "IG-11, cost 2, whenYouPerformRapidFire. Before you declare each attack, you become Focused."
- Impl: `Guild Programming` keyed at 1 site.
- ⚠️ suspicious — verify (a) IG-11 only, (b) trigger: when IG-11 plays Rapid Fire (CC) and enters the Rapid Fire 2-attack sequence, (c) on-each-attack-declare: apply Focus to IG-11 via applyCondition (immunity-respected; consumed on roll), (d) persists for both Rapid Fire attacks (re-applies between them).

---

## Hard to Hit

**Effect** — "Any Figure, cost 0, whileDefending. Reroll 1 defense die."
- Impl: `Hard to Hit` — NO src hits.
- — no impl — needs: (a) free cost CC, (b) defender-side mid-attack, (c) named reroll bucket: 1 defense die reroll (player picks color/index).

---

## Harsh Environment

**Effect** — "Any Figure, cost 0, startOfRound. Until the end of the round, figures on exterior spaces apply -1 Evade to their defense results, and figures not on exterior spaces apply +1 Block to their defense results."
- Impl: `Harsh Environment` keyed at 4 sites; `harshEnvironmentActive` flag in ROUND_FALSE_FLAGS.
- ⚠️ suspicious — verify (a) free cost, (b) SoR timing, (c) round-long flag affecting BOTH players' defenders, (d) defender step-5 mod gated on space type: exterior → -1 Evade, interior → +1 Block, (e) needs map-data exterior/interior space tags (same as [Survivalist] dependency from batch 23), (f) EoR flag reset.

---

## Heart of Freedom

**Effect** — "REBEL, cost 2, startOfActivation. Discard 1 HARMFUL condition, recover 2 Damage, and gain 2 movement points."
- Impl: `Heart of Freedom` keyed at 3 sites.
- ⚠️ suspicious — verify (a) REBEL affiliation, (b) SoA timing, (c) 3 effects on caster: filterCondition picker for 1 harmful + heal 2 via pipeline + 2 MP via grantMovementBank (perFig-keyed), (d) all three fire together (not per-effect choice).

---

## Heavy Armor

**Effect** — "VEHICLE, cost 1, whileDefending. During this attack, the Pierce keyword has no effect."
- Impl: `Heavy Armor` keyed at 1 site.
- ⚠️ suspicious — verify (a) VEHICLE playableBy, (b) defender-side mid-attack, (c) zeroes out Pierce on the attack (combat.attackerPierce = 0 for this attack), (d) per-attack scope.

---

## Heavy Ordnance

**Effect** — "HEAVY WEAPON, cost 0, duringAttack. Apply +1 Hit to the attack results. If the defender is an object, apply +2 Hit and Pierce 2 to the attack results instead."
- Impl: `Heavy Ordnance` — NO src hits.
- — no impl — needs: (a) HEAVY WEAPON playableBy, (b) during-own-attack, (c) branch: defender is OBJECT → +2 Hit + Pierce 2 to attacker mods; else → +1 Hit, (d) object-defender detection (alexanbv 2026-05-10 object-damage pipeline).

---

## Heightened Reflexes

**Effect** — "HUNTER, cost 2, duringAttack. Use while attacking a figure to choose 1 defense die and remove its results from the defense results."
- Impl: `Heightened Reflexes` — NO src hits.
- — no impl — needs: (a) HUNTER playableBy, (b) during-own-attack, (c) picker: 1 defense die set to blank (zero out symbols on that die), (d) per-attack play.

---

## Hidden Trap

**Effect** — "Saska Teft, cost 2, specialAction. Choose a terminal. Each figure adjacent to that terminal suffers 2 Damage."
- Impl: `Hidden Trap` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Saska only, (b) Special Action (1 action), (c) terminal picker (mission map terminals only — needs terminal data), (d) AoE: every figure (friendly + hostile, both armies) adjacent to terminal suffers 2 Damage via standard pipeline.

---

## Batch 37 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 7
- ❌ wrong-stage: 0
- — no impl: 3 (Hard to Hit, Heavy Ordnance, Heightened Reflexes)

**Highest-priority items surfaced:**

1. **Hard to Hit NO IMPL** — free defender 1-die reroll. Should be one of the simpler CCs to wire.

2. **Heavy Ordnance NO IMPL** — HEAVY WEAPON object-defender branch (+2 Hit + Pierce 2 vs object; +1 Hit vs figure).

3. **Heightened Reflexes NO IMPL** — HUNTER mid-attack 1-def-die blank.

4. **Harsh Environment exterior/interior map tags** — depends on map data having space-type tags. Same dependency as [Survivalist] from batch 23.

5. **Guardian Stance mixed-pool multi-die reroll** — picker allows ANY subset of attack OR defense dice. Unusual cross-pool selection.

6. **Hidden Trap friendly inclusion in AoE** — "each figure adjacent to that terminal" is literal; friendlies + hostiles both take damage.

**Next:** Batch 38 (next 10 CCs after Hidden Trap).
