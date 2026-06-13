/**
 * Shared bin-ordering for Start-of-Round and End-of-Round trigger
 * resolution. Per alexanbv 2026-06-13: SoR and EoR use ONE orchestrator
 * type with different ability descriptors plugged in. Triggers resolve in
 * strictly-enforced bins:
 *
 *   1. Mission rules
 *   2. Player WITH initiative
 *   3. Player WITHOUT initiative
 *
 * Within each bin the owning player chooses which abilities to activate and
 * in what order (the chooser lifecycle mirrors the SoA/EoA orchestrators —
 * consumeDescriptor / skipCurrentBucket walk a bin until it is drained,
 * then advance to the next bin).
 *
 * A descriptor is the unit of a single pending trigger:
 *   { id, ownerPlayerNum, label, ...payload }
 * Mission-rule descriptors use ownerPlayerNum = null (engine-driven, no
 * player choice — they fire in listed order).
 */
import { opponentPlayerNum } from './player-helpers.js';

export const ROUND_BIN_MISSION = 'mission';
export const ROUND_BIN_INIT = 'init';
export const ROUND_BIN_NON_INIT = 'nonInit';

/**
 * Build the ordered bins for a round trigger (SoR or EoR).
 *
 * @param {object} args
 * @param {Array}  args.missionDescriptors - engine-driven mission-rule triggers (resolve first, in order)
 * @param {Array}  args.descriptors        - ability triggers, each carrying ownerPlayerNum
 * @param {number} args.initPlayerNum       - the player WITH initiative
 * @returns {Array<{bin:string, ownerPlayerNum:(number|null), descriptors:Array}>}
 *          always length 3, in strict order: mission, init, non-init.
 */
export function bucketizeRoundTriggers({ missionDescriptors = [], descriptors = [], initPlayerNum }) {
  const nonInitPlayerNum = opponentPlayerNum(initPlayerNum);
  return [
    { bin: ROUND_BIN_MISSION, ownerPlayerNum: null, descriptors: [...missionDescriptors] },
    { bin: ROUND_BIN_INIT, ownerPlayerNum: initPlayerNum, descriptors: descriptors.filter((d) => d.ownerPlayerNum === initPlayerNum) },
    { bin: ROUND_BIN_NON_INIT, ownerPlayerNum: nonInitPlayerNum, descriptors: descriptors.filter((d) => d.ownerPlayerNum === nonInitPlayerNum) },
  ];
}

/**
 * Index of the first bin that still has descriptors, scanning in strict
 * mission→init→non-init order. Returns -1 when every bin is drained.
 */
export function firstNonEmptyBinIdx(buckets) {
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].descriptors.length > 0) return i;
  }
  return -1;
}

/**
 * Advance from the current bin to the next non-empty one (strict order).
 * Returns the new index, or -1 when none remain.
 */
export function nextNonEmptyBinIdx(buckets, currentIdx) {
  for (let i = currentIdx + 1; i < buckets.length; i++) {
    if (buckets[i].descriptors.length > 0) return i;
  }
  return -1;
}
