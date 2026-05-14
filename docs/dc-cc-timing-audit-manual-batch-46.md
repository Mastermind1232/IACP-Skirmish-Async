# DC/CC Timing Audit — Manual Triage Batch 46

Scope: Command Cards alphabetical after "Recovery", 10 cards:
Reduce to Rubble, Regroup, Reinforcements, Repair, Reposition,
Rest in Peace, Retaliation, Reverse Engineer, Right Back At Ya!, Roar.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Reduce to Rubble

**Effect** — "HEAVY WEAPON, cost 2, afterYouResolveAttackThatDidNotMissDueToAccuracy. Each figure and object within 2 spaces of the target space suffers 1 Damage. Then, place a Rubble token in the target space and each adjacent space."
- Impl: `Reduce to Rubble` keyed at 6 sites.
- ⚠️ suspicious — verify (a) HEAVY WEAPON playableBy, (b) post-attack timing + "did not miss due to accuracy" gate (attack landed because Accuracy passed range check, not because of evade-zero), (c) AoE: each figure + object within path-2 of target space → 1 Damage via standard pipeline + object damage hook, (d) Rubble placement: target space + each adjacent (path-1) = 5+ Rubble tokens total.

---

## Regroup

**Effect** — "LEADER, cost 1, specialAction. Discard all HARMFUL conditions from adjacent friendly figures."
- Impl: `Regroup` keyed at 2 sites.
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) Special Action (1 action), (c) iterate adjacent friendlies (path-1 from caster), (d) per figure: filterCondition removes ALL harmful conditions (not just 1), (e) no picker — auto-clear.

---

## Reinforcements

**Effect** — "TROOPER, cost 2, startOfRound. Choose 1 of your defeated TROOPERS that has a reinforcement cost of 3 or less. Place that figure adjacent to any other figure of its group."
- Impl: `Reinforcements` keyed at 6 sites; `reinforcementsPlayedThisSor` flag.
- ⚠️ suspicious — verify (a) TROOPER playableBy, (b) SoR timing (once per SoR via flag), (c) picker: defeated friendly TROOPER with reinforcement-cost ≤ 3 (figure-cost lookup), (d) place picker: adjacent to ANOTHER alive figure of the same group (NOT adjacent to caster), (e) revive at full HP, (f) similar to Endless Reserves but at SoR not Special Action.

---

## Repair

**Effect** — "Any Figure, cost 2, duringActivation. Special Action OR Free Action (TECHNICIAN): Choose an adjacent friendly DROID or VEHICLE. That figure recovers 3 damage."
- Impl: `Repair` keyed at 5 sites.
- ⚠️ suspicious — verify (a) during-activation, (b) action cost branch: TECHNICIAN = free, others = Special Action (1 action), (c) adjacent DROID/VEHICLE picker, (d) heal 3 via pipeline.

---

## Reposition

**Effect** — "LEADER, cost 1, specialAction. Choose a SMALL friendly figure within 3 spaces. Push that figure up to 3 spaces."
- Impl: `Reposition` keyed at 88 sites (very high — likely shares the push-figure helper).
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) Special Action (1 action), (c) picker: SMALL friendly within path-3, (d) push up to 3 spaces (player picks landing space), (e) friendly push (not hostile — pushFigure on own player), (f) high src count likely due to test coverage on the push helper.

---

## Rest in Peace

**Effect** — "Any Figure, cost 0, startOfRound. Put this card into play. Players cannot choose, play, or re-draw Command cards in discard piles. At the end of the round, discard this card and draw 1 Command card."
- Impl: `Rest in Peace` keyed at 7 sites; `restInPeaceActive` flag in ROUND_NULL_FLAGS; abilities.js:3984 (`restInPeaceEffect`).
- ⚠️ suspicious — verify (a) free cost, (b) SoR timing, (c) round-long: blocks `choose discard pile CC`, `play discard pile CC`, `re-draw discard pile CC` (Devotion / Cunning / etc. discard-pile interactions), (d) EoR auto-discard + draw 1 for RiP caster (count-only public log per privacy), (e) flag reset at EoR.

---

## Retaliation

**Effect** — "GUARDIAN, cost 1, whenOneOfYourFiguresDefeated. Either become Focused, gain 2 Hit Tokens, or move up to 2 spaces."
- Impl: `Retaliation` keyed at 5 sites.
- ⚠️ suspicious — verify (a) GUARDIAN playableBy, (b) WHEN_DEFEATED hook on ANY friendly defeat (not just adjacent), (c) Use/Skip prompt to GUARDIAN's owner, (d) 3-option picker: Focus apply, +2 Damage Tokens via grantPowerTokens, OR 2-space Move-X (bypassCosts).

---

## Reverse Engineer

**Effect** — "TECHNICIAN, cost 0, specialAction. Perform an attack. During this attack, you may use abilities on the defender's Deployment card instead of your own. Apply +1 Surge to the attack results."
- Impl: `Reverse Engineer` keyed at 3 sites; `reverseEngineerActive` flag (recategorized 2026-05-13 to PLAYERNUM).
- ⚠️ suspicious — verify (a) TECHNICIAN playableBy, (b) free cost, (c) Special Action (1 action), (d) free attack via freeAttackBonusPending (figkey-keyed), (e) ATTACKER USES DEFENDER'S SURGE ABILITIES — combat.js:230 already has the surge-DC swap: `surgeDcName = combat.reverseEngineerActive ? combat.defenderDcName : combat.attackerDcName`, (f) +1 Surge at step-4 attacker mod.

---

## Right Back At Ya!

**Effect** — "Ahsoka Tano, cost 1, whenAttackDeclaredOnYou. The attacker suffers 1 Damage (3 Damage if you spent a Block Token during this attack)."
- Impl: `Right Back At Ya!` keyed at 4 sites; `pendingRightBackAtYa` flag.
- ⚠️ suspicious — verify (a) Ahsoka only, (b) on-declare-against-self trigger, (c) Pending flag captures the Damage amount candidate, (d) post-attack resolution: check if Ahsoka spent Block Token during this attack (any Block consumption from her PT pool); if yes 3 Damage, else 1 Damage, (e) attacker takes Damage via standard pipeline.

---

## Roar

**Effect** — "WOOKIEE or CREATURE, cost 1, specialAction. If you have suffered 3 or more damage, choose up to 3 adjacent hostile figures. Those figures become Stunned."
- Impl: `Roar` keyed at 2 sites.
- ⚠️ suspicious — verify (a) WOOKIEE/CREATURE playableBy, (b) Special Action (1 action), (c) damage-suffered gate: caster has ≥ 3 Damage (maxHp - currentHp ≥ 3), (d) picker: up to 3 hostile within path-1 (adjacent), (e) each chosen Stunned via applyCondition (immunity respected).

---

## Batch 46 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Reverse Engineer surge-DC swap** — combat.js:230 swaps surge ability source to defender's DC. Per memory note, `reverseEngineerActive` was recategorized 2026-05-13 to PLAYERNUM_FLAGS (the cleanup fix). Verify the swap still uses playerNum lookup correctly.

2. **Right Back At Ya! Block-spent-during-attack check** — needs to detect Block Token consumption from Ahsoka's PT pool during this specific attack. Combat-level PT-spend tracker.

3. **Reduce to Rubble "did not miss due to accuracy" gate** — distinct from "did not miss". Attack landed because Accuracy ≥ range, not just because evade didn't cancel. CRR-specific phrasing.

4. **Rest in Peace discard-pile blocker** — blocks 3 distinct mechanics: choose/play/redraw discard CCs. Devotion / Cunning / passive-redraws all gated.

5. **Reinforcements vs Endless Reserves** — both revive defeated TROOPERS adjacent to groupmates. Different timing (SoR vs Special Action) + cost requirements.

6. **Reposition high src count** — 88 sites likely from test coverage of shared push helper. Verify the actual Reposition handler isn't overcounting from common-keyword grep.

**Next:** Batch 47 (next 10 CCs after Roar).
