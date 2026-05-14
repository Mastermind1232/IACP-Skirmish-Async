# DC/CC Timing Audit — Manual Triage Batch 21

Scope: Skirmish Upgrades alphabetical after [Imperial Retrofitting],
10 cards: [Indentured Jester], [Last Resort], [Lie in Ambush],
[Mortar Trooper], [Motivation], [Nemik's Manifesto], [On a Diplomatic
Mission], [Orbital Bombardment], [Overwatch], [Prey on the Weak].

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## [Indentured Jester]

**Effect** — "UNIQUE FIGURE ONLY. At the start of the mission, place the Salacious B. Crumb companion in your space. Salacious B. Crumb activates at the start or end of your activation. Salacious B. Crumb is not counted for the purposes of control."
- Impl: `Indentured Jester` keyed at 4 sites.
- ⚠️ suspicious — verify (a) UNIQUE only validation, (b) mission-start placement of Crumb companion in attached figure's space, (c) Crumb activation timing inherited from owner (start OR end of owner's activation — player choice or always one?), (d) Crumb excluded from control-counting (terminal/mission control). Crumb's own Swipe + Scratch are NO IMPL per batch 14 audit — separate issue.

---

## [Last Resort]

**Effect** — "Deplete this card when a figure in this group has suffered Damage equal to its Health. Before that figure is defeated, roll 1 red die. Each figure and object on or adjacent to that figure suffers Damage equal to the Damage results."
- Impl: `Last Resort` keyed at 7 sites; `pendingLastResort` flag.
- ⚠️ suspicious — verify (a) BEFORE_DEFEATED hook (per the 2026-05-08 defeat-timing rewrite — fires before reduceHp completes the kill), (b) Use/Skip prompt to LR-holder's player, (c) Use: deplete card + roll 1 red die + apply Damage to all figures+objects on/adjacent to dying figure (object damage pipeline alexanbv 2026-05-10), (d) THEN the original figure proceeds to defeated.

---

## [Lie in Ambush]

**Effect** — "NON-MASSIVE, NON-UNIQUE ONLY. Before Deployment, set one of your groups aside, out of play, and attach this to it. This group does not deploy during deployment. After an opponent activates a group, if you have 3 or more exhausted or defeated groups and it is not the first round, deploy this group to any deployment zone."
- Impl: `Lie in Ambush` keyed at 7 sites; `lieInAmbushSetAside` field per the deploy-bridge logic.
- ⚠️ suspicious — verify (a) NON-MASSIVE / NON-UNIQUE validation, (b) deploy-phase: LiA group set aside, not deployed, (c) trigger condition: opponent activates → check 3+ exhausted/defeated groups + round > 1, (d) deploy picker for LiA-holder to choose deployment zone, (e) deploys the figures with full health (no carry-over Damage), (f) free-deploy-after-activation flow.

---

## [Mortar Trooper]

**Effect** — "SHORETROOPER ONLY. Double Action Special (Fire Mission): Perform an attack. You may draw line of sight from any figure in this group, but still measure range from this figure. Apply Blast 1 to the attack results. Guidance Systems: While attacking, you may apply -1 Damage and +2 Accuracy to the attack results. This ability may be used multiple times per attack. Haul: While moving, treat blocking and impassable terrain as difficult terrain."
- Impl: `Mortar Trooper` keyed at 7 sites; `fireMissionActive` figkey-keyed (migrated 2026-05-13 batch 6).
- ⚠️ suspicious — verify (a) SHORETROOPER-only validation, (b) Fire Mission special action: 2 actions, sets fireMissionActive[figKey], LoS from any in-group figure during target picker, range still from acting figure, +Blast 1, (c) Guidance Systems: attacker bucket button "Apply -1 Damage +2 Accuracy" with REPEATING usability (can fire multiple times in one attack), (d) Haul: movement validator treats blocking+impassable as difficult (2 MP cost) for Mortar Trooper figures.

---

## [Motivation]

**Effect** — "UNIQUE FIGURE ONLY. Exhaust this card during your activation and choose a friendly figure with a lower figure cost than you with a line of sight to you. That figure may discard a HARMFUL condition or recover 1 Damage. Then, that figure gains 1 movement point."
- Impl: `Motivation` keyed at 5 sites; `pendingMotivation` flag.
- ⚠️ suspicious — verify (a) UNIQUE only attaches, (b) action button on attached figure's DC, (c) picker: friendly figures with cost < attached unique's cost AND LoS to attached, (d) chosen figure picks: discard harmful OR recover 1 (or skip), (e) chosen figure gains 1 MP via grantMovementBank (figureKey-keyed per 2026-05-13 perFig migration), (f) exhaust-once-per-round.

---

## [Nemik's Manifesto]

**Effect** — "Your command deck may include up to 3 additional Command cards. Exhaust this card during a friendly figure's activation to have that figure suffer 2 Strain and gain 1 movement point."
- Impl: `Nemik's Manifesto` keyed at 3 sites.
- ⚠️ suspicious — verify (a) build-time: +3 CC count limit (validation), (b) during-activation: any friendly figure (no restrictions), 2 Strain via applyStrain (so Fireproof/Headhunter/Submit-or-Fight fire) + 1 MP grant, (c) per alexanbv 2026-05-13: 1 MP grant — is this in-activation (bank) or Move-X style? Bank for in-activation use seems right since it's "during activation", (d) exhaust-once-per-round.

---

## [On a Diplomatic Mission]

**Effect** — "LEADER ONLY. Exhaust this card at the end of your activation, if you did not perform an attack, to choose one of the following: 2 MP / +1 Evade until EoR / 1 VP."
- Impl: `On a Diplomatic Mission` keyed at 4 sites; `diplomaticMissionEvade` flag.
- ⚠️ suspicious — verify (a) LEADER-only validation, (b) EoA hook: check `attackPerformedThisActivation[figureKey]` (figkey-keyed post-2026-05-13) — if NOT attacked this activation, fire prompt, (c) 3-option picker: MP (grant via grantMovementBank? but EoA — does MP carry to next activation?), Evade-until-EoR (round-scoped per-figure flag), or 1 VP, (d) exhaust-once-per-round.

---

## [Orbital Bombardment]

**Effect** — "UNIQUE FIGURE WITH FIGURE COST 4 OR MORE ONLY. Special Action: Place Bombardment tokens on this card equal to the current round number. Then, you may perform an attack. You may deplete this card at the start of your activation to choose a number of spaces equal to the number of Bombardment tokens that were on this card. Each figure on a chosen space suffers 2 Damage."
- Impl: `Orbital Bombardment` keyed at 5 sites; `pendingOrbitalBombardment` flag.
- ⚠️ suspicious — verify (a) UNIQUE + cost≥4 validation, (b) Special Action: place N Bombardment tokens (N = current round), free attack also offered, (c) SoA deplete: pick N spaces, each space's figures suffer 2 Damage via standard damage pipeline, (d) "spaces" picker: N independent space picks (each spaceN can be chosen separately), (e) once-per-game deplete since this is "deplete" not "exhaust".

---

## [Overwatch]

**Effect** — "E-WEB ENGINEER ONLY. Choose an Overwatch token to be associated with this group. Figures in this group gain: Special Action: Place this group's Overwatch token in a space within your line of sight. Exhaust this card when a hostile figure enters a space on or adjacent to this group's Overwatch token to interrupt to perform an attack targeting that figure. Then remove that Overwatch token."
- Impl: `Overwatch` keyed at 16 sites; `pendingOverwatchPlacement` flag.
- ⚠️ suspicious — verify (a) E-WEB ENGINEER only, (b) special action: place Overwatch token within LoS (range-? — full LoS?), (c) movement-trigger: opponent entering on-or-adjacent to token fires interrupt prompt, (d) Use: E-WEB attacks the entering figure (free attack), (e) remove token after attack, (f) exhaust-once-per-round, (g) token is per-group (each Overwatch SU has its own token).

---

## [Prey on the Weak]

**Effect** — "HUNTER ONLY. While attacking a figure with a figure cost lower than yours, apply Pierce 1 and +1 Accuracy to the attack results."
- Impl: `Prey on the Weak` keyed at 1 site.
- ⚠️ suspicious — verify (a) HUNTER-only validation, (b) step-4 attacker mod gated on `defenderCost < attackerCost` (need cost lookup for both DCs from stats), (c) +1 Pierce and +1 Accuracy applied to attack results.

---

## Batch 21 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **[Indentured Jester] Salacious B. Crumb companion lifecycle** — Crumb's own Swipe + Scratch are NO IMPL per batch 14. Need to wire those for Crumb to actually do anything in-game. The SU attachment itself looks plausibly wired.

2. **[Last Resort] BEFORE_DEFEATED + object damage** — fires BEFORE the kill completes; rolls 1 red die; damages all figures AND objects on/adjacent. Object-damage pipeline alexanbv 2026-05-10 mark.

3. **[Lie in Ambush] deploy-after-activation flow** — needs the 3+exhausted/defeated check + round>1 gate + deploy-zone picker. Multi-step setup-extension.

4. **[Mortar Trooper] Guidance Systems repeating bucket** — attacker bucket button that can be clicked MULTIPLE times per attack (each click: -1 Damage / +2 Accuracy). Non-standard reroll-bucket UI; verify the click handler doesn't disable after one use.

5. **[Orbital Bombardment] N-space picker** — N = current round = a variable number of independent space picks. Multi-step Discord chain.

6. **[Overwatch] movement-trigger entry detection** — interrupt when hostile enters on/adjacent to the token. Movement engine must fire the trigger DURING the move (not at move-end).

**Next:** Batch 22 (next 10 SUs after [Prey on the Weak]).
