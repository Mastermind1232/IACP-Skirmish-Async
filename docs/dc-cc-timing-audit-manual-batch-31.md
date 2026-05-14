# DC/CC Timing Audit — Manual Triage Batch 31

Scope: Command Cards alphabetical after "Deflection", 10 cards:
Demoralizing Monologue, Deploy the Garrison, Desperate Escape,
Devotion, Dioxis Fumes, Dirty Trick, Disable, Disarm, Disengage,
Disorient.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Demoralizing Monologue

**Effect** — "Moff Gideon, cost 1, duringAttack. Choose and reroll 1 defense die. Then you may reveal your hand. If you reveal 2 or more cards this way, remove the chosen die's results from the defense results."
- Impl: `Demoralizing Monologue` keyed at 2 sites; per memory note (combat-flow rebuild session 2026-05-08) — DM sub-picker bug fixed: "Demoralizing Monologue sub-picker — cleanup before prompt + correct resume phase".
- ⚠️ suspicious — verify (a) Moff Gideon only, (b) during-attacker-attack timing, (c) Use: defense die picker (1 die to reroll), (d) optional reveal: Moff player's hand becomes public per card text ("reveal" — alexanbv 2026-05-13 intentional exception), (e) if revealed ≥ 2 cards, the rerolled die's results are REMOVED from defense pool (replaced with blank/zero), (f) cleanup-before-prompt fix from `96adb587` ensures correct phase resume.

---

## Deploy the Garrison

**Effect** — "Director Krennic, cost 1, startOfRound. Each friendly TROOPER or GUARDIAN within 4 spaces gains 2 movement points or 1 Hit Token."
- Impl: `Deploy the Garrison` keyed at 3 sites; `pendingDeployGarrison` flag.
- ⚠️ suspicious — verify (a) Krennic only, (b) SoR timing, (c) iterate friendly TROOPER/GUARDIAN within path-4 of Krennic, (d) per-figure picker: 2 MP via grantMovementBank (figkey-keyed) OR 1 Hit Token via grantPowerTokens, (e) sequential resolution via pendingDeployGarrison state.

---

## Desperate Escape

**Effect** — "Kuiil, cost 1, endOfRound. Move up to 6 spaces. Passive: At EoR, if your Kuiil is defeated, you may discard this card from your hand to distribute 2 Hit Tokens among friendly figures."
- Impl: `Desperate Escape` — NO src hits.
- — no impl — needs: (a) Kuiil only, (b) EoR Move-X 6 spaces with bypassCosts, (c) discard-from-hand passive: at EoR if Kuiil defeated, Use/Skip prompt to discard DE for 2 Hit Token distribution picker.

---

## Devotion

**Effect** — "DROID, cost 0, specialAction. Choose an adjacent friendly figure. Then, search your Command deck and draw 1 card with that figure's name as a trait, reveal it, and then shuffle your Command deck."
- Impl: `Devotion` keyed at 2 sites (abilities.js:10870 area).
- ⚠️ suspicious — verify (a) DROID playableBy, (b) Special Action (1 action), (c) adjacent friendly picker, (d) deck-search filter: CC playableBy matching chosen figure's name, (e) "reveal it" — alexanbv 2026-05-13: this IS an intentional reveal per card text. But my privacy commit changed Devotion log to count-only — that may have been wrong! **VERIFICATION NEEDED**: card text says "reveal it" — should the chosen card's NAME be logged publicly. Worth a re-audit of commit 31b285e0.

---

## Dioxis Fumes

**Effect** — "DROID or HUNTER, cost 1, duringActivation. Each non-DROID figure suffers 1 Strain. Until the end of the round, non-DROID figures cannot recover Strain."
- Impl: `Dioxis Fumes` keyed at 1 site; `roundDioxisActive` flag in ROUND_DELETE_FLAGS.
- ⚠️ suspicious — verify (a) DROID/HUNTER playableBy, (b) during-activation, (c) AoE: iterate every non-DROID figure on board (both armies), apply 1 Strain via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire per figure), (d) round-long `roundDioxisActive` flag: non-DROID Strain-recovery (e.g., Recover surge ability, Force Heal removing Strain) is blocked, (e) EoR reset.

---

## Dirty Trick

**Effect** — "SMUGGLER or HUNTER, cost 2, whenHostileFigureEntersAdjacentSpace. That figure must choose to either suffer 3 Strain or become Stunned."
- Impl: `Dirty Trick` keyed at 9 sites.
- ⚠️ suspicious — verify (a) SMUGGLER/HUNTER playableBy, (b) movement-trigger: hostile enters path-1 of DT-holder during their move (not at move-end), (c) Use/Skip prompt to DT-holder, (d) Use: target's controller picks: 3 Strain via applyStrain OR Stun via applyCondition, (e) per-attack/per-trigger play (could fire multiple times per round on different entries).

---

## Disable

**Effect** — "TECHNICIAN or SMUGGLER, cost 2, specialAction. Choose an adjacent hostile figure. Until the end of the round, that figure cannot use Surge abilities or Special actions."
- Impl: `Disable` keyed at 22 sites; `disabledFigures` round-array flag.
- ⚠️ suspicious — verify (a) TECHNICIAN/SMUGGLER playableBy, (b) Special Action (1 action), (c) adjacent hostile picker, (d) `disabledFigures` array tracks figure display names, (e) surge-pool returns empty for disabled figures at combat-time, (f) Special Action buttons hidden / refused for disabled figures (dc-play-area.js:2027 has the Disable gate).

---

## Disarm

**Effect** — "Krrsantan, cost 1, other. Use when an adjacent hostile figure becomes Bleeding from your attack. Put this card into play, then that figure suffers 1 Damage, becomes Weakened, and can't discard the Weakened condition."
- Impl: `Disarm` keyed at 9 sites; `disarmPermanentWeakened` flag.
- ⚠️ suspicious — verify (a) Krrsantan only, (b) timing: post-attack hook where defender just became Bleeding from Krrsantan's attack (path-1 + Bleed-just-applied), (c) Use puts card "into play" (attachment-style? or just one-shot?), (d) 1 Damage to defender via standard pipeline, (e) Weaken via applyCondition + flag-mark in `disarmPermanentWeakened` to block the normal Weaken-discard action.

---

## Disengage

**Effect** — "Mak Eshka'rey, cost 1, whenHostileFigureEntersSpaceWithin3Spaces. Gain 3 movement points."
- Impl: `Disengage` keyed at 4 sites.
- ⚠️ suspicious — verify (a) Mak only, (b) movement-trigger: hostile enters any space within path-3 of Mak, (c) Use: Mak gains 3 MP via grantMovementBank (figkey-keyed, perFig migration), (d) bank vs Move-X distinction: card says "gain 3 movement points" — alexanbv 2026-05-13 ruling for "MP gain" → goes into bank (not Move-X). Verify it goes into Mak's per-figure bank.

---

## Disorient

**Effect** — "Any Figure, cost 0, afterDamage. Use after a hostile figure with a BENEFICIAL condition suffers Damage. Discard 1 BENEFICIAL condition from that figure. Then, that figure suffers 2 Strain."
- Impl: `Disorient` keyed at 4 sites.
- ⚠️ suspicious — verify (a) free cost, (b) post-damage-on-hostile-with-beneficial trigger, (c) BENEFICIAL condition filter: Focus, Hide, Stealth (verify list), (d) Use: filterCondition picker for which beneficial to discard, (e) 2 Strain via applyStrain.

---

## Batch 31 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Desperate Escape)

**Highest-priority items surfaced:**

1. **Desperate Escape NO IMPL** — Kuiil EoR Move-X-6 + discard-from-hand-on-defeat-passive.

2. **Devotion privacy regression** — my commit `31b285e0` (privacy fix) changed Devotion's log to count-only, but card text says "reveal it" — should be the alexanbv 2026-05-13 intentional reveal exception. **Worth checking whether this needs to be reverted to name the drawn card publicly.**

3. **Demoralizing Monologue reveal-hand mechanic** — Moff Gideon's hand becomes public per card text. Hand-reveal-to-log is a distinct privacy-exception flow that needs explicit handling.

4. **Disable surge + special action suppression** — disabledFigures array consulted at both surge-pool computation AND special-action button render time. Verify both sites honor the round-flag.

5. **Disarm "can't discard Weakened"** — disarmPermanentWeakened blocks the normal Weaken-discard action button. Verify the discard-condition handler checks this flag.

6. **Dirty Trick mid-move adjacency trigger** — hostile entering path-1 of DT-holder DURING their move (not at move-end). Movement engine must fire per-step.

**Next:** Batch 32 (next 10 CCs after Disorient).
