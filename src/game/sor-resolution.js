/**
 * Start-of-Round resolution driver. Ties the SoR ability enumerator to the
 * unified round-trigger orchestrator so SoR triggers resolve in strict bins
 * (mission rules → init player → non-init player) with the owning player
 * choosing order within their bin. Per alexanbv 2026-06-13.
 *
 * This is the engine-side entry; the Discord layer renders the chooser from
 * the orchestrator state and fires each ability's effect when a descriptor
 * is consumed (the live round handler swaps its auto-fire loop for this).
 */
import { enumerateSorDescriptors } from './sor-enumerator.js';
import { startRoundTriggerResolution } from './round-trigger-orchestrator.js';
import { getInitiativePlayerNum } from './player-helpers.js';

/**
 * Begin a Start-of-Round chooser resolution.
 * @param {object} game
 * @param {object} [opts]
 * @param {Array}  [opts.missionDescriptors] - mission-rule SoR triggers (mission bin, resolve first)
 * @param {object} [opts.deps] - { getDcEffects } passthrough for the enumerator (testing)
 * @returns {boolean} true iff at least one SoR trigger is pending (chooser needed)
 */
export function startSorResolution(game, { missionDescriptors = [], deps } = {}) {
  const descriptors = enumerateSorDescriptors(game, deps);
  const initPlayerNum = getInitiativePlayerNum(game);
  return startRoundTriggerResolution(game, {
    phase: 'SoR',
    missionDescriptors,
    descriptors,
    initPlayerNum,
  });
}
