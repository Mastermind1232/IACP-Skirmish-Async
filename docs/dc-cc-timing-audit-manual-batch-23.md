# DC/CC Timing Audit — Manual Triage Batch 23

Scope: Skirmish Upgrades alphabetical after [Spectre Cell], 10 cards:
[Suppressive Fire], [Survivalist], [Targeting Computer], [Technician
Training], [Temporary Alliance (M)], [Temporary Alliance],
[The Darksaber], [The General's Ranks], [Trusted Ally], [Under Duress].

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## [Suppressive Fire]

**Effect** — "TROOPER OR HEAVY WEAPON ONLY. Exhaust this card after you resolve a Ranged attack. If the attack did not miss, the target becomes Weakened. Then, you may choose another SMALL friendly figure within 3 spaces. The chosen figure gains 2 movement points."
- Impl: `Suppressive Fire` keyed at 4 sites; `pendingSuppressiveFireMp` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) TROOPER/HEAVY WEAPON only, (b) post-Ranged-attack hook (gated on attackInfo.type === 'range'), (c) Use/Skip prompt, (d) Use: target Weaken via applyCondition + SMALL-friendly-within-3 picker → chosen figure +2 MP grant via grantMovementBank (per perFig migration 2026-05-13), (e) exhaust-once-per-round.

---

## [Survivalist]

**Effect** — "HUNTER OR TROOPER ONLY. You ignore additional movement point costs for difficult terrain and hostile figures. At the end of each round, if you are in an exterior space, you recover 1 Damage."
- Impl: `Survivalist` keyed at 3 sites.
- ⚠️ suspicious — verify (a) HUNTER/TROOPER only validation, (b) movement validator: Survivalist passive ignores difficult-terrain (+0 cost instead of +1) AND hostile-figure pass-through cost (same as Efficient Travel), (c) EoR exterior-space recovery: needs map-data "exterior" tag per space, per-figure heal of 1 via standard heal pipeline.

---

## [Targeting Computer]

**Effect** — "VEHICLE, DROID, OR HEAVY WEAPON ONLY. While attacking, figures in this group may reroll 1 attack die."
- Impl: `Targeting Computer` SU keyed at 4 sites (shared with Probe Droid Elite's Targeting Computer passive via the shared targeting-computer-helpers module).
- ⚠️ suspicious — verify (a) VEHICLE/DROID/HEAVY WEAPON only validation, (b) attacker reroll bucket fires while ANY figure in attached group attacks, (c) named reroll bucket once per attack — but with multiple group members, each can use their own targeting computer? CRR check.

---

## [Technician Training]

**Effect** — "All figures in all armies with the names listed below gain the TECHNICIAN trait. C1-10P, Jarrod Kelvin, Mak Eskha'rey, R2-D2, Chewbacca, Jawa Scavenger, Ugnaught Tinkerer, Doctor Aphra, Zuckuss, E-Web Engineer, General Sorin."
- Impl: NO src hits for "Technician Training". The TECHNICIAN trait addition is build-time only.
- — no impl OR ⚠️ suspicious — Build-time effectiveKeywords adjustment. Verify the named DC list gets TECHNICIAN added when this SU is in either player's army. CRR-check: does this fire passively for both armies as soon as either includes the SU? Or only when attached?

---

## [Temporary Alliance] / [Temporary Alliance (M)]

**Effect** — "You may include up to 2 REBEL/SCUM Deployment cards in your army."
- Impl: `Temporary Alliance` keyed at 2 sites.
- ⚠️ suspicious — pure army-build validation. Verify the deck-builder honors the 2-card REBEL/SCUM cap when one is present. No runtime triggers expected.

---

## [The Darksaber]

**Effect** — "MAUL OR SABINE WREN ONLY. If you are a FORCE USER, you may use IMPERIAL Command cards. Exhaust this card while attacking to reroll 1 attack die. Special Action: Perform a Melee attack with 1 red die. Treat Blast X as Cleave X during this attack. Then you may perform an attack."
- Impl: `The Darksaber` keyed at 6 sites; `darksaberSecondAttack` figkey-keyed (migrated 2026-05-13); `darksaberBlastToCleave` flag.
- ⚠️ suspicious — verify (a) Maul/Sabine only validation, (b) FORCE USER → IMPERIAL CC restriction bypass, (c) attacker reroll bucket exhaust-button, (d) Special Action: pendingOverrideAttackDice (figkey-keyed post-2026-05-13) with red+melee+darksaberBlastToCleave, (e) Blast surge results convert to Cleave during this attack, (f) darksaberSecondAttack figkey-keyed grants free attack after first resolves.

---

## [The General's Ranks]

**Effect** — "NON-UNIQUE ONLY. When you perform a move, if it is not your activation, you gain 2 additional movement points. When you perform an attack, if it is not your activation, apply +1 Damage to the attack results."
- Impl: `The General's Ranks` keyed at 2 sites; dc-play-area.js handles the bonus MP detection.
- ⚠️ suspicious — verify (a) NON-UNIQUE only attaches, (b) out-of-activation move: +2 MP added at Move-action time (per the existing line in dc-play-area.js:2103 detection), (c) out-of-activation attack: +1 Damage at step-4 mod, (d) "not your activation" detection: probably uses `game.dcActionsData?.[msgId]?.threadId` absence as proxy.

---

## [Trusted Ally]

**Effect** — "DROID ONLY. Exhaust this card while another friendly figure within 3 spaces is attacking. It may reroll 1 attack die. Exhaust this card during your activation. An adjacent friendly figure recovers 1 Damage or discards 1 HARMFUL condition."
- Impl: `Trusted Ally` keyed at 5 sites; `pendingTrustedAlly` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) DROID only, (b) friendly-attack hook with TA-attached DROID within path-3 of attacker offering reroll bucket, (c) during-own-activation: adjacent friendly picker + heal-or-condition picker (3-button), (d) exhaust-once-per-round shared across both effects.

---

## [Under Duress]

**Effect** — "When a hostile figure suffers Strain, for each resulting Damage they wish to prevent, the player controlling that figure must discard 2 Command cards from the top of their deck instead of 1. Deplete this card when a hostile figure suffers Strain to resolve any choices for that Strain instead of your opponent."
- Impl: `Under Duress` keyed at 15 sites.
- ⚠️ suspicious — verify (a) applyStrain pipeline hook: when hostile suffers Strain, doubles the deck-top-discard cost-per-Damage from 1 to 2, (b) deplete-on-trigger: UD-holder resolves the Strain choices instead of the opponent (e.g., picker for "prevent damage by discarding" vs "take damage"), (c) deplete = once per game.

---

## Batch 23 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 ([Technician Training] — verify build-time trait addition)

**Highest-priority items surfaced:**

1. **[Technician Training] cross-army trait addition** — applies to BOTH players' armies based on EITHER having the SU. Build-time effectiveKeywords adjustment that affects opponent's figures too. Unusual scope.

2. **[The Darksaber] Maul/Sabine + IMPERIAL CC bypass** — FORCE USER restriction expansion lets Maul play IMPERIAL CCs (or Sabine if she's a FORCE USER variant, which she isn't normally). Restriction-bypass mechanic.

3. **[Under Duress] strain-choice-resolution takeover** — UD-holder makes the Strain-prevention decisions for the opponent. Deplete trigger; opponent loses agency for this Strain instance.

4. **[Trusted Ally] within-3 friendly attack reroll** — Trusted Ally fires for ANY friendly attack within 3 of its DROID host, not just same-group attacks. Cross-group reroll bucket.

5. **[Targeting Computer] SU vs Probe Droid passive sharing** — both use the targeting-computer-helpers module. Verify the SU version's eligibility check differs from the Probe Droid passive version.

6. **[Survivalist] EoR exterior-space heal** — needs map-data "exterior" tag per space. Verify the IACP map data schema includes interior/exterior space typing.

**Next:** Batch 24 (next 10 SUs after [Under Duress]).
