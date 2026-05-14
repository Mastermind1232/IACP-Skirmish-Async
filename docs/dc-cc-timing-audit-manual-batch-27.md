# DC/CC Timing Audit — Manual Triage Batch 27

Scope: Command Cards alphabetical after "Brace for Impact", 10 cards:
Built on Hope, Burst Fire, Cal's Buddy, Call the Vanguard, Camouflage,
Capitalize, Capture the Weary, Cavalry Charge, Celebration, Change of
Plans.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Built on Hope

**Effect** — "Jyn Erso, cost 1, duringActivation. Look at top 3 cards of your Command deck. Place 1 in hand, others on top or bottom of deck in any order. Passive: When this card is discarded from your Command deck, re-draw it."
- Impl: `Built on Hope` keyed at 5 sites; abilities.js:9553 (`builtOnHopeEffect`).
- ⚠️ suspicious — verify (a) Jyn Erso only, (b) during-activation timing, (c) top-3 look private to Jyn's player (private hand-channel picker per alexanbv 2026-05-13 privacy), (d) chosen card to hand — name NOT logged publicly per privacy commit `31b285e0` ("Drew 1 Command card from top 3"), (e) other 2 cards placed on top/bottom in any order — picker for each, also private, (f) deck-discard passive: when BoH discarded from deck (Bleeding / Strategize / etc.), auto-redraw moves it from discard back to hand.

---

## Burst Fire

**Effect** — "Fenn Signis, cost 2, specialAction. Perform an attack. If the target suffers 1 or more Damage, each figure adjacent to the target space is Stunned."
- Impl: `Burst Fire` keyed at 6 sites; `burstFirePendingMsgId` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) Fenn Signis only, (b) Special Action timing (action cost 1 = 1 action on Fenn), (c) attack resolves, (d) post-attack hook: if target took ≥1 Damage, each figure adjacent to target's space (path-1) gets Stunned via applyCondition (immunity respected), (e) figure-tracking per-figureKey (burstFirePendingMsgId figkey-keyed).

---

## Cal's Buddy

**Effect** — "Cal Kestis, cost 1, duringActivation. Deploy BD-1 Companion to your space or adjacent space. Activates at start or end of your activation for the rest of the mission."
- Impl: `Cal's Buddy` keyed at 1 site.
- ⚠️ suspicious — verify (a) Cal Kestis only, (b) during-activation timing, (c) BD-1 companion deploy: place picker (Cal's space or adjacent), companion DC instantiated, (d) BD-1 activation lifecycle: starts/ends with Cal's activation for rest of mission, (e) BD-1's own actions/abilities (BD-1 is a separate audited DC — control rules per memory note).

---

## Call the Vanguard

**Effect** — "Any Figure, cost 2, startOfRound. A friendly TROOPER with cost ≥ 4 may interrupt to perform a move and an attack."
- Impl: `Call the Vanguard` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SoR timing, (b) picker for friendly TROOPER with figure-cost ≥ 4, (c) chosen figure interrupts to: (1) perform a move (Move-X or standard? — "perform a move" suggests Move-action with MP grant), (2) perform an attack (free, no action cost), (d) interrupt slot before normal activation order resumes.

---

## Camouflage

**Effect** — "Any Figure, cost 1, whenAttackDeclaredOnYou. You become Hidden."
- Impl: `Camouflage` keyed at 8 sites.
- ⚠️ suspicious — verify (a) on-declare-against-self trigger, (b) applies Hide via applyCondition (immunity respected), (c) cost 1 VP, (d) defender-Hide applied BEFORE attack resolves — does that block the attack from continuing? CRR check: usually Hidden gives defender a Dodge bonus, doesn't cancel the attack.

---

## Capitalize

**Effect** — "Any Figure, cost 1, duringAttack. Choose 1 die. The player that rolled that die must reroll that die. Passive (Discard Pile): When a hostile figure with a HARMFUL condition gains another HARMFUL condition, you may re-draw this card."
- Impl: `Capitalize` keyed at 4 sites.
- ⚠️ suspicious — verify (a) during-attack timing (any-side die forced reroll, similar to Precision / Fyrnock / Raider), (b) discard-pile passive: on-condition-apply hook checks defender already had HARMFUL → may re-draw Capitalize from discard, (c) re-draw picker prompt to Capitalize's owner.

---

## Capture the Weary

**Effect** — "HUNTER, cost 1, specialAction. Choose an adjacent hostile figure. That figure becomes Weakened. If that figure was already Weakened, it suffers 2 Strain instead."
- Impl: `Capture the Weary` keyed at 1 site.
- ⚠️ suspicious — verify (a) HUNTER playableBy, (b) Special Action cost (1 action), (c) adjacent hostile picker, (d) branch: if target already has Weaken → 2 Strain via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire), else apply Weaken via applyCondition (immunity respected; if immune, no Weaken AND no Strain — verify).

---

## Cavalry Charge

**Effect** — "Captain Terro, cost 1, startOfRound. During this round, you gain +1 Block, and while a friendly TROOPER within 3 spaces is attacking, apply +1 Hit to the attack results."
- Impl: `Cavalry Charge` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Captain Terro only, (b) round-long effect, (c) Terro +1 Block while defending (defender step-5 mod), (d) friendly TROOPER within path-3 of Terro: +1 Hit at step-4 attacker mod, (e) round-end revert (clear flag).

---

## Celebration

**Effect** — "Any Figure, cost 0, afterUniqueHostileDefeated. Gain 4 VPs."
- Impl: `Celebration` keyed at 28 sites (high — implies the unique-hostile-defeated hook is heavily tested).
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook fires on unique hostile defeat, (b) Celebration in hand prompt: "Play Celebration?" Use/Skip, (c) Use: +4 VP via awardObjectiveVp, (d) free cost.

---

## Change of Plans

**Effect** — "Any Figure, cost 1, afterYouResolveGroupsActivation. Exhaust 1 of your Deployment cards to ready 1 other Deployment card of equal or lower cost that shares at least 1 trait."
- Impl: `Change of Plans` keyed at 3 sites.
- ⚠️ suspicious — verify (a) after-own-group-activation timing, (b) picker 1: exhaust which currently-ready DC, (c) picker 2: ready which exhausted DC (filtered by cost ≤ exhausted-DC's cost AND shared keyword), (d) DC state transitions in dcExhaustedState.

---

## Batch 27 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Built on Hope private picker chain** — all 3 cards must be visible only to Jyn's player; 1 to hand, 2 reordered top/bottom of deck. Multi-step private hand-channel UI.

2. **Burst Fire AoE Stun** — adjacent-to-target-space Stun pre-immunity-check. Object-damage pipeline integration?

3. **Cal's Buddy BD-1 companion full lifecycle** — deploy + ongoing activation timing. BD-1 itself has its own audited rules (per memory note).

4. **Camouflage on-declare Hide** — applies BEFORE attack resolves. Does the Hide bonus impact the just-declared attack? CRR ruling on Hide-during-defense.

5. **Capitalize discard-pile passive** — needs on-condition-apply pipeline hook that scans both players' discard piles for Capitalize and prompts owner.

6. **Change of Plans 2-picker DC swap** — exhaust-then-ready chain; cost + trait filter on the second picker.

**Next:** Batch 28 (next 10 CCs after Change of Plans).
