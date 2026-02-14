/**
 * Game logic (validation, movement, combat). No Discord.
 * Re-export from submodules for use by handlers.
 */
export {
  validateDeckLegal,
  resolveDcName,
  DC_POINTS_LEGAL,
  CC_CARDS_LEGAL,
  CC_COST_LEGAL,
} from './validation.js';
