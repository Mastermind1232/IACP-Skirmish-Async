/**
 * Activation + round state cleanup.
 * Single authoritative lists of per-activation and round-scoped flags.
 */

/**
 * Per-activation flags keyed by msgId.
 * Deleted from game[key] at end of activation.
 */
const ACTIVATION_MSGID_FLAGS = [
  'dcActionsData',
  'movementBank',
  'dcFinishedPinged',
  'pendingEndTurn',
  'fellSwoopFreeAttack',
  'overrunThisActivation',
  'overrunDamagedThisMove',
  'pummelTwoAttacksThisActivation',
  'pummelAttacksRemaining',
  'stayDownPendingMsgId',
  'burstFirePendingMsgId',
  'cripplingBlowPending',
  'disruptorRiflePending',
  'tonfaStrikeSecondAttack',
  'barrageSecondAttack',
  'barrageTargetSpace',
  'barrageDefenseBonus',
  'pendingMultiTargetRoll',
  'closeQuartersActive',
  'mobileMovementActive',
  'rushPending',
  'shoulderRushPending',
  'forcedAttackTarget',
  'selfDefeatsAfterAttackMsgId',
  'applySelfStunAfterAttackPlayerNum',
  'postActivationConditions',
  'pendingCombatResupply',
  'pendingPostAttackConditions',
  'pendingMpBonus',
  'freeAttackBonusPending',
  'pendingOverrideAttackDice',
  'nextAttackReach',
  'selfDestructProtocolTriggered',
  'falseOrdersUpgrade',
  'setTrapSpace',
  'reverseEngineerActive',
  'findsmanMeditationTarget',
  'nextAttackIgnoreFigureLOS',
  'optimalBombardmentBlastBonus',
  'deflectionPending',
  'deflectionUnconditional',
  'dcActivationLogMessageIds',
  'defenderThreadData',
  'deviceRerollGranted',
  'autofireActive',
  'fireMissionActive',
  'autofireChainTargetSpace',
  'darksaberSecondAttack',
  'saberOrbitAttacksRemaining',
  'pendingOverwatchPlacement',
  'activationKills',
  'activationDamagedFigures',
  'unstableDevicesUsedThisActivation',
  'yhsiwOptions',
  'pendingBoRifle',
  'pendingBombDrop',
  'activationExtraActionThenStun',
  'beastTamerInteractOverride',
  'imperialRetrofittingMultiAttack',
  'arcingShotActive',
  'wookieeAvengerSlamUsed',
  'specialActionUsedThisActivation',
  'focusFireActive',
  'multiFireActive',
  'multiFireBlockedTarget',
  'spotWeldPending',
  'pendingMissileSalvo',
  'pendingPounceSpaceChoice',
];

/**
 * Per-activation flags keyed by figureKey (e.g. "Trooper-0-0").
 * Deleted for each figure in the activated deployment group.
 */
const ACTIVATION_FIGKEY_FLAGS = [
  'figureMoved',
  'tripodAttacked',
  'activationStartPositions',
  'overdriveUsedThisActivation',
  'massiveMovementLocked',
];

/**
 * Per-activation flags keyed by playerNum.
 * Deleted for the activating player at end of activation.
 */
const ACTIVATION_PLAYERNUM_FLAGS = [
  'nextAttacksBonusHits',
  'nextAttacksBonusConditions',
  'nextAttackBonusSurgeAbilities',
  'nextAttackBonusPierce',
  'nextAttackBonusAccuracy',
  'vetInstinctsActiveThisActivation',
];

/**
 * Per-activation scalar flags (deleted outright).
 */
const ACTIVATION_SCALAR_FLAGS = [
  'commsJammerActivePlayerNum',
  'partingShotTriggered',
  'onTheLamActive',
  'arcingShotActiveScalar',
  'pendingWookSlamPush',
  'pendingSurgeOverflow',
];

/**
 * Clean per-activation state when a DC ends its activation.
 * @param {object} game
 * @param {string} msgId  - DC message ID for the activated card
 * @param {number} playerNum - 1 or 2
 * @param {string[]} figureKeys - all figureKeys for figures in this DG (e.g. ["Trooper-0-0", "Trooper-0-1"])
 */
export function cleanupActivation(game, msgId, playerNum, figureKeys) {
  for (const key of ACTIVATION_MSGID_FLAGS) {
    if (game[key]?.[msgId] !== undefined) delete game[key][msgId];
  }
  for (const key of ACTIVATION_FIGKEY_FLAGS) {
    if (!game[key]) continue;
    for (const fk of figureKeys) {
      delete game[key][fk];
    }
  }
  for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
    if (game[key]?.[playerNum] !== undefined) delete game[key][playerNum];
  }
  for (const key of ACTIVATION_SCALAR_FLAGS) {
    delete game[key];
  }
  // moveInProgress uses compound keys `${msgId}_${figureIndex}` — clean any matching this activation
  if (game.moveInProgress) {
    const prefix = `${msgId}_`;
    for (const mk of Object.keys(game.moveInProgress)) {
      if (mk.startsWith(prefix)) delete game.moveInProgress[mk];
    }
  }
}

/**
 * All round-scoped flags reset at start of new round.
 * Object flags are reset to {}; null flags to null; array flags to [].
 */
const ROUND_OBJECT_FLAGS = [
  'roundDefenseBonusBlock',
  'roundDefenseBonusEvade',
  'roundDefenseAccuracyPenalty',
  'roundMobileDefenseBonusBlock',
  'roundDefenderBonusBlockPerEvade',
  'roundTrooperAttackHitBonus',
  'roundVehicleSpeedBonus',
  'deflectionPending',
  'deflectionUnconditional',
  'roundAttackRerollDice',
  'freeAttackBonusPending',
  'pendingOverrideAttackDice',
  'nextAttackReach',
  'fellSwoopFreeAttack',
  'roundAttackSurgeBonus',
  'overrunThisActivation',
  'roundFigureAbilityUsed',
  'roundEfficientTravel',
  'nextAttackIgnoreFigureLOS',
  'findsmanMeditationTarget',
  'vanishImmunityUntilNextActivation',
  'falseOrdersUpgrade',
  'setTrapSpace',
  'reverseEngineerActive',
  'pendingMpBonus',
  'pummelTwoAttacksThisActivation',
  'pummelAttacksRemaining',
  'overrunDamagedThisMove',
  'overdriveUsedThisActivation',
  'stayDownPendingMsgId',
  'burstFirePendingMsgId',
  'cripplingBlowPending',
  'disruptorRiflePending',
  'tonfaStrikeSecondAttack',
  'barrageSecondAttack',
  'barrageTargetSpace',
  'barrageDefenseBonus',
  'pendingMultiTargetRoll',
  'closeQuartersActive',
  'selfDestructProtocolTriggered',
  'mobileMovementActive',
  'rushPending',
  'shoulderRushPending',
  'forcedAttackTarget',
  'figureMoved',
  'tripodAttacked',
  'activationStartPositions',
  'selfDefeatsAfterAttackMsgId',
  'applySelfStunAfterAttackPlayerNum',
  'postActivationConditions',
  'pendingCombatResupply',
  'pendingPostAttackConditions',
  'nextActivationFreeAttack',
  'vetInstinctsActiveThisActivation',
  'surgeDoublingActive',
  'optimalBombardmentBlastBonus',
  'recoverOnHostileDefeat',
  'nextHostileDefeatVpBonus',
  'dcActivationLogMessageIds',
  'defenderThreadData',
  'deviceRerollGranted',
  'nextAttackBonusAccuracy',
  'priceBounties',
  'diplomaticMissionEvade',
  'lastResortTriggered',
  'attackPerformedThisActivation',
  'vadersFocusUsedThisRound',
  'scavengedWalkerAttackPenalty',
  'drivenByHatredAttackPenalty',
  'roundProgrammingOverrideTrait',
  'autofireActive',
  'fireMissionActive',
  'autofireChainTargetSpace',
  'darksaberSecondAttack',
  'saberOrbitAttacksRemaining',
  'pendingOverwatchPlacement',
  'activationKills',
  'activationDamagedFigures',
  'pendingBombDrop',
  // crossTrainingExhausted — removed: Cross Training now uses exhaustedSkirmishUpgrades
  'massiveMovementLocked',
  'disarmPermanentWeakened',
  'adrenalineBonuses',
  'opportunisticMustSpendNow',
  'imperialRetrofittingMultiAttack',
  'urgencyMustSpendAll',
  'arcingShotActive',
  'pendingSpacePick',
  'roundTrooperSurgeStun',
  'pendingDcAbilityChoice',
  'moveInProgress',
  'forceSlowSkipActivation',
  'executorTriggered',
];

const ROUND_NULL_FLAGS = [
  'hitAndRunPendingMp',
  'nextAttacksBonusHits',
  'nextAttackBonusSurgeAbilities',
  'nextAttackBonusPierce',
  'nextAttacksBonusConditions',
  'roundDefenderCannotBeTargetedUnlessWithinSpaces',
  'roundDebuffNextHostileActivation',
  'roundDroidExtraActionCostDamage',
  'sitTightPlayerNum',
  'roundInTheShadowsPlayerNum',
  'strengthInNumbersPlayerNum',
  'strengthInNumbersData',
  'provokeNextActivation',
  'agitateNextActivation',
  'forceVisionNextActivation',
  'forceVisionPending',
  'stillFasterExcludeMsgId',
  'pendingStillFaster',
  'roundUtinniJawaBuffs',
  'roundSmugglersTricksPlayerNum',
  'squadSwarmPlayerNum',
  'squadSwarmCumulativeCost',
  'whenDefeatHostileWithin3GainBlockTokens',
  'pendingRushPush',
  'pendingMassivePush',
  'pendingEmperorInterrupt',
  'pendingExecutiveOrder',
  'pendingBombardmentSorin',
  'pendingFiringSquad',
  'pendingCoordinatedRaid',
  'pendingFieldTactics',
  'pendingAwr',
  'sonOfSkywalkerActive',
  'dataTheftStolenCard',
  'conditionalFocusIfDamagedGte',
  'pendingToughLuck',
  'pendingBELReorder',
  'pendingThereIsNoTry',
  'pendingSelfDestruct',
  'pendingLastResort',
  'nextDefeatedFriendlyVpReduction',
  'forceDefenderRerollOne',
  'doubleMatchingIconsOnReroll',
  'pendingHunterProtocol',
  'holdGroundPlayerNum',
  'windfallActive',
  'wreakVengeanceActive',
  'toughLuckPlayerNum',
  'thereIsNoTryPlayerNum',
  'youWillNotDenyMeActive',
  'mandaAsteelPlayerNum',
  'stillFasterPlayerNum',
  'signalJammerActive',
  'terminalControlPlayerNum',
  'unlimitedPowerActive',
  'shadowOpsBlockedPlayer',
  'criticalHitBlockedPlayer',
  'pendingOrbitalBombardment',
  'pendingYHSIW',
  'powerfulInfluencePlayerNum',
  'restInPeaceActive',
  'pendingIllicitArms',
  'pendingExtraProtection',
  'extraProtectionTriggeredThisCombat',
  'pendingExecutorInterrupt',
  'pendingCcConfirmation',
  'pendingNegation',
  'pendingCommDisruptionPrompt',
  'pendingCoverFire',
  'pendingStrainChoice',
  'pendingVoracious',
  'pendingAssassinsBlade',
  'pendingPunishingStrike',
  'pendingConspire',
  'pendingItWillBeAlright',
  'pendingGeneralsOrders',
  'pendingMotivation',
  'pendingTrustedAlly',
  'pendingTokenDistribution',
  'pendingLieInAmbush',
  'pendingPowerTokenGrant',
  'pendingChannelTheForceStrain',
  'pendingIllegalCcPlay',
  'pendingCcAttachment',
  'pendingCcChoice',
  'pendingCcSpaceChoice',
  'pendingIKnowEverything',
  'pendingSurgeOverflow',
  'pendingInterrogate',
  'pendingMastery',
  'pendingMissionSorReveal',
  'pendingSuppressiveFireMp',
  // Combat pipeline pendings — safety net (deleted on happy path, but no fallback if handler throws)
  // NOTE: pendingCombat intentionally omitted — handled by recovery.js
  'pendingCelebration',
  'pendingCleave',
  'pendingFightingKnife',
  'pendingConcussiveBolt',
  'pendingSpreadThePain',
  'pendingSpreadThePainCondPick',
  'pendingReaction',
  'pendingBoltslinger',
  'pendingIndiscriminateFire',
  'pendingHeavyFire',
  'pendingHavocShot',
  'pendingDeflect',
  'pendingWantonDestruction',
  'pendingFigurehead',
  'pendingRogueOneTokenPick',
  'pendingZilloDiscard',
  'pendingStrikeMeDown',
  'pendingSlowOnTheDraw',
  'pendingForceExhaustion',
  'slowOnTheDrawInterrupt',
  // Movement/activation pendings — safety net
  'pendingFalseOrders',
  'pendingOrderedMove',
  'pendingShoulderRush',
  'pendingDioFollow',
  'pendingEe3Carbine',
  'pendingRightBackAtYa',
  'pendingBattlefieldLeadership',
  'pendingScavengedWeaponryTransfer',
  'pendingHeroicEffortReturn',
];

const ROUND_ARRAY_FLAGS = [
  'crippledFigures',
  'disabledFigures',
  'etiquetteBlockPairs',
  'fluctuationSwappedThisRound',
  'abilityExhaustedMsgIds',
];

const ROUND_FALSE_FLAGS = [
  'harshEnvironmentActive',
  'noCommandDrawThisRound',
  'p1LaunchPanelFlippedThisRound',
  'p2LaunchPanelFlippedThisRound',
  'powerConverterUsedThisRound',
];

const ROUND_DELETE_FLAGS = [
  'commsJammerActivePlayerNum',
  'partingShotTriggered',
  'onTheLamActive',
  'jundlandTerrorPlayedThisEor',
  'reinforcementsPlayedThisSor',
  'pendingBlackMarket',
  'deWannaWangaUsedThisRound',
  'arcingShotActiveScalar',
  'pendingDoorSelections',
  'pendingKryknaPushQueue',
  'kryknaPushedIds',
  'roundDioxisActive',
  'pendingStartOfRoundResolve',
  'pendingDeployOrientation',
  'pendingFluctuationSwapQueue',
  'pendingFluctuationSwapFirst',
  'drivenByHatredForceChoke',
  // Stale per-attack tracking — safety net
  'lastAttackAttackerMsgId',
  'lastAttackAttackerFigureIndex',
  'lastAttackTargetFigureKey',
  'lastDefeatInfo',
  'lastAttackTargetSpacesForRubble',
  'lastAttackAttackerPlayerNum',
  // Per-round gates that must reset
  'iKnowEverythingResolved',
];

/**
 * Reset all round-scoped flags at the start of a new round.
 * Called in handleEndEndOfRound after all end-of-round effects resolve.
 * @param {object} game
 */
export function cleanupRoundStart(game) {
  for (const key of ROUND_OBJECT_FLAGS) {
    game[key] = {};
  }
  for (const key of ROUND_NULL_FLAGS) {
    game[key] = null;
  }
  for (const key of ROUND_ARRAY_FLAGS) {
    game[key] = [];
  }
  for (const key of ROUND_FALSE_FLAGS) {
    game[key] = false;
  }
  for (const key of ROUND_DELETE_FLAGS) {
    delete game[key];
  }
}

// Export flag lists for testing
export {
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
};
