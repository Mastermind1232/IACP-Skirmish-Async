// Two-timing model: the general PENDING-MODIFIER mechanism (alexanbv 2026-06-18).
//
// Every Command Card / ability has a PLAY (use) timing — when it is offered,
// played, and any choice is made — AND a TAKE-EFFECT timing — when its effect
// actually applies. Usually they are the SAME window (Parry: play=mods,
// effect=mods → apply now, unchanged path). Sometimes they differ (Cavalry
// Charge: play=start_of_round, effect=mods round-long buff). And a single play
// can FAN OUT to {immediate, mods, …} depending on a choice (Hondo Negotiate /
// HK-47 Query: the opponent's choice resolves PART immediately and PART as a
// later modifier).
//
// This module is the GENERAL plumbing for the "effect lands in a LATER combat
// window than the play window" case: when an ability is played at its play
// timing but its effect belongs to a later window, the play stashes a
// structured PENDING MODIFIER keyed by that window. The target window DRAINS
// its pending modifiers and applies them alongside the abilities it normally
// offers. Nothing here is Hondo/HK-47/Cavalry-specific — ANY ability can stash
// a modifier for ANY later window.
//
// Shape on the combat object:
//   combat.pendingModifiers = {
//     mods:          [{ source, effect }, …],
//     after_resolve: [{ source, effect }, …],
//     …
//   }
// `source` is a human-readable label (for the thread message); `effect` is a
// structured DELTA bag applied generically by applyPendingEffect (numeric +bonus
// fields are summed onto the matching combat.* counters). This is PURE state —
// it serializes with the combat object and is drained/cleared as each window
// runs, so it self-cleans within the attack and never leaks across attacks.

import { TIMING_WINDOWS } from './combat-timing-registry.js';

const _WINDOW_SET = new Set(TIMING_WINDOWS);

// The numeric delta fields a pending effect may carry, mapped to the combat.*
// counter they accumulate onto. Generic: a new modifier kind = one entry here,
// no per-ability branching. (block/evade/dodge/hits/etc. mirror the combat
// counters the mods window already manipulates.)
export const PENDING_EFFECT_DELTAS = Object.freeze({
  bonusHits: 'bonusHits',
  bonusBlock: 'bonusBlock',
  bonusEvade: 'bonusEvade',
  bonusDodge: 'bonusDodge',
  bonusAccuracy: 'bonusAccuracy',
  bonusPierce: 'bonusPierce',
  surgeBonus: 'surgeBonus',
  blastDamage: 'blastDamage',
  defenderReducePierce: 'defenderReducePierce',
});

/**
 * Stash a pending modifier on the combat for a LATER window to drain + apply.
 * @param {object} combat  game.pendingCombat
 * @param {string} window  a TIMING_WINDOWS value (where the effect takes effect)
 * @param {{source:string, effect:object}} mod
 */
export function stashPendingModifier(combat, window, mod) {
  if (!combat) throw new Error('stashPendingModifier: combat required');
  if (!_WINDOW_SET.has(window)) throw new Error(`stashPendingModifier: unknown window '${window}'`);
  if (!mod || typeof mod !== 'object' || !mod.effect || typeof mod.effect !== 'object') {
    throw new Error('stashPendingModifier: { source, effect } required (effect must be an object)');
  }
  if (!combat.pendingModifiers) combat.pendingModifiers = {};
  (combat.pendingModifiers[window] = combat.pendingModifiers[window] || []).push({
    source: mod.source || null,
    effect: { ...mod.effect },
  });
}

/** True if there is at least one pending modifier stashed for the window. */
export function hasPendingModifiers(combat, window) {
  return !!(combat?.pendingModifiers?.[window]?.length);
}

/**
 * Drain (return + clear) the pending modifiers stashed for a window. The caller
 * applies each via applyPendingEffect (and may also message the thread using the
 * `source` label). Returns [] when none.
 * @returns {{source:string, effect:object}[]}
 */
export function drainPendingModifiers(combat, window) {
  if (!_WINDOW_SET.has(window)) throw new Error(`drainPendingModifiers: unknown window '${window}'`);
  const list = combat?.pendingModifiers?.[window];
  if (!list || !list.length) return [];
  delete combat.pendingModifiers[window];
  if (combat.pendingModifiers && Object.keys(combat.pendingModifiers).length === 0) delete combat.pendingModifiers;
  return list;
}

/**
 * Apply one structured pending effect's numeric deltas onto the combat counters
 * (generic — sums each known +bonus field). Unknown fields are ignored so a
 * future effect kind can carry extra metadata without breaking older drains.
 * @param {object} combat
 * @param {object} effect  a delta bag (keys ⊂ PENDING_EFFECT_DELTAS)
 */
export function applyPendingEffect(combat, effect) {
  if (!effect || typeof effect !== 'object') return;
  for (const [field, counter] of Object.entries(PENDING_EFFECT_DELTAS)) {
    const delta = effect[field];
    if (typeof delta === 'number' && delta !== 0) {
      combat[counter] = (combat[counter] || 0) + delta;
    }
  }
}
