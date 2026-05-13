# DC/CC Timing Audit — Manual Triage Batch 06

Scope: DCs alphabetical after Echo Base Trooper (Regular), 10 cards:
Emperor Palpatine, Ewok Warrior (Elite), Ezra Bridger, Fenn Signis, Fennec
Shand, Fifth Brother, Gaarkhan, Gamorrean Guard (Elite), Gar Saxon, General
Sorin.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Emperor Palpatine

**Emperor** — "Once during your activation, you may choose another figure within 4 spaces. That figure interrupts to perform an attack."
- Impl: `src/game/abilities.js:898-920` (`emperor_interrupt` keyed) — once-per-activation gate via `game.emperorInterruptUsedThisActivation[msgId]`; chosen figure tagged via `setPendingEmperorInterrupt`. Per alexanbv 2026-05-10 comment in code: Emperor does NOT cost an action.
- ✅ correct — fires during activation as a per-activation interrupt-grant; once-per-activation enforced; granted figure performs free attack via the interrupt-saga pipeline (`src/domain/sagas/interrupt-saga.js`).

**Tempt** — "At the start of your activation, a figure of your choice suffers 1 Damage and gains 1 Damage Token."
- Impl: `src/game/soa-orchestrator.js:753-758` (SoA picker as Tempt bucket entry) + `src/game/abilities.js:1065-1095` (apply 1 dmg + 1 dmg token, defeat-aware). Per alexanbv 2026-05-10 inline comment: **no range restriction + NPCs are valid targets**.
- ⚠️ suspicious — **friendly-fire angle**: card says "a figure of your choice" — does the picker include Palpatine's own figures? In IACP this is canonically yes (Sith are willing to hurt their own minions for VP/strategy). Worth a click-through to confirm own-side figures appear in the picker. Defeat detection via `temptResult.defeatedFigures` looks correct.

**Special Action (Force Lightning)** — "Choose a figure within 4 spaces and line of sight. That figure suffers 3 Damage and becomes Weakened. Each figure adjacent to that figure suffers 1 Damage."
- Impl: `data/ability-library.json:force_lightning` (descriptor) + `src/game/abilities.js` (handler) + `src/game/abilities.test.js` (covered by tests).
- ⚠️ suspicious — verify (a) **LoS gate** to primary target, (b) 3 Damage AND Weaken on primary, (c) 1 Damage to **each** adjacent figure (friend or foe — card says "each figure"). Per IACP "each figure" usually includes both teams; confirm friendly-fire on splash.

---

## Ewok Warrior (Elite)

**Ambush** — "After you are deployed, you become Hidden."
- Impl: post-deploy hook (`Ambush` is in passives, surfaced at post-deploy via `src/game/abilities.js`).
- ✅ correct — fires at post-deploy; applies Hide.

**Forest Fighters** — "While performing a Melee attack, apply +1 Damage to the attack results if you are Hidden."
- Impl: `src/game/forest-fighters-helpers.js:14-22` + `src/handlers/combat.js`. Gate: `isRanged === false` AND attacker has Hide condition. +1 Damage applied to attack results.
- ✅ correct — step-4 attacker modifier; conditional on melee + Hide.

**Special Action (Sling Barrage)** — "Perform a Ranged attack using your printed attack pool. During this attack, you may reroll up to 1 attack die for each other figure in your group with line of sight to the defender."
- Impl: `src/handlers/combat.js:3760-3786` — at step-3 attacker reroll window, enumerates same-group figures with LoS to defender, pushes that many "Sling Barrage #N" entries into the forced-reroll queue.
- ⚠️ suspicious — verify (a) "other figure" excludes the attacking figure itself (only the rest of the group counts), (b) "in your group" uses same-DC-name + same-deployment-group-index (Ewok group has 2 figures, so max 1 reroll for non-attacker; for Elite Ewoks in 1-figure DGs this is 0), (c) the reroll entries are surfaced as a single "Use Sling Barrage" bucket (not N separate buttons) per the 2026-05-13 unified reroll model.

---

## Ezra Bridger

**Brash** — "At the start of each round, move up to 4 spaces."
- Impl: `src/handlers/round.js` (`brash_ezra` keyed at SoR).
- ⚠️ suspicious — **timing edge case**: "at the start of each round" is BEFORE activation order is set. Verify the SoR move happens (a) before the first activation begins, (b) as a player-choice picker showing legal movement (or a free-move grant that consumes via the standard movement picker), (c) doesn't double-fire if Brash triggers AND a CC like Take Initiative also fires at SoR.

**Much to Learn** — "While attacking, if there is another friendly unique figure within 3 spaces, you may reroll 1 attack die. If that figure is a FORCE USER, you may turn that attack die to any side instead."
- Impl: `src/game/much-to-learn-helpers.js:21-33` (range 3) + `src/handlers/combat.js` (step-3 attacker reroll integration).
- ⚠️ suspicious — verify the **two-tier behavior**: (1) within-3 unique friendly → reroll bucket, (2) within-3 unique friendly + FORCE USER → "turn to any side" picker. The turn-to-any-side is a STRONGER effect (deterministic best result), so the player should be presented with both options when a Force User is in range. Confirm both pickers exist and player can pick the strongest available.

---

## Fenn Signis

**Havoc Shot** — "After you resolve an attack, if it did not miss, you may suffer 1 Strain to choose up to 2 figures within 2 spaces of the target space in your line of sight. Those figures suffer 1 Damage."
- Impl: `src/handlers/after-attack-fire.js:1082-1110, 1674` → `fireHavocShot`. Per memory `S1140`, alexanbv-fixed 2026-05-08: original target excluded from secondary pick list (commit d922db12).
- ✅ correct — step-8 post-resolve fire; original-target exclusion fixed; LoS-from-Fenn gate; up-to-2 picker. Strain cost routed through `applyStrain` (post-2026-05-08 fix).

**Tactical Movement** — "At the start of your activation, you may choose a friendly figure within 3 spaces. That figure gains 2 movement points."
- Impl: `src/game/soa-orchestrator.js:760-770` (SoA picker, only entered when at least one eligible friendly exists) + `src/engine/activation-setup.js` + `src/handlers/soa-handler.js`.
- ✅ correct — fires at SoA; "may" → picker with Skip; 2 MP via `grantMovementBank`.

---

## Fennec Shand

**Bounty** (passive) — "When you are defeated, your opponent gains 2 VPs."
- Impl: `src/game/damage-pipeline-hooks.js:935+` — `WHEN_DEFEATED_HOOKS.push({ id: 'bounty', ... })`. Source-agnostic per docstring (fires from attack, Bleed, Blast splash, etc.). Old inline path in `combat-bridge.js` was removed in same commit to prevent double-award.
- ✅ correct — defeat-hook fires regardless of damage source; double-award prevented.

**Sharpshooter** — "When you declare an attack, if the target is 5 or more spaces away, you become Focused."
- Impl: `src/game/sharpshooter-helpers.js:14-25` (`SHARPSHOOTER_MIN_DISTANCE = 5`) + `src/handlers/combat.js`.
- ✅ correct — declare-time auto-Focus when distance-to-target ≥ 5.

---

## Fifth Brother

**Vigor** — "At the start of your activation, you may gain 2 movement points or 1 Block Token."
- Impl: `src/game/soa-orchestrator.js` + `src/handlers/soa-handler.js` + `src/handlers/activation.js` + `src/engine/activation-setup.js` + `src/game/abilities.js`.
- ⚠️ suspicious — "or" → player choice. Confirm two-option picker (MP/Block Token), not auto-grant. Same family/concern as Del Meeko Open-Minded (batch 04).

**Relentless Pursuit** — "When you declare an attack, the target suffers 1 Strain."
- Impl: `src/game/relentless-helpers.js:13-30` (`RELENTLESS_ABILITY_IDS` array including `fifth_brother_relentless`, `relentless_trandoshan_*`, `relentless_ig88`). Range cap 3 — **wait**, Fifth Brother's text has **no range restriction**, but the helper enforces `RELENTLESS_MAX_DISTANCE = 3` for all four IDs.
- ❌ wrong-stage — **range mismatch**: card text doesn't include a 3-space range for Fifth Brother's Relentless Pursuit. The Trandoshan Hunter cards have "3 spaces" wording, but Fifth Brother does not. Confirm whether `relentlessInRange` is checked for `fifth_brother_relentless` specifically, or whether Fifth Brother bypasses the range check. If applied uniformly, this incorrectly limits Fifth Brother's Strain proc to within-3 attacks.

**Special Action (Sith Acolyte)** — "Search your Command deck for a card with the FORCE USER or BRAWLER trait that costs 2 or less, reveal it, and put it into your hand. Then, shuffle your Command deck."
- Impl: `data/ability-library.json:sith_acolyte` (descriptor) — search-deck-by-trait family.
- ⚠️ suspicious — verify: (a) deck search shows only FORCE USER **or** BRAWLER cards with cost ≤2, (b) chosen card moved to hand, (c) deck **shuffled** after (preserves card-position privacy), (d) reveal step is logged so the opponent sees what was added.

---

## Gaarkhan

**Brutal Cleave** — "After you resolve an attack during your activation, you may suffer 1 Strain to perform an attack using 1 red and 1 yellow die targeting a different figure or object. Limit once per activation."
- Impl: `src/engine/combat-bridge.js:3074-3085` records `lastAttackTargetByMsgId` for "different figure" enforcement. `src/game/abilities.js` + `src/game/activation-state.js` (per-activation gate).
- ⚠️ suspicious — verify (a) "different figure" enforced via lastAttackTargetByMsgId comparison at Brutal Cleave declare, (b) 1r+1y die pool replaces normal attack pool (not added), (c) Strain via `applyStrain` (Headhunter etc. fire), (d) once-per-activation gate cleared at EoA.

**Special Action (Charge)** — "Move a number of spaces up to your Speed. Then, you may perform an attack."
- Impl: `src/game/movement.js`, `src/game/abilities.js`, `src/engine/combat-bridge.js`, `src/engine/combat-order-validator.js` (Charge ordering rule).
- ✅ correct — Special Action: speed-move then optional attack. Order validator enforces the move-then-attack sequence.

---

## Gamorrean Guard (Elite)

**Gamorrean Honor Guard** — "While defending during a Ranged attack, apply +1 Block to the defense results."
- Impl: `src/game/gamorrean-honor-guard-helpers.js:10-19` — `gamorreanHonorGuardApplies(isRanged)` returns true for Ranged. +1 Block added via `BONUS_BLOCK = 1`.
- ✅ correct — passive step-4 defender mod; Ranged-only gate.

**Professional** (passive) — canonical IACP keyword.
- ✅ correct (named reroll bucket per 2026-05-13 unified model).

---

## Gar Saxon

**Airborne Commander** — "Friendly Mobile figures within 4 spaces can use your surge abilities."
- Impl: `src/handlers/combat.js:2695-2710` — at attack-declare/surge time, scans for friendly Gar Saxon DCs within 4 spaces with attacker having `Mobile`. Pushes Saxon's surge abilities into `pendingCombat.bonusSurgeAbilities`.
- ⚠️ suspicious — verify (a) the Mobile check uses the attacker's *current* keywords (including transient grants from CCs / Forms), not just printed, (b) range 4 is **path-counting** (door-aware, terrain-aware) not Chebyshev, (c) bonusSurgeAbilities are deduplicated so an attacker doesn't gain Gar's surges twice if two Gar Saxon DCs are in range. Code at line 2700 looks like it `break`s on first non-Mobile attacker, suggesting only one Saxon source is considered per attack.

**Personal Combat Shield** (shared id with Bo-Katan) — see batch 02.
- ✅ correct.

**Special Action (Gar Saxon's Flamethrower)** — "Choose a space within 2 spaces. Each other figure on or adjacent to that space suffers 1 Damage and 1 Strain and discards 1 Power Token."
- Impl: `data/ability-library.json:gar_saxon_flamethrower` (`fixedAreaEffect` descriptor family).
- ⚠️ suspicious — Gar's Flamethrower is **distinct from Captain Terro's** in that it also discards 1 Power Token from each affected figure. Verify the library descriptor includes the power-token-discard field AND that the generic handler honors it. (Terro/Wrist Flamethrower variants don't have this discard — risk of code path falling back to default and skipping the discard.)

---

## General Sorin

**Special Action (Bombardment)** — "Choose an adjacent friendly figure. That figure may interrupt to perform an attack. The attack gains Blast 1."
- Impl: `src/game/abilities.js:1298-1330` (`bombardment_sorin` keyed) — choose adjacent friendly, set `pendingBombardmentSorin`, grant Blast 1 + Accuracy 1 via `nextAttacksBonusHits`.
- ⚠️ suspicious — code grants **Blast 1 + Accuracy 1** but card text only mentions **Blast 1**. The "+ Accuracy 1" appears to be an extra bonus not in the card text. Comment at line 1307 says "Blast 1 + Accuracy 1 bonus for the next attack (per-figure 2026-05-09)" — flagged for verification: is the +Accuracy 1 in the canonical card image or is this an over-grant?

**Advanced Firepower** — "Adjacent friendly DROIDS and VEHICLES can use your surge abilities."
- Impl: `src/handlers/combat.js:2727-2740` — at attack-declare/surge time, scans for Sorin within 1 space (or 3 with Advanced Com Systems), DROID/VEHICLE attacker check, pushes Sorin's surge abilities into pendingCombat.bonusSurgeAbilities.
- ⚠️ suspicious — card says "**Adjacent**" → 1 space. Default range 1 in impl is correct. Verify **Advanced Com Systems extension to 3** is canonical (card image check); if ACS only extends Krennic's AWR, not Sorin's Advanced Firepower, this is a bug.

---

## Batch 06 — Summary

- ✅ correct: 10
- ⚠️ suspicious: 12
- ❌ wrong-stage: 1 (Fifth Brother Relentless Pursuit — range-3 helper applied to a no-range card)
- — no impl: 0

**Highest-priority items surfaced this batch:**
1. **Fifth Brother Relentless Pursuit range bug** — `relentless-helpers.js` enforces `RELENTLESS_MAX_DISTANCE = 3` for all four IDs in `RELENTLESS_ABILITY_IDS`, but Fifth Brother's card text contains no range restriction. Confirm whether the helper's `relentlessInRange` is invoked for `fifth_brother_relentless` (would be a bug if yes) or short-circuited (would be correct).
2. **General Sorin Bombardment +Accuracy 1 over-grant?** — code grants Blast 1 **and** Accuracy 1, but card text only says Blast 1. Verify against `vassal_extracted/images/General Sorin*` (per the card-image-priority memory rule).
3. **General Sorin Advanced Firepower ACS range extension** — verify that ACS extends Sorin's surge-sharing range to 3 (or whether this is incorrectly cargo-culted from Krennic's AWR/Unhinged Director, which IS documented as ACS-extendable).
4. **Gar Saxon Flamethrower Power Token discard** — confirm the fixedAreaEffect descriptor includes a power-token-discard field unique to Gar's variant.

**Next:** Batch 07 (DCs G/H continued — alphabetical after General Sorin).
