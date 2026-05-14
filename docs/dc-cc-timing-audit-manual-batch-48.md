# DC/CC Timing Audit — Manual Triage Batch 48

Scope: Command Cards alphabetical after "Shadow Ops", 10 cards:
Shared Experience, Shoot the Messenger, Signal Jammer, Single Purpose,
Sit Tight, Size Advantage, Slippery Target, Smoke Grenade,
Smuggled Supplies, Smuggler's Tricks.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Shared Experience

**Effect** — "DROID or VEHICLE, cost 1, duringActivation. Spend 3 movement points to become Focused. Passive (Discard): When a friendly DROID or VEHICLE is defeated, you may re-draw this card."
- Impl: `Shared Experience` keyed at 5 sites.
- ⚠️ suspicious — verify (a) DROID/VEHICLE playableBy, (b) during-activation, (c) 3 MP cost via consumeMovementPoints (perFig-keyed; figure must have ≥3 MP in bank), (d) Focus applied via applyCondition, (e) discard-pile passive: WHEN_DEFEATED on friendly DROID/VEHICLE → Use/Skip prompt to re-draw SE from discard to hand.

---

## Shoot the Messenger

**Effect** — "SCUM, cost 0, afterYouResolveAttackTargetingFigure. If the defender was defeated, your opponent discards the top 3 cards of their Command deck."
- Impl: `Shoot the Messenger` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SCUM affiliation, (b) post-attack-on-defeat trigger, (c) opponent's deck-top 3 → opponent's discard pile (public discard — names auto-public via the discard transition; alexanbv 2026-05-13 rule allows this since cards become public when landing in discard).

---

## Signal Jammer

**Effect** — "Any Figure, cost 1, startOfRound. Put this card into play. When any player plays a Command card, discard that card and cancel its effects. Then, discard this card."
- Impl: `Signal Jammer` keyed at 3 sites; `signalJammerActive` flag.
- ⚠️ suspicious — verify (a) SoR timing, (b) attach to play area as persistent state, (c) on-any-CC-play trigger (BOTH players' CCs, including SJ player's own?), (d) cancel target CC + discard it, (e) SJ self-discards after firing once, (f) round-scoped if no CC played.

---

## Single Purpose

**Effect** — "Any Figure, cost 1, startOfActivation. Use the same special action up to twice during this activation."
- Impl: `Single Purpose` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoA timing, (b) flag set on activating figure: bypasses the once-per-special-action gate for THIS activation, (c) per alexanbv 2026-05-13 confirmed audit: `specialsUsedByFig` is per-figure; Single Purpose should allow ONE special index to fire twice (player picks which on second use), (d) per-figure scope.

---

## Sit Tight

**Effect** — "Any Figure, cost 0, startOfRound. You do not activate any groups this round until you have more ready Deployment cards than your opponent."
- Impl: `Sit Tight` keyed at 2 sites; `sitTightPlayerNum` flag.
- ⚠️ suspicious — verify (a) free cost, (b) SoR timing, (c) round-long activation-order constraint: ST player skips activations until ST player's readied-DC count > opponent's, (d) activation-order validator checks the ratio at each ST-player turn, (e) flag clears once condition met (allows normal activation), (f) round-end reset if condition never met.

---

## Size Advantage

**Effect** — "LARGE, cost 2, specialAction. Perform an attack targeting a SMALL figure. Apply +2 Hit to the attack results and the attack gains Weaken."
- Impl: `Size Advantage` keyed at 3 sites.
- ⚠️ suspicious — verify (a) LARGE playableBy, (b) Special Action (1 action), (c) free attack via freeAttackBonusPending, target-restricted to SMALL hostiles, (d) +2 Hit at step-4 attacker mod, (e) Weaken applied to target post-attack via applyCondition (immunity respected).

---

## Slippery Target

**Effect** — "SMUGGLER or SPY, cost 2, whenHostileFigureEntersAdjacentSpace. Gain movement points equal to your Speed."
- Impl: `Slippery Target` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SMUGGLER/SPY playableBy, (b) movement-trigger: hostile enters path-1 of ST-holder during their move, (c) ST holder gains Speed-value MP via grantMovementBank (perFig-keyed), (d) can use the MP immediately to escape (per alexanbv 2026-05-13: in-activation MP goes to bank).

---

## Smoke Grenade

**Effect** — "TROOPER or TECHNICIAN, cost 1, specialAction. Choose a space within 2 spaces. Place 1 smoke token in that space, then a friendly figure within 2 spaces of the chosen space gains 2 movement points. Discard that smoke token at the end of the next round."
- Impl: `Smoke Grenade` keyed at 9 sites.
- ⚠️ suspicious — verify (a) TROOPER/TECHNICIAN playableBy, (b) Special Action (1 action), (c) space picker within path-2, (d) smoke token placed in ancillaryTokens.smoke (blocks LoS for that space per memory note — appears in Foresee LoS computation as blocking), (e) friendly figure picker within path-2 of smoke space → +2 MP via grantMovementBank (perFig-keyed), (f) smoke token discard scheduled for end of NEXT round (round + 1, not current).

---

## Smuggled Supplies

**Effect** — "SMUGGLER, cost 1, startOfActivation. Recover 2 Damage, apply +1 Surge to your attack results until the end of the round, or apply +1 Evade to your defense results until the end of the round."
- Impl: `Smuggled Supplies` keyed at 1 site.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) SoA timing, (c) 3-option picker: heal 2 / round-long +1 Surge attacker mod / round-long +1 Evade defender mod, (d) per-figure flag for the round-long options, (e) EoR reset for mod flags.

---

## Smuggler's Tricks

**Effect** — "SMUGGLER, cost 1, duringActivation. Choose a tile or token you are on or adjacent to. Until the start of the next round, your opponent counts as having 1 fewer figure on or adjacent to that tile or token."
- Impl: `Smuggler's Tricks` keyed at 1 site; `roundSmugglersTricksPlayerNum` flag.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) during-activation, (c) tile-or-token picker (caster on/adjacent), (d) round-long flag: opponent's figure-count on the tile decremented by 1 for control-counting purposes, (e) "until start of next round" = clears at SoR (not current EoR), (f) control-objective scoring honors the -1 count.

---

## Batch 48 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Signal Jammer "any player plays" trigger** — verify the trigger also fires on SJ-player's OWN CCs (literal "any player"), or whether the impl gates to opponent only. CRR ruling needed.

2. **Sit Tight activation-skip constraint** — complex activation-order constraint: skip until ready-DC-count > opponent. Validator must check ratio at each player turn.

3. **Single Purpose specialsUsedByFig bypass** — per the alexanbv 2026-05-13 per-figure specials audit, Single Purpose lets ONE special index fire twice. Must integrate with specialsUsedByFig figkey-keyed gate.

4. **Smoke Grenade LoS-blocking + delayed discard** — smoke token blocks LoS until end of NEXT round (round + 1). Discard scheduling needs to track round-of-placement.

5. **Smuggler's Tricks control-count -1 hook** — control-counting scoring (mission objective scoring) honors the -1 on chosen tile. Verify all control-counting sites consult the flag.

6. **Shared Experience MP-cost gate** — requires 3 MP in bank to play. Pre-play validator must check bank state.

**Next:** Batch 49 (next 10 CCs after Smuggler's Tricks).
