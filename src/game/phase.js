/**
 * Phase enums and setters for the hierarchical state machine.
 * game.phase is the single source of truth for top-level game phase.
 * game.roundPhase tracks sub-phase within round_active.
 */

export const PHASES = {
  LOBBY: 'lobby',
  MAP_SELECTION: 'map_selection',
  INITIATIVE: 'initiative',
  ZONE_SELECTION: 'zone_selection',
  DEPLOYMENT: 'deployment',
  ATTACHMENT: 'attachment',
  CC_DRAW: 'cc_draw',
  ROUND_ACTIVE: 'round_active',
  ENDED: 'ended',
};

export const ROUND_PHASES = {
  START_OF_ROUND: 'start_of_round',
  ACTIVATION: 'activation',
  END_OF_ROUND: 'end_of_round',
};

/**
 * Valid top-level phase transitions.
 * Key = current phase, Value = array of allowed next phases.
 * null/undefined = legacy game, any transition allowed.
 * Any phase → 'ended' is always allowed (game can end at any time).
 */
export const VALID_PHASE_TRANSITIONS = {
  [PHASES.LOBBY]:          [PHASES.MAP_SELECTION],
  [PHASES.MAP_SELECTION]:  [PHASES.INITIATIVE],
  [PHASES.INITIATIVE]:     [PHASES.ZONE_SELECTION],
  [PHASES.ZONE_SELECTION]: [PHASES.DEPLOYMENT],
  [PHASES.DEPLOYMENT]:     [PHASES.ATTACHMENT, PHASES.CC_DRAW],
  [PHASES.ATTACHMENT]:     [PHASES.CC_DRAW],
  [PHASES.CC_DRAW]:        [PHASES.ROUND_ACTIVE],
  [PHASES.ROUND_ACTIVE]:   [PHASES.ENDED],
  [PHASES.ENDED]:          [], // terminal
};

/**
 * Valid round sub-phase transitions.
 * null/undefined = first entry, any allowed.
 */
export const VALID_ROUND_PHASE_TRANSITIONS = {
  [ROUND_PHASES.START_OF_ROUND]: [ROUND_PHASES.ACTIVATION],
  [ROUND_PHASES.ACTIVATION]:     [ROUND_PHASES.END_OF_ROUND],
  [ROUND_PHASES.END_OF_ROUND]:   [ROUND_PHASES.START_OF_ROUND],
};

/**
 * Validate a phase transition. Returns true if valid.
 * @param {string|null|undefined} from - Current phase
 * @param {string} to - Target phase
 * @param {object} transitionMap - VALID_PHASE_TRANSITIONS or VALID_ROUND_PHASE_TRANSITIONS
 * @returns {boolean}
 */
function isValidTransition(from, to, transitionMap) {
  // Legacy games (null/undefined phase) — allow any transition
  if (from == null) return true;
  // Any → ended always allowed (top-level only)
  if (to === PHASES.ENDED && transitionMap === VALID_PHASE_TRANSITIONS) return true;
  const allowed = transitionMap[from];
  if (!allowed) return true; // unknown source phase — allow (defensive)
  return allowed.includes(to);
}

/**
 * Set the top-level phase. Validates transition before assignment.
 * @param {object} game
 * @param {string} phase - One of PHASES values
 * @param {string|null} [roundPhase] - One of ROUND_PHASES values (only for round_active)
 * @param {object} [opts]
 * @param {boolean} [opts.strict] - If true, throw on invalid transition (for headless/tests)
 */
export function setPhase(game, phase, roundPhase = null, opts = {}) {
  const from = game.phase;
  if (!isValidTransition(from, phase, VALID_PHASE_TRANSITIONS)) {
    const msg = `Invalid phase transition: ${from} → ${phase}`;
    if (opts.strict) throw new Error(msg);
    console.warn(`[Phase] ${msg}`);
  }
  game.phase = phase;
  game.roundPhase = phase === 'round_active' ? (roundPhase || game.roundPhase) : null;
}

/**
 * Set the round sub-phase (within round_active). Validates transition.
 * @param {object} game
 * @param {string} roundPhase - One of ROUND_PHASES values
 * @param {object} [opts]
 * @param {boolean} [opts.strict] - If true, throw on invalid transition
 */
export function setRoundPhase(game, roundPhase, opts = {}) {
  const from = game.roundPhase;
  if (!isValidTransition(from, roundPhase, VALID_ROUND_PHASE_TRANSITIONS)) {
    const msg = `Invalid round phase transition: ${from} → ${roundPhase}`;
    if (opts.strict) throw new Error(msg);
    console.warn(`[Phase] ${msg}`);
  }
  game.roundPhase = roundPhase;
}
