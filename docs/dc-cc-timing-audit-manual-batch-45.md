# DC/CC Timing Audit — Manual Triage Batch 45

Scope: Command Cards alphabetical after "Protect the Old Ways", 10 cards:
Provoke, Pummel, Rally, Rally the Troops, Rank and File,
Rapid Recalibration, Reactive Loyalties, Ready Weapons, Rebel Graffiti,
Recovery.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Provoke

**Effect** — "Any Figure, cost 1, afterYouResolveGroupsActivation. Choose a hostile figure adjacent to one of your TROOPERS or GUARDIANS. That figure's group must activate next if able."
- Impl: `Provoke` keyed at 4 sites; `provokeNextActivation` flag.
- ⚠️ suspicious — verify (a) after-own-group-activation timing, (b) picker: hostile figure adjacent to ANY friendly TROOPER/GUARDIAN, (c) `provokeNextActivation[playerNum]` flag stores forced-next-msgId, (d) activation-order validator: opponent must activate the marked group next if able (still has un-activated figures), (e) "if able" gate fizzles silently if group is fully activated.

---

## Pummel

**Effect** — "Any Figure, cost 1, doubleActionSpecial. If you have the MELEE attack type, perform 2 attacks."
- Impl: `Pummel` keyed at 6 sites; `pummelTwoAttacksThisActivation` + `pummelAttacksRemaining` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) DOUBLE Action Special (2 actions), (b) Melee-attack-type gate on caster, (c) 2 attacks: 1 paid + 1 free via freeAttackBonusPending, (d) `pummelAttacksRemaining[figureKey]` counter tracks the chain (figkey-keyed post-migration).

---

## Rally

**Effect** — "Any Figure, cost 0, startOfActivation. Discard all of your HARMFUL conditions."
- Impl: `Rally` keyed at 9 sites.
- ⚠️ suspicious — verify (a) free cost, (b) SoA timing, (c) filterCondition called for each HARMFUL on caster (Stun, Bleed, Weaken, Strain marker if condition-tracked), (d) no picker — all harmful discarded at once.

---

## Rally the Troops

**Effect** — "Kayn Somos, cost 3, specialAction. Choose another friendly TROOPER within 3 spaces. Ready that figure's Deployment card."
- Impl: `Rally the Troops` — NO src hits.
- — no impl — needs: (a) Kayn Somos only, (b) Special Action (1 action), (c) picker: another (excl self) friendly TROOPER within path-3, (d) chosen DC readies (clear exhaustedDcs / dcExhaustedState).

---

## Rank and File

**Effect** — "TROOPER, cost 1, startOfActivation. You and each friendly TROOPER adjacent to you gain 1 movement point."
- Impl: `Rank and File` keyed at 1 site.
- ⚠️ suspicious — verify (a) TROOPER playableBy, (b) SoA timing, (c) caster + each adjacent friendly TROOPER (path-1 + keyword filter) each get +1 MP via grantMovementBank (perFig-keyed), (d) per-figure bank.

---

## Rapid Recalibration

**Effect** — "DROID, cost 1, whileAttackingBeforeDefenderRerolls. Choose 1 attack die and turn that die to any side."
- Impl: `Rapid Recalibration` keyed at 4 sites.
- ⚠️ suspicious — verify (a) DROID playableBy, (b) timing window: after attack roll, BEFORE defender rerolls (very narrow window), (c) picker: 1 attack die from caster's pool, (d) turn-to-any-side picker (player picks one of the 6 die faces — replace the result), (e) per-attack play.

---

## Reactive Loyalties

**Effect** — "Mara Jade, cost 1, afterAttackTargetingYouResolved. Based on your affiliation: IMPERIAL → attacker suffers 3 Damage. SCUM → +3 VP. REBEL → recover 3 Damage."
- Impl: `Reactive Loyalties` keyed at 1 site.
- ⚠️ suspicious — verify (a) Mara Jade only, (b) post-attack-against-self trigger, (c) affiliation branch: IMPERIAL → 3 Damage to attacker via standard pipeline; SCUM → awardObjectiveVp 3; REBEL → heal 3 via heal pipeline, (d) affiliation lookup: Mara's army affiliation at play time.

---

## Ready Weapons

**Effect** — "TROOPER or GUARDIAN, cost 0, specialAction. Distribute 3 Hit Tokens among figures in your group."
- Impl: `Ready Weapons` keyed at 2 sites.
- ⚠️ suspicious — verify (a) TROOPER/GUARDIAN playableBy, (b) free cost, (c) Special Action (1 action), (d) distribute 3 Hit Tokens (=Damage type per alexanbv 2026-05-08) among group-mates (same msgId/group), (e) picker chain: per-token figure pick (3 sequential picks; can stack on one figure or split).

---

## Rebel Graffiti

**Effect** — "REBEL, cost 0, endOfActivation. If there are no adjacent hostile figures, gain 2 VPs. Then, if you are 'Sabine Wren', you may re-draw this card."
- Impl: `Rebel Graffiti` keyed at 6 sites; the apply-ability-result re-draw passive support is wired.
- ⚠️ suspicious — verify (a) REBEL affiliation, (b) free cost, (c) EoA timing, (d) no-adjacent-hostile gate (path-1 check — zero hostiles), (e) +2 VP via awardObjectiveVp, (f) Sabine bonus: re-draw RG from discard back to hand (per apply-ability-result.js:53-63 — `result.pendingRedraw` flow).

---

## Recovery

**Effect** — "Any Figure, cost 0, specialAction. Recover 2 Damage."
- Impl: `Recovery` keyed at 26 sites.
- ⚠️ suspicious — verify (a) free cost, (b) Special Action (1 action), (c) heal 2 via standard pipeline on caster, (d) clamped to maxHp.

---

## Batch 45 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Rally the Troops)

**Highest-priority items surfaced:**

1. **Rally the Troops NO IMPL** — Kayn's ready-friendly-TROOPER-within-3. Group of 1 (Kayn is single-figure unique).

2. **Provoke "if able" silent fizzle** — if marked group has no un-activated figures, Provoke does nothing (no error, no refund). Verify the fizzle path is silent.

3. **Rapid Recalibration narrow timing window** — must fire AFTER attack roll but BEFORE defender rerolls. Combat-state machine must surface a prompt at this exact step.

4. **Reactive Loyalties affiliation branch** — Mara's affiliation lookup. Mara can be in IMPERIAL/SCUM/REBEL armies depending on the card variant. Verify the affiliation source-of-truth.

5. **Rebel Graffiti Sabine re-draw via pendingRedraw** — apply-ability-result.js handles `result.pendingRedraw` (commit `c3648151` notes the redraw refresh chain).

6. **Pummel Melee-type gate** — caster's current attack type checked (not base attack type), since Overheated etc. can flip type. Run-time attackInfo check.

**Next:** Batch 46 (next 10 CCs after Recovery).
