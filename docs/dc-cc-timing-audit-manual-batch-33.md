# DC/CC Timing Audit — Manual Triage Batch 33

Scope: Command Cards alphabetical after "Endless Reserves", 10 cards:
Escalating Hostility, Espionage Mastery, Etiquette and Protocol,
Evacuate, Explosive Weaponry, Expose Weakness, Extra Protection,
Eyes on the Prize, Face Me!, Face to Face.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Escalating Hostility

**Effect** — "Any Figure, cost 1, afterAttack. Use after you resolve an attack that did not miss. The defender suffers 1 Strain, plus an additional 1 Strain for each other 'Escalating Hostility' Command card in your discard pile."
- Impl: `Escalating Hostility` keyed at 1 site.
- ⚠️ suspicious — verify (a) post-non-miss-attack trigger, (b) Use/Skip prompt, (c) count own discard pile for ADDITIONAL Escalating Hostility copies (exclude the one being played), (d) total Strain = 1 + count, apply via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire), (e) discard-pile count is naturally public.

---

## Espionage Mastery

**Effect** — "Agent Blaise, cost 0, afterYouResolveInterrogate. Return your discarded Command card to your hand. Then, draw 1 card."
- Impl: `Espionage Mastery` keyed at 1 site.
- ⚠️ suspicious — verify (a) Agent Blaise only, (b) trigger: after Interrogate (CC) resolves, (c) "your discarded Command card" — the one Interrogate just made you discard? Or any discard pile pick? CRR check, (d) return to hand (public — discard is public), (e) draw 1 — count-only public log per privacy fix (drawn card stays secret).

---

## Etiquette and Protocol

**Effect** — "C-3PO, cost 2, specialAction. Choose 1 hostile and 1 friendly figure, both in your line of sight. Until the end of the round, these figures cannot declare attacks targeting each other."
- Impl: `Etiquette and Protocol` keyed at 2 sites; `etiquetteBlockPairs` round-array flag.
- ⚠️ suspicious — verify (a) C-3PO only, (b) Special Action (1 action), (c) picker 1: hostile in LoS, picker 2: friendly in LoS, (d) pair stored in `etiquetteBlockPairs` round-array, (e) attack-declare validator checks both directions: pair[A→B] AND pair[B→A] blocked, (f) round-end revert.

---

## Evacuate

**Effect** — "Hera Syndulla, cost 2, specialAction. Choose a friendly figure within 2 spaces. That figure is defeated. Your opponent gains only half the VPs they would normally gain (rounded down)."
- Impl: `Evacuate` keyed at 3 sites; per memory note: "V2-CC17 Evacuate formula fixed to apply negative-cost attachments AFTER halving."
- ⚠️ suspicious — verify (a) Hera only, (b) Special Action (1 action), (c) picker: friendly within path-2, (d) chosen figure defeated via standard pipeline (BEFORE_DEFEATED hooks fire — Dying Lunge / Final Stand / Useful Hide / etc.), (e) VP calculation: opponent gets floor(VP / 2), (f) negative-cost attachments applied AFTER halving per the V2 fix.

---

## Explosive Weaponry

**Effect** — "HEAVY WEAPON, cost 1, whenYouDeclareAttack. This attack gains Blast 1."
- Impl: `Explosive Weaponry` — NO src hits.
- — no impl — needs: (a) HEAVY WEAPON playableBy, (b) on-declare attacker mod, (c) +Blast 1 added to attacker's bonus surge bucket OR direct blast application.

---

## Expose Weakness

**Effect** — "Any Figure, cost 0, duringActivation. Choose an adjacent hostile figure. The next attack targeting that figure gains Pierce 3."
- Impl: `Expose Weakness` keyed at 2 sites.
- ⚠️ suspicious — verify (a) free cost, (b) during-activation, (c) adjacent hostile picker, (d) target gets "next attack against me gets +3 Pierce" mark (round-flag keyed by target's figureKey), (e) attacker-side step-4 mod reads this flag on declared target → +3 Pierce, then clear flag, (f) round-scoped flag (clears if not consumed before EoR).

---

## Extra Protection

**Effect** — "Onar Koma, cost 1, whenFriendlyFigureWithin2SpacesSuffers3PlusDamage. Move up to 2 spaces, then perform an attack."
- Impl: `Extra Protection` keyed at 10 sites; `pendingExtraProtection` flag.
- ⚠️ suspicious — verify (a) Onar Koma only, (b) damage-pipeline hook: when friendly within path-2 suffers ≥ 3 Damage in one attack, (c) Use/Skip prompt to Onar's owner, (d) Use: Onar 2-space Move-X (bypassCosts), (e) Onar free attack via freeAttackBonusPending (figkey-keyed).

---

## Eyes on the Prize

**Effect** — "SCUM, cost 1, startOfRound. Each friendly figure carrying or controlling a crate or mission token may either recover 1 Damage, or gain 1 Power Token, or discard 1 HARMFUL condition."
- Impl: `Eyes on the Prize` — NO src hits.
- — no impl — needs: (a) SCUM affiliation, (b) SoR timing, (c) iterate friendly figures carrying/controlling crates/mission-tokens (needs object-association data), (d) per figure: 3-way picker (recover 1 / +1 PT picker for type / filterCondition harmful picker).

---

## Face Me!

**Effect** — "Agent Kallus, cost 1, specialAction. Choose a unique hostile figure with line of sight to you. Push that figure a number of spaces equal to its speed to a space adjacent to you, then perform an attack targeting that figure."
- Impl: `Face Me!` keyed at 1 site.
- ⚠️ suspicious — verify (a) Kallus only, (b) Special Action (1 action), (c) picker: unique hostile with LoS to Kallus, (d) push N spaces where N = target's Speed, landing space adjacent to Kallus, (e) post-push free attack via freeAttackBonusPending + forcedAttackTarget (figkey-keyed) targeting the pushed figure.

---

## Face to Face

**Effect** — "BRAWLER, cost 1, specialAction. Move up to 2 spaces, then perform an attack targeting an adjacent figure or object."
- Impl: `Face to Face` keyed at 1 site.
- ⚠️ suspicious — verify (a) BRAWLER playableBy, (b) Special Action (1 action), (c) 2-space Move-X with bypassCosts (per alexanbv 2026-05-13 Move-X ruling), (d) post-move free attack with target restriction: ADJACENT (path-1) figure OR object, (e) object-target support: attack-target picker includes objects (alexanbv 2026-05-10 object-damage pipeline).

---

## Batch 33 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 8
- ❌ wrong-stage: 0
- — no impl: 2 (Explosive Weaponry, Eyes on the Prize)

**Highest-priority items surfaced:**

1. **Explosive Weaponry NO IMPL** — HEAVY WEAPON on-declare +Blast 1.

2. **Eyes on the Prize NO IMPL** — SCUM SoR aura: per-friendly-carrying-objective 3-way picker (heal / PT / condition discard). Needs object-carrier query.

3. **Evacuate negative-cost-attachment halving order** — V2-CC17 fix applies negative-cost attachments AFTER halving. Per memory note, fixed in destruct V2 closure (commit ref to look up).

4. **Etiquette and Protocol mutual-block pairs** — bidirectional attack block via `etiquetteBlockPairs` round-array. Both directions checked at attack-declare.

5. **Face Me! variable-distance push** — push distance = target's Speed (not fixed N). Multi-step push path calculation.

6. **Expose Weakness "next attack on target" flag** — round-flag keyed by target's figureKey, consumed by NEXT attack targeting that figure (any attacker, not just EW caster).

**Next:** Batch 34 (next 10 CCs after Face to Face).
