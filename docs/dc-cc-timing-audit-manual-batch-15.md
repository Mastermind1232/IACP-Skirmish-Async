# DC/CC Timing Audit — Manual Triage Batch 15

Scope: DCs alphabetical after Sentry Droid (Elite), 10 cards: Sentry
Droid (Regular), Shoretrooper (Elite), Shyla Varad, Snowtrooper
(Elite), Snowtrooper (Regular), Stormtrooper (Elite), Stormtrooper
(Regular), Super Commando (Elite), Taron Malicos, Tauntaun Rider.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Sentry Droid (Regular)

**Multi-Fire / Charged Shot / Targeting Computer** — shared family with Elite. See batch 14 Sentry Droid Elite entry.
- ✅ correct (Multi-Fire migrated 2026-05-13 figureKey-keyed; Charged Shot uses nextAttackBonusAccuracy figureKey-keyed; Targeting Computer is the shared reroll bucket).

---

## Shoretrooper (Elite)

**Squad Training** — "While attacking, while adjacent to another friendly TROOPER, you may reroll 1 attack die."
- Impl: `squad_training_shoretrooper_elite` keyed at 1 site.
- ⚠️ suspicious — verify (a) attacker reroll bucket gated on "adjacent friendly TROOPER" check (path-1 + keyword filter, excluding self), (b) named reroll bucket fires once per attack, (c) per alexanbv 2026-05-13 figureKey-keyed (each Shoretrooper figure in the multifig group has its own reroll opportunity).

**Efficient Travel (passive)** — see destruct's CRR ruling: "Efficient Travel: difficult terrain costs 1 MP instead of 2." Shared family.
- ⚠️ suspicious — verify the movement validator's terrain-cost calculation honors Efficient Travel per the figure's keyword/passive list.

---

## Shyla Varad

**Special Action (Mandalorian Whip)** — "Choose a SMALL, hostile figure within 3 spaces and line of sight. Push that figure up to 3 spaces to a space adjacent to you. Then, perform an attack targeting that figure."
- Impl: `src/game/abilities.js:321` (`pushTargetWithinRange`) + library descriptor `mandalorian_whip`.
- ✅ correct — forcedAttackTarget migrated to per-figureKey (commit `76283c7e`); post-push free attack pipeline is the canonical path. Verify (a) SMALL filter at picker, (b) range-3 + LoS gate, (c) push-up-to-3 lands adjacent to Shyla, (d) free attack auto-granted post-push.

**Responsive** — "At the start of your activation, you may gain 1 movement point or recover 1 Damage."
- Impl: `responsive_shyla` — NO src hits.
- ⚠️ suspicious — Responsive needs SoA picker (MP / Heal / Skip). Likely wired through soa-orchestrator with a generic descriptor. Worth verifying the orchestrator enumerates Responsive.

---

## Snowtrooper (Elite & Regular)

**Special Action (Disruptor Rifle)** (Elite only) — "Perform an attack. After this attack resolves, if it did not miss and the target has suffered Damage equal to its Health minus 1, the target suffers 1 Damage."
- Impl: `src/game/abilities.js:2411` — disruptorRiflePending figureKey-keyed (post-2026-05-13 migration).
- ⚠️ suspicious — verify (a) post-attack hook fires only on non-miss, (b) condition: defender HP after attack equals 1 (Health - 1 damage), (c) 1 additional Damage via standard pipeline.

**Spiked Boots** (Elite only) — "You cannot be pushed out of your space except by MASSIVE figures."
- Impl: `spiked_boots_snowtrooper` keyed at 5 sites in src/.
- ⚠️ suspicious — verify (a) push-validator checks Spiked Boots passive on push-target, (b) MASSIVE pusher overrides the immunity, (c) applies to all push types (Force Push, Looking for a Fight, Slam, Rush, Shoulder Rush, Headbutt, Knockback, etc.).

**Immune** (Elite only) — "You cannot gain HARMFUL conditions."
- Impl: shared `isConditionImmune` pattern (immune_snowtrooper_elite at 2 sites).
- ✅ correct (audited as part of the condition pipeline).

**Special Action (Environmental Recovery Gear)** (Regular only) — "You and each adjacent friendly TROOPER may either recover 1 Damage or discard 1 HARMFUL condition."
- Impl: `env_recovery_gear` — no src hit by id; lib has descriptor. Code at `src/game/abilities.js:5551` references `entry.label === 'Environmental Recovery Gear'`.
- ⚠️ suspicious — verify (a) picker enumerates SELF + adjacent friendly TROOPERs (path-1 + keyword filter), (b) per-target choice: recover 1 OR discard 1 harmful condition (or skip per target), (c) "may" → Skip option on each target.

---

## Stormtrooper (Elite & Regular)

**Squad Training** — same as Shoretrooper.
- ⚠️ suspicious — same verification list.

**Last Stand** (Elite only) — "When you are defeated, choose another figure in your group. That figure becomes Focused."
- Impl: `last_stand` keyed at 3 sites in src/.
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook fires on this specific Stormtrooper Elite figure's defeat, (b) "another figure in your group" picker (excludes self; same-msgId siblings only), (c) Focus applied via standard `applyCondition` (immunity respected), (d) Mara picker pattern queued per the alexanbv 2026-05-10 audit Part 2 — Final Stand pattern with Mara hasn't shipped; verify this is the older inline path still.

---

## Super Commando (Elite)

**Jetpack Rocket** — "Once per figure per round, you may spend 2 movement points to choose a hostile figure within 3 spaces and line of sight. Roll 1 blue die. That figure suffers Damage equal to the Damage results."
- Impl: `src/game/abilities.js:2975` — Jetpack Rocket style (`rollOneDieTarget` generic) + library descriptor `jetpack_rocket`.
- ⚠️ suspicious — verify (a) MP-cost gate (2 MP required) deducts from the activating figure's bank, (b) range-3 + LoS hostile picker, (c) 1 blue die roll, (d) Damage applied via standard pipeline, (e) "once per FIGURE per round" gate via `roundFigureAbilityUsed[jetpackRocket_<figureKey>]`.

**Shield Gauntlets** — "Once during your activation, you may spend 1 movement point to gain 1 Block token."
- Impl: `src/game/abilities.js:2548` (`spendMpForBlockToken`).
- ⚠️ suspicious — verify (a) MP-cost gate (1 MP), (b) Block token granted via `grantPowerTokens`, (c) once-per-activation gate keyed per-figureKey (alexanbv 2026-05-11 oncePer enforcement note).

**Mobile / Professional / +2 Accuracy / Pierce 1** — shared passive families.
- ⚠️ suspicious — verify per-figure passive application (each Super Commando figure in the group benefits independently).

---

## Taron Malicos

**Fallen Master (passive)** — "Friendly non-companion FORCE USER figures may ignore the IMPERIAL restriction when using Command cards."
- Impl: `fallen_master_malicos` keyed at 1 site.
- ⚠️ suspicious — verify (a) CC-play validator's playableBy/restriction check has a Fallen Master bypass for friendly non-companion FORCE USER figures, (b) bypass applies to IMPERIAL keyword restrictions only (not other faction restrictions), (c) Malicos's own group membership doesn't matter — the bypass applies to other FORCE USERs in the army.

**Madness** — "At the start of your activation, if you have 2 or fewer Command cards in your hand, you suffer 1 Strain and become Focused."
- Impl: NO `madness_malicos` id; passives section doesn't list "Madness" either.
- — no impl OR ⚠️ suspicious — Madness needs SoA hook that reads `game[ccHandKey(playerNum)].length`, applies Strain (via `applyStrain` pipeline so Fireproof/Headhunter/Submit-or-Fight fire) + Focus.

**Special Action (Boulder Barrage)** — "Choose a space in your line of sight. Any figure on that space suffers 2 Damage. Then place a Rubble token in or adjacent to that space."
- Impl: descriptor `boulder_barrage` in library; src likely uses generic LoS-space-picker + rubble placement.
- ⚠️ suspicious — verify (a) range-? + LoS space picker (card doesn't specify range — full LoS?), (b) figure on space takes 2 Damage via standard pipeline, (c) Rubble token placed in OR ADJACENT (player's choice) — needs a second picker for the rubble target space.

---

## Tauntaun Rider

**Mounted (passive)** — "At the start of your activation, gain 3 movement points."
- Impl: `mounted` keyed at 2 sites (shared `mounted_*` family — Dewback, Kuiil, Terro).
- ⚠️ suspicious — verify (a) SoA hook for Mounted (per-figure activation start), (b) 3 MP granted to the activating figure's perFig bank (per the 2026-05-13 perFig migration), (c) gain happens at SoA, not deploy.

**Special Action (Headbutt)** — "Move up to 2 spaces, then choose an adjacent hostile figure and roll 1 red die. The chosen figure suffers Damage equal to the Damage results."
- Impl: `headbutt_tauntaun` keyed at 1 site.
- ⚠️ suspicious — verify (a) 2-space Move-X picker with bypassCosts (Move-X per alexanbv 2026-05-13 ignores bonus costs), (b) AFTER move drains, present adjacent-hostile picker, (c) 1 red die roll + Damage via standard pipeline.

**Useful Hide** — "When this figure is defeated, distribute up to 2 Evade Tokens among friendly figures."
- Impl: `useful_hide` keyed at 1 site (shared family).
- ⚠️ suspicious — verify (a) WHEN_DEFEATED hook fires on Tauntaun Rider's defeat, (b) picker presents friendly figures (no range limit), (c) distribute up to 2 tokens (player can give 0/1/2; can split across figures or stack on one), (d) Evade tokens granted via `grantPowerTokens` with max-cap enforcement.

**Efficient Travel / Pierce 1** — shared passive families.

---

## Batch 15 — Summary

- ✅ correct: 4 (Multi-Fire, Charged Shot, Targeting Computer, Mandalorian Whip, Immune Snowtrooper Elite — recently audited)
- ⚠️ suspicious: 22
- ❌ wrong-stage: 0
- — no impl: 2 (Responsive Shyla potential, Madness Malicos)

**Highest-priority items surfaced:**

1. **Taron Malicos Madness** — NO IMPL OR wired via undocumented path. Needs SoA hook + hand-size check + Strain pipeline + Focus.

2. **Shyla Varad Responsive** — SoA "MP or Heal" picker not obviously wired. Audit soa-orchestrator descriptors for Responsive.

3. **Super Commando Jetpack Rocket once-per-FIGURE gate** — card says "once per figure per round" (not once per activation, not once per round per group). Verify roundFigureAbilityUsed keyed by figureKey, not msgId.

4. **Boulder Barrage Rubble placement** — player chooses "on space OR adjacent to space" for Rubble after the 2-Damage hit lands. Needs a second picker between damage-apply and rubble-place.

5. **Last Stand (Stormtrooper Elite) Mara picker pattern** — per the alexanbv 2026-05-10 audit Part 2, Final Stand's Mara picker pattern was queued but Last Stand's same pattern needs verification. Currently using older inline path.

**Next:** Batch 16 (DCs alphabetical after Tauntaun Rider).
