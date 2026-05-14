# DC/CC Timing Audit — Manual Triage Batch 25

Scope: Command Cards alphabetical after "All in a Day's Work", 10 cards:
Ambush, Apex Predator, Arcing Shot, Armed Escort, Assassinate,
Balancing Force, Ballistics Matrix, Battle Scars, Battlefield
Awareness, Beatdown.

First full-CC batch (batch 24 had 5 SUs + 5 CCs).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Ambush

**Effect** — "Cara Dune, cost 1, whenAttackDeclaredOnYou. Use when an attack targeting you is declared. If you share an edge or corner with a space containing blocking, impassable, or difficult terrain, interrupt to move 4 spaces to a space adjacent to the attacker, then the attacker suffers 2 Damage."
- Impl: `Ambush` keyed at 15 sites; WHEN_DEFENDER_DECLARED hook.
- ⚠️ suspicious — verify (a) Cara Dune only, (b) on-declare-against-Cara trigger, (c) prerequisite check: Cara's space shares edge/corner (8-adjacency) with a blocking/impassable/difficult-terrain space, (d) interrupt: 4-space move via Move-X (bypassCosts per alexanbv 2026-05-13 since "move 4 spaces"), (e) must land adjacent to attacker, (f) attacker takes 2 Damage via standard pipeline.

---

## Apex Predator

**Effect** — "LARGE CREATURE, cost 3, duringActivation. Use during your activation to become focused, Hidden, gain 2 Power Tokens, and 2 movement points. The next time a hostile figure within 2 spaces is defeated during this activation, recover 2 Damage."
- Impl: `Apex Predator` keyed at 8 sites; WHEN_DEFEATED auto-apply hook (per memory, wired as WHEN_DEFEATED in combat-flow rebuild Part 3).
- ⚠️ suspicious — verify (a) LARGE + CREATURE keywords, (b) applyCondition Focus + Hide on Apex user, (c) 2 PT grant (with picker for type? card says "Power Tokens" generically — probably 2 Damage tokens by default OR a 2-token picker), (d) 2 MP grant via grantMovementBank (figureKey-keyed per perFig migration), (e) auto-recover-2-on-next-defeat-within-2 hook (WHEN_DEFEATED gate on hostile within path-2 during this activation), (f) recover-trigger fires ONCE per activation.

---

## Arcing Shot

**Effect** — "Drokkatta, cost 1, beforeYouDeclareAttack. Use before you declare an attack. You may target a figure or object adjacent to an empty space in your line of sight."
- Impl: `Arcing Shot` keyed at 8 sites; `arcingShotActive` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) Drokkatta only, (b) on-declare flag set: target-picker expands to include figures/objects adjacent to ANY empty space in Drokkatta's LoS (path-around-cover mechanic), (c) per-attack scope (figkey-keyed already), (d) cleared after attack declare.

---

## Armed Escort

**Effect** — "VEHICLE or DROID, cost 1, duringActivation. Use during your activation. During this round, other friendly figures within 2 spaces of you gain +1 Evade."
- Impl: `Armed Escort` — NO src hits.
- — no impl — needs: (a) playableBy = VEHICLE or DROID, (b) round-long effect: while AE-user is on board, friendly figures within path-2 get +1 Evade at step-5 defender mod, (c) round-scoped flag tracking which figure is "the escort source".

---

## Assassinate

**Effect** — "HUNTER, cost 3, duringAttack. Use while attacking a figure. If this is the first Command card you play during this attack, apply +3 Hits to the attack results. You cannot play other Command cards during this attack."
- Impl: `Assassinate` keyed at 6 sites.
- ⚠️ suspicious — verify (a) HUNTER playableBy, (b) timing: during-own-attack only, (c) "first CC played this attack" gate — needs combat-level CC-played count; if any prior CCs played this attack, Assassinate is illegal, (d) +3 Hits at step-4 attacker mod, (e) "cannot play other CCs this attack" — set a lockout flag on the combat object that blocks subsequent CC plays for this attack.

---

## Balancing Force

**Effect** — "Any Figure, cost 2, startOfRound. Use at the start of a round if your affiliation is Rebel. Each player chooses up to 3 figures. Roll 1 red die. Each of those figures recovers Damage equal to the Hit results."
- Impl: `Balancing Force` keyed at 1 site.
- ⚠️ suspicious — verify (a) startOfRound timing, (b) Rebel-affiliation gate (BF-player only), (c) BOTH players pick up to 3 of their OWN figures, (d) 1 red die rolled (shared), (e) each chosen figure recovers Hit-results Damage via standard heal pipeline, (f) BF-player picks first or both simultaneously? Discord sequencing.

---

## Ballistics Matrix

**Effect** — "BT-1, cost 1, duringActivation. Use during your activation. Place this card on your Deployment card as an Attachment. Attachment: Exhaust this card before you declare an attack. Figures do not block line of sight during this attack."
- Impl: `Ballistics Matrix` keyed at 2 sites.
- ⚠️ suspicious — verify (a) BT-1 only, (b) one-time attach mode: CC moves from hand to permanent attachment, (c) attachment effect: exhaust-on-declare → set `nextAttackIgnoreFigureLOS[figureKey]` (figkey-keyed post-2026-05-13) for THIS attack only, (d) exhaust-once-per-round per the attachment slot.

---

## Battle Scars

**Effect** — "WOOKIEE, cost 0, duringActivation. Use during your activation to get 1 Power Token. If you have suffered 3 or more Damage, gain 2 Power Tokens instead."
- Impl: `Battle Scars` keyed at 2 sites.
- ⚠️ suspicious — verify (a) WOOKIEE playableBy, (b) cost 0 (no VP deduct), (c) PT type — card says "Power Tokens" generically, probably picker for type, (d) HP threshold: maxHp - currentHp ≥ 3 → 2 tokens, else 1, (e) tokens granted via grantPowerTokens with max-cap.

---

## Battlefield Awareness

**Effect** — "LEADER, cost 1, afterAttackDice. Use after another friendly figure within 3 spaces rolls any number of dice to reroll 1 of those dice."
- Impl: `Battlefield Awareness` keyed at 2 sites.
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) timing: after-dice-rolled (any dice — attack OR defense), (c) range check: friendly figure within path-3, (d) reroll picker for one die from the just-rolled set, (e) **NOT same as Battlefield Leadership (Leia's friendly free attack)** — different mechanic.

---

## Beatdown

**Effect** — "BRAWLER, cost 0, duringActivation. Use during your activation. During your group's activation, apply +1 Hit to the attack results of the next 2 attacks performed by friendly figures."
- Impl: `Beatdown` keyed at 5 sites; `groupNextAttacksBonusHits` flag in ACTIVATION_PLAYERNUM_FLAGS (the alexanbv 2026-05-13 confirmed-keeper group-scoped exception).
- ✅ correct (Beatdown is one of the 3 confirmed group-scope keepers per alexanbv 2026-05-13: Beatdown, Coordinated Raid, Keep the Peace Elite). Uses ACTIVATION_PLAYERNUM_FLAGS for the group-scoped counter, which is the right scope.

---

## Batch 25 — Summary

- ✅ correct: 1 (Beatdown — group-scope keeper)
- ⚠️ suspicious: 8
- ❌ wrong-stage: 0
- — no impl: 1 (Armed Escort)

**Highest-priority items surfaced:**

1. **Armed Escort NO IMPL** — needs +1 Evade aura around VEHICLE/DROID for the round. Defender step-5 mod gated on distance to AE-source.

2. **Ambush 8-adjacency terrain prerequisite** — Cara must share edge OR corner (8 cells) with a blocking/impassable/difficult-terrain space. Then 4-space Move-X with land-adjacent-attacker constraint.

3. **Apex Predator next-defeat-within-2 hook** — auto-recover-2 fires once per activation when ANY hostile within path-2 is defeated. WHEN_DEFEATED hook with range filter + once-flag.

4. **Assassinate "first CC played this attack"** — needs combat-level CC-counter; if prior CCs played (defender or attacker), Assassinate is illegal. Then post-Assassinate lockout blocks further CCs this attack.

5. **Balancing Force dual-player picker sequencing** — BOTH players pick figures. Discord sequencing for cross-player input.

6. **Battlefield Awareness vs Battlefield Leadership distinction** — different CCs. BA = any-dice reroll for friendly-within-3. BL = Leia's friendly free attack. Verify both wired without conflict.

**Next:** Batch 26 (next 10 CCs after Beatdown).
