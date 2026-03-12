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
 * Set the top-level phase. Clears roundPhase unless entering round_active.
 * @param {object} game
 * @param {string} phase - One of PHASES values
 * @param {string|null} [roundPhase] - One of ROUND_PHASES values (only for round_active)
 */
export function setPhase(game, phase, roundPhase = null) {
  game.phase = phase;
  game.roundPhase = phase === 'round_active' ? (roundPhase || game.roundPhase) : null;
}

/**
 * Set the round sub-phase (within round_active).
 * @param {object} game
 * @param {string} roundPhase - One of ROUND_PHASES values
 */
export function setRoundPhase(game, roundPhase) {
  game.roundPhase = roundPhase;
}
