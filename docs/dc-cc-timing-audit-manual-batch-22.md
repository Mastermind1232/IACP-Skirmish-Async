# DC/CC Timing Audit — Manual Triage Batch 22

Scope: Skirmish Upgrades alphabetical after [Prey on the Weak], 10 cards:
[Punishing Strike], [Rebel High Command], [Rogue One], [Rogue Smuggler],
[Rule by Fear], [Scavenged Walker], [Scavenged Weaponry],
[Smuggler's Run], [Smuggling Compartment], [Spectre Cell].

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## [Punishing Strike]

**Effect** — "Exhaust this card when one of your figures applies a HARMFUL condition to a figure. Discard that condition and apply a different HARMFUL condition of your choice."
- Impl: `Punishing Strike` keyed at 5 sites; `pendingPunishingStrike` flag + `handlePunishingStrike` handler in interrupts.js.
- ⚠️ suspicious — verify (a) condition-apply pipeline hook fires when own figure applies HARMFUL (Stun/Bleed/Weaken/Strain? — Strain typically isn't a condition card); (b) Use/Skip prompt, (c) Use: filterCondition removes the just-applied condition, picker for a DIFFERENT HARMFUL condition, applyCondition for the new one, (d) exhaust-once-per-round, (e) trigger fires for ALL friendly figures' condition applies (not just attached holder).

---

## [Rebel High Command]

**Effect** — "At the end of each game round, draw 1 additional Command card."
- Impl: `Rebel High Command` keyed at 1 site; round.js EoR draw logic includes RHC detection.
- ⚠️ suspicious — verify (a) EoR draw count incremented by 1 when RHC is attached, (b) drawn card stays SECRET per alexanbv 2026-05-13 (count-only public log — already verified in earlier audit), (c) once per round.

---

## [Rogue One]

**Effect** — "Your army must include Baze, Bodhi, Cassian, Chirrut, Jyn, K-2SO, and cannot include other unique figures that cost 3 or less. While a friendly figure listed above is attacking, it may discard 1 Power Token of any type from another friendly figure to add +1 Damage to the attack results. At the start of the first game round, draw 3 Command cards, then place 2 Command cards from your hand on top of your deck."
- Impl: `Rogue One` keyed at 4 sites; `pendingRogueOneTokenPick` flag in ROUND_NULL_FLAGS; round.js handles the SoR1 draw.
- ⚠️ suspicious — verify (a) army-build: required-set + cost-restriction, (b) attacker hook: when listed-friendly attacks, prompt to discard 1 PT from ANOTHER friendly for +1 Damage (Use/Skip + figure picker + PT-type picker), (c) SoR1 draw: 3 CCs drawn (count-only public log per privacy fix), 2 placed back on top of deck (picker in private hand channel).

---

## [Rogue Smuggler]

**Effect** — "HAN SOLO (SCOUNDREL) ONLY. You lose 'Distracting'. While attacking, you may reroll 1 attack die. You can use 'Return Fire' even if you suffered Damage during the attack. Exhaust this card at the end of the round to interrupt to perform an attack."
- Impl: `Rogue Smuggler` keyed at 8 sites.
- ⚠️ suspicious — verify (a) Han (Scoundrel) only attaches, (b) "Distracting" surge ability removed from Han's surge pool, (c) attacker reroll bucket (1 die, named), (d) Return Fire override: bypasses the "0-damage hit" gate for Han specifically (Migs Mayfeld's RF is unconditional; Han's normally requires 0-damage; this override removes that), (e) EoR free attack: interrupt prompt, exhaust-once-per-round.

---

## [Rule by Fear]

**Effect** — "At the start of the first game round, draw 2 Command Cards, then choose 1 card in your hand to discard."
- Impl: `Rule by Fear` keyed at 2 sites; round.js handles SoR1 draw + discard picker.
- ⚠️ suspicious — verify (a) SoR1 trigger, (b) drawCcCards(2) — count-only public log (already verified per privacy commit), (c) discard picker in private hand channel (drewText sent privately per the round.js review), (d) chosen card goes to discard pile (public).

---

## [Scavenged Walker]

**Effect** — "AT-ST OR AT-DP ONLY. Include one of the named groups in your army and attach this card to it. Treat this group's affiliation as SCUM. You lose ASSAULT. After deployment, you may perform a move. At the end of the round, you may interrupt to perform an attack. Apply -1 Damage to the attack results."
- Impl: `Scavenged Walker` keyed at 13 sites; `scavengedWalkerAttackPenalty` flag in ROUND_OBJECT_FLAGS.
- ⚠️ suspicious — verify (a) AT-ST/AT-DP only validation, (b) affiliation reassigned to SCUM (affects deck legality), (c) ASSAULT keyword removed (special-attack-budget impact), (d) post-deploy free move (Use/Skip prompt), (e) EoR free attack with -1 Damage penalty via scavengedWalkerAttackPenalty (msgId-keyed? need to verify; "this group" suggests group-scope might be intentional here, OR figureKey since AT-ST is single-figure).

---

## [Scavenged Weaponry]

**Effect** — "DROID OR VEHICLE ONLY. Exhaust this card when you declare an attack to apply +1 Damage to the attack results. When the last figure in this group is defeated, you may attach this card to a friendly DROID or VEHICLE group. (Your opponent scores VPs for this attachment each time a group it is attached to is defeated.)"
- Impl: `Scavenged Weaponry` keyed at 7 sites; `pendingScavengedWeaponryTransfer` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) DROID/VEHICLE only, (b) on-declare attacker exhaust button for +1 Damage, (c) group-defeat hook (last figure of group dies → WHEN_DEFEATED triggers transfer prompt), (d) Use/Skip + picker for friendly DROID/VEHICLE group to attach to, (e) VP-per-defeat scoring for opponent (each time the attached group is defeated, opponent scores VPs equal to the SW's cost).

---

## [Smuggler's Run]

**Effect** — "SMUGGLER ONLY. Special Action: Deplete this card while you are in your opponent's deployment zone. You gain 5 VPs."
- Impl: `Smuggler's Run` keyed at 2 sites; handled at dc-play-area.js:2647 (audit batch 21 partial reference).
- ⚠️ suspicious — verify (a) SMUGGLER only, (b) special action only valid when activator's figure is on a space in opponent's deployment zone, (c) deplete (not exhaust — once per game), (d) +5 VP via awardObjectiveVp, (e) `inOppZone` check uses opponent's deploy zone definition + figure footprint.

---

## [Smuggling Compartment]

**Effect** — "Before your opponent resolves a Command card or ability, you may exhaust this card to set aside any number of Command cards from your hand. Return them to your hand at the start of the next activation or phase. Before the start of the Status Phase, you may look at the top and bottom cards of your Command deck. You may move 1 of those cards to the top or bottom of your Command deck."
- Impl: NO src hits for "Smuggling Compartment" (confirmed batch 13 audit follow-up).
- — no impl — Both effects need wiring:
  - Effect 1: hand-set-aside hook before opponent resolves a CC/ability (multi-card picker → temporary zone → return at SoA/SoP)
  - Effect 2: pre-Status-Phase look-at-top+bottom picker with optional move (4 buttons: move top→bottom, move bottom→top, skip — picker in private hand channel per alexanbv 2026-05-13 privacy)

---

## [Spectre Cell]

**Effect** — "Include this card in your army only if each group in your army has 'Spectre' or 'Chopper' as part of its sub-name. Friendly figures gain the following passives: +1 Damage, +1 Block. Exhaust this card during a friendly figure's activation to choose another friendly figure. The chosen figure gains 2 movement points and may interrupt to perform an attack."
- Impl: `Spectre Cell` keyed at 3 sites.
- ⚠️ suspicious — verify (a) army-build: each group has Spectre/Chopper in sub-name, (b) all-friendlies passives: +1 Damage attack mod + +1 Block defense mod (step-4 / step-5), (c) during-activation exhaust: picker for OTHER friendly figure (excluding activator), chosen figure gets +2 MP via grantMovementBank (perFig-keyed per the 2026-05-13 perFig migration) + free attack interrupt, (d) exhaust-once-per-round.

---

## Batch 22 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 ([Smuggling Compartment])

**Highest-priority items surfaced:**

1. **[Smuggling Compartment] NO IMPL** — both effects need wiring. Hand-set-aside + return-on-next-phase is a unique zone-state mechanic. Look-at-top-and-bottom picker should go to private hand channel per the alexanbv 2026-05-13 privacy rule.

2. **[Rogue One] SoR1 draw picker** — 3 drawn (count public), 2 placed back on top of deck via private hand-channel picker. Already partially wired per round.js audit; verify the placed-back step.

3. **[Punishing Strike] HARMFUL condition replace** — fires on ANY friendly's condition application (Stun/Bleed/Weaken — not Strain). Verify Strain is correctly excluded from the trigger.

4. **[Scavenged Walker] EoR free attack with -1 Damage** — `scavengedWalkerAttackPenalty` flag application needs to apply specifically to THIS attack (the free attack), not all subsequent attacks. Probably keyed by combat or msgId.

5. **[Scavenged Weaponry] group-defeat transfer** — WHEN_DEFEATED on LAST figure of group; player picks new DROID/VEHICLE group. VP scoring stays attached for the rest of game.

6. **[Spectre Cell] all-friendlies passive +1 Damage / +1 Block** — applies to every friendly figure in the army. Needs step-4 attacker mod + step-5 defender mod for all SC-eligible figures.

**Next:** Batch 23 (next 10 SUs after [Spectre Cell]).
