/**
 * Named-Command-Card per-timing-instance tracker.
 *
 * Per destruct 2026-05-07: "Only one copy of a named Command Card can be
 * played per timing instance." Generalizes ad-hoc flags
 * (jundlandTerrorPlayedThisEor, reinforcementsPlayedThisSor) to all
 * named CCs across all timings.
 *
 * Examples:
 *   - Same player can't play two copies of "Take Cover" in the same SOR.
 *   - Same player can't play two copies of "Brace" during the same attack.
 *   - Aphra excavates a CC she already played this SOR — can't play it
 *     again this SOR.
 *
 * Storage shape:
 *   game.namedCcsPlayedPerTiming = {
 *     [bucket]: { [playerNum]: { [cardName]: true } }
 *   }
 *
 * Bucket lifecycle (clear-on-end):
 *   - 'sor'        — SOR phase. Cleared at round start (whole object reset
 *                    via ROUND_OBJECT_FLAGS).
 *   - 'eor'        — EOR phase. Cleared at round start.
 *   - 'status'     — status phase. Cleared at round start.
 *   - 'activation' — current activation. Cleared explicitly at
 *                    activation end (cleanupActivation).
 *   - 'attack'     — current pending attack. Cleared explicitly when
 *                    pendingCombat resolves/clears.
 *
 * Timing strings from data/cc-effects.json map to buckets per
 * `timingToBucket` below. Unmapped timings (event-bound interrupts like
 * Parting Blow) don't enter the tracker — those are gated by per-event
 * card-text rules elsewhere.
 */

/** Map a CC's timing field to a tracker bucket. Returns null for un-tracked timings. */
export function timingToBucket(timing) {
  const t = String(timing || '').toLowerCase().trim();
  if (!t) return null;
  if (t === 'startofround' || t === 'startofstatusphase') return 'sor';
  if (t === 'endofround') return 'eor';
  if (t.startsWith('endofstatusphase')) return 'status';
  if (
    t === 'duringactivation'
    || t === 'startofactivation'
    || t === 'endofactivation'
    || t === 'afteryouresolvegroupsactivation'
    || t === 'afteractivationresolves'
    || t === 'duringyouractivation'
  ) {
    return 'activation';
  }
  if (
    t === 'duringattack'
    || t === 'whendeclaringrangedattack'
    || t === 'beforedeclaringrangedattack'
    || t === 'whenattacked'
    || t === 'whendefenderhasdeclaredattack'
    || t === 'afterresolvingattack'
    || t === 'afteryouresolveattack'
  ) {
    return 'attack';
  }
  return null;
}

/** Mark a named CC as played in the given timing's instance bucket. */
export function markNamedCcPlayed(game, playerNum, cardName, timing) {
  if (!game || !cardName || !playerNum) return;
  const bucket = timingToBucket(timing);
  if (!bucket) return;
  game.namedCcsPlayedPerTiming = game.namedCcsPlayedPerTiming || {};
  game.namedCcsPlayedPerTiming[bucket] = game.namedCcsPlayedPerTiming[bucket] || {};
  const pnKey = String(playerNum);
  game.namedCcsPlayedPerTiming[bucket][pnKey] = game.namedCcsPlayedPerTiming[bucket][pnKey] || {};
  game.namedCcsPlayedPerTiming[bucket][pnKey][cardName] = true;
}

/** True if `playerNum` has already played `cardName` in the current `timing` bucket's instance. */
export function isNamedCcAlreadyPlayed(game, playerNum, cardName, timing) {
  if (!game || !cardName || !playerNum) return false;
  const bucket = timingToBucket(timing);
  if (!bucket) return false;
  return Boolean(game.namedCcsPlayedPerTiming?.[bucket]?.[String(playerNum)]?.[cardName]);
}

/** Clear all entries for a single bucket. Call at lifecycle ends (activation end, attack resolve). */
export function clearNamedCcBucket(game, bucket) {
  if (!game?.namedCcsPlayedPerTiming) return;
  delete game.namedCcsPlayedPerTiming[bucket];
}
