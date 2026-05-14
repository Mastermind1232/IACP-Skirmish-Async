# DC/CC Timing Audit — Manual Triage Batch 20

Scope: Skirmish Upgrades alphabetical after [Feeding Frenzy], 10 cards:
[First Strike], [Flame Trooper], [Focused on the Kill], [Fury of
Kashyyyk], [Headhunter], [Heavy Fire], [Heir to the Jedi],
[Heroic Effort], [Imperial Citadel], [Imperial Retrofitting].

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## [First Strike]

**Effect** — "After setup, you and your opponent both receive 4 VPs."
- Impl: `First Strike` keyed at 1 site.
- ⚠️ suspicious — verify (a) post-setup hook grants both players 4 VP (mission-start scoring adjustment), (b) one-time at game start, (c) tied to round-1 SoR or pre-round-1?

---

## [Flame Trooper]

**Effect** — "NON-UNIQUE IMPERIAL TROOPER GROUP WITH 2 FIGURES ONLY. Incinerate: After resolving an attack, each figure that suffered damage since this attack was declared suffers 1 Strain. Then, if the attack did not miss, place a Rubble token in the target space. Fireproof: You cannot suffer Strain. You are unaffected by your own Blast and abilities 'Flamethrower' in their name."
- Impl: `Flame Trooper` keyed at 8 sites.
- ⚠️ suspicious — verify (a) army-build validation (2-figure IMPERIAL TROOPER non-unique), (b) Incinerate post-attack hook: enumerate figures that suffered ≥1 Damage during the attack's "during-this-attack" window (Splash/Blast/Cleave/main target), apply 1 Strain each via applyStrain, (c) Rubble placed in target space on non-miss, (d) Fireproof: applyStrain checks the figure's Fireproof flag and short-circuits, (e) Blast / Flamethrower self-immunity (own AoE doesn't hit owner).

---

## [Focused on the Kill]

**Effect** — "IG-88 (ASSASSIN DROID) ONLY. Passive bonus: +5 Health. At the start of your activation, gain 2 movement points. Before you declare an attack, you become Focused. You lose 'Surge: Recover 3 Damage.' You gain: 'Surge: Pierce 1.'"
- Impl: `Focused on the Kill` keyed at 12 sites.
- ⚠️ suspicious — verify (a) IG-88 (Assassin Droid) only validation, (b) +5 maxHp applied at deploy via dcHealthState init, (c) SoA: 2 MP grant to perFig[0] of IG-88's bank (per perFig migration), (d) on-declare: Focus auto-applied to IG-88, (e) surge ability override: remove "Recover 3 Damage" + add "Pierce 1" from IG-88's surge pool, (f) per-attack auto-Focus uses applyCondition (immunity respected).

---

## [Fury of Kashyyyk]

**Effect** — "WOOKIEE ONLY. Friendly WOOKIEES gain Reach. When a friendly WOOKIEE suffers 3 or more Damage, that figure becomes Focused. While a friendly elite WOOKIEE is attacking a figure within 2 spaces, if there is another friendly WOOKIEE within 2 spaces of the defender, apply Pierce 1 to the attack results."
- Impl: `Fury of Kashyyyk` keyed at 8 sites.
- ⚠️ suspicious — verify (a) WOOKIEE-only validation + adds Reach to all friendly WOOKIEEs, (b) damage-suffered hook: when WOOKIEE's damage taken in one attack ≥ 3, auto-Focus via applyCondition, (c) elite WOOKIEE attack mod: path-2 to defender + another friendly WOOKIEE within path-2 of defender → +1 Pierce, (d) per attack (not per round).

---

## [Headhunter]

**Effect** — "Exhaust this card when a hostile figure suffers Strain during your activation. Reduce the amount of Strain suffered by 1. Then, the player controlling that figure must discard 1 random Command card from his hand. If he cannot, that figure suffers 1 Damage."
- Impl: `Headhunter` keyed at 16 sites.
- ⚠️ suspicious — verify (a) applyStrain pipeline hook: when hostile suffers strain during HH-owner's activation, prompt Use/Skip, (b) Use: reduce strain by 1 (so 2-strain becomes 1, 1-strain becomes 0 = blocked), (c) opponent's hand: random CC discard (goes to discard pile = public; the random selection happens automatically — does the bot pick or does the opponent pick "random"?), (d) if hand empty: figure takes 1 Damage instead, (e) once-per-activation exhaust gate.
- The hand discard goes to PUBLIC discard pile, so naming the discarded card is fine per the alexanbv 2026-05-13 privacy rule.

---

## [Heavy Fire]

**Effect** — "Exhaust this card after a friendly VEHICLE or HEAVY WEAPON resolves an attack. For each die in that figure's printed attack pool, you may choose 1 hostile figure within 2 spaces of the target space. Each chosen figure suffers 1 Damage. Then, for each chosen figure, the figure that attacked gains 1 HARMFUL condition of your opponent's choice."
- Impl: `Heavy Fire` keyed at 6 sites.
- ⚠️ suspicious — verify (a) post-attack hook on VEHICLE/HEAVY WEAPON attacker, (b) Use/Skip prompt, (c) Use: enumerate hostiles within path-2 of target space; let player pick up to N (= attacker pool size); apply 1 Damage to each, (d) for each chosen figure, OPPONENT picks a HARMFUL condition to apply to the attacker (this is a defensive penalty); applyCondition for each, (e) opponent's pick is a sequenced Discord button chain per-chosen-target.

---

## [Heir to the Jedi]

**Effect** — "LUKE SKYWALKER ONLY. While attacking, you may reroll 1 attack die. When you declare a Ranged attack, apply +1 Damage to the attack results. Before you declare an attack using 'Saber Strike' you become Focused."
- Impl: `Heir to the Jedi` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Luke Skywalker only validation, (b) attacker reroll bucket (named, once per attack), (c) Ranged-attack +1 Damage at step-4 (gated on attackInfo.type === 'range'), (d) Saber Strike on-declare → auto-Focus via applyCondition. The "Saber Strike" detection — Saber Strike sets `overrideDiceSource` per the alexanbv 2026-05-13 commit (combat.js:1483 captures the source for HttJ Focus).

---

## [Heroic Effort]

**Effect** — "Include this card in your army only if all Deployment cards in your army are unique. When one of your unique figures is defeated, you may draw 1 Command card, then place 1 Command card from your hand on the bottom of your deck."
- Impl: `Heroic Effort` keyed at 7 sites; `pendingHeroicEffortReturn` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) army-build: all DCs unique gate, (b) WHEN_DEFEATED on unique friendly figure, Use/Skip prompt, (c) Use: drawCcCards(1) — drawn card stays SECRET per alexanbv 2026-05-13 privacy fix, (d) return-1-to-deck-bottom picker in private hand channel; returned card stays SECRET (count-only public log already verified in earlier audit), (e) Heroic Effort exhaust pattern.

---

## [Imperial Citadel]

**Effect** — "Whenever a friendly Imperial figure is defeated, for each Power Token on that figure, place a matching Power Token on this card. At the start of a friendly Imperial figure's activation, it may gain 1 Power Token from this card. At the start of each round, place 1 Damage or Block on this card."
- Impl: `Imperial Citadel` keyed at 9 sites.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook on friendly IMPERIAL figure: transfer each PT from defeated figure to the card (need card-level token storage), (b) SoA: each friendly IMPERIAL may gain 1 PT from card (picker for which token type if multiple), (c) SoR: place 1 Damage OR 1 Block on card (player choice), (d) card-level token storage: probably `game.imperialCitadelTokens[playerNum] = [...]`.

---

## [Imperial Retrofitting]

**Effect** — "AT-ST, GENERAL WEISS or SC2-M REPULSOR TANK ONLY. Exhaust this card at the start of a friendly MASSIVE VEHICLE's activation if it has one of the above names to choose one of the following: That figure may perform multiple attacks during this activation. That figure performs a move. Deplete this card before a friendly MASSIVE VEHICLE with one of the above names declares an attack. That figure becomes Focused."
- Impl: `Imperial Retrofitting` keyed at 4 sites; `imperialRetrofittingMultiAttack` figureKey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) attaches only to AT-ST / Weiss / SC2-M, (b) SoA exhaust picker (Multi-Attack vs Free Move), (c) Multi-Attack: enables imperialRetrofittingMultiAttack[figureKey] = true for the activation (alexanbv 2026-05-13 figkey-migrated), so the figure can attack more than once, (d) Free Move: grants a movement (cost? — probably the standard move with bypassCosts since "performs a move" implies Move-action equivalent), (e) Deplete on-declare: auto-Focus via applyCondition.

---

## Batch 20 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **[Flame Trooper] Incinerate "figures damaged since attack declared"** — needs to track every figure that took damage during the attack's resolution window (main target, Splash/Blast/Cleave targets) and apply Strain to each at post-attack. The Strain pipeline must fire Headhunter / Fireproof / Submit-or-Fight for each.

2. **[Headhunter] random hand discard** — bot picks the card "randomly" or prompts opponent to pick? CRR says "random" — likely automated. Verify the random selection picks uniformly from the hand and goes to discard (public — name OK to log).

3. **[Heavy Fire] opponent picks HARMFUL condition** — opponent (the attacker's owner) gets a series of pickers — one HARMFUL condition per chosen target. Multi-step Discord chain.

4. **[Imperial Citadel] PT transfer on defeat** — needs WHEN_DEFEATED hook that transfers ALL PTs from the dying IMPERIAL figure onto the card's token bucket. Then SoA picker for friendly IMPERIAL to take 1 PT from card.

5. **[Focused on the Kill] auto-Focus on-declare** — fires every IG-88 attack. Verify applyCondition not no-op'd by existing Focus or other condition immunity gates.

6. **[Imperial Retrofitting] multi-attack scope** — figureKey-keyed migration confirmed; verify subsequent attacks in same activation correctly bypass the attackPerformedThisActivation gate via the IR flag.

**Next:** Batch 21 (next 10 cards alphabetically — SUs continuing through [I...] / [J...]).
