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
  'ACTION_ICONS', 'ThreadAutoArchiveDuration', 'resolveCombatAfterRolls',
  'saveGames', 'client', 'rollAttackDice', 'rollDefenseDice',
  'rollSingleAttackDie', 'rollSingleDefenseDie', 'recalcAttackTotals',
  'recalcDefenseTotals', 'getInnateRerolls', 'getAttackerSurgeAbilities',
  'SURGE_LABELS', 'parseSurgeEffect', 'getAbility', 'resolveSurgeAbility',
  'getSurgeAbilityLabel', 'getRange', 'hasLineOfSight', 'getDiceData',
  'applyDamageAndFinishCombat', 'isDcUnique', 'getCelebrationButtons',
  'calculateKillVp', 'checkHuntDissent', 'decrementActivationIfGroupDefeated',
  'checkFriendlyDefeatedPassiveRedraws', 'ccAttachmentsKey',
  'checkNefariousGains', 'updateHandVisualMessage', 'updateDiscardPileMessage',
  'sendBleedingPrompt',
];

const CONTEXT_GROUPS = {
  ccHand: [
    'getGame', 'dcMessageMeta', 'dcHealthState', 'dcExhaustedState', 'saveGames',
    'pushUndo', 'client', 'pendingIllegalSquad', 'pendingSquadConfirm', 'PENDING_ILLEGAL_TTL_MS',
    'validateDeckLegal', 'sendDeckIllegalAlert', 'sendSquadConfirmation', 'applySquadSubmission',
    'getHandTooltipEmbed', 'getHandSquadButtons', 'shuffleArray',
    'buildHandDisplayPayload', 'updateHandVisualMessage', 'updatePlayAreaDcButtons',
    'sendRoundActivationPhaseMessage', 'runStartOfRoundDcEffects', 'logGameAction', 'sendPhaseGateMessages',
    'buildDiscardPileDisplayPayload', 'updateDiscardPileMessage', 'getCcEffect',
    'isCcAttachment', 'isCcPlayableNow', 'isCcPlayLegalByRestriction',
    'getIllegalCcPlayButtons', 'getNegationResponseButtons',
    'updateAttachmentMessageForDc', 'getPlayableCcFromHand', 'resolveAbility',
    'updateDcActionsMessage', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcStats', 'getDcPlayAreaComponents', 'buildBoardMapPayload', 'getBoardStateForMovement',
    'getMapAttachmentForSpaces',
    'ensureMovementBankMessage', 'updateMovementBankMessage', 'getConditionCardPath',
    'getCommandCardImagePath', 'getDeploymentZones', 'updateDeployPromptMessages',
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
    'getRange', 'hasLineOfSight', 'isDcUnique', 'getCelebrationButtons',
    'applyDamageAndFinishCombat', 'getEffectiveSpeed', 'ensureMovementBankMessage',
    'getBoardStateForMovement', 'getMovementProfile', 'computeMovementCache',
    'getMovementMinimapAttachment', 'clearMoveGridMessages',
    'getLegalInteractOptions', 'FIGURE_LETTERS', 'resolveAbility',
    'getNegationResponseButtons', 'sendBleedingPrompt', 'updateMovementBankMessage',
    'getCommandCardImagePath', 'getConditionCardPath', 'buildBoardMapPayload',
    'findDcMessageIdForFigure', 'isGroupDefeated', 'checkWinConditions',
    'getMapAttachmentForSpaces',
    'getMapTokensData', 'getDeploymentZones',
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
    'resolveMassivePush', 'updateMovementBankMessage', 'getMovementPath',
    'pushUndo', 'logGameAction', 'countTerminalsControlledByPlayer',
    'getMovementMinimapAttachment', 'buildBoardMapPayload',
    'updateDcActionsMessage', 'sendBleedingPrompt', 'getDcStats', 'dcHealthState',
    'saveGames', 'client',
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
  ],

  activation: [
    'getGame', 'replyIfGameEnded', 'hasActionsRemainingInGame',
    'GAME_PHASES', 'PHASE_COLOR', 'getInitiativePlayerZoneLabel',
    'getPlayerZoneLabel', 'logGameAction', 'pushUndo',
    'updateHandChannelMessages', 'saveGames', 'client', 'dcMessageMeta', 'sendPhaseGateMessages',
    'dcHealthState', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'maybeShowEndActivationPhaseButton',
    'dcExhaustedState', 'updateActivationsMessage', 'getActionsCounterContent',
    'getDcActionButtons', 'getActivationMinimapAttachment', 'getActivateDcButtons',
    'DC_ACTIONS_PER_ACTIVATION', 'ThreadAutoArchiveDuration', 'ACTION_ICONS',
    'updateDcActionsMessage', 'getDcStats', 'getRange', 'hasLineOfSight', 'getMapData',
    'findDcMessageIdForFigure', 'updateHandVisualMessage',
    'ButtonBuilder', 'ActionRowBuilder', 'ButtonStyle',
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
    'client', 'sendPhaseGateMessages',
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

  undo: [
    'getGame', 'saveGames', 'updateMovementBankMessage', 'buildBoardMapPayload',
    'logGameAction', 'updateDeployPromptMessages', 'updateDcActionsMessage',
    'updateHandVisualMessage', 'updateDiscardPileMessage',
    'updateAttachmentMessageForDc', 'getDeploymentZoneButtons', 'client',
    'sendPhaseGateMessages',
    'dcExhaustedState', 'dcMessageMeta', 'dcHealthState',
    'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'getDcStats', 'updateActivationsMessage',
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
    'applyDamageAndFinishCombat', 'checkWinConditions', 'awardObjectiveVp',
    'updateDcActionsMessage', 'buildDcEmbedAndFiles', 'renderDcEmbed', 'getConditionsForDcMessage', 'getNicknamesForDcMessage',
    'getDcPlayAreaComponents', 'getDcStats', 'DC_ACTIONS_PER_ACTIVATION',
    'ButtonBuilder', 'ActionRowBuilder', 'ButtonStyle',
    'updateHandChannelMessages',
  ],

  requests: [
    'logGameErrorToBotLogs',
  ],

  mapEvents: [
    'getGame', 'canActAsPlayer', 'saveGames', 'client', 'logGameAction',
    'getMapTokensData', 'postDevaronDoorButtons', 'postDevaronCratePushPrompts',
    'getSpaceController',
  ],

  postDeploy: [
    'getGame', 'saveGames', 'client', 'canActAsPlayer', 'logGameAction',
    'dcMessageMeta', 'getBoardStateForMovement', 'getMovementProfile',
    'computeMovementCache', 'getMovementMinimapAttachment',
    'buildBoardMapPayload',
  ],

  recover: [
    'getGame', 'saveGames', 'client', 'logGameAction',
    'getNegationResponseButtons', 'sendReadyToResolveRolls',
    'updateHandChannelMessages', 'getMoveMpButtonRows',
    'sendPhaseGateMessages',
    'getDetermineInitiativeButtons',
    'populatePlayAreas', 'createPlayAreaChannels', 'createBoardChannel',
    'buildBoardMapPayload',
    'dcMessageMeta', 'dcExhaustedState',
  ],

  phaseGate: [
    'getGame', 'saveGames', 'client', 'logGameAction',
    'finishSetupAttachments', 'runStartOfRoundDcEffects', 'sendRoundActivationPhaseMessage',
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
