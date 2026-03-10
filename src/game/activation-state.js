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
  'dcActivationLogMessageIds',
  'defenderThreadData',
  'autofireActive',
  'fireMissionActive',
  'autofireChainTargetSpace',
  'darksaberSecondAttack',
  'pendingOverwatchPlacement',
  'activationKills',
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
  'vetInstinctsActiveThisActivation',
];

/**
 * Per-activation scalar flags (deleted outright).
 */
const ACTIVATION_SCALAR_FLAGS = [
  'commsJammerActivePlayerNum',
  'partingShotTriggered',
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
}

/**
 * All round-scoped flags reset at start of new round.
 * Object flags are reset to {}; null flags to null; array flags to [].
 */
const ROUND_OBJECT_FLAGS = [
  'roundDefenseBonusBlock',
  'roundDefenseBonusEvade',
  'roundDefenderBonusBlockPerEvade',
  'roundTrooperAttackHitBonus',
  'roundVehicleSpeedBonus',
  'deflectionPending',
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
  'priceBounties',
  'diplomaticMissionEvade',
  'lastResortTriggered',
  'attackPerformedThisActivation',
  'vadersFocusUsedThisRound',
  'scavengedWalkerAttackPenalty',
  'autofireActive',
  'fireMissionActive',
  'autofireChainTargetSpace',
  'darksaberSecondAttack',
  'pendingOverwatchPlacement',
  'activationKills',
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
  'provokeNextActivation',
  'agitateNextActivation',
  'stillFasterExcludeMsgId',
  'pendingStillFaster',
  'roundUtinniJawaBuffs',
  'roundSmugglersTricksPlayerNum',
  'squadSwarmPlayerNum',
  'whenDefeatHostileWithin3GainBlockTokens',
  'pendingRushPush',
  'pendingEmperorInterrupt',
  'pendingExecutiveOrder',
  'pendingBombardmentSorin',
  'pendingFiringSquad',
  'pendingCoordinatedRaid',
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
  'pendingOrbitalBombardment',
];

const ROUND_ARRAY_FLAGS = [
  'crippledFigures',
  'disabledFigures',
  'etiquetteBlockPairs',
];

const ROUND_FALSE_FLAGS = [
  'harshEnvironmentActive',
  'noCommandDrawThisRound',
  'p1LaunchPanelFlippedThisRound',
  'p2LaunchPanelFlippedThisRound',
];

const ROUND_DELETE_FLAGS = [
  'commsJammerActivePlayerNum',
  'partingShotTriggered',
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
