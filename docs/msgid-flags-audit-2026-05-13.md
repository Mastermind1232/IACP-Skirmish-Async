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

**16 grouped commits, ~60 flags now per-figureKey / properly categorized.**

Commit map (first 8 commits, earlier batch):
- `997b5cc3` — attackPerformedThisActivation (original multifig bug)
- `165ce220` — pounceAttackPending, fellSwoopFreeAttack, pummelTwoAttacksThisActivation, pummelAttacksRemaining, imperialRetrofittingMultiAttack
- `9af310ce` — stayDownPendingMsgId, burstFirePendingMsgId, cripplingBlowPending, disruptorRiflePending, tonfaStrikeSecondAttack, barrageSecondAttack, barrageTargetSpace, barrageDefenseBonus, overrunThisActivation, overrunDamagedThisMove; setTrapSpace → ROUND_OBJECT_FLAGS
- `58e76a98` — wookieeAvengerSlamUsed, specialActionUsedThisActivation, activationDoubleSpecialAction, activationKills, paybackBonusSurge
- `78204a92` — closeQuartersActive, mobileMovementActive, darksaberSecondAttack, attackDicePenaltyForMsgId, pendingSlingBarrage, arcingShotActive
- `a0580129` — selfDestructProtocolTriggered, selfDefeatsAfterAttackMsgId, postActivationConditions, nextAttackIgnoreFigureLOS, optimalBombardmentBlastBonus, activationDamagedFigures (key migration only)
- `a136447f` (autofire trio) — autofireActive, fireMissionActive, autofireChainTargetSpace
- `b0e082ad` — activationExtraActionThenStun, beastTamerInteractOverride, freeAttackDifferentTargets
- `b6edcfc7` (Aim rewrite) — Aim now reads `figureMoved[attackerFigureKey]` per the card's "if you have not exited your space" text

Commit map (this session continuation, 7 more commits):
- `c15038c0` — recategorize 4 playerNum-keyed flags off the MSGID list:
  applySelfStunAfterAttackFigureKey, findsmanMeditationTarget,
  deflectionPending, deflectionUnconditional → ACTIVATION_PLAYERNUM_FLAGS
- `d08b65c3` — reverseEngineerActive → PLAYERNUM (was playerNum-keyed);
  pendingMultiTargetRoll (Trample chained picker) → FIGKEY
- `40e48da4` — paybackBonusSurge → FIGKEY (already keyed by
  attackerFigureKey at writes); dropped dead spotWeldPending +
  pendingPostAttackConditions registrations
- `eaa0c752` — activationKills → FIGKEY (already keyed by
  attackerFigureKey at writes); removed obsolete 22-flag
  _PER_FIGURE_RESET_MSGID_FLAGS block in handleDcFigurePick (every
  entry had already migrated to FIGKEY/PLAYERNUM/ROUND)
- `76283c7e` (BIG) — forcedAttackTarget → FIGKEY across 7 source files
  + 2 test files. Firing Squad redesigned to use firingSquadLockedTarget
  as fallback at attack-declare gate (lock is invocation-scoped, not
  per-figure, since Kayn can grant attacks to multiple troopers in
  the same group). Battlefield Leadership grantee, Shoulder Rush,
  Leia/Jyn Hair Trigger, Mandalorian Whip, Focus Fire, Return Fire all
  now key by attacker figureKey.
- `6d2ca0c1` — falseOrdersAttackTargets → FIGKEY (keyed by
  controlledFigureKey, not the group msgId)
- `67495b3a` — pendingStaticPulse, pendingForceCardPick, yhsiwOptions
  recategorized → ACTIVATION_SCALAR_FLAGS (global objects/arrays, not
  msgId-keyed maps). Static Pulse + Force Card Pick also moved off
  ROUND_OBJECT_FLAGS (which resets to `{}`) to ROUND_DELETE_FLAGS
  (latent bug: truthy `{}` would suppress first-call gate).
- `1f47e3d9` (BIG) — pendingOverrideAttackDice → FIGKEY across 8 source
  files + 6 test files. ~50 sites total. Every special-action dice
  override (Saber Strike, Bo-Rifle, Darksaber, Saber Orbit, Multi-Fire,
  Overheated, Feral Swipes, Hair Trigger, Definition: 'Love',
  Continually Unexpected, Sling Barrage, Flurry of Blows, Heavy
  Repeater, Arsenal/Epic Arsenal, Vanguard, EE-3 Carbine, Missile
  Salvo, Meditation, Face Me!, Overcharged Weapons, plus the generic
  overrideAttackDice + overrideAttackType branches) now keys by the
  attacker's figureKey.

## Migration sprint COMPLETE 2026-05-13

The remaining queue below is principle-only — no behavior change today
because every entry is either:
- a genuine per-DC UI keeper (action card state, message ids), or
- a picker state machine tied to a single-figure deployment group, or
- dead in production (no live writers).

The substantive migration is shipped. `pendingOverrideAttackDice`
landed in `1f47e3d9` (~50 sites across 8 files), which was the last
multifigure-correctness flag of meaningful size.

**Picker state machines — single-figure or 1-attack scope today:**
Most of these are tied to single-figure deployment groups (Bantha,
BT-1, Cad Bane, Bodhi) or to an action whose msgId↔figureKey is 1:1
during the picker window. Migration is principle-only:

- `pendingMissileSalvo` (10+ sites — BT-1 single-figure)
- `pendingPounceSpaceChoice` (8 sites — Loth-cat / Force Leap continuation;
  also wired into AI/self-play, more sites)
- `pendingBoRifle` (3 sites — Bo-Rifle die-type picker)
- `pendingBombDrop` (4 sites — Devaron B mission)
- `pendingOverwatchPlacement` (5 sites — Overwatch token placement)
- `pendingCombatResupply` (4 sites — Bodhi single-figure)
- `pendingOnAMissionPush` (move-x per-step push hook)
- `wildBeastUsedThisActivation` (Bantha single-figure)

**Dead in production (tests still exercise legacy reader path):**
- `rushPending` / `shoulderRushPending` — Rush + Shoulder Rush moved to
  pendingMoveX continuation (`nextAction.type: rushPostMove` /
  `shoulderRushPostMove`); no production writers remain, but the
  movement.js legacy reader is still tested.
- `pendingMpBonus` — readers in activation-setup.js still consume any
  value present; no writers in main. Kept registered so the
  activation-cost-behavioral cleanup test still passes.
- `deviceRerollGranted` — already noted as unused in
  `RF_BASELINE_UNUSED`; no live sites.

## KEEP — per-DC / per-attack (UI state + per-attack-frame)

**Per alexanbv 2026-05-13 corrections, the genuine KEEPs are limited
to UI rendering anchors + per-attack-frame state.** Earlier-flagged
"KEEPs" that are actually per-figure (`dcActionsData` actions/specials
counting, `movementBank`, `pendingMoveX`, `activationDamagedFigures` for
Aim, `reverseEngineerActive`) need their own migration work.

True KEEPs:
- `dcFinishedPinged` — UI "finished all actions" prompt for the DC card.
- `pendingEndTurn` — end-turn confirmation prompt for the DC.
- `dcActivationLogMessageIds` — log message ids for the DC's activation.
- `defenderThreadData` — per-attack combat thread data (clears on
  pendingCombat resolve; could be promoted to a per-pendingCombat
  field instead of a msgId map — follow-up).
- `falseOrdersUpgrade` — per-DC CC marker (False Orders is target-DC scoped).
- `companionActivatedBefore` — per-DC companion lifecycle flag.

**Pending KEEP-→-MIGRATE re-classification** (per alexanbv 2026-05-13):
- `dcActionsData` — UI rendering anchor is per-DC, but the
  action-counter / specials-used data INSIDE dcActionsData needs to be
  tracked per-figure. Refactor: separate the UI msgId-keyed record
  from the action-accounting figureKey-keyed record. Big surface area,
  own commit.
- `movementBank` — same shape: per-DC display, per-figure bank value.
- `pendingMoveX` — already partially per-figure via compound key
  `${msgId}_${figureIndex}`; finish the migration.
- `activationDamagedFigures` — currently keyed by attackerFigureKey post-
  Aim rewrite; Aim no longer reads it, so the field is now vestigial.
- `reverseEngineerActive` — should reset on attack-end, not activation-end.
  Migrate to a per-pendingCombat flag.

UX refactor queued:
- **End Turn vs End Activation** — each figure has its own End Activation
  button. Finishing one figure offers buttons to activate remaining
  group-mates. End Turn (distinct button) finishes the whole group.

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
