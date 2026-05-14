# DC/CC Timing Audit — Manual Triage Batch 49

Scope: Command Cards alphabetical after "Smuggler's Tricks", 10 cards:
Sniper Configuration, Son of Skywalker, Spinning Kick, Squad Swarm,
Stall for Time, Static Pulse, Stay Down, Stealth Tactics,
Still Faster Than You, Stimulants.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Sniper Configuration

**Effect** — "Cassian Andor, cost 1, specialAction. Perform an attack. You may draw line of sight from any friendly figure, but still measure range from this figure. Apply +2 Accuracy and Pierce 2 to the attack results."
- Impl: `Sniper Configuration` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Cassian only, (b) Special Action (1 action), (c) free attack via freeAttackBonusPending, (d) LoS-from-any-friendly: target picker uses LoS from any friendly figure (similar to Mortar Trooper Fire Mission but for friendly-LoS not group-LoS), (e) range still from Cassian, (f) +2 Accuracy + Pierce 2 attacker mods.

---

## Son of Skywalker

**Effect** — "Luke Skywalker, cost 3, afterActivationResolves. After a figure resolves an activation, ready your Deployment card."
- Impl: `Son of Skywalker` keyed at 3 sites; `sonOfSkywalkerActive` flag.
- ⚠️ suspicious — verify (a) Luke only, (b) after-any-activation trigger (any player's group activation resolves), (c) Use: Luke's DC readies (clear exhausted state), (d) one-shot — discards after fire, OR persistent across activations? Card text doesn't specify a duration — assume one-shot per the standard CC model.

---

## Spinning Kick

**Effect** — "Tress Hacnua, cost 1, duringAttack. This attack gains Cleave 1 and Cleave 2."
- Impl: `Spinning Kick` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Tress only, (b) during-own-attack, (c) +Cleave 1 AND +Cleave 2 added to attacker's cleave bucket — total +3 Cleave (since 1+2=3), OR two separate Cleave triggers? Card phrasing is unusual; CRR check.

---

## Squad Swarm

**Effect** — "Any Figure, cost 2, afterYouResolveGroupsActivation. Immediately activate another ready group with the same name. The combined cost of both groups cannot exceed 15."
- Impl: `Squad Swarm` keyed at 3 sites; `squadSwarmPlayerNum` + `squadSwarmCumulativeCost` flags.
- ⚠️ suspicious — verify (a) post-own-group-activation, (b) picker: another ready DC with the same NAME as just-activated (e.g., Stormtrooper → Stormtrooper Regular AND Elite both qualify if same name?, CRR check), (c) cumulative-cost gate: SwarmCost1 + SwarmCost2 ≤ 15, (d) chosen group activates immediately (insert into activation order).

---

## Stall for Time

**Effect** — "LEADER or SPY, cost 0, startOfRound. Your opponent places 1 random Command card from his hand on top of his Command deck."
- Impl: `Stall for Time` keyed at 1 site.
- ⚠️ suspicious — verify (a) LEADER/SPY playableBy, (b) free cost, (c) SoR timing, (d) opponent's hand has 1 random card auto-picked → placed on top of opponent's deck (face-down, secret), (e) no name reveal in public log per privacy commit (random pick stays private to opponent who can see their own hand).

---

## Static Pulse

**Effect** — "Iden Versio or Dio, cost 1, specialAction. For each hostile figure adjacent to a friendly 'Dio,' you may have that figure suffer 2 Strain or become Weakened. If 'Dio' is not in play, put 'Dio' into play in your space instead."
- Impl: `Static Pulse` keyed at 6 sites; `pendingStaticPulse` scalar flag.
- ⚠️ suspicious — verify (a) Iden Versio OR Dio playableBy, (b) Special Action (1 action), (c) branch: Dio in play → iterate hostiles adjacent (path-1) to Dio + chained 2-Strain-or-Weaken picker per hostile, (d) branch: Dio not in play → deploy Dio at caster's space (skip Strain/Weaken effects per "instead"), (e) chained picker continuation uses pendingStaticPulse scalar (alexanbv 2026-05-13 recategorized — global object, not msgId-keyed).

---

## Stay Down

**Effect** — "Biv Bodhrik, cost 2, afterYouResolveCloseAndPersonal. If the target was not defeated, perform an additional attack with the same target. Then, you become Stunned."
- Impl: `Stay Down` keyed at 4 sites; `stayDownPendingMsgId` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) Biv only, (b) trigger: post-Close-and-Personal CC resolution, (c) "target not defeated" gate, (d) free additional attack at same target via freeAttackBonusPending + forcedAttackTarget (figkey-keyed) to same defender, (e) post-second-attack: Biv becomes Stunned via applyCondition.

---

## Stealth Tactics

**Effect** — "Any Small Figure, cost 1, whileDefending. Add 1 white die to your defense pool."
- Impl: `Stealth Tactics` keyed at 1 site.
- ⚠️ suspicious — verify (a) SMALL trait playableBy, (b) defender-side mid-attack, (c) +1 white die to defenseInfo.dice, rolled with normal defense pool.

---

## Still Faster Than You

**Effect** — "Cad Bane, cost 2, atStartOfHostileFigureActivation. Interrupt to move 2 spaces and perform an attack targeting a different hostile figure."
- Impl: `Still Faster Than You` keyed at 7 sites; `stillFasterExcludeMsgId` + `pendingStillFaster` flags.
- ⚠️ suspicious — verify (a) Cad Bane only, (b) on-hostile-activation trigger, (c) Cad 2-space Move-X (bypassCosts per alexanbv 2026-05-13), (d) free attack targeting a DIFFERENT hostile (not the activating one) — `stillFasterExcludeMsgId` flag captures the activating msgId, attack-declare validator blocks targeting that msgId's figures, (e) per memory: Pounce + Fell Swoop integration via `pendingStillFaster` and exclude flag.

---

## Stimulants

**Effect** — "SMUGGLER or TECHNICIAN, cost 0, duringActivation. An adjacent figure suffers 1 Damage, then gains 1 movement point and becomes Focused."
- Impl: `Stimulants` keyed at 1 site.
- ⚠️ suspicious — verify (a) SMUGGLER/TECHNICIAN playableBy, (b) free cost, (c) during-activation, (d) picker: adjacent figure (friend OR foe? — card says "An adjacent figure", literal includes both — though intent is likely friendly), (e) 1 Damage via standard pipeline + 1 MP via grantMovementBank (perFig-keyed) + Focus via applyCondition.

---

## Batch 49 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Spinning Kick Cleave 1 AND Cleave 2** — unusual phrasing. Stack to +3 Cleave or two separate Cleave triggers? CRR ruling.

2. **Squad Swarm same-name + cost-15-cap** — picker filtered to readied DCs with matching NAME (Stormtrooper Elite + Stormtrooper Regular both "Stormtrooper"?). Cumulative-cost gate.

3. **Stimulants ambiguous "adjacent figure"** — friendly only or any adjacent? Literal reading includes hostile. Intent vs literal disambiguation.

4. **Still Faster Than You exclude-target gate** — `stillFasterExcludeMsgId` blocks targeting the activating hostile. Verify the cross-CC interaction with Fell Swoop / Pounce free-attack targeting rules.

5. **Son of Skywalker one-shot vs persistent** — card doesn't say "discard"; one-shot ready or persistent?

6. **Static Pulse chained per-hostile picker** — uses pendingStaticPulse scalar; alexanbv 2026-05-13 recategorized to ACTIVATION_SCALAR_FLAGS (commit `67495b3a`). Verify ROUND_DELETE_FLAGS reset works correctly.

**Next:** Batch 50 (next 10 CCs after Stimulants).
