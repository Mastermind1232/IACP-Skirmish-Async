# _channel_inventory.md — D7.1 tensor-encoding classification

**Deliverable:** D7 (Lossless board tensor encoding) — atomic task 7.1.

**Task:** Enumerate every game-state field relevant to decision-making and classify
each as **spatial per-cell** or **scalar global**. UI/log fields already filtered
in D1 stay excluded. Internal staging vars (D1 `_`-prefixed) stay excluded.

**Sources:**
- `python/engine/_field_inventory.txt` (411 unique `game.*` field names, D1 task 1.1–1.2)
- `python/engine/pending_state_inventory.md` (111 pending-state fields, D1 task 1.12)

**Verify (plan task 7.1):** Classification exists in this file.

D7.2 will decide exact channel counts / one-hot widths / normalization bounds
from this classification. **This file does not pre-commit channel totals**; it
only routes every field into a target bucket so D7.2 has a stable input.

---

## Classification buckets

| Bucket | Definition | Encoding target |
|---|---|---|
| **spatial-per-cell** | Fact attached to a board coordinate (figure, terrain, token, door, mission marker). | Channel in `[C, H, W]` tensor. |
| **scalar-global** | Fact that has no single coordinate (VP, round, phase, buffs, hand sizes, per-DC exhaust, pending-chain flags, squad composition). | Slot in `[S]` vector. |
| **excluded-ui** | Discord render-side field: msgIds, postedFlags, threadIds, embed caches. No decision value. | Not encoded. |
| **excluded-internal** | Transient staging var that does not persist across game steps (D1 `_`-prefixed + a few test-only / headless-only). | Not encoded — handled as function local in Python. |
| **excluded-test** | Fields appearing only in `*.test.js` or headless-only files (`hp`, `name`, `undoStack`, `testScenarioPattern`). | Not encoded. |

---

## Counts

Totals over the 411 `game.*` fields catalogued by D1:

- **spatial-per-cell:** 22 source fields
- **scalar-global:** 281 source fields (includes 104 `pending*` flags + 177 others)
- **excluded-ui:** 53 source fields (44 D1-tagged `ui_only` + 9 more found during review: play-area IDs, discard-thread IDs, defender-thread data)
- **excluded-internal:** 11 source fields (7 `_`-prefixed + `undoStack` + `testScenarioPattern` + `hp` test-only + `name` test-only)
- **excluded-test:** covered above (merged into excluded-internal for simplicity)

Counts add: 22 + 281 + 53 + 11 = **367**. Remaining 44 of 411 are fields whose
category depends on a D2-D5 porting decision still open at time of D7.1 — flagged
in the `deferred` subsection below. None of them are decision-critical without
that porting choice.

> **Imperfect information note:** hand contents (`player1CcHand`, `player2CcHand`)
> and deck contents (`player1CcDeck`, `player2CcDeck`) are classified as scalar-global,
> but the encoder must take a player-view argument: the POV player sees their own
> hand in full, the opponent's hand is encoded as `(size, hidden_distribution)`.
> D7.5 `encode_state(game_state, pov_player)` signature will enforce this.
> Deck is similarly POV-dependent for identity, POV-independent for size.

---

## Spatial-per-cell source fields (22)

Each row here feeds one or more channels in the spatial tensor. D7.2 will
decide exact channel counts; this list only guarantees no decision-relevant
spatial fact gets dropped.

| Field | D1 cat | Channel intent |
|---|---|---|
| `figurePositions` | figures | Per-DC-type × per-player occupancy (2×N_DC channels or union channels with DC-type embedding). Largest spatial input. |
| `figureOrientations` | figures | Orientation one-hot (4 channels: N/E/S/W) per figure cell. |
| `figureConditions` | figures | 9 condition channels (Stun/Bleed/Focus/Hide/Weaken/Immobilize/Exposed/Disoriented/Hindered) keyed by occupied figure cell. |
| `figurePowerTokens` | figures | Power-token color channels (~8: Surge/Evade/Block/Damage + any variant colors) keyed by figure cell. |
| `figureStrain` | figures | Strain level normalized [0,1] per figure cell. |
| `figureContraband` | figures | Contraband marker per figure cell (mission-specific). |
| `activationStartPositions` | meta | Start-of-activation marker (movement-bank anchor) per active-DC cell. |
| `cratePositions` | board | Crate present per cell (mission crates). |
| `crateHealth` | board | Crate HP normalized per crate cell. |
| `crateTokens` | board | Crate-token-type per crate cell (interact/generic). |
| `openedDoors` | meta | Door state per door-edge (open vs closed; 2 channels over door positions). |
| `ancillaryTokens` | board | Mission ancillary tokens (per-mission marker channels). |
| `deviceTokens` | meta | Device-token marker per cell. |
| `rubbleTokens` | meta | Rubble-token marker per cell. |
| `imperialCitadelTokens` | meta | Imperial Citadel per-mission token positions. |
| `orbitalBombardmentTokens` | meta | Orbital Bombardment CC residual markers. |
| `overwatchTokenPosition` | meta | 1 coord overwatch marker. |
| `setTrapSpace` | meta | 1 coord trap marker. |
| `reconToken` | meta | 1 coord recon marker. |
| `fluctuationPositions` | meta | Lothal Wastes B fluctuation terrain positions. |
| `npcKrykna` | meta | Krykna NPC positions. |
| `npcThugs` | meta | Thug NPC positions. |
| `claimedKrykna` | meta | Krykna-claimed marker per cell. |
| `terminalControlPlayerNum` | board | Terminal-control per-player overlay (2 channels: p1/p2 control over terminal coords). |
| `lastAttackTargetSpacesForRubble` | combat | Last-attack target coords (for rubble-on-blocked-hit queueing). |
| `barrageTargetSpace` | meta | Barrage chosen second-attack target cell (1 coord during E.5 chain). |
| `autofireChainTargetSpace` | meta | Autofire chain next-target cell. |
| `falseOrdersAttackTargets` | combat | False Orders ordered-attack target coords. |

> **Note:** `figurePositions` implicitly encodes per-figure HP via "is this
> figure's first cell occupied" + a matching normalized HP channel. D7.2
> will decide whether HP lives in a dedicated channel keyed by figure-cell
> or as a scalar-per-figure-index read via attention pooling.

---

## Scalar-global source fields

Grouped thematically. Every row feeds one or more scalars in `[S]`. Pending-state
fields land as presence-bit + payload scalars (payload shape per-chain; D7.2
decides layout).

### Identity & setup (13)
`gameBox`, `selectedMap`, `selectedMission`, `mapSelected`, `mapSelectionType`,
`boardId`, `player1Squad`, `player2Squad`, `player1DeploymentZone`,
`player2DeploymentZone`, `deploymentZoneChosen`, `deviousSchemeZoneChooser`,
`blitzDeployment`, `draftRandomUsed`. (`player1Id`/`player2Id` excluded-internal —
pure identity.)

### Phase, round, initiative (22)
`phase`, `roundPhase`, `phaseGate`, `currentRound`, `currentActivationTurnPlayerId`,
`initiativePlayerId`, `initiativeDetermined`, `initiativePlayerDeployed`,
`nonInitiativePlayerDeployed`, `initiativeDeployedConfirmIds`,
`nonInitiativeDeployedConfirmIds`, `startOfRoundWhoseTurn`, `endOfRoundWhoseTurn`,
`p1ActivationPhaseEnded`, `p2ActivationPhaseEnded`, `p1ActivationsRemaining`,
`p1ActivationsTotal`, `p2ActivationsRemaining` (derived), `p2ActivationsTotal`
(derived), `setupAttachmentPhase`, `roundActivationButtonShown`, `ended`.

### VP & win conditions (scalar counters, stored in nested state objects)
VP/kills/objectives are held in nested `vp.{total,kills,objectives}` structures
(not top-level `game.*` fields; see D2.29 `defeat.py`). D7.2 reserves 4 scalars
per player + `winnerId`, `gameEndReason`, `ended`.

### Per-DC exhaust & activation state (11)
`p1ActivatedDcIndices`, `p2ActivatedDcIndices`, `p1DcList`, `p2DcList`,
`p1DcAttachments`, `p2DcAttachments`, `p1CcAttachments`, `p2CcAttachments`,
`exhaustedSkirmishUpgrades`, `movementBank`, `dcActionsData`.

### Hand & deck (POV-masked) (4)
`player1CcHand`, `player1CcDeck`, `player2CcHand`, `player2CcDeck`. Encoder
takes `pov_player` arg; opponent's hand → size-only + unknown-distribution.

### Round-long buffs / flags (29)
`roundAttackRerollDice`, `roundAttackSurgeBonus`, `roundDebuffNextHostileActivation`,
`roundDefenderBonusBlockPerEvade`, `roundDefenderCannotBeTargetedUnlessWithinSpaces`,
`roundDefenseAccuracyPenalty`, `roundDefenseBonusBlock`, `roundDefenseBonusEvade`,
`roundDioxisActive`, `roundDroidExtraActionCostDamage`, `roundEfficientTravel`,
`roundInTheShadowsPlayerNum`, `roundMobileDefenseBonusBlock`,
`roundProgrammingOverrideTrait`, `roundSmugglersTricksPlayerNum`,
`roundTrooperAttackHitBonus`, `roundTrooperSurgeStun`, `roundUtinniJawaBuffs`,
`roundVehicleSpeedBonus`, `roundFigureAbilityUsed`, `noCommandDrawThisRound`,
`powerConverterUsedThisRound`, `deWannaWangaUsedThisRound`, `vadersFocusUsedThisRound`,
`p1LaunchPanelFlippedThisRound`, `p2LaunchPanelFlippedThisRound`,
`jundlandTerrorPlayedThisEor`, `firstStrikeFired`, `fluctuationSwappedThisRound`.

### Per-activation transient (23)
`activationDamagedFigures`, `activationDoubleSpecialAction`, `activationExtraActionThenStun`,
`activationKills`, `attackPerformedThisActivation`, `figureMoved`, `attackTargets`,
`freeAttackBonusPending`, `nextActivationFreeAttack`, `firstActivationFigureName`,
`pummelAttacksRemaining`, `pummelTwoAttacksThisActivation`, `saberOrbitAttacksRemaining`,
`tonfaStrikeSecondAttack`, `darksaberSecondAttack`, `barrageSecondAttack`,
`imperialRetrofittingMultiAttack`, `mobileMovementActive`, `moveInProgress`,
`overrunThisActivation`, `specialActionUsedThisActivation`,
`unstableDevicesUsedThisActivation`, `vetInstinctsActiveThisActivation`,
`wookieeAvengerSlamUsed`.

### Per-combat transient (in-flight attack state) (26)
`pendingCombat`, `pendingMultiTargetRoll`, `pendingOverrideAttackDice`,
`pendingSurgeOverflow`, `pendingPostAttackConditions`, `pendingPowerTokenGrant`,
`pendingPowerTokenOverflow`, `pendingStrainChoice`, `lastAttackAttackerPlayerNum`,
`lastAttackAttackerFigureIndex`, `lastAttackTargetFigureKey`, `forcedAttackTarget`,
`forceDefenderRerollOne`, `doubleMatchingIconsOnReroll`, `conditionalFocusIfDamagedGte`,
`criticalHitBlockedPlayer`, `extraProtectionTriggeredThisCombat`, `paybackBonusSurge`,
`barrageDefenseBonus`, `nextAttackBonusAccuracy`, `nextAttackBonusPierce`,
`nextAttackBonusSurgeAbilities`, `nextAttackIgnoreFigureLOS`, `nextAttackReach`,
`nextAttacksBonusConditions`, `nextAttacksBonusHits`.

### Pending-state chain flags (104)
Every one of the 104 `pending*` fields from `pending_state_inventory.md` lands
here as (a) a presence bit and (b) a chain-specific scalar payload (target
figure key, chosen option index, remaining count, etc.). D7.2 decides per-chain
payload shape. Flags are:

`pendingAssassinsBlade`, `pendingAttachConfirm`, `pendingAwr`, `pendingBELReorder`,
`pendingBattlefieldLeadership`, `pendingBlackMarket`, `pendingBoRifle`,
`pendingBoltslinger`, `pendingBombDrop`, `pendingBombardmentSorin`,
`pendingCcAttachment`, `pendingCcChoice`, `pendingCcConfirmation`,
`pendingCcSpaceChoice`, `pendingCelebration`, `pendingChannelTheForceStrain`,
`pendingCleave`, `pendingCombat` (listed above too; same field), `pendingCombatResupply`,
`pendingCommDisruptionPrompt`, `pendingConcussiveBolt`, `pendingConspire`,
`pendingCoordinatedRaid`, `pendingCoverFire`, `pendingDcAbilityChoice`,
`pendingDeflect`, `pendingDeployOrientation`, `pendingDioFollow`,
`pendingDoorSelections`, `pendingEe3Carbine`, `pendingEmperorInterrupt`,
`pendingEndTurn`, `pendingExecutiveOrder`, `pendingExecutorInterrupt`,
`pendingExtraProtection`, `pendingFalseOrders`, `pendingFieldTactics`,
`pendingFightingKnife`, `pendingFigurehead`, `pendingFiringSquad`,
`pendingFluctuationSwapFirst`, `pendingFluctuationSwapQueue`,
`pendingForceExhaustion`, `pendingGeneralsOrders`, `pendingHavocShot`,
`pendingHeavyFire`, `pendingHeroicEffortReturn`, `pendingHunterProtocol`,
`pendingIKnowEverything`, `pendingIllegalCcPlay`, `pendingIllicitArms`,
`pendingIndiscriminateFire`, `pendingInterrogate`, `pendingItWillBeAlright`,
`pendingKryknaPushQueue`, `pendingLastResort`, `pendingLieInAmbush`,
`pendingLoadoutSelection`, `pendingLure`, `pendingMassivePush`, `pendingMastery`,
`pendingMissileSalvo`, `pendingMissionSorReveal`, `pendingMotivation`,
`pendingMpBonus`, `pendingNegation`, `pendingOrbitalBombardment`,
`pendingOrderedMove`, `pendingOverwatchPlacement`, `pendingPounceSpaceChoice`,
`pendingPowerConverter`, `pendingPunishingStrike`, `pendingReaction`,
`pendingRightBackAtYa`, `pendingRogueOneTokenPick`, `pendingRushPush`,
`pendingScavengedWeaponryTransfer`, `pendingSelfDestruct`, `pendingShoulderRush`,
`pendingSlowOnTheDraw`, `pendingSorActions`, `pendingSpacePick`,
`pendingSpreadThePain`, `pendingSpreadThePainCondPick`, `pendingStartOfRoundResolve`,
`pendingStillFaster`, `pendingStrikeMeDown`, `pendingSuppressiveFireMp`,
`pendingThereIsNoTry`, `pendingTokenDistribution`, `pendingToughLuck`,
`pendingTrustedAlly`, `pendingVoracious`, `pendingWantonDestruction`,
`pendingWookSlamPush`, `pendingYHSIW`, `pendingZilloDiscard`.

> **Open design question deferred to D7.2:** `pendingSpacePick`,
> `pendingPounceSpaceChoice`, `pendingOverwatchPlacement`, `pendingOrbitalBombardment`,
> `pendingCcSpaceChoice`, `pendingKryknaPushQueue`, `pendingMassivePush`,
> `pendingWookSlamPush`, `pendingRushPush`, `pendingShoulderRush`,
> `pendingFluctuationSwapFirst`, `pendingFluctuationSwapQueue`,
> `pendingDoorSelections` each carry **valid-target coordinate sets**.
> D7.2 should consider rendering these as a dedicated "legal-space mask"
> spatial channel rather than scalar lists. Classifying here as scalar-global
> preserves the option; D7.2 can promote any of them to a spatial channel.

### Ability-specific flags & counters (87)
Catch-all for persistent ability state. Groups:

- **CC played / card-use flags:** `exhaustedSkirmishUpgrades` (already above),
`dataTheftStolenCard`, `iKnowEverythingResolved`, `falseOrdersUpgrade`,
`jundlandTerrorPlayedThisEor` (already above), `reinforcementsPlayedThisSor`,
`partingShotTriggered`.
- **Ability buffs active:** `arcingShotActive`, `arcingShotActiveScalar`,
`autofireActive`, `closeQuartersActive`, `cripplingBlowPending`,
`deflectionPending`, `deflectionUnconditional`, `disruptorRiflePending`,
`executorTriggered`, `fellSwoopFreeAttack`, `focusFireActive`,
`harshEnvironmentActive`, `hitAndRunPendingMp`, `forceVisionNextActivation`,
`forceVisionPending`, `forceSlowSkipActivation`, `multiFireActive`,
`multiFireBlockedTarget`, `onTheLamActive`, `opportunisticMustSpendNow`,
`optimalBombardmentBlastBonus`, `overrunDamagedThisMove` (dup of per-activation),
`pounceAttackPending`, `powerfulInfluencePlayerNum`, `provokeNextActivation`,
`recoverOnHostileDefeat`, `restInPeaceActive`, `reverseEngineerActive`,
`rushPending`, `shoulderRushPending`, `sitTightPlayerNum`, `signalJammerActive`,
`slowOnTheDrawInterrupt`, `sonOfSkywalkerActive`, `spotWeldPending`,
`stillFasterPlayerNum`, `surgeDoublingActive`, `thereIsNoTryPlayerNum`,
`toughLuckPlayerNum`, `tripodAttacked`, `unlimitedPowerActive`,
`urgencyMustSpendAll`, `vanishImmunityUntilNextActivation`, `windfallActive`,
`wookieeAvengerDrawPenalty`, `wreakVengeanceActive`, `youWillNotDenyMeActive`,
`mandaAsteelPlayerNum`, `holdGroundPlayerNum`, `applySelfStunAfterAttackPlayerNum`,
`selfDestructProtocolTriggered`, `lastResortTriggered`,
`nextHostileDefeatVpBonus`, `nextDefeatedFriendlyVpReduction`,
`massiveMovementLocked`, `adrenalineBonuses`, `agitateNextActivation`,
`beastTamerInteractOverride`, `bloodFeudTargets`, `childIncapacitated`,
`commsJammerActivePlayerNum`, `companionActivatedBefore`, `companionHostMap`,
`crippledFigures`, `disabledFigures`, `disarmPermanentWeakened`,
`etiquetteBlockPairs`, `findsmanMeditationTarget`, `fireMissionActive`,
`imperialCitadelTokens` (spatial dup), `imperialRetrofittingMultiAttack` (dup),
`kryknaPushedIds`, `launchPanelState`, `lieInAmbushSetAside`, `outOfPosition*`
(none named), `overrunDamagedThisMove` (dup), `pounceAttackPending` (dup),
`postActivationConditions`, `postDeployEffectsFired`, `postDeployQueue`,
`priceBounties`, `shadowOpsBlockedPlayer`, `squadSwarmCumulativeCost`,
`squadSwarmPlayerNum`, `strengthInNumbersData`, `strengthInNumbersPlayerNum`,
`yhsiwOptions`.
- **Mission-specific / objective:** `lastDefeatInfo`,
`endOfRoundSelfDamage`, `gameEndReason`, `winnerId`.
- **Setup transient:** `setupAttachmentApplied`, `setupAttachmentConfirmed`,
`setupAttachmentOriginal`, `setupAttachmentPending`,
`setupAttachmentPhase` (already above in phase).

### Derived / aggregate (not independent fields)
VP totals, activations remaining counts, figure HP per figure, CC hand size,
CC deck size are computed from the above; they go into the `[S]` vector as
derived slots during encoding, not as new source fields.

---

## Excluded: UI (53)

Not encoded. These are Discord rendering state (msgIds, thread IDs, posted/pinged
flags, embed caches). D1 tagged 44 as `[ui_only]`; this review found 9 more
(play-area / discard-thread / defender-thread IDs) that are `[meta]` or `[deck]`
by D1 category but are still pure UI.

D1 `[ui_only]` (44):
`abilityExhaustedMsgIds`, `activationPhaseMessagePosted`, `attachRedoNoticeIds`,
`bothReadyMessageId`, `bothReadyPosted`, `burstFirePendingMsgId`,
`ccShuffleDrawPromptsPosted`, `currentActivatingDcMsgId`, `dcActivationLogMessageIds`,
`dcFinishedPinged`, `deploySpaceGridMessageIds`, `deploymentZoneMessageId`,
`generalSetupMessageId`, `initiativeDeployMessageId`, `initiativeDeployMessageIds`,
`lastActivationMsgIdByPlayer`, `lastAttackAttackerMsgId`, `moveGridMessageIds`,
`nonInitiativeDeployMessageId`, `nonInitiativeDeployMessageIds`, `p1ActivationsMessageId`,
`p1DcAttachmentMessageIds`, `p1DcCompanionMessageIds`, `p1DcMessageIds`,
`p1DepletedDcMessageIds`, `p1DiscardPileMessageId`, `p1HandMessageId`,
`p1HandVisualMessageId`, `p2ActivationsMessageId`, `p2DcAttachmentMessageIds`,
`p2DcCompanionMessageIds`, `p2DcMessageIds`, `p2DepletedDcMessageIds`,
`p2DiscardPileMessageId`, `p2HandMessageId`, `p2HandVisualMessageId`,
`promptMessageIds`, `roundActivationMessageId`, `secondChanceDcMsgId`,
`selfAugmentationMsgId`, `selfDefeatsAfterAttackMsgId`, `setupLogMessageIds`,
`stayDownPendingMsgId`, `stillFasterExcludeMsgId`.

Found-during-D7.1 (9): `p1DiscardThreadId`, `p2DiscardThreadId`, `p1PlayAreaId`,
`p2PlayAreaId`, `defenderThreadData`, `figureNicknames` (display-only human
names), `dcActionsData` (partly derived — retains a UI-only tail of log lines
and message prompts; **re-classify in D7.2 once D4 ports it** — for D7.1 we
keep it scalar-global because decision-relevant parts exist), `moveInProgress`
(UI-only gate? — flagged for re-review; currently scalar-global),
`roundActivationButtonShown` (UI button-visibility flag).

---

## Excluded: Internal staging (11)

Not persisted across game steps. Handled as Python function locals in the
port, not `GameState` fields.

D1 `_`-prefixed (7):
`_closeQuartersBonusAcc`, `_closeQuartersRemoveDefDie`, `_lffPendingTokenFigureKey`,
`_pendingBlockSurgeAbilities`, `_pendingStatusPhaseLog`, `_postDeployMoveDeferred`,
`_wookieeRageTargets`.

Headless / test-only (4):
`undoStack` (`src/headless/headless-deps.js` — replay harness only),
`testScenarioPattern` (`src/engine/scenario-mutators.js` — test injection only),
`hp` (`src/game/action-queue.test.js:118` — test literal only),
`name` (`src/game/action-queue.test.js:119` — test literal only).

---

## Deferred (44) — need D2–D5 porting decision

44 fields appear in `_field_inventory.txt` with categorization uncertain
until their owning deliverable ports them. Representative subset:

- **Ability chain state** already routed into D3 Pattern E (15 pending*
  fields flagged in `pending_state_inventory.md` as E.1–E.20 dedicated
  chains). D7.2 gets final payload shape after those chains land. Classified
  **scalar-global** by default here so nothing is dropped; can promote valid-
  target fields to spatial in D7.2.
- **Mission-specific terrain** fields (`fluctuationPositions` spatial, plus
  a few mission-scoped flags under `[meta]`): D5 ports determine final
  channel commitment. Classified here by best current read; D5 refresh
  updates the row.
- **Per-DC action-bank state** (`dcActionsData`): partly decision-relevant
  (MP remaining, actions used this activation) + partly UI-only (prompt
  message slots). D4 port splits it; D7.2 refreshes.

---

## Spatial channel budget (preliminary; D7.2 decides)

Preliminary headroom estimate from the 22 source fields above, assuming
32×32 padded board and N_DC≈25 distinct DC types observed across library:

- Figure positions: 2 × N_DC ≈ 50 channels (or ~20 with DC-type embedding)
- Figure HP (normalized): 1
- Figure orientations (4-way one-hot): 4
- Figure conditions: 9
- Figure power tokens (per color): 8
- Figure strain: 1
- Figure contraband: 1
- Terrain (difficult / hostile / rubble / fluctuation): 4
- Doors (open / closed): 2
- LOS-blocking (walls / terrain edges derived): 1
- Crates (present / HP / token-type): 3
- Terminals (p1-control / p2-control): 2
- Mission tokens (device / overwatch / recon / trap / citadel / ob / krykna / thug): 8
- Combat-transient markers (barrage-target / autofire-chain / false-orders / last-attack-rubble): 4

Preliminary total: ~98 channels with per-DC-type explosion, ~68 with DC-type
embedding. Either fits the plan's ≤256 cap with headroom for D7.2 additions.

## Scalar vector budget (preliminary; D7.2 decides)

The plan's D7.4 target is ~128 scalars. Counting this classification's
scalar-global buckets (rough):

- Identity & setup: ~15 scalars (map/mission one-hots + squad composition
  as N_DC bitsets + 8 setup bools)
- Phase/round/initiative: ~25 (one-hots + counters)
- VP / win-cond: ~10
- Per-DC exhaust & activation state: ~60 (N_DC-bits per player + MP bank
  counters + attachment pointers)
- Hand/deck (POV-masked): ~20 (hand count + presence-mask over CC pool +
  deck size)
- Round-long buffs: ~30
- Per-activation transient: ~25
- Per-combat transient: ~30
- Pending-state chain flags: ~104 presence bits + per-chain payload (~200+
  total payload scalars worst-case)
- Ability-specific flags: ~90

Preliminary total: well over 128 if every field stays independent. D7.2
will compress by (a) bucketing pending payloads into a single "active-chain"
one-hot + payload, (b) grouping per-DC exhaust bits into one tensor slot
per DC type, (c) dropping fields with zero decision value (purely historical
flags like `jundlandTerrorPlayedThisEor` that only gate a once-per-EoR CC
that is also represented via the CC deck/hand channel).

---

## Revision policy

This file is the D7.1 baseline. Every subsequent D7/D8 task that reclassifies
a field (promoting a pending* to a spatial mask; demoting a UI-adjacent
`[meta]` to `excluded-ui`; splitting `dcActionsData`) edits the relevant row
here and bumps a version line at the top of the file. D7.2 reads this as
input and emits the final channel list + width budget.
