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
 *   - Rebel Graffiti
 *   - Jyn Erso (Trust Goes Both Ways, EoA branch)
 *
 * Architecture mirrors src/game/soa-orchestrator.js — descriptor objects,
 * bucketize-by-owner, lifecycle (start / consume / skip). The handler
 * lives in src/handlers/eoa-handler.js.
 */

import { opponentPlayerNum } from './player-helpers.js';
import { countGameSpaces } from './board-helpers.js';
import { getDcEffects, dcAbilityFlags } from '../data-loader.js';

// End-of-activation DC passive abilities, detected via the activating DC's
// `passives` list in the card data. Per alexanbv 2026-06-13. 0-0-0's
// "Unnerving" is not tagged in passives, so it's special-cased by dcName.
const EOA_PASSIVE_ABILITIES = {
  'Hold the Line': { subPromptKey: 'hold_the_line', label: 'Hold the Line (gain Block per hostile with LOS)' },
  'Shield': { subPromptKey: 'shield', label: 'Shield (gain 1 Block if you have none)' },
  'In The Shadows': { subPromptKey: 'in_the_shadows', label: 'In The Shadows (become Hidden)' },
};

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

  // DC passive EoA abilities (alexanbv 2026-06-13): detect via the
  // activating DC's `passives` list. Each becomes a descriptor the owner
  // resolves through the EoA chooser; the effect fires in eoa-handler.js.
  const _dgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const _selFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
  const _selfFk = `${dcName}-${_dgIdx}-${_selFig}`;
  // Detect via dcAbilityFlags (passives ∪ abilities) — named EoA abilities
  // (Hold the Line, Shield, In The Shadows) live in the `abilities` field
  // per the 2026-06-15 data split, not `passives`.
  const _abilityFlags = dcAbilityFlags(getDcEffects()?.[dcName]);
  for (const [pname, info] of Object.entries(EOA_PASSIVE_ABILITIES)) {
    if (!_abilityFlags.includes(pname)) continue;
    descriptors.push({
      id: `${info.subPromptKey}:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: info.label,
      subPromptKey: info.subPromptKey,
      extras: { dcName, selfFigureKey: _selfFk },
    });
  }
  // 0-0-0 "Unnerving" — not tagged in passives; special-case by name.
  // EoA: each adjacent hostile figure becomes Weakened.
  if (dcName === '0-0-0') {
    descriptors.push({
      id: `unnerving:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Unnerving (adjacent hostiles become Weakened)',
      subPromptKey: 'unnerving',
      extras: { dcName, selfFigureKey: _selfFk },
    });
  }

  // COMPANION ACTIVATES NOW — general to ALL companions, not The Child.
  //
  // alexanbv 2026-08-12: "if they activate first, they resolve first. If the
  // activate after the main figure, their activation resolves INSIDE the
  // figure's EOA window", and "this applies to ALL companions".
  //
  // The blocker was the activation lock. game.activationLockKey enforces
  // complete-one-before-another across msgIds, the host holds it, and it is only
  // released by cleanupActivation — which since slice 1 runs AFTER this window
  // closes. So the companion could not act inside the window at all, making
  // "activate baze, activate child, teleport child" unreachable.
  //
  // This descriptor is the hand-off point: picking it passes the lock to the
  // companion (see eoa-handler). Ordering it against the host's other EoA
  // descriptors is what expresses the player's choice.
  if (game.companionActivatedBefore?.[msgId] === 'after') {
    const _cmpIds = game.p1DcMessageIds?.includes(msgId)
      ? game.p1DcCompanionMessageIds
      : game.p2DcCompanionMessageIds;
    const _hostIds = game.p1DcMessageIds?.includes(msgId) ? game.p1DcMessageIds : game.p2DcMessageIds;
    const _cmpIdx = _hostIds?.indexOf(msgId);
    const _cmpMsgId = _cmpIdx >= 0 ? (_cmpIds?.[_cmpIdx] || null) : null;
    // Only while the companion still has an activation to spend.
    if (_cmpMsgId && game.dcActionsData?.[_cmpMsgId]) {
      const _cmpName = game.dcMessageMeta?.get?.(_cmpMsgId)?.displayName
        || game.dcMessageMeta?.get?.(_cmpMsgId)?.dcName
        || 'companion';
      descriptors.push({
        id: `companion_activate:${msgId}`,
        ownerPlayerNum: playerNum,
        sourceMsgId: msgId,
        sourceLabel: `Activate ${_cmpName} now`,
        subPromptKey: 'companion_activate',
        extras: { dcName, companionMsgId: _cmpMsgId, companionName: _cmpName },
      });
    }
  }

  // Clan of Two: the companion's "place your figure" teleport belongs INSIDE
  // the host's end-of-activation window, not after it.
  //
  // alexanbv 2026-08-12: "If the activate after the main figure, their
  // activation resolves INSIDE the figure's EOA window", with the worked
  // orderings "Activate baze first, teleport child, activate child" and
  // "Activate baze first, activate child, teleport child". Both of those are
  // this window with two descriptors resolved in either order, which is what
  // the bucket chooser gives once the teleport IS a descriptor.
  //
  // It used to be an ad-hoc button row posted from the teardown continuation,
  // i.e. window 2, where it could not be ordered against anything.
  {
    const _cotAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _hasCot = Array.isArray(_cotAtts) && _cotAtts.some((a) => String(a || '').includes('Clan of Two'));
    if (_hasCot) {
      const _hostPos = game.figurePositions?.[playerNum]?.[_selfFk];
      let _childFk = null;
      for (const fk of Object.keys(game.figurePositions?.[playerNum] || {})) {
        if (fk.startsWith('The Child-')) { _childFk = fk; break; }
      }
      if (_hostPos && _childFk) {
        descriptors.push({
          id: `clan_of_two_teleport:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Clan of Two (place The Child)',
          subPromptKey: 'clan_of_two_teleport',
          extras: { dcName, selfFigureKey: _selfFk, childFigureKey: _childFk, hostPos: _hostPos },
        });
      }
    }
  }

  // Force Surge is intentionally NOT an EoA descriptor. Per the project
  // owner 2026-06-18: it is an OPTIONAL Command Card and already surfaces
  // through the generic end-of-activation reaction-card play-from-hand
  // prompt. Wiring it as a descriptor here would force a second, redundant
  // prompt that the player must dismiss every end of activation. The
  // optional play-from-hand path is the only offer.

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
