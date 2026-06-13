/**
 * Unified Start-of-Round / End-of-Round trigger orchestrator.
 *
 * Per alexanbv 2026-06-13: SoR and EoR share ONE orchestrator type, with
 * different ability descriptors plugged in. Triggers resolve in strict bins
 * (mission rules → init player → non-init player; see round-trigger-bins.js),
 * and within each bin the owning player chooses which ability to activate
 * next. This module owns the lifecycle (start / consume / skip / advance);
 * the caller supplies the descriptors and renders the per-bin chooser, then
 * fires each descriptor's effect when consumeDescriptor returns it.
 *
 * State shape (game.pendingRoundTrigger):
 *   { phase: 'SoR'|'EoR', buckets, currentBinIdx, context }
 * Mirrors the SoA/EoA orchestrators so the handler patterns are reusable.
 */
import {
  bucketizeRoundTriggers,
  firstNonEmptyBinIdx,
  nextNonEmptyBinIdx,
} from './round-trigger-bins.js';

/**
 * Begin a round-trigger resolution. Returns true iff at least one trigger
 * is pending (caller should drive the chooser); false means nothing to do.
 *
 * @param {object} game
 * @param {object} args
 * @param {'SoR'|'EoR'} args.phase
 * @param {Array}  args.missionDescriptors
 * @param {Array}  args.descriptors        - ability triggers with ownerPlayerNum
 * @param {number} args.initPlayerNum
 * @param {object} [args.context]
 */
export function startRoundTriggerResolution(game, { phase, missionDescriptors = [], descriptors = [], initPlayerNum, context = {} }) {
  const buckets = bucketizeRoundTriggers({ missionDescriptors, descriptors, initPlayerNum });
  const firstIdx = firstNonEmptyBinIdx(buckets);
  if (firstIdx === -1) return false;
  game.pendingRoundTrigger = { phase, buckets, currentBinIdx: firstIdx, context: { ...context } };
  return true;
}

/** The bin currently being resolved, or null. */
export function currentBin(game) {
  const r = game.pendingRoundTrigger;
  if (!r) return null;
  return r.buckets[r.currentBinIdx] || null;
}

/** Find a still-pending descriptor by id within the CURRENT bin (enforces bin order). */
export function findDescriptorInCurrentBin(game, descId) {
  const bin = currentBin(game);
  if (!bin) return null;
  return bin.descriptors.find((d) => d.id === descId) || null;
}

/**
 * Remove a descriptor from the current bin (it has been resolved). If that
 * empties the bin, auto-advance to the next non-empty bin. Returns the
 * resolved descriptor, or null if not found in the current bin.
 */
export function consumeDescriptor(game, descId) {
  const r = game.pendingRoundTrigger;
  if (!r) return null;
  const bin = r.buckets[r.currentBinIdx];
  if (!bin) return null;
  const idx = bin.descriptors.findIndex((d) => d.id === descId);
  if (idx === -1) return null;
  const [desc] = bin.descriptors.splice(idx, 1);
  if (bin.descriptors.length === 0) _advanceBin(game);
  return desc;
}

/** Skip (forgo) the rest of the current bin and advance to the next. */
export function skipCurrentBin(game) {
  const r = game.pendingRoundTrigger;
  if (!r) return false;
  const bin = r.buckets[r.currentBinIdx];
  if (bin) bin.descriptors = [];
  return _advanceBin(game);
}

/** True once every bin is drained (resolution complete). */
export function isResolutionComplete(game) {
  return !game.pendingRoundTrigger;
}

function _advanceBin(game) {
  const r = game.pendingRoundTrigger;
  if (!r) return false;
  const next = nextNonEmptyBinIdx(r.buckets, r.currentBinIdx);
  if (next === -1) {
    delete game.pendingRoundTrigger;
    return false;
  }
  r.currentBinIdx = next;
  return true;
}
