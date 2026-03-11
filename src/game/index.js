/**
 * Game logic (validation, movement, combat, coords). No Discord.
 * Re-export from submodules for use by handlers and index.
 */
export {
  validateDeckLegal,
  normalizeSquadInput,
  validateArmyAffiliation,
  validateUpgradeWarnings,
  resolveDcName,
  DC_POINTS_LEGAL,
  CC_CARDS_LEGAL,
  CC_COST_LEGAL,
} from './validation.js';

export {
  parseCoord,
  normalizeCoord,
  colRowToCoord,
  edgeKey,
  toLowerSet,
  parseSizeString,
  sizeToString,
  rotateSizeString,
  shiftCoord,
  getFootprintCells,
} from './coords.js';

export {
  isWithinGridBounds,
  filterMapSpacesByBounds,
  getBoundedMapSpaces,
  getOccupiedSpacesForMovement,
  getHostileOccupiedSpacesForMovement,
  getMovementKeywords,
  getBoardStateForMovement,
  getMovementProfile,
  buildTempBoardState,
  movementStateKey,
  getNormalizedFootprint,
  computeMovementCache,
  getSpacesAtCost,
  getMovementTarget,
  getMovementPath,
  ensureMovementCache,
  getReachableSpaces,
  getPathCost,
  getFiguresAdjacentToTarget,
  collectOverlappingFigures,
  pushFigureToNearestValid,
  resolveMassivePush,
} from './movement.js';

export {
  rollAttackDice,
  rollDefenseDice,
  rollSingleAttackDie,
  rollSingleDefenseDie,
  recalcAttackTotals,
  recalcDefenseTotals,
  getInnateRerolls,
  SURGE_LABELS,
  getAttackerSurgeAbilities,
  parseSurgeEffect,
  computeCombatResult,
} from './combat.js';

export { getAbility, resolveSurgeAbility, getSurgeAbilityLabel, resolveAbility } from './abilities.js';

export { getCcPlayContext, isCcPlayableNow, getPlayableCcFromHand, isCcPlayLegalByRestriction } from './cc-timing.js';

export { getGameLock, cleanupGameLock, withGameLock } from './action-queue.js';

export { getConfig, setConfig, clearConfig, getAttachments, hasAttachment } from './figure-config.js';

export {
  getRange,
  isAdjacentCoords,
  isWithinRange,
  hasLineOfSight,
  isWithinSpaces,
  getFiguresWithinRange,
  getFiguresAdjacentTo,
} from './spatial.js';

export { cleanupActivation, cleanupRoundStart } from './activation-state.js';

export { reduceHp, healHp, healHpDistributed } from './damage-helpers.js';

export { awardKillVp, awardObjectiveVp, deductVp, checkNefariousGains } from './vp-helpers.js';

export { filterCondition, isConditionImmune, HARMFUL_CONDITIONS, applyCondition, resetCondition } from './conditions.js';

export { dcNameFromFigureKey, parseFigureKey, getDcEffect, isFigurelessDc, hasDepleteEffect, hasExhaustEffect, getCompanionDescriptionForDc, getMaxPowerTokens } from './dc-helpers.js';

export { opponentPlayerNum, getInitiativePlayerNum } from './player-helpers.js';

export { grantMovementBank, grantPowerTokens, getPlayerDeploymentZones } from './game-helpers.js';

export {
  getEffectiveFigureSize,
  getPlayerOccupiedCells,
  getPlayerOccupiedCellsForControl,
  getMissionTokenCoords,
  isFigureAdjacentOrOnMissionToken,
  getEffectiveSpeed,
  isFigureInDeploymentZone,
  isFigureAdjacentOrOnAny,
  getFigureAdjacentCoordsFromSet,
  getLegalInteractOptions,
  getSpaceController,
  getFiguresOnOrAdjacentToSpace,
  countTerminalsControlledByPlayer,
} from './board-helpers.js';
