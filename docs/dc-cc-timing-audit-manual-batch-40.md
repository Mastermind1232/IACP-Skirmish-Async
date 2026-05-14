# DC/CC Timing Audit — Manual Triage Batch 40

Scope: Command Cards alphabetical after "Just Business", 10 cards:
Karabast!, Knowledge and Defense, Learn by Example, Let's Make a Deal,
Lightbow, Lock On, Looking for a Fight, Lord of the Sith,
Lure of the Dark Side, Mandalorian Steel.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Karabast!

**Effect** — "Zeb Orellios, cost 1, duringActivation. For each Damage you have suffered, you may choose a hostile figure within 2 spaces. Each chosen figure suffers 1 Damage."
- Impl: `Karabast!` — NO src hits.
- — no impl — needs: (a) Zeb only, (b) during-activation, (c) count damage-suffered (maxHp - currentHp) at play time, (d) iterate up to N hostile pickers within path-2 of Zeb, (e) "may" → each picker has Skip; total ≤ count, (f) per chosen figure: 1 Damage via standard pipeline.

---

## Knowledge and Defense

**Effect** — "FORCE USER, cost 2, whileDefending. Add 1 black die to your defense pool. Passive: While this card is in your discard pile, FORCE USERS gain: Surge: Re-draw this card."
- Impl: `Knowledge and Defense` keyed at 6 sites.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) defender-side mid-attack: +1 black die to defense pool, (c) PASSIVE in discard pile: surge "Re-draw this card" added to FORCE USER attacker's surge pool, (d) on-surge: KaD card moves from discard back to caster's hand (private), (e) name OK to log on re-draw since it was visible in discard pile.

---

## Learn by Example

**Effect** — "Ezra Bridger, cost 1, other. Play this card as a copy of a FORCE USER Command card in any discard pile, ignoring faction restrictions."
- Impl: `Learn by Example` keyed at 1 site.
- ⚠️ suspicious — verify (a) Ezra only, (b) timing: any (matches the copied CC's timing), (c) picker: FORCE USER CC in either player's discard pile (public), (d) LbE plays as the chosen card; faction restriction bypass (so Rebel Ezra can use IMPERIAL FORCE USER CCs like Deadly Precision), (e) effects of the copied CC resolve, (f) LbE goes to discard (not the copied card — it stays in its original discard).

---

## Let's Make a Deal

**Effect** — "Hondo Ohnaka, cost 0, whileDefending. Pay your opponent X VPs to apply -X Hits to the attack results. Then, you become Focused."
- Impl: `Let's Make a Deal` keyed at 1 site.
- ⚠️ suspicious — verify (a) Hondo only, (b) free cost, (c) defender-side mid-attack, (d) X picker: 0..min(Hondo VP, Hit count), (e) X VP transferred from Hondo to opponent (Hondo VP - X, opponent VP + X), (f) -X Hits applied to attack results, (g) Hondo Focused after attack resolves.

---

## Lightbow

**Effect** — "Chirrut Imwe, cost 1, specialAction. Perform a Ranged attack using 1 blue, 1 red, and 1 green die. This attack uses only the following abilities: +2 Accuracy, Surge: +1 Hit, Surge: Pierce 4."
- Impl: `Lightbow` keyed at 1 site.
- ⚠️ suspicious — verify (a) Chirrut only, (b) Special Action (1 action), (c) pendingOverrideAttackDice (figkey-keyed) with `{dice: ['blue', 'red', 'green'], type: 'ranged', bonusAccuracy: 2, blockSurgeAbilities: true}` + surge-pool replacement (only +1 Hit + Pierce 4 available, not Chirrut's normal surges).

---

## Lock On

**Effect** — "HEAVY WEAPON, cost 2, duringAttack. Apply +3 Accuracy, or -1 Dodge, or -1 Evade to the results."
- Impl: `Lock On` keyed at 9 sites.
- ⚠️ suspicious — verify (a) HEAVY WEAPON playableBy, (b) during-own-attack, (c) 3-option picker: +3 Acc (attacker) OR -1 Dodge (defender) OR -1 Evade (defender), (d) attacker-side mods at step-4, defender-side mods at step-5.

---

## Looking for a Fight

**Effect** — "BRAWLER, cost 0, duringActivation. Gain 1 Hit Token. Then, either move up to 1 space or push an adjacent SMALL figure up to 1 space."
- Impl: `Looking for a Fight` keyed at 4 sites.
- ⚠️ suspicious — verify (a) BRAWLER playableBy, (b) free cost, (c) during-activation, (d) +1 Hit Token (=Damage type per alexanbv 2026-05-08) via grantPowerTokens, (e) 2-option picker: 1-space Move-X (bypassCosts) OR adjacent-SMALL-push picker (path-1 + SMALL filter + push 1 space).

---

## Lord of the Sith

**Effect** — "Darth Vader, cost 3, whenHostileFigureDefeatedNotYourActivation. Interrupt to move up to 2 spaces. Then, you may use 'Force Choke' or perform an attack."
- Impl: `Lord of the Sith` keyed at 8 sites; per memory note: `[Driven by Hatred]` has similar mechanic (EoR Vader interrupt).
- ⚠️ suspicious — verify (a) Vader only, (b) trigger: hostile defeated during NON-Vader's-activation (out-of-activation interrupt), (c) Use/Skip prompt, (d) Vader 2-space Move-X (bypassCosts), (e) post-move: Use/Skip + Force Choke OR Attack picker (similar to DbH EoR flow), (f) interrupt slot before activation order continues.

---

## Lure of the Dark Side

**Effect** — "IMPERIAL FORCE USER, cost 3, specialAction. Choose a hostile figure in your line of sight. That figure gains +2 Hit Tokens, then perform an attack with that figure against a target within 4 spaces of the attacker. Then, the chosen figure suffers 2 Strain."
- Impl: `Lure of the Dark Side` keyed at 6 sites; per memory note (commit `960` 2026-05-08): "Lure of the Dark Side — Post-Attack Strain Now Routes Through applyStrain Pipeline".
- ⚠️ suspicious — verify (a) IMPERIAL FORCE USER playableBy, (b) Special Action (1 action), (c) picker: hostile in LoS, (d) chosen figure +2 Damage Tokens via grantPowerTokens, (e) chosen figure ATTACKS a target within path-4 (cross-figure agency — LotDS player picks target?), (f) post-attack: chosen figure suffers 2 Strain via applyStrain pipeline (FIXED 2026-05-08 per memory).

---

## Mandalorian Steel

**Effect** — "The Armorer, cost 2, startOfRound. During this round, after an attack targeting a friendly figure within 4 spaces resolves, if that figure spent a Power Token, that figure recovers 1 Damage."
- Impl: `Mandalorian Steel` keyed at 3 sites.
- ⚠️ suspicious — verify (a) The Armorer only, (b) SoR timing, (c) round-long: post-attack hook on friendly defender within path-4 of Armorer, (d) condition: defender spent ≥ 1 PT during this attack (Block / Evade token usage), (e) recover 1 Damage via heal pipeline, (f) fires once per attack (not per token spent).

---

## Batch 40 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Karabast!)

**Highest-priority items surfaced:**

1. **Karabast! NO IMPL** — Zeb's per-Damage-suffered AoE: 1 hostile within 2 takes 1 Damage per damage Zeb has taken.

2. **Lure of the Dark Side** cross-figure attack agency — LotDS player commands hostile figure to attack. Verify target picker is LotDS-player-controlled. Strain via applyStrain pipeline FIXED per `960` 2026-05-08.

3. **Learn by Example faction-restriction bypass** — Ezra plays IMPERIAL FORCE USER CCs. Restriction-bypass mechanic distinct from playableBy match.

4. **Let's Make a Deal VP transfer** — Hondo loses X VP, opponent gains X. Both sides must update VP counters atomically.

5. **Lord of the Sith vs Driven by Hatred** — both Vader interrupts; LotS is hostile-defeated-not-his-activation; DbH is EoR. Verify they share the Force Choke/Attack picker but don't conflict.

6. **Mandalorian Steel "spent PT" hook** — PT-spend pipeline must fire heal trigger. Verify token-spend records source figure for the post-attack heal.

**Next:** Batch 41 (next 10 CCs after Mandalorian Steel).
