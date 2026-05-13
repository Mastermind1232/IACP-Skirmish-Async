# ACTIVATION_MSGID_FLAGS Audit — 2026-05-13

Per alexanbv: **DEFAULT is per-figure. Very few things are per-group.**
Anything currently keyed by msgId that isn't explicitly "group"-scoped
per card text needs migration to figureKey.

This document classifies every entry in `ACTIVATION_MSGID_FLAGS`
(src/game/activation-state.js) as one of:

- **KEEP** — legitimately per-DC/per-group (UI state, attack-frame
  state, per-DC card cost/exhaust state, etc.).
- **MIGRATE** — should be per-figure; keying by msgId is a bug.
- **VERIFY** — ambiguous; needs runtime trace before migration.

---

## Canonical principle (alexanbv 2026-05-13)

**Default: per-figure (ACTIVATION_FIGKEY_FLAGS). Per-group is the
exception, only when card text explicitly says "group".** Specifically:

- All special-action grants → per-figure
- All "during this activation" effects → per-figure activation
- All free-attack / bypass / chain-attack flags → per-figure
- UI / per-DC / per-attack-frame state stays msgId-keyed (KEEP list)
- Round-scoped state (SoR/EoR triggers) → ROUND_OBJECT_FLAGS, not
  ACTIVATION_MSGID_FLAGS

## Already migrated this session (alexanbv 2026-05-13)

- ✅ `attackPerformedThisActivation` — commit `997b5cc3`
- ✅ `pounceAttackPending` — commit `165ce220`
- ✅ `fellSwoopFreeAttack` — commit `165ce220`
- ✅ `pummelTwoAttacksThisActivation` — commit `165ce220`
- ✅ `pummelAttacksRemaining` — commit `165ce220`
- ✅ `imperialRetrofittingMultiAttack` — commit `165ce220`
- ✅ `stayDownPendingMsgId` — this commit
- ✅ `burstFirePendingMsgId` — this commit
- ✅ `cripplingBlowPending` — this commit
- ✅ `disruptorRiflePending` — this commit
- ✅ `tonfaStrikeSecondAttack` — this commit
- ✅ `barrageSecondAttack` — this commit
- ✅ `barrageTargetSpace` — this commit
- ✅ `barrageDefenseBonus` — this commit
- ✅ `overrunThisActivation` — this commit (alexanbv: "during this activation" = per-figure)
- ✅ `overrunDamagedThisMove` — this commit
- 🔄 `setTrapSpace` — this commit (reclassified ROUND_OBJECT_FLAGS, not ACTIVATION_FIGKEY)

## KEEP — per-DC (UI / attack-frame / card-state)

These are inherently per-DC and not per-figure:

- `dcActionsData` — DC card's action counter UI (tracks the active
  `selectedFigure` cursor; per-figure work happens via the cursor, not
  via separate dcActionsData entries).
- `movementBank` — movement-points bank displayed on the DC card.
- `dcFinishedPinged` — UI "finished all actions" prompt for the DC.
- `pendingEndTurn` — end-turn confirmation prompt for the DC.
- `dcActivationLogMessageIds` — log message ids for the DC's activation.
- `defenderThreadData` — per-attack combat thread data.
- `falseOrdersUpgrade` — per-DC CC marker (False Orders is target-DC scoped).
- `reverseEngineerActive` — per-attack flag on the active attack frame.
- `pendingMoveX` — per-figure move-X picker, but currently keyed by
  msgId with compound-key fallbacks. Already partially figure-aware
  via `selectedFigure`; documentation-level keep.
- `companionActivatedBefore` — per-DC companion lifecycle flag.
- `defenderThreadData` — combat thread data per attack.

## MIGRATE — per-figure candidates (queue)

These are likely per-figure per the alexanbv principle. Each needs:
(a) read/write site sweep, (b) FIGKEY classification, (c) regression
probe like `phase-d-atk-multifig-attack-budget-probe.test.js`:

**Attack-frame and special-action flags:**
- `stayDownPendingMsgId` — Stay Down condition target tracking
- `burstFirePendingMsgId` — Burst Fire CC attacker tracking
- `cripplingBlowPending` — Crippling Blow on target
- `disruptorRiflePending` — Disruptor Rifle Special Action
- `tonfaStrikeSecondAttack` — Jyn Erso Tonfa second attack
- `barrageSecondAttack` / `barrageTargetSpace` / `barrageDefenseBonus` —
  Barrage Generators per-figure tracking
- `pendingMultiTargetRoll` — multi-target attack roll state
- `closeQuartersActive` — Close Quarters CC active flag
- `mobileMovementActive` — Lift Off / Mobile movement window
- `pendingOnAMissionPush` — per-figure push picker
- `wildBeastUsedThisActivation` — already in FIGKEY (Bantha is single-figure)
- `attackDicePenaltyForMsgId` — Driven by Hatred attack debuff
- `rushPending` / `shoulderRushPending` — push interrupts
- `forcedAttackTarget` — forced-target gate (Mandalorian Whip, etc.)
- `selfDefeatsAfterAttackMsgId` — self-destruct queue
- `postActivationConditions` — end-of-activation condition queue
- `pendingCombatResupply` — Resupply attacker state
- `pendingPostAttackConditions` — after-attack condition application
- `pendingMpBonus` — MP grant queue
- `freeAttackDifferentTargets` — Brutality/Sarlacc different-target tracker
- `pendingOverrideAttackDice` — pre-roll attack-dice override
- `pendingSlingBarrage` — Ewok Sling Barrage reroll bucket
- `pendingStaticPulse` — per-figure picker state
- `selfDestructProtocolTriggered` — IG-11
- `findsmanMeditationTarget` — per-figure
- `nextAttackIgnoreFigureLOS` — per-figure
- `optimalBombardmentBlastBonus` — per-figure
- `deflectionPending` / `deflectionUnconditional` — defender Deflection
- `deviceRerollGranted` — Saska Power Converter
- `autofireActive` / `fireMissionActive` / `autofireChainTargetSpace` —
  Autofire CC chain attack
- `darksaberSecondAttack` — Darksaber follow-up
- `pendingOverwatchPlacement` — per-figure
- `activationKills` / `activationDamagedFigures` — per-figure tallies
- `yhsiwOptions` — You Will Not Deny Me
- `pendingBoRifle` / `pendingBombDrop` — special action queues
- `activationExtraActionThenStun` — extra-action gate
- `beastTamerInteractOverride` — Beast Tamer interact swap
- `arcingShotActive` — Arcing Shot CC
- `wookieeAvengerSlamUsed` — Wookiee Avenger
- `specialActionUsedThisActivation` — Squad Captain once-per-activation
- `spotWeldPending` — per-figure
- `pendingMissileSalvo` — BT-1
- `pendingPounceSpaceChoice` — per-figure pre-Pounce picker
- `activationDoubleSpecialAction` — Double Action Special tracking
- `falseOrdersAttackTargets` — False Orders CC attacker
- `paybackBonusSurge` — Payback CC

## VERIFY — ambiguous (need runtime trace before migration)

- `overrunThisActivation` — Overrun is "when you enter a hostile space";
  the trigger is per-figure but the "once per activation" cap may be
  per-group (verify card text).
- `overrunDamagedThisMove` — similar
- `setTrapSpace` — Set Trap CC; per-figure or per-DC?

## Recommendation

Migration cadence:
1. Ship the 5 confirmed (this commit).
2. Schedule a per-flag migration commit for each MIGRATE entry above,
   adding a regression probe per migration to lock the per-figure
   shape. Avoid one giant sweep — each migration has multiple read/write
   sites and risks regressing if rushed.
3. For VERIFY entries, open a destruct-style canonical rule check
   against `vassal_extracted/images/` and CRR text before deciding.

**Principle to encode in oracle:** any future activation-scoped flag
addition defaults to ACTIVATION_FIGKEY_FLAGS unless the card text
explicitly says "group" or the flag is inherently UI/per-DC state.
