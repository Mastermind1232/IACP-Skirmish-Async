# DC/CC Timing Audit — Manual Triage Batch 26

Scope: Command Cards alphabetical after "Beatdown", 10 cards:
Behind Enemy Lines, Black Market Prices, Bladestorm, Blaze of Glory,
Blend In, Blitz, Blood Feud, Bodyguard, Brace Yourself, Brace for
Impact.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Behind Enemy Lines

**Effect** — "SPY, cost 1, duringActivation. Use during your activation while in your opponent's deployment zone to look at the top 3 cards of their Command deck and return those cards in any order."
- Impl: `Behind Enemy Lines` keyed at 3 sites; `pendingBELReorder` flag.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) location gate: BEL-user's figure must be in opponent's deployment zone, (c) look at top-3 of opponent's deck — private to BEL player, (d) reorder picker (per alexanbv 2026-05-13 privacy fix: the new order is NOT logged publicly, only "deck top 3 reordered" — commit `31b285e0`), (e) per alexanbv: cards put back stay SECRET; the looking player has them in their hand temporarily? Actually no — they look and return, not draw.

---

## Black Market Prices

**Effect** — "SMUGGLER, cost 1, specialAction. Special Action: Draw 2 Command cards. Then discard 1 card from your hand. You gain VPs equal to the cost of the discarded card."
- Impl: `Black Market Prices` keyed at 3 sites; abilities.js:3917 branch.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) Special Action cost (1 action), (c) drawCcCards(2) — count-only public log per privacy commit, (d) discard picker (player picks 1 from hand) — chosen card to discard pile (public — naming OK), (e) VP grant via awardObjectiveVp equal to discarded card's cost, (f) post-c3648151 commit: apply-ability-result now correctly logs result.logMessage ("Drew 2, discarded **X** (cost N), gained N VP") preferred over generic count line.

---

## Bladestorm

**Effect** — "Shyla Varad, cost 1, duringAttack. Use while attacking to apply +1 Surge to the attack results. After the attack resolves, each hostile figure within 2 spaces of you suffers 1 Damage."
- Impl: `Bladestorm` keyed at 4 sites.
- ⚠️ suspicious — verify (a) Shyla Varad only, (b) +1 Surge at step-4 attacker mod for THIS attack, (c) post-attack hook: hostiles within path-2 of Shyla (NOT target) each take 1 Damage via standard pipeline.

---

## Blaze of Glory

**Effect** — "IG-88, cost 2, afterActivationResolves. Use after an activation resolves to ready your Deployment card. At the end of this round, you suffer 3 Damage."
- Impl: `Blaze of Glory` keyed at 4 sites.
- ⚠️ suspicious — verify (a) IG-88 only, (b) after-activation timing (any activation? or specifically IG-88's own?), (c) "ready your Deployment card" → clear exhaustedDcs / dcExhaustedState for IG-88 so it can activate again this round, (d) EoR auto-damage 3 to IG-88 (queued; fires at EoR via mission-eor-effects).

---

## Blend In

**Effect** — "K-2SO, cost 2, startOfRound. Place this card on your Deployment card at the start of a round. It is now an Attachment. Attachment: You cannot be the target of an attack. Discard this card at the end of your activation or when you declare an attack."
- Impl: `Blend In` keyed at 1 site.
- ⚠️ suspicious — verify (a) K-2SO only, (b) SoR attach mode: CC moves from hand to attachment, (c) untargetable while attached: attacker's target picker excludes K-2SO, (d) discard trigger: end of K-2SO's activation OR when K-2SO declares an attack → returns to discard pile (public).

---

## Blitz

**Effect** — "Any Figure, cost 1, duringAttack. Use while attacking to apply +1 Surge to the attack results."
- Impl: `Blitz` keyed at 7 sites.
- ⚠️ suspicious — verify (a) Any Figure playableBy, (b) during own attack, (c) +1 Surge at step-4 attacker mod, (d) per-attack play (each play = single attack benefit).

---

## Blood Feud

**Effect** — "Jabba the Hutt, cost 2, specialAction. Special Action: Place this card on a hostile Deployment card. When an attack targeting a figure in that group is declared, apply +1 Hit to the attack results."
- Impl: `Blood Feud` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Jabba only, (b) Special Action: Jabba's own action, (c) place on hostile DC (picker for which hostile), (d) on-declare attack against that hostile group: +1 Hit auto-applied to attacker's results, (e) attachment persists until... game end? Or hostile group defeat?

---

## Bodyguard

**Effect** — "GUARDIAN, cost 1, whenAttackDeclaredOnAdjacentFriendly. Use when an attack targeting an adjacent friendly figure is declared. If you could be the target of the attack, the attack targets you instead."
- Impl: `Bodyguard` keyed at 3 sites.
- ⚠️ suspicious — verify (a) GUARDIAN playableBy, (b) on-declare trigger when attack targets adjacent friendly (path-1 from BG-user), (c) "could be the target" check: BG-user must be in range + LoS of attacker for the attack to legally retarget, (d) retarget: combat.defenderFigureKey reassigned to BG-user; original target untouched.

---

## Brace Yourself

**Effect** — "Any Figure, cost 0, whenAttackDeclaredOnYou. Use when an attack targeting you is declared. If it is not the attacker's activation, apply +2 Block to the defense results."
- Impl: `Brace Yourself` keyed at 4 sites.
- ⚠️ suspicious — verify (a) on-declare-against-self trigger, (b) "not attacker's activation" gate (interrupt-style attacks like Counter-Fire, Return Fire, BL grant), (c) +2 Block at step-5 defender mod, (d) free cost (no VP).

---

## Brace for Impact

**Effect** — "Any Figure, cost 1, whileDefending. Use while defending to add 1 black die to your defense pool."
- Impl: `Brace for Impact` keyed at 9 sites.
- ⚠️ suspicious — verify (a) defender-side mid-attack play, (b) +1 black die to defenseInfo.dice, (c) timing: before defense roll, (d) per-attack play, (e) BFI dice are rolled with the existing defense pool (combat-bridge.js roll integration).

---

## Batch 26 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Behind Enemy Lines location + privacy** — must be in opponent's deployment zone; reorder doesn't reveal cards publicly per `31b285e0` privacy fix.

2. **Black Market Prices apply-ability-result flow** — post-`b0ab67f8` commit, logMessage correctly preferred over generic Drew-N line. Verify the full chain.

3. **Bodyguard retarget mechanic** — combat.defenderFigureKey reassignment mid-attack is unusual. Worth a destruct click-through for edge cases (LoS recomputed for BG-user's space?).

4. **Blaze of Glory ready Deployment + EoR damage queue** — ready exhausted IG-88, then auto-apply 3 Damage at EoR. EoR-effect dispatcher must include the BoG damage.

5. **Blend In untargetable attachment** — target picker must exclude Blend-In holder. Auto-discard on declare attack OR end-of-own-activation.

6. **Blood Feud persistent +1 Hit** — attachment to hostile DC. Until game end? Or until hostile group defeats? CRR check.

**Next:** Batch 27 (next 10 CCs after Brace for Impact).
