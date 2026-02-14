/**
 * Game logic (validation, movement, combat, coords). No Discord.
 * Re-export from submodules for use by handlers and index.
 */
export {
  validateDeckLegal,
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
} from './movement.js';

export {
  rollAttackDice,
  rollDefenseDice,
  SURGE_LABELS,
  getAttackerSurgeAbilities,
  parseSurgeEffect,
  computeCombatResult,
} from './combat.js';

export { getAbility, resolveSurgeAbility, getSurgeAbilityLabel } from './abilities.js';

export { getCcPlayContext, isCcPlayableNow, getPlayableCcFromHand } from './cc-timing.js';
