/**
 * End-of-Activation (EoA) orchestrator.
 *
 * Per alexanbv 2026-05-11: player-triggered abilities that fire AFTER the
 * activator clicks "End Activation" but BEFORE the turn passes. Active
 * abilities (exhaustive list at creation):
 *   - Baze (Into the Fray, EoA half)
 *   - Verena Talos (EoA branch)
 *   - On a Diplomatic Mission
 *   - 0-0-0
 *   - Riot Trooper Regular
 *   - Riot Trooper Elite
 *   - ISB Infiltrator (both)
 *   - Blend In
 *   - Force Surge
 *   - Rebel Graffiti
 *   - Jyn Erso (Trust Goes Both Ways, EoA branch)
 *
 * Architecture mirrors src/game/soa-orchestrator.js — descriptor objects,
 * bucketize-by-owner, lifecycle (start / consume / skip). The handler
 * lives in src/handlers/eoa-handler.js.
 */

import { opponentPlayerNum } from './player-helpers.js';
import { countGameSpaces } from './board-helpers.js';

/**
 * Enumerate End-of-Activation descriptors for the activator. Returns
 * descriptor objects with the same shape as SoA descriptors. Triggers
 * whose preconditions fail (e.g. no eligible target) are not enumerated.
 *
 * Initial slice wires Jyn Erso's Trust Goes Both Ways at EoA (once-per-
 * round). Additional descriptors will be added per audit pass.
 */
export function enumerateActivatorEoaDescriptors(game, opts) {
  const { dcName, playerNum, msgId } = opts || {};
  if (!dcName || !playerNum || !msgId || !game) return [];
  const descriptors = [];

  // Trust Goes Both Ways (Jyn Erso): EoA branch. "At the start OR end
  // of your activation, choose an adjacent friendly figure. If you do,
  // you and that figure recover 1 Damage and gain 1 Surge Token. Limit
  // once per round." The SoA branch is already wired in
  // soa-orchestrator.js; this is the symmetric EoA path. Skip if
  // already used this round.
  const _tgbwUsed = game.roundFigureAbilityUsed?.[`trustBothWays_${msgId}`];
  if (!_tgbwUsed && dcName === 'Jyn Erso') {
    const _dgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _selfFk = `${dcName}-${_dgIdx}-0`;
    const _selfPos = game.figurePositions?.[playerNum]?.[_selfFk];
    if (_selfPos) {
      const _adj = Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => fk !== _selfFk && fp && countGameSpaces(game, _selfPos, fp) <= 1);
      if (_adj.length > 0) {
        descriptors.push({
          id: `trust_both_ways_eoa:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Trust Goes Both Ways (EoA)',
          subPromptKey: 'trust_both_ways_eoa',
          extras: { dcName, selfFigureKey: _selfFk },
        });
      }
    }
  }

  // TODO (alexanbv 2026-05-11 batch 3): wire the remaining EoA abilities:
  //   - Baze Malbus EoA half (passive trigger)
  //   - Verena Talos EoA branch (TBD per card text)
  //   - On a Diplomatic Mission
  //   - 0-0-0
  //   - Riot Trooper Regular + Elite
  //   - ISB Infiltrator Regular + Elite
  //   - Blend In
  //   - Force Surge
  //   - Rebel Graffiti
  // Each adds a descriptor here + a sub-prompt branch in eoa-handler.js.

  return descriptors;
}

/**
 * Bucketize descriptors by ownerPlayerNum, ordered init-first.
 * Per destruct 2026-05-07: init-player bucket walks first.
 */
export function bucketize(descriptors, initPlayerNum) {
  const nonInitPlayerNum = opponentPlayerNum(initPlayerNum);
  const initBucket = descriptors.filter((d) => d.ownerPlayerNum === initPlayerNum);
  const nonInitBucket = descriptors.filter((d) => d.ownerPlayerNum === nonInitPlayerNum);
  return [
    { ownerPlayerNum: initPlayerNum, descriptors: initBucket },
    { ownerPlayerNum: nonInitPlayerNum, descriptors: nonInitBucket },
  ];
}

/**
 * Initialize game.pendingEoaResolution. Returns true iff a resolution
 * was started (caller must wait for handler to finalize End Activation).
 */
export function startEoaResolution(game, descriptors, initPlayerNum, activationContext) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return false;
  const buckets = bucketize(descriptors, initPlayerNum);
  let firstIdx = 0;
  while (firstIdx < buckets.length && buckets[firstIdx].descriptors.length === 0) firstIdx++;
  if (firstIdx >= buckets.length) return false;
  game.pendingEoaResolution = {
    buckets,
    currentBucketIdx: firstIdx,
    activationContext: { ...(activationContext || {}) },
  };
  return true;
}

export function findDescriptorInCurrentBucket(game, descId) {
  const r = game.pendingEoaResolution;
  if (!r) return null;
  const bucket = r.buckets[r.currentBucketIdx];
  if (!bucket) return null;
  return bucket.descriptors.find((d) => d.id === descId) || null;
}

export function consumeDescriptor(game, descId) {
  const r = game.pendingEoaResolution;
  if (!r) return { exhausted: true };
  const bucket = r.buckets[r.currentBucketIdx];
  if (!bucket) return { exhausted: true };
  bucket.descriptors = bucket.descriptors.filter((d) => d.id !== descId);
  while (r.currentBucketIdx < r.buckets.length && r.buckets[r.currentBucketIdx].descriptors.length === 0) {
    r.currentBucketIdx++;
  }
  if (r.currentBucketIdx >= r.buckets.length) {
    delete game.pendingEoaResolution;
    return { exhausted: true };
  }
  return { exhausted: false };
}

export function skipCurrentBucket(game) {
  const r = game.pendingEoaResolution;
  if (!r) return true;
  r.currentBucketIdx++;
  while (r.currentBucketIdx < r.buckets.length && r.buckets[r.currentBucketIdx].descriptors.length === 0) {
    r.currentBucketIdx++;
  }
  if (r.currentBucketIdx >= r.buckets.length) {
    delete game.pendingEoaResolution;
    return true;
  }
  return false;
}

/**
 * Build the EoA chooser button row for the current bucket. Returns
 * {ownerPlayerNum, choices, gameId} or null if no bucket pending.
 */
export function describeChooserPrompt(resolution, gameId) {
  if (!resolution || !Array.isArray(resolution.buckets)) return null;
  const bucket = resolution.buckets[resolution.currentBucketIdx];
  if (!bucket || !bucket.descriptors?.length) return null;
  const choices = bucket.descriptors.map((d) => ({
    customId: `eoa_pick_${gameId}_${d.id}`,
    label: d.sourceLabel,
    descId: d.id,
  }));
  choices.push({ customId: `eoa_skip_all_${gameId}`, label: 'Skip all remaining', descId: '__skip_all__' });
  return { ownerPlayerNum: bucket.ownerPlayerNum, choices, gameId };
}
