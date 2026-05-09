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
  'pendingMoveX',
  // On a Mission per-step push prompt: pauses the picker between steps
  // so the player can push a SMALL figure 1 space (or skip).
  'pendingOnAMissionPush',
  // Lord of the Sith / [Driven by Hatred]: per-msgId one-shot dice
  // penalty consumed at handleCombatReady.
  'attackDicePenaltyForMsgId',
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
  'freeAttackDifferentTargets',
  'heroicUsedThisActivation',
  'boRifleStaffUsedThisActivation',
  'pendingOverrideAttackDice',
  'pendingSlingBarrage',
  // Overheated (Paz Vizsla): per-msgId attack-type override that
  // persists across attacks. Set after Overheated's 2 ranged attacks
  // resolve so the figure's attack type becomes Melee for the rest
  // of the round. Cleared on round boundary.
  'attackTypeOverride',
  // Overheated active state — tracks attacksRemaining so the
  // post-attack hook in combat-bridge knows when to flip
  // attackTypeOverride to 'melee'.
  'overheatedActive',
  // Static Pulse per-target chained choice state — cleared at round
  // boundary in case a player abandons the picker mid-flight.
  'pendingStaticPulse',
  // Chaotic / Corrupting / Balancing Force shared per-player picker
  // state — cleared at round boundary in case picker is abandoned.
  'pendingForceCardPick',
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
  // Audit 2026-05-05: per-activation msgId-keyed fields surfaced by
  // tests/certification/msgid-flags-completeness.test.js. Each was used
  // as `game.X[msgId] = ...` with inline cleanup at activation/attack
  // resolve, but never registered for the universal cleanup routine.
  // Registering here makes cleanupActivation() zero them per-msgId at
  // activation end, matching their actual lifecycle.
  'activationDoubleSpecialAction',
  'companionActivatedBefore',
  'falseOrdersAttackTargets',
  'paybackBonusSurge',
  'pounceAttackPending',
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
  'figureWallRunActive',
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
  // partingShotTriggered is technically msgId-keyed (game.partingShotTriggered[msgId] = true)
  // but is INTENTIONALLY registered here, NOT in ACTIVATION_MSGID_FLAGS. The desired
  // semantic at activation end is "wipe everyone's parting-shot tracking" so the
  // next round's interrupts can fire fresh. ACTIVATION_SCALAR_FLAGS does
  // `delete game[key]` which achieves that whole-field wipe; the defensive
  // `game.partingShotTriggered = game.partingShotTriggered || {}` guard at the use
  // sites rebuilds the map cleanly. Moving to ACTIVATION_MSGID_FLAGS would only
  // delete the activating DC's entry per-msgId — preserving OTHER DCs' stale
  // parting-shot state across activations. Don't move. (Audit 2026-05-05.)
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
  // Per destruct 2026-05-07: clear the per-activation named-CC bucket so
  // a new activation starts with a fresh set. Each activation is its own
  // timing instance for "duringActivation" / "startofactivation" /
  // "endofactivation" CCs.
  if (game.namedCcsPlayedPerTiming?.activation) {
    delete game.namedCcsPlayedPerTiming.activation;
  }
}

/**
 * Per destruct 2026-05-07: multi-figure groups give each figure 2 actions
 * individually. When an action consumes from `actionsData`, we must
 * decrement BOTH the group-wide `remaining` AND the per-figure budget
 * `perFigureRemaining[figIdx]`. When a figure's budget hits 0, lock the
 * figure (figureLocked[figIdx] = true) so it cannot act again — IACP
 * rule "each figure must complete all of their actions before the next
 * figure begins" is enforced by preventing return to a locked figure.
 *
 * Use this helper at every action-consumption site that previously did
 * `actionsData.remaining = Math.max(0, actionsData.remaining - 1)`.
 *
 * @param {object} actionsData  - game.dcActionsData[msgId]
 * @param {number} cost          - 1 for normal action, 2 for Double Action
 * @returns {void}
 */
export function consumeActionForCurrentFigure(actionsData, cost = 1) {
  if (!actionsData || cost <= 0) return;
  actionsData.remaining = Math.max(0, (actionsData.remaining ?? 0) - cost);
  const figIdx = actionsData.selectedFigure ?? 0;
  if (actionsData.perFigureRemaining) {
    const cur = actionsData.perFigureRemaining[figIdx] ?? 0;
    const next = Math.max(0, cur - cost);
    actionsData.perFigureRemaining[figIdx] = next;
    if (next === 0) {
      actionsData.figureLocked = actionsData.figureLocked || {};
      actionsData.figureLocked[figIdx] = true;
      // Per destruct 2026-05-07: figure done → force re-pick from
      // dropdown for next figure. Clear selectedFigure so the action-
      // button row is replaced with the figure-select dropdown next
      // render. Locked figures are filtered out of the dropdown
      // automatically (components.js).
      actionsData.selectedFigure = null;
    }
  }
}

/**
 * True iff a click-time-decremented action is still mid-resolution for this DC.
 * Action costs are committed when the button is pressed (Move/Special/etc.),
 * but the resolution can take multiple Discord interactions (move grid, target
 * pick, combat). During that window the "all actions completed" prompt and the
 * End Activation handler must be suppressed — otherwise the user can end the
 * activation with cost paid but effect unresolved (figure stays put, etc.).
 *
 * Checks the three universal in-flight surfaces:
 *   - game.pendingCombat        single-stream global; any pending combat blocks
 *   - game.moveInProgress[k]    compound key `${msgId}_${figureIndex}`
 *   - game.pendingSpacePick[k]  context key contains msgId
 *
 * Ability-specific pending flags (50+) aren't enumerated here — they resolve
 * inside the activation thread via prompts and don't tempt the user toward
 * the End Activation button the way an open move grid does. Avoiding the
 * enumerate-and-drift pattern is intentional.
 */
export function isActivationActionInProgress(game, msgId) {
  if (!msgId) return false;
  if (game.pendingCombat) return true;
  if (game.moveInProgress) {
    const prefix = `${msgId}_`;
    for (const k of Object.keys(game.moveInProgress)) {
      if (k.startsWith(prefix)) return true;
    }
  }
  if (game.pendingSpacePick) {
    for (const k of Object.keys(game.pendingSpacePick)) {
      if (k.includes(msgId)) return true;
    }
  }
  // SoA orchestrator: while a chooser bucket is open, the activation has not
  // finished its start-of-activation phase. Block "End Activation" so the
  // player can't dismiss the activation with SoA decisions still pending.
  if (game.pendingSoaResolution) {
    const ctx = game.pendingSoaResolution.activationContext;
    if (ctx?.activatorMsgId === msgId) return true;
  }
  return false;
}

/**
 * All round-scoped flags reset at start of new round.
 * Object flags are reset to {}; null flags to null; array flags to [].
 */
const ROUND_OBJECT_FLAGS = [
  'roundDefenseBonusBlock',
  // Generic named-CC per-timing-instance tracker (destruct 2026-05-07).
  // Reset to {} at round start so SOR/EOR/status buckets clear naturally;
  // 'activation' bucket clears explicitly in cleanupActivation; 'attack'
  // bucket clears when pendingCombat resolves (resolvePendingCombat).
  'namedCcsPlayedPerTiming',
  'roundDefenseBonusEvade',
  'roundDefenseAccuracyPenalty',
  'roundMobileDefenseBonusBlock',
  'roundDefenderBonusBlockPerEvade',
  'roundPushImmuneUnlessMassive',
  'roundTrooperAttackHitBonus',
  'roundVehicleSpeedBonus',
  'deflectionPending',
  'deflectionUnconditional',
  'roundAttackRerollDice',
  'freeAttackBonusPending',
  'freeAttackDifferentTargets',
  'heroicUsedThisActivation',
  'boRifleStaffUsedThisActivation',
  'pendingOverrideAttackDice',
  'pendingSlingBarrage',
  // Overheated (Paz Vizsla): per-msgId attack-type override that
  // persists across attacks. Set after Overheated's 2 ranged attacks
  // resolve so the figure's attack type becomes Melee for the rest
  // of the round. Cleared on round boundary.
  'attackTypeOverride',
  // Overheated active state — tracks attacksRemaining so the
  // post-attack hook in combat-bridge knows when to flip
  // attackTypeOverride to 'melee'.
  'overheatedActive',
  // Static Pulse per-target chained choice state — cleared at round
  // boundary in case a player abandons the picker mid-flight.
  'pendingStaticPulse',
  // Chaotic / Corrupting / Balancing Force shared per-player picker
  // state — cleared at round boundary in case picker is abandoned.
  'pendingForceCardPick',
  'nextAttackReach',
  'fellSwoopFreeAttack',
  // Lord of the Sith / [Driven by Hatred]: msgId-keyed "remove N dice
  // from this msgId's next attack pool" one-shot debuff. Cleared on
  // consumption in handleCombatReady (see combat.js attack-pool block).
  'attackDicePenaltyForMsgId',
  // On a Mission per-step push state: msgId-keyed snapshot of the
  // SMALL figure currently being prompted for a 1-space push. Cleared
  // by handleOnAMissionPush (direction or skip).
  'pendingOnAMissionPush',
  // Deploy the Garrison per-figure resolution state — tracks which
  // qualifying TROOPER/GUARDIAN figures have already chosen
  // token-or-move so the dispatch knows what's remaining each click.
  'pendingDeployGarrison',
  // Hunt Dissent (Agent Kallus): once-per-round gate keyed by Kallus's
  // playerNum. Set true on the FIRST opponent CC-play of the round
  // when the Hunt Dissent picker fires. Cleared on round boundary so
  // the trigger is available again next round.
  'huntDissentResolvedThisRound',
  // Hunt Dissent active distribution state (when picker is open).
  'pendingHuntDissent',
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
  'pendingMoveX',
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
  // Vader's Finest Attack+Move special: per-msgId flag set when the
  // special action button is clicked. Consumed in
  // enqueueAttackerPerDcEffects to enqueue a vaders_finest_move
  // step-8 effect, which fires the 1-space Move-X picker.
  'vadersFinestPostAttackMove',
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
  // Moved 2026-05-05 from ROUND_NULL_FLAGS — used as msgId-keyed objects;
  // ROUND_OBJECT_FLAGS resets to {} which matches the defensive
  // `game.X = game.X || {}` guard pattern at all call sites.
  'pendingEe3Carbine',
  // pendingVoracious removed 2026-05-07 — Voracious migrated to SoA
  // orchestrator (slice 6); replaced by game.voraciousUsed.
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
  'pendingSoaResolution',
  'voraciousUsed',
  'jynHairTriggerUsed',
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
  'pendingMoveXSequence',
  'pendingExecutiveOrderAction',
  'pendingEmperorInterrupt',
  'pendingExecutiveOrder',
  'pendingBombardmentSorin',
  'pendingFiringSquad',
  'pendingCoordinatedRaid',
  'pendingFieldTactics',
  // pendingAwr removed 2026-05-07 — AWR migrated to SoA orchestrator (slice 8a).
  'sonOfSkywalkerActive',
  'dataTheftStolenCard',
  'conditionalFocusIfDamagedGte',
  'pendingToughLuck',
  'pendingBELReorder',
  'pendingThereIsNoTry',
  'pendingSelfDestruct',
  'pendingSelfDestructMove',
  'pendingMoveInterrupts',
  'pendingStrainEvent',
  'pendingLastResort',
  'nextDefeatedFriendlyVpReduction',
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
  'pendingDefeatPick',
  'pendingPartingShot',
  'pendingCcConfirmation',
  'pendingNegation',
  'pendingCommDisruptionPrompt',
  'pendingCoverFire',
  'pendingStrainChoice',
  // pendingVoracious historical note (2026-05-05): was used as an
  // msgId-keyed map, so registered in ROUND_OBJECT_FLAGS. Replaced by
  // voraciousUsed in slice 6 (2026-05-07) when Voracious migrated to
  // the SoA orchestrator.
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
  // pendingEe3Carbine moved to ROUND_OBJECT_FLAGS 2026-05-05 — same
  // reasoning as pendingVoracious above.
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
  'pendingClaimedKryknaQueue',
  'roundDioxisActive',
  'pendingStartOfRoundResolve',
  'pendingSorActions',
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
