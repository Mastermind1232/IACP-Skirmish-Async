/**
 * Start-of-Activation (SoA) orchestrator.
 *
 * Per destruct 2026-05-07: every SoA effect is a player-driven trigger.
 * No effect fires automatically — players pick which trigger to resolve next
 * within their bucket because the timing relative to other SoA effects can
 * matter. Bucket order is **init-player first, non-init second** (NOT
 * activator-based — if init-player is the opponent, opponent's bucket fires
 * before the activator's).
 *
 * Lifecycle:
 *   1. enumerateSoaDescriptors(game, ctx) — walk activator's DCs/CCs +
 *      opponent's opponent-triggers, return descriptor[] for each pending
 *      SoA decision. Preconditions are evaluated here; effects whose
 *      precondition is false (e.g. Jyn LOS-blocked-by-terrain) are not
 *      enumerated. Effects gated by hidden info (Jyn LOS-blocked-by-figures
 *      where Marksman could unblock) ARE enumerated to avoid info-leaks.
 *   2. bucketize(descriptors, initPlayerNum) — sort by ownerPlayerNum:
 *      bucket[0] = init-player, bucket[1] = non-init.
 *   3. walkBuckets — opens the current bucket; if it has triggers, post the
 *      chooser prompt to bucket-owner. Player picks → resolveTrigger →
 *      re-prompt with remaining → eventually skip/exhaust → advance to
 *      next bucket → continue activation.
 *
 * State persists on game.pendingSoaResolution across Discord round-trips.
 */

import { opponentPlayerNum } from './player-helpers.js';
import { getDcEffects } from '../data-loader.js';
import { countGameSpaces } from './board-helpers.js';

/**
 * Enumerate Start-of-Activation descriptors for an activating DC. Returns
 * a (possibly empty) array of descriptor objects, each shaped:
 *   {
 *     id: string,             // unique within the bucket walk
 *     ownerPlayerNum: 1|2,    // who decides whether to fire it
 *     sourceMsgId: string,    // the DC msgId that hosts the effect
 *     sourceLabel: string,    // human-readable, used as the chooser button
 *     subPromptKey: string,   // identifies the sub-prompt path on click
 *     extras: object,         // descriptor-specific data needed at fire time
 *   }
 *
 * Slice 1 (this commit): Vigor only. Subsequent slices migrate the rest.
 */
export function enumerateActivatorSoaDescriptors(game, opts) {
  const { dcName, playerNum, msgId } = opts || {};
  if (!dcName || !playerNum || !msgId) return [];
  const eff = getDcEffects()?.[dcName];
  const descriptors = [];

  // Vigor (Ahsoka Tano, Fifth Brother): SoA choice — gain 2 MP or 1 Block Token.
  // Detected by name match (Vigor isn't in specialAbilityIds today; activation-
  // setup.js used the same name predicate). The descriptor's owner is the
  // ACTIVATING player.
  if (dcName === 'Ahsoka Tano' || dcName === 'Fifth Brother') {
    descriptors.push({
      id: `vigor:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Vigor',
      subPromptKey: 'vigor',
      extras: { dcName },
    });
  }

  // Responsive (Shyla Varad): SoA choice — gain 1 MP or recover 1 Damage.
  if (dcName === 'Shyla Varad') {
    descriptors.push({
      id: `responsive:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Responsive',
      subPromptKey: 'responsive',
      extras: { dcName },
    });
  }

  // Fulcrum (Agent Kallus): SoA y/n — both players draw 1 CC if used.
  if (dcName === 'Agent Kallus') {
    descriptors.push({
      id: `fulcrum:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Fulcrum',
      subPromptKey: 'fulcrum',
      extras: { dcName },
    });
  }

  // Hunger (Wampa Elite): SoA choice — gain 3 MP + Block Token OR 3 MP +
  // Evade Token, but only if no hostile within 2 spaces. When a hostile IS
  // within 2 the trigger doesn't enter the bucket at all.
  if (dcName === 'Wampa (Elite)' && game) {
    const _heDgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _heFk = `Wampa (Elite)-${_heDgIdx}-0`;
    const _hePos = game.figurePositions?.[playerNum]?.[_heFk];
    if (_hePos) {
      const _heEnemyNum = opponentPlayerNum(playerNum);
      const _heHostiles = Object.values(game.figurePositions?.[_heEnemyNum] || {});
      const _heAnyClose = _heHostiles.some((hp) => hp && countGameSpaces(game, _hePos, hp) <= 2);
      if (!_heAnyClose) {
        descriptors.push({
          id: `hunger_elite:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Hunger',
          subPromptKey: 'hunger_elite',
          extras: { dcName, figureKey: _heFk },
        });
      }
    }
  }

  // Tactical Movement (Fenn Signis): pick a friendly figure within 3 → that
  // figure gains 2 MP. Trigger only enters the bucket when at least one
  // eligible friendly exists.
  if (dcName === 'Fenn Signis' && game) {
    const _tmDgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _tmSelfFk = `${dcName}-${_tmDgIdx}-0`;
    const _tmSelfPos = game.figurePositions?.[playerNum]?.[_tmSelfFk];
    if (_tmSelfPos) {
      const _tmCandidates = Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => fp && countGameSpaces(game, _tmSelfPos, fp) <= 3)
        .map(([fk]) => fk);
      if (_tmCandidates.length > 0) {
        descriptors.push({
          id: `tac_move:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Tactical Movement',
          subPromptKey: 'tac_move',
          extras: { dcName, candidates: _tmCandidates.slice(0, 4) },
        });
      }
    }
  }

  return descriptors;
}

/**
 * Build the SoA chooser button row for a bucket.
 * One button per descriptor + a "Skip all remaining" button.
 *
 * The orchestrator does not import discord.js directly; the caller (engine
 * or handler) builds the actual Discord components. This helper just
 * returns the (id, label) pairs the caller can map onto buttons.
 *
 * @param {object} resolution - game.pendingSoaResolution
 * @returns {{ ownerPlayerNum: number, choices: Array<{customId: string, label: string, descId: string}>, gameId: string } | null}
 *   null if no bucket pending
 */
export function describeChooserPrompt(resolution, gameId) {
  if (!resolution || !Array.isArray(resolution.buckets)) return null;
  const bucket = resolution.buckets[resolution.currentBucketIdx];
  if (!bucket || !bucket.descriptors?.length) return null;
  const choices = bucket.descriptors.map((d) => ({
    customId: `soa_pick_${gameId}_${d.id}`,
    label: d.sourceLabel,
    descId: d.id,
  }));
  choices.push({ customId: `soa_skip_all_${gameId}`, label: 'Skip all remaining', descId: '__skip_all__' });
  return { ownerPlayerNum: bucket.ownerPlayerNum, choices, gameId };
}

/**
 * Bucketize descriptors by ownerPlayerNum, ordered init-first.
 * @param {Array} descriptors
 * @param {number} initPlayerNum - the player WITH initiative
 * @returns {Array<{ ownerPlayerNum: number, descriptors: Array }>}
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
 * Initialize pendingSoaResolution on game from descriptors + activation context.
 * No-op (returns false) if descriptors is empty — caller continues activation
 * inline.
 *
 * @param {object} game
 * @param {Array} descriptors
 * @param {number} initPlayerNum
 * @param {object} activationContext - { activatorPlayerNum, activatorMsgId }
 * @returns {boolean} true if a resolution was started (caller must wait)
 */
export function startSoaResolution(game, descriptors, initPlayerNum, activationContext) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return false;
  const buckets = bucketize(descriptors, initPlayerNum);
  // Skip empty leading buckets so currentBucketIdx points at the first
  // non-empty one; if both are empty we already returned false above.
  let firstIdx = 0;
  while (firstIdx < buckets.length && buckets[firstIdx].descriptors.length === 0) firstIdx++;
  if (firstIdx >= buckets.length) return false;
  game.pendingSoaResolution = {
    buckets,
    currentBucketIdx: firstIdx,
    activationContext: { ...(activationContext || {}) },
  };
  return true;
}

/**
 * Remove a descriptor by id from the current bucket. Advance to the next
 * non-empty bucket if the current one is exhausted. Clear pendingSoaResolution
 * entirely when no buckets remain.
 *
 * @param {object} game
 * @param {string} descId - descriptor id to remove (e.g. 'vigor:msg_palp')
 * @returns {{ exhausted: boolean }} exhausted=true when activation should resume
 */
export function consumeDescriptor(game, descId) {
  const r = game.pendingSoaResolution;
  if (!r) return { exhausted: true };
  const bucket = r.buckets[r.currentBucketIdx];
  if (!bucket) return { exhausted: true };
  bucket.descriptors = bucket.descriptors.filter((d) => d.id !== descId);
  while (r.currentBucketIdx < r.buckets.length && r.buckets[r.currentBucketIdx].descriptors.length === 0) {
    r.currentBucketIdx++;
  }
  if (r.currentBucketIdx >= r.buckets.length) {
    delete game.pendingSoaResolution;
    return { exhausted: true };
  }
  return { exhausted: false };
}

/**
 * Skip all remaining triggers in the current bucket and advance to the next.
 * Returns true when the resolution is fully exhausted (activation continues).
 */
export function skipCurrentBucket(game) {
  const r = game.pendingSoaResolution;
  if (!r) return true;
  r.currentBucketIdx++;
  while (r.currentBucketIdx < r.buckets.length && r.buckets[r.currentBucketIdx].descriptors.length === 0) {
    r.currentBucketIdx++;
  }
  if (r.currentBucketIdx >= r.buckets.length) {
    delete game.pendingSoaResolution;
    return true;
  }
  return false;
}

/**
 * Look up a descriptor by id in the current bucket.
 */
export function findDescriptorInCurrentBucket(game, descId) {
  const r = game.pendingSoaResolution;
  if (!r) return null;
  const bucket = r.buckets[r.currentBucketIdx];
  if (!bucket) return null;
  return bucket.descriptors.find((d) => d.id === descId) || null;
}
