/**
 * Context factory: builds handler context objects from a shared dependencies bag.
 * Each context group defines the set of dependency keys its handlers need.
 */

/** Shared combat dependencies — used by both combat and combatReactions groups. */
const COMBAT_DEPS = [
  'getGame', 'replyIfGameEnded', 'dcMessageMeta', 'dcHealthState',
  'findDcMessageIdForFigure', 'getDcStats', 'getDcEffects',
  'updateDcActionsMessage', 'updateActivationsMessage',
  'updateAttachmentMessageForDc', 'logGameAction', 'isGroupDefeated',
  'checkWinConditions', 'finishCombatResolution', 'checkPostCombatSurges',
  'ACTION_ICONS', 'ThreadAutoArchiveDuration', 'resolveCombatAfterRolls', 'runAfterResolveWindow',
  'saveGames', 'client', 'rollAttackDice', 'rollDefenseDice',
  'rollSingleAttackDie', 'rollSingleDefenseDie', 'recalcAttackTotals',
  'recalcDefenseTotals', 'getInnateRerolls', 'getAttackerSurgeAbilities',
  'SURGE_LABELS', 'parseSurgeEffect', 'getAbility', 'resolveSurgeAbility',
  'getSurgeAbilityLabel', 'getRange', 'hasLineOfSight',
  'hasLineOfSightByCoord', 'hasFigureLineOfSight', 'getFigureFootprint', 'getAllFigureFootprints', 'getFigureSize',
  // Geometry helpers required by buildFigureBlockingCoords +
  // _buildLosEffectiveMs (post-declare LoS probe in handleCombatRoll,
  // any future same-team LoS check like Gideon Argus). Previously
  // omitted; the probe silently aborted attacks when these were
  // undefined. Now strictly required.
  'getFootprintCells', 'getMapTokensData',
  'getDiceData',
  'applyDamageAndFinishCombat', 'isDcUnique', 'getCelebrationButtons', 'getFiguresAdjacentToCoord',
  'calculateKillVp', 'checkHuntDissent', 'checkThisIsTheWay', 'decrementActivationIfGroupDefeated',
  'checkFriendlyDefeatedPassiveRedraws', 'ccAttachmentsKey',
  'checkNefariousGains', 'updateHandVisualMessage', 'updateDiscardPileMessage',
  'sendBleedingPrompt', 'processFigureDefeat',
  'getMapData', 'getEffectiveMapSpaces', 'isWithinN', 'getFigureLabel',
  // findFigureheadFigure: applyStrain (called from combat-path strain like
  // Heavy Repeater / weapon strain costs) consults it to fire the Figurehead
  // STRAIN reaction (alexanbv 2026-06-20).
  'findFigureheadFigure',
  'computeCleaveEligibleTargets', 'getCleaveTargetButtons',
  // CC play from the combat gate (playCC) needs the ability resolver, else gate
  // CCs discard with no effect (alexanbv 2026-06-16 re-audit). dcMessageMeta/
  // dcHealthState are already in this group; applyAbilityResult is imported
  // directly by the caller (not a bag dep).
  'resolveAbility', 'getCcEffect',
];

const CONTEXT_GROUPS = {
  ccHand: [
    'getGame', 'dcMessageMeta', 'dcHealthState', 'dcExhaustedState', 'saveGames',
    'pushUndo', 'client', 'pendingIllegalSquad', 'pendingSquadConfirm', 'PENDING_ILLEGAL_TTL_MS',
    'validateDeckLegal', 'sendDeckIllegalAlert', 'sendSquadConfirmation', 'applySquadSubmission',
    'getHandTooltipEmbed', 'getHandSquadButtons', 'shuffleArray',
    'buildHandDisplayPayload', 'updateHandVisualMessage', 'updateHandChannelMessages',
    'updatePlayAreaDcButtons',
    'sendRoundActivationPhaseMessage', 'runStartOfRoundDcEffects', 'logGameAction', 'sendPhaseGateMessages',
    'buildDiscardPileDisplayPayload', 'updateDiscardPileMessage', 'getCcEffect',
    'isCcAttachment', 'isCcPlayableNow', 'isCcPlayLegalByRestriction',
    'getIllegalCcPlayButtons',
    'updateAttachmentMessageForDc', 'getPlayableCcFromHand', 'resolveAbility',
    'updateDcActionsMessage', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcStats', 'getDcPlayAreaComponents', 'buildBoardMapPayload', 'getBoardStateForMovement',
    'getMapAttachmentForSpaces',
    'ensureMovementBankMessage', 'updateMovementBankMessage', 'getConditionCardPath',
    'getCommandCardImagePath', 'getDeploymentZones', 'updateDeployPromptMessages',
    'processFigureDefeat', 'checkWinConditions',
  ],

  dcPlayArea: [
    'getGame', 'replyIfGameEnded', 'saveGames', 'pushUndo', 'client',
    'dcMessageMeta', 'dcExhaustedState', 'dcHealthState',
    'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage', 'getDcPlayAreaComponents',
    'getDcActionButtons', 'getActionsCounterContent', 'getActivationMinimapAttachment',
    'updateActivationsMessage', 'getActivateDcButtons', 'DC_ACTIONS_PER_ACTIVATION',
    'ACTION_ICONS', 'logGameErrorToBotLogs', 'extractGameIdFromInteraction',
    'logGameAction', 'isDepletedRemovedFromGame',
    'getPlayableCcSpecialsForDc', 'getPlayableCcEndOfActivationForDc',
    'getPlayableCcDoubleActionsForDc', 'getCcEffect', 'isCcAttachment',
    'updateAttachmentMessageForDc', 'buildHandDisplayPayload',
    'updateHandVisualMessage', 'updateDiscardPileMessage', 'updateDcActionsMessage',
    'getDcStats', 'getDcEffects', 'getMapData', 'getFigureSize', 'getFootprintCells',
    'getRange', 'hasLineOfSight',
    'hasLineOfSightByCoord', 'hasFigureLineOfSight', 'getFigureFootprint', 'getAllFigureFootprints', 'getFigureSize',
    'isDcUnique', 'getCelebrationButtons',
    'applyDamageAndFinishCombat', 'getEffectiveSpeed', 'ensureMovementBankMessage',
    'getBoardStateForMovement', 'getMovementProfile', 'computeMovementCache',
    'getMovementMinimapAttachment', 'clearMoveGridMessages',
    'getLegalInteractOptions', 'FIGURE_LETTERS', 'resolveAbility',
    'sendBleedingPrompt', 'updateMovementBankMessage',
    'getCommandCardImagePath', 'getConditionCardPath', 'buildBoardMapPayload',
    'findDcMessageIdForFigure', 'isGroupDefeated', 'checkWinConditions',
    'getMapAttachmentForSpaces',
    'getMapTokensData', 'getDeploymentZones',
    'processFigureDefeat',
    // SoA-handler strain (e.g. Channel the Force) flows through applyStrain,
    // which consults findFigureheadFigure for the Figurehead STRAIN reaction.
    'findFigureheadFigure',
  ],

  move: [
    'getGame', 'dcMessageMeta', 'getBoardStateForMovement', 'getMovementProfile',
    'ensureMovementCache', 'getSpacesAtCost', 'clearMoveGridMessages',
    'getMovementMinimapAttachment', 'client',
  ],

  moveAdjust: [
    'getGame', 'dcMessageMeta', 'clearMoveGridMessages', 'getMoveMpButtonRows',
  ],

  movePick: [
    'getGame', 'dcMessageMeta', 'clearMoveGridMessages', 'getBoardStateForMovement',
    'getMovementProfile', 'ensureMovementCache', 'computeMovementCache',
    'normalizeCoord', 'getMovementTarget', 'getFigureSize', 'getNormalizedFootprint',
    'initMassiveDisplacement', 'resolveNextDisplacements', 'applyDisplacementChoice',
    'resolveMassivePush', 'updateMovementBankMessage', 'getMovementPath',
    'pushUndo', 'logGameAction', 'countTerminalsControlledByPlayer',
    'getMovementMinimapAttachment', 'buildBoardMapPayload',
    'updateDcActionsMessage', 'sendBleedingPrompt', 'getDcStats', 'dcHealthState',
    'saveGames', 'client',
    'processFigureDefeat',
  ],

  moveX: [
    'getGame', 'saveGames', 'client', 'logGameAction', 'dcMessageMeta',
    // sdpExplode continuation needs the damage / dice / defeat helpers.
    'dcHealthState', 'getDiceData', 'getMapData', 'processFigureDefeat',
    'applyDamageAndFinishCombat',
  ],

  thugMove: [
    'getGame', 'saveGames', 'client', 'logGameAction',
    'applyNpcDamageToFigure', 'dcHealthState', 'dcMessageMeta',
    'checkWinConditions',
  ],

  combat: COMBAT_DEPS,

  combatReactions: [
    ...COMBAT_DEPS,
    // Plus combatReactions-specific deps
    'canActAsPlayer', 'sendRerollUI', 'proceedAfterRerolls', 'sendReadyToResolveRolls',
    'ButtonBuilder', 'ActionRowBuilder', 'ButtonStyle',
    'removeFigurePosition',
  ],

  postCombat: [
    'getGame', 'client', 'saveGames', 'canActAsPlayer',
    'checkPostCombatSurges', 'finishCombatResolution',
    'findDcMessageIdForFigure', 'getMapData', 'applyDirectDamageToFigure',
    'updateHandChannelMessages', 'getCcEffect',
    'ButtonBuilder', 'ActionRowBuilder', 'ButtonStyle',
    // After-attack-resolve fire handlers (slice 2b)
    'dcHealthState', 'logGameAction', 'replyIfGameEnded',
    'dcMessageMeta', 'checkWinConditions',
    // gate_ability → playCC needs the ability resolver so after-attack CCs
    // (Escalating Hostility, …) actually apply (re-audit fix); applyAbilityResult
    // is imported directly by the fire handler.
    'resolveAbility',
  ],

  activation: [
    'getGame', 'replyIfGameEnded', 'hasActionsRemainingInGame',
    'GAME_PHASES', 'PHASE_COLOR', 'getInitiativePlayerZoneLabel',
    'getPlayerZoneLabel', 'logGameAction', 'pushUndo',
    'updateHandChannelMessages', 'saveGames', 'client', 'dcMessageMeta', 'sendPhaseGateMessages',
    'dcHealthState', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'maybeShowEndActivationPhaseButton', 'updateRoundActivationMessage',
    'repostRoundActivationMessage',
    'dcExhaustedState', 'updateActivationsMessage', 'getActionsCounterContent',
    'getDcActionButtons', 'getActivationMinimapAttachment', 'getActivateDcButtons',
    'DC_ACTIONS_PER_ACTIVATION', 'ThreadAutoArchiveDuration', 'ACTION_ICONS',
    'updateDcActionsMessage', 'getDcStats', 'getRange', 'hasLineOfSight',
    'hasLineOfSightByCoord', 'hasFigureLineOfSight', 'getFigureFootprint', 'getAllFigureFootprints', 'getFigureSize',
    'getMapData',
    'findDcMessageIdForFigure', 'updateHandVisualMessage',
    'ButtonBuilder', 'ActionRowBuilder', 'ButtonStyle',
    'checkWinConditions', 'processFigureDefeat',
  ],

  round: [
    'getGame', 'replyIfGameEnded', 'getPlayerZoneLabel', 'logGameAction',
    'updateHandChannelMessages', 'saveGames', 'dcMessageMeta', 'dcExhaustedState',
    'dcHealthState', 'isDepletedRemovedFromGame', 'buildDcEmbedAndFiles', 'renderDcEmbed',
    'getConditionsForDcMessage', 'getNicknamesForDcMessage', 'getDcPlayAreaComponents', 'getDcStats',
    'countTerminalsControlledByPlayer', 'isFigureInDeploymentZone',
    'checkWinConditions', 'getMapTokensData', 'getSpaceController',
    'getMissionRules', 'runEndOfRoundRules', 'runStartOfRoundRules',
    'getFiguresOnOrAdjacentToSpace', 'runNpcThugActivation',
    'runNpcKryknaActivation', 'applyNpcDamageToFigure', 'getMapData',
    'getMapRegistry', 'filterMapSpacesByBounds', 'getInitiativePlayerZoneLabel',
    'updateHandVisualMessage', 'buildHandDisplayPayload',
    'sendRoundActivationPhaseMessage', 'buildBoardMapPayload',
    'postDevaronDoorButtons', 'postDevaronCratePushPrompts',
    'postKryknaPushButtons', 'postFluctuationSwapButtons',
    'postArmsDistributionPrompt', 'postPrototypeMovePrompt',
    'client', 'sendPhaseGateMessages',
    // 2026-05-12 production-bug fix (game ia00002 stuck post-deploy):
    // round handlers like handleExtraArmorConfirm reach into
    // advanceFromDeployment → autoDrawAllStartingHands →
    // drawStartingHandForPlayer, which destructures `shuffleArray`
    // from ctx. Round group was missing it.
    'shuffleArray',
    // Follow-on for the same stall (game ia00001 / ia00002): after
    // hands auto-draw, advanceFromCcDraw runs and reads
    // `runStartOfRoundContinuation` from ctx. If missing, the
    // `if (runStartOfRoundContinuation)` guard silently skips and
    // the game never posts the first activation phase message.
    'runStartOfRoundContinuation',
    // Helpers reached by the post-deploy → cc_draw chain.
    'runPostDeployPhase', 'clearPreGameSetup', 'getCcShuffleDrawButton',
    'updatePlayAreaDcButtons',
  ],

  startOfRound: [
    'getGame', 'replyIfGameEnded', 'getPlayerZoneLabel', 'logGameAction',
    'updateHandChannelMessages', 'saveGames', 'shouldShowEndActivationPhaseButton',
    'sendPhaseGateMessages',
    'countTerminalsControlledByPlayer', 'GAME_PHASES', 'PHASE_COLOR', 'client',
  ],

  setup: [
    'getGame', 'getPlayReadyMaps', 'getTournamentRotation', 'getMissionCardsData',
    'getMapRegistry', 'getMapTypeButtons', 'getMapSelectionTooltipEmbed',
    'getMapConfirmButton', 'getMissionSelectDrawMenu', 'getMissionSelectionPickMenu',
    'postMissionCardAfterMapSelection', 'postPinnedMissionCardFromGameState',
    'buildBoardMapPayload', 'logGameAction', 'getGeneralSetupButtons',
    'createPlayAreaChannels', 'createBoardChannel', 'createHandThreads',
    'getHandTooltipEmbed', 'getHandSquadButtons', 'runDraftRandom',
    'logGameErrorToBotLogs', 'extractGameIdFromInteraction', 'clearPreGameSetup',
    'getDeploymentZoneButtons', 'getDeploymentZones', 'getDeployFigureLabels',
    'getDeployButtonRows', 'getDeploymentMapAttachment', 'getFigureSize',
    'getFootprintCells', 'filterValidTopLeftSpaces', 'parseCoord',
    'getDeploySpaceGridRows', 'buildDeployRowButtons', 'pushUndo',
    'updateDeployPromptMessages', 'getInitiativePlayerZoneLabel',
    'getCcShuffleDrawButton', 'client', 'saveGames', 'isDcAttachment',
    'resolveDcName', 'isFigurelessDc', 'finishSetupAttachments',
    'dcHealthState', 'dcMessageMeta', 'updateAttachmentMessageForDc',
    'reorderPlayAreaAfterAttachments',
    'runPostDeployPhase', 'applySquadSubmission',
    'sendPhaseGateMessages',
  ],

  interactCancel: [
    'getGame', 'dcMessageMeta',
  ],

  interact: [
    'getGame', 'dcMessageMeta', 'dcHealthState', 'getLegalInteractOptions',
    'getDcStats', 'getDcEffects', 'updateDcActionsMessage', 'logGameAction',
    'sendBleedingPrompt', 'saveGames', 'pushUndo', 'getMissionTokenLabel',
  ],

  refreshMap: [
    'getGame', 'buildBoardMapPayload', 'logGameErrorToBotLogs', 'client',
  ],

  refreshAll: [
    'getGame', 'refreshAllGameComponents', 'logGameErrorToBotLogs', 'saveGames', 'client',
  ],

  clearStaleCombat: [
    'getGame', 'client',
  ],

  undo: [
    'getGame', 'saveGames', 'updateMovementBankMessage', 'buildBoardMapPayload',
    'logGameAction', 'updateDeployPromptMessages',
    'getDeploymentZoneButtons', 'client',
    'sendPhaseGateMessages',
    // Phase-3 renderer wiring: undo routes UI refresh through
    // refreshAllGameComponents (the canonical reconciler) instead of
    // each undo-type updating its own UI surfaces inline. Strip-on-sight
    // any updateX deps that refreshAllGameComponents already handles.
    'refreshAllGameComponents', 'repopulateDcMapsForGame',
    'dcExhaustedState', 'dcMessageMeta', 'dcHealthState',
    // Kept for the activation undo's `dcExhaustedState.set(msgId, false)`
    // pre-refresh — explicitly resets the exhausted flag so the refreshed
    // DC card shows the correct "ready" state.
  ],

  botmenu: [
    'getGame', 'deleteGame', 'saveGames', 'dcMessageMeta', 'dcExhaustedState',
    'dcHealthState', 'logGameErrorToBotLogs', 'client', 'deleteGameFromDb',
    'channelDeleteGuard',
  ],

  forfeit: [
    'getGame', 'postGameOver', 'logGameErrorToBotLogs', 'client',
  ],

  fastForward: [
    'getGame', 'saveGames', 'client', 'dcExhaustedState', 'dcHealthState',
    'dcMessageMeta', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'getDcStats', 'getDcActionButtons', 'getActionsCounterContent',
    'getActivationMinimapAttachment', 'updateActivationsMessage',
    'DC_ACTIONS_PER_ACTIVATION', 'logGameAction', 'getCcEffect', 'resolveAbility',
    'updateHandVisualMessage', 'updateDiscardPileMessage',
  ],

  defenderCc: [
    'getGame', 'saveGames', 'client', 'dcMessageMeta', 'getCcEffect',
    'resolveAbility', 'logGameAction', 'updateHandVisualMessage',
    'updateDiscardPileMessage',
  ],

  killGame: [
    'getGame', 'deleteGame', 'saveGames', 'dcMessageMeta', 'dcExhaustedState',
    'dcHealthState', 'logGameErrorToBotLogs', 'client', 'deleteGameFromDb',
    'channelDeleteGuard',
  ],

  defaultDeck: [
    'getGame', 'applySquadSubmission', 'logGameErrorToBotLogs',
    'DEFAULT_DECK_REBELS', 'DEFAULT_DECK_SCUM', 'DEFAULT_DECK_IMPERIAL', 'client',
  ],

  lobbyJoin: [
    'getGame', 'setGame', 'lobbies', 'countActiveGamesForPlayer',
    'MAX_ACTIVE_GAMES_PER_PLAYER', 'getLobbyEmbed', 'getLobbyStartButton',
    'updateThreadName',
  ],

  lobbyStart: [
    'setGame', 'saveGames', 'lobbies', 'countActiveGamesForPlayer', 'MAX_ACTIVE_GAMES_PER_PLAYER',
    'createGameChannels', 'getGeneralSetupButtons', 'logGameErrorToBotLogs',
    'updateThreadName', 'EmbedBuilder',
  ],

  interrupts: [
    'getGame', 'canActAsPlayer', 'saveGames', 'client', 'dcMessageMeta',
    'dcHealthState', 'logGameAction', 'getDiceData', 'getMapData',
    // findDcMessageIdForFigure + findFigureheadFigure: needed by the
    // applyStrain pipeline when a strain prompt (Figurehead / per-strain
    // choice) resolves in this ctx — Fireproof lookup, strain→damage, and the
    // Figurehead strain reaction (alexanbv 2026-06-20).
    'findDcMessageIdForFigure', 'findFigureheadFigure',
    'applyDamageAndFinishCombat', 'checkWinConditions', 'awardObjectiveVp',
    'updateDcActionsMessage', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'getDcStats', 'DC_ACTIONS_PER_ACTIVATION',
    'ButtonBuilder', 'ActionRowBuilder', 'ButtonStyle',
    'updateHandChannelMessages',
    'processFigureDefeat',
    'sendPhaseGateMessages',
    'getBoardStateForMovement', 'getMovementProfile', 'computeMovementCache',
    'computeSpacesReachable',
  ],

  requests: [
    'logGameErrorToBotLogs',
  ],

  mapEvents: [
    'getGame', 'canActAsPlayer', 'saveGames', 'client', 'logGameAction',
    'getMapTokensData', 'postDevaronDoorButtons', 'postDevaronCratePushPrompts',
    'getSpaceController', 'postKryknaPlaceButtons',
    'postArmsDistributionPrompt', 'grantPowerTokens',
    'postPrototypeMovePrompt', 'getMapData', 'getMapRegistry', 'filterMapSpacesByBounds',
    // DC EoR deps: the Krykna mission resume funnels through
    // _openEorWindowAfterMission → _runDcEorForPlayer (alexanbv 2026-06-13),
    // which needs these to resolve the init player's DC end-of-round effects.
    'dcMessageMeta', 'dcHealthState', 'isDepletedRemovedFromGame',
    'isFigureInDeploymentZone', 'checkWinConditions',
  ],

  postDeploy: [
    'getGame', 'saveGames', 'client', 'canActAsPlayer', 'logGameAction',
    'dcMessageMeta', 'getBoardStateForMovement', 'getMovementProfile',
    'computeMovementCache', 'getMovementMinimapAttachment',
    'buildBoardMapPayload',
  ],

  recover: [
    'getGame', 'saveGames', 'client', 'logGameAction',
    'sendReadyToResolveRolls',
    'updateHandChannelMessages', 'getMoveMpButtonRows',
    'sendPhaseGateMessages',
    'getDetermineInitiativeButtons',
    'populatePlayAreas', 'createPlayAreaChannels', 'createBoardChannel',
    'buildBoardMapPayload',
    'dcMessageMeta', 'dcExhaustedState',
    // Resync needs the Refresh All path + recompute helper to do its
    // second + third phases (re-render UI, recompute derived state).
    'refreshAllGameComponents', 'recomputeActivationCounts',
    'repopulateDcMapsForGame',
    // Phase 1.5 (recoverMissingDcCards): re-post DC cards when a buggy
    // reorder pass left the msgId arrays as all-nulls. Same deps as the
    // checkpoint-loader's DC posting path, plus checkpoint DB lookups
    // for best-effort attachment recovery.
    'buildDcEmbedAndFiles', 'getDcPlayAreaComponents', 'getNicknamesForDcMessage',
    'dcHealthState',
    'updateAttachmentMessageForDc', 'renderDcCompanion',
    // createCompanionDcEmbed is the actual poster that renderDcCompanion
    // delegates to. Missing this dep made the original /resync repair
    // silently skip companion embeds (The Child for Baze never appeared).
    'createCompanionDcEmbed',
    'listCheckpointsForGame', 'getCheckpointById',
  ],

  checkpoint: [
    'getGame', 'saveGames', 'client', 'logGameAction',
    'recomputeActivationCounts',
    'repopulateDcMapsForGame',
    'dcMessageMeta', 'dcExhaustedState',
    // New-lobby load needs to spin up channels + render board.
    'createBoardChannel', 'createPlayAreaChannels', 'populatePlayAreas',
    'buildBoardMapPayload', 'sendRoundActivationPhaseMessage',
    // Phase-specific UI safety nets (CC-draw prompts, Draft-Random
    // activation message, etc.) live inside refreshAllGameComponents.
    // Without it, a checkpoint load into a phase like cc_draw leaves
    // the players stuck — no Shuffle/Draw button, no progression.
    'refreshAllGameComponents',
    // Loader rebuilds DC attachment + companion messages post-load (audit
    // gap 5/6) using these on-demand helpers + the embed deps that
    // createCompanionDcEmbed needs internally.
    'updateAttachmentMessageForDc',
    'createCompanionDcEmbed',
    'buildDcEmbedAndFiles', 'dcHealthState', 'getDcPlayAreaComponents',
    'getNicknamesForDcMessage',
    // Cosmetic post-pass: deletes + reposts DC/attachment/companion
    // messages in interleaved order so they don't end up in three batches
    // at the bottom of the play area.
    'reorderPlayAreaAfterCheckpointLoad',
  ],

  phaseGate: [
    'getGame', 'saveGames', 'client', 'logGameAction',
    'finishSetupAttachments', 'runStartOfRoundDcEffects', 'runStartOfRoundContinuation', 'sendRoundActivationPhaseMessage',
    'sendPhaseGateMessages', 'runStatusPhaseAfterEndOfRound',
    'updateHandChannelMessages',
    // Gate 1 (deploy_done) deps:
    'isDcAttachment', 'resolveDcName', 'dcMessageMeta', 'dcHealthState',
    'getInitiativePlayerZoneLabel', 'clearPreGameSetup', 'runPostDeployPhase',
    'getCcShuffleDrawButton', 'updateAttachmentMessageForDc',
    // _runStatusPhaseLogic deps:
    'replyIfGameEnded', 'getPlayerZoneLabel',
    'dcExhaustedState', 'isDepletedRemovedFromGame',
    'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'getDcStats',
    'countTerminalsControlledByPlayer', 'isFigureInDeploymentZone', 'checkWinConditions',
    'getMapTokensData', 'getSpaceController', 'getMissionRules',
    'runEndOfRoundRules', 'runStartOfRoundRules',
    'getFiguresOnOrAdjacentToSpace',
    'runNpcThugActivation', 'runNpcKryknaActivation', 'applyNpcDamageToFigure',
    'getMapData', 'getMapRegistry', 'filterMapSpacesByBounds',
    'updateHandVisualMessage', 'buildHandDisplayPayload',
    'buildBoardMapPayload',
    'postDevaronDoorButtons', 'postDevaronCratePushPrompts', 'postKryknaPushButtons',
  ],

  favorites: [
    'getGame', 'pendingSquadConfirm', 'PENDING_ILLEGAL_TTL_MS',
    'validateDeckLegal', 'sendSquadConfirmation', 'saveGames', 'client',
  ],

  favList: [
    'validateDeckLegal', 'buildSquadConfirmText',
  ],

  spacePicker: [
    'getGame',
  ],

  combatSpecialEffects: [
    'getGame', 'saveGames', 'client', 'canActAsPlayer',
    'dcMessageMeta', 'dcHealthState', 'dcExhaustedState',
    'findDcMessageIdForFigure', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcUpgradeAttachments', 'getDcStats', 'logGameAction', 'calculateKillVp',
    'decrementActivationIfGroupDefeated', 'checkWinConditions',
    'finishCombatResolution', 'ensureMovementBankMessage',
    'rollSingleAttackDie', 'getDcEffects', 'getMapData', 'getFigureLabel',
    'filterCondition', 'isConditionImmune', 'applyCondition', 'HARMFUL_CONDITIONS',
    'updateDcActionsMessage', 'updateHandVisualMessage', 'updateDiscardPileMessage',
    'processFigureDefeat',
    // applyStrain (Bleed / special-effect strain) consults findFigureheadFigure
    // to fire the Figurehead STRAIN reaction (alexanbv 2026-06-20).
    'findFigureheadFigure',
  ],
};

/**
 * Build a context object for a handler group from the shared dependencies bag.
 * @param {string} group - Context group name
 * @param {object} allDeps - All available dependencies
 * @returns {object} Context object with only the deps needed by the group
 */
export function buildContext(group, allDeps) {
  const keys = CONTEXT_GROUPS[group];
  if (!keys) throw new Error(`Unknown context group: ${group}`);
  const ctx = {};
  for (const k of keys) {
    ctx[k] = allDeps[k];
  }
  return ctx;
}

export function getValidGroupNames() {
  return Object.keys(CONTEXT_GROUPS);
}

export function getAllRequiredDepKeys() {
  const keys = new Set();
  for (const deps of Object.values(CONTEXT_GROUPS)) {
    for (const k of deps) keys.add(k);
  }
  return keys;
}

export { CONTEXT_GROUPS };
