# DC/CC Timing Audit — Manual Triage Batch 44

Scope: Command Cards alphabetical after "Payback", 10 cards:
Personal Energy Shield, Pickpocket, Planning, Positioning Advantage,
Prepared for Battle, Preservation Protocol, Price of Glory,
Price on Their Heads, Primary Target, Protect the Old Ways.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Personal Energy Shield

**Effect** — "TECHNICIAN, cost 1, duringActivation. Gain 1 Evade Token. While defending during this round, apply +1 Block to your defense results for each Evade result."
- Impl: `Personal Energy Shield` keyed at 1 site.
- ⚠️ suspicious — verify (a) TECHNICIAN playableBy, (b) during-activation, (c) +1 Evade Token via grantPowerTokens, (d) round-long defender passive: per Evade RESULT (rolled die face) → +1 Block, applied at step-5/6, (e) does NOT apply per Evade TOKEN (different mechanic — only rolled die faces count).

---

## Pickpocket

**Effect** — "SMUGGLER, cost 1, duringActivation. While adjacent to a hostile figure, roll 1 green die. Your opponent loses VPs and you gain VPs equal to the Accuracy result."
- Impl: `Pickpocket` keyed at 1 site.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) during-activation + adjacent hostile gate, (c) 1 green die roll, (d) Accuracy value = N: opponent loses N VP (clamped to ≥ 0), caster gains N VP, (e) atomic VP transfer.

---

## Planning

**Effect** — "Any Figure, cost 0, specialAction. Draw 2 Command cards. Then, if you are not a LEADER, discard 1 of those cards."
- Impl: `Planning` keyed at 3 sites; abilities.js:3941 (the `discardIfNotTrait` branch).
- ⚠️ suspicious — verify (a) free cost, (b) Special Action (1 action), (c) drawCcCards(2) — **count-only public log per privacy commit `31b285e0`** (this was the original alexanbv 2026-05-13 bug report), (d) LEADER check on activator, (e) non-LEADER: discard 1 of the 2 drawn (chooser picks which — picker in private hand channel), discarded card goes to public discard, (f) hand visual refresh per `c3648151` commit.

---

## Positioning Advantage

**Effect** — "Any Figure, cost 0, duringAttack. Apply +1 Hit to the attack results."
- Impl: `Positioning Advantage` keyed at 4 sites.
- ⚠️ suspicious — verify (a) free cost, (b) during-own-attack, (c) +1 Hit at step-4 attacker mod, (d) simplest possible CC — should be working.

---

## Prepared for Battle

**Effect** — "Any Figure, cost 2, duringActivation. Gain 1 Hit Token and 1 Block Token. If you are a LEADER, an adjacent friendly figure gains 1 Hit Token and 1 Block Token."
- Impl: `Prepared for Battle` keyed at 1 site.
- ⚠️ suspicious — verify (a) during-activation, (b) caster gains 1 Hit (=Damage type) + 1 Block via grantPowerTokens with max-cap, (c) LEADER bonus: adjacent friendly picker → same +1+1 grant, (d) "may" — Skip option on the bonus (or auto-apply?).

---

## Preservation Protocol

**Effect** — "4-LOM, cost 1, whenYouHaveSufferedDamageEqualToYourHealth. Instead of being defeated, recover 1 Damage. Until the end of the game, you lose 'Programming Override' and 'Shared Intuition'."
- Impl: `Preservation Protocol` keyed at 5 sites; `pendingPreservationProtocol` flag.
- ⚠️ suspicious — verify (a) 4-LOM only, (b) BEFORE_DEFEATED hook (2026-05-08 defeat-timing rewrite), (c) Use/Skip prompt, (d) Use: cancel defeat + heal 1 → 4-LOM at 1 HP, (e) PERMANENT cost: 'Programming Override' (`roundProgrammingOverrideTrait` flag) and 'Shared Intuition' surge abilities removed from 4-LOM's pool for rest of game.

---

## Price of Glory

**Effect** — "IMPERIAL, cost 2, duringActivation. Discard 1 HARMFUL condition and gain 2 movement points. Then, you may suffer 1 Damage to gain up to 2 different Power Tokens."
- Impl: `Price of Glory` keyed at 2 sites.
- ⚠️ suspicious — verify (a) IMPERIAL affiliation, (b) during-activation, (c) filterCondition picker for 1 harmful + 2 MP via grantMovementBank (perFig-keyed), (d) optional: Use/Skip prompt for "suffer 1 Damage for 2 different PT" — 2 PT picker constraint (must be different types; e.g., 1 Block + 1 Evade, not 2 Block).

---

## Price on Their Heads

**Effect** — "HUNTER, cost 1, specialAction. Place this card on a hostile Deployment card. When the last figure in that group is defeated, gain an additional 4 VPs."
- Impl: `Price on Their Heads` keyed at 2 sites; `priceBounties` ROUND_OBJECT_FLAGS entry — wait, ROUND_OBJECT means it resets each round; verify the persistence is correct.
- ⚠️ suspicious — verify (a) HUNTER playableBy, (b) Special Action (1 action), (c) picker: hostile DC, (d) PoTH attached to that DC (not the caster's), (e) on-group-defeat trigger: when LAST figure of attached group dies, caster's player +4 VP via awardObjectiveVp, (f) `priceBounties` being in ROUND_OBJECT_FLAGS might be wrong — PoTH should persist until the marked group defeats (multi-round), not reset every round. WORTH VERIFYING.

---

## Primary Target

**Effect** — "HUNTER, cost 1, whenYouDeclareAttackTargetingHostileWithHighestFigureCost. You become Focused and apply +1 Hit to the attack results."
- Impl: `Primary Target` keyed at 5 sites.
- ⚠️ suspicious — verify (a) HUNTER playableBy, (b) on-declare gate: target's figure cost = max(all hostile figure costs on map), (c) Focus applied to caster via applyCondition, (d) +1 Hit at step-4 attacker mod, (e) tie-breaking: if multiple hostiles share max cost, any of them qualifies.

---

## Protect the Old Ways

**Effect** — "Kanan Jarrus, cost 1, whenFigureWithin3SpacesDefending. Apply +X Block to the defense results, where X is 1 plus the number of FORCE USER Command cards in your discard pile."
- Impl: `Protect the Old Ways` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Kanan only, (b) on-friendly-defending trigger (any figure within path-3 of Kanan), (c) X count: 1 + (count of FORCE USER CCs in Kanan-player's discard pile — Knowledge and Defense, Force Drain, etc.), (d) +X Block at step-5 defender mod, (e) per-attack play.

---

## Batch 44 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **⚠️ Price on Their Heads persistence** — `priceBounties` is in `ROUND_OBJECT_FLAGS` which resets each round. PoTH should persist until the marked group defeats (potentially multi-round). **Possible bug worth checking.**

2. **Planning chain post-privacy-fix** — drawn cards count-only public log per `31b285e0`; hand UI refreshed per `c3648151`. Verify both fixes intact in current code.

3. **Personal Energy Shield Evade-results-only bonus** — round-long passive that converts Evade RESULTS (rolled die faces) into +1 Block each. Distinct from Evade TOKENS.

4. **Preservation Protocol permanent surge-pool mutation** — Programming Override + Shared Intuition surges permanently removed from 4-LOM. Game-end persistence (not round-scoped).

5. **Primary Target max-cost target gate** — runtime lookup of all hostile figure costs at attack-declare. Tie-breaking on multiple max-cost hostiles.

6. **Protect the Old Ways FORCE USER discard count** — runtime count of FORCE USER CCs in discard. Verify the filter (playableBy includes "FORCE USER" exactly, not as substring of other restrictions).

**Next:** Batch 45 (next 10 CCs after Protect the Old Ways).
