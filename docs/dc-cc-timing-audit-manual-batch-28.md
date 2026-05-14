# DC/CC Timing Audit — Manual Triage Batch 28

Scope: Command Cards alphabetical after "Change of Plans", 10 cards:
Chaotic Force, Cheat to Win, Choose a Side, Cloned Reinforcements,
Close and Personal, Close the Gap, Collateral Damage, Collect Intel,
Combat Resupply, Comm Disruption.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Chaotic Force

**Effect** — "Any Figure, cost 2, startOfRound. Use if your affiliation is SCUM. Each player chooses up to 3 figures. Roll 1 green die. Each of those figures suffers Strain equal to the Accuracy result."
- Impl: `Chaotic Force` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoR timing + SCUM affiliation gate, (b) dual-player figure picker (both players pick up to 3 of their own — parallel to Balancing Force batch 25), (c) 1 green die roll (shared), (d) each chosen figure suffers Accuracy-result Strain via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire per figure), (e) note: green die has Accuracy faces, not Damage — Strain = Accuracy value rolled.

---

## Cheat to Win

**Effect** — "Lando Calrissian, cost 1, useWhenYouUseGambit. Use when you use 'Gambit', after rolling the new die. You may change that die's result to another result of your choice on that die."
- Impl: `Cheat to Win` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Lando only, (b) trigger: Gambit (CC) has been played AND its new die was rolled, (c) timing window: between the Gambit roll and the result being committed to the pool, (d) picker: Lando's player picks any other face of THAT specific die (6 faces typically — picks one of the 5 others), (e) chosen face replaces the rolled result.

---

## Choose a Side

**Effect** — "Gar Saxon, cost 1, duringActivation. During this round, other friendly Mobile figures gain the following abilities based on your army affiliation: SCUM: 'Personal Combat Shield' / IMPERIAL: 'Gar Saxon's Flamethrower'."
- Impl: `Choose a Side` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Gar Saxon only, (b) during-activation timing, (c) round-long buff on other friendly Mobile figures (Mobile keyword filter), (d) affiliation branch: SCUM → "Personal Combat Shield" passive added (look up that ability's effect); IMPERIAL → "Gar Saxon's Flamethrower" added, (e) ability injection mechanism on each affected figure (effectivePassives or similar layer).

---

## Cloned Reinforcements

**Effect** — "Dr. Royce Hemlock, cost 2, doubleActionSpecial. Choose a defeated friendly non-DROID, non-unique TROOPER with cost ≤ 4 and place it in an empty adjacent space."
- Impl: `Cloned Reinforcements` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Hemlock only, (b) DOUBLE action special (2 actions, costs both of activator's action budget), (c) picker: defeated friendly figures filtered by non-DROID + non-unique + TROOPER + cost ≤ 4, (d) place picker: empty adjacent space to Hemlock, (e) revive mechanic: figure rejoins board at full HP, group's defeat state resets, (f) score adjustments: VPs awarded for the prior defeat stay; opponent doesn't lose them.

---

## Close and Personal

**Effect** — "Biv Bodhrik, cost 1, duringActivation. Move up to 2 spaces. Then perform a melee attack without using an action using 1 red and 1 yellow die. Attack uses only: Pierce 1, Surge: +1 Hit, Surge: Stun."
- Impl: `Close and Personal` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Biv Bodhrik only, (b) 2-space Move-X (bypassCosts per alexanbv 2026-05-13 since "move 2 spaces"), (c) free melee attack with pendingOverrideAttackDice (figkey-keyed post-2026-05-13) set to {dice: ['red','yellow'], type: 'melee', pierce: 1, blockSurgeAbilities: true}, (d) surge override: only +1 Hit and Stun available during this attack (not Biv's normal surges) — needs surge-pool replacement mechanic.

---

## Close the Gap

**Effect** — "Any Figure, cost 3, startOfRound. Each friendly BRAWLER may move up to 2 spaces. Then each friendly BRAWLER within 4 spaces of a hostile figure gains 1 Armor Token."
- Impl: `Close the Gap` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SoR timing, (b) iterate each friendly BRAWLER: prompt Use/Skip for 2-space Move-X with bypassCosts, (c) after all moves resolve, second pass: BRAWLERs within path-4 of any hostile get 1 Armor Token via grantPowerTokens, (d) Armor Token = standard PT type (verify which type maps to Armor — alexanbv 2026-05-08 note: "All Power Tokens Use 'Damage' Type — No Separate 'Hit' Token Type Exists"; Armor Token is probably Block).

---

## Collateral Damage

**Effect** — "HEAVY WEAPON, cost 1, afterAttack. Choose a figure or object other than the defender within 2 spaces of the target space. That figure or object suffers 2 Damage."
- Impl: `Collateral Damage` keyed at 2 sites.
- ⚠️ suspicious — verify (a) HEAVY WEAPON playableBy, (b) post-attack timing, (c) picker: figures + objects within path-2 of target space, excluding defender, (d) 2 Damage via standard pipeline (object damage hook for objects).

---

## Collect Intel

**Effect** — "Any Figure, cost 1, startOfRound. Use if you have 1 or more SPIES on the map. Look at your opponent's hand of Command cards."
- Impl: `Collect Intel` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoR + SPY-on-map gate, (b) Use: opponent's hand revealed to the playing player ONLY (not the public log) — private hand-channel ephemeral message per privacy commit, (c) one-time look — opponent's hand isn't continuously visible.

---

## Combat Resupply

**Effect** — "IMPERIAL, cost 1, duringActivation. Distribute Hit tokens equal to the current round number to friendly figures within 3 spaces."
- Impl: `Combat Resupply` keyed at 2 sites; abilities.js:4753 (`pendingCombatResupply` flag).
- ⚠️ suspicious — verify (a) IMPERIAL playableBy, (b) during-activation, (c) N = current round, (d) distribute Hit tokens (=Damage tokens per alexanbv 2026-05-08 ruling) to friendly figures within path-3 of activator, (e) sequential picker for each token allocation (per existing impl pattern with pendingCombatResupply state), (f) per-figure PT max-cap clamping.

---

## Comm Disruption

**Effect** — "Any Figure, cost 2, whenCommandCardPlayed. Use when a Command card with cost X is played, where X ≤ number of friendly SPY groups on the map. Discard that card and cancel its effects."
- Impl: `Comm Disruption` keyed at 16 sites.
- ⚠️ suspicious — verify (a) on-CC-play trigger fires for opponent's CC, (b) cost check: target CC's cost ≤ number of SPY groups on board (each E-Web counts? or named SPYs only?), (c) Use: discard target CC + cancel effects (full rollback if any partial application happened? or just suppress before resolveAbility runs?), (d) timing: must be before target CC's effects apply.

---

## Batch 28 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Cloned Reinforcements revive mechanic** — defeated figure placed back in adjacent space at full HP. Group defeat state must reset; VP scoring stays.

2. **Choose a Side cross-figure passive injection** — round-long ability added to "Mobile figures" based on affiliation. Per-figure effectivePassives layer mutation.

3. **Comm Disruption cancel-CC mechanic** — pre-resolve interrupt that fully suppresses target CC. Must fire BEFORE applyAbilityResult to avoid partial-effect rollback.

4. **Collect Intel hand-reveal to attacker** — opponent's hand visible only to CI player. Private hand-channel ephemeral display required (NOT public log).

5. **Close and Personal surge-pool replacement** — attack uses ONLY 3 specified abilities; Biv's normal surge pool is suppressed. Surge-pool override mechanic distinct from standard pendingOverrideAttackDice.

6. **Close the Gap 2-step (move-all-BRAWLERs → token-all-within-4)** — iterate twice through the BRAWLER list with different filters. Multi-step Discord chain.

**Next:** Batch 29 (next 10 CCs after Comm Disruption).
