/**
 * CC counter-window cancel rules (alexanbv 2026-06-17).
 *
 * Negation (cost 1): "Use after your opponent plays a Command card with a cost
 *   of 0." → cancels a played card ONLY if its cost is 0. Since Negation (1) and
 *   Comm Disruption (2) are cost > 0, Negation can NEVER cancel either of them.
 * Comm Disruption (cost 2): "Use when a Command card with cost X is played,
 *   where X ≤ your friendly SPY groups." → requires at least 1 friendly SPY
 *   group, and cancels a played card whose cost is ≤ that SPY-group count. So it
 *   can cancel Negation (need ≥1 SPY) and Comm Disruption (need ≥2 SPY) — Comms
 *   chains, Negate does not.
 *
 * Pure rules only; the engine enforces hand possession / timing separately.
 */

export const NEGATION = 'Negation';
export const COMM_DISRUPTION = 'Comm Disruption';

/**
 * Can `counterCard` cancel a played card of cost `targetCost`, given the
 * canceller has `cancellerSpyCount` friendly SPY groups?
 * @param {string} counterCard - 'Negation' or 'Comm Disruption'
 * @param {number} targetCost - the played (target) card's cost
 * @param {number} [cancellerSpyCount=0] - canceller's friendly SPY group count
 * @returns {boolean}
 */
export function canCancelCc(counterCard, targetCost, cancellerSpyCount = 0) {
  if (counterCard === NEGATION) return targetCost === 0;
  if (counterCard === COMM_DISRUPTION) return (cancellerSpyCount || 0) > 0 && targetCost <= cancellerSpyCount;
  return false;
}

/**
 * The counters that are rule-legal against a played card of cost `targetCost`,
 * given the canceller's SPY count. Hand possession is checked elsewhere; this
 * decides whether a counter-window can open at all and which options to show.
 * @returns {string[]} subset of [NEGATION, COMM_DISRUPTION]
 */
export function availableCounters(targetCost, cancellerSpyCount = 0) {
  const out = [];
  if (canCancelCc(NEGATION, targetCost, cancellerSpyCount)) out.push(NEGATION);
  if (canCancelCc(COMM_DISRUPTION, targetCost, cancellerSpyCount)) out.push(COMM_DISRUPTION);
  return out;
}

/**
 * Resolve a counter-window play stack and return each entry's final status
 * ('resolved' | 'cancelled').
 *
 * The stack is bottom-to-top in play order: index 0 is the original card, and
 * each later entry is a counter targeting the entry immediately below it. It
 * unwinds LIFO — the last counter played is itself uncountered, so it resolves
 * and cancels its target; a cancelled counter does NOT cancel its own target, so
 * the target below it survives and resolves. Thus statuses alternate, gated by
 * the cancel rules (a resolved counter only cancels its target if `canCancelCc`
 * allows it). The classic case: Element of Surprise (0) ← Negation ← Comm
 * Disruption ⇒ Comms resolves, Negation is cancelled, Element of Surprise
 * resolves. alexanbv 2026-06-17.
 *
 * @param {Array<{card:string, cost:number, spyCount?:number}>} stack
 *   - card: the played card name; cost: its cost; spyCount: the player's friendly
 *     SPY-group count when they played it (used when the card is a Comm Disruption).
 * @returns {Array<'resolved'|'cancelled'>} parallel to `stack`
 */
export function resolveCounterStack(stack) {
  const n = Array.isArray(stack) ? stack.length : 0;
  const status = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (i === n - 1) { status[i] = 'resolved'; continue; } // top is uncountered
    const above = stack[i + 1];
    const cancelledByAbove = status[i + 1] === 'resolved'
      && canCancelCc(above.card, stack[i].cost, above.spyCount || 0);
    status[i] = cancelledByAbove ? 'cancelled' : 'resolved';
  }
  return status;
}
